import {
  type GetAtPathFailure,
  getAtPath,
  type TreePath,
  type TreePathValue,
  type TreeValue,
} from '@effect-state-tree/core'
import { Data, Result, type Schema } from 'effect'
import type { ProposedCommit, Revision } from './types'

const TreeCheckpointStoreTypeId: unique symbol = Symbol(
  '@effect-state-tree/runtime/TreeCheckpointStore'
)

/** Immutable path value captured from one store revision. */
export interface TreeCheckpoint<
  S extends Schema.Constraint,
  P extends TreePath = TreePath,
> {
  /** Tuple path whose value is protected by this checkpoint. */
  readonly path: P
  /** Store revision at which the checkpoint was captured. */
  readonly revision: Revision
  /** Immutable root snapshot captured atomically with the revision. */
  readonly snapshot: TreeValue<S>
  /** Value observed at `path`; structural sharing is used to detect changes. */
  readonly value: TreePathValue<TreeValue<S>, P>
  /** Private store identity preventing cross-store checkpoint reuse. */
  readonly [TreeCheckpointStoreTypeId]: object
}

/** The checkpoint belongs to a different live store instance. */
export class TreeCheckpointStoreMismatch extends Data.TaggedError(
  'TreeCheckpointStoreMismatch'
)<{
  readonly path: TreePath
}> {}

/** The checkpoint path changed before its conditional commit could apply. */
export class TreeCheckpointConflict extends Data.TaggedError(
  'TreeCheckpointConflict'
)<{
  readonly path: TreePath
  readonly expectedRevision: Revision
  readonly actualRevision: Revision
}> {}

/** Failures that can reject a checkpoint-conditional commit. */
export type TreeCheckpointError =
  | TreeCheckpointStoreMismatch
  | TreeCheckpointConflict
  | GetAtPathFailure

export const makeTreeCheckpoint = <
  S extends Schema.Constraint,
  const P extends TreePath,
>(
  store: object,
  snapshot: TreeValue<S>,
  revision: Revision,
  path: P
): Result.Result<TreeCheckpoint<S, P>, GetAtPathFailure> =>
  Result.map(getAtPath(snapshot, path), (value) => {
    const frozenPath = Object.freeze([...path]) as P
    return Object.freeze({
      path: frozenPath,
      revision,
      snapshot,
      value: value as TreePathValue<TreeValue<S>, P>,
      [TreeCheckpointStoreTypeId]: store,
    })
  })

export const validateTreeCheckpoint = <
  S extends Schema.Constraint,
  P extends TreePath,
>(
  store: object,
  checkpoint: TreeCheckpoint<S, P>,
  proposal: ProposedCommit<S>
): Result.Result<void, TreeCheckpointError> => {
  if (checkpoint[TreeCheckpointStoreTypeId] !== store) {
    return Result.fail(
      new TreeCheckpointStoreMismatch({ path: checkpoint.path })
    )
  }

  const current = getAtPath(proposal.before, checkpoint.path)
  if (Result.isFailure(current)) return Result.fail(current.failure)
  if (!Object.is(current.success, checkpoint.value)) {
    return Result.fail(
      new TreeCheckpointConflict({
        path: checkpoint.path,
        expectedRevision: checkpoint.revision,
        actualRevision: proposal.revisionBefore,
      })
    )
  }

  return Result.succeed(undefined)
}
