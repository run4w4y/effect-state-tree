import { useAtom } from '@effect/atom-react'
import * as stylex from '@stylexjs/stylex'

import type { Todo } from '../../shared/todo'
import type { TodoAtoms } from '../state/atoms'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { AsyncFailure } from './AsyncFailure'
import { Button } from './Button'

const styles = stylex.create({
  item: {
    alignItems: 'start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: spacing.sm,
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    padding: spacing.md,
  },
  checkbox: {
    accentColor: colors.primary,
    height: '1.2rem',
    marginBlockStart: '0.2rem',
    width: '1.2rem',
  },
  title: {
    fontSize: '1rem',
    margin: 0,
    overflowWrap: 'anywhere',
  },
  completed: {
    color: colors.textMuted,
    textDecoration: 'line-through',
  },
  notes: {
    color: colors.textMuted,
    fontSize: '0.86rem',
    marginBlock: spacing.xs,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  metadata: {
    color: colors.primary,
    fontSize: '0.76rem',
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
})

export const TodoRow = ({
  atoms,
  onEdit,
  todo,
}: {
  readonly atoms: TodoAtoms
  readonly onEdit: (id: string) => void
  readonly todo: Todo
}) => {
  const [toggleResult, toggle] = useAtom(atoms.actions.toggle(todo.id))
  const [removeResult, remove] = useAtom(atoms.actions.remove(todo.id))

  return (
    <li {...stylex.props(styles.item)} data-testid={`todo-${todo.id}`}>
      <input
        {...stylex.props(styles.checkbox)}
        aria-label={`Mark ${todo.title} ${todo.completed ? 'active' : 'complete'}`}
        checked={todo.completed}
        disabled={toggleResult.waiting}
        onChange={() => toggle(undefined)}
        type="checkbox"
      />
      <div>
        <h3 {...stylex.props(styles.title, todo.completed && styles.completed)}>
          {todo.title}
        </h3>
        {todo.notes.length > 0 && (
          <p {...stylex.props(styles.notes)}>{todo.notes}</p>
        )}
        <span {...stylex.props(styles.metadata)}>{todo.priority} priority</span>
        <AsyncFailure result={toggleResult} />
        <AsyncFailure result={removeResult} />
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button compact onClick={() => onEdit(todo.id)} tone="ghost">
          Edit
        </Button>
        <Button
          compact
          disabled={removeResult.waiting}
          onClick={() => remove(undefined)}
          tone="danger"
        >
          Remove
        </Button>
      </div>
    </li>
  )
}
