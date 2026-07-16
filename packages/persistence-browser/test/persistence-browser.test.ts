import { describe, expect, it } from 'bun:test'
import * as IndexedDb from '@effect/platform-browser/IndexedDb'
import {
  makeKeyValueStorage,
  type PersistedEnvelope,
} from '@effect-state-tree/persistence'
import { Effect, Layer, Option } from 'effect'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import {
  layerIndexedDb,
  layerLocalStorage,
  layerSessionStorage,
} from '../src/index'

class TestStorage implements Storage {
  readonly #entries = new Map<string, string>()

  get length(): number {
    return this.#entries.size
  }

  clear(): void {
    this.#entries.clear()
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.#entries.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.#entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value)
  }
}

const roundtrip = Effect.gen(function* () {
  const storage = makeKeyValueStorage('tree')
  const envelope: PersistedEnvelope = {
    version: 4,
    value: { todos: [{ id: 'one', done: false }] },
  }
  yield* storage.save(envelope)
  const loaded = yield* storage.load
  return Option.getOrThrow(loaded)
})

const withGlobalStorage = async (
  name: 'localStorage' | 'sessionStorage',
  storage: Storage,
  run: () => Promise<void>
): Promise<void> => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  })
  try {
    await run()
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name)
    } else {
      Object.defineProperty(globalThis, name, descriptor)
    }
  }
}

describe('browser persistence layers', () => {
  it('roundtrips versioned envelopes through LocalStorage', async () => {
    await withGlobalStorage('localStorage', new TestStorage(), async () => {
      const loaded = await Effect.runPromise(
        roundtrip.pipe(Effect.provide(layerLocalStorage))
      )
      expect(loaded).toEqual({
        version: 4,
        value: { todos: [{ id: 'one', done: false }] },
      })
    })
  })

  it('roundtrips versioned envelopes through SessionStorage', async () => {
    await withGlobalStorage('sessionStorage', new TestStorage(), async () => {
      const loaded = await Effect.runPromise(
        roundtrip.pipe(Effect.provide(layerSessionStorage))
      )
      expect(loaded).toEqual({
        version: 4,
        value: { todos: [{ id: 'one', done: false }] },
      })
    })
  })

  it('roundtrips versioned envelopes through fake IndexedDB', async () => {
    const indexedDbLayer = Layer.succeed(
      IndexedDb.IndexedDb,
      IndexedDb.make({ indexedDB, IDBKeyRange })
    )
    const storageLayer = layerIndexedDb({
      database: `effect-state-tree-${crypto.randomUUID()}`,
    }).pipe(Layer.provide(indexedDbLayer))

    const loaded = await Effect.runPromise(
      Effect.scoped(roundtrip.pipe(Effect.provide(storageLayer)))
    )

    expect(loaded).toEqual({
      version: 4,
      value: { todos: [{ id: 'one', done: false }] },
    })
  })
})
