import * as stylex from '@stylexjs/stylex'
import { Option, Schema } from 'effect'
import { useState } from 'react'

import { TodoPriority } from '../../shared/todo'
import { addTodo } from '../state/actions'
import { TodoReact } from '../state/todo-tree'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { AsyncFailure } from './AsyncFailure'
import { Button } from './Button'

const styles = stylex.create({
  form: {
    alignItems: 'end',
    display: 'grid',
    gap: spacing.sm,
    gridTemplateColumns: {
      default: 'minmax(12rem, 1fr) auto auto',
      '@media (max-width: 44rem)': '1fr',
    },
  },
  field: {
    display: 'grid',
    fontSize: '0.82rem',
    fontWeight: 700,
    gap: spacing.xs,
  },
  control: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    font: 'inherit',
    minHeight: '2.65rem',
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
  },
  grow: {
    minWidth: 0,
  },
})

const decodePriority = Schema.decodeUnknownOption(TodoPriority)

export const TodoComposer = () => {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<TodoPriority>('normal')
  const add = TodoReact.useCommand(addTodo)

  return (
    <section aria-labelledby="new-todo-heading">
      <h2 id="new-todo-heading">Add a local change</h2>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          const nextTitle = title.trim()
          if (nextTitle.length === 0) return
          add.run({ title: nextTitle, priority })
          setTitle('')
        }}
      >
        <label {...stylex.props(styles.field, styles.grow)}>
          Title
          <input
            {...stylex.props(styles.control, styles.grow)}
            aria-label="New todo title"
            disabled={add.result.waiting}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What should happen next?"
            value={title}
          />
        </label>
        <label {...stylex.props(styles.field)}>
          Priority
          <select
            {...stylex.props(styles.control)}
            aria-label="New todo priority"
            disabled={add.result.waiting}
            onChange={(event) => {
              const decoded = decodePriority(event.target.value)
              if (Option.isSome(decoded)) setPriority(decoded.value)
            }}
            value={priority}
          >
            {TodoPriority.literals.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={add.result.waiting || title.trim().length === 0}
          type="submit"
          tone="primary"
        >
          {add.result.waiting ? 'Adding…' : 'Add todo'}
        </Button>
      </form>
      <AsyncFailure result={add.result} />
    </section>
  )
}
