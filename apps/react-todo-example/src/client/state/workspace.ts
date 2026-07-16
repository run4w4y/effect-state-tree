import type { TreeInvariantError } from '@effect-state-tree/core'
import {
  type DraftError,
  makeDraft,
  type TreeDraft,
} from '@effect-state-tree/draft'
import {
  type HistoryController,
  makeHistory,
  withoutHistory,
} from '@effect-state-tree/history'
import type { TreeStore } from '@effect-state-tree/runtime'
import {
  makeValidationController,
  type ValidationController,
} from '@effect-state-tree/validation'
import { Data, Effect } from 'effect'
import type {
  TodoApp,
  TodoApp as TodoAppState,
  TodoDocument,
} from '../../shared/todo'
import type { TodoApiClient } from '../api'
import { makeTodoStore } from './todo-tree'

export class TodoDraftInvalidError extends Data.TaggedError(
  'TodoDraftInvalidError'
)<{
  readonly issueCount: number
}> {}

export class TodoDraftDirtyError extends Data.TaggedError(
  'TodoDraftDirtyError'
)<{
  readonly documentId: string
}> {}

type TodoGetError = Effect.Error<
  ReturnType<TodoApiClient['todoDocuments']['get']>
>
type TodoSaveError = Effect.Error<
  ReturnType<TodoApiClient['todoDocuments']['save']>
>

export interface TodoWorkspace {
  readonly documentId: string
  readonly original: TreeStore<typeof TodoApp>
  readonly draft: TreeDraft<typeof TodoApp>
  readonly history: HistoryController<typeof TodoApp>
  readonly validation: ValidationController
  readonly load: Effect.Effect<TodoDocument, TodoGetError | DraftError>
  readonly reload: Effect.Effect<
    TodoDocument,
    TodoGetError | DraftError | TodoDraftDirtyError
  >
  readonly save: Effect.Effect<
    TodoDocument,
    TodoSaveError | DraftError | TodoDraftInvalidError
  >
  readonly reset: Effect.Effect<void, DraftError>
  readonly isDirty: () => boolean
  readonly shutdown: Effect.Effect<void>
}

const withDocument = (
  state: TodoAppState,
  document: TodoDocument
): TodoAppState => ({ ...state, document })

export const makeTodoWorkspace = (
  client: TodoApiClient,
  documentId: string
): Effect.Effect<TodoWorkspace, TreeInvariantError> =>
  Effect.gen(function* () {
    const original = yield* makeTodoStore()
    const draft = yield* makeDraft(original)
    const history = makeHistory(draft.data, { limit: 100 })
    const validation = makeValidationController(draft.data, 'draft')

    const installFromServer = (document: TodoDocument) =>
      Effect.gen(function* () {
        yield* withoutHistory(
          draft.data.replace(withDocument(draft.data.getSnapshot(), document), {
            label: 'Reconcile server document',
          })
        )
        yield* draft.commitAt(['document'])
        history.clear()
        return document
      })

    const fetchDocument = client.todoDocuments.get({
      params: { id: documentId },
    })

    const load = Effect.flatMap(fetchDocument, installFromServer)

    const reload = Effect.gen(function* () {
      if (draft.isDirtyAt(['document'])) {
        return yield* new TodoDraftDirtyError({ documentId })
      }
      return yield* load
    })

    const save = Effect.gen(function* () {
      const issues = validation
        .issuesBelow(['document'])
        .filter((issue) => issue.severity === 'error')
      if (issues.length > 0) {
        return yield* new TodoDraftInvalidError({ issueCount: issues.length })
      }

      const current = draft.data.getSnapshot().document
      const authoritative = yield* client.todoDocuments.save({
        params: { id: documentId },
        payload: {
          expectedVersion: current.version,
          todos: current.todos,
        },
      })
      return yield* installFromServer(authoritative)
    })

    const reset = Effect.gen(function* () {
      yield* draft.resetAt(['document'])
      history.clear()
    })

    let closed = false
    const shutdown = Effect.suspend(() => {
      if (closed) return Effect.void
      closed = true
      validation.dispose()
      history.dispose()
      return Effect.all([draft.data.shutdown, original.shutdown], {
        discard: true,
      })
    })

    return {
      documentId,
      original,
      draft,
      history,
      validation,
      load,
      reload,
      save,
      reset,
      isDirty: () => draft.isDirtyAt(['document']),
      shutdown,
    }
  })
