# Stability and limitations

effect-state-tree has no supported release. The repository is public for
development and dogfooding, and every API should be treated as changeable.

## Development snapshots

An on-demand snapshot is identified by the exact Git commit from which it was
built. Each public package is available as a separate archive attached to the
matching `snapshot-<full commit SHA>` GitHub prerelease.

The package version inside an archive does not describe compatibility or
identify the source commit. Consumer applications should pin complete
release-asset URLs, use the same commit for the entire package graph, and commit
their lockfiles. Bun consumers also need `overrides` that map internal
effect-state-tree dependencies to archives from that commit; the README
contains a complete example.

Snapshots are unsupported:

- no snapshot receives bug-fix or security backports;
- a later commit may contain breaking source and data-format changes;
- no moving tag points to a recommended snapshot;
- the repository may decline migration paths until a real release policy
  exists.

## Current compatibility

- Packages are ESM-only.
- `effect` and Effect platform package versions come from one root catalog,
  currently pinned to `4.0.0-beta.99`.
- Effect Atom integration uses APIs under `effect/unstable/reactivity`.
- Browser examples use React 19 and the official `@effect/atom-react` binding.
- Automated tests currently exercise Bun, Node.js, Chromium, in-memory Yjs, and
  in-memory Loro behavior. That does not yet constitute a support matrix.

## State values

Primitives, arrays, plain objects, and values handled by a registered atomic
interpreter can be part of a tree.

Mutable native values are rejected unless explicitly supported. The optional
Date interpreter produces an immutable Date-like value that is not
structured-cloneable; ISO strings or epoch milliseconds are more portable.

Traversal through arbitrary transformed Schema containers is not generally
supported. Treat such a value as an atomic leaf unless its structure is known
to the tree specification.

## Validation

Native Effect Schema filter checks are currently synchronous. Effectful Schema
encoding and decoding are supported at boundaries, but effectful live
validation checks are not.

## Collaboration

The Yjs and Loro packages integrate effect-state-tree stores with documents and
local undo managers. Network providers, authentication, awareness, storage, and
room lifecycle remain application responsibilities.

## Devtools and UI

Devtools currently provides a framework-neutral data and controller layer, not
a browser overlay.

Effect Atom is the only reactive UI projection in this repository. Components
use the official Effect Atom binding for their framework; effect-state-tree does
not ship duplicate React hooks or providers.
