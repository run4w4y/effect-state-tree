import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import * as stylex from '@stylexjs/stylex'
import { AsyncResult } from 'effect/unstable/reactivity'

import { AsyncFailure } from './client/components/AsyncFailure'
import { Button } from './client/components/Button'
import { StatusBanner } from './client/components/StatusBanner'
import { TodoPage } from './client/components/TodoPage'
import type { TodoAtoms } from './client/state/atoms'
import { colors, spacing } from './client/styles/tokens.stylex'

const styles = stylex.create({
  loading: {
    color: colors.text,
    display: 'grid',
    gap: spacing.lg,
    marginInline: 'auto',
    maxWidth: '42rem',
    padding: spacing.xl,
  },
})

export const App = ({ atoms }: { readonly atoms: TodoAtoms }) => {
  const initialLoad = useAtomValue(atoms.initialLoad)
  const retry = useAtomRefresh(atoms.initialLoad)

  if (AsyncResult.isSuccess(initialLoad)) return <TodoPage atoms={atoms} />

  return (
    <main {...stylex.props(styles.loading)}>
      <StatusBanner tone="warning">
        {initialLoad.waiting
          ? 'Loading the authoritative todo document…'
          : 'The todo document could not be loaded.'}
      </StatusBanner>
      <AsyncFailure result={initialLoad} />
      {AsyncResult.isFailure(initialLoad) && (
        <Button onClick={retry} tone="primary">
          Retry load
        </Button>
      )}
    </main>
  )
}
