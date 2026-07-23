import type { SourceToken } from '@effect-state-tree/runtime'
import { Effect, Option, Schema } from 'effect'
import * as KeyValueStore from 'effect/unstable/persistence/KeyValueStore'
import {
  PersistenceJsonParseError,
  PersistenceJsonStringifyError,
} from './errors'

/** Runtime Schema for the durable, format-versioned storage boundary. */
export const PersistedEnvelopeSchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  value: Schema.Unknown,
})

/** Decoded representation of `PersistedEnvelopeSchema`. */
export type PersistedEnvelope = typeof PersistedEnvelopeSchema.Type

/**
 * Minimal durable-storage boundary used by the persistence binding.
 *
 * `load` is intentionally untrusted. The envelope and its payload are decoded
 * by Effect Schema before either can enter the tree.
 */
export interface PersistenceStorage<
  Encoded = PersistedEnvelope,
  E = never,
  R = never,
> {
  /** Stable provenance token used to suppress persistence echoes. */
  readonly source: SourceToken
  /** Loads the current untrusted encoded value when one exists. */
  readonly load: Effect.Effect<Option.Option<unknown>, E, R>
  /** Durably writes one encoded persistence envelope. */
  readonly save: (encoded: Encoded) => Effect.Effect<void, E, R>
  /** Removes persisted state when the backend supports deletion. */
  readonly remove?: Effect.Effect<void, E, R>
}

/** Namespace and codec options for Effect KeyValueStore persistence. */
export interface KeyValueStorageOptions {
  /** Provenance token used to suppress persistence echo writes. */
  readonly source?: SourceToken
}

const defaultKeyValueSource = (key: string): SourceToken => ({
  adapter: '@effect-state-tree/persistence/key-value-store',
  key,
})

const parseJson = (
  key: string,
  text: string
): Effect.Effect<unknown, PersistenceJsonParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => new PersistenceJsonParseError({ key, text, cause }),
  })

const stringifyJson = (
  key: string,
  value: PersistedEnvelope
): Effect.Effect<string, PersistenceJsonStringifyError> =>
  Effect.try({
    try: () => {
      const text = JSON.stringify(value)
      if (text === undefined) {
        throw new TypeError('JSON.stringify returned undefined')
      }
      return text
    },
    catch: (cause) => new PersistenceJsonStringifyError({ key, value, cause }),
  })

/**
 * Adapts Effect's canonical `KeyValueStore` service to tree persistence.
 *
 * The returned adapter keeps `KeyValueStore` in its Effect requirement, so it
 * can be supplied by memory, filesystem, SQL, LocalStorage, IndexedDB, or any
 * other official Effect layer without another storage abstraction.
 */
export const makeKeyValueStorage = (
  key: string,
  options: KeyValueStorageOptions = {}
): PersistenceStorage<
  PersistedEnvelope,
  | KeyValueStore.KeyValueStoreError
  | PersistenceJsonParseError
  | PersistenceJsonStringifyError,
  KeyValueStore.KeyValueStore
> => ({
  source: options.source ?? defaultKeyValueSource(key),
  load: Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
    Effect.flatMap(store.get(key), (text) =>
      text === undefined
        ? Effect.succeed(Option.none())
        : Effect.map(parseJson(key, text), Option.some)
    )
  ),
  save: (envelope) =>
    Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
      Effect.flatMap(stringifyJson(key, envelope), (text) =>
        store.set(key, text)
      )
    ),
  remove: Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
    store.remove(key)
  ),
})
