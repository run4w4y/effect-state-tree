# effect-state-tree

effect-state-tree is an experimental state-tree library built with Effect and
Effect Schema. It combines immutable snapshots with concise mutable-looking
updates, then exposes each accepted change as a typed commit that other features
can observe.

## Active development

effect-state-tree is currently a draft and an experiment. Do not rely on it for
anything important: its APIs and behavior may change at any time, and any use is
entirely at your own risk.

## Why effect-state-tree?

Application state often needs more than a reactive container. It may also need
validation, undo and redo, persistence, collaboration, stable references, or a
safe way to reconcile data returned by a server. effect-state-tree gives those
features a shared foundation:

- Effect Schema describes the shape and encoded form of the state.
- Every accepted state is an immutable snapshot.
- Updates use familiar mutable syntax without exposing mutable state.
- Each update produces ordered patches, inverse patches, and commit metadata.
- Optional packages add history, drafts, persistence, CRDTs, devtools, and
  frontend reactivity without putting them in the core.
- Effect owns services, failures, interruption, asynchronous work, and resource
  lifetimes.

The project is ESM-only and currently requires `effect@4.0.0-beta.99`.

## Quick start

There is no stable installation channel yet. Every commit pushed to `main` that
passes CI receives a development snapshot, identified by its complete Git commit
SHA. See [Development snapshots](#development-snapshots) if you need to consume
one.

```ts
import { entity, makeTreeSpec } from '@effect-state-tree/core'
import { defineTree } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
}).pipe(entity({ type: 'Todo', id: 'id' }))

type Todo = typeof Todo.Type

const TodoList = Schema.Struct({
  todos: Schema.Array(Todo),
})

const TodoTree = defineTree(
  '@example/TodoTree',
  makeTreeSpec(TodoList)
)

const addTodo = TodoTree.update((root, todo: Todo) => {
  root.todos.push(todo)
})

const program = Effect.gen(function* () {
  yield* addTodo({
    id: 'first',
    title: 'Try effect-state-tree',
    done: false,
  })

  return yield* TodoTree.get
}).pipe(Effect.provide(TodoTree.layer({ todos: [] })))

const snapshot = await Effect.runPromise(Effect.scoped(program))
```

The update recipe receives a temporary mutable view. If the update is accepted,
the store publishes a new immutable snapshot and one commit containing the
forward and inverse changes.

## Design

effect-state-tree starts with a small kernel for snapshots, paths, identity,
patches, and reconciliation. The live store and every higher-level feature
consume that same kernel instead of defining their own state format.

This separation is intentional:

- pure snapshot and patch operations can be used without a live store;
- applications opt into only the features they need;
- persistence and collaboration share the Schema's encoded representation;
- UI integrations observe a small store view instead of owning canonical state;
- asynchronous actions can perform Effects around short atomic updates.

Read [Design](./docs/design.md) for the complete mental model and the tradeoffs
behind it.

## Inspired by mobx-keystone

effect-state-tree would not exist without
[mobx-keystone](https://github.com/xaviergonz/mobx-keystone). Javier González
Garcés and everyone who has contributed to the project have done extraordinary
work exploring how a TypeScript state tree can combine approachable mutable
updates with immutable snapshots, patches, identity, reconciliation,
references, drafts, undo and redo, and collaborative state.

Their work is the direct inspiration for this library. effect-state-tree
explores these ideas through Effect and Effect Schema, but much of what it is
trying to accomplish was made imaginable—and substantially clearer—by the work
of the mobx-keystone community. We are deeply grateful to them and strongly
encourage readers to explore the
[mobx-keystone documentation](https://mobx-keystone.js.org/) and support the
project.

## Packages

### State tree

| Package | Purpose |
| --- | --- |
| [`@effect-state-tree/core`](./packages/core) | Schemas, immutable snapshots, paths, identity, references, patches, and reconciliation |
| [`@effect-state-tree/producer`](./packages/producer) | Mutable-looking update recipes and intent-preserving tree operations |
| [`@effect-state-tree/runtime`](./packages/runtime) | Effect services, stores, updates, actions, selectors, and commit streams |

### Optional capabilities

| Package | Purpose |
| --- | --- |
| [`@effect-state-tree/validation`](./packages/validation) | Native Effect Schema reports and latest-valid checkpoints |
| [`@effect-state-tree/draft`](./packages/draft) | Editable drafts with saved checkpoints and submission reconciliation |
| [`@effect-state-tree/history`](./packages/history) | Undo, redo, grouping, limits, and attached state |
| [`@effect-state-tree/persistence`](./packages/persistence) | Schema-coded persistence and versioned migrations |
| [`@effect-state-tree/devtools`](./packages/devtools) | Commit inspection and programmatic time travel |

### Integrations

| Package | Purpose |
| --- | --- |
| [`@effect-state-tree/persistence-browser`](./packages/persistence-browser) | LocalStorage, SessionStorage, and IndexedDB layers |
| [`@effect-state-tree/crdt`](./packages/crdt) | Shared coordination for collaborative backends |
| [`@effect-state-tree/yjs`](./packages/yjs) | Yjs maps, arrays, text, and local-intention undo |
| [`@effect-state-tree/loro`](./packages/loro) | Loro maps, lists, movable lists, text, and local-intention undo |
| [`@effect-state-tree/atom`](./packages/atom) | Effect Atom selectors, runtimes, and function atoms |
| [`@effect-state-tree/foldkit`](./packages/foldkit) | Pure Model, Message, update, and Command-style interpretation |

## Examples

- [React todo](./apps/react-todo-example) demonstrates a validated draft,
  history, optimistic saves, request races, and Effect Atom React bindings.
- [React Loro collaboration](./apps/react-loro-collaboration-example)
  demonstrates multiple browser peers, movable lists, collaborative text,
  reconnects, and peer-local undo.

## Documentation

- [Design](./docs/design.md)
- [Validation and editable state](./docs/validation.md)
- [Stability and limitations](./docs/stability.md)

## Development snapshots

After CI succeeds for a commit pushed to `main`, GitHub Actions automatically
creates a development snapshot. A snapshot uses:

- GitHub tag `snapshot-COMMIT`, where `COMMIT` is the full 40-character SHA;
- one tarball per public package;
- the ordinary package manifests and compiled `dist` output from that commit.

The commit in the release URL is the snapshot identity. The `0.1.0` version
inside an archive is only package metadata and does not promise compatibility.

Each package can be installed from its release asset. Until the packages are
published to a registry, Bun consumers must also override internal package
dependencies so Bun resolves them to assets from the same snapshot:

```json
{
  "dependencies": {
    "@effect-state-tree/core": "https://github.com/run4w4y/effect-state-tree/releases/download/snapshot-COMMIT/effect-state-tree-core-0.1.0.tgz",
    "@effect-state-tree/producer": "https://github.com/run4w4y/effect-state-tree/releases/download/snapshot-COMMIT/effect-state-tree-producer-0.1.0.tgz",
    "@effect-state-tree/runtime": "https://github.com/run4w4y/effect-state-tree/releases/download/snapshot-COMMIT/effect-state-tree-runtime-0.1.0.tgz",
    "effect": "4.0.0-beta.99"
  },
  "overrides": {
    "@effect-state-tree/core": "https://github.com/run4w4y/effect-state-tree/releases/download/snapshot-COMMIT/effect-state-tree-core-0.1.0.tgz",
    "@effect-state-tree/producer": "https://github.com/run4w4y/effect-state-tree/releases/download/snapshot-COMMIT/effect-state-tree-producer-0.1.0.tgz",
    "@effect-state-tree/runtime": "https://github.com/run4w4y/effect-state-tree/releases/download/snapshot-COMMIT/effect-state-tree-runtime-0.1.0.tgz"
  }
}
```

Use the same full SHA in every URL. Add each effect-state-tree package needed by
the application and its internal dependency graph to both sections. This
temporary override is unnecessary once the packages are available from a
registry.

Always commit the consumer's lockfile. A newer snapshot is a deliberate source
upgrade, not a compatible package update.
