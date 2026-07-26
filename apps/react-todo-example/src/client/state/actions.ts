import {
  DraftDirtyError,
  DraftSynchronizationResult,
} from '@effect-state-tree/draft'
import { Effect, Option } from 'effect'

import type { Todo, TodoFilter, TodoPriority } from '../../shared/todo'
import { TodoConflict } from '../../shared/todo-api'
import { TodoApiClient } from '../api'
import { TodoSession } from './session'
import { TodoTree } from './tree'
import {
  changeFilter as changeFilterUpdate,
  editTodo as editTodoUpdate,
  insertTodo,
  removeTodo as removeTodoUpdate,
  toggleTodo as toggleTodoUpdate,
} from './updates'

const refreshTodoDocument = () =>
  Effect.gen(function* () {
    const session = yield* TodoSession
    if (session.draft.isDirty()) return yield* new DraftDirtyError()

    const client = yield* TodoApiClient
    const refreshed = yield* session.draft.submit(({ submitted }) =>
      client.todoDocuments
        .get({
          params: { id: session.documentId },
        })
        .pipe(
          Effect.map((document) => ({
            ...submitted,
            document,
          }))
        )
    )
    return DraftSynchronizationResult.map(
      refreshed,
      (authoritative) => authoritative.document
    )
  })

export const loadTodoDocument = TodoTree.action(
  'Todo.load',
  refreshTodoDocument
)

export const reloadTodoDocument = TodoTree.action(
  'Todo.reload',
  refreshTodoDocument
)

export const saveTodoDocument = TodoTree.action('Todo.save', () =>
  Effect.gen(function* () {
    const session = yield* TodoSession
    const client = yield* TodoApiClient

    const saved = yield* session.draft.submit(
      ({ saved, submitted }) =>
        client.todoDocuments
          .save({
            params: { id: session.documentId },
            payload: {
              expectedVersion: saved.document.version,
              todos: submitted.document.todos,
            },
          })
          .pipe(
            Effect.map((document) => ({
              ...submitted,
              document,
            }))
          ),
      {
        authoritativeFailure: (error) =>
          error instanceof TodoConflict
            ? Option.some({
                ...session.draft.data.getSnapshot(),
                document: error.current,
              })
            : Option.none(),
      }
    )
    return DraftSynchronizationResult.map(
      saved,
      (authoritative) => authoritative.document
    )
  })
)

export const resetTodoDraft = TodoTree.action('Todo.reset', () =>
  Effect.flatMap(TodoSession, (session) => session.draft.reset)
)

export const undoTodoChange = TodoTree.action('Todo.undo', () =>
  Effect.flatMap(TodoSession, (session) => session.history.undo)
)

export const redoTodoChange = TodoTree.action('Todo.redo', () =>
  Effect.flatMap(TodoSession, (session) => session.history.redo)
)

export const addTodo = TodoTree.action(
  'Todo.add',
  (input: { readonly title: string; readonly priority: TodoPriority }) => {
    const todo: Todo = {
      id: globalThis.crypto.randomUUID(),
      title: input.title,
      notes: '',
      priority: input.priority,
      completed: false,
    }
    return insertTodo(todo)
  }
)

export const toggleTodo = TodoTree.action('Todo.toggle', (id: string) =>
  toggleTodoUpdate(id)
)

export const editTodo = TodoTree.action(
  'Todo.edit',
  (input: {
    readonly id: string
    readonly title: string
    readonly notes: string
    readonly priority: TodoPriority
  }) => editTodoUpdate(input)
)

export const removeTodo = TodoTree.action('Todo.remove', (id: string) =>
  removeTodoUpdate(id)
)

export const changeFilter = TodoTree.action(
  'Todo.changeFilter',
  (filter: TodoFilter) => changeFilterUpdate(filter)
)
