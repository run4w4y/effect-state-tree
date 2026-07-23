import { BrowserHttpClient } from '@effect/platform-browser'
import { Context, type Effect, Layer } from 'effect'
import { HttpApiClient } from 'effect/unstable/httpapi'

import { TodoApi } from '../shared/todo-api'

export const makeTodoApiClient = (baseUrl: string | URL) =>
  HttpApiClient.make(TodoApi, { baseUrl })

export type TodoApiClientService = Effect.Success<
  ReturnType<typeof makeTodoApiClient>
>

export class TodoApiClient extends Context.Service<
  TodoApiClient,
  TodoApiClientService
>()('@effect-state-tree/react-todo-example/TodoApiClient') {}

export const TodoApiClientLive = (baseUrl: string | URL) =>
  Layer.effect(TodoApiClient, makeTodoApiClient(baseUrl)).pipe(
    Layer.provide(BrowserHttpClient.layerFetch)
  )
