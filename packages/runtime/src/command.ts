import { Effect, Fiber, Option, Queue, Stream } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'

import type { StoreView } from './types'

/** Effect-native observable result of a framework-neutral command. */
export type CommandResult<A, E> = AsyncResult.AsyncResult<A, E>

/** Strategy used when a command is invoked while another invocation is active. */
export type CommandExecution = 'switch' | 'merge'

/** Shared execution options accepted by framework-neutral command bindings. */
export interface CommandExecutionOptions {
  /**
   * `switch` interrupts superseded invocations, while `merge` keeps every
   * invocation active. Defaults to `switch`.
   */
  readonly execution?: CommandExecution | undefined
}

/** Minimal runtime capability required to fork commands needing `R`. */
export interface CommandRuntime<R, RuntimeError = never> {
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions
  ) => Fiber.Fiber<A, E | RuntimeError>
}

/** Imperative command controls paired with a reactive lifecycle view. */
export interface CommandController<Args extends ReadonlyArray<unknown>, A, E>
  extends StoreView<CommandResult<A, E>> {
  readonly run: (...args: Args) => Fiber.Fiber<A, E>
  readonly cancel: () => void
  readonly reset: () => void
  readonly dispose: () => void
}

/**
 * Runs Effect commands independently of a UI framework while exposing an
 * external-store view of their lifecycle. Framework adapters only need to bind
 * `getSnapshot` and `subscribe` to their native reactive primitive.
 */
export const makeCommandController = <
  R,
  RuntimeError,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
>(
  runtime: CommandRuntime<R, RuntimeError>,
  command: (...args: Args) => Effect.Effect<A, E, R>,
  options: CommandExecutionOptions = {}
): CommandController<Args, A, E | RuntimeError> => {
  let result: CommandResult<A, E | RuntimeError> = AsyncResult.initial()
  let generation = 0
  let disposed = false
  const listeners = new Set<() => void>()
  const running = new Set<Fiber.Fiber<A, E | RuntimeError>>()
  let latestCompleted:
    | {
        readonly generation: number
        readonly result:
          | AsyncResult.Success<A, E | RuntimeError>
          | AsyncResult.Failure<A, E | RuntimeError>
      }
    | undefined

  const publish = (next: CommandResult<A, E | RuntimeError>): void => {
    result = next
    for (const listener of listeners) listener()
  }

  const interruptAll = (publishIdle: boolean): void => {
    generation += 1
    const fibers = [...running]
    running.clear()
    latestCompleted = undefined
    for (const fiber of fibers) Effect.runFork(Fiber.interrupt(fiber))
    if (publishIdle && !disposed) publish(AsyncResult.initial())
  }

  const cancel = (): void => interruptAll(true)

  const run = (...args: Args): Fiber.Fiber<A, E | RuntimeError> => {
    if (disposed) throw new Error('Cannot run a disposed command controller')
    if (options.execution !== 'merge') interruptAll(false)
    generation += 1
    const runGeneration = generation
    const fiber = runtime.runFork(Effect.suspend(() => command(...args)))
    running.add(fiber)
    publish(AsyncResult.waiting(result))
    fiber.addObserver((exit) => {
      if (!running.delete(fiber) || disposed) return
      if (
        latestCompleted === undefined ||
        runGeneration > latestCompleted.generation
      ) {
        latestCompleted = {
          generation: runGeneration,
          result: AsyncResult.fromExitWithPrevious(exit, Option.some(result)),
        }
      }
      if (running.size > 0) {
        if (latestCompleted !== undefined) {
          publish(AsyncResult.waiting(latestCompleted.result))
        }
        return
      }
      if (latestCompleted !== undefined) {
        publish(latestCompleted.result)
      }
    })
    return fiber
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    getSnapshot: () => result,
    subscribe,
    changes: Stream.callback<CommandResult<A, E | RuntimeError>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          Queue.offerUnsafe(queue, result)
          return subscribe(() => Queue.offerUnsafe(queue, result))
        }),
        (unsubscribe) => Effect.sync(unsubscribe)
      )
    ),
    run,
    cancel,
    reset() {
      interruptAll(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      interruptAll(false)
      listeners.clear()
    },
  }
}
