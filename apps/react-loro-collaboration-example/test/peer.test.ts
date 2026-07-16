import { describe, expect, it } from 'bun:test'
import type { TreeStoreIdentifier } from '@effect-state-tree/runtime'
import { Effect } from 'effect'
import { isEqual } from 'es-toolkit'
import { LoroDoc } from 'loro-crdt'

import { appendNote, moveCard, renameCard } from '../src/client/actions'
import { makeCollaborationPeer } from '../src/client/peer'
import { makeMutableStoreView } from '../src/client/store-view'
import type {
  ConnectionState,
  LoroTransportFactory,
} from '../src/client/transport'
import { type Board, BoardTree } from '../src/domain/board'

interface MemoryPeer {
  readonly doc: LoroDoc
  readonly state: ReturnType<typeof makeMutableStoreView<ConnectionState>>
}

interface MemoryRoom {
  readonly doc: LoroDoc
  readonly peers: Map<string, MemoryPeer>
}

const makeMemoryRoomTransport = (): LoroTransportFactory => {
  const rooms = new Map<string, MemoryRoom>()

  return (doc, options) =>
    Effect.gen(function* () {
      let room = rooms.get(options.roomId)
      if (room === undefined) {
        const central = new LoroDoc()
        central.import(doc.export({ mode: 'update' }))
        room = { doc: central, peers: new Map() }
        rooms.set(options.roomId, room)
      }

      doc.import(room.doc.export({ mode: 'update' }))
      const state = makeMutableStoreView<ConnectionState>({
        _tag: 'Connected',
        attempt: 1,
        peers: 1,
      })
      room.peers.set(options.peerId, { doc, state })

      const publishPeerCount = (): void => {
        for (const peer of room.peers.values()) {
          peer.state.set({
            _tag: 'Connected',
            attempt: 1,
            peers: room.peers.size,
          })
        }
      }

      const unsubscribe = doc.subscribe((event) => {
        if (event.by !== 'local') return
        room.doc.import(doc.export({ mode: 'update' }))
        const merged = room.doc.export({ mode: 'update' })
        for (const peer of room.peers.values()) {
          if (peer.doc !== doc) peer.doc.import(merged)
        }
      })
      publishPeerCount()

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribe()
          if (room.peers.get(options.peerId)?.doc === doc) {
            room.peers.delete(options.peerId)
          }
          publishPeerCount()
        })
      )

      return { state }
    })
}

const waitForConvergence = (
  peers: ReadonlyArray<Effect.Success<ReturnType<typeof makeCollaborationPeer>>>
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      yield* Effect.all(peers.map((peer) => peer.binding.idle))
      const first = peers[0]?.store.getSnapshot()
      if (
        first !== undefined &&
        peers.every((peer) => isEqual(peer.store.getSnapshot(), first))
      ) {
        return first
      }
      yield* Effect.sleep(10)
    }
    return yield* Effect.fail(new Error('Peers did not converge'))
  })

const runFor = <A, E>(
  peer: Effect.Success<ReturnType<typeof makeCollaborationPeer>>,
  effect: Effect.Effect<
    A,
    E,
    TreeStoreIdentifier<typeof BoardTree.identifier, typeof Board>
  >
) => Effect.provideService(effect, BoardTree.service, peer.store)

describe('collaboration peer', () => {
  it('supports arbitrary peers, late join, room isolation, and local undo', async () => {
    const transport = makeMemoryRoomTransport()
    const peers = await Effect.runPromise(
      Effect.all(
        {
          alice: makeCollaborationPeer({
            roomId: 'shared',
            peerId: 'alice',
            name: 'Alice',
            transport,
          }),
          bob: makeCollaborationPeer({
            roomId: 'shared',
            peerId: 'bob',
            name: 'Bob',
            transport,
          }),
          carol: makeCollaborationPeer({
            roomId: 'shared',
            peerId: 'carol',
            name: 'Carol',
            transport,
          }),
        },
        { concurrency: 'unbounded' }
      )
    )
    const { alice, bob, carol } = peers

    await Effect.runPromise(
      Effect.all(
        [
          runFor(alice, moveCard('architecture', 2)),
          runFor(bob, renameCard('architecture', 'Moved and renamed')),
          runFor(carol, appendNote('Three real peers. ')),
        ],
        { concurrency: 'unbounded' }
      )
    )

    const converged = await Effect.runPromise(
      waitForConvergence([alice, bob, carol])
    )
    expect(
      converged.cards.find((card) => card.id === 'architecture')?.title
    ).toBe('Moved and renamed')
    expect(converged.notes).toContain('Three real peers. ')
    expect(JSON.stringify(alice.doc.exportJsonUpdates())).toContain(
      '"type":"move"'
    )
    expect(alice.transport.state.getSnapshot().peers).toBe(3)

    const dave = await Effect.runPromise(
      makeCollaborationPeer({
        roomId: 'shared',
        peerId: 'dave',
        name: 'Dave',
        transport,
      })
    )
    await Effect.runPromise(waitForConvergence([alice, bob, carol, dave]))
    expect(dave.store.getSnapshot()).toEqual(alice.store.getSnapshot())
    expect(dave.transport.state.getSnapshot().peers).toBe(4)

    const isolated = await Effect.runPromise(
      makeCollaborationPeer({
        roomId: 'isolated',
        peerId: 'eve',
        name: 'Eve',
        transport,
      })
    )
    await Effect.runPromise(runFor(isolated, appendNote('Private room. ')))
    await Effect.runPromise(isolated.binding.idle)
    expect(isolated.store.getSnapshot().notes).toContain('Private room. ')
    expect(alice.store.getSnapshot().notes).not.toContain('Private room. ')

    const beforeUndo = alice.store.getSnapshot()
    expect(await Effect.runPromise(alice.adapter.undo.canUndo)).toBe(true)
    await Effect.runPromise(alice.undo())
    const afterUndo = await Effect.runPromise(
      waitForConvergence([alice, bob, carol, dave])
    )
    expect(afterUndo).not.toEqual(beforeUndo)
    expect(
      alice.commits.getSnapshot().some((entry) => entry.direction === 'inbound')
    ).toBe(true)

    await Effect.runPromise(
      Effect.all(
        [
          alice.shutdown,
          bob.shutdown,
          carol.shutdown,
          dave.shutdown,
          isolated.shutdown,
        ],
        { concurrency: 'unbounded', discard: true }
      )
    )
  })
})
