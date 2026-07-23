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
import type { TreeStore } from '@effect-state-tree/runtime'
import {
  makeValidationControllerScoped,
  type ValidationController,
} from '@effect-state-tree/validation'
import { Context, Effect, Layer } from 'effect'

import { initialTodoApp, type TodoApp } from '../../shared/todo'
import { TodoTree } from './tree'

export interface TodoSessionService {
  readonly documentId: string
  readonly original: TreeStore<typeof TodoApp>
  readonly draft: TreeDraft<typeof TodoApp>
  readonly history: HistoryController<typeof TodoApp>
  readonly validation: ValidationController
}

export class TodoSession extends Context.Service<
  TodoSession,
  TodoSessionService
>()('@effect-state-tree/react-todo-example/TodoSession') {}

export const TodoSessionLive = (documentId: string) => {
  const session = Layer.effect(
    TodoSession,
    Effect.gen(function* () {
      const original = yield* TodoTree.makeScoped(initialTodoApp)
      const draft = yield* makeDraftScoped(original)
      const history = yield* makeHistoryScoped(draft.data, {
        limit: 100,
        baselineTags: [DraftAcceptedTag, DraftRefreshedTag, DraftResetTag],
      })
      const validation = yield* makeValidationControllerScoped(
        draft.data,
        'draft'
      )

      return TodoSession.of({
        documentId,
        original,
        draft,
        history,
        validation,
      })
    })
  )

  return Layer.effect(
    TodoTree.service,
    Effect.map(TodoSession, (current) => current.draft.data)
  ).pipe(Layer.provideMerge(session))
}
