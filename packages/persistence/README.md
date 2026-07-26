# @effect-state-tree/persistence

`@effect-state-tree/persistence` binds an effect-state-tree store to durable
storage using the tree Schema's encoded JSON representation. It supports
versioned envelopes, typed migrations, initialization policy, ordered writes,
flush and close semantics, and provenance-based echo suppression.

The package includes a general `PersistenceStorage` interface and an adapter for
Effect's `KeyValueStore` service.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Persist a store through KeyValueStore

```ts
import { makeTreeSpec } from '@effect-state-tree/core'
import {
  bindPersistence,
  makeKeyValueStorage,
} from '@effect-state-tree/persistence'
import { makeTreeStoreScoped } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'
import * as KeyValueStore from 'effect/unstable/persistence/KeyValueStore'

const Counter = Schema.Struct({
  count: Schema.NumberFromString,
})

const program = Effect.gen(function* () {
  const store = yield* makeTreeStoreScoped(
    makeTreeSpec(Counter),
    { count: 0 }
  )
  const storage = makeKeyValueStorage('counter')
  const binding = yield* bindPersistence(store, storage, {
    initialize: 'store',
    version: 1,
  })

  yield* store.update((state) => {
    state.count = 1
  })
  yield* binding.flush
})

await Effect.runPromise(
  Effect.scoped(program).pipe(
    Effect.provide(KeyValueStore.layerMemory)
  )
)
```

The stored envelope contains `{ version: 1, value: { count: "1" } }` because
`Schema.NumberFromString` encodes the in-memory number through the Schema's JSON
codec.

In a browser, provide a layer from
[`@effect-state-tree/persistence-browser`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/persistence-browser).
Other environments can provide any official or custom Effect `KeyValueStore`
layer.

## Initialization

`bindPersistence` supports three initial directions:

- `storage` loads and reconciles an existing persisted value into the store;
- `store` writes the store's current snapshot immediately;
- `none` starts observing without an initial read or write.

The default is `storage`. Loading is untrusted: both the versioned envelope and
the payload are decoded before the value can enter the tree.

## Migrations

`makePersistenceMigration` declares the old version, the Schema that decodes its
payload, and an Effect that produces the next encoded payload:

```ts
const fromVersionZero = makePersistenceMigration({
  from: 0,
  to: 1,
  schema: Schema.Struct({ count: Schema.Number }),
  migrate: ({ count }) => Effect.succeed({ count: String(count) }),
})
```

Migration paths must be unambiguous. Successfully migrated values are written
back in the current format by default.

## Writer lifecycle

Eligible commits are saved once, in commit order. `flush` waits for all writes
observed before it was called. `close` unsubscribes and drains the queue, while
`abort` intentionally interrupts and drops pending work. Normal Scope
finalization closes the binding.

Commits tagged with `PersistenceSkipTag`, or carrying the adapter's own source
token, are not written back.

## Related packages

- [`@effect-state-tree/persistence-browser`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/persistence-browser)
  provides LocalStorage, SessionStorage, and IndexedDB layers.
- [`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime) supplies the store and
  ordered commit stream.
- Read the [stability notes](https://github.com/run4w4y/effect-state-tree/blob/main/docs/stability.md) before treating any
  current encoded format as durable.
