import * as BrowserKeyValueStore from '@effect/platform-browser/BrowserKeyValueStore'
import * as IndexedDb from '@effect/platform-browser/IndexedDb'
import { Layer } from 'effect'

/**
 * Effect `KeyValueStore` backed by the current origin's LocalStorage.
 *
 * Pair this layer with `makeKeyValueStorage` from
 * `@effect-state-tree/persistence`. Browser quota, security, and serialization
 * failures remain typed as Effect `KeyValueStoreError` values.
 */
export const layerLocalStorage = BrowserKeyValueStore.layerLocalStorage

/** Effect `KeyValueStore` backed by the current tab's SessionStorage. */
export const layerSessionStorage = BrowserKeyValueStore.layerSessionStorage

/**
 * Effect `KeyValueStore` backed by IndexedDB.
 *
 * This direct official layer keeps `IndexedDb.IndexedDb` as a requirement,
 * which is useful for tests, workers, and non-window environments that supply
 * their own IndexedDB implementation.
 */
export const layerIndexedDb = BrowserKeyValueStore.layerIndexedDb

/** The official browser-window provider for Effect's IndexedDB service. */
export const layerIndexedDbWindowService = IndexedDb.layerWindow

/**
 * Window-ready IndexedDB storage with the official IndexedDB service already
 * provided from `window.indexedDB` and `window.IDBKeyRange`.
 */
export const layerIndexedDbWindow = (
  options?: Parameters<typeof BrowserKeyValueStore.layerIndexedDb>[0]
) =>
  BrowserKeyValueStore.layerIndexedDb(options).pipe(
    Layer.provide(IndexedDb.layerWindow)
  )

/** Constructs Effect's IndexedDB service from an explicit implementation. */
export const makeIndexedDb = IndexedDb.make

/** Effect service tag used by the direct `layerIndexedDb` variant. */
export const IndexedDbService = IndexedDb.IndexedDb
