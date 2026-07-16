import type { TreeValue } from '@effect-state-tree/core'
import {
  type CommandExecutionOptions,
  type CommandResult,
  type CommandRuntime,
  makeCommandController,
  type SelectOptions,
  type StoreView,
  type TreeStore,
} from '@effect-state-tree/runtime'
import type { Effect, Fiber, Schema } from 'effect'
import {
  type Accessor,
  createComponent,
  createContext,
  createSignal,
  getOwner,
  onCleanup,
  type ParentComponent,
  useContext,
} from 'solid-js'

/**
 * Thrown when an owner-scoped binding is created outside a Solid reactive
 * owner, where automatic subscription cleanup would be impossible.
 */
export class SolidLifecycleError extends Error {
  readonly _tag = 'SolidLifecycleError'

  constructor() {
    super(
      'effect-state-tree Solid primitives must be created within a Solid reactive owner'
    )
    this.name = 'SolidLifecycleError'
  }
}

/**
 * Converts a framework-neutral StoreView into an owner-scoped Solid accessor.
 * The subscription is disposed with the current reactive owner.
 */
export const createStoreViewSignal = <A>(
  view: StoreView<A>,
  equals: false | ((previous: A, next: A) => boolean) = Object.is
): Accessor<A> => {
  if (getOwner() === null) throw new SolidLifecycleError()

  const [value, setValue] = createSignal(view.getSnapshot(), { equals })
  const unsubscribe = view.subscribe(() => {
    setValue(() => view.getSnapshot())
  })
  onCleanup(unsubscribe)
  return value
}

/** Creates a path-aware accessor over an immutable tree projection. */
export const createTreeSelector = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  options?: SelectOptions<A>
): Accessor<A> =>
  createStoreViewSignal(
    store.select(selector, options),
    options?.equals ?? Object.is
  )

/** Creates an accessor for the complete immutable tree snapshot. */
export const createTreeSnapshot = <S extends Schema.Constraint>(
  store: TreeStore<S>
): Accessor<TreeValue<S>> => createTreeSelector(store, (snapshot) => snapshot)

/** Owner-scoped command lifecycle accessor and imperative controls. */
export interface SolidCommandHandle<Arg, A, E> {
  readonly result: Accessor<CommandResult<A, E>>
  readonly run: (argument: Arg) => Fiber.Fiber<A, E>
  readonly cancel: () => void
  readonly reset: () => void
}

/**
 * Runs an Effect command and exposes its lifecycle as a Solid accessor. The
 * command controller and every active fiber are disposed with the owner.
 */
export const createTreeCommand = <R, RuntimeError, Arg, A, E>(
  runtime: CommandRuntime<R, RuntimeError>,
  command: (argument: Arg) => Effect.Effect<A, E, R>,
  options: CommandExecutionOptions = {}
): SolidCommandHandle<Arg, A, E | RuntimeError> => {
  const controller = makeCommandController(runtime, command, options)
  const result = createStoreViewSignal(controller)
  onCleanup(controller.dispose)
  return {
    result,
    run: controller.run,
    cancel: controller.cancel,
    reset: controller.reset,
  }
}

/** Context and reactive primitives bound to one application tree Schema. */
export interface TreeSolidBindings<S extends Schema.Constraint> {
  readonly Provider: ParentComponent<{ readonly store: TreeStore<S> }>
  readonly useStore: () => TreeStore<S>
  readonly createSelector: <A>(
    selector: (snapshot: TreeValue<S>) => A,
    options?: SelectOptions<A>
  ) => Accessor<A>
  readonly createSnapshot: () => Accessor<TreeValue<S>>
}

/** Creates typed context bindings for one application tree Schema. */
export const createTreeSolid = <
  S extends Schema.Constraint,
>(): TreeSolidBindings<S> => {
  const TreeContext = createContext<TreeStore<S>>()

  const Provider: ParentComponent<{ readonly store: TreeStore<S> }> = (props) =>
    createComponent(TreeContext.Provider, {
      value: props.store,
      get children() {
        return props.children
      },
    })

  const useStore = (): TreeStore<S> => {
    const store = useContext(TreeContext)
    if (store === undefined) {
      throw new Error(
        'Tree primitives must be used below their effect-state-tree Solid Provider'
      )
    }
    return store
  }

  return {
    Provider,
    useStore,
    createSelector: (selector, options) =>
      createTreeSelector(useStore(), selector, options),
    createSnapshot: () => createTreeSnapshot(useStore()),
  }
}
