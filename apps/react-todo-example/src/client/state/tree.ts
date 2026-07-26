import { defineTree, type TreeStore } from '@effect-state-tree/runtime'
import {
  makeWorkingTreeSpec,
  type WorkingSchema,
} from '@effect-state-tree/validation'

import { TodoApp, type TodoApp as TodoAppState } from '../../shared/todo'

export const todoSpec = makeWorkingTreeSpec(TodoApp)

export const TodoTree = defineTree(
  '@effect-state-tree/react-todo-example/TodoTree',
  todoSpec
)

export type TodoStore = TreeStore<WorkingSchema<typeof TodoApp>>
export type { TodoAppState }
