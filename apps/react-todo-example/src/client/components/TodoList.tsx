import * as stylex from '@stylexjs/stylex'

import { selectVisibleTodos, visibleTodoOptions } from '../state/selectors'
import { TodoReact } from '../state/todo-tree'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { TodoRow } from './TodoRow'

const styles = stylex.create({
  list: {
    display: 'grid',
    gap: spacing.sm,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  empty: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    color: colors.textMuted,
    padding: spacing.xl,
    textAlign: 'center',
  },
})

export const TodoList = ({
  onEdit,
}: {
  readonly onEdit: (id: string) => void
}) => {
  const todos = TodoReact.useSelector(selectVisibleTodos, visibleTodoOptions)

  return todos.length === 0 ? (
    <p {...stylex.props(styles.empty)}>No todos match the current filter.</p>
  ) : (
    <ul {...stylex.props(styles.list)} aria-label="Todos">
      {todos.map((todo) => (
        <TodoRow key={todo.id} onEdit={onEdit} todo={todo} />
      ))}
    </ul>
  )
}
