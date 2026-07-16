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
  getCurrentScope,
  type InjectionKey,
  inject,
  onScopeDispose,
  provide,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
} from 'vue'

/**
 * Thrown when a scope-managed composable is called without a Vue setup or
 * effect scope in which its subscription can be disposed.
 */
export class VueLifecycleError extends Error {
  readonly _tag = 'VueLifecycleError'

  constructor() {
    super(
      'effect-state-tree Vue composables must be called within a component setup or active effect scope'
    )
    this.name = 'VueLifecycleError'
  }
}

/** Converts a StoreView into a scope-managed, shallow readonly Vue ref. */
export const useStoreView = <A>(
  view: StoreView<A>
): Readonly<ShallowRef<A>> => {
  if (getCurrentScope() === undefined) throw new VueLifecycleError()

  const value = shallowRef<A>(view.getSnapshot())
  const unsubscribe = view.subscribe(() => {
    value.value = view.getSnapshot()
  })
  onScopeDispose(unsubscribe)
  return shallowReadonly(value)
}

/** Subscribes a Vue scope to one path-aware tree projection. */
export const useTreeSelector = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  options?: SelectOptions<A>
): Readonly<ShallowRef<A>> => useStoreView(store.select(selector, options))

/** Subscribes a Vue scope to the complete immutable tree snapshot. */
export const useTreeSnapshot = <S extends Schema.Constraint>(
  store: TreeStore<S>
): Readonly<ShallowRef<TreeValue<S>>> =>
  useTreeSelector(store, (snapshot) => snapshot)

/** Scope-managed command lifecycle ref and imperative controls. */
export interface VueCommandHandle<Arg, A, E> {
  readonly result: Readonly<ShallowRef<CommandResult<A, E>>>
  readonly run: (argument: Arg) => Fiber.Fiber<A, E>
  readonly cancel: () => void
  readonly reset: () => void
}

/**
 * Runs an Effect command and exposes its lifecycle through a shallow readonly
 * ref. Disposing the Vue scope interrupts active command fibers.
 */
export const useTreeCommand = <R, RuntimeError, Arg, A, E>(
  runtime: CommandRuntime<R, RuntimeError>,
  command: (argument: Arg) => Effect.Effect<A, E, R>,
  options: CommandExecutionOptions = {}
): VueCommandHandle<Arg, A, E | RuntimeError> => {
  if (getCurrentScope() === undefined) throw new VueLifecycleError()
  const controller = makeCommandController(runtime, command, options)
  const result = useStoreView(controller)
  onScopeDispose(controller.dispose)
  return {
    result,
    run: controller.run,
    cancel: controller.cancel,
    reset: controller.reset,
  }
}

/** Provide/inject composables bound to one application tree Schema. */
export interface TreeVueBindings<S extends Schema.Constraint> {
  readonly key: InjectionKey<TreeStore<S>>
  readonly provideStore: (store: TreeStore<S>) => void
  readonly useStore: () => TreeStore<S>
  readonly useSelector: <A>(
    selector: (snapshot: TreeValue<S>) => A,
    options?: SelectOptions<A>
  ) => Readonly<ShallowRef<A>>
  readonly useSnapshot: () => Readonly<ShallowRef<TreeValue<S>>>
}

/** Creates typed provide/inject bindings for one application tree Schema. */
export const createTreeVue = <S extends Schema.Constraint>(
  key: InjectionKey<TreeStore<S>> = Symbol('effect-state-tree')
): TreeVueBindings<S> => {
  const useStore = (): TreeStore<S> => {
    const store = inject(key, null)
    if (store === null) {
      throw new Error(
        'Tree composables must be used below their effect-state-tree Vue provider'
      )
    }
    return store
  }

  return {
    key,
    provideStore: (store) => provide(key, store),
    useStore,
    useSelector: (selector, options) =>
      useTreeSelector(useStore(), selector, options),
    useSnapshot: () => useTreeSnapshot(useStore()),
  }
}
