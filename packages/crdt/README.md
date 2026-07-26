# @effect-state-tree/crdt

`@effect-state-tree/crdt` is the backend-neutral collaboration layer for
effect-state-tree. It connects one live tree store to a Schema-coded CRDT
adapter, serializes local and inbound work, suppresses echoes, rebases pending
local changes, and supervises the synchronization workers.

Most applications use this package together with
[`@effect-state-tree/yjs`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/yjs) or
[`@effect-state-tree/loro`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/loro). Adapter authors implement the
`CrdtAdapter` interface directly.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Bind a store to an adapter

`bindCrdt` accepts any adapter with the same tree specification:

```ts
import {
  bindCrdt,
  type CrdtAdapter,
} from '@effect-state-tree/crdt'
import type { TreeStore } from '@effect-state-tree/runtime'
import { Effect, type Schema } from 'effect'

const synchronize = <
  S extends Schema.Constraint,
  E,
  R,
>(
  store: TreeStore<S>,
  adapter: CrdtAdapter<S, E, R>
) =>
  Effect.gen(function* () {
    const binding = yield* bindCrdt(store, adapter, {
      initialize: 'backend',
    })

    yield* binding.ready
    yield* binding.idle
    return yield* binding.health
  })
```

Run this Effect inside an Effect Scope and provide any requirements declared by
the adapter. Scope finalization shuts down the binding.

Initialization can read the `backend`, write the current `store`, or do `none`
of those before live synchronization starts.

## Describe collaboration intent in the Schema

The shared annotations let backend adapters select native representations:

```ts
import {
  collaborativeText,
  entity,
} from '@effect-state-tree/core'
import { movableList } from '@effect-state-tree/crdt'
import { Schema } from 'effect'

const Card = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).pipe(entity({ type: 'Card', id: 'id' }))

const Board = Schema.Struct({
  cards: Schema.Array(Card).pipe(movableList),
  notes: Schema.String.pipe(collaborativeText),
})
```

Loro can materialize `cards` as a native movable list. Yjs lowers the same move
intent to its closest native array operation. Both adapters can materialize
`notes` as collaborative text.

To preserve that intent, use runtime `operationUpdate` or the producer's
operation recorder for list moves, splices, object edits, and text edits.
Universal patches remain the correctness fallback.

## Binding health and lifecycle

A `CrdtBinding` provides:

- `ready` when observers and workers are installed;
- `idle` when all work currently queued has settled;
- `health` with starting, running, failed, or shutdown state;
- `failure` and `await` for supervision;
- `shutdown` for idempotent explicit cleanup.

Inbound changes are reread from the authoritative document after their
notification is dequeued. Pending local commits are projected over that value
and relocated through entity identity where possible.

The binding coordinates tree and document state. Network providers,
authentication, awareness, room membership, document storage, and transport
reconnection remain application responsibilities.

## Backend adapters

- [`@effect-state-tree/yjs`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/yjs) supports Y.Map, Y.Array, Y.Text,
  and Yjs local-intention undo.
- [`@effect-state-tree/loro`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/loro) supports maps, lists, movable
  lists, text, and Loro local-intention undo.
- The [React Loro collaboration
  example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-loro-collaboration-example) includes a
  real WebSocket room transport around this binding.
