import type { TreePatchError, TreeValue } from '@effect-state-tree/core'
import type {
  ChangeEnvelope,
  CommitReducer,
  CommitResult,
  StoreView,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import { makeCommitReducerController } from '@effect-state-tree/runtime'
import { Data, Effect, HashSet, type Schema } from 'effect'

/** Commit tag preventing a transition from being appended to the timeline. */
export const DevtoolsSkipTag = 'devtools.skip' as const
/** Commit tag identifying a snapshot replacement initiated by time travel. */
export const DevtoolsTimeTravelTag = 'devtools.time-travel' as const

/** Immutable timeline anchored at the revision where recording began. */
export interface DevtoolsState<S extends Schema.Constraint> {
  readonly initial: TreeValue<S>
  readonly initialRevision: number
  readonly entries: ReadonlyArray<ChangeEnvelope<S>>
}

/** Creates an empty timeline anchored to a known snapshot and revision. */
export const makeDevtoolsState = <S extends Schema.Constraint>(
  initial: TreeValue<S>,
  initialRevision = 0
): DevtoolsState<S> => ({ initial, initialRevision, entries: [] })

/** Purely records one eligible commit and advances the base when size-limited. */
export const recordDevtoolsCommit = <S extends Schema.Constraint>(
  state: DevtoolsState<S>,
  commit: ChangeEnvelope<S>,
  limit?: number
): DevtoolsState<S> => {
  if (HashSet.has(commit.tags, DevtoolsSkipTag)) return state
  const entries = [...state.entries, commit]
  const kept =
    limit === 0
      ? []
      : limit !== undefined && limit > 0
        ? entries.slice(-limit)
        : entries
  const dropped = entries.length - kept.length
  const base = dropped === 0 ? undefined : entries[dropped - 1]
  return {
    initial: base?.after ?? state.initial,
    initialRevision: base?.revisionAfter ?? state.initialRevision,
    entries: kept,
  }
}

/** Creates the portable commit reducer for a devtools timeline. */
export const devtoolsReducer = <S extends Schema.Constraint>(
  initial: TreeValue<S>,
  options: { readonly limit?: number; readonly initialRevision?: number } = {}
): CommitReducer<DevtoolsState<S>, S> => ({
  initial: makeDevtoolsState(initial, options.initialRevision),
  reduce: (state, commit) => [
    recordDevtoolsCommit(state, commit, options.limit),
    [],
  ],
})

/** Requested time-travel revision is not retained by the current timeline. */
export class DevtoolsRevisionError extends Data.TaggedError(
  'DevtoolsRevisionError'
)<{
  readonly revision: number
}> {}

/** Live timeline StoreView with non-recording time travel and resume controls. */
export interface DevtoolsController<S extends Schema.Constraint>
  extends StoreView<DevtoolsState<S>> {
  readonly getState: () => DevtoolsState<S>
  readonly travelTo: (
    revision: number
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | DevtoolsRevisionError
  >
  readonly resume: Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError
  >
  readonly clear: () => void
  readonly dispose: () => void
}

/** Attaches a programmatic commit timeline to an existing tree store. */
export const makeDevtools = <S extends Schema.Constraint>(
  store: TreeStore<S>,
  options: { readonly limit?: number } = {}
): DevtoolsController<S> => {
  const initial = store.getSnapshot()
  const initialRevision = store.getRevision()
  const live = makeCommitReducerController(
    store,
    devtoolsReducer(initial, { ...options, initialRevision })
  )

  const snapshotAt = (revision: number): TreeValue<S> | undefined => {
    const state = live.getSnapshot()
    if (revision === state.initialRevision) return state.initial
    return state.entries.find((entry) => entry.revisionAfter === revision)
      ?.after
  }

  const replaceWithoutRecording = (
    snapshot: TreeValue<S>,
    label: string
  ): Effect.Effect<CommitResult<S>, TreePatchError | TreeStoreShutdownError> =>
    store.replace(snapshot, {
      label,
      tags: [DevtoolsSkipTag, DevtoolsTimeTravelTag, 'history.skip'],
    })

  return {
    getState: live.getSnapshot,
    getSnapshot: live.getSnapshot,
    subscribe: live.subscribe,
    changes: live.changes,
    travelTo(revision) {
      const snapshot = snapshotAt(revision)
      return snapshot === undefined
        ? Effect.fail(new DevtoolsRevisionError({ revision }))
        : replaceWithoutRecording(
            snapshot,
            `Time travel to revision ${revision}`
          )
    },
    resume: Effect.suspend(() => {
      const state = live.getSnapshot()
      const latest = state.entries.at(-1)?.after ?? state.initial
      return replaceWithoutRecording(latest, 'Resume latest revision')
    }),
    clear() {
      live.setState(makeDevtoolsState(store.getSnapshot(), store.getRevision()))
    },
    dispose: live.dispose,
  }
}
