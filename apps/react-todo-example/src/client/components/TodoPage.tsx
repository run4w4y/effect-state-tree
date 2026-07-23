import { useAtom, useAtomValue } from '@effect/atom-react'
import type { DraftSynchronizationResult } from '@effect-state-tree/draft'
import * as stylex from '@stylexjs/stylex'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useState } from 'react'
import type { TodoDocument } from '../../shared/todo'
import type { TodoAtoms } from '../state/atoms'
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

const synchronizationMessage = (
  operation: 'Saved' | 'Reloaded',
  result: DraftSynchronizationResult<TodoDocument>
): string => {
  switch (result._tag) {
    case 'Accepted':
      return `${operation} and reconciled server version ${result.authoritative.version}.`
    case 'AcceptedWithPendingChanges':
      return `${operation} server version ${result.authoritative.version}; newer local changes remain in the draft.`
    case 'Superseded':
      return `${operation} response was superseded by a newer authoritative change.`
  }
}

export const TodoPage = ({ atoms }: { readonly atoms: TodoAtoms }) => {
  const [selectedTodoId, setSelectedTodoId] = useState<string | undefined>()
  const total = useAtomValue(atoms.total)
  const remaining = useAtomValue(atoms.remaining)
  const draftVersion = useAtomValue(atoms.draftVersion)
  const originalVersion = useAtomValue(atoms.originalVersion)
  const validation = useAtomValue(atoms.validation)
  const dirty = useAtomValue(atoms.dirty)
  const [saveResult, save] = useAtom(atoms.actions.save)
  const [reloadResult, reload] = useAtom(atoms.actions.reload)
  const [resetResult, reset] = useAtom(atoms.actions.reset)
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
            disabled={!dirty || resetResult.waiting}
            onClick={() => reset(undefined)}
            tone="ghost"
          >
            Reset draft
          </Button>
          <Button
            disabled={dirty || reloadResult.waiting}
            onClick={() => reload(undefined)}
            tone="secondary"
          >
            {reloadResult.waiting ? 'Reloading…' : 'Reload server'}
          </Button>
          <Button
            disabled={!dirty || errorCount > 0 || saveResult.waiting}
            onClick={() => save(undefined)}
            tone="primary"
          >
            {saveResult.waiting ? 'Saving…' : 'Save to server'}
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
      {AsyncResult.isSuccess(saveResult) && !saveResult.waiting && (
        <StatusBanner tone="success">
          {synchronizationMessage('Saved', saveResult.value)}
        </StatusBanner>
      )}
      {AsyncResult.isSuccess(reloadResult) && !reloadResult.waiting && (
        <StatusBanner tone="success">
          {synchronizationMessage('Reloaded', reloadResult.value)}
        </StatusBanner>
      )}
      <AsyncFailure result={saveResult} />
      <AsyncFailure result={reloadResult} />
      <AsyncFailure result={resetResult} />

      <div
        {...stylex.props(
          styles.layout,
          selectedTodoId !== undefined && styles.withEditor
        )}
      >
        <div {...stylex.props(styles.card)}>
          <TodoComposer atoms={atoms} />
          <section {...stylex.props(styles.section, styles.divider)}>
            <TodoToolbar atoms={atoms} />
            <TodoList atoms={atoms} onEdit={setSelectedTodoId} />
          </section>
        </div>
        {selectedTodoId !== undefined && (
          <TodoEditor
            atoms={atoms}
            id={selectedTodoId}
            onClose={() => setSelectedTodoId(undefined)}
          />
        )}
      </div>
    </main>
  )
}
