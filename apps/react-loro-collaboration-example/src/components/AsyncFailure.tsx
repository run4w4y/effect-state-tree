import * as stylex from '@stylexjs/stylex'
import { Cause } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'

import { colors, radii, spacing } from '../styles/tokens.stylex'

const styles = stylex.create({
  failure: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.danger,
    fontSize: '0.82rem',
    margin: 0,
    overflowX: 'auto',
    padding: spacing.md,
    whiteSpace: 'pre-wrap',
  },
})

export const AsyncFailure = <A, E>({
  result,
}: {
  readonly result: AsyncResult.AsyncResult<A, E>
}) =>
  AsyncResult.isFailure(result) ? (
    <pre {...stylex.props(styles.failure)}>{Cause.pretty(result.cause)}</pre>
  ) : null
