import {
  applyTreePatches,
  buildEntityIndex,
  type EntityIdentity,
  type EntityIndex,
  entityKey,
  getAtPath,
  identityAt,
  type TreePatch,
  type TreePatchError,
  type TreePath,
  type TreeSpec,
  type TreeValue,
} from '@effect-state-tree/core'
import type { ChangeSet, SemanticOperation } from '@effect-state-tree/producer'
import type {
  ChangeEnvelope,
  ProposedCommit,
  SourceToken,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import {
  type Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  HashSet,
  Queue,
  Result,
  type Schema,
  type Scope,
  Stream,
} from 'effect'
import { samePath } from './json'

/** Commit tag applied when authoritative CRDT state enters the tree. */
export const CrdtInboundTag = 'crdt.inbound' as const
/** Commit tag preventing a tree change from being broadcast to a CRDT. */
export const CrdtSkipTag = 'crdt.skip' as const

/** Optional backend-native causal metadata retained on inbound commits. */
export interface CausalMetadata {
  /** Backend-native logical or Lamport clock. */
  readonly clock?: unknown
  /** Backend-native peer or actor identifier. */
  readonly peer?: string
  /** Backend-native version vector or equivalent causal frontier. */
  readonly vector?: unknown
}

/**
 * Signals that the authoritative CRDT document changed.
 *
 * Notifications intentionally carry no snapshot. The serialized coordinator
 * rereads the backend after dequeuing each notification, which prevents a
 * delayed observer payload from overwriting newer local or remote operations.
 */
export interface InboundCrdtNotification {
  /** Provenance token identifying the adapter that observed the change. */
  readonly source: SourceToken
  /** Optional backend-native causality retained on the resulting commit. */
  readonly causality?: CausalMetadata
}

/** Schema-coded document adapter consumed by the serialized CRDT binding. */
export interface CrdtAdapter<
  S extends Schema.Constraint,
  E = never,
  R = never,
> {
  /** Compiled tree Schema used for document encoding and decoding. */
  readonly spec: TreeSpec<S>
  /** Adapter provenance token used to suppress its own inbound commits. */
  readonly source: SourceToken
  /** Completes only after the document observer has been installed. */
  readonly ready: Effect.Effect<void, E, R>
  /** Backend notifications that cause the coordinator to reread the document. */
  readonly changes: Stream.Stream<InboundCrdtNotification, E, R>
  /** Reads the current authoritative document value. */
  readonly readSnapshot: Effect.Effect<TreeValue<S>, E, R>
  /** Replaces the authoritative document with one complete tree snapshot. */
  readonly writeSnapshot: (snapshot: TreeValue<S>) => Effect.Effect<void, E, R>
  /** Applies one local tree commit using semantic operations when possible. */
  readonly applyCommit: (commit: ChangeEnvelope<S>) => Effect.Effect<void, E, R>
}

/** Direction of initial synchronization when attaching a binding. */
export type CrdtInitialization = 'backend' | 'store' | 'none'
/** Supervised worker whose failure terminated a live CRDT binding. */
export type CrdtWorker = 'inbound' | 'coordinator'

/** Describes the first terminal failure of a supervised CRDT worker. */
export class CrdtBindingError<E = unknown> extends Data.TaggedError(
  'CrdtBindingError'
)<{
  readonly worker: CrdtWorker
  readonly reason: 'failed' | 'ended'
  readonly cause: Cause.Cause<E> | undefined
}> {}

/** Supervised lifecycle state reported by a live CRDT binding. */
export type CrdtBindingHealth<E> =
  | { readonly _tag: 'Starting' }
  | {
      readonly _tag: 'Running'
      readonly queued: number
      readonly pendingLocal: number
    }
  | { readonly _tag: 'Failed'; readonly failure: CrdtBindingError<E> }
  | { readonly _tag: 'Shutdown' }

/** Supervised handle for serialized inbound and outbound CRDT coordination. */
export interface CrdtBinding<E = never> {
  /** Supervised worker receiving backend notifications. */
  readonly inbound: Fiber.Fiber<void, unknown>
  /** Supervised worker serializing local and inbound synchronization. */
  readonly coordinator: Fiber.Fiber<void, unknown>
  /** Waits until both workers and the adapter observer are installed. */
  readonly ready: Effect.Effect<void, CrdtBindingError<E>>
  /** Waits until every currently queued notification and local commit settles. */
  readonly idle: Effect.Effect<void, CrdtBindingError<E>>
  /** Waits for and returns the first terminal worker failure. */
  readonly failure: Effect.Effect<CrdtBindingError<E>>
  /** Waits for graceful shutdown or fails with the terminal worker error. */
  readonly await: Effect.Effect<void, CrdtBindingError<E>>
  /** Reads the current supervised lifecycle state. */
  readonly health: Effect.Effect<CrdtBindingHealth<E>>
  /** Idempotently stops workers, subscriptions, and adapter observation. */
  readonly shutdown: Effect.Effect<void>
}

type CrdtWork<S extends Schema.Constraint> =
  | { readonly _tag: 'Inbound'; readonly notification: InboundCrdtNotification }
  | { readonly _tag: 'Outbound'; readonly commit: ChangeEnvelope<S> }

class ProjectionRevisionChanged extends Data.TaggedError(
  'ProjectionRevisionChanged'
)<{
  readonly expected: number
  readonly actual: number
}> {}

/** A positional change could not be safely relocated after a CRDT reorder. */
export class CrdtRebaseError extends Data.TaggedError('CrdtRebaseError')<{
  readonly reason: 'entity-missing' | 'entity-range-changed'
  readonly path: TreePath
  readonly identity: EntityIdentity
}> {}

type RebaseError = TreePatchError | CrdtRebaseError | TreeStoreShutdownError

const shouldBroadcast = <S extends Schema.Constraint>(
  commit: ChangeEnvelope<S>,
  source: SourceToken
): boolean => commit.source !== source && !HashSet.has(commit.tags, CrdtSkipTag)

const removePending = <S extends Schema.Constraint>(
  pending: Array<ChangeEnvelope<S>>,
  commit: ChangeEnvelope<S>
): void => {
  const index = pending.indexOf(commit)
  if (index !== -1) pending.splice(index, 1)
}

/** Relocates the deepest identifiable ancestor to its authoritative path. */
const relocatePath = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  authored: TreeValue<S>,
  authoritativeIndex: EntityIndex,
  path: TreePath
): Effect.Effect<TreePath, CrdtRebaseError> => {
  for (let depth = path.length; depth > 0; depth -= 1) {
    const prefix = path.slice(0, depth)
    const identity = identityAt(spec, authored, prefix)
    if (identity === undefined) continue
    const current = authoritativeIndex.get(entityKey(identity))
    if (current === undefined) {
      return Effect.fail(
        new CrdtRebaseError({ reason: 'entity-missing', path, identity })
      )
    }
    return Effect.succeed([...current.path, ...path.slice(depth)])
  }
  return Effect.succeed(path)
}

const relocatePatch = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  authored: TreeValue<S>,
  authoritativeIndex: EntityIndex,
  patch: TreePatch
): Effect.Effect<TreePatch, CrdtRebaseError> =>
  Effect.map(
    relocatePath(spec, authored, authoritativeIndex, patch.path),
    (path): TreePatch =>
      patch.op === 'remove'
        ? { op: 'remove', path }
        : { op: patch.op, path, value: patch.value }
  )

const relocateMoveFrom = (
  authoritative: unknown,
  authoritativeIndex: EntityIndex,
  operation: Extract<SemanticOperation, { readonly _tag: 'ArrayMove' }>,
  path: TreePath
): Effect.Effect<number, CrdtRebaseError> => {
  if (operation.entities.length !== operation.count)
    return Effect.succeed(operation.from)
  const firstIdentity = operation.entities[0]
  if (firstIdentity === undefined) return Effect.succeed(operation.from)

  const indexes: Array<number> = []
  for (const identity of operation.entities) {
    const current = authoritativeIndex.get(entityKey(identity))
    const parent = current?.path.slice(0, -1)
    const index = current?.path[current.path.length - 1]
    if (
      current === undefined ||
      parent === undefined ||
      !samePath(parent, path) ||
      typeof index !== 'number'
    ) {
      return Effect.fail(
        new CrdtRebaseError({ reason: 'entity-missing', path, identity })
      )
    }
    indexes.push(index)
  }

  const from = indexes[0]
  if (
    from === undefined ||
    indexes.some((index, offset) => index !== from + offset)
  ) {
    return Effect.fail(
      new CrdtRebaseError({
        reason: 'entity-range-changed',
        path,
        identity: firstIdentity,
      })
    )
  }

  const target = getAtPath(authoritative, path)
  if (Result.isFailure(target) || !Array.isArray(target.success)) {
    return Effect.fail(
      new CrdtRebaseError({
        reason: 'entity-range-changed',
        path,
        identity: firstIdentity,
      })
    )
  }
  return Effect.succeed(from)
}

const relocateOperation = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  authored: TreeValue<S>,
  authoritative: TreeValue<S>,
  authoritativeIndex: EntityIndex,
  operation: SemanticOperation
): Effect.Effect<SemanticOperation, CrdtRebaseError> =>
  Effect.flatMap(
    relocatePath(spec, authored, authoritativeIndex, operation.path),
    (path) => {
      if (operation._tag !== 'ArrayMove')
        return Effect.succeed({ ...operation, path })
      return Effect.map(
        relocateMoveFrom(authoritative, authoritativeIndex, operation, path),
        (from): SemanticOperation => ({ ...operation, path, from })
      )
    }
  )

const rebaseCommit = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  commit: ChangeEnvelope<S>,
  base: TreeValue<S>
): Effect.Effect<ChangeEnvelope<S>, RebaseError> =>
  Effect.gen(function* () {
    const indexed = buildEntityIndex(spec, base)
    if (Result.isFailure(indexed)) return yield* Effect.fail(indexed.failure)

    const forward = yield* Effect.forEach(
      commit.change.patches.forward,
      (patch) => relocatePatch(spec, commit.before, indexed.success, patch)
    )
    const operations = yield* Effect.forEach(
      commit.change.operations,
      (operation) =>
        relocateOperation(spec, commit.before, base, indexed.success, operation)
    )

    const applied = applyTreePatches(spec, base, forward)
    if (Result.isFailure(applied)) return yield* Effect.fail(applied.failure)

    return {
      ...commit,
      before: base,
      after: applied.success.snapshot,
      change: {
        ...commit.change,
        patches: applied.success.patchSet,
        operations,
      } satisfies ChangeSet,
      touchedPaths: applied.success.touchedPaths,
    }
  })

const projectPending = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  authoritative: TreeValue<S>,
  pending: ReadonlyArray<ChangeEnvelope<S>>
): Effect.Effect<TreeValue<S>, RebaseError> =>
  Effect.gen(function* () {
    let snapshot = authoritative
    for (const commit of pending) {
      const rebased = yield* rebaseCommit(spec, commit, snapshot)
      snapshot = rebased.after
    }
    return snapshot
  })

const synchronizeStore = <S extends Schema.Constraint>(
  store: TreeStore<S>,
  adapter: CrdtAdapter<S, unknown, unknown>,
  authoritative: TreeValue<S>,
  pending: ReadonlyArray<ChangeEnvelope<S>>,
  causality?: CausalMetadata
): Effect.Effect<void, RebaseError> => {
  const attempt: Effect.Effect<void, RebaseError> = Effect.suspend(() => {
    const expectedRevision = store.getRevision()
    const pendingAtRevision = Array.from(pending)

    return Effect.flatMap(
      projectPending(store.spec, authoritative, pendingAtRevision),
      (projected) =>
        store
          .replace(projected, {
            source: adapter.source,
            tags: [CrdtInboundTag, 'history.skip'],
            ...(causality !== undefined ? { metadata: causality } : {}),
            guard: (proposal: ProposedCommit<S>) =>
              proposal.revisionBefore === expectedRevision
                ? Effect.void
                : Effect.fail(
                    new ProjectionRevisionChanged({
                      expected: expectedRevision,
                      actual: proposal.revisionBefore,
                    })
                  ),
          })
          .pipe(
            Effect.asVoid,
            Effect.catchTag('ProjectionRevisionChanged', () => attempt)
          )
    )
  })

  return attempt
}

type BindingError<E> = E | RebaseError

/**
 * Connects a tree store to a CRDT adapter through one serialized work lane.
 *
 * Every worker is supervised. The first unexpected completion or failure
 * closes the queue, unsubscribes the store, interrupts sibling fibers, and is
 * exposed through `failure`, `health`, `idle`, and `await`.
 */
export const bindCrdt = <S extends Schema.Constraint, E, R>(
  store: TreeStore<S>,
  adapter: CrdtAdapter<S, E, R>,
  options: { readonly initialize?: CrdtInitialization } = {}
): Effect.Effect<
  CrdtBinding<BindingError<E>>,
  | E
  | TreePatchError
  | TreeStoreShutdownError
  | CrdtBindingError<BindingError<E>>,
  R | Scope.Scope
> =>
  Effect.gen(function* () {
    const initialize = options.initialize ?? 'backend'
    const work = yield* Queue.unbounded<CrdtWork<S>>()
    const readySignal = yield* Deferred.make<
      void,
      CrdtBindingError<BindingError<E>>
    >()
    const coordinatorReady = yield* Deferred.make<void>()
    const failureSignal =
      yield* Deferred.make<CrdtBindingError<BindingError<E>>>()
    const terminated = yield* Deferred.make<
      void,
      CrdtBindingError<BindingError<E>>
    >()
    const pending: Array<ChangeEnvelope<S>> = []

    let health: CrdtBindingHealth<BindingError<E>> = { _tag: 'Starting' }
    let queued = 0
    let stopped = false
    let idleSignal = Deferred.makeUnsafe<
      void,
      CrdtBindingError<BindingError<E>>
    >()
    Deferred.doneUnsafe(idleSignal, Effect.void)

    const markQueued = (): void => {
      if (queued === 0) {
        idleSignal = Deferred.makeUnsafe()
      }
      queued += 1
      if (health._tag === 'Running') {
        health = { _tag: 'Running', queued, pendingLocal: pending.length }
      }
    }

    const markSettled = (): void => {
      queued = Math.max(0, queued - 1)
      if (queued === 0) Deferred.doneUnsafe(idleSignal, Effect.void)
      if (health._tag === 'Running') {
        health = { _tag: 'Running', queued, pendingLocal: pending.length }
      }
    }

    const enqueue = (item: CrdtWork<S>): boolean => {
      if (stopped) return false
      markQueued()
      if (Queue.offerUnsafe(work, item)) return true
      markSettled()
      return false
    }

    let unsubscribe = (): void => undefined

    let inbound: Fiber.Fiber<void, unknown> | undefined
    let coordinator: Fiber.Fiber<void, unknown> | undefined
    let supervisor: Fiber.Fiber<void, unknown> | undefined

    const workerFailure = <WorkerError>(
      worker: CrdtWorker,
      exit: Exit.Exit<void, WorkerError>
    ): Effect.Effect<void> => {
      if (stopped) return Effect.void
      const failure = new CrdtBindingError<BindingError<E>>({
        worker,
        reason: Exit.isFailure(exit) ? 'failed' : 'ended',
        cause: Exit.isFailure(exit)
          ? (exit.cause as Cause.Cause<BindingError<E>>)
          : undefined,
      })
      return Deferred.succeed(failureSignal, failure).pipe(Effect.asVoid)
    }

    const coordinate = (
      item: CrdtWork<S>
    ): Effect.Effect<void, BindingError<E>, R> => {
      if (item._tag === 'Inbound') {
        return Effect.flatMap(adapter.readSnapshot, (authoritative) =>
          synchronizeStore(
            store,
            adapter,
            authoritative,
            pending,
            item.notification.causality
          )
        )
      }

      return Effect.gen(function* () {
        const before = yield* adapter.readSnapshot
        const rebased = yield* rebaseCommit(store.spec, item.commit, before)
        yield* adapter.applyCommit(rebased)
        yield* Effect.sync(() => removePending(pending, item.commit))

        const authoritative = yield* adapter.readSnapshot
        yield* synchronizeStore(store, adapter, authoritative, pending)
      })
    }

    const inboundEffect = Stream.runForEach(adapter.changes, (notification) =>
      Effect.sync(() => {
        enqueue({ _tag: 'Inbound', notification })
      })
    ).pipe(Effect.onExit((exit) => workerFailure('inbound', exit)))

    const coordinatorEffect = Effect.gen(function* () {
      yield* Deferred.succeed(coordinatorReady, undefined)
      yield* Effect.forever(
        Effect.flatMap(Queue.take(work), (item) =>
          coordinate(item).pipe(Effect.ensuring(Effect.sync(markSettled)))
        )
      )
    }).pipe(Effect.onExit((exit) => workerFailure('coordinator', exit)))

    const failWhenWorkerFails = Deferred.await(failureSignal).pipe(
      Effect.flatMap((failure) => Effect.fail(failure))
    )

    // Observe first so a document update racing initial snapshot IO is queued
    // and reconciled by the coordinator instead of being lost indefinitely.
    inbound = yield* Effect.forkScoped(inboundEffect, {
      startImmediately: true,
    })
    yield* Effect.raceFirst(adapter.ready, failWhenWorkerFails)

    unsubscribe = store.subscribe((commit) => {
      if (!shouldBroadcast(commit, adapter.source) || stopped) return
      pending.push(commit)
      if (!enqueue({ _tag: 'Outbound', commit })) removePending(pending, commit)
    })
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))

    const initializeBinding =
      initialize === 'backend'
        ? Effect.flatMap(adapter.readSnapshot, (snapshot) =>
            store.replace(snapshot, {
              source: adapter.source,
              tags: [CrdtInboundTag, 'history.skip'],
              label: 'Initialize from CRDT',
            })
          )
        : initialize === 'store'
          ? adapter.writeSnapshot(store.getSnapshot())
          : Effect.void
    yield* Effect.raceFirst(initializeBinding, failWhenWorkerFails)
    if (initialize !== 'none') {
      enqueue({
        _tag: 'Inbound',
        notification: { source: adapter.source },
      })
    }

    coordinator = yield* Effect.forkScoped(coordinatorEffect, {
      startImmediately: true,
    })

    const stopAfterFailure = Effect.gen(function* () {
      const failure = yield* Deferred.await(failureSignal)
      if (stopped) return
      stopped = true
      health = { _tag: 'Failed', failure }
      unsubscribe()
      pending.length = 0
      yield* Deferred.fail(readySignal, failure)
      yield* Deferred.fail(idleSignal, failure)
      yield* Queue.shutdown(work)
      if (inbound !== undefined) yield* Fiber.interrupt(inbound)
      if (coordinator !== undefined) yield* Fiber.interrupt(coordinator)
      yield* Deferred.fail(terminated, failure)
    })
    supervisor = yield* Effect.forkScoped(stopAfterFailure, {
      startImmediately: true,
    })

    yield* Effect.raceFirst(
      Deferred.await(coordinatorReady),
      failWhenWorkerFails
    )
    health = { _tag: 'Running', queued, pendingLocal: pending.length }
    yield* Deferred.succeed(readySignal, undefined)

    const shutdown = Effect.suspend(() => {
      if (stopped) return Effect.void
      stopped = true
      health = { _tag: 'Shutdown' }
      unsubscribe()
      pending.length = 0
      Deferred.doneUnsafe(idleSignal, Effect.void)
      return Queue.shutdown(work).pipe(
        Effect.andThen(
          Effect.all([
            inbound === undefined ? Effect.void : Fiber.interrupt(inbound),
            coordinator === undefined
              ? Effect.void
              : Fiber.interrupt(coordinator),
            supervisor === undefined
              ? Effect.void
              : Fiber.interrupt(supervisor),
          ])
        ),
        Effect.andThen(Deferred.succeed(terminated, undefined)),
        Effect.asVoid
      )
    })

    yield* Effect.addFinalizer(() => shutdown)

    return {
      inbound,
      coordinator,
      ready: Deferred.await(readySignal),
      idle: Effect.suspend(() => {
        if (health._tag === 'Failed') return Effect.fail(health.failure)
        if (health._tag === 'Shutdown' || queued === 0) return Effect.void
        return Deferred.await(idleSignal)
      }),
      failure: Deferred.await(failureSignal),
      await: Deferred.await(terminated),
      health: Effect.sync(() => health),
      shutdown,
    }
  })
