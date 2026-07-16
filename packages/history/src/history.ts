import type { TreePatchError } from '@effect-state-tree/core'

import { invertPatchSet } from '@effect-state-tree/core'
import type { ChangeSet } from '@effect-state-tree/producer'
import type {
  ApplyChangeInput,
  ChangeEnvelope,
  CommitReducer,
  CommitResult,
  StoreView,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import {
  makeCommitReducerController,
  withCommitContext,
} from '@effect-state-tree/runtime'
import {
  Clock,
  Context,
  Data,
  Effect,
  HashSet,
  type Schema,
  Semaphore,
} from 'effect'

export const HistorySkipTag = 'history.skip' as const
export const HistoryUndoTag = 'history.undo' as const
export const HistoryRedoTag = 'history.redo' as const
export const HistoryGroupTagPrefix = 'history.group:' as const

/** Non-tree state captured and restored with one history entry. */
export interface AttachedHistoryState<A> {
  readonly before: A
  readonly after: A
}

/** Reversible patch/operation batch recorded by the history plugin. */
export interface HistoryEntry<A = never> {
  readonly transactionIds: ReadonlyArray<string>
  readonly label?: string
  readonly groupId?: string
  readonly undo: ApplyChangeInput
  readonly redo: ApplyChangeInput
  readonly attached?: AttachedHistoryState<A>
}

/** Immutable undo and redo stacks. */
export interface HistoryState<A = never> {
  readonly undo: ReadonlyArray<HistoryEntry<A>>
  readonly redo: ReadonlyArray<HistoryEntry<A>>
}

/** Creates empty immutable history state. */
export const emptyHistory = <A = never>(): HistoryState<A> => ({
  undo: [],
  redo: [],
})

const groupIdOf = (
  commit: ChangeEnvelope<Schema.Constraint>
): string | undefined => {
  const groups = [...commit.tags].filter((tag) =>
    tag.startsWith(HistoryGroupTagPrefix)
  )
  return groups.at(-1)?.slice(HistoryGroupTagPrefix.length)
}

const invertChange = (change: ChangeSet): ApplyChangeInput => ({
  patches: invertPatchSet(change.patches),
  operations: change.inverseOperations,
  inverseOperations: change.operations,
})

const forwardChange = (change: ChangeSet): ApplyChangeInput => ({
  patches: change.patches,
  operations: change.operations,
  inverseOperations: change.inverseOperations,
})

const combineEntries = <A>(
  previous: HistoryEntry<A>,
  next: HistoryEntry<A>
): HistoryEntry<A> => ({
  transactionIds: [...previous.transactionIds, ...next.transactionIds],
  ...(next.label !== undefined
    ? { label: next.label }
    : previous.label !== undefined
      ? { label: previous.label }
      : {}),
  ...(next.groupId !== undefined ? { groupId: next.groupId } : {}),
  undo: {
    patches: {
      forward: [...next.undo.patches.forward, ...previous.undo.patches.forward],
      inverse: [...previous.undo.patches.inverse, ...next.undo.patches.inverse],
    },
    operations: [
      ...(next.undo.operations ?? []),
      ...(previous.undo.operations ?? []),
    ],
    inverseOperations: [
      ...(previous.undo.inverseOperations ?? []),
      ...(next.undo.inverseOperations ?? []),
    ],
  },
  redo: {
    patches: {
      forward: [...previous.redo.patches.forward, ...next.redo.patches.forward],
      inverse: [...next.redo.patches.inverse, ...previous.redo.patches.inverse],
    },
    operations: [
      ...(previous.redo.operations ?? []),
      ...(next.redo.operations ?? []),
    ],
    inverseOperations: [
      ...(next.redo.inverseOperations ?? []),
      ...(previous.redo.inverseOperations ?? []),
    ],
  },
  ...(previous.attached !== undefined && next.attached !== undefined
    ? {
        attached: {
          before: previous.attached.before,
          after: next.attached.after,
        },
      }
    : {}),
})

/** Converts a committed envelope into executable undo and redo changes. */
export const historyEntryFromCommit = <S extends Schema.Constraint, A = never>(
  commit: ChangeEnvelope<S>,
  attached?: AttachedHistoryState<A>
): HistoryEntry<A> => {
  const groupId = groupIdOf(commit)
  return {
    transactionIds: [commit.transactionId],
    ...(commit.label !== undefined ? { label: commit.label } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    undo: invertChange(commit.change),
    redo: forwardChange(commit.change),
    ...(attached !== undefined ? { attached } : {}),
  }
}

/** Purely reduces one eligible commit into grouped, size-limited history. */
export const recordHistory = <S extends Schema.Constraint, A = never>(
  state: HistoryState<A>,
  commit: ChangeEnvelope<S>,
  options: {
    readonly limit?: number
    readonly attached?: AttachedHistoryState<A>
  } = {}
): HistoryState<A> => {
  if (
    HashSet.has(commit.tags, HistorySkipTag) ||
    commit.change.patches.forward.length === 0
  ) {
    return state
  }
  const entry = historyEntryFromCommit(commit, options.attached)
  const previous = state.undo.at(-1)
  const grouped =
    previous !== undefined &&
    entry.groupId !== undefined &&
    previous.groupId === entry.groupId
  const nextUndo = grouped
    ? [...state.undo.slice(0, -1), combineEntries(previous, entry)]
    : [...state.undo, entry]
  const limit = options.limit
  return {
    undo:
      limit === 0
        ? []
        : limit !== undefined && limit > 0
          ? nextUndo.slice(-limit)
          : nextUndo,
    redo: [],
  }
}

/** Creates the portable commit reducer used by the live history controller. */
export const historyReducer = <S extends Schema.Constraint, A = never>(
  options: { readonly limit?: number } = {}
): CommitReducer<HistoryState<A>, S> => ({
  initial: emptyHistory(),
  reduce: (state, commit) => [recordHistory(state, commit, options), []],
})

export interface NoHistoryChange {
  readonly _tag: 'NoHistoryChange'
  readonly reason: 'empty-undo' | 'empty-redo'
}

/** The tree changed after an undo/redo entry was selected for application. */
export class HistoryRevisionConflict extends Data.TaggedError(
  'HistoryRevisionConflict'
)<{
  readonly expected: number
  readonly actual: number
}> {}

export type HistoryActionResult<S extends Schema.Constraint> =
  | NoHistoryChange
  | CommitResult<S>

/** Live history StoreView with serialized undo and redo Effects. */
export interface HistoryController<S extends Schema.Constraint, A = never>
  extends StoreView<HistoryState<A>> {
  readonly getState: () => HistoryState<A>
  readonly canUndo: () => boolean
  readonly canRedo: () => boolean
  readonly undo: Effect.Effect<
    HistoryActionResult<S>,
    TreePatchError | TreeStoreShutdownError | HistoryRevisionConflict
  >
  readonly redo: Effect.Effect<
    HistoryActionResult<S>,
    TreePatchError | TreeStoreShutdownError | HistoryRevisionConflict
  >
  readonly clear: () => void
  readonly dispose: () => void
}

/** Stack limits and optional attached non-tree state integration. */
export interface HistoryControllerOptions<A> {
  readonly limit?: number
  readonly captureAttached?: () => A
  readonly restoreAttached?: (state: A) => void
}

/** Attaches patch-based undo/redo history to a live tree store. */
export const makeHistory = <S extends Schema.Constraint, A = never>(
  store: TreeStore<S>,
  options: HistoryControllerOptions<A> = {}
): HistoryController<S, A> => {
  type Captured =
    | { readonly _tag: 'Captured'; readonly value: A }
    | { readonly _tag: 'NotCaptured' }
  const capture = options.captureAttached
  const takeAttached = (): Captured =>
    capture === undefined
      ? { _tag: 'NotCaptured' }
      : { _tag: 'Captured', value: capture() }

  let lastAttached = takeAttached()
  const semaphore = Semaphore.makeUnsafe(1)
  const live = makeCommitReducerController(store, {
    initial: emptyHistory<A>(),
    reduce: (state, commit) => {
      const afterAttached = takeAttached()
      const attached =
        lastAttached._tag === 'Captured' && afterAttached._tag === 'Captured'
          ? { before: lastAttached.value, after: afterAttached.value }
          : undefined
      lastAttached = afterAttached
      return [
        recordHistory(state, commit, {
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(attached !== undefined ? { attached } : {}),
        }),
        [],
      ]
    },
  })

  const undo = semaphore.withPermit(
    Effect.suspend(() => {
      const expectedRevision = store.getRevision()
      const state = live.getSnapshot()
      const entry = state.undo.at(-1)
      if (entry === undefined) {
        return Effect.succeed<HistoryActionResult<S>>({
          _tag: 'NoHistoryChange',
          reason: 'empty-undo',
        })
      }
      return Effect.gen(function* () {
        const result = yield* store.apply(entry.undo, {
          label: entry.label ?? 'Undo',
          tags: [HistorySkipTag, HistoryUndoTag],
          guard: (proposal) =>
            proposal.revisionBefore === expectedRevision
              ? Effect.void
              : Effect.fail(
                  new HistoryRevisionConflict({
                    expected: expectedRevision,
                    actual: proposal.revisionBefore,
                  })
                ),
        })
        live.setState({
          undo: state.undo.slice(0, -1),
          redo: [...state.redo, entry],
        })
        if (entry.attached !== undefined) {
          options.restoreAttached?.(entry.attached.before)
          lastAttached = { _tag: 'Captured', value: entry.attached.before }
        }
        return result
      })
    })
  )

  const redo = semaphore.withPermit(
    Effect.suspend(() => {
      const expectedRevision = store.getRevision()
      const state = live.getSnapshot()
      const entry = state.redo.at(-1)
      if (entry === undefined) {
        return Effect.succeed<HistoryActionResult<S>>({
          _tag: 'NoHistoryChange',
          reason: 'empty-redo',
        })
      }
      return Effect.gen(function* () {
        const result = yield* store.apply(entry.redo, {
          label: entry.label ?? 'Redo',
          tags: [HistorySkipTag, HistoryRedoTag],
          guard: (proposal) =>
            proposal.revisionBefore === expectedRevision
              ? Effect.void
              : Effect.fail(
                  new HistoryRevisionConflict({
                    expected: expectedRevision,
                    actual: proposal.revisionBefore,
                  })
                ),
        })
        live.setState({
          undo: [...state.undo, entry],
          redo: state.redo.slice(0, -1),
        })
        if (entry.attached !== undefined) {
          options.restoreAttached?.(entry.attached.after)
          lastAttached = { _tag: 'Captured', value: entry.attached.after }
        }
        return result
      })
    })
  )

  return {
    getState: live.getSnapshot,
    getSnapshot: live.getSnapshot,
    subscribe: live.subscribe,
    changes: live.changes,
    canUndo: () => live.getSnapshot().undo.length > 0,
    canRedo: () => live.getSnapshot().redo.length > 0,
    undo,
    redo,
    clear() {
      live.setState(emptyHistory<A>())
    },
    dispose: live.dispose,
  }
}

let groupSequence = 0

/** Effect service responsible for deterministic history group identifiers. */
export interface HistoryGroupIdGenerator {
  readonly next: Effect.Effect<string>
}

const defaultHistoryGroupIds = (): HistoryGroupIdGenerator => ({
  next: Effect.gen(function* () {
    groupSequence += 1
    const now = yield* Clock.currentTimeMillis
    return `${now.toString(36)}-${groupSequence.toString(36)}`
  }),
})

/** Fiber-injectable source for deterministic grouping during tests and replay. */
export const HistoryGroupIds = Context.Reference<HistoryGroupIdGenerator>(
  '@effect-state-tree/history/HistoryGroupIds',
  { defaultValue: defaultHistoryGroupIds }
)

/** Creates a history group ID service from a lazy pure generator. */
export const historyGroupIdsFrom = (
  next: () => string
): HistoryGroupIdGenerator => ({
  next: Effect.sync(next),
})

/** Groups every tree commit made by an Effect into one undo entry. */
export const groupHistory = <A, E, R>(
  label: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  return Effect.gen(function* () {
    const generator = yield* HistoryGroupIds
    const groupId = yield* generator.next
    return yield* withCommitContext(effect, {
      label,
      tags: [`${HistoryGroupTagPrefix}${groupId}`],
    })
  })
}

/** Runs an Effect with history recording disabled for all nested commits. */
export const withoutHistory = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  withCommitContext(effect, { tags: [HistorySkipTag] })
