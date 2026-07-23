import type { SelectOptions } from '@effect-state-tree/runtime'

import type { Todo, TodoFilter } from '../../shared/todo'
import type { TodoAppState } from './tree'

export const selectFilter = (state: TodoAppState): TodoFilter => state.filter

export const selectVisibleTodos = (state: TodoAppState): ReadonlyArray<Todo> =>
  state.document.todos.filter(
    (todo) =>
      state.filter === 'all' ||
      (state.filter === 'active' ? !todo.completed : todo.completed)
  )

export const selectRemaining = (state: TodoAppState): number =>
  state.document.todos.filter((todo) => !todo.completed).length

export const selectTotal = (state: TodoAppState): number =>
  state.document.todos.length

export const selectVersion = (state: TodoAppState): number =>
  state.document.version

export const visibleTodoOptions: SelectOptions<ReadonlyArray<Todo>> = {
  paths: [['document', 'todos'], ['filter']],
}

export const todoCountOptions: SelectOptions<number> = {
  paths: [['document', 'todos']],
}
