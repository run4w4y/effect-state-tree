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

/** Mutable recipe paired with the single value accepted by a tree update. */
export type TreeUpdateRecipe<S extends Schema.Constraint, Input> = (
  tree: MutableTree<TreeValue<S>>,
  input: Input
) => void

/** Intent-preserving recipe with access to semantic operation recording. */
export type TreeOperationUpdateRecipe<S extends Schema.Constraint, Input> = (
  tree: MutableTree<TreeValue<S>>,
  operations: OperationRecorder,
  input: Input
) => void

/** Static or input-derived commit policy for one tree update. */
export type TreeUpdateOptions<S extends Schema.Constraint, Input, E, R> =
  | CommitOptions<S, E, R>
  | ((input: Input) => CommitOptions<S, E, R>)

/**
 * Context-resolved state transition. Calling an update creates an Effect; the
 * live store is selected only when that Effect runs.
 */
export interface TreeUpdate<
  Id extends string,
  S extends Schema.Constraint,
  Input,
  E = never,
  R = never,
> {
  /** Creates the context-resolved Effect that performs this update. */
  (
    input: Input
  ): Effect.Effect<
    CommitResult<S>,
    ProducerError | TreeStoreShutdownError | E,
    TreeStoreIdentifier<Id, S> | R
  >
  /** Tree definition whose store is resolved when the update Effect runs. */
  readonly definition: TreeDefinition<Id, S>
}

const resolveOptions = <S extends Schema.Constraint, Input, E, R>(
  options: TreeUpdateOptions<S, Input, E, R> | undefined,
  input: Input
): CommitOptions<S, E, R> | undefined =>
  typeof options === 'function' ? options(input) : options

/**
 * Builds an Effect update from an ordinary mutation recipe. The resulting
 * function never accepts a store; it obtains the matching store definition
 * service from Effect Context and commits exactly one patch batch.
 */
export const deriveTreeUpdate = <
  const Id extends string,
  S extends Schema.Constraint,
  Input = void,
  E = never,
  R = never,
>(
  definition: TreeDefinition<Id, S>,
  recipe: TreeUpdateRecipe<S, Input>,
  options?: TreeUpdateOptions<S, Input, E, R>
): TreeUpdate<Id, S, Input, E, R> => {
  const action = (input: Input) =>
    Effect.flatMap(definition.service, (store) =>
      store.update(
        (tree) => recipe(tree, input),
        resolveOptions(options, input)
      )
    )

  return Object.assign(action, { definition })
}

/**
 * Variant for updates that preserve semantic CRDT intent such as array moves,
 * splices, or collaborative text edits.
 */
export const deriveTreeOperationUpdate = <
  const Id extends string,
  S extends Schema.Constraint,
  Input = void,
  E = never,
  R = never,
>(
  definition: TreeDefinition<Id, S>,
  recipe: TreeOperationUpdateRecipe<S, Input>,
  options?: TreeUpdateOptions<S, Input, E, R>
): TreeUpdate<Id, S, Input, E, R> => {
  const action = (input: Input) =>
    Effect.flatMap(definition.service, (store) =>
      store.update(
        (tree, operations) => recipe(tree, operations, input),
        resolveOptions(options, input)
      )
    )

  return Object.assign(action, { definition })
}
