# React todo example

This application demonstrates `@effect-state-tree/atom` through Effect's
official `@effect/atom-react` binding against a real Effect v4 `HttpApi` server.
Atoms are derived once from one admitted draft store; actions resolve that store
through Effect Context, so components neither pass stores to actions nor build
memoized selector and command wrappers.

The page session is a scoped Layer containing only the original store, draft,
history, and validation. Typed `HttpApi` clients are also Effect services.
Definition-derived tree actions own complete workflows: they resolve those
services, perform asynchronous requests, and use context-resolved tree updates
for their atomic commits. There is no application-level lock or separate
workspace workflow object.

The state workflow is intentionally explicit:

1. The HttpApi client loads an authoritative versioned document into the
   original tree.
2. One same-Schema draft tree remains active for the lifetime of the page.
3. Adds, edits, removals, filters, diagnostics, undo, and redo stay local.
4. Save sends the complete draft with an optimistic version precondition.
5. The server normalizes the document and returns the new authoritative
   version, which is always reconciled into the original tree.
6. If the draft has not changed during the request, Save resets it to that
   authoritative version and clears local history. Newer in-flight edits remain
   in the draft and history for a later Save.
7. Validation failures and version conflicts leave the draft and its history
   intact; conflicts still refresh the authoritative original.

Priorities and filters are rendered from `Schema.Literals`. Actions use native
Effect Atom function atoms and `AsyncResult`, and the UI is compiled with
StyleX. The initial load and every command use native Effect Atom `AsyncResult`
state. Bun unit tests exercise the in-memory HttpApi contract, repository
conflicts, drafts, history, validation, reconciliation, and in-flight edits.
Playwright exercises those workflows through the complete browser and server
stack, including delayed save and reload races.

From the direnv-activated workspace:

```sh
bun x nx dev:server @effect-state-tree/react-todo-example
bun x nx dev @effect-state-tree/react-todo-example
bun x nx test:unit @effect-state-tree/react-todo-example
bun x nx test:e2e @effect-state-tree/react-todo-example
```
