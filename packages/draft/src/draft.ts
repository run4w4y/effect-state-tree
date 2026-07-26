import type {
  TreeInvariantError,
  TreePatchError,
  TreeSpecOptions,
} from '@effect-state-tree/core'
import {
  deepEqualSnapshot,
  reconcileTreeSnapshot,
  snapshotOptionsFor,
} from '@effect-state-tree/core'
import type {
  CommitResult,
  StoreView,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import { makeTreeStore } from '@effect-state-tree/runtime'
import {
  decodeWorkingTree,
  decodeWorkingTreeStructure,
  makeValidationController,
  makeWorkingTreeSpec,
  type ValidatedCheckpoint,
  type ValidationController,
  type ValidationReport,
  validateTree,
  type WorkingSchema,
  type WorkingValue,
} from '@effect-state-tree/validation'
import {
  Data,
  Effect,
  Option,
  Queue,
  Result,
  type Schema,
  type Scope,
  Stream,
} from 'effect'
import { dual } from 'effect/Function'

/** Commit tag applied when a draft resets to its saved checkpoint. */
export const DraftResetTag = 'draft.reset' as const
/** Commit tag applied when persistence accepts the current revision. */
export const DraftAcceptedTag = 'draft.accepted' as const
/** Commit tag applied when a clean draft installs an authoritative refresh. */
export const DraftRefreshedTag = 'draft.refreshed' as const

/** The current working revision does not pass the draft's strict Schema. */
export class DraftValidationError extends Data.TaggedError(
  'DraftValidationError'
)<{
  readonly report: ValidationReport
}> {}

/** An authoritative refresh cannot replace a working tree with pending edits. */
export class DraftDirtyError extends Data.TaggedError('DraftDirtyError') {}

class DraftRevisionConflict extends Data.TaggedError('DraftRevisionConflict')<{
  readonly actual: number
  readonly expected: number
}> {}

/** Failures possible while changing or synchronizing a validated draft. */
export type DraftError =
  | DraftDirtyError
  | DraftValidationError
  | TreePatchError
  | TreeStoreShutdownError

/** Immutable values captured before a draft submission starts. */
export interface DraftSubmissionContext<
  S extends Schema.ConstraintDecoder<unknown>,
> {
  /** Strictly decoded value submitted to persistence. */
  readonly submitted: S['Type']
  /** Exact encoded working snapshot from the submitted revision. */
  readonly working: WorkingValue<S>
  /** Saved checkpoint current when the request started. */
  readonly saved: WorkingValue<S>
  /** Working-tree revision captured for stale-response reconciliation. */
  readonly revision: number
}

/** Reconciliation policy for an expected authoritative submission failure. */
export interface DraftSubmissionOptions<S extends Schema.Constraint, E> {
  /** Extracts the authoritative encoded snapshot carried by a failure. */
  readonly authoritativeFailure?: (error: E) => Option.Option<WorkingValue<S>>
}

/** Outcome of reconciling one authoritative response with the working tree. */
export type DraftSynchronizationResult<A> = Data.TaggedEnum<{
  Accepted: {
    readonly authoritative: A
  }
  AcceptedWithPendingChanges: {
    readonly authoritative: A
  }
}>

interface DraftSynchronizationResultDefinition
  extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: DraftSynchronizationResult<this['A']>
}

const DraftSynchronizationResultVariants =
  Data.taggedEnum<DraftSynchronizationResultDefinition>()

const mapDraftSynchronizationResult: {
  <A, B>(
    f: (authoritative: A) => B
  ): (self: DraftSynchronizationResult<A>) => DraftSynchronizationResult<B>
  <A, B>(
    self: DraftSynchronizationResult<A>,
    f: (authoritative: A) => B
  ): DraftSynchronizationResult<B>
} = dual(
  2,
  <A, B>(
    self: DraftSynchronizationResult<A>,
    f: (authoritative: A) => B
  ): DraftSynchronizationResult<B> => {
    switch (self._tag) {
      case 'Accepted':
        return DraftSynchronizationResultVariants.Accepted({
          authoritative: f(self.authoritative),
        })
      case 'AcceptedWithPendingChanges':
        return DraftSynchronizationResultVariants.AcceptedWithPendingChanges({
          authoritative: f(self.authoritative),
        })
    }
  }
)

/** Constructors, guards, exhaustive matching, and payload mapping for outcomes. */
export const DraftSynchronizationResult = {
  Accepted: DraftSynchronizationResultVariants.Accepted,
  AcceptedWithPendingChanges:
    DraftSynchronizationResultVariants.AcceptedWithPendingChanges,
  $is: DraftSynchronizationResultVariants.$is,
  $match: DraftSynchronizationResultVariants.$match,
  map: mapDraftSynchronizationResult,
} as const

/** Saved-checkpoint projection for one working draft. */
export interface DraftState<S extends Schema.Constraint> {
  /** Latest backend-accepted or refreshed encoded snapshot. */
  readonly saved: WorkingValue<S>
  /** Whether the working snapshot differs from `saved`. */
  readonly dirty: boolean
}

/** One structurally editable tree with saved and latest-valid checkpoints. */
export interface TreeDraft<S extends Schema.ConstraintDecoder<unknown>>
  extends StoreView<DraftState<S>> {
  /** Original strict Schema used to validate working revisions. */
  readonly schema: S
  /** Single check-tolerant working tree. */
  readonly data: TreeStore<WorkingSchema<S>>
  /** Strict native validation and latest-valid checkpoint controller. */
  readonly validation: ValidationController<S>
  /** Reads the latest saved encoded snapshot. */
  readonly getSaved: () => WorkingValue<S>
  /** Reads the latest completely valid working checkpoint. */
  readonly getValidated: () => Option.Option<ValidatedCheckpoint<S>>
  /** Returns whether the working snapshot differs from the saved checkpoint. */
  readonly isDirty: () => boolean
  /** Resets the working tree to the saved checkpoint. */
  readonly reset: Effect.Effect<
    CommitResult<WorkingSchema<S>>,
    TreePatchError | TreeStoreShutdownError
  >
  /** Installs a strict authoritative snapshot when the draft is clean. */
  readonly refresh: (
    authoritative: WorkingValue<S>
  ) => Effect.Effect<CommitResult<WorkingSchema<S>>, DraftError>
  /** Strictly submits the current revision and reconciles the response. */
  readonly submit: <E, R>(
    request: (
      context: DraftSubmissionContext<S>
    ) => Effect.Effect<WorkingValue<S>, E, R>,
    options?: DraftSubmissionOptions<S, E>
  ) => Effect.Effect<
    DraftSynchronizationResult<WorkingValue<S>>,
    DraftError | E,
    R
  >
  /** Releases validation and draft-state subscriptions. */
  readonly dispose: () => void
}

/** Allocates one structurally shared working tree and its validation sidecar. */
export const makeDraft = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  initial: unknown,
  options: TreeSpecOptions = {}
): Effect.Effect<TreeDraft<S>, TreeInvariantError> =>
  Effect.gen(function* () {
    const spec = makeWorkingTreeSpec(schema, options)
    const admittedInitial = yield* Effect.fromResult(
      Result.mapError(decodeWorkingTreeStructure(schema, initial), (issue) => ({
        _tag: 'SchemaAdmissionError' as const,
        issue,
      }))
    )
    const data = yield* makeTreeStore(spec, admittedInitial)
    const validation = makeValidationController(schema, data)
    let saved = data.getSnapshot()
    let disposed = false
    const listeners = new Set<() => void>()

    const isDirty = () =>
      !deepEqualSnapshot(
        data.getSnapshot(),
        saved,
        snapshotOptionsFor(data.spec)
      )

    const getState = (): DraftState<S> => ({
      saved,
      dirty: isDirty(),
    })

    const notify = () => {
      for (const listener of [...listeners]) listener()
    }

    const stopObservingData = data.subscribe(() => notify())

    const subscribe = (listener: () => void): (() => void) => {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    const setSaved = (snapshot: WorkingValue<S>): void => {
      saved = snapshot
      notify()
    }

    const strictReport = (
      snapshot: WorkingValue<S>,
      revision: number
    ): ValidationReport => validateTree(schema, snapshot, revision)

    const requireValid = (
      snapshot: WorkingValue<S>,
      revision: number
    ): Effect.Effect<S['Type'], DraftValidationError> => {
      const decoded = decodeWorkingTree(schema, snapshot)
      return Result.isSuccess(decoded)
        ? Effect.succeed(decoded.success)
        : Effect.fail(
            new DraftValidationError({
              report:
                revision === data.getRevision() &&
                Object.is(snapshot, data.getSnapshot())
                  ? validation.getReport()
                  : strictReport(snapshot, revision),
            })
          )
    }

    const reconcileAuthoritative = (
      base: WorkingValue<S>,
      authoritative: WorkingValue<S>,
      revision: number
    ) =>
      Effect.gen(function* () {
        yield* requireValid(authoritative, revision)
        return yield* Effect.fromResult(
          reconcileTreeSnapshot(data.spec, base, authoritative)
        )
      })

    const reset = Effect.suspend(() =>
      data
        .replace(saved, {
          label: 'Reset draft to saved checkpoint',
          tags: [DraftResetTag],
        })
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setSaved(data.getSnapshot())
            })
          )
        )
    )

    const refresh = (
      authoritative: WorkingValue<S>
    ): Effect.Effect<CommitResult<WorkingSchema<S>>, DraftError> =>
      Effect.gen(function* () {
        if (isDirty()) return yield* new DraftDirtyError()
        const revision = data.getRevision()
        const before = data.getSnapshot()
        const reconciled = yield* reconcileAuthoritative(
          before,
          authoritative,
          revision
        )
        if (reconciled.patchSet.forward.length === 0) {
          if (data.getRevision() !== revision) {
            return yield* new DraftDirtyError()
          }
          setSaved(reconciled.snapshot)
          return {
            _tag: 'NoChange' as const,
            revision,
            snapshot: reconciled.snapshot,
          }
        }
        const result = yield* data
          .apply(
            {
              patches: reconciled.patchSet,
            },
            {
              label: 'Install authoritative draft refresh',
              tags: [DraftRefreshedTag],
              guard: (proposal) =>
                proposal.revisionBefore === revision
                  ? Effect.void
                  : Effect.fail(
                      new DraftRevisionConflict({
                        actual: proposal.revisionBefore,
                        expected: revision,
                      })
                    ),
            }
          )
          .pipe(
            Effect.mapError((error) =>
              error instanceof DraftRevisionConflict
                ? new DraftDirtyError()
                : error
            )
          )
        setSaved(data.getSnapshot())
        return result
      })

    const submit: TreeDraft<S>['submit'] = (request, options) =>
      Effect.gen(function* () {
        const revision = data.getRevision()
        const working = data.getSnapshot()
        const savedAtRequest = saved
        const submitted = yield* requireValid(working, revision)
        const response = yield* Effect.result(
          request({
            submitted,
            working,
            saved: savedAtRequest,
            revision,
          })
        )
        if (Result.isFailure(response)) {
          const authoritative = options?.authoritativeFailure?.(
            response.failure
          )
          if (authoritative !== undefined && Option.isSome(authoritative)) {
            const reconciled = yield* reconcileAuthoritative(
              working,
              authoritative.value,
              revision
            )
            setSaved(reconciled.snapshot)
          }
          return yield* Effect.fail(response.failure)
        }
        const authoritative = response.success
        const reconciled = yield* reconcileAuthoritative(
          working,
          authoritative,
          revision
        )
        const authoritativeSnapshot = reconciled.snapshot

        if (data.getRevision() !== revision) {
          setSaved(authoritativeSnapshot)
          return DraftSynchronizationResult.AcceptedWithPendingChanges({
            authoritative: authoritativeSnapshot,
          })
        }

        if (reconciled.patchSet.forward.length === 0) {
          setSaved(authoritativeSnapshot)
          return DraftSynchronizationResult.Accepted({
            authoritative: authoritativeSnapshot,
          })
        }

        const installed = yield* Effect.result(
          data.apply(
            { patches: reconciled.patchSet },
            {
              label: 'Install accepted authoritative draft',
              tags: [DraftAcceptedTag],
              guard: (proposal) =>
                proposal.revisionBefore === revision
                  ? Effect.void
                  : Effect.fail(
                      new DraftRevisionConflict({
                        actual: proposal.revisionBefore,
                        expected: revision,
                      })
                    ),
            }
          )
        )
        if (Result.isFailure(installed)) {
          if (installed.failure instanceof DraftRevisionConflict) {
            setSaved(authoritativeSnapshot)
            return DraftSynchronizationResult.AcceptedWithPendingChanges({
              authoritative: authoritativeSnapshot,
            })
          }
          return yield* Effect.fail(installed.failure)
        }

        setSaved(data.getSnapshot())
        return DraftSynchronizationResult.Accepted({
          authoritative: data.getSnapshot(),
        })
      })

    const dispose = (): void => {
      if (disposed) return
      disposed = true
      stopObservingData()
      validation.dispose()
      listeners.clear()
    }

    return {
      schema,
      data,
      validation,
      getSaved: () => saved,
      getValidated: validation.getValidated,
      isDirty,
      getSnapshot: getState,
      subscribe,
      changes: Stream.callback((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            Queue.offerUnsafe(queue, getState())
            return subscribe(() => Queue.offerUnsafe(queue, getState()))
          }),
          (unsubscribe) => Effect.sync(unsubscribe)
        )
      ),
      reset,
      refresh,
      submit,
      dispose,
    }
  })

/** Allocates a validated draft for the surrounding Effect Scope. */
export const makeDraftScoped = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  initial: unknown,
  options: TreeSpecOptions = {}
): Effect.Effect<TreeDraft<S>, TreeInvariantError, Scope.Scope> =>
  Effect.acquireRelease(makeDraft(schema, initial, options), (draft) =>
    Effect.sync(draft.dispose).pipe(Effect.andThen(draft.data.shutdown))
  )
