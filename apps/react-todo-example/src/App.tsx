import { TodoPage } from './client/components/TodoPage'
import { TodoReact } from './client/state/todo-tree'
import type { TodoWorkspace } from './client/state/workspace'

export const App = ({ workspace }: { readonly workspace: TodoWorkspace }) => (
  <TodoReact.Provider store={workspace.draft.data}>
    <TodoPage workspace={workspace} />
  </TodoReact.Provider>
)
