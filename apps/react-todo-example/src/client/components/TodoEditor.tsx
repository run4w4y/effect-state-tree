import { useAtom, useAtomValue } from '@effect/atom-react'
import { validationIssuesAt } from '@effect-state-tree/validation'
import * as stylex from '@stylexjs/stylex'
import { Option, Schema } from 'effect'

import { TodoPriority } from '../../shared/todo'
import type { TodoAtoms } from '../state/atoms'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { AsyncFailure } from './AsyncFailure'
import { Button } from './Button'

const styles = stylex.create({
  panel: {
    alignSelf: 'start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1.2rem 4rem rgba(31, 44, 36, 0.12)',
    display: 'grid',
    gap: spacing.md,
    padding: spacing.lg,
    position: 'sticky',
    top: spacing.lg,
  },
  header: {
    alignItems: 'start',
    display: 'flex',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.primary,
    fontSize: '0.74rem',
    fontWeight: 850,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  heading: {
    fontSize: '1.3rem',
    marginBlock: spacing.xs,
  },
  copy: {
    color: colors.textMuted,
    fontSize: '0.86rem',
    lineHeight: 1.55,
    margin: 0,
  },
  field: {
    display: 'grid',
    fontSize: '0.82rem',
    fontWeight: 750,
    gap: spacing.xs,
  },
  control: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    font: 'inherit',
    padding: spacing.sm,
    width: '100%',
  },
  invalid: {
    borderColor: colors.danger,
  },
  issue: {
    color: colors.danger,
    fontSize: '0.78rem',
    fontWeight: 650,
    margin: 0,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    color: colors.textMuted,
    display: 'flex',
    fontSize: '0.8rem',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingBlockStart: spacing.md,
  },
})

const decodePriority = Schema.decodeUnknownOption(TodoPriority)

export const TodoEditor = ({
  atoms,
  id,
  onClose,
}: {
  readonly atoms: TodoAtoms
  readonly id: string
  readonly onClose: () => void
}) => {
  const todo = useAtomValue(atoms.todo(id))
  const todoIndex = useAtomValue(atoms.todoIndex(id))
  const [editResult, edit] = useAtom(atoms.actions.edit)
  const validation = useAtomValue(atoms.validation)
  const dirty = useAtomValue(atoms.dirty)
  const titleIssues = validationIssuesAt(validation, [
    'document',
    'todos',
    todoIndex,
    'title',
  ])
  const notesIssues = validationIssuesAt(validation, [
    'document',
    'todos',
    todoIndex,
    'notes',
  ])

  if (todo === undefined) {
    return (
      <aside {...stylex.props(styles.panel)} aria-label="Todo editor">
        <p {...stylex.props(styles.copy)}>
          This todo no longer exists in the local draft.
        </p>
        <Button onClick={onClose}>Close editor</Button>
      </aside>
    )
  }

  const update = (changes: {
    readonly title?: string
    readonly notes?: string
    readonly priority?: TodoPriority
  }): void => {
    edit({
      id,
      title: changes.title ?? todo.title,
      notes: changes.notes ?? todo.notes,
      priority: changes.priority ?? todo.priority,
    })
  }

  return (
    <aside {...stylex.props(styles.panel)} aria-label="Todo editor">
      <header {...stylex.props(styles.header)}>
        <div>
          <span {...stylex.props(styles.eyebrow)}>Live draft editor</span>
          <h2 {...stylex.props(styles.heading)}>Edit locally</h2>
          <p {...stylex.props(styles.copy)}>
            This is the same Schema-backed tree as the original. Each field
            change is patch-recorded and undoable; the server sees nothing until
            Save.
          </p>
        </div>
        <Button compact onClick={onClose} tone="ghost">
          Close
        </Button>
      </header>

      <label {...stylex.props(styles.field)}>
        Title
        <input
          {...stylex.props(
            styles.control,
            titleIssues.length > 0 && styles.invalid
          )}
          aria-invalid={titleIssues.length > 0}
          onChange={(event) => update({ title: event.target.value })}
          value={todo.title}
        />
      </label>
      {titleIssues.map((issue) => (
        <p
          key={`${issue.code ?? 'title'}:${issue.message}`}
          {...stylex.props(styles.issue)}
        >
          {issue.message}
        </p>
      ))}

      <label {...stylex.props(styles.field)}>
        Notes
        <textarea
          {...stylex.props(
            styles.control,
            notesIssues.length > 0 && styles.invalid
          )}
          aria-invalid={notesIssues.length > 0}
          onChange={(event) => update({ notes: event.target.value })}
          rows={7}
          value={todo.notes}
        />
      </label>
      {notesIssues.map((issue) => (
        <p
          key={`${issue.code ?? 'notes'}:${issue.message}`}
          {...stylex.props(styles.issue)}
        >
          {issue.message}
        </p>
      ))}

      <label {...stylex.props(styles.field)}>
        Priority
        <select
          {...stylex.props(styles.control)}
          onChange={(event) => {
            const decoded = decodePriority(event.target.value)
            if (Option.isSome(decoded)) update({ priority: decoded.value })
          }}
          value={todo.priority}
        >
          {TodoPriority.literals.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </label>

      <AsyncFailure result={editResult} />
      <footer {...stylex.props(styles.footer)}>
        <span>{todo.notes.length} / 240 note characters</span>
        <strong>{dirty ? 'Uncommitted' : 'In sync'}</strong>
      </footer>
    </aside>
  )
}
