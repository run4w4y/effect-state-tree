import { useAtom, useAtomValue } from '@effect/atom-react'
import * as stylex from '@stylexjs/stylex'
import { Option, Schema } from 'effect'

import { TodoFilter } from '../../shared/todo'
import type { TodoAtoms } from '../state/atoms'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { AsyncFailure } from './AsyncFailure'
import { Button } from './Button'

const styles = stylex.create({
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  group: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  select: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    font: 'inherit',
    minHeight: '2.1rem',
    paddingInline: spacing.sm,
  },
  count: {
    color: colors.textMuted,
    fontSize: '0.84rem',
  },
})

const decodeFilter = Schema.decodeUnknownOption(TodoFilter)

export const TodoToolbar = ({ atoms }: { readonly atoms: TodoAtoms }) => {
  const filter = useAtomValue(atoms.filter)
  const history = useAtomValue(atoms.history)
  const [changeResult, change] = useAtom(atoms.actions.changeFilter)
  const [undoResult, undo] = useAtom(atoms.actions.undo)
  const [redoResult, redo] = useAtom(atoms.actions.redo)

  return (
    <>
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.group)}>
          <label>
            <span className="visually-hidden">Filter todos</span>
            <select
              {...stylex.props(styles.select)}
              aria-label="Filter todos"
              onChange={(event) => {
                const decoded = decodeFilter(event.target.value)
                if (Option.isSome(decoded)) change(decoded.value)
              }}
              value={filter}
            >
              {TodoFilter.literals.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <span {...stylex.props(styles.count)}>
            {history.undo.length} undo / {history.redo.length} redo
          </span>
        </div>
        <div {...stylex.props(styles.group)}>
          <Button
            compact
            disabled={history.undo.length === 0 || undoResult.waiting}
            onClick={() => undo(undefined)}
          >
            Undo
          </Button>
          <Button
            compact
            disabled={history.redo.length === 0 || redoResult.waiting}
            onClick={() => redo(undefined)}
          >
            Redo
          </Button>
        </div>
      </div>
      <AsyncFailure result={changeResult} />
      <AsyncFailure result={undoResult} />
      <AsyncFailure result={redoResult} />
    </>
  )
}
