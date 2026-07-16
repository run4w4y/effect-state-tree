import {
  type CommandController,
  type CommandExecutionOptions,
  type CommandResult,
  type CommandRuntime,
  makeCommandController,
} from '@effect-state-tree/runtime'
import { Effect, type Fiber } from 'effect'
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'

import { useStoreView } from './store-view'

/** React-facing alias of the shared Effect-native command result. */
export type TreeCommandResult<A, E> = CommandResult<A, E>

/** React-facing alias of the runtime capability used to fork commands. */
export type TreeCommandRuntime<R, ER> = CommandRuntime<R, ER>

/** Current command state and stable imperative controls returned by the hook. */
export interface TreeCommandHandle<Args extends ReadonlyArray<unknown>, A, E> {
  readonly result: TreeCommandResult<A, E>
  readonly run: (...args: Args) => Fiber.Fiber<A, E>
  readonly cancel: () => void
  readonly reset: () => void
}

const DefaultCommandRuntime: CommandRuntime<never> = {
  runFork: Effect.runFork,
}

const CommandRuntimeContext = createContext<CommandRuntime<never>>(
  DefaultCommandRuntime
)

export const useCommandRuntime = (): CommandRuntime<never> =>
  useContext(CommandRuntimeContext)

export const useCommandController = <
  R,
  RuntimeError,
  Args extends ReadonlyArray<unknown>,
  A,
  E,
>(
  runtime: CommandRuntime<R, RuntimeError>,
  command: (...args: Args) => Effect.Effect<A, E, R>,
  options: CommandExecutionOptions
): TreeCommandHandle<Args, A, E | RuntimeError> => {
  const runtimeRef = useRef(runtime)
  const commandRef = useRef(command)
  const executionRef = useRef(options.execution)
  useLayoutEffect(() => {
    runtimeRef.current = runtime
    commandRef.current = command
    executionRef.current = options.execution
  }, [runtime, command, options.execution])

  const controllerRef = useRef<
    CommandController<Args, A, E | RuntimeError> | undefined
  >(undefined)
  let controller = controllerRef.current

  if (controller === undefined) {
    const currentRuntime: CommandRuntime<R, RuntimeError> = {
      runFork: (effect, runOptions) =>
        runtimeRef.current.runFork(effect, runOptions),
    }
    const currentOptions: CommandExecutionOptions = {
      get execution() {
        return executionRef.current
      },
    }
    controller = makeCommandController(
      currentRuntime,
      (...args) => commandRef.current(...args),
      currentOptions
    )
    controllerRef.current = controller
  }

  const result = useStoreView(controller)
  const lifecycleRef = useRef(0)
  useEffect(() => {
    lifecycleRef.current += 1
    return () => {
      lifecycleRef.current += 1
      const cleanupVersion = lifecycleRef.current
      queueMicrotask(() => {
        if (lifecycleRef.current === cleanupVersion) controller.dispose()
      })
    }
  }, [controller])

  return {
    result,
    run: controller.run,
    cancel: controller.cancel,
    reset: controller.reset,
  }
}

/**
 * Runs a fully provided Effect command with the default `Effect.runFork`
 * runtime. The execution strategy defaults to `switch`; use `merge` when
 * independent overlapping invocations must all remain active.
 */
export const useTreeCommand = <Args extends ReadonlyArray<unknown>, A, E>(
  command: (...args: Args) => Effect.Effect<A, E>,
  options: CommandExecutionOptions = {}
): TreeCommandHandle<Args, A, E> =>
  useCommandController(useCommandRuntime(), command, options)

/** Overrides fully provided command execution for a React subtree. */
export const TreeCommandRuntimeProvider = ({
  children,
  runtime,
}: {
  readonly children?: ReactNode
  readonly runtime: CommandRuntime<never>
}): ReactNode =>
  createElement(CommandRuntimeContext.Provider, { value: runtime }, children)
