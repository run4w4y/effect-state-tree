# @effect-state-tree/persistence-browser

`@effect-state-tree/persistence-browser` provides browser-backed Effect
`KeyValueStore` layers for
[`@effect-state-tree/persistence`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/persistence).

It exports LocalStorage, SessionStorage, and IndexedDB variants. The package
does not create a second storage abstraction; it supplies the official Effect
service consumed by `makeKeyValueStorage`.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install a matching archive for `@effect-state-tree/persistence`.

The package is ESM-only and expects `effect@4.0.0-beta.99` and
`@effect/platform-browser@4.0.0-beta.99` as peer dependencies. Every API should
be treated as experimental.

## Use LocalStorage

```ts
import { makeTreeSpec } from '@effect-state-tree/core'
import {
  bindPersistence,
  makeKeyValueStorage,
} from '@effect-state-tree/persistence'
import { layerLocalStorage } from '@effect-state-tree/persistence-browser'
import { makeTreeStoreScoped } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Preferences = Schema.Struct({
  theme: Schema.Literals(['light', 'dark']),
})

const program = Effect.gen(function* () {
  const store = yield* makeTreeStoreScoped(
    makeTreeSpec(Preferences),
    { theme: 'light' }
  )
  const storage = makeKeyValueStorage('preferences')
  const binding = yield* bindPersistence(store, storage)

  yield* store.update((state) => {
    state.theme = 'dark'
  })
  yield* binding.flush
})

await Effect.runPromise(
  Effect.scoped(program).pipe(Effect.provide(layerLocalStorage))
)
```

Use `layerSessionStorage` in the same way for tab-scoped storage.

## Use IndexedDB

For ordinary window applications, provide the combined window-ready layer:

```ts
import { layerIndexedDbWindow } from '@effect-state-tree/persistence-browser'

const indexedDbStorage = layerIndexedDbWindow({
  database: 'my-application',
})

await Effect.runPromise(
  Effect.scoped(program).pipe(Effect.provide(indexedDbStorage))
)
```

`layerIndexedDb` keeps Effect's IndexedDB service as a requirement. This is
useful in tests, workers, or environments that supply an explicit
implementation. `makeIndexedDb`, `IndexedDbService`, and
`layerIndexedDbWindowService` are exported for that lower-level setup.

Browser quota, security, and serialization failures remain in Effect's typed
error channel.

## Related packages

- [`@effect-state-tree/persistence`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/persistence) owns envelopes,
  migrations, synchronization, and writer lifecycle.
- The package's
  [browser-layer tests](https://github.com/run4w4y/effect-state-tree/blob/main/packages/persistence-browser/test/persistence-browser.test.ts) show explicit
  LocalStorage, SessionStorage, and fake IndexedDB environments.
