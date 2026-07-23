import {
  validateTree,
  validationIssuesBelow,
} from '@effect-state-tree/validation'
import { Effect, Option } from 'effect'

import type { Todo, TodoFilter, TodoPriority } from '../../shared/todo'
import { TodoConflict } from '../../shared/todo-api'
import { TodoApiClient } from '../api'
import { TodoDraftInvalidError } from './errors'
import { TodoSession } from './session'
import { TodoTree, todoSpec } from './tree'
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
    const client = yield* TodoApiClient
    return yield* session.draft.refreshAt(['document'], () =>
      client.todoDocuments.get({ params: { id: session.documentId } })
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

    return yield* session.draft.submitAt(
      ['document'],
      ({ draft, original, submitted }) =>
        Effect.gen(function* () {
          const issues = validationIssuesBelow(
            validateTree(todoSpec, draft, { phase: 'draft' }),
            ['document']
          ).filter((issue) => issue.severity === 'error')
          if (issues.length > 0) {
            return yield* new TodoDraftInvalidError({
              issueCount: issues.length,
            })
          }

          return yield* client.todoDocuments.save({
            params: { id: session.documentId },
            payload: {
              expectedVersion: original.version,
              todos: submitted.todos,
            },
          })
        }),
      {
        authoritativeFailure: (error) =>
          error instanceof TodoConflict
            ? Option.some(error.current)
            : Option.none(),
      }
    )
  })
)

export const resetTodoDraft = TodoTree.action('Todo.reset', () =>
  Effect.flatMap(TodoSession, (session) => session.draft.resetAt(['document']))
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
