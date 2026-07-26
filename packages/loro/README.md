# @effect-state-tree/loro

`@effect-state-tree/loro` adapts a Schema-defined effect-state-tree to a Loro
document. It supports native maps, lists, movable lists, collaborative text,
semantic operation translation, and peer-local Loro undo.

The adapter handles the document model. Network transport, authentication,
awareness, room lifecycle, and durable document storage remain application
responsibilities.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` and
`loro-crdt@1.13.6` as peer dependencies. Every API should be treated as
experimental.

## Synchronize movable lists and text

```ts
import {
  collaborativeText,
  entity,
  makeTreeSpec,
} from '@effect-state-tree/core'
import {
  bindCrdt,
  movableList,
} from '@effect-state-tree/crdt'
import { makeLoroAdapter } from '@effect-state-tree/loro'
import { makeTreeStoreScoped } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'
import { LoroDoc } from 'loro-crdt'

const Card = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).pipe(entity({ type: 'Card', id: 'id' }))

const Board = Schema.Struct({
  cards: Schema.Array(Card).pipe(movableList),
  notes: Schema.String.pipe(collaborativeText),
})

const spec = makeTreeSpec(Board)
const doc = new LoroDoc()
const adapter = makeLoroAdapter(spec, { doc, rootName: 'board' })

const program = Effect.gen(function* () {
  const store = yield* makeTreeStoreScoped(spec, {
    cards: [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
    ],
    notes: '',
  })
  const binding = yield* bindCrdt(store, adapter, {
    initialize: 'store',
  })

  yield* binding.ready
  yield* store.update((_state, operations) => {
    operations.arrayMove(['cards'], 1, 0)
    operations.textInsert(['notes'], 0, 'Edited together')
  })
  yield* binding.idle

  return yield* adapter.readSnapshot
})

const snapshot = await Effect.runPromise(Effect.scoped(program))

await Effect.runPromise(adapter.undo.dispose)
doc.free()
```

The `cards` array is materialized as `LoroMovableList`, and `notes` as
`LoroText`. Other arrays and strings use ordinary Loro lists and encoded
strings.

## Schema codecs and container policy

The decoded tree is encoded through its Effect Schema JSON codec before it is
written. Rich application values can therefore retain their decoded types while
the Loro document stores JSON-compatible data.

Schema annotations are the usual way to request movable lists and collaborative
text. `makeLoroAdapter` also accepts explicit `movableLists` and
`collaborativeTexts` paths for application-selected materialization.

The encoded root must be an object, whose properties are stored in the
configured root `LoroMap`.

## Updates and undo

The adapter translates `ObjectSet`, `ObjectDelete`, `ArraySplice`, `ArrayMove`,
`TextInsert`, and `TextDelete` intent into native Loro operations. It reconciles
the encoded snapshot in the same commit as a correctness fallback for ordinary
patch-only updates.

`adapter.undo` wraps Loro's current-peer `UndoManager`. Undo and redo compensate
only this peer's intentions against the current collaborative document. A Loro
undo manager is permanently associated with the document peer current at
construction time.

The caller owns the `LoroDoc`; dispose the undo controller and free the document
when finished.

## Real application example

The [React Loro collaboration
example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-loro-collaboration-example) demonstrates:

- one independent store and Loro document per browser peer;
- a WebSocket room protocol and reconnecting transport;
- movable cards and collaborative notes;
- late-peer bootstrap and peer-local undo;
- Effect Atom projections into React.

## Related packages

- [`@effect-state-tree/crdt`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/crdt) owns coordination, rebasing,
  echo suppression, and worker supervision.
- [`@effect-state-tree/yjs`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/yjs) is the alternative Yjs backend.
