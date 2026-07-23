import { withoutHistory } from '@effect-state-tree/history'
import type { Todo, TodoFilter, TodoPriority } from '../../shared/todo'
import { TodoTree } from './tree'

export const insertTodo = TodoTree.operationUpdate(
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

export const toggleTodo = TodoTree.update(
  (state, id: string) => {
    const todo = state.document.todos.find((candidate) => candidate.id === id)
    if (todo !== undefined) todo.completed = !todo.completed
  },
  { label: 'Toggle todo' }
)

export const editTodo = TodoTree.update(
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

export const removeTodo = TodoTree.operationUpdate(
  (state, operations, id: string) => {
    const index = state.document.todos.findIndex((todo) => todo.id === id)
    if (index !== -1) operations.arraySplice(['document', 'todos'], index, 1)
  },
  { label: 'Remove todo' }
)

const setFilter = TodoTree.update(
  (state, filter: TodoFilter) => {
    state.filter = filter
  },
  { label: 'Change filter' }
)

export const changeFilter = (filter: TodoFilter) =>
  withoutHistory(setFilter(filter))
