# React todo example

This application demonstrates the direct React bindings against a real Effect
v4 `HttpApi` server. React bindings are derived from one `TreeDefinition`;
actions resolve the active draft store through Effect Context, so components do
not pass stores to actions or stabilize selectors and commands with `useMemo`
or `useCallback`.

The state workflow is intentionally explicit:

1. The HttpApi client loads an authoritative versioned document into the
   original tree.
2. One same-Schema draft tree remains active for the lifetime of the page.
3. Adds, edits, removals, filters, diagnostics, undo, and redo stay local.
4. Save sends the complete draft with an optimistic version precondition.
5. The server normalizes the document and returns the new authoritative
   version, which is reconciled into both the draft and original tree.
6. Validation failures and version conflicts leave the draft and its history
   intact.

Priorities and filters are rendered from `Schema.Literals`. Command state uses
Effect v4's `AsyncResult`, and the UI is compiled with StyleX. Bun unit tests
exercise the in-memory HttpApi contract, repository conflicts, drafts, history,
validation, and reconciliation. Playwright exercises the complete browser and
server flow.

From the direnv-activated workspace:

```sh
bun x nx dev:server @effect-state-tree/react-todo-example
bun x nx dev @effect-state-tree/react-todo-example
bun x nx test:unit @effect-state-tree/react-todo-example
bun x nx test:e2e @effect-state-tree/react-todo-example
```
