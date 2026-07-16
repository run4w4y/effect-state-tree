import type { TreeValidationPhase } from '@effect-state-tree/core'
import { Context, Effect, HashSet } from 'effect'

/** Opaque provenance token used by adapters to suppress their own echoes. */
export type SourceToken = string | symbol | object

/** Fiber-local commit defaults inherited by nested state operations. */
export interface CommitContextValue {
  readonly tags: HashSet.HashSet<string>
  readonly label?: string
  readonly metadata?: unknown
  readonly source?: SourceToken
  readonly validationPhase?: TreeValidationPhase
}

const emptyCommitContext = (): CommitContextValue => ({ tags: HashSet.empty() })

/** Fiber-local defaults inherited by every tree commit in an Effect workflow. */
export const CurrentCommitContext = Context.Reference<CommitContextValue>(
  '@effect-state-tree/runtime/CurrentCommitContext',
  { defaultValue: emptyCommitContext }
)

/** Partial fiber-local defaults supplied by `withCommitContext`. */
export interface CommitContextPatch {
  readonly tags?: Iterable<string>
  readonly label?: string
  readonly metadata?: unknown
  readonly source?: SourceToken
  readonly validationPhase?: TreeValidationPhase
}

const property = <Key extends keyof Omit<CommitContextValue, 'tags'>>(
  current: CommitContextValue,
  patch: CommitContextPatch,
  key: Key
): Pick<CommitContextValue, Key> | object => {
  const value = patch[key] !== undefined ? patch[key] : current[key]
  return value === undefined ? {} : { [key]: value }
}

const mergeCommitContext = (
  current: CommitContextValue,
  patch: CommitContextPatch
): CommitContextValue => ({
  tags: HashSet.union(current.tags, HashSet.fromIterable(patch.tags ?? [])),
  ...property(current, patch, 'label'),
  ...property(current, patch, 'metadata'),
  ...property(current, patch, 'source'),
  ...property(current, patch, 'validationPhase'),
})

/** Provides additional commit metadata for the dynamic extent of an Effect. */
export const withCommitContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  patch: CommitContextPatch
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const current = yield* CurrentCommitContext
    return yield* Effect.provideService(
      effect,
      CurrentCommitContext,
      mergeCommitContext(current, patch)
    )
  })

/** Adds one operational tag to every tree commit within an Effect. */
export const withCommitTag = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  tag: string
): Effect.Effect<A, E, R> => withCommitContext(effect, { tags: [tag] })
