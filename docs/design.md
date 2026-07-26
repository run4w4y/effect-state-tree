# Design

effect-state-tree is built around one idea: state should be easy to update
locally while remaining immutable, inspectable, and portable at its boundaries.

This guide describes the public mental model. It intentionally avoids relying
on private runtime machinery.

## A Schema defines a tree

An Effect Schema describes the accepted state and, when the state crosses a
storage or collaboration boundary, its encoded representation.

`makeTreeSpec(schema)` prepares that Schema for tree operations. It does not
create live state. A tree definition then gives the specification a stable
application identity and derives its store service, updates, and actions:

```ts
const DocumentTree = defineTree(
  '@example/DocumentTree',
  makeTreeSpec(Document)
)
```

Different definitions remain different Effect services even if their Schemas
have the same TypeScript shape.

## Snapshots are canonical

The value held by a store is an immutable snapshot. Plain objects and arrays are
captured so that a caller cannot mutate committed state later. Unchanged
branches are shared between revisions, making reference equality useful for
selectors and UI rendering.

A non-atomic object belongs to one location in a tree revision. Reusing the same
mutable object in multiple branches is rejected rather than silently creating
aliases.

Native mutable values such as `Date` and `Map` are not accepted automatically.
Applications can register an atomic interpreter when they have a sound
immutable representation, but portable values such as ISO date strings are
usually a better fit for persisted or collaborative state.

## Updates produce commits

An update recipe receives a temporary mutable view:

```ts
const rename = DocumentTree.update(
  (document, title: string) => {
    document.title = title
  }
)
```

Calling `rename("New title")` creates an Effect. When that Effect runs, it
resolves the matching tree store from Effect Context and attempts one atomic
commit.

An accepted commit contains the snapshots before and after the update, its
revision, ordered forward and inverse patches, affected paths, and optional
labels or application metadata. History, persistence, collaboration, and
devtools all observe this shared commit format.

The mutable view never escapes the recipe. The result is always another
immutable snapshot.

## Actions surround short updates

Updates are synchronous state transitions. Actions are ordinary Effects that
may call services, wait for remote work, and perform several short updates:

```ts
const saveDocument = DocumentTree.action(
  'Save document',
  () =>
    Effect.gen(function* () {
      const document = yield* DocumentTree.get
      const saved = yield* saveToServer(document)
      yield* installSavedDocument(saved)
    })
)
```

This keeps network and other once-only work outside retryable state changes.
Commits created inside an action inherit its identity and name, which makes a
larger workflow visible without holding a lock while it waits.

## Identity survives reconciliation

Objects can declare stable entity identity through Schema annotations. Identity
supports typed references, detects duplicate IDs, and allows reconciliation to
preserve unchanged entities when authoritative data arrives in a different
array order.

JavaScript object identity is never treated as a durable ID. Persistence and
collaboration use the explicit entity type and ID stored in the data.

## Features remain separate

The packages form layers around the same state-tree model:

```text
Effect Schema
    ↓
snapshots · paths · identity · patches · reconciliation
    ↓
mutable-looking producer
    ↓
Effect store · updates · actions · commit stream
    ↓
validation · drafts · history · persistence · collaboration · devtools
    ↓
Effect Atom and other application projections
```

The separation has practical consequences:

- The core does not require a UI framework or collaboration backend.
- Drafts are ordinary independent trees, not a special mutable mode.
- Validation stays beside editable state instead of changing its shape.
- History stores bounded patch sets rather than full document copies.
- Backend adapters translate the same encoded state and commit information.
- Frontend integrations subscribe to the store without becoming the source of
  truth.

## Collaboration preserves correctness and intent

Patches are the universal description of a state change. Updates may also
record semantic intent for operations where a collaboration backend can do
better than a generic patch—for example, moving a list item or editing shared
text.

The Yjs and Loro packages translate that information to their native document
types. They operate on documents; choosing and configuring a network provider
remains an application decision.

## Tradeoffs

effect-state-tree is deliberately opinionated:

- State must fit a tree with one logical parent per object.
- Schema checks, encoding, and tree invariants are part of state admission.
- Updates cannot suspend; asynchronous work belongs in actions.
- Effect and the unstable Effect Atom APIs currently tie snapshots to an exact
  Effect beta version.
- The package split favors explicit capabilities over a single all-inclusive
  dependency.

See [Stability and limitations](./stability.md) for the constraints that matter
when experimenting with the current source.
