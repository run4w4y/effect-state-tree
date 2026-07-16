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
import { getContext, setContext } from 'svelte'
import { type Readable, readable } from 'svelte/store'

/** A Svelte readable that also supports synchronous external-store snapshots. */
export interface TreeReadable<A> extends Readable<A> {
  readonly getSnapshot: () => A
}

/** Converts a StoreView into a lazily subscribed Svelte readable. */
export const readableFromView = <A>(view: StoreView<A>): TreeReadable<A> => {
  const store = readable(view.getSnapshot(), (set) => {
    set(view.getSnapshot())
    return view.subscribe(() => set(view.getSnapshot()))
  })
  return {
    subscribe: store.subscribe,
    getSnapshot: view.getSnapshot,
  }
}

/** Creates a path-aware readable over one immutable tree projection. */
export const treeSelectorStore = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  options?: SelectOptions<A>
): TreeReadable<A> => readableFromView(store.select(selector, options))

/** Creates a readable for the complete immutable tree snapshot. */
export const treeSnapshotStore = <S extends Schema.Constraint>(
  store: TreeStore<S>
): TreeReadable<TreeValue<S>> =>
  treeSelectorStore(store, (snapshot) => snapshot)

/** Readable command lifecycle plus cancellation and disposal controls. */
export interface SvelteCommandStore<Arg, A, E>
  extends TreeReadable<CommandResult<A, E>> {
  readonly run: (argument: Arg) => Fiber.Fiber<A, E>
  readonly cancel: () => void
  readonly reset: () => void
  readonly dispose: () => void
}

/**
 * Runs an Effect command and exposes the shared command lifecycle as a Svelte
 * readable. Call `dispose` when the owning component or resource is destroyed.
 */
export const treeCommandStore = <R, RuntimeError, Arg, A, E>(
  runtime: CommandRuntime<R, RuntimeError>,
  command: (argument: Arg) => Effect.Effect<A, E, R>,
  options: CommandExecutionOptions = {}
): SvelteCommandStore<Arg, A, E | RuntimeError> => {
  const controller = makeCommandController(runtime, command, options)
  return {
    ...readableFromView(controller),
    run: controller.run,
    cancel: controller.cancel,
    reset: controller.reset,
    dispose: controller.dispose,
  }
}

/** Context and readable-store factories bound to one application tree Schema. */
export interface TreeSvelteBindings<S extends Schema.Constraint> {
  readonly provideStore: (store: TreeStore<S>) => TreeStore<S>
  readonly useStore: () => TreeStore<S>
  readonly selector: <A>(
    selector: (snapshot: TreeValue<S>) => A,
    options?: SelectOptions<A>
  ) => TreeReadable<A>
  readonly snapshot: () => TreeReadable<TreeValue<S>>
}

/** Creates typed context bindings for one application tree Schema. */
export const createTreeSvelte = <
  S extends Schema.Constraint,
>(): TreeSvelteBindings<S> => {
  const key = {}
  const useStore = (): TreeStore<S> => {
    const store = getContext<TreeStore<S> | undefined>(key)
    if (store === undefined) {
      throw new Error(
        'Tree stores must be read below their effect-state-tree Svelte context provider'
      )
    }
    return store
  }

  return {
    provideStore: (store) => setContext(key, store),
    useStore,
    selector: (selector, options) =>
      treeSelectorStore(useStore(), selector, options),
    snapshot: () => treeSnapshotStore(useStore()),
  }
}
