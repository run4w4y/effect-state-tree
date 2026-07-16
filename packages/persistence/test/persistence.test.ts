import { describe, expect, it } from 'bun:test'
import { dateAtomicInterpreter, makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Data, Deferred, Effect, Option, Result, Schema } from 'effect'
import * as KeyValueStore from 'effect/unstable/persistence/KeyValueStore'
import {
  bindPersistence,
  makeKeyValueStorage,
  makePersistenceMigration,
  type PersistedEnvelope,
  PersistenceDecodeError,
  PersistenceMigrationDecodeError,
  PersistenceSkipTag,
  type PersistenceStorage,
  PersistenceVersionError,
} from '../src/index'

const State = Schema.Struct({
  count: Schema.NumberFromString,
})
const EncodedState = Schema.Struct({ count: Schema.String })
const spec = makeTreeSpec(State)

const getEncodedCount = (envelope: PersistedEnvelope): number =>
  Number(Schema.decodeUnknownSync(EncodedState)(envelope.value).count)

const makeTestStorage = (initial?: unknown) => {
  let stored = Option.fromUndefinedOr(initial)
  const saves: Array<PersistedEnvelope> = []
  const storage: PersistenceStorage<PersistedEnvelope> = {
    source: { adapter: 'test' },
    load: Effect.sync(() => stored),
    save: (envelope) =>
      Effect.sync(() => {
        saves.push(envelope)
        stored = Option.some(envelope)
      }),
    remove: Effect.sync(() => {
      stored = Option.none()
    }),
  }
  return {
    storage,
    saves,
    get stored() {
      return stored
    },
  }
}

class TransientStorageError extends Data.TaggedError('TransientStorageError')<{
  readonly count: number
}> {}

describe('persistence', () => {
  it('roundtrips transformed Schema values through a versioned envelope', async () => {
    const target = makeTestStorage()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 7 })
          yield* bindPersistence(store, target.storage, {
            initialize: 'store',
            version: 3,
          })
        })
      )
    )

    expect(Option.getOrThrow(target.stored)).toEqual({
      version: 3,
      value: { count: '7' },
    })

    const restored = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          yield* bindPersistence(store, target.storage, {
            initialize: 'storage',
            version: 3,
          })
          return store.getSnapshot()
        })
      )
    )

    expect(restored).toEqual({ count: 7 })
    expect(typeof restored.count).toBe('number')
  })

  it('persists native Date values through the canonical JSON codec', async () => {
    const DatedState = Schema.Struct({ when: Schema.Date })
    const datedSpec = makeTreeSpec(DatedState, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const target = makeTestStorage()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(datedSpec, {
            when: new Date('2026-07-10T12:00:00.000Z'),
          })
          yield* bindPersistence(store, target.storage, {
            initialize: 'store',
          })
        })
      )
    )

    expect(Option.getOrThrow(target.stored)).toEqual({
      version: 1,
      value: { when: '2026-07-10T12:00:00.000Z' },
    })

    const restored = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(datedSpec, {
            when: new Date('2000-01-01T00:00:00.000Z'),
          })
          yield* bindPersistence(store, target.storage)
          return store.getSnapshot()
        })
      )
    )
    expect(restored.when.toISOString()).toBe('2026-07-10T12:00:00.000Z')
    expect(() => restored.when.setTime(0)).toThrow(TypeError)
  })

  it('migrates legacy payloads through their declared Schemas', async () => {
    const target = makeTestStorage({
      version: 0,
      value: { count: 12 },
    })
    const migration = makePersistenceMigration({
      from: 0,
      to: 1,
      schema: Schema.Struct({ count: Schema.Number }),
      migrate: ({ count }) => Effect.succeed({ count: String(count) }),
    })

    const restored = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          yield* bindPersistence(store, target.storage, {
            migrations: [migration],
            version: 1,
          })
          return store.getSnapshot()
        })
      )
    )

    expect(restored).toEqual({ count: 12 })
    expect(Option.getOrThrow(target.stored)).toEqual({
      version: 1,
      value: { count: '12' },
    })
  })

  it('rejects newer envelopes and malformed migration inputs explicitly', async () => {
    const newer = makeTestStorage({ version: 2, value: { count: '2' } })
    const newerStore = await Effect.runPromise(
      makeTreeStore(spec, { count: 0 })
    )
    const versionFailure = await Effect.runPromise(
      Effect.scoped(
        Effect.flip(bindPersistence(newerStore, newer.storage, { version: 1 }))
      )
    )
    expect(versionFailure).toBeInstanceOf(PersistenceVersionError)

    const malformed = makeTestStorage({
      version: 0,
      value: { count: 'not-a-legacy-number' },
    })
    const migration = makePersistenceMigration({
      from: 0,
      to: 1,
      schema: Schema.Struct({ count: Schema.Number }),
      migrate: ({ count }) => Effect.succeed({ count: String(count) }),
    })
    const malformedStore = await Effect.runPromise(
      makeTreeStore(spec, { count: 0 })
    )
    const migrationFailure = await Effect.runPromise(
      Effect.scoped(
        Effect.flip(
          bindPersistence(malformedStore, malformed.storage, {
            migrations: [migration],
            version: 1,
          })
        )
      )
    )
    expect(migrationFailure).toBeInstanceOf(PersistenceMigrationDecodeError)
  })

  it('uses Effect KeyValueStore as the canonical JSON adapter', async () => {
    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const storage = makeKeyValueStorage('state')
        yield* storage.save({ version: 2, value: { count: '9' } })
        return yield* storage.load
      }).pipe(Effect.provide(KeyValueStore.layerMemory))
    )

    expect(Option.getOrThrow(loaded)).toEqual({
      version: 2,
      value: { count: '9' },
    })
  })

  it('saves every eligible commit exactly once in commit order', async () => {
    const saved: Array<number> = []
    const source = { adapter: 'ordered-test' }
    const storage: PersistenceStorage<PersistedEnvelope> = {
      source,
      load: Effect.succeed(Option.none()),
      save: (envelope) =>
        Effect.sync(() => {
          saved.push(getEncodedCount(envelope))
        }),
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const binding = yield* bindPersistence(store, storage, {
            initialize: 'none',
          })

          yield* store.update((state) => {
            state.count = 1
          })
          yield* store.update((state) => {
            state.count = 2
          })
          yield* store.update(
            (state) => {
              state.count = 3
            },
            { source }
          )
          yield* store.update(
            (state) => {
              state.count = 4
            },
            { tags: [PersistenceSkipTag] }
          )
          yield* store.update((state) => {
            state.count = 5
          })

          yield* binding.flush
        })
      )
    )

    expect(saved).toEqual([1, 2, 5])
  })

  it('reports transient failures once and continues writing later commits', async () => {
    const attempts: Array<number> = []
    let shouldFail = true
    const storage: PersistenceStorage<
      PersistedEnvelope,
      TransientStorageError
    > = {
      source: { adapter: 'transient-test' },
      load: Effect.succeed(Option.none()),
      save: (envelope) => {
        const count = getEncodedCount(envelope)
        attempts.push(count)
        if (count === 2 && shouldFail) {
          shouldFail = false
          return Effect.fail(new TransientStorageError({ count }))
        }
        return Effect.void
      },
    }

    const results = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const binding = yield* bindPersistence(store, storage, {
            initialize: 'none',
          })
          yield* store.update((state) => {
            state.count = 1
          })
          yield* store.update((state) => {
            state.count = 2
          })
          yield* store.update((state) => {
            state.count = 3
          })

          const failedFlush = yield* Effect.result(binding.flush)
          const recoveredFlush = yield* Effect.result(binding.flush)
          yield* store.update((state) => {
            state.count = 4
          })
          const finalFlush = yield* Effect.result(binding.flush)
          return { failedFlush, recoveredFlush, finalFlush }
        })
      )
    )

    expect(attempts).toEqual([1, 2, 3, 4])
    expect(Result.isFailure(results.failedFlush)).toBe(true)
    if (Result.isFailure(results.failedFlush)) {
      expect(results.failedFlush.failure).toEqual(
        new TransientStorageError({ count: 2 })
      )
    }
    expect(Result.isSuccess(results.recoveredFlush)).toBe(true)
    expect(Result.isSuccess(results.finalFlush)).toBe(true)
  })

  it('gracefully drains queued writes during normal scope cleanup', async () => {
    const saved: Array<number> = []
    const storage: PersistenceStorage<PersistedEnvelope> = {
      source: { adapter: 'cleanup-test' },
      load: Effect.succeed(Option.none()),
      save: (envelope) =>
        Effect.andThen(
          Effect.sleep('5 millis'),
          Effect.sync(() => {
            saved.push(getEncodedCount(envelope))
          })
        ),
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          yield* bindPersistence(store, storage, { initialize: 'none' })
          yield* store.update((state) => {
            state.count = 1
          })
          yield* store.update((state) => {
            state.count = 2
          })
        })
      )
    )

    expect(saved).toEqual([1, 2])
  })

  it('explicit abort interrupts the active write and drops queued writes', async () => {
    const started = await Effect.runPromise(Deferred.make<void>())
    const saved: Array<number> = []
    const storage: PersistenceStorage<PersistedEnvelope> = {
      source: { adapter: 'abort-test' },
      load: Effect.succeed(Option.none()),
      save: (envelope) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Effect.never
          saved.push(getEncodedCount(envelope))
        }),
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, { count: 0 })
          const binding = yield* bindPersistence(store, storage, {
            initialize: 'none',
          })
          yield* store.update((state) => {
            state.count = 1
          })
          yield* store.update((state) => {
            state.count = 2
          })
          yield* Deferred.await(started)
          yield* binding.abort
        })
      )
    )

    expect(saved).toEqual([])
  })

  it('rejects invalid persisted data without changing the store', async () => {
    const target = makeTestStorage({
      version: 1,
      value: { count: true },
    })
    const store = await Effect.runPromise(makeTreeStore(spec, { count: 4 }))
    const failure = await Effect.runPromise(
      Effect.scoped(Effect.flip(bindPersistence(store, target.storage)))
    )

    expect(failure).toBeInstanceOf(PersistenceDecodeError)
    expect(store.getSnapshot()).toEqual({ count: 4 })
  })
})
