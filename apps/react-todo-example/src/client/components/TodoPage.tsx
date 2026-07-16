import {
  useStoreView,
  useTreeCommand,
  useTreeSelector,
} from '@effect-state-tree/react'
import * as stylex from '@stylexjs/stylex'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useState } from 'react'

import {
  selectRemaining,
  selectTotal,
  selectVersion,
  todoCountOptions,
} from '../state/selectors'
import { TodoReact } from '../state/todo-tree'
import type { TodoWorkspace } from '../state/workspace'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { AsyncFailure } from './AsyncFailure'
import { Button } from './Button'
import { StatusBanner } from './StatusBanner'
import { TodoComposer } from './TodoComposer'
import { TodoEditor } from './TodoEditor'
import { TodoList } from './TodoList'
import { TodoToolbar } from './TodoToolbar'

const styles = stylex.create({
  page: {
    marginInline: 'auto',
    maxWidth: '78rem',
    paddingBlock: spacing.xl,
    paddingInline: spacing.lg,
  },
  hero: {
    alignItems: 'end',
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'space-between',
    marginBlockEnd: spacing.xl,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: '0.76rem',
    fontWeight: 850,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 'clamp(2.2rem, 7vw, 5rem)',
    letterSpacing: '-0.055em',
    lineHeight: 0.94,
    marginBlock: spacing.sm,
  },
  subtitle: {
    color: colors.textMuted,
    lineHeight: 1.6,
    margin: 0,
    maxWidth: '48rem',
  },
  heroActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metrics: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBlockEnd: spacing.lg,
  },
  metric: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.round,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.textMuted,
    fontSize: '0.82rem',
    paddingBlock: spacing.xs,
    paddingInline: spacing.md,
  },
  strong: {
    color: colors.text,
  },
  layout: {
    alignItems: 'start',
    display: 'grid',
    gap: spacing.lg,
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  withEditor: {
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) minmax(18rem, 24rem)',
      '@media (max-width: 62rem)': 'minmax(0, 1fr)',
    },
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  section: {
    display: 'grid',
    gap: spacing.md,
  },
  divider: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    paddingBlockStart: spacing.lg,
  },
})

export const TodoPage = ({
  workspace,
}: {
  readonly workspace: TodoWorkspace
}) => {
  const [selectedTodoId, setSelectedTodoId] = useState<string | undefined>()
  const total = TodoReact.useSelector(selectTotal, todoCountOptions)
  const remaining = TodoReact.useSelector(selectRemaining, todoCountOptions)
  const draftVersion = TodoReact.useSelector(selectVersion, {
    paths: [['document', 'version']],
  })
  const originalVersion = useTreeSelector(
    workspace.original,
    (state) => state.document.version,
    { paths: [['document', 'version']] }
  )
  const validation = useStoreView(workspace.validation)
  const save = useTreeCommand(() => workspace.save)
  const reload = useTreeCommand(() => workspace.reload)
  const reset = useTreeCommand(() => workspace.reset)
  const dirty = workspace.isDirty()
  const errorCount = validation.issues.filter(
    (issue) => issue.severity === 'error'
  ).length

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.hero)}>
        <div>
          <span {...stylex.props(styles.eyebrow)}>
            Effect Tree State + HttpApi
          </span>
          <h1 {...stylex.props(styles.title)}>
            Draft first.
            <br />
            Save once.
          </h1>
          <p {...stylex.props(styles.subtitle)}>
            All edits happen in one long-lived local draft with patch-based undo
            and Schema diagnostics. Save performs one typed Effect HttpApi
            request, then reconciles the authoritative server document into the
            original tree.
          </p>
        </div>
        <div {...stylex.props(styles.heroActions)}>
          <Button
            disabled={!dirty || reset.result.waiting}
            onClick={() => reset.run()}
            tone="ghost"
          >
            Reset draft
          </Button>
          <Button
            disabled={dirty || reload.result.waiting}
            onClick={() => reload.run()}
            tone="secondary"
          >
            {reload.result.waiting ? 'Reloading…' : 'Reload server'}
          </Button>
          <Button
            disabled={!dirty || errorCount > 0 || save.result.waiting}
            onClick={() => save.run()}
            tone="primary"
          >
            {save.result.waiting ? 'Saving…' : 'Save to server'}
          </Button>
        </div>
      </header>

      <section {...stylex.props(styles.metrics)} aria-label="Document status">
        <span {...stylex.props(styles.metric)}>
          <strong {...stylex.props(styles.strong)}>{total}</strong> total
        </span>
        <span {...stylex.props(styles.metric)}>
          <strong {...stylex.props(styles.strong)}>{remaining}</strong>{' '}
          remaining
        </span>
        <span {...stylex.props(styles.metric)}>
          original v{originalVersion} / draft v{draftVersion}
        </span>
        <span {...stylex.props(styles.metric)}>
          {dirty ? 'local changes pending' : 'server synchronized'}
        </span>
      </section>

      {errorCount > 0 && (
        <StatusBanner tone="warning">
          {errorCount} Schema diagnostic{errorCount === 1 ? '' : 's'} must be
          fixed before saving.
        </StatusBanner>
      )}
      {AsyncResult.isSuccess(save.result) && !save.result.waiting && (
        <StatusBanner tone="success">
          Saved and reconciled server version {save.result.value.version}.
        </StatusBanner>
      )}
      <AsyncFailure result={save.result} />
      <AsyncFailure result={reload.result} />
      <AsyncFailure result={reset.result} />

      <div
        {...stylex.props(
          styles.layout,
          selectedTodoId !== undefined && styles.withEditor
        )}
      >
        <div {...stylex.props(styles.card)}>
          <TodoComposer />
          <section {...stylex.props(styles.section, styles.divider)}>
            <TodoToolbar workspace={workspace} />
            <TodoList onEdit={setSelectedTodoId} />
          </section>
        </div>
        {selectedTodoId !== undefined && (
          <TodoEditor
            id={selectedTodoId}
            onClose={() => setSelectedTodoId(undefined)}
            workspace={workspace}
          />
        )}
      </div>
    </main>
  )
}
