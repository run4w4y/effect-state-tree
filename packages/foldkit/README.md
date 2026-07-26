# @effect-state-tree/foldkit

`@effect-state-tree/foldkit` interprets effect-state-tree changes as a pure
Model, Message, update, and Command-style feature.

It is intended for applications that want immutable tree admission, patches,
reconciliation, and commit metadata without using the live Effect store
runtime. The package does not depend on Foldkit itself; it exposes small
compatible shapes that an application can compose into its own model.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for `@effect-state-tree/core`,
`@effect-state-tree/producer`, and this package.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Create a pure tree feature

```ts
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeFoldkitTree } from '@effect-state-tree/foldkit'
import { Result, Schema } from 'effect'

const Counter = Schema.Struct({ count: Schema.Number })

const feature = makeFoldkitTree({
  spec: makeTreeSpec(Counter),
  initial: { count: 0 },
  plugin: 0,
  reducer: {
    initial: 0,
    reduce: (commitCount, commit) => ({
      state: commitCount + 1,
      commands: [{ _tag: 'Persist', snapshot: commit.after }],
      outMessages: [{ _tag: 'CounterChanged', value: commit.after.count }],
    }),
  },
})

if (Result.isFailure(feature)) {
  throw feature.failure
}

const result = feature.success.update(feature.success.initial, {
  _tag: 'TreeSnapshot',
  snapshot: { count: 1 },
  context: {
    transactionId: 'message-1',
    committedAt: Date.now(),
    label: 'Increment',
  },
})

if (Result.isFailure(result)) {
  throw result.failure
}

console.log(result.success.state.tree.count) // 1
console.log(result.success.state.revision) // 1
console.log(result.success.commands)
```

The caller supplies transaction IDs and time in the message context. Replaying
the same state and message therefore produces the same result.

## Messages and results

A feature accepts local or external:

- `TreeChange` messages containing patches and semantic intent;
- `TreeSnapshot` messages reconciled through the tree specification.

`externalTreeChange` and `externalTreeSnapshot` construct the replicated
variants. A real transition returns `Committed` with the next model, commands,
out-messages, and a complete commit envelope. An unchanged transition returns
`NoChange` and preserves the existing state reference.

## Compose into a parent model

`makeFoldkitSubmodel` lifts a tree feature into a parent model by requiring
explicit `get` and `set` functions plus mappings for child commands and
out-messages. `mapFoldkitEffectCommand` maps an Effect command's successful
value without changing its error or service requirements.

The feature stores its current immutable tree, monotonic revision, and plugin
state inside the parent model. External resources should enter as messages,
keeping the update function pure.

## Related packages

- [`@effect-state-tree/core`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/core) supplies immutable admission,
  patches, and reconciliation.
- [`@effect-state-tree/producer`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/producer) can produce the
  `ChangeSet` carried by a `TreeChange` message.
- [`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime) is the alternative live
  Effect service and store model.
