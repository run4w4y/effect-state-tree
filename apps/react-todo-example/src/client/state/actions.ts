import { withoutHistory } from '@effect-state-tree/history'
import {
  makeTreeAction,
  makeTreeOperationAction,
} from '@effect-state-tree/runtime'
import { Effect } from 'effect'

import type { Todo, TodoFilter, TodoPriority } from '../../shared/todo'
import { TodoTree } from './todo-tree'

const insertTodo = makeTreeOperationAction(
  TodoTree,
  (state, operations, todo: Todo) => {
    operations.arraySplice(
      ['document', 'todos'],
      state.document.todos.length,
      0,
      todo
    )
  },
  (todo) => ({ label: `Add “${todo.title}”` })
)

export const addTodo = (input: {
  readonly title: string
  readonly priority: TodoPriority
}) =>
  Effect.flatMap(
    Effect.sync(
      (): Todo => ({
        id: globalThis.crypto.randomUUID(),
        title: input.title,
        notes: '',
        priority: input.priority,
        completed: false,
      })
    ),
    insertTodo
  )

export const toggleTodo = makeTreeAction(
  TodoTree,
  (state, id: string) => {
    const todo = state.document.todos.find((candidate) => candidate.id === id)
    if (todo !== undefined) todo.completed = !todo.completed
  },
  { label: 'Toggle todo' }
)

export const editTodo = makeTreeAction(
  TodoTree,
  (
    state,
    input: {
      readonly id: string
      readonly title: string
      readonly notes: string
      readonly priority: TodoPriority
    }
  ) => {
    const todo = state.document.todos.find(
      (candidate) => candidate.id === input.id
    )
    if (todo === undefined) return
    todo.title = input.title
    todo.notes = input.notes
    todo.priority = input.priority
  },
  { label: 'Edit todo' }
)

export const removeTodo = makeTreeOperationAction(
  TodoTree,
  (state, operations, id: string) => {
    const index = state.document.todos.findIndex((todo) => todo.id === id)
    if (index !== -1) operations.arraySplice(['document', 'todos'], index, 1)
  },
  { label: 'Remove todo' }
)

const setFilter = makeTreeAction(
  TodoTree,
  (state, filter: TodoFilter) => {
    state.filter = filter
  },
  { label: 'Change filter' }
)

export const changeFilter = (filter: TodoFilter) =>
  withoutHistory(setFilter(filter))
