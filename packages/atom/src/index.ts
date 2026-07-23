import type { TreeValue } from '@effect-state-tree/core'
import type {
  SelectOptions,
  StoreView,
  TreeDefinition,
  TreeStore,
  TreeStoreIdentifier,
} from '@effect-state-tree/runtime'
import { Layer, type Schema } from 'effect'
import { Atom } from 'effect/unstable/reactivity'

/**
 * Converts a framework-neutral runtime view into an Atom. The view subscription
 * is acquired when the Atom is mounted and released when the registry no longer
 * has consumers, so every official Effect Atom framework binding gets the same
 * lifecycle and state semantics.
 */
export const atomFromView = <A>(view: StoreView<A>): Atom.Atom<A> =>
  Atom.readable((context) => {
    context.addFinalizer(
      view.subscribe(() => context.setSelf(view.getSnapshot()))
    )
    return view.getSnapshot()
  })

/**
 * Creates an Atom backed by a tree selector. Path filtering, equality, and
 * structural-sharing behavior remain owned by the runtime StoreView rather
 * than being reimplemented by individual UI frameworks.
 */
export const atomFromTreeSelector = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  options?: SelectOptions<A>
): Atom.Atom<A> => atomFromView(store.select(selector, options))

/**
 * Stable Atom projection of one admitted tree store. `fn` is the native Effect
 * Atom runtime function constructor with the tree service already provided, so
 * Effect workflows resolve their store from Context without receiving it as an
 * argument. Native Atom `AsyncResult`, interruption, reset, concurrency, and
 * reactivity behavior are preserved without a second command abstraction.
 */
export interface TreeAtoms<
  Id extends string,
  S extends Schema.Constraint,
  R,
  ER,
> {
  /** Tree definition supplied to context-resolved actions and updates. */
  readonly definition: TreeDefinition<Id, S>
  /** Live tree store projected by these Atoms. */
  readonly store: TreeStore<S>
  /** Native Effect Atom runtime providing the tree and application Layer. */
  readonly runtime: Atom.AtomRuntime<R, ER>
  /** Stable Atom containing the current canonical tree snapshot. */
  readonly snapshot: Atom.Atom<TreeValue<S>>
  /** Creates an Atom from a tree selector and optional invalidation policy. */
  readonly select: <A>(
    selector: (snapshot: TreeValue<S>) => A,
    options?: SelectOptions<A>
  ) => Atom.Atom<A>
  /** Converts an existing framework-neutral StoreView into an Atom. */
  readonly view: <A>(view: StoreView<A>) => Atom.Atom<A>
  /**
   * Native Effect Atom function constructor bound to this runtime.
   *
   * It preserves Atom `AsyncResult`, interruption, reset, and concurrency
   * semantics; tree actions resolve their store from Context automatically.
   */
  readonly fn: Atom.AtomRuntime<R, ER>['fn']
}

const makeTreeAtomsFromRuntime = <
  const Id extends string,
  S extends Schema.Constraint,
  R,
  ER,
>(
  definition: TreeDefinition<Id, S>,
  store: TreeStore<S>,
  runtime: Atom.AtomRuntime<R, ER>
): TreeAtoms<Id, S, R, ER> => ({
  definition,
  store,
  runtime,
  snapshot: atomFromTreeSelector(store, (snapshot) => snapshot),
  select: (selector, options) => atomFromTreeSelector(store, selector, options),
  view: atomFromView,
  fn: runtime.fn.bind(runtime),
})

/**
 * Derives the complete Atom interface for an existing store. The generated
 * runtime provides only that tree definition, which is sufficient for actions
 * derived from `TreeDefinition.update` and `TreeDefinition.operationUpdate`.
 */
export const makeTreeAtoms = <
  const Id extends string,
  S extends Schema.Constraint,
>(
  definition: TreeDefinition<Id, S>,
  store: TreeStore<S>
): TreeAtoms<Id, S, TreeStoreIdentifier<Id, S>, never> =>
  makeTreeAtomsFromRuntime(
    definition,
    store,
    Atom.runtime(Layer.succeed(definition.service, store))
  )

/**
 * Derives the Atom interface while also supplying an application Layer. Use
 * this when application workflows require services beyond their tree store;
 * callers still write the action input directly to the resulting function Atom.
 */
export const makeTreeAtomsWithLayer = <
  const Id extends string,
  S extends Schema.Constraint,
  R,
  ER,
>(
  definition: TreeDefinition<Id, S>,
  store: TreeStore<S>,
  layer: Layer.Layer<R, ER>
): TreeAtoms<Id, S, TreeStoreIdentifier<Id, S> | R, ER> =>
  makeTreeAtomsFromRuntime(
    definition,
    store,
    Atom.runtime(Layer.merge(Layer.succeed(definition.service, store), layer))
  )
