# @effect-state-tree/producer

`@effect-state-tree/producer` turns a short mutable-looking recipe into a new
immutable effect-state-tree snapshot. Each successful recipe includes forward
and inverse patches, touched paths, and optional semantic operations for
collaboration backends.

Use the producer directly for pure, synchronous state transitions. Applications
that need a live Effect service normally use
[`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime), whose store updates are
powered by this package.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for `@effect-state-tree/core` and this package.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Produce an immutable change

```ts
import {
  collaborativeText,
  entity,
  makeTreeSpec,
} from '@effect-state-tree/core'
import { produceTreeChange } from '@effect-state-tree/producer'
import { Result, Schema } from 'effect'

const Item = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).pipe(entity({ type: 'Item', id: 'id' }))

const Board = Schema.Struct({
  items: Schema.Array(Item),
  notes: Schema.String.pipe(collaborativeText),
})

const spec = makeTreeSpec(Board)
const initial = {
  items: [
    { id: 'a', title: 'First' },
    { id: 'b', title: 'Second' },
  ],
  notes: 'Shared: ',
}

const produced = produceTreeChange(
  spec,
  initial,
  (draft, operations) => {
    draft.items[0]!.title = 'Updated'
    operations.arrayMove(['items'], 1, 0)
    operations.textInsert(['notes'], draft.notes.length, 'hello')
  }
)

if (Result.isFailure(produced)) {
  throw produced.failure
}

console.log(produced.success.snapshot)
console.log(produced.success.change.patches.forward)
console.log(produced.success.change.operations)
```

The input is not changed. Only the temporary `draft` inside the recipe is
mutable, and the resulting snapshot is admitted through the tree
specification before it is returned.

## Ordinary changes and semantic intent

Direct assignments, object edits, and array mutations produce universal tree
patches. The second recipe argument records operations whose intent matters to a
collaboration backend:

- `objectSet` and `objectDelete`;
- `arraySplice` and `arrayMove`;
- `textInsert` and `textDelete`.

The patch set remains the correctness fallback. Semantic operations let an
adapter preserve a native list move or collaborative text edit instead of
reducing it to generic replacements. Every recorded operation also has inverse
intent for undo.

Recipes are synchronous. Network calls, timers, and other asynchronous work
belong around short producer updates, usually in a runtime
[action](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime#updates-and-actions).

## Result shape

A successful `produceTreeChange` contains:

- `snapshot`: the next immutable tree value;
- `change.patches`: ordered forward and inverse patches;
- `change.operations`: forward semantic operations;
- `change.inverseOperations`: inverse semantic operations;
- `touchedPaths`: tuple paths affected by the patch batch.

A no-op recipe returns the original snapshot and empty change lists.

## Related packages

- [`@effect-state-tree/core`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/core) defines the tree specification
  and validates the result.
- [`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime) serializes concurrent
  recipes into live commits.
- [`@effect-state-tree/crdt`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/crdt) and its backend adapters consume
  semantic intent.
