import type { TreeValue } from '@effect-state-tree/core'
import type {
  MutableTree,
  OperationRecorder,
  ProducerError,
} from '@effect-state-tree/producer'
import { Effect, type Schema } from 'effect'
import type { TreeDefinition, TreeStoreIdentifier } from './service'
import type {
  CommitOptions,
  CommitResult,
  TreeStoreShutdownError,
} from './types'

/** Mutable recipe paired with the arguments captured by a tree action. */
export type TreeActionRecipe<
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
> = (tree: MutableTree<TreeValue<S>>, ...args: Args) => void

/** Intent-preserving recipe with access to semantic operation recording. */
export type TreeOperationActionRecipe<
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
> = (
  tree: MutableTree<TreeValue<S>>,
  operations: OperationRecorder,
  ...args: Args
) => void

/** Static or argument-derived commit policy for one tree action. */
export type TreeActionOptions<
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
  E,
  R,
> = CommitOptions<S, E, R> | ((...args: Args) => CommitOptions<S, E, R>)

/**
 * Context-resolved state transition. Calling an action creates an Effect; the
 * live store is selected only when that Effect runs.
 */
export interface TreeAction<
  Id extends string,
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
  E = never,
  R = never,
> {
  (
    ...args: Args
  ): Effect.Effect<
    CommitResult<S>,
    ProducerError | TreeStoreShutdownError | E,
    TreeStoreIdentifier<Id, S> | R
  >
  readonly definition: TreeDefinition<Id, S>
}

const resolveOptions = <
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
  E,
  R,
>(
  options: TreeActionOptions<S, Args, E, R> | undefined,
  args: Args
): CommitOptions<S, E, R> | undefined =>
  typeof options === 'function' ? options(...args) : options

/**
 * Builds an Effect action from an ordinary update recipe. The resulting
 * function never accepts a store; it obtains the matching store definition
 * service from Effect Context and commits exactly one patch batch.
 */
export const makeTreeAction = <
  const Id extends string,
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
  E = never,
  R = never,
>(
  definition: TreeDefinition<Id, S>,
  recipe: TreeActionRecipe<S, Args>,
  options?: TreeActionOptions<S, Args, E, R>
): TreeAction<Id, S, Args, E, R> => {
  const action = (...args: Args) =>
    Effect.flatMap(definition.service, (store) =>
      store.update(
        (tree) => recipe(tree, ...args),
        resolveOptions(options, args)
      )
    )

  return Object.assign(action, { definition })
}

/**
 * Variant of `makeTreeAction` for updates that must preserve semantic CRDT
 * intent such as array moves, splices, or collaborative text edits.
 */
export const makeTreeOperationAction = <
  const Id extends string,
  S extends Schema.Constraint,
  Args extends ReadonlyArray<unknown>,
  E = never,
  R = never,
>(
  definition: TreeDefinition<Id, S>,
  recipe: TreeOperationActionRecipe<S, Args>,
  options?: TreeActionOptions<S, Args, E, R>
): TreeAction<Id, S, Args, E, R> => {
  const action = (...args: Args) =>
    Effect.flatMap(definition.service, (store) =>
      store.update(
        (tree, operations) => recipe(tree, operations, ...args),
        resolveOptions(options, args)
      )
    )

  return Object.assign(action, { definition })
}
