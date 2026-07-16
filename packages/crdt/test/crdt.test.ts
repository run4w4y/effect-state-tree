import { describe, expect, it } from 'bun:test'
import { entity, makeTreeSpec, type TreeValue } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Data, Deferred, Effect, PubSub, Queue, Schema, Stream } from 'effect'
import {
  bindCrdt,
  type CrdtAdapter,
  type InboundCrdtNotification,
} from '../src/index'

const State = Schema.Struct({ count: Schema.Number })
const spec = makeTreeSpec(State)

const ConcurrentState = Schema.Struct({
  local: Schema.Number,
  remote: Schema.Number,
})
type ConcurrentValue = TreeValue<typeof ConcurrentState>
const concurrentSpec = makeTreeSpec(ConcurrentState)

const Item = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).pipe(entity({ type: 'Item', id: 'id' }))
const EntityState = Schema.Struct({
  items: Schema.Array(Item),
})
type EntityValue = TreeValue<typeof EntityState>
const entitySpec = makeTreeSpec(EntityState)

class FakeAdapterError extends Data.TaggedError('FakeAdapterError')<{
  readonly message: string
}> {}

const waitUntil = (condition: () => boolean): Effect.Effect<void> =>
  Effect.suspend(() =>
    condition()
      ? Effect.void
      : Effect.andThen(Effect.yieldNow, waitUntil(condition))
  )

describe('CRDT binding', () => {
  it('forwards commits once and suppresses inbound echoes by source token', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const inbound = yield* PubSub.unbounded<InboundCrdtNotification>()
          const source = { adapter: 'fake' }
          const outbound: Array<number> = []
          const snapshots: Array<number> = []
          let backend = { count: 0 }

          const adapter: CrdtAdapter<typeof State> = {
            spec,
            source,
            ready: Effect.void,
            changes: Stream.fromPubSub(inbound),
            readSnapshot: Effect.sync(() => backend),
            writeSnapshot: (snapshot) =>
              Effect.sync(() => {
                backend = snapshot
                snapshots.push(snapshot.count)
              }),
            applyCommit: (commit) =>
              Effect.sync(() => {
                backend = commit.after
                outbound.push(commit.after.count)
              }),
          }

          yield* bindCrdt(store, adapter, { initialize: 'none' })
          yield* store.update((state) => {
            state.count = 1
          })
          yield* waitUntil(() => backend.count === 1)

          backend = { count: 2 }
          yield* PubSub.publish(inbound, {
            source,
          })
          yield* waitUntil(() => store.getSnapshot().count === 2)

          return {
            count: store.getSnapshot().count,
            outbound,
            snapshots,
          }
        })
      )
    )

    expect(result.count).toBe(2)
    expect(result.outbound).toEqual([1])
    expect(result.snapshots).toEqual([])
  })

  it('ignores a queued stale capture after the local commit reached the backend', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(concurrentSpec, {
            local: 0,
            remote: 0,
          })
          const inbound = yield* PubSub.unbounded<InboundCrdtNotification>()
          const source = { adapter: 'queued-stale' }
          let backend: ConcurrentValue = { local: 0, remote: 0 }
          let reads = 0

          const adapter: CrdtAdapter<typeof ConcurrentState> = {
            spec: concurrentSpec,
            source,
            ready: Effect.void,
            changes: Stream.fromPubSub(inbound),
            readSnapshot: Effect.sync(() => {
              reads += 1
              return backend
            }),
            writeSnapshot: (snapshot) =>
              Effect.sync(() => {
                backend = snapshot
              }),
            // Deliberately naïve: the binding must give the adapter a rebased
            // `after`, otherwise this assignment loses the remote field.
            applyCommit: (commit) =>
              Effect.sync(() => {
                backend = commit.after
              }),
          }

          yield* bindCrdt(store, adapter, { initialize: 'none' })

          backend = { local: 0, remote: 1 }
          yield* store.update((state) => {
            state.local = 1
          })
          yield* waitUntil(() => backend.local === 1 && backend.remote === 1)

          const readsBeforeStaleDelivery = reads
          yield* PubSub.publish(inbound, {
            source,
          })
          yield* waitUntil(() => reads > readsBeforeStaleDelivery)
          yield* Effect.yieldNow

          return {
            backend,
            store: store.getSnapshot(),
          }
        })
      )
    )

    expect(result.backend).toEqual({ local: 1, remote: 1 })
    expect(result.store).toEqual(result.backend)
  })

  it('projects a local edit queued while an inbound refresh is suspended', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(concurrentSpec, {
            local: 0,
            remote: 0,
          })
          const inbound = yield* PubSub.unbounded<InboundCrdtNotification>()
          const source = { adapter: 'inbound-first' }
          const readStarted = yield* Deferred.make<void>()
          const releaseRead = yield* Deferred.make<void>()
          let suspendNextRead = false
          let backend: ConcurrentValue = { local: 0, remote: 0 }

          const adapter: CrdtAdapter<typeof ConcurrentState> = {
            spec: concurrentSpec,
            source,
            ready: Effect.void,
            changes: Stream.fromPubSub(inbound),
            readSnapshot: Effect.gen(function* () {
              if (suspendNextRead) {
                suspendNextRead = false
                yield* Deferred.succeed(readStarted, void 0)
                yield* Deferred.await(releaseRead)
              }
              return backend
            }),
            writeSnapshot: (snapshot) =>
              Effect.sync(() => {
                backend = snapshot
              }),
            applyCommit: (commit) =>
              Effect.sync(() => {
                backend = commit.after
              }),
          }

          yield* bindCrdt(store, adapter, { initialize: 'none' })

          backend = { local: 0, remote: 1 }
          suspendNextRead = true
          yield* PubSub.publish(inbound, {
            source,
          })
          yield* Deferred.await(readStarted)

          // The listener records this as pending even though the coordinator is
          // currently blocked in the inbound lane.
          yield* store.update((state) => {
            state.local = 1
          })
          yield* Deferred.succeed(releaseRead, void 0)

          yield* waitUntil(
            () =>
              backend.local === 1 &&
              backend.remote === 1 &&
              store.getSnapshot().local === 1 &&
              store.getSnapshot().remote === 1
          )

          return {
            backend,
            store: store.getSnapshot(),
          }
        })
      )
    )

    expect(result.backend).toEqual({ local: 1, remote: 1 })
    expect(result.store).toEqual(result.backend)
  })

  it('relocates a queued entity edit after a remote native move', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const original: EntityValue = {
            items: [
              { id: 'a', title: 'A' },
              { id: 'b', title: 'B' },
            ],
          }
          const store = yield* makeTreeStore(entitySpec, original)
          const inbound = yield* PubSub.unbounded<InboundCrdtNotification>()
          const source = { adapter: 'entity-move' }
          const readStarted = yield* Deferred.make<void>()
          const releaseRead = yield* Deferred.make<void>()
          const appliedPaths: Array<ReadonlyArray<string | number>> = []
          let suspendNextRead = false
          let backend: EntityValue = original

          const adapter: CrdtAdapter<typeof EntityState> = {
            spec: entitySpec,
            source,
            ready: Effect.void,
            changes: Stream.fromPubSub(inbound),
            readSnapshot: Effect.gen(function* () {
              if (suspendNextRead) {
                suspendNextRead = false
                yield* Deferred.succeed(readStarted, void 0)
                yield* Deferred.await(releaseRead)
              }
              return backend
            }),
            writeSnapshot: (snapshot) =>
              Effect.sync(() => {
                backend = snapshot
              }),
            applyCommit: (commit) =>
              Effect.sync(() => {
                backend = commit.after
                for (const operation of commit.change.operations) {
                  if (operation._tag === 'ObjectSet')
                    appliedPaths.push(operation.path)
                }
              }),
          }

          yield* bindCrdt(store, adapter, { initialize: 'none' })

          backend = {
            items: [
              { id: 'b', title: 'B' },
              { id: 'a', title: 'A' },
            ],
          }
          suspendNextRead = true
          yield* PubSub.publish(inbound, {
            source,
          })
          yield* Deferred.await(readStarted)

          // Authored against A at index zero while the queued remote snapshot has
          // already moved A to index one.
          yield* store.update((_state, operations) => {
            operations.objectSet(['items', 0], 'title', 'A edited')
          })
          yield* Deferred.succeed(releaseRead, void 0)

          yield* waitUntil(
            () =>
              backend.items[0]?.id === 'b' &&
              backend.items[0]?.title === 'B' &&
              backend.items[1]?.id === 'a' &&
              backend.items[1]?.title === 'A edited' &&
              store.getSnapshot().items[0]?.id === 'b' &&
              store.getSnapshot().items[1]?.title === 'A edited'
          )

          return {
            appliedPaths,
            backend,
            store: store.getSnapshot(),
          }
        })
      )
    )

    expect(result.backend.items).toEqual([
      { id: 'b', title: 'B' },
      { id: 'a', title: 'A edited' },
    ])
    expect(result.store).toEqual(result.backend)
    expect(result.appliedPaths).toEqual([['items', 1]])
  })

  it('does not lose a document update racing backend initialization', async () => {
    const count = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const source = { adapter: 'initialization-race' }
          const observerReady = Deferred.makeUnsafe<void>()
          let backend = { count: 1 }
          let firstRead = true
          let notify = (): void => undefined

          const adapter: CrdtAdapter<typeof State> = {
            spec,
            source,
            ready: Deferred.await(observerReady),
            changes: Stream.callback((queue) =>
              Effect.acquireRelease(
                Effect.sync(() => {
                  notify = () => {
                    Queue.offerUnsafe(queue, { source })
                  }
                  Deferred.doneUnsafe(observerReady, Effect.void)
                }),
                () =>
                  Effect.sync(() => {
                    notify = (): void => undefined
                  })
              )
            ),
            readSnapshot: Effect.sync(() => {
              const captured = backend
              if (firstRead) {
                firstRead = false
                backend = { count: 2 }
                notify()
              }
              return captured
            }),
            writeSnapshot: (snapshot) =>
              Effect.sync(() => {
                backend = snapshot
              }),
            applyCommit: (commit) =>
              Effect.sync(() => {
                backend = commit.after
              }),
          }

          const binding = yield* bindCrdt(store, adapter, {
            initialize: 'backend',
          })
          yield* binding.idle
          return store.getSnapshot().count
        })
      )
    )

    expect(count).toBe(2)
  })

  it('supervises coordinator failure and closes the entire binding', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const notifications =
            yield* PubSub.unbounded<InboundCrdtNotification>()
          const source = { adapter: 'failing-coordinator' }
          let failRead = false
          let writes = 0

          const adapter: CrdtAdapter<typeof State, FakeAdapterError> = {
            spec,
            source,
            ready: Effect.void,
            changes: Stream.fromPubSub(notifications),
            readSnapshot: Effect.suspend(() =>
              failRead
                ? Effect.fail(
                    new FakeAdapterError({ message: 'read rejected' })
                  )
                : Effect.succeed({ count: 0 })
            ),
            writeSnapshot: () => Effect.void,
            applyCommit: () =>
              Effect.sync(() => {
                writes += 1
              }),
          }

          const binding = yield* bindCrdt(store, adapter, {
            initialize: 'none',
          })
          yield* binding.ready
          failRead = true
          yield* PubSub.publish(notifications, { source })
          const failure = yield* binding.failure
          const awaited = yield* Effect.result(binding.await)
          const health = yield* binding.health

          yield* store.update((state) => {
            state.count = 1
          })

          return { awaited, failure, health, writes }
        })
      )
    )

    expect(result.failure.worker).toBe('coordinator')
    expect(result.failure.reason).toBe('failed')
    expect(result.awaited._tag).toBe('Failure')
    expect(result.health._tag).toBe('Failed')
    expect(result.writes).toBe(0)
  })

  it('supervises terminal inbound stream failure', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const failStream = yield* Deferred.make<void>()
          const error = new FakeAdapterError({ message: 'observer rejected' })
          const adapter: CrdtAdapter<typeof State, FakeAdapterError> = {
            spec,
            source: { adapter: 'failing-inbound' },
            ready: Effect.void,
            changes: Stream.fromEffect(
              Deferred.await(failStream).pipe(
                Effect.andThen(Effect.fail(error))
              )
            ),
            readSnapshot: Effect.succeed({ count: 0 }),
            writeSnapshot: () => Effect.void,
            applyCommit: () => Effect.void,
          }

          const binding = yield* bindCrdt(store, adapter, {
            initialize: 'none',
          })
          yield* Deferred.succeed(failStream, undefined)
          const failure = yield* binding.failure
          yield* Effect.result(binding.await)
          return { failure, health: yield* binding.health }
        })
      )
    )

    expect(result.failure.worker).toBe('inbound')
    expect(result.failure.reason).toBe('failed')
    expect(result.health._tag).toBe('Failed')
  })
})
