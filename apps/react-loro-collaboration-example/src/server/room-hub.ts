import { Context, Effect, Layer, type Scope, Semaphore } from 'effect'
import { Socket } from 'effect/unstable/socket'
import { LoroDoc } from 'loro-crdt'

import { makeBoardDocument } from '../collaboration/bootstrap'
import type { RoomStateMessage } from '../collaboration/protocol'

type SocketWriter = (
  chunk: Uint8Array | string | Socket.CloseEvent
) => Effect.Effect<void, Socket.SocketError>

interface RoomConnection {
  readonly token: symbol
  readonly write: SocketWriter
}

interface Room {
  readonly doc: LoroDoc
  readonly gate: Semaphore.Semaphore
  readonly connections: Map<string, RoomConnection>
}

export interface RoomHubService {
  readonly connect: (
    roomId: string,
    peerId: string,
    socket: Socket.Socket
  ) => Effect.Effect<void, Socket.SocketError, Scope.Scope>
  readonly peerCount: (roomId: string) => number
}

export class RoomHub extends Context.Service<RoomHub, RoomHubService>()(
  '@effect-state-tree/react-loro-collaboration-example/RoomHub'
) {}

const roomMessage = (roomId: string, peers: number): string =>
  JSON.stringify({
    _tag: 'RoomState',
    roomId,
    peers,
  } satisfies RoomStateMessage)

export const RoomHubLive = Layer.effect(
  RoomHub,
  Effect.gen(function* () {
    const seed = yield* makeBoardDocument(2n)
    const initialUpdate = seed.export({ mode: 'update' })
    yield* Effect.sync(() => seed.free())
    const rooms = new Map<string, Room>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const room of rooms.values()) room.doc.free()
        rooms.clear()
      })
    )

    const getRoom = (roomId: string): Room => {
      const current = rooms.get(roomId)
      if (current !== undefined) return current
      const doc = new LoroDoc()
      doc.import(initialUpdate)
      doc.setPeerId(2n)
      const room: Room = {
        doc,
        gate: Semaphore.makeUnsafe(1),
        connections: new Map(),
      }
      rooms.set(roomId, room)
      return room
    }

    const broadcast = (
      room: Room,
      value: Uint8Array | string,
      except?: symbol
    ): Effect.Effect<void> =>
      Effect.forEach(
        room.connections.values(),
        (connection) =>
          connection.token === except
            ? Effect.void
            : connection.write(value).pipe(Effect.ignore),
        { concurrency: 'unbounded', discard: true }
      )

    const broadcastState = (roomId: string, room: Room): Effect.Effect<void> =>
      broadcast(room, roomMessage(roomId, room.connections.size))

    const connect: RoomHubService['connect'] = (roomId, peerId, socket) =>
      Effect.gen(function* () {
        const room = getRoom(roomId)
        const token = Symbol(peerId)
        const write = yield* socket.writer

        const open = room.gate.withPermit(
          Effect.gen(function* () {
            const previous = room.connections.get(peerId)
            if (previous !== undefined) {
              yield* previous
                .write(new Socket.CloseEvent(4001, 'Peer reconnected'))
                .pipe(Effect.ignore)
            }
            room.connections.set(peerId, { token, write })
            yield* write(room.doc.export({ mode: 'update' })).pipe(
              Effect.ignore
            )
            yield* broadcastState(roomId, room)
          })
        )

        const receive = (update: Uint8Array): Effect.Effect<void> =>
          room.gate.withPermit(
            Effect.try({
              try: () => {
                room.doc.import(update)
                return room.doc.export({ mode: 'update' })
              },
              catch: (cause) => cause,
            }).pipe(
              Effect.flatMap((merged) => broadcast(room, merged, token)),
              Effect.catch((cause) =>
                Effect.logWarning('Ignored invalid Loro room update', cause)
              )
            )
          )

        const remove = room.gate.withPermit(
          Effect.gen(function* () {
            if (room.connections.get(peerId)?.token !== token) return
            room.connections.delete(peerId)
            yield* broadcastState(roomId, room)
          })
        )

        yield* socket
          .run((update) => receive(update), { onOpen: open })
          .pipe(Effect.ensuring(remove))
      })

    return RoomHub.of({
      connect,
      peerCount: (roomId) => rooms.get(roomId)?.connections.size ?? 0,
    })
  })
)
