# React Loro collaboration example

Each browser page is one independent Effect Tree store and one independent
Loro document. An Effect-powered WebSocket room server owns the merged Loro
document for every room and accepts any number of peers. There is no fixed
Alice/Bob pair and no manual synchronization button.

It demonstrates:

- stable tree atoms consumed through Effect's official React Atom binding;
- context-resolved tree updates with no store arguments;
- native Loro movable-list and collaborative-text operations;
- automatic WebSocket reconnect with offline local editing;
- late peers joining from the room's authoritative Loro history;
- provenance-based echo suppression;
- universal patches and semantic operations in the commit feed;
- Loro peer-local intention undo and redo.

Start the room server and Rsbuild client in separate terminals:

```sh
bun x nx run @effect-state-tree/react-loro-collaboration-example:dev:server
bun x nx run @effect-state-tree/react-loro-collaboration-example:dev
```

Open the generated **Open another peer** link to create another independent
browser peer in the same room. The `room` and `peer` query parameters are
arbitrary, so E2E tests and users can create any number of isolated rooms and
peers.
