import type { Effect } from 'effect'
import { HttpApiClient } from 'effect/unstable/httpapi'

import { TodoApi } from '../shared/todo-api'

export const makeTodoApiClient = (baseUrl: string | URL) =>
  HttpApiClient.make(TodoApi, { baseUrl })

export type TodoApiClient = Effect.Success<ReturnType<typeof makeTodoApiClient>>
