import type {
  TreeInvariantError,
  TreeSpec,
  TreeValue,
} from '@effect-state-tree/core'
import { Context, type Effect, Layer, type Schema, type Scope } from 'effect'
import {
  makeTreeStore,
  makeTreeStoreScoped,
  type TreeStoreOptions,
} from './store'
import type { TreeStore } from './types'

/** Nominal Effect requirement carried by one uniquely named tree definition. */
export const TreeStoreIdentifierTypeId: unique symbol = Symbol(
  '@effect-state-tree/runtime/TreeStoreIdentifier'
)

/** Type-level identity preventing equally shaped tree services from mixing. */
export interface TreeStoreIdentifier<
  Id extends string,
  S extends Schema.Constraint,
> {
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
  readonly identifier: Id
  readonly spec: TreeSpec<S>
  readonly service: Context.Service<TreeStoreIdentifier<Id, S>, TreeStore<S>>
  readonly make: (
    initial: TreeValue<S>,
    options?: TreeStoreOptions
  ) => Effect.Effect<TreeStore<S>, TreeInvariantError>
  readonly makeScoped: (
    initial: TreeValue<S>,
    options?: TreeStoreOptions
  ) => Effect.Effect<TreeStore<S>, TreeInvariantError, Scope.Scope>
  readonly layer: (
    initial: TreeValue<S>,
    options?: TreeStoreOptions
  ) => Layer.Layer<TreeStoreIdentifier<Id, S>, TreeInvariantError>
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
  }

  return Object.freeze(definition)
}
