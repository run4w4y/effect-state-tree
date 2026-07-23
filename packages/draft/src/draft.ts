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
  type TreePathValue,
  type TreeValue,
} from '@effect-state-tree/core'
import type {
  CommitResult,
  ProposedCommit,
  TreeCheckpoint,
  TreeCheckpointError,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import {
  makeTreeStore,
  TreeCheckpointConflict,
  withCommitTag,
} from '@effect-state-tree/runtime'
import { Data, Effect, Option, Result, type Schema, type Scope } from 'effect'

/** Commit tag applied when draft data is copied into its original tree. */
export const DraftCommitTag = 'draft.commit' as const
/** Commit tag applied when a draft is reset from its original tree. */
export const DraftResetTag = 'draft.reset' as const
/** Commit tag applied when a submission installs an authoritative value. */
export const DraftAcceptedTag = 'draft.accepted' as const
/** Commit tag applied when a refresh installs an authoritative value. */
export const DraftRefreshedTag = 'draft.refreshed' as const

/** Failures possible while committing, resetting, or resolving a draft path. */
export type DraftError =
  | TreePatchError
  | TreeStoreShutdownError
  | IdentityMismatchError
  | GetAtPathFailure

/** A refresh cannot replace an editing path that was already modified. */
export class DraftDirtyError extends Data.TaggedError('DraftDirtyError')<{
  readonly path: TreePath
}> {}

/** Failures possible while reconciling asynchronous draft synchronization. */
export type DraftSynchronizationError =
  | DraftError
  | TreeCheckpointError
  | DraftDirtyError

/** Immutable values captured before a draft submission request starts. */
export interface DraftSubmissionContext<
  S extends Schema.Constraint,
  P extends TreePath,
> {
  /** Original value at the submitted path when the request started. */
  readonly original: TreePathValue<TreeValue<S>, P>
  /** Draft value sent to the request. */
  readonly submitted: TreePathValue<TreeValue<S>, P>
  /** Complete original snapshot captured with `original`. */
  readonly originalRoot: TreeValue<S>
  /** Complete draft snapshot captured with `submitted`. */
  readonly draft: TreeValue<S>
}

/** Immutable values captured before a draft refresh request starts. */
export interface DraftRefreshContext<
  S extends Schema.Constraint,
  P extends TreePath,
> {
  /** Original value at the refreshed path when the request started. */
  readonly original: TreePathValue<TreeValue<S>, P>
  /** Complete original snapshot captured with `original`. */
  readonly originalRoot: TreeValue<S>
  /** Complete clean draft snapshot captured before the request. */
  readonly draft: TreeValue<S>
}

/** Conflict reconciliation policy for an asynchronous draft submission. */
export interface DraftSubmissionOptions<A, E> {
  /** Extracts the server's authoritative value from an expected failure. */
  readonly authoritativeFailure?: (error: E) => Option.Option<A>
}

/** Outcome of installing an authoritative submission or refresh response. */
export type DraftSynchronizationResult<A> =
  | {
      /** Authoritative data updated both the original and the unchanged draft. */
      readonly _tag: 'Accepted'
      readonly authoritative: A
    }
  | {
      /** The original updated, while newer draft edits were deliberately kept. */
      readonly _tag: 'AcceptedWithPendingChanges'
      readonly authoritative: A
    }
  | {
      /** A newer original value made this response stale, so nothing changed. */
      readonly _tag: 'Superseded'
      readonly authoritative: A
    }

/** Same-Schema editing store with patch-based commit and synchronization tools. */
export interface TreeDraft<S extends Schema.Constraint> {
  /** Independent ordinary tree store using exactly the original Schema and IDs. */
  readonly data: TreeStore<S>
  /** Live target; drafts deliberately do not freeze a three-way merge base. */
  readonly original: TreeStore<S>
  /** Replaces the complete original snapshot with the current draft snapshot. */
  readonly commit: Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError
  >
  /** Replaces the complete draft snapshot with the current original snapshot. */
  readonly reset: Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError
  >
  /** Commits one identity-anchored draft path into the original tree. */
  readonly commitAt: (
    path: TreePath
  ) => Effect.Effect<CommitResult<S>, DraftError>
  /** Resets one identity-anchored draft path from the original tree. */
  readonly resetAt: (
    path: TreePath
  ) => Effect.Effect<CommitResult<S>, DraftError>
  /** Returns whether any draft value differs from the current original. */
  readonly isDirty: () => boolean
  /** Returns whether one identity-anchored path differs from the original. */
  readonly isDirtyAt: (path: TreePath) => boolean
  /**
   * Sends a captured path value and reconciles the authoritative response.
   *
   * The request is interruptible. Successful reconciliation is atomic: a stale
   * response cannot replace a newer original value, and edits made while the
   * request is running remain in the draft.
   */
  readonly submitAt: <const P extends TreePath, E, R>(
    path: P,
    request: (
      context: DraftSubmissionContext<S, P>
    ) => Effect.Effect<TreePathValue<TreeValue<S>, P>, E, R>,
    options?: DraftSubmissionOptions<TreePathValue<TreeValue<S>, P>, E>
  ) => Effect.Effect<
    DraftSynchronizationResult<TreePathValue<TreeValue<S>, P>>,
    DraftSynchronizationError | E,
    R
  >
  /**
   * Loads an authoritative path into a clean draft and its original tree.
   *
   * A dirty draft fails with `DraftDirtyError`; edits made after the request
   * starts are retained and reported as `AcceptedWithPendingChanges`.
   */
  readonly refreshAt: <const P extends TreePath, E, R>(
    path: P,
    request: (
      context: DraftRefreshContext<S, P>
    ) => Effect.Effect<TreePathValue<TreeValue<S>, P>, E, R>
  ) => Effect.Effect<
    DraftSynchronizationResult<TreePathValue<TreeValue<S>, P>>,
    DraftSynchronizationError | E,
    R
  >
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

    const applyAuthoritative = <const P extends TreePath>(
      originalCheckpoint: TreeCheckpoint<S, P>,
      draftCheckpoint: TreeCheckpoint<S, P>,
      authoritative: TreePathValue<TreeValue<S>, P>,
      tag: typeof DraftAcceptedTag | typeof DraftRefreshedTag
    ): Effect.Effect<
      DraftSynchronizationResult<TreePathValue<TreeValue<S>, P>>,
      TreePatchError | TreeStoreShutdownError | TreeCheckpointError
    > =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const originalResult = yield* Effect.result(
            original.replaceAtCheckpoint(originalCheckpoint, authoritative, {
              label: 'Accept authoritative draft value',
              tags: [tag],
              validationPhase: 'draft',
            })
          )
          if (Result.isFailure(originalResult)) {
            if (originalResult.failure instanceof TreeCheckpointConflict) {
              return {
                _tag: 'Superseded',
                authoritative,
              }
            }
            return yield* Effect.fail(originalResult.failure)
          }

          const draftResult = yield* Effect.result(
            data.replaceAtCheckpoint(draftCheckpoint, authoritative, {
              label: 'Reconcile accepted draft value',
              tags: [tag],
              validationPhase: 'draft',
            })
          )
          if (Result.isFailure(draftResult)) {
            if (draftResult.failure instanceof TreeCheckpointConflict) {
              return {
                _tag: 'AcceptedWithPendingChanges',
                authoritative,
              }
            }
            return yield* Effect.fail(draftResult.failure)
          }

          return { _tag: 'Accepted', authoritative }
        })
      )

    const reconcileFailure = <const P extends TreePath, E>(
      checkpoint: TreeCheckpoint<S, P>,
      error: E,
      options:
        | DraftSubmissionOptions<TreePathValue<TreeValue<S>, P>, E>
        | undefined
    ): Effect.Effect<never, E | DraftSynchronizationError> => {
      const authoritative = options?.authoritativeFailure?.(error)
      if (authoritative === undefined || Option.isNone(authoritative)) {
        return Effect.fail(error)
      }

      return Effect.uninterruptible(
        Effect.gen(function* () {
          const installed = yield* Effect.result(
            original.replaceAtCheckpoint(checkpoint, authoritative.value, {
              label: 'Reconcile authoritative draft failure',
              tags: [DraftRefreshedTag],
              validationPhase: 'draft',
            })
          )
          if (
            Result.isFailure(installed) &&
            !(installed.failure instanceof TreeCheckpointConflict)
          ) {
            return yield* Effect.fail(installed.failure)
          }
          return yield* Effect.fail(error)
        })
      )
    }

    const commit = Effect.suspend(() =>
      withCommitTag(
        original.replace(data.getSnapshot(), {
          label: 'Draft commit',
          validationPhase: 'draft',
        }),
        DraftCommitTag
      )
    )

    const reset = Effect.suspend(() =>
      withCommitTag(
        data.replace(original.getSnapshot(), {
          label: 'Draft reset',
          validationPhase: 'draft',
        }),
        DraftResetTag
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
            DraftCommitTag
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
            DraftResetTag
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
      submitAt(path, request, options) {
        return Effect.gen(function* () {
          const originalCheckpoint = yield* original.checkpoint(path)
          const draftCheckpoint = yield* data.checkpoint(path)
          const response = yield* Effect.result(
            request({
              original: originalCheckpoint.value,
              submitted: draftCheckpoint.value,
              originalRoot: originalCheckpoint.snapshot,
              draft: draftCheckpoint.snapshot,
            })
          )
          if (Result.isFailure(response)) {
            return yield* reconcileFailure(
              originalCheckpoint,
              response.failure,
              options
            )
          }
          return yield* applyAuthoritative(
            originalCheckpoint,
            draftCheckpoint,
            response.success,
            DraftAcceptedTag
          )
        })
      },
      refreshAt(path, request) {
        return Effect.gen(function* () {
          const originalCheckpoint = yield* original.checkpoint(path)
          const draftCheckpoint = yield* data.checkpoint(path)
          if (
            !deepEqualSnapshot(
              originalCheckpoint.value,
              draftCheckpoint.value,
              snapshotOptionsFor(original.spec)
            )
          ) {
            return yield* Effect.fail(new DraftDirtyError({ path }))
          }
          const authoritative = yield* request({
            original: originalCheckpoint.value,
            originalRoot: originalCheckpoint.snapshot,
            draft: draftCheckpoint.snapshot,
          })
          return yield* applyAuthoritative(
            originalCheckpoint,
            draftCheckpoint,
            authoritative,
            DraftRefreshedTag
          )
        })
      },
    }
  })

/** Allocates a draft whose editing store closes with the surrounding Scope. */
export const makeDraftScoped = <S extends Schema.Constraint>(
  original: TreeStore<S>
): Effect.Effect<TreeDraft<S>, TreeInvariantError, Scope.Scope> =>
  Effect.acquireRelease(makeDraft(original), (draft) => draft.data.shutdown)
