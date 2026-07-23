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
  type Scope,
  Semaphore,
} from 'effect'

/** Commit tag that excludes a transition from undo and redo history. */
export const HistorySkipTag = 'history.skip' as const
/** Commit tag attached to a transition produced by undo. */
export const HistoryUndoTag = 'history.undo' as const
/** Commit tag attached to a transition produced by redo. */
export const HistoryRedoTag = 'history.redo' as const
/** Prefix used to associate several commits with one history entry. */
export const HistoryGroupTagPrefix = 'history.group:' as const

const hasAnyTag = (
  tags: HashSet.HashSet<string>,
  candidates: Iterable<string>
): boolean => {
  for (const candidate of candidates) {
    if (HashSet.has(tags, candidate)) return true
  }
  return false
}

/** Non-tree state captured and restored with one history entry. */
export interface AttachedHistoryState<A> {
  /** Attached value captured before the transition. */
  readonly before: A
  /** Attached value captured after the transition. */
  readonly after: A
}

/** Reversible patch/operation batch recorded by the history plugin. */
export interface HistoryEntry<A = never> {
  /** Atomic commit identifiers combined into this history entry. */
  readonly transactionIds: ReadonlyArray<string>
  /** Most recent human-readable label in the entry. */
  readonly label?: string
  /** Fiber-local group identifier, when commits were grouped. */
  readonly groupId?: string
  /** Change applied when undoing this entry. */
  readonly undo: ApplyChangeInput
  /** Change applied when redoing this entry. */
  readonly redo: ApplyChangeInput
  /** Optional non-tree state restored with the transition. */
  readonly attached?: AttachedHistoryState<A>
}

/** Immutable undo and redo stacks. */
export interface HistoryState<A = never> {
  /** Entries available to undo, oldest first. */
  readonly undo: ReadonlyArray<HistoryEntry<A>>
  /** Entries available to redo, oldest first. */
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
    readonly baselineTags?: Iterable<string>
  } = {}
): HistoryState<A> => {
  if (hasAnyTag(commit.tags, options.baselineTags ?? [])) {
    return emptyHistory()
  }
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
  options: {
    readonly limit?: number
    readonly baselineTags?: Iterable<string>
  } = {}
): CommitReducer<HistoryState<A>, S> => ({
  initial: emptyHistory(),
  reduce: (state, commit) => [recordHistory(state, commit, options), []],
})

/** Successful undo or redo request for which the selected stack was empty. */
export interface NoHistoryChange {
  /** Discriminant for an empty-stack history operation. */
  readonly _tag: 'NoHistoryChange'
  /** History stack that contained no entry. */
  readonly reason: 'empty-undo' | 'empty-redo'
}

/** The tree changed after an undo/redo entry was selected for application. */
export class HistoryRevisionConflict extends Data.TaggedError(
  'HistoryRevisionConflict'
)<{
  readonly expected: number
  readonly actual: number
}> {}

/** Result of undo or redo, including the empty-stack no-op case. */
export type HistoryActionResult<S extends Schema.Constraint> =
  | NoHistoryChange
  | CommitResult<S>

/** Live history StoreView with serialized undo and redo Effects. */
export interface HistoryController<S extends Schema.Constraint, A = never>
  extends StoreView<HistoryState<A>> {
  /** Reads the current undo and redo stacks synchronously. */
  readonly getState: () => HistoryState<A>
  /** Returns whether an undo entry is currently available. */
  readonly canUndo: () => boolean
  /** Returns whether a redo entry is currently available. */
  readonly canRedo: () => boolean
  /** Applies the newest undo entry after verifying its selected revision. */
  readonly undo: Effect.Effect<
    HistoryActionResult<S>,
    TreePatchError | TreeStoreShutdownError | HistoryRevisionConflict
  >
  /** Applies the newest redo entry after verifying its selected revision. */
  readonly redo: Effect.Effect<
    HistoryActionResult<S>,
    TreePatchError | TreeStoreShutdownError | HistoryRevisionConflict
  >
  /** Clears both history stacks without changing the tree. */
  readonly clear: () => void
  /** Stops observing commits and releases controller listeners. */
  readonly dispose: () => void
}

/** Stack limits and optional attached non-tree state integration. */
export interface HistoryControllerOptions<A> {
  /** Maximum number of undo entries retained; unlimited when omitted. */
  readonly limit?: number
  /** Commit tags that establish a new baseline and clear both stacks. */
  readonly baselineTags?: Iterable<string>
  /** Captures non-tree state alongside each recorded transition. */
  readonly captureAttached?: () => A
  /** Restores attached state when an undo or redo entry is applied. */
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
          ...(options.baselineTags !== undefined
            ? { baselineTags: options.baselineTags }
            : {}),
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

/** Attaches history for the lifetime of the surrounding Effect Scope. */
export const makeHistoryScoped = <S extends Schema.Constraint, A = never>(
  store: TreeStore<S>,
  options: HistoryControllerOptions<A> = {}
): Effect.Effect<HistoryController<S, A>, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => makeHistory(store, options)),
    (history) => Effect.sync(history.dispose)
  )

let groupSequence = 0

/** Effect service responsible for deterministic history group identifiers. */
export interface HistoryGroupIdGenerator {
  /** Allocates the next group identifier in the current Effect environment. */
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
