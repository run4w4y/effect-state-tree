# React Loro collaboration example

This application demonstrates effect-state-tree collaboration with one
independent tree store and Loro document in every browser page. Peers exchange
Loro updates through a small Effect WebSocket room server and project their
local state into React through Effect Atom.

The example deliberately keeps transport outside the Loro adapter. This makes
it possible to study the separate responsibilities of the tree, CRDT document,
coordination binding, reconnecting network transport, and UI.

## What the example covers

- entity-identified cards stored in a native Loro movable list;
- Schema-annotated collaborative text;
- semantic list, object, and text operations;
- one supervised CRDT binding per browser peer;
- automatic reconnect with offline local editing;
- late peers bootstrapping from the room's current document;
- provenance and echo suppression;
- peer-local intention undo and redo;
- commit inspection through a runtime reducer;
- Effect Atom and the official React binding.

## Run the application

From the repository root, enter the repository's Nix and direnv environment and
install dependencies:

```sh
bun install --frozen-lockfile
```

Start the room server and browser application in separate terminals:

```sh
bun x nx dev:server @effect-state-tree/react-loro-collaboration-example
```

```sh
bun x nx dev @effect-state-tree/react-loro-collaboration-example
```

Open the URL printed by Rsbuild. The **Open another peer** link preserves the
current room and creates a new browser peer identity.

The `room` and `peer` query parameters are arbitrary. A different room name
creates an isolated collaborative document.

## Start with the collaborative Schema

[`src/domain/board.ts`](./src/domain/board.ts) defines the complete tree. This is
the best first file because the Schema expresses both stable identity and CRDT
materialization policy:

```ts
export const Card = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  color: CardColor,
}).pipe(entity({ type: 'Card', id: 'id' }))

export const Board = Schema.Struct({
  cards: Schema.Array(Card).pipe(movableList),
  notes: Schema.String.pipe(collaborativeText),
})

export const BoardTree = defineTree(
  '@effect-state-tree/react-loro-collaboration-example/BoardTree',
  makeTreeSpec(Board)
)
```

The movable-list annotation lets the Loro adapter materialize `cards` as
`LoroMovableList`. The collaborative-text annotation materializes `notes` as
`LoroText`.

## Follow local intent into Loro

[`src/client/actions.ts`](./src/client/actions.ts) contains every local tree
transition. Read it next to see why collaboration-sensitive updates record
semantic intent:

```ts
export const moveCard = BoardTree.operationUpdate(
  (
    state,
    operations,
    input: { readonly id: string; readonly offset: number }
  ) => {
    const from = state.cards.findIndex((card) => card.id === input.id)
    if (from === -1) return
    const to = clamp(from + input.offset, 0, state.cards.length - 1)
    if (from !== to) operations.arrayMove(['cards'], from, to)
  },
  { label: 'Move card' }
)
```

The same file includes native object edits, array splices, text insertions, and
text deletions. Universal tree patches remain available, while the Loro adapter
can preserve the more specific intent.

## Study one browser peer

[`src/client/peer.ts`](./src/client/peer.ts) is the central lifecycle file. Its
`makeCollaborationPeer` workflow:

1. creates an independently identified `LoroDoc`;
2. constructs the Schema-coded Loro adapter;
3. creates one `BoardTree` store;
4. connects them with `bindCrdt`;
5. waits for the binding to become ready and idle;
6. starts the reconnecting room transport;
7. derives a commit feed from store commits;
8. exposes peer-local undo, redo, and orderly shutdown.

The core setup is intentionally small:

```ts
const adapter = makeLoroAdapter(BoardTree.spec, {
  doc,
  rootName: 'board',
  origin: `tree:${options.peerId}:${crypto.randomUUID()}`,
})
const store = yield* BoardTree.make(initialBoard)
const binding = yield* bindCrdt(store, adapter, {
  initialize: 'backend',
}).pipe(Scope.provide(scope))

yield* binding.ready
yield* binding.idle
```

Also inspect `makeCommitFeed` in that file. It uses
`makeCommitReducerController` to turn the canonical commit stream into a small
UI view without changing the tree.

## Follow synchronization across the network

Read these files in order:

1. [`src/collaboration/protocol.ts`](./src/collaboration/protocol.ts) defines
   the Schema-decoded message sent from the room server.
2. [`src/client/transport.ts`](./src/client/transport.ts) converts Loro updates
   to WebSocket messages, applies remote updates, and reconnects with bounded
   delay while local editing continues.
3. [`src/server/room-hub.ts`](./src/server/room-hub.ts) owns the authoritative
   Loro document for each room, sends its current state to late peers, and
   broadcasts updates.
4. [`src/server/routes.ts`](./src/server/routes.ts) exposes the WebSocket route.
5. [`src/collaboration/bootstrap.ts`](./src/collaboration/bootstrap.ts)
   constructs the initial encoded Loro document shared by newly created rooms.

The server relays Loro document updates; it does not host an
effect-state-tree store. Each browser peer independently projects the
collaborative document into its own admitted tree.

## Follow state into React

[`src/client/atoms.ts`](./src/client/atoms.ts) projects the board store,
connection state, commit feed, and local actions into one stable Effect Atom
surface:

- `tree.select` creates path-aware card, note, and revision atoms;
- `tree.view` adapts the transport and commit-feed views;
- `tree.fn` runs tree actions and peer undo through the same Atom runtime.

Focused UI locations:

- [`src/components/BoardEditor.tsx`](./src/components/BoardEditor.tsx) consumes
  collaborative data and all mutation atoms.
- [`src/components/ConnectionPanel.tsx`](./src/components/ConnectionPanel.tsx)
  displays transport state and builds another-peer URLs.
- [`src/components/CommitFeed.tsx`](./src/components/CommitFeed.tsx) displays
  local versus inbound commit provenance and semantic operation names.
- [`src/main.tsx`](./src/main.tsx) chooses room and peer identities, constructs
  the peer, mounts the Atom registry, and shuts the peer down with the page.

## Things to try

1. Open two or more peers in the same room.
2. Add, rename, remove, and reorder cards from different pages.
3. Edit the shared notes concurrently.
4. Take one peer offline, continue editing, and reconnect it.
5. Undo from one peer and observe that only its own recent intentions are
   compensated.
6. Open a late peer and verify that it receives the room's current state.
7. Change the room query parameter and verify that the documents are isolated.

## Tests and further reading

```sh
bun x nx test:unit @effect-state-tree/react-loro-collaboration-example
bun x nx test:e2e @effect-state-tree/react-loro-collaboration-example
```

Useful test locations:

- [`test/peer.test.ts`](./test/peer.test.ts) exercises multiple in-memory peers,
  transport behavior, convergence, isolation, and reconnects.
- [`e2e/collaboration.spec.ts`](./e2e/collaboration.spec.ts) drives the complete
  multi-page browser workflow.

For the underlying concepts, read the package guides for
[`@effect-state-tree/crdt`](../../packages/crdt/README.md),
[`@effect-state-tree/loro`](../../packages/loro/README.md), and
[`@effect-state-tree/atom`](../../packages/atom/README.md).
