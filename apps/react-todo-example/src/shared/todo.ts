import { entity } from '@effect-state-tree/core'
import { Schema } from 'effect'

export const TodoTitle = Schema.String.check(
  Schema.makeFilter((title: string) => title.trim().length > 0)
)

export const TodoNotes = Schema.String.check(Schema.isMaxLength(240))

export const TodoPriority = Schema.Literals(['low', 'normal', 'high'])
export type TodoPriority = typeof TodoPriority.Type

export const Todo = Schema.Struct({
  id: Schema.String,
  title: TodoTitle,
  notes: TodoNotes,
  priority: TodoPriority,
  completed: Schema.Boolean,
}).pipe(entity({ type: 'Todo', id: 'id' }))

export type Todo = typeof Todo.Type

export const TodoDocument = Schema.Struct({
  version: Schema.Int,
  todos: Schema.Array(Todo),
})

export type TodoDocument = typeof TodoDocument.Type

export const SaveTodoDocument = Schema.Struct({
  expectedVersion: Schema.Int,
  todos: Schema.Array(Todo),
})

export type SaveTodoDocument = typeof SaveTodoDocument.Type

export const TodoFilter = Schema.Literals(['all', 'active', 'completed'])
export type TodoFilter = typeof TodoFilter.Type

export const TodoApp = Schema.Struct({
  document: TodoDocument,
  filter: TodoFilter,
})

export type TodoApp = typeof TodoApp.Type

export const initialTodoDocument: TodoDocument = {
  version: 0,
  todos: [],
}

export const initialTodoApp: TodoApp = {
  document: initialTodoDocument,
  filter: 'all',
}
