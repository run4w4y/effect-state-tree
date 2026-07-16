# Architecture

## Dependency rule

```text
Effect Schema
    ↓
pure tree kernel ── producer
    ↓                 ↓
Effect runtime and commit envelopes
    ↓
validation · drafts · history · persistence · CRDT · devtools
    ↓
React · Solid · Vue · Svelte · Effect Atom · Foldkit
```

The kernel contains no runtime service, history manager, draft type, backend,
or frontend concept. Its public vocabulary is `TreeSpec`, snapshot, path,
identity, patch, inverse patch, reconciliation, and Schema codec projection.

## Canonical state

The canonical tree is an immutable decoded `Schema.Type<S>`. Arrays and plain
objects are cloned and frozen on admission. Mutable native values such as
`Date` and `Map` are rejected by default. Application-defined non-plain values
require an `AtomicInterpreter` that captures and verifies an immutable leaf;
shallow `Object.freeze` is not accepted as proof of immutability.

Native `Date` compatibility is available only by explicitly registering
`dateAtomicInterpreter`. It captures a Date-like immutable proxy, which is not
structured-cloneable. Canonical ISO strings or epoch milliseconds are preferred
when application state must cross generic platform boundaries.

Every `TreeSpec` derives Effect Schema's canonical JSON codec with
`Schema.toCodecJson`. JSON Patch, persistence, Loro, and Yjs all use that same
codec, including at path-local patch values, instead of relying on JavaScript's
implicit `JSON.stringify` coercions.

Each non-atomic object has one logical parent within a revision. Structural
sharing across revisions is expected and tested. Entity identity is declared by
a Schema annotation and is represented as `(entity type, id)`, never durable
JavaScript object identity.

## Commits

A store commit has:

- before/after immutable snapshots;
- monotonically increasing revisions;
- ordered forward and directly executable inverse patches;
- touched paths;
- optional semantic operations and their inverses;
- transaction ID, source token, tags, label, metadata, and commit time.

Patch values are captured and frozen when the patch is accepted. A caller cannot
mutate history, replay, persistence, or CRDT output after the fact.

`TxRef` and `TxPubSub` atomically publish state and the commit envelope. Proposal
guards may be re-evaluated after a conflicting revision and therefore must be
retry-safe. Effectful persistence, CRDT writes, analytics, and other once-only
work consume the post-commit stream instead of running inside a retryable
transaction.

The runtime can be allocated directly, as a scoped resource, or behind a typed
Effect `Context.Service` and `Layer`. Commit timestamps come from Effect Clock,
and transaction identifiers are supplied by an injectable Effect service.

## Plugins

History is a reducer/controller over committed forward and inverse patches.
Drafts are independent ordinary tree stores using the same Schema, with commit,
reset, partial commit/reset, dirty checks, and identity preconditions. Validation
keeps native `SchemaIssue` trees in a sidecar report. None of these concepts
changes the kernel.

## CRDT semantics

Patches are the universal correctness format. Semantic operations preserve
intent for object changes, splices, list moves, and collaborative text. Adapters
must cover mixed recipes safely; they may use semantic operations only when the
remaining patch state is also materialized.

The common binding serializes inbound and outbound work, re-reads the
authoritative document, rebases queued local commits, and relocates paths through
stable entity identities after remote list moves. Source tokens suppress echoes;
there is no local/remote distinction in the pure patch kernel.

Loro maps `ArrayMove` to a native movable-list move. Yjs lowers it to delete and
insert in one Y transaction because Y.Array has no native move operation.
Both adapters expose backend-native local-intention undo. The common binding
supervises its inbound and coordinator fibers and exposes readiness, health,
idle, failure, and shutdown Effects.

## Frontends

The runtime exposes `StoreView<A>`:

```ts
interface StoreView<A> {
  getSnapshot(): A
  subscribe(listener: () => void): () => void
  readonly changes: Stream.Stream<A>
}
```

Direct framework adapters consume that protocol. The Effect Atom adapter is an
optional projection, not an owner of canonical state. Foldkit uses the pure
reducer face so its Model still changes only through `update`.

React adapts `StoreView` with `useSyncExternalStore`, Solid with signals, Vue
with shallow refs, and Svelte with readable stores. History, validation, and
other plugin controllers already implement `StoreView`, so framework packages
do not depend on those plugins or add plugin-specific subscription wrappers.
`@effect-state-tree/atom` is the only Atom-powered integration path; direct framework
adapters do not create or depend on atoms.

`StoreView.getSnapshot` is a cached value, as required by React's external-store
contract. The React selector binding likewise exposes only a cached scalar
version to `useSyncExternalStore`: store notifications reconcile the projection
once, while inline selector closures refresh during their ordinary component
render without resubscribing or mutating that external version. Derived arrays
therefore require neither `useMemo` nor a framework-specific atom wrapper.

Command controllers also expose a `StoreView<AsyncResult<...>>`. Their overlap
policy is explicit: `execution: 'switch'` is the default and interrupts a
superseded invocation, while `execution: 'merge'` lets every invocation finish.
Switch is appropriate for replacement-style work such as rapidly changing a
search or title; merge is appropriate for discrete mutations where no click or
submission may be discarded.
