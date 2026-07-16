import { BrowserSocket } from '@effect/platform-browser'
import type { StoreView } from '@effect-state-tree/runtime'
import { Effect, Queue, Schema, type Scope } from 'effect'
import { Socket } from 'effect/unstable/socket'
import type { LoroDoc } from 'loro-crdt'

import { RoomStateMessage } from '../collaboration/protocol'
import { makeMutableStoreView } from './store-view'

export type ConnectionState =
  | {
      readonly _tag: 'Connecting'
      readonly attempt: number
      readonly peers: number
    }
  | {
      readonly _tag: 'Connected'
      readonly attempt: number
      readonly peers: number
    }
  | {
      readonly _tag: 'Disconnected'
      readonly attempt: number
      readonly peers: number
      readonly reason: string
    }

export interface LoroTransport {
  readonly state: StoreView<ConnectionState>
}

export interface LoroTransportOptions {
  readonly roomId: string
  readonly peerId: string
  readonly endpoint: string
}

export type LoroTransportFactory = (
  doc: LoroDoc,
  options: LoroTransportOptions
) => Effect.Effect<LoroTransport, never, Scope.Scope>

const decodeRoomState = Schema.decodeUnknownEffect(RoomStateMessage)

const parseRoomState = (value: string) =>
  Effect.try({
    try: () => JSON.parse(value),
    catch: (cause) => new Error('Invalid room control message', { cause }),
  }).pipe(Effect.flatMap(decodeRoomState))

const reconnectDelay = (attempt: number): number =>
  Math.min(4_000, 250 * 2 ** Math.min(attempt - 1, 4))

export const makeCollaborationSocketUrl = (
  options: LoroTransportOptions,
  baseUrl: string
): string => {
  const url = new URL(options.endpoint, baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('room', options.roomId)
  url.searchParams.set('peer', options.peerId)
  return url.toString()
}

export const makeBrowserLoroTransport: LoroTransportFactory = (doc, options) =>
  Effect.gen(function* () {
    const outgoing = yield* Queue.sliding<Uint8Array>(1)
    const state = makeMutableStoreView<ConnectionState>({
      _tag: 'Connecting',
      attempt: 1,
      peers: 0,
    })
    const url = makeCollaborationSocketUrl(options, window.location.href)

    const unsubscribe = doc.subscribe((event) => {
      if (event.by !== 'local') return
      Queue.offerUnsafe(outgoing, doc.export({ mode: 'update' }))
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(unsubscribe).pipe(Effect.andThen(Queue.shutdown(outgoing)))
    )

    let attempt = 0
    let peers = 0

    const connect = Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        const receive = socket.runRaw(
          (frame) => {
            if (typeof frame !== 'string') {
              return Effect.sync(() => {
                doc.import(frame)
              })
            }
            return parseRoomState(frame).pipe(
              Effect.tap((message) =>
                Effect.sync(() => {
                  peers = message.peers
                  state.set({ _tag: 'Connected', attempt, peers })
                })
              ),
              Effect.catch(() => Effect.void),
              Effect.asVoid
            )
          },
          {
            onOpen: Effect.gen(function* () {
              state.set({ _tag: 'Connected', attempt, peers })
              yield* write(doc.export({ mode: 'update' })).pipe(Effect.ignore)
            }),
          }
        )
        const send = Effect.forever(Effect.flatMap(Queue.take(outgoing), write))
        yield* Effect.raceFirst(receive, send)
      }).pipe(Effect.provide(BrowserSocket.layerWebSocket(url)))
    )

    const reconnect = Effect.forever(
      Effect.suspend(() => {
        attempt += 1
        state.set({ _tag: 'Connecting', attempt, peers })
        return connect.pipe(
          Effect.catch((error) => {
            const reason = String(error)
            state.set({ _tag: 'Disconnected', attempt, peers, reason })
            return Effect.sleep(reconnectDelay(attempt))
          })
        )
      })
    )

    yield* Effect.forkScoped(reconnect, { startImmediately: true })
    return { state }
  })
