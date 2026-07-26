# @effect-state-tree/yjs

`@effect-state-tree/yjs` adapts a Schema-defined effect-state-tree to a Yjs
document. It materializes objects, arrays, and annotated collaborative text as
Yjs types, translates semantic operations where possible, and exposes
peer-local Yjs undo.

The adapter handles the document model. Choosing a Yjs network provider,
awareness protocol, authentication model, and persistence strategy remains an
application decision.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` and `yjs@13.6.31` as
peer dependencies. Every API should be treated as experimental.

## Synchronize a Yjs document

```ts
import {
  collaborativeText,
  makeTreeSpec,
} from '@effect-state-tree/core'
import { bindCrdt } from '@effect-state-tree/crdt'
import { makeTreeStoreScoped } from '@effect-state-tree/runtime'
import { makeYjsAdapter } from '@effect-state-tree/yjs'
import { Effect, Schema } from 'effect'
import * as Y from 'yjs'

const Document = Schema.Struct({
  title: Schema.String,
  notes: Schema.String.pipe(collaborativeText),
})

const spec = makeTreeSpec(Document)
const doc = new Y.Doc()
const adapter = makeYjsAdapter(spec, { doc, rootName: 'document' })

const program = Effect.gen(function* () {
  const store = yield* makeTreeStoreScoped(spec, {
    title: 'Shared document',
    notes: '',
  })
  const binding = yield* bindCrdt(store, adapter, {
    initialize: 'store',
  })

  yield* binding.ready
  yield* store.update((_state, operations) => {
    operations.textInsert(['notes'], 0, 'Hello from this peer')
  })
  yield* binding.idle

  return yield* adapter.readSnapshot
})

const snapshot = await Effect.runPromise(Effect.scoped(program))

await Effect.runPromise(adapter.undo.dispose)
doc.destroy()
```

The `notes` field is stored as `Y.Text`. Other strings remain ordinary encoded
strings. You can also pass explicit `collaborativeTexts` paths when the
selection should not live in the Schema.

## Schema codecs and root shape

The decoded tree is encoded through the specification's JSON codec before it
enters Yjs. Transformed Schema values therefore keep their application types
while Yjs stores valid JSON-compatible data.

The encoded root must be an object. Its properties are stored directly in the
configured root `Y.Map`.

## Updates and undo

`makeYjsAdapter` exposes:

- `doc`, `root`, and the adapter's unique transaction `origin`;
- the standard `CrdtAdapter` read, write, change stream, and commit methods;
- `undo`, backed by a `Y.UndoManager` that tracks only this adapter's origin.

Use semantic operation updates for collaborative text, array splices, moves,
and object edits. When an operation cannot be represented safely, the adapter
reconciles the encoded snapshot as a fallback.

`adapter.undo.undo` and `adapter.undo.redo` compensate this peer's own
operations against the current collaborative document. Dispose the undo
controller and the externally owned `Y.Doc` when the application no longer
needs them.

## Related packages

- [`@effect-state-tree/crdt`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/crdt) owns coordination, rebasing,
  echo suppression, and worker supervision.
- [`@effect-state-tree/loro`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/loro) is the alternative Loro backend
  with native movable lists.
