import type { StoreView } from '@effect-state-tree/runtime'
import { Effect, Queue, Stream } from 'effect'

export interface MutableStoreView<A> extends StoreView<A> {
  readonly set: (value: A) => void
}

export const makeMutableStoreView = <A>(initial: A): MutableStoreView<A> => {
  let value = initial
  const listeners = new Set<() => void>()

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    getSnapshot: () => value,
    subscribe,
    changes: Stream.callback<A>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          Queue.offerUnsafe(queue, value)
          return subscribe(() => Queue.offerUnsafe(queue, value))
        }),
        (unsubscribe) => Effect.sync(unsubscribe)
      )
    ),
    set(next) {
      if (Object.is(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}
