import { useStoreView, useTreeCommand } from '@effect-state-tree/react'
import * as stylex from '@stylexjs/stylex'
import { Option, Schema } from 'effect'

import { TodoFilter } from '../../shared/todo'
import { changeFilter } from '../state/actions'
import { TodoReact } from '../state/todo-tree'
import type { TodoWorkspace } from '../state/workspace'
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

export const TodoToolbar = ({
  workspace,
}: {
  readonly workspace: TodoWorkspace
}) => {
  const filter = TodoReact.useSelector((state) => state.filter, {
    paths: [['filter']],
  })
  const history = useStoreView(workspace.history)
  const change = TodoReact.useCommand(changeFilter)
  const undo = useTreeCommand(() => workspace.history.undo)
  const redo = useTreeCommand(() => workspace.history.redo)

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
                if (Option.isSome(decoded)) change.run(decoded.value)
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
            disabled={history.undo.length === 0 || undo.result.waiting}
            onClick={() => undo.run()}
          >
            Undo
          </Button>
          <Button
            compact
            disabled={history.redo.length === 0 || redo.result.waiting}
            onClick={() => redo.run()}
          >
            Redo
          </Button>
        </div>
      </div>
      <AsyncFailure result={change.result} />
      <AsyncFailure result={undo.result} />
      <AsyncFailure result={redo.result} />
    </>
  )
}
