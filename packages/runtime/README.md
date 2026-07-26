# @effect-state-tree/runtime

`@effect-state-tree/runtime` provides the live, Effect-powered part of
effect-state-tree: transactional stores, uniquely identified tree services,
updates, actions, selectors, checkpoints, commit metadata, and commit streams.

This is the usual entry point for an application that wants one canonical state
tree.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for `@effect-state-tree/core`,
`@effect-state-tree/producer`, and this package.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Define a tree and update it

`defineTree` gives a tree specification a stable identity. It derives the
Context service, Layer, reads, updates, and actions for that particular tree:

```ts
import { entity, makeTreeSpec } from '@effect-state-tree/core'
import { defineTree } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
}).pipe(entity({ type: 'Todo', id: 'id' }))

const TodoList = Schema.Struct({
  todos: Schema.Array(Todo),
})

const TodoTree = defineTree(
  '@example/TodoTree',
  makeTreeSpec(TodoList)
)

const addTodo = TodoTree.update(
  (state, todo: typeof Todo.Type) => {
    state.todos.push(todo)
  },
  (todo) => ({ label: `Add "${todo.title}"` })
)

const program = Effect.gen(function* () {
  yield* addTodo({
    id: 'first',
    title: 'Try effect-state-tree',
    done: false,
  })

  return yield* TodoTree.get
})

const snapshot = await Effect.runPromise(
  Effect.scoped(
    program.pipe(Effect.provide(TodoTree.layer({ todos: [] })))
  )
)
```

Calling `addTodo` creates an Effect. The matching store is resolved from Effect
Context when that Effect runs, and the recipe becomes one atomic commit.

## Updates and actions

An **update** is a synchronous transition against a temporary mutable view. Use
`operationUpdate` when a CRDT adapter should also receive semantic list, object,
or text intent.

An **action** is an ordinary interruptible Effect workflow:

```ts
const saveTodos = TodoTree.action(
  'Save todos',
  () =>
    Effect.gen(function* () {
      const current = yield* TodoTree.get
      const saved = yield* saveToServer(current)
      yield* installServerSnapshot(saved)
    })
)
```

The application supplies `saveToServer` and `installServerSnapshot`. Nested
commits inherit the action ID and name, while asynchronous work runs without
holding a store lock.

## Store views and commits

Every store exposes:

- synchronous `getSnapshot()` and `getRevision()` reads;
- Effect-based `get`, `getState`, `update`, `apply`, and `replace` operations;
- `select` for path-aware, equality-aware `StoreView` projections;
- `subscribe` for synchronous commit observation;
- `changes` as an Effect Stream;
- path checkpoints for conditional writes;
- `shutdown` for explicit lifecycle management.

An accepted commit includes the previous and next snapshots, revisions, forward
and inverse changes, touched paths, a transaction ID, tags, provenance, and
optional labels or metadata. Optional effect-state-tree packages consume this
same envelope rather than introducing their own transaction formats.

Use `makeTreeStore` for a standalone store, `makeTreeStoreScoped` for a store
owned by the current Scope, or the corresponding methods on a tree definition.

## Related packages

- [`@effect-state-tree/core`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/core) defines snapshots, identity,
  patches, and reconciliation.
- [`@effect-state-tree/producer`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/producer) powers update recipes.
- [`@effect-state-tree/atom`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/atom) projects stores and actions into
  Effect Atom.
- The [React todo example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-todo-example) shows a tree
  definition, application Layer, actions, drafts, and UI projections working
  together.
