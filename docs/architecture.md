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
    ↓                                      ↓
Effect Atom projection                    Foldkit
    ↓
official Effect Atom framework bindings
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
- transaction ID, optional enclosing action ID/name, source token, tags, label,
  metadata, and commit time.

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
Path checkpoints capture a value and revision from one store. Conditional
updates revalidate the captured path inside the same retry-safe commit loop, so
unrelated commits proceed while stale asynchronous responses cannot overwrite a
changed path.

## Plugins

History is a reducer/controller over committed forward and inverse patches;
tagged baseline commits reset its stacks in revision order. Drafts are
independent ordinary tree stores using the same Schema, with commit, reset,
partial commit/reset, dirty checks, identity preconditions, and checkpointed
submit/refresh reconciliation. Validation keeps native `SchemaIssue` trees in a
sidecar report. None of these concepts changes the kernel.

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

`@effect-state-tree/atom` is the single reactive UI projection. It converts
`StoreView` values into scoped Atoms and derives an `AtomRuntime` whose Layer
already contains the tree's typed Effect service. The canonical store remains
outside Atom; Atom owns subscription lifecycle, reactive composition, Effect
execution, and asynchronous UI state.

Applications create Atom identities once when admitting their store. Stable
parameterized projections use `Atom.family`. Selector atoms retain the
runtime's path filtering, equality, and structural-sharing behavior, so UI code
does not recreate selector memoization or subscribe directly to the store.

Tree definitions derive typed updates and full actions. Updates accept one typed
input, resolve their store through Effect Context, and commit one synchronous
mutation recipe. Actions use `Effect.fn`, may resolve API clients and other
services, await asynchronous work, and use tree updates as short atomic commit
points. Commits inherit their enclosing action ID/name; tree mutation recipes
themselves never suspend.

`TreeAtoms.fn` is Effect Atom's native runtime function constructor, so results
use native `AsyncResult` and accept native reset/interruption controls. Its
`concurrent` option is passed through unchanged: the default interrupts a
superseded invocation, while `concurrent: true` preserves every independent
invocation.

UI components consume these atoms through Effect's official framework binding
packages. This project ships no framework-specific hook, signal, ref, provider,
or command abstraction. Foldkit remains a separate pure reducer interpreter so
its Model changes only through `update`.
