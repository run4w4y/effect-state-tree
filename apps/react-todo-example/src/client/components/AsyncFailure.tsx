import { Cause } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'

import { StatusBanner } from './StatusBanner'

export const AsyncFailure = <A, E>({
  result,
}: {
  readonly result: AsyncResult.AsyncResult<A, E>
}) =>
  AsyncResult.isFailure(result) ? (
    <StatusBanner tone="error">{Cause.pretty(result.cause)}</StatusBanner>
  ) : null
