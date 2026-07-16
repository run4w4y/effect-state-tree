import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { TodoApi } from '../shared/todo-api'
import { TodoRepository, TodoRepositoryLive } from './repository'

export const TodoDocumentsLive = HttpApiBuilder.group(
  TodoApi,
  'todoDocuments',
  Effect.fn('TodoDocumentsLive')(function* (handlers) {
    const repository = yield* TodoRepository
    return handlers
      .handle('get', ({ params }) => repository.get(params.id))
      .handle('save', ({ params, payload }) =>
        repository.save(params.id, payload)
      )
  })
)

const SystemLive = HttpApiBuilder.group(TodoApi, 'system', (handlers) =>
  handlers.handle('health', () => Effect.succeed({ status: 'ok' }))
)

export const TodoApiLive = HttpApiBuilder.layer(TodoApi).pipe(
  Layer.provide([TodoDocumentsLive, SystemLive]),
  Layer.provide(TodoRepositoryLive)
)
