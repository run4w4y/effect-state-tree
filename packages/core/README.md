# @effect-state-tree/core

`@effect-state-tree/core` is the framework-independent foundation of
effect-state-tree. It turns an Effect Schema into a tree specification and
provides immutable snapshots, tuple paths, entity identity, typed references,
patches, codecs, and reconciliation.

Use this package when you need to work with tree values without creating a live
store. Most applications also use
[`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime), which builds Effect
services and transactional updates on top of this package.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
use archives from the same commit for the entire package graph.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Define and admit a tree

An Effect Schema describes both the in-memory value and its encoded form.
`makeTreeSpec` prepares that Schema for state-tree operations. Calling
`captureTreeSnapshot` then validates the value, records its entity index, and
returns an immutable snapshot.

```ts
import {
  captureTreeSnapshot,
  entity,
  makeTreeSpec,
} from '@effect-state-tree/core'
import { Result, Schema } from 'effect'

const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
}).pipe(entity({ type: 'Todo', id: 'id' }))

const TodoList = Schema.Struct({
  todos: Schema.Array(Todo),
})

const spec = makeTreeSpec(TodoList)
const admitted = captureTreeSnapshot(spec, {
  todos: [{ id: 'first', title: 'Learn the tree model', done: false }],
})

if (Result.isFailure(admitted)) {
  throw admitted.failure
}

const snapshot = admitted.success.snapshot
console.log(Object.isFrozen(snapshot)) // true
console.log(admitted.success.entities.size) // 1
```

Entity IDs are data identity, not JavaScript object identity. IDs must be unique
within an entity type and cannot change in place.

## Reconcile authoritative data

Reconciliation validates incoming data and preserves references for unchanged
branches and entities. The result also contains reversible patches:

```ts
import { reconcileTreeSnapshot } from '@effect-state-tree/core'
import { Result } from 'effect'

const reconciled = reconcileTreeSnapshot(spec, snapshot, {
  todos: [
    { id: 'second', title: 'Read the runtime guide', done: false },
    { id: 'first', title: 'Learn the tree model', done: true },
  ],
})

if (Result.isFailure(reconciled)) {
  throw reconciled.failure
}

console.log(reconciled.success.snapshot.todos.map((todo) => todo.id))
console.log(reconciled.success.patchSet.forward)
```

This is useful when a server, persistence layer, or collaboration backend
returns a new authoritative value.

## Main concepts

- **Tree specifications** compile Schema navigation and snapshot policy once.
- **Snapshots** are immutable and structurally share unchanged branches.
- **Tuple paths** such as `['todos', 0, 'title']` address values without string
  parsing.
- **Patches** can be applied, inverted, diffed, prefixed, and converted to or
  from JSON Patch.
- **Entities** add stable identity, indexes, anchored paths, and typed
  references.
- **Codecs** encode or decode the whole tree or a value at a particular path.
- **Annotations** mark entities, atomic values, and collaborative text in the
  Schema itself.

## Related packages

- [`@effect-state-tree/producer`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/producer) creates snapshots and
  patch sets from mutable-looking recipes.
- [`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime) owns live stores,
  transactions, selectors, and Effect services.
- Read the repository [design guide](https://github.com/run4w4y/effect-state-tree/blob/main/docs/design.md) for the complete
  mental model and [stability notes](https://github.com/run4w4y/effect-state-tree/blob/main/docs/stability.md) before relying on
  a development snapshot.
