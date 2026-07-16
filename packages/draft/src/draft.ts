import type {
  IdentityMismatchError,
  TreeInvariantError,
  TreePatchError,
} from '@effect-state-tree/core'
import {
  anchorPath,
  deepEqualSnapshot,
  type GetAtPathFailure,
  getAtPath,
  resolveAnchoredPath,
  snapshotOptionsFor,
  type TreePath,
} from '@effect-state-tree/core'
import type {
  CommitResult,
  ProposedCommit,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import { makeTreeStore, withCommitTag } from '@effect-state-tree/runtime'
import { Effect, Result, type Schema } from 'effect'

export type DraftError =
  | TreePatchError
  | TreeStoreShutdownError
  | IdentityMismatchError
  | GetAtPathFailure

export interface TreeDraft<S extends Schema.Constraint> {
  /** Independent ordinary tree store using exactly the original Schema and IDs. */
  readonly data: TreeStore<S>
  /** Live target; drafts deliberately do not freeze a three-way merge base. */
  readonly original: TreeStore<S>
  readonly commit: Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError
  >
  readonly reset: Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError
  >
  readonly commitAt: (
    path: TreePath
  ) => Effect.Effect<CommitResult<S>, DraftError>
  readonly resetAt: (
    path: TreePath
  ) => Effect.Effect<CommitResult<S>, DraftError>
  readonly isDirty: () => boolean
  readonly isDirtyAt: (path: TreePath) => boolean
}

const resolvedValue = (
  root: unknown,
  path: TreePath
): Effect.Effect<unknown, GetAtPathFailure> => {
  const value = getAtPath(root, path)
  return Effect.fromResult(value)
}

const anchoredGuard =
  <S extends Schema.Constraint>(
    store: TreeStore<S>,
    anchored: ReturnType<typeof anchorPath>
  ): ((proposal: ProposedCommit<S>) => Effect.Effect<void, DraftError>) =>
  (proposal) => {
    const resolved = resolveAnchoredPath(
      store.spec,
      proposal.before,
      anchored,
      { ignoreLastIdentity: true }
    )
    return Result.isSuccess(resolved)
      ? Effect.void
      : Effect.fail(resolved.failure)
  }

/**
 * Clones a store into a same-Schema editing tree. Commit/reset operations are
 * expressed only in snapshots, patches, and identity-anchored paths, keeping
 * draft semantics entirely outside the kernel.
 */
export const makeDraft = <S extends Schema.Constraint>(
  original: TreeStore<S>
): Effect.Effect<TreeDraft<S>, TreeInvariantError> =>
  Effect.gen(function* () {
    const data = yield* makeTreeStore(original.spec, original.getSnapshot(), {
      defaultValidationPhase: 'draft',
    })

    const commit = Effect.suspend(() =>
      withCommitTag(
        original.replace(data.getSnapshot(), {
          label: 'Draft commit',
          validationPhase: 'draft',
        }),
        'draft.commit'
      )
    )

    const reset = Effect.suspend(() =>
      withCommitTag(
        data.replace(original.getSnapshot(), {
          label: 'Draft reset',
          validationPhase: 'draft',
        }),
        'draft.reset'
      )
    )

    return {
      data,
      original,
      commit,
      reset,
      commitAt(path) {
        return Effect.gen(function* () {
          const draftSnapshot = data.getSnapshot()
          const anchored = anchorPath(original.spec, draftSnapshot, path)
          const value = yield* resolvedValue(draftSnapshot, path)
          return yield* withCommitTag(
            original.apply(
              {
                patches: {
                  forward: [{ op: 'replace', path, value }],
                  inverse: [],
                },
              },
              {
                label: 'Draft partial commit',
                validationPhase: 'draft',
                guard: anchoredGuard(original, anchored),
              }
            ),
            'draft.commit'
          )
        })
      },
      resetAt(path) {
        return Effect.gen(function* () {
          const originalSnapshot = original.getSnapshot()
          const anchored = anchorPath(original.spec, originalSnapshot, path)
          const value = yield* resolvedValue(originalSnapshot, path)
          return yield* withCommitTag(
            data.apply(
              {
                patches: {
                  forward: [{ op: 'replace', path, value }],
                  inverse: [],
                },
              },
              {
                label: 'Draft partial reset',
                validationPhase: 'draft',
                guard: anchoredGuard(data, anchored),
              }
            ),
            'draft.reset'
          )
        })
      },
      isDirty: () =>
        !deepEqualSnapshot(
          data.getSnapshot(),
          original.getSnapshot(),
          snapshotOptionsFor(original.spec)
        ),
      isDirtyAt(path) {
        const draftSnapshot = data.getSnapshot()
        const draftValue = getAtPath(draftSnapshot, path)
        if (Result.isFailure(draftValue)) return true
        const anchored = anchorPath(original.spec, draftSnapshot, path)
        const originalValue = resolveAnchoredPath(
          original.spec,
          original.getSnapshot(),
          anchored,
          { ignoreLastIdentity: true }
        )
        return (
          Result.isFailure(originalValue) ||
          !deepEqualSnapshot(
            draftValue.success,
            originalValue.success,
            snapshotOptionsFor(original.spec)
          )
        )
      },
    }
  })
