import { makeTreeSpec } from '@effect-state-tree/core'
import { defineTree, type TreeStore } from '@effect-state-tree/runtime'

import { TodoApp, type TodoApp as TodoAppState } from '../../shared/todo'

export const todoSpec = makeTreeSpec(TodoApp)

export const TodoTree = defineTree(
  '@effect-state-tree/react-todo-example/TodoTree',
  todoSpec
)

export type TodoStore = TreeStore<typeof TodoApp>
export type { TodoAppState }
