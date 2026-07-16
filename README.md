# Effect Tree

Effect Tree is an Effect v4 Schema-native state system built around one small
kernel: immutable tree snapshots, tuple paths, ordered patches, inverse patches,
identity, and reconciliation. The live store, validation, drafts, history,
persistence, CRDTs, devtools, and frontend bindings are separate consumers of
that kernel.

The workspace is pinned to `effect@4.0.0-beta.97`. It deliberately has no MobX,
mobx-keystone, React, or Atom dependency in its core.

## Quick start

```ts
import { entity, makeTreeSpec } from '@effect-state-tree/core'
import { makeHistory } from '@effect-state-tree/history'
import { defineTree, makeTreeAction } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
}).pipe(entity({ type: 'Todo', id: 'id' }))

type Todo = typeof Todo.Type

const Root = Schema.Struct({
  todos: Schema.Array(Todo),
})

const TodoTree = defineTree('@example/TodoTree', makeTreeSpec(Root))

const addTodo = makeTreeAction(
  TodoTree,
  (root, todo: Todo) => {
    root.todos.push(todo)
  },
  (todo) => ({ label: `Add ${todo.title}` })
)

const program = Effect.gen(function* () {
  const store = yield* TodoTree.service
  const history = makeHistory(store)

  yield* addTodo({
    id: 'todo-1',
    title: 'Ship Effect Tree',
    done: false,
  })
  yield* history.undo
  yield* history.redo
}).pipe(Effect.provide(TodoTree.layer({ todos: [] })))

Effect.runPromise(Effect.scoped(program))
```

Effects own execution, services, failures, interruption, and asynchronous work.
A committed patch set owns state atomicity. Mutable-looking recipes are temporary
mutation producers; the canonical value is always an immutable snapshot.
Fallible pure kernel operations use Effect's native `Result`; live operations
use typed `Effect` error channels.

Framework command hooks default to `execution: 'switch'`, which interrupts a
superseded invocation. Use `execution: 'merge'` for discrete operations where
every invocation must finish. All direct adapters subscribe through the shared
`StoreView` protocol; only the optional Atom package uses Effect Atom.

Native mutable values such as `Date` and `Map` are not admitted implicitly.
Register an `AtomicInterpreter` when a domain value has a sound immutable
capture strategy. `dateAtomicInterpreter` is an explicit compatibility option,
but its immutable Date-like proxy is not structured-cloneable; ISO strings or
epoch milliseconds are the more portable canonical representation.

## Workspace

The repository follows the same local-tooling shape as the `cv` workspace:

- Nx owns the project graph, target dependencies, and caching.
- Bun owns the lockfile, workspaces, scripts, and unit-test runtime.
- `flake.nix` provisions Bun, Node 22, Chromium, Git, nixfmt, and shellcheck.
- direnv activates the flake and disables the Nx daemon.

```sh
direnv allow
bun install
bun run check
bun run graph
```

## Packages

| Package | Responsibility |
| --- | --- |
| `@effect-state-tree/core` | Schema specs, immutable snapshots, paths, identity, refs, patch/inverse-patch laws, reconciliation, path codecs |
| `@effect-state-tree/producer` | Temporary mutation recipes and semantic object/array/move/text operations |
| `@effect-state-tree/runtime` | Effect v4 transactional store, commit stream, guards, sinks, selectors, provenance |
| `@effect-state-tree/validation` | Lifecycle-aware native Schema checks and path-indexed issue reports |
| `@effect-state-tree/draft` | Same-Schema draft stores built only from public tree/runtime operations |
| `@effect-state-tree/history` | Undo, redo, grouping, skipping, limits, and attached state |
| `@effect-state-tree/persistence` | Schema-coded persistence binding and JSON key-value adapter |
| `@effect-state-tree/persistence-browser` | Official Effect LocalStorage, SessionStorage, and IndexedDB layers |
| `@effect-state-tree/crdt` | Serialized, identity-aware CRDT binding and provenance contract |
| `@effect-state-tree/yjs` | Y.Map/Y.Array/Y.Text adapter with one Y transaction per commit |
| `@effect-state-tree/loro` | Loro map/list/movable-list/text adapter with native move support |
| `@effect-state-tree/devtools` | Commit timeline, patches, snapshots, and programmatic time travel |
| `@effect-state-tree/atom` | Adapter for Effect v4 `effect/unstable/reactivity` atoms |
| `@effect-state-tree/react` | Generic `useSyncExternalStore` hooks, typed tree bindings, and Effect commands |
| `@effect-state-tree/solid` | Owner-scoped selector signals and typed context bindings |
| `@effect-state-tree/vue` | Scope-managed selector refs and provide/inject bindings |
| `@effect-state-tree/svelte` | Readable selector stores and typed context bindings |
| `@effect-state-tree/foldkit` | Pure Model/Message/update/Command-compatible reducer interpreter |

## Example applications

[`apps/react-todo-example`](./apps/react-todo-example) is a production-built
todo app with an Effect v4 `HttpApi` server. One long-lived same-Schema draft
holds every local edit and its patch history; Save performs an optimistic typed
request and reconciles the server's authoritative response into the original
tree. It also demonstrates context-resolved actions, stable inline selectors,
`AsyncResult` command state, Schema diagnostics, StyleX, and Playwright tests
for conflicts and draft isolation.

[`apps/react-loro-collaboration-example`](./apps/react-loro-collaboration-example)
runs one independent peer per browser page against an Effect WebSocket room
server. Any number of peers and isolated rooms can collaborate through native
Loro movable-list and text operations, automatic reconnect, provenance and
echo suppression, commit feeds, and peer-local intention undo.

```sh
bun x nx dev:server @effect-state-tree/react-todo-example
bun x nx dev @effect-state-tree/react-todo-example
bun x nx dev:server @effect-state-tree/react-loro-collaboration-example
bun x nx dev @effect-state-tree/react-loro-collaboration-example
bun run test:e2e
```

See [architecture.md](./docs/architecture.md), [validation.md](./docs/validation.md),
and [implementation-status.md](./docs/implementation-status.md) for the design
contract and the remaining beta-era limitations.
