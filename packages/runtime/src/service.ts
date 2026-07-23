import type {
  TreeInvariantError,
  TreeSpec,
  TreeValue,
} from '@effect-state-tree/core'
import { Context, Effect, Layer, type Schema, type Scope } from 'effect'
import { makeTreeAction, type TreeAction } from './action'
import {
  makeTreeStore,
  makeTreeStoreScoped,
  type TreeStoreOptions,
} from './store'
import type { TreeStore, TreeStoreState } from './types'
import {
  deriveTreeOperationUpdate,
  deriveTreeUpdate,
  type TreeOperationUpdateRecipe,
  type TreeUpdate,
  type TreeUpdateOptions,
  type TreeUpdateRecipe,
} from './update'

/** Nominal Effect requirement carried by one uniquely named tree definition. */
export const TreeStoreIdentifierTypeId: unique symbol = Symbol(
  '@effect-state-tree/runtime/TreeStoreIdentifier'
)

/** Type-level identity preventing equally shaped tree services from mixing. */
export interface TreeStoreIdentifier<
  Id extends string,
  S extends Schema.Constraint,
> {
  /** Invariant nominal identity for the definition ID and Schema. */
  readonly [TreeStoreIdentifierTypeId]: {
    readonly id: Id
    readonly schema: S
  }
}

/**
 * Runtime-independent definition from which stores, Layers, actions, and UI
 * bindings are derived. A definition describes a tree but owns no live state.
 */
export interface TreeDefinition<
  Id extends string,
  S extends Schema.Constraint,
> {
  /** Stable Context service identifier supplied by the caller. */
  readonly identifier: Id
  /** Compiled Schema navigation and snapshot specification. */
  readonly spec: TreeSpec<S>
  /** Effect Context service used by definition-derived actions and updates. */
  readonly service: Context.Service<TreeStoreIdentifier<Id, S>, TreeStore<S>>
  /** Allocates a live store without attaching it to an Effect Scope. */
  readonly make: (
    initial: TreeValue<S>,
    options?: TreeStoreOptions
  ) => Effect.Effect<TreeStore<S>, TreeInvariantError>
  /** Allocates a live store that shuts down with the surrounding Effect Scope. */
  readonly makeScoped: (
    initial: TreeValue<S>,
    options?: TreeStoreOptions
  ) => Effect.Effect<TreeStore<S>, TreeInvariantError, Scope.Scope>
  /** Builds a scoped Layer providing this definition's unique tree service. */
  readonly layer: (
    initial: TreeValue<S>,
    options?: TreeStoreOptions
  ) => Layer.Layer<TreeStoreIdentifier<Id, S>, TreeInvariantError>
  /** Reads the current tree snapshot from the store in Effect Context. */
  readonly get: Effect.Effect<TreeValue<S>, never, TreeStoreIdentifier<Id, S>>
  /** Reads the current snapshot and revision atomically from Context. */
  readonly getState: Effect.Effect<
    TreeStoreState<S>,
    never,
    TreeStoreIdentifier<Id, S>
  >
  /** Derives a context-resolved update from an ordinary mutation recipe. */
  readonly update: <Input = void, E = never, R = never>(
    recipe: TreeUpdateRecipe<S, Input>,
    options?: TreeUpdateOptions<S, Input, E, R>
  ) => TreeUpdate<Id, S, Input, E, R>
  /** Derives a context-resolved update that records semantic operations. */
  readonly operationUpdate: <Input = void, E = never, R = never>(
    recipe: TreeOperationUpdateRecipe<S, Input>,
    options?: TreeUpdateOptions<S, Input, E, R>
  ) => TreeUpdate<Id, S, Input, E, R>
  /**
   * Derives an interruptible Effect workflow with shared action metadata.
   *
   * The handler may perform arbitrary synchronous or asynchronous Effects.
   * Every nested tree commit inherits one action ID and the supplied name as
   * its default label; no lock or explicit store parameter is required.
   */
  readonly action: <Input = void, A = void, E = never, R = never>(
    name: string,
    handler: (input: Input) => Effect.Effect<A, E, R>
  ) => TreeAction<Id, S, Input, A, E, R>
}

/**
 * Defines one application tree and its unique Effect service without creating
 * a store. Framework bindings and actions should derive from this value.
 */
export const defineTree = <
  const Id extends string,
  S extends Schema.Constraint,
>(
  identifier: Id,
  spec: TreeSpec<S>
): TreeDefinition<Id, S> => {
  const service = Context.Service<TreeStoreIdentifier<Id, S>, TreeStore<S>>(
    identifier
  )
  const definition: TreeDefinition<Id, S> = {
    identifier,
    spec,
    service,
    make: (initial, options) => makeTreeStore(spec, initial, options),
    makeScoped: (initial, options) =>
      makeTreeStoreScoped(spec, initial, options),
    layer: (initial, options) =>
      Layer.effect(service, makeTreeStoreScoped(spec, initial, options)),
    get: Effect.flatMap(service, (store) => store.get),
    getState: Effect.flatMap(service, (store) => store.getState),
    update: (recipe, options) => deriveTreeUpdate(definition, recipe, options),
    operationUpdate: (recipe, options) =>
      deriveTreeOperationUpdate(definition, recipe, options),
    action: (name, handler) => makeTreeAction(definition, name, handler),
  }

  return Object.freeze(definition)
}
