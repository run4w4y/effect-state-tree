import { Effect, Layer } from 'effect'
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http'

import { RoomHub, RoomHubLive } from './room-hub'

const boundedParameter = (
  value: string | null,
  fallback: string,
  maxLength: number
): string => {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0
    ? fallback
    : normalized.slice(0, maxLength)
}

const collaboration = (hub: RoomHub['Service']) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, 'http://localhost')
    const roomId = boundedParameter(url.searchParams.get('room'), 'lobby', 80)
    const peerId = boundedParameter(
      url.searchParams.get('peer'),
      crypto.randomUUID(),
      120
    )
    const socket = yield* request.upgrade
    yield* hub.connect(roomId, peerId, socket)
    return HttpServerResponse.empty()
  }).pipe(
    Effect.catch((error) =>
      Effect.logError('Collaboration socket closed', error).pipe(
        Effect.as(HttpServerResponse.empty())
      )
    )
  )

export const CollaborationRoutesLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter
    const hub = yield* RoomHub
    yield* router.add('GET', '/health', HttpServerResponse.text('ok'))
    yield* router.add('GET', '/collaboration', collaboration(hub))
  })
).pipe(Layer.provide(RoomHubLive))
