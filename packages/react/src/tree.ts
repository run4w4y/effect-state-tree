import type { TreeValue } from '@effect-state-tree/core'
import type {
  CommandExecutionOptions,
  CommandRuntime,
  SelectOptions,
  TreeDefinition,
  TreeStore,
  TreeStoreIdentifier,
} from '@effect-state-tree/runtime'
import { Effect, type Schema } from 'effect'
import { createContext, createElement, type ReactNode, useContext } from 'react'

import {
  type TreeCommandHandle,
  useCommandController,
  useCommandRuntime,
} from './command'
import { useTreeSelector, useTreeSnapshot } from './selector-binding'

/**
 * Store supplied to definition-bound React hooks. The Provider does not create,
 * retain, or shut down the store; its application owner controls that lifetime.
 */
export interface TreeProviderProps<S extends Schema.Constraint> {
  readonly store: TreeStore<S>
  readonly children?: ReactNode
}

/**
 * React projection of a runtime-independent TreeDefinition. Selectors accept
 * inline functions without resubscribing, while commands resolve the current
 * Provider store through Effect Context.
 */
export interface TreeReactBindings<
  Id extends string,
  S extends Schema.Constraint,
  Requirements = never,
  RuntimeError = never,
> {
  readonly definition: TreeDefinition<Id, S>
  readonly Provider: (props: TreeProviderProps<S>) => ReactNode
  readonly useStore: () => TreeStore<S>
  readonly useSelector: <A>(
    selector: (snapshot: TreeValue<S>) => A,
    options?: SelectOptions<A>
  ) => A
  readonly useSnapshot: () => TreeValue<S>
  readonly useCommand: <Args extends ReadonlyArray<unknown>, A, E>(
    command: (
      ...args: Args
    ) => Effect.Effect<A, E, TreeStoreIdentifier<Id, S> | Requirements>,
    options?: CommandExecutionOptions
  ) => TreeCommandHandle<Args, A, E | RuntimeError>
  readonly withRuntime: <R, ER = never>(
    runtime: CommandRuntime<R, ER>
  ) => TreeReactBindings<Id, S, R, ER>
}

const ReactBindingsCache = new WeakMap<object, unknown>()

/**
 * Derives React bindings from the same tree definition used by Layers and
 * actions. The Provider supplies its store to every context-backed action.
 * Fully provided commands use Effect.runFork unless a runtime context overrides
 * it; service-requiring commands use a binding created with withRuntime.
 *
 * Bindings are cached by definition, so separate modules deriving from the same
 * definition share one React Context. Component-level useMemo is unnecessary.
 */
export const bindReactTree = <
  const Id extends string,
  S extends Schema.Constraint,
>(
  definition: TreeDefinition<Id, S>
): TreeReactBindings<Id, S> => {
  const cached = ReactBindingsCache.get(definition) as
    | TreeReactBindings<Id, S>
    | undefined
  if (cached !== undefined) return cached

  const StoreContext = createContext<TreeStore<S> | null>(null)

  const useStore = (): TreeStore<S> => {
    const store = useContext(StoreContext)
    if (store === null) {
      throw new Error(
        `Tree hooks for ${definition.identifier} must be used below its Provider`
      )
    }
    return store
  }

  const Provider = ({ store, children }: TreeProviderProps<S>): ReactNode =>
    createElement(StoreContext.Provider, { value: store }, children)

  const makeBindings = <Requirements, RuntimeError>(
    useRuntime: () => CommandRuntime<Requirements, RuntimeError>
  ): TreeReactBindings<Id, S, Requirements, RuntimeError> => {
    const useCommand = <Args extends ReadonlyArray<unknown>, A, E>(
      command: (
        ...args: Args
      ) => Effect.Effect<A, E, TreeStoreIdentifier<Id, S> | Requirements>,
      options: CommandExecutionOptions = {}
    ): TreeCommandHandle<Args, A, E | RuntimeError> => {
      const store = useStore()
      const runtime = useRuntime()
      return useCommandController(
        runtime,
        (...args) =>
          Effect.provideService(command(...args), definition.service, store),
        options
      )
    }

    return {
      definition,
      Provider,
      useStore,
      useSelector: <A>(
        selector: (snapshot: TreeValue<S>) => A,
        options?: SelectOptions<A>
      ): A => useTreeSelector(useStore(), selector, options),
      useSnapshot: (): TreeValue<S> => useTreeSnapshot(useStore()),
      useCommand,
      withRuntime: <R, ER = never>(
        runtime: CommandRuntime<R, ER>
      ): TreeReactBindings<Id, S, R, ER> => makeBindings<R, ER>(() => runtime),
    }
  }

  const bindings = makeBindings(useCommandRuntime)
  ReactBindingsCache.set(definition, bindings)
  return bindings
}
