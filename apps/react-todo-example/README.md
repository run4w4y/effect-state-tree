# React todo example

This application demonstrates effect-state-tree in a complete editable-document
workflow backed by an Effect HTTP API.

The browser keeps one long-lived local draft. People can edit and validate it,
undo and redo changes, then submit the current valid revision with an optimistic
version check. Authoritative server responses are reconciled without erasing
edits made while a request was in flight.

## What the example covers

- Effect Schema as the shared domain, validation, and HTTP contract;
- one authoritative document represented by a local working tree;
- temporary validation failures during editing;
- patch-based undo and redo;
- synchronous tree updates inside asynchronous Effect actions;
- optimistic server version conflicts;
- race-safe draft submission and reconciliation;
- path-aware Effect Atom selectors and the official React binding.

## Run the application

From the repository root, enter the repository's Nix and direnv environment and
install dependencies:

```sh
bun install --frozen-lockfile
```

Start the API and browser application in separate terminals:

```sh
bun x nx dev:server @effect-state-tree/react-todo-example
```

```sh
bun x nx dev @effect-state-tree/react-todo-example
```

Open the URL printed by Rsbuild. The API listens on
`http://127.0.0.1:4312` by default.

## Start with the state model

[`src/shared/todo.ts`](./src/shared/todo.ts) defines every shared Schema:
individual todos, the versioned server document, save requests, UI filters, and
the complete client state. Todo IDs are declared as entity identity:

```ts
export const Todo = Schema.Struct({
  id: Schema.String,
  title: TodoTitle,
  notes: TodoNotes,
  priority: TodoPriority,
  completed: Schema.Boolean,
}).pipe(entity({ type: 'Todo', id: 'id' }))

export const TodoApp = Schema.Struct({
  document: TodoDocument,
  filter: TodoFilter,
})
```

The same domain Schemas cross the network in
[`src/shared/todo-api.ts`](./src/shared/todo-api.ts). That file is the best place
to see how success values and the typed `TodoConflict` error become an Effect
HTTP API contract.

## Follow the client state lifecycle

Read these files in order:

1. [`src/client/state/tree.ts`](./src/client/state/tree.ts) derives a
   check-tolerant working specification with `makeWorkingTreeSpec`, then creates
   the uniquely identified `TodoTree`.
2. [`src/client/state/session.ts`](./src/client/state/session.ts) allocates the
   scoped draft, attaches bounded history to `draft.data`, and provides that
   working store as the `TodoTree` service.
3. [`src/client/state/updates.ts`](./src/client/state/updates.ts) contains the
   short atomic transitions. It contrasts ordinary `update` recipes with
   `operationUpdate` for intent-preserving array insertion and removal.
4. [`src/client/state/actions.ts`](./src/client/state/actions.ts) surrounds
   those updates with API calls, draft submission, reset, history, and conflict
   reconciliation.

The add transition records list intent while still reading like an ordinary
application update:

```ts
export const insertTodo = TodoTree.operationUpdate(
  (state, operations, todo: Todo) => {
    operations.arraySplice(
      ['document', 'todos'],
      state.document.todos.length,
      0,
      todo
    )
  },
  (todo) => ({ label: `Add “${todo.title}”` })
)
```

The save action in
[`src/client/state/actions.ts`](./src/client/state/actions.ts) is the central
workflow to study. `draft.submit` captures the exact submitted revision, calls
the typed API, maps a version conflict to its authoritative server document,
and distinguishes a completely accepted response from one that left newer
local changes pending.

## Follow state into React

[`src/client/state/selectors.ts`](./src/client/state/selectors.ts) defines pure
selectors and their path invalidation policies.

[`src/client/state/atoms.ts`](./src/client/state/atoms.ts) is the bridge from the
application Layer to Effect Atom. It is especially useful for seeing:

- `makeTreeAtomsWithLayer` provide the tree and API services to function atoms;
- tree selectors become read-only atoms;
- the draft, validation controller, and history controller become view atoms;
- `Atom.family` create stable per-todo selectors and actions;
- tree actions retain native Effect Atom asynchronous result behavior.

React consumes those atoms through official hooks. Good focused examples are:

- [`src/client/components/TodoPage.tsx`](./src/client/components/TodoPage.tsx)
  for save, reload, reset, validation, and dirty state;
- [`src/client/components/TodoToolbar.tsx`](./src/client/components/TodoToolbar.tsx)
  for filters and history;
- [`src/client/components/TodoEditor.tsx`](./src/client/components/TodoEditor.tsx)
  for per-entity Atom families and validation issues;
- [`src/client/components/AsyncFailure.tsx`](./src/client/components/AsyncFailure.tsx)
  for rendering a native Atom `AsyncResult` failure.

[`src/main.tsx`](./src/main.tsx) assembles the Managed Runtime, session Layer,
API client, Atom registry, and React root.

## Follow the server boundary

- [`src/server/repository.ts`](./src/server/repository.ts) implements the
  in-memory authoritative document and its optimistic version check.
- [`src/server/handlers.ts`](./src/server/handlers.ts) implements the API
  contract without duplicating request or response types.
- [`src/server/main.ts`](./src/server/main.ts) provides the HTTP layers and
  starts the Bun server.

The server is intentionally small so the example can focus on the boundary
between authoritative state and an editable local draft.

## Things to try

1. Add, edit, complete, and remove todos.
2. Save an empty title or overlong note and inspect the Schema issue.
3. Undo and redo local changes.
4. Save the draft and compare the original and draft versions.
5. Keep editing while a delayed save is running; the newer edit remains
   available after the response.
6. Open another page for the same document, save there, then trigger a version
   conflict in the first page.

## Tests and further reading

```sh
bun x nx test:unit @effect-state-tree/react-todo-example
bun x nx test:e2e @effect-state-tree/react-todo-example
```

Useful test locations:

- [`test/actions.test.ts`](./test/actions.test.ts) exercises drafts, history,
  validation, conflicts, reconciliation, and in-flight edits without React.
- [`test/http-api.test.ts`](./test/http-api.test.ts) verifies the typed HTTP
  contract and repository behavior.
- [`e2e/todo.spec.ts`](./e2e/todo.spec.ts) drives the complete browser and
  server workflow.

For the underlying concepts, read the package guides for
[`@effect-state-tree/draft`](../../packages/draft/README.md),
[`@effect-state-tree/history`](../../packages/history/README.md),
[`@effect-state-tree/validation`](../../packages/validation/README.md), and
[`@effect-state-tree/atom`](../../packages/atom/README.md).
