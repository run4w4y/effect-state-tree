# @effect-state-tree/devtools

`@effect-state-tree/devtools` records an effect-state-tree store's commits in a
framework-neutral timeline and provides programmatic time travel.

It is a data and controller layer, not a browser extension or visual inspector.
Applications can build their own development interface from the exposed
`StoreView`.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Record and inspect commits

```ts
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeDevtools } from '@effect-state-tree/devtools'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Counter = Schema.Struct({ count: Schema.Number })
const store = await Effect.runPromise(
  makeTreeStore(makeTreeSpec(Counter), { count: 0 })
)
const devtools = makeDevtools(store, { limit: 100 })

await Effect.runPromise(
  store.update(
    (state) => {
      state.count = 1
    },
    { label: 'Set count to one' }
  )
)

const timeline = devtools.getState()
console.log(timeline.entries[0]?.label)
console.log(timeline.entries[0]?.change.patches.forward)

await Effect.runPromise(devtools.travelTo(0))
console.log(store.getSnapshot().count) // 0

await Effect.runPromise(devtools.resume)
console.log(store.getSnapshot().count) // 1

devtools.dispose()
await Effect.runPromise(store.shutdown)
```

Time-travel commits are tagged so they do not append themselves to the
timeline. `resume` restores the latest retained snapshot.

## Timeline lifecycle

The timeline is anchored at the store revision where `makeDevtools` is called.
Its state contains:

- the anchor snapshot and revision;
- retained `ChangeEnvelope` entries after that anchor;
- every commit's labels, metadata, tags, patches, semantic operations, and
  before/after snapshots.

`limit` bounds retained entries by advancing the anchor as older entries are
dropped. `clear()` re-anchors at the current store revision. `dispose()` stops
recording.

`travelTo` fails with `DevtoolsRevisionError` when the requested revision is no
longer retained.

## Related packages

- [`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime) defines the commit
  envelope and store view used here.
- [`@effect-state-tree/atom`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/atom) can project the timeline into a
  UI framework through Effect Atom.
