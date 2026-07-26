import {
  DraftAcceptedTag,
  DraftRefreshedTag,
  DraftResetTag,
  makeDraftScoped,
  type TreeDraft,
} from '@effect-state-tree/draft'
import {
  type HistoryController,
  makeHistoryScoped,
} from '@effect-state-tree/history'
import type {
  ValidationController,
  WorkingSchema,
} from '@effect-state-tree/validation'
import { Context, Effect, Layer } from 'effect'

import { initialTodoApp, TodoApp } from '../../shared/todo'
import { TodoTree } from './tree'

export interface TodoSessionService {
  readonly documentId: string
  readonly draft: TreeDraft<typeof TodoApp>
  readonly history: HistoryController<WorkingSchema<typeof TodoApp>>
  readonly validation: ValidationController<typeof TodoApp>
}

export class TodoSession extends Context.Service<
  TodoSession,
  TodoSessionService
>()('@effect-state-tree/react-todo-example/TodoSession') {}

export const TodoSessionLive = (documentId: string) => {
  const session = Layer.effect(
    TodoSession,
    Effect.gen(function* () {
      const draft = yield* makeDraftScoped(TodoApp, initialTodoApp)
      const history = yield* makeHistoryScoped(draft.data, {
        limit: 100,
        baselineTags: [DraftAcceptedTag, DraftRefreshedTag, DraftResetTag],
      })

      return TodoSession.of({
        documentId,
        draft,
        history,
        validation: draft.validation,
      })
    })
  )

  return Layer.effect(
    TodoTree.service,
    Effect.map(TodoSession, (current) => current.draft.data)
  ).pipe(Layer.provideMerge(session))
}
