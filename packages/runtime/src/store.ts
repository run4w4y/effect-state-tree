import type {
  GetAtPathFailure,
  PatchSet,
  SnapshotOptions,
  TreeInvariantError,
  TreePatch,
  TreePath,
  TreeSpec,
  TreeValidationPhase,
  TreeValue,
} from '@effect-state-tree/core'
import {
  applyTreePatches,
  captureSnapshot,
  captureTreeSnapshot,
  pathsOverlap,
  reconcileTreeSnapshot,
  snapshotOptionsFor,
} from '@effect-state-tree/core'
import {
  type ProducedChange,
  produceTreeChange,
  type SemanticOperation,
} from '@effect-state-tree/producer'
import {
  Clock,
  Effect,
  HashSet,
  Queue,
  Result,
  type Schema,
  type Scope,
  Stream,
  TxPubSub,
  TxQueue,
  TxRef,
} from 'effect'
import {
  makeTreeCheckpoint,
  type TreeCheckpoint,
  type TreeCheckpointError,
  validateTreeCheckpoint,
} from './checkpoint'
import { CurrentCommitContext } from './context'
import { TransactionIds } from './transaction-id'
import type {
  ApplyChangeInput,
  ChangeEnvelope,
  CommitOptions,
  CommitResult,
  ProposedCommit,
  SelectOptions,
  StoreView,
  TreeStore,
  TreeStoreState,
} from './types'
import { TreeStoreShutdownError } from './types'

/** Construction-time defaults and listener-failure reporting for a store. */
export interface TreeStoreOptions {
  /** Receives exceptions thrown by synchronous commit subscribers. */
  readonly onListenerError?: (error: unknown) => void
  /** Default lifecycle phase for commits that do not provide one explicitly. */
  readonly defaultValidationPhase?: TreeValidationPhase
}

const GuardNoChangeTypeId: unique symbol = Symbol(
  '@effect-state-tree/runtime/GuardNoChange'
)

type InternalCommitOptions<S extends Schema.Constraint, E, R> = CommitOptions<
  S,
  E,
  R
> & {
  readonly [GuardNoChangeTypeId]?: true
}

const makeNoChange = <S extends Schema.Constraint>(
  state: TreeStoreState<S>
): CommitResult<S> => ({
  _tag: 'NoChange',
  revision: state.revision,
  snapshot: state.snapshot,
})

const shouldNotifyView = (
  watched: ReadonlyArray<readonly (string | number)[]> | undefined,
  touched: ReadonlyArray<readonly (string | number)[]>
): boolean =>
  watched === undefined ||
  watched.length === 0 ||
  watched.some((dependency) =>
    touched.some((path) => pathsOverlap(dependency, path))
  )

const freezePath = (path: TreePath): TreePath => Object.freeze([...path])

const freezePatch = (patch: TreePatch): TreePatch =>
  Object.freeze({
    ...patch,
    path: freezePath(patch.path),
  })

const freezePatchSet = (patches: PatchSet): PatchSet =>
  Object.freeze({
    forward: Object.freeze(patches.forward.map(freezePatch)),
    inverse: Object.freeze(patches.inverse.map(freezePatch)),
  })

const freezeOperation = (operation: SemanticOperation): SemanticOperation => {
  const path = freezePath(operation.path)
  switch (operation._tag) {
    case 'ArraySplice':
      return Object.freeze({
        ...operation,
        path,
        inserted: Object.freeze([...operation.inserted]),
        removed: Object.freeze([...operation.removed]),
      })
    case 'ArrayMove':
      return Object.freeze({
        ...operation,
        path,
        entities: Object.freeze([...operation.entities]),
      })
    default:
      return Object.freeze({ ...operation, path })
  }
}

const freezeChange = (
  change: ProducedChange<unknown>['change']
): ProducedChange<unknown>['change'] =>
  Object.freeze({
    patches: freezePatchSet(change.patches),
    operations: Object.freeze(change.operations.map(freezeOperation)),
    inverseOperations: Object.freeze(
      change.inverseOperations.map(freezeOperation)
    ),
  })

const captureMetadata = (value: unknown, options: SnapshotOptions): unknown => {
  const captured = captureSnapshot(value, options)
  if (Result.isSuccess(captured)) return captured.success
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => captureMetadata(item, options)))
  }
  if (value === null || typeof value !== 'object') return value
  if (value instanceof ArrayBuffer) {
    return Object.freeze(Array.from(new Uint8Array(value.slice(0))))
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength
    )
    return Object.freeze(Array.from(bytes))
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  const output: Record<string, unknown> = Object.create(prototype)
  for (const [key, item] of Object.entries(value))
    output[key] = captureMetadata(item, options)
  return Object.freeze(output)
}

/**
 * Allocates an Effect v4 transactional store around an admitted tree snapshot.
 * Use `makeTreeStoreScoped` when the owner has an explicit Effect Scope.
 */
export const makeTreeStore = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  initial: TreeValue<S>,
  options: TreeStoreOptions = {}
): Effect.Effect<TreeStore<S>, TreeInvariantError> =>
  Effect.gen(function* () {
    const admitted = yield* Effect.fromResult(
      captureTreeSnapshot(spec, initial)
    )
    const stateRef = yield* TxRef.make<TreeStoreState<S>>({
      snapshot: admitted.snapshot,
      revision: 0,
    })
    const commitHub = yield* TxPubSub.unbounded<ChangeEnvelope<S>>()
    const listeners = new Set<(commit: ChangeEnvelope<S>) => void>()
    const storeIdentity = Object.freeze({})
    const pendingNotifications = new Map<number, ChangeEnvelope<S>>()
    let lastNotifiedRevision = 0
    let isFlushingNotifications = false
    let closed = false

    const commits = Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* TxPubSub.subscribe(commitHub)
        if (yield* TxPubSub.isShutdown(commitHub))
          yield* TxQueue.shutdown(queue)
        return Stream.fromEffectRepeat(Effect.tx(TxQueue.take(queue)))
      })
    )

    const flushNotifications = (commit: ChangeEnvelope<S>): void => {
      pendingNotifications.set(commit.revisionAfter, commit)
      if (isFlushingNotifications) return

      isFlushingNotifications = true
      try {
        let next = pendingNotifications.get(lastNotifiedRevision + 1)
        while (next !== undefined) {
          pendingNotifications.delete(next.revisionAfter)
          lastNotifiedRevision = next.revisionAfter
          for (const listener of listeners) {
            try {
              listener(next)
            } catch (error) {
              options.onListenerError?.(error)
            }
          }
          next = pendingNotifications.get(lastNotifiedRevision + 1)
        }
      } finally {
        isFlushingNotifications = false
      }
    }

    const commitProposal = <BuildError, E, R>(
      build: (
        state: TreeStoreState<S>
      ) => Result.Result<ProducedChange<TreeValue<S>>, BuildError>,
      commitOptions: InternalCommitOptions<S, E, R> = {}
    ): Effect.Effect<
      CommitResult<S>,
      BuildError | TreeStoreShutdownError | E,
      R
    > =>
      Effect.gen(function* () {
        const transactionIds = yield* TransactionIds
        const transactionId = yield* transactionIds.next
        const inherited = yield* CurrentCommitContext
        const tags = HashSet.union(
          inherited.tags,
          HashSet.fromIterable(commitOptions.tags ?? [])
        )
        const label = commitOptions.label ?? inherited.label
        const metadata = captureMetadata(
          commitOptions.metadata ?? inherited.metadata,
          snapshotOptionsFor(spec)
        )
        const source = commitOptions.source ?? inherited.source
        const action = inherited.action
        const validationPhase =
          commitOptions.validationPhase ??
          inherited.validationPhase ??
          options.defaultValidationPhase ??
          'treeMutation'

        const attempt: Effect.Effect<
          CommitResult<S>,
          BuildError | TreeStoreShutdownError | E,
          R
        > = Effect.suspend(() =>
          Effect.gen(function* () {
            const beforeState = yield* Effect.tx(
              Effect.gen(function* () {
                if (yield* TxPubSub.isShutdown(commitHub)) {
                  return yield* Effect.fail(new TreeStoreShutdownError())
                }
                return yield* TxRef.get(stateRef)
              })
            )
            const result = yield* Effect.fromResult(build(beforeState))
            if (
              result.change.patches.forward.length === 0 &&
              commitOptions[GuardNoChangeTypeId] !== true
            ) {
              return makeNoChange(beforeState)
            }
            const change = freezeChange(result.change)
            const touchedPaths = Object.freeze(
              result.touchedPaths.map(freezePath)
            )
            const proposal: ProposedCommit<S> = Object.freeze({
              transactionId,
              revisionBefore: beforeState.revision,
              before: beforeState.snapshot,
              after: result.snapshot,
              change,
              touchedPaths,
              tags,
              validationPhase,
              ...(label !== undefined ? { label } : {}),
              ...(metadata !== undefined ? { metadata } : {}),
              ...(source !== undefined ? { source } : {}),
              ...(action !== undefined ? { action } : {}),
            })
            if (commitOptions.guard !== undefined)
              yield* commitOptions.guard(proposal)

            if (change.patches.forward.length === 0) {
              const outcome = yield* Effect.tx(
                Effect.gen(function* () {
                  if (yield* TxPubSub.isShutdown(commitHub)) return 'shutdown'
                  const current = yield* TxRef.get(stateRef)
                  return current.revision === beforeState.revision
                    ? 'current'
                    : 'retry'
                })
              )
              if (outcome === 'shutdown') {
                return yield* Effect.fail(new TreeStoreShutdownError())
              }
              if (outcome === 'retry') return yield* attempt
              return makeNoChange(beforeState)
            }

            const committedAt = yield* Clock.currentTimeMillis
            const envelope: ChangeEnvelope<S> = Object.freeze({
              ...proposal,
              revisionAfter: beforeState.revision + 1,
              committedAt,
            })

            const outcome = yield* Effect.uninterruptible(
              Effect.flatMap(
                Effect.tx(
                  Effect.gen(function* () {
                    if (yield* TxPubSub.isShutdown(commitHub))
                      return 'shutdown' as const
                    const current = yield* TxRef.get(stateRef)
                    if (current.revision !== beforeState.revision)
                      return 'retry' as const
                    yield* TxRef.set(stateRef, {
                      snapshot: result.snapshot,
                      revision: envelope.revisionAfter,
                    })
                    yield* TxPubSub.publish(commitHub, envelope)
                    return 'committed' as const
                  })
                ),
                (status) =>
                  status === 'committed'
                    ? Effect.as(
                        Effect.sync(() => flushNotifications(envelope)),
                        status
                      )
                    : Effect.succeed(status)
              )
            )

            if (outcome === 'shutdown') {
              return yield* Effect.fail(new TreeStoreShutdownError())
            }
            if (outcome === 'retry') return yield* attempt
            return { _tag: 'Committed', commit: envelope }
          })
        )

        return yield* attempt
      })

    const checkpointOptions = <P extends TreePath, E, R>(
      checkpoint: TreeCheckpoint<S, P>,
      commitOptions: CommitOptions<S, E, R> = {}
    ): InternalCommitOptions<S, TreeCheckpointError | E, R> => ({
      ...commitOptions,
      [GuardNoChangeTypeId]: true,
      guard: (proposal) =>
        Effect.flatMap(
          Effect.fromResult(
            validateTreeCheckpoint(storeIdentity, checkpoint, proposal)
          ),
          () => commitOptions.guard?.(proposal) ?? Effect.void
        ),
    })

    function checkpoint(): Effect.Effect<
      TreeCheckpoint<S, readonly []>,
      GetAtPathFailure
    >
    function checkpoint<const P extends TreePath>(
      path: P
    ): Effect.Effect<TreeCheckpoint<S, P>, GetAtPathFailure>
    function checkpoint(path: TreePath = []) {
      return Effect.flatMap(TxRef.get(stateRef), (state) =>
        Effect.fromResult(
          makeTreeCheckpoint(
            storeIdentity,
            state.snapshot,
            state.revision,
            path
          )
        )
      )
    }

    const store: TreeStore<S> = {
      spec,
      get: Effect.map(TxRef.get(stateRef), (state) => state.snapshot),
      getState: TxRef.get(stateRef),
      getSnapshot: () => stateRef.value.snapshot,
      getRevision: () => stateRef.value.revision,
      isShutdown: TxPubSub.isShutdown(commitHub),
      shutdown: Effect.uninterruptible(
        Effect.flatMap(TxPubSub.shutdown(commitHub), () =>
          Effect.sync(() => {
            closed = true
            listeners.clear()
            pendingNotifications.clear()
          })
        )
      ),
      commits,
      subscribe(listener) {
        if (closed) return () => undefined
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      checkpoint,
      update(recipe, commitOptions) {
        return commitProposal(
          (state) => produceTreeChange(spec, state.snapshot, recipe),
          commitOptions
        )
      },
      apply(change: ApplyChangeInput, commitOptions) {
        return commitProposal(
          (state) =>
            Result.map(
              applyTreePatches(spec, state.snapshot, change.patches.forward),
              (applied) => ({
                snapshot: applied.snapshot,
                change: {
                  patches: applied.patchSet,
                  operations: change.operations ?? [],
                  inverseOperations: change.inverseOperations ?? [],
                },
                touchedPaths: applied.touchedPaths,
              })
            ),
          commitOptions
        )
      },
      replace(snapshot, commitOptions) {
        return commitProposal(
          (state) =>
            Result.map(
              reconcileTreeSnapshot(spec, state.snapshot, snapshot),
              (reconciled) => ({
                snapshot: reconciled.snapshot,
                change: {
                  patches: reconciled.patchSet,
                  operations: [],
                  inverseOperations: [],
                },
                touchedPaths: reconciled.touchedPaths,
              })
            ),
          commitOptions
        )
      },
      updateIfCurrent(checkpoint, recipe, commitOptions) {
        return store.update(
          recipe,
          checkpointOptions(checkpoint, commitOptions)
        )
      },
      applyIfCurrent(checkpoint, change, commitOptions) {
        return store.apply(change, checkpointOptions(checkpoint, commitOptions))
      },
      replaceAtCheckpoint(checkpoint, value, commitOptions) {
        return store.applyIfCurrent(
          checkpoint,
          {
            patches: {
              forward: [{ op: 'replace', path: checkpoint.path, value }],
              inverse: [],
            },
          },
          commitOptions
        )
      },
      select<A>(
        selector: (snapshot: TreeValue<S>) => A,
        selectOptions: SelectOptions<A> = {}
      ): StoreView<A> {
        const equals = selectOptions.equals ?? Object.is
        let cachedRevision = -1
        let cached: A

        const getSnapshot = (): A => {
          const state = stateRef.value
          if (cachedRevision !== state.revision) {
            const next = selector(state.snapshot)
            if (cachedRevision === -1 || !equals(cached, next)) cached = next
            cachedRevision = state.revision
          }
          return cached
        }

        const observe = (
          listener: (value: A) => void,
          emitInitial: boolean
        ): (() => void) => {
          let previous = getSnapshot()
          if (emitInitial) listener(previous)
          return store.subscribe((commit) => {
            if (!shouldNotifyView(selectOptions.paths, commit.touchedPaths))
              return
            const next = getSnapshot()
            if (equals(previous, next)) return
            previous = next
            listener(next)
          })
        }

        return {
          getSnapshot,
          subscribe(listener) {
            return observe(() => listener(), false)
          },
          changes: Stream.callback<A>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() =>
                observe((value) => {
                  Queue.offerUnsafe(queue, value)
                }, true)
              ),
              (unsubscribe) => Effect.sync(unsubscribe)
            )
          ),
        }
      },
    }

    return store
  })

/**
 * Allocates a TreeStore whose commit stream and synchronous subscriptions are
 * closed with the surrounding Effect Scope.
 */
export const makeTreeStoreScoped = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  initial: TreeValue<S>,
  options: TreeStoreOptions = {}
): Effect.Effect<TreeStore<S>, TreeInvariantError, Scope.Scope> =>
  Effect.gen(function* () {
    const store = yield* makeTreeStore(spec, initial, options)
    yield* Effect.addFinalizer(() => store.shutdown)
    return store
  })

/** Runs an effectful sink once for each committed change until the store closes. */
export const runCommitSink = <S extends Schema.Constraint, E, R>(
  store: TreeStore<S>,
  sink: (commit: ChangeEnvelope<S>) => Effect.Effect<void, E, R>
): Effect.Effect<void, E, R> => Stream.runForEach(store.commits, sink)
