import { Effect, Queue, type Schema, Stream } from 'effect'

import type {
  ChangeEnvelope,
  CommitReducer,
  StoreView,
  TreeStore,
} from './types'

/** Result of reducing one commit through a portable plugin state machine. */
export interface ReducedPluginState<State, Command> {
  readonly state: State
  readonly commands: ReadonlyArray<Command>
}

/** Evaluates one portable plugin reducer without allocating runtime state. */
export const reduceCommit = <State, S extends Schema.Constraint, Command>(
  reducer: CommitReducer<State, S, Command>,
  state: State,
  commit: ChangeEnvelope<S>
): ReducedPluginState<State, Command> => {
  const [next, commands] = reducer.reduce(state, commit)
  return { state: next, commands }
}

/** Live StoreView interpreter for a pure commit reducer. */
export interface CommitReducerController<
  State,
  S extends Schema.Constraint,
  Command,
> extends StoreView<State> {
  readonly setState: (state: State) => void
  readonly dispatch: (commit: ChangeEnvelope<S>) => ReadonlyArray<Command>
  readonly dispose: () => void
}

/** Notification and command-delivery policy for a live reducer controller. */
export interface CommitReducerControllerOptions<State, Command> {
  readonly initial?: State
  readonly equals?: (left: State, right: State) => boolean
  readonly onCommands?: (commands: ReadonlyArray<Command>) => void
  readonly onListenerError?: (error: unknown) => void
}

/**
 * Interprets a pure CommitReducer against a live TreeStore.
 *
 * Plugin packages can keep their state transition logic portable for Foldkit
 * while sharing one subscription, notification, and command-delivery runtime.
 */
export const makeCommitReducerController = <
  State,
  S extends Schema.Constraint,
  Command = never,
>(
  store: TreeStore<S>,
  reducer: CommitReducer<State, S, Command>,
  options: CommitReducerControllerOptions<State, Command> = {}
): CommitReducerController<State, S, Command> => {
  const equals = options.equals ?? Object.is
  let state = options.initial ?? reducer.initial
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        options.onListenerError?.(error)
      }
    }
  }

  const setState = (next: State): void => {
    if (equals(state, next)) return
    state = next
    notify()
  }

  const dispatch = (commit: ChangeEnvelope<S>): ReadonlyArray<Command> => {
    const [next, commands] = reducer.reduce(state, commit)
    setState(next)
    if (commands.length > 0) options.onCommands?.(commands)
    return commands
  }

  const dispose = store.subscribe(dispatch)

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    getSnapshot: () => state,
    subscribe,
    changes: Stream.callback<State>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          Queue.offerUnsafe(queue, state)
          return subscribe(() => Queue.offerUnsafe(queue, state))
        }),
        (unsubscribe) => Effect.sync(unsubscribe)
      )
    ),
    setState,
    dispatch,
    dispose,
  }
}
