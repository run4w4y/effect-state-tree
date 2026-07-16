import { Clock, Context, Effect } from 'effect'

import type { TransactionId } from './types'

/** Service used to allocate commit identifiers at execution time. */
export interface TransactionIdGenerator {
  readonly next: Effect.Effect<TransactionId>
}

let sequence = 0

const defaultGenerator = (): TransactionIdGenerator => ({
  next: Effect.gen(function* () {
    sequence += 1
    const now = yield* Clock.currentTimeMillis
    return `tree-${now.toString(36)}-${sequence.toString(36)}`
  }),
})

/**
 * Fiber-injectable transaction identifier source.
 *
 * Tests, replay engines, and distributed runtimes can provide a deterministic
 * implementation without adding identifier callbacks to every store.
 */
export const TransactionIds = Context.Reference<TransactionIdGenerator>(
  '@effect-state-tree/runtime/TransactionIds',
  { defaultValue: defaultGenerator }
)

/** Creates a transaction identifier service from a lazy pure generator. */
export const transactionIdsFrom = (
  next: () => TransactionId
): TransactionIdGenerator => ({ next: Effect.sync(next) })
