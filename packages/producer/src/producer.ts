import type {
  PatchSet,
  TreePatch,
  TreePatchError,
  TreeSpec,
  TreeValue,
} from '@effect-state-tree/core'
import {
  applyTreePatches,
  CollaborativeTextAnnotationKey,
  captureSnapshot,
  captureTreeSnapshot,
  type GetAtPathFailure,
  getAtPath,
  identityAt,
  isPlainObject,
  type SnapshotError,
  type SnapshotOptions,
  snapshotOptionsFor,
  type TreePath,
  treeAnnotationAt,
} from '@effect-state-tree/core'
import { Result, type Schema } from 'effect'
import {
  enablePatches,
  type Draft as ImmerDraft,
  type Patch as ImmerPatch,
  produceWithPatches,
} from 'immer'
import {
  freezeSemanticOperation,
  type OperationRecorder,
  type SemanticOperation,
} from './operations'

enablePatches()

/** Temporary mutable view exposed only for the duration of a recipe. */
export type MutableTree<A> = ImmerDraft<A>

/** Universal patches plus optional backend-fidelity operation intent. */
export interface ChangeSet {
  /** Universal forward and inverse tree patches. */
  readonly patches: PatchSet
  /** Intent-preserving operations corresponding to forward patches. */
  readonly operations: ReadonlyArray<SemanticOperation>
  /** Intent-preserving operations corresponding to inverse patches. */
  readonly inverseOperations: ReadonlyArray<SemanticOperation>
}

/** Immutable snapshot and change log produced by one successful recipe. */
export interface ProducedChange<A> {
  /** Immutable snapshot produced by the recipe. */
  readonly snapshot: A
  /** Universal patches and optional semantic intent. */
  readonly change: ChangeSet
  /** Tuple paths affected by the produced patch batch. */
  readonly touchedPaths: ReadonlyArray<TreePath>
}

/** Invalid explicit semantic operation attempted by a recipe. */
export interface ProducerOperationError {
  /** Discriminant for an invalid explicit semantic operation. */
  readonly _tag: 'ProducerOperationError'
  /** Explicit operation rejected by the producer. */
  readonly operation: SemanticOperation['_tag']
  /** Target path supplied to the operation. */
  readonly path: TreePath
  /** Operation precondition that failed. */
  readonly reason:
    | 'wrong-target'
    | 'out-of-bounds'
    | 'missing-key'
    | 'invalid-count'
    | 'not-collaborative-text'
}

/** All typed failures that can reject a mutable-looking recipe. */
export type ProducerError =
  | ProducerOperationError
  | GetAtPathFailure
  | SnapshotError
  | TreePatchError

interface MutableRecordState {
  readonly operations: Array<SemanticOperation>
  readonly inverseOperations: Array<SemanticOperation>
  readonly snapshotOptions: SnapshotOptions
  error: ProducerError | undefined
}

const toTreePatch = (patch: ImmerPatch): TreePatch =>
  patch.op === 'remove'
    ? { op: 'remove', path: patch.path }
    : { op: patch.op, path: patch.path, value: patch.value }

const captured = (value: unknown, state: MutableRecordState): unknown => {
  const snapshot = captureSnapshot(value, state.snapshotOptions)
  if (Result.isSuccess(snapshot)) return snapshot.success
  state.error ??= snapshot.failure
  return value
}

const operationError = (
  operation: SemanticOperation['_tag'],
  path: TreePath,
  reason: ProducerOperationError['reason']
): ProducerOperationError => ({
  _tag: 'ProducerOperationError',
  operation,
  path,
  reason,
})

const resolveMutable = (
  root: unknown,
  path: TreePath,
  state: MutableRecordState
): unknown => {
  const target = getAtPath(root, path)
  if (Result.isSuccess(target)) return target.success
  state.error ??= target.failure
  return undefined
}

const setMutableAtPath = (
  root: unknown,
  path: TreePath,
  value: unknown,
  state: MutableRecordState,
  operation: SemanticOperation['_tag']
): boolean => {
  if (path.length === 0) {
    state.error ??= operationError(operation, path, 'wrong-target')
    return false
  }
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  const parent = resolveMutable(root, parentPath, state)
  if (
    Array.isArray(parent) &&
    typeof key === 'number' &&
    key >= 0 &&
    key < parent.length
  ) {
    parent[key] = value
    return true
  }
  if (
    isPlainObject(parent) &&
    typeof key === 'string' &&
    Object.hasOwn(parent, key)
  ) {
    parent[key] = value
    return true
  }
  state.error ??= operationError(operation, path, 'wrong-target')
  return false
}

const makeRecorder = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  original: TreeValue<S>,
  root: MutableTree<TreeValue<S>>,
  state: MutableRecordState
): OperationRecorder => ({
  objectSet(path, key, value) {
    const target = resolveMutable(root, path, state)
    if (!isPlainObject(target)) {
      state.error ??= operationError('ObjectSet', path, 'wrong-target')
      return
    }
    const hadPrevious = Object.hasOwn(target, key)
    const previous = captured(target[key], state)
    const next = captured(value, state)
    target[key] = next
    state.operations.push({
      _tag: 'ObjectSet',
      path,
      key,
      value: next,
      previous,
      hadPrevious,
    })
    state.inverseOperations.unshift(
      hadPrevious
        ? {
            _tag: 'ObjectSet',
            path,
            key,
            value: previous,
            previous: next,
            hadPrevious: true,
          }
        : { _tag: 'ObjectDelete', path, key, previous: next }
    )
  },

  objectDelete(path, key) {
    const target = resolveMutable(root, path, state)
    if (!isPlainObject(target)) {
      state.error ??= operationError('ObjectDelete', path, 'wrong-target')
      return
    }
    if (!Object.hasOwn(target, key)) {
      state.error ??= operationError(
        'ObjectDelete',
        [...path, key],
        'missing-key'
      )
      return
    }
    const previous = captured(target[key], state)
    Reflect.deleteProperty(target, key)
    state.operations.push({ _tag: 'ObjectDelete', path, key, previous })
    state.inverseOperations.unshift({
      _tag: 'ObjectSet',
      path,
      key,
      value: previous,
      previous: undefined,
      hadPrevious: false,
    })
  },

  arraySplice(path, index, deleteCount, ...inserted) {
    const target = resolveMutable(root, path, state)
    if (!Array.isArray(target)) {
      state.error ??= operationError('ArraySplice', path, 'wrong-target')
      return
    }
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(deleteCount) ||
      index < 0 ||
      index > target.length ||
      deleteCount < 0
    ) {
      state.error ??= operationError('ArraySplice', path, 'out-of-bounds')
      return
    }
    const safeDeleteCount = Math.min(deleteCount, target.length - index)
    const insertedSnapshots = inserted.map((value) => captured(value, state))
    const removed = target
      .slice(index, index + safeDeleteCount)
      .map((value) => captured(value, state))
    target.splice(index, safeDeleteCount, ...insertedSnapshots)
    state.operations.push({
      _tag: 'ArraySplice',
      path,
      index,
      deleteCount: safeDeleteCount,
      inserted: insertedSnapshots,
      removed,
    })
    state.inverseOperations.unshift({
      _tag: 'ArraySplice',
      path,
      index,
      deleteCount: insertedSnapshots.length,
      inserted: removed,
      removed: insertedSnapshots,
    })
  },

  arrayMove(path, from, to, count = 1) {
    const target = resolveMutable(root, path, state)
    if (!Array.isArray(target)) {
      state.error ??= operationError('ArrayMove', path, 'wrong-target')
      return
    }
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      !Number.isSafeInteger(count) ||
      from < 0 ||
      count <= 0 ||
      from + count > target.length ||
      to < 0 ||
      to > target.length - count
    ) {
      state.error ??= operationError('ArrayMove', path, 'out-of-bounds')
      return
    }
    const identities = target.slice(from, from + count).flatMap((_, offset) => {
      const identity = identityAt(spec, root, [...path, from + offset])
      return identity === undefined ? [] : [identity]
    })
    const moved = target.splice(from, count)
    target.splice(to, 0, ...moved)
    state.operations.push({
      _tag: 'ArrayMove',
      path,
      from,
      to,
      count,
      entities: identities,
    })
    state.inverseOperations.unshift({
      _tag: 'ArrayMove',
      path,
      from: to,
      to: from,
      count,
      entities: identities,
    })
  },

  textInsert(path, index, text) {
    if (
      treeAnnotationAt<boolean>(
        spec,
        original,
        path,
        CollaborativeTextAnnotationKey
      ) !== true
    ) {
      state.error ??= operationError(
        'TextInsert',
        path,
        'not-collaborative-text'
      )
      return
    }
    const target = resolveMutable(root, path, state)
    if (
      typeof target !== 'string' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > target.length
    ) {
      state.error ??= operationError('TextInsert', path, 'out-of-bounds')
      return
    }
    const next = `${target.slice(0, index)}${text}${target.slice(index)}`
    if (!setMutableAtPath(root, path, next, state, 'TextInsert')) return
    state.operations.push({ _tag: 'TextInsert', path, index, text })
    state.inverseOperations.unshift({ _tag: 'TextDelete', path, index, text })
  },

  textDelete(path, index, count) {
    if (
      treeAnnotationAt<boolean>(
        spec,
        original,
        path,
        CollaborativeTextAnnotationKey
      ) !== true
    ) {
      state.error ??= operationError(
        'TextDelete',
        path,
        'not-collaborative-text'
      )
      return
    }
    const target = resolveMutable(root, path, state)
    if (
      typeof target !== 'string' ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(count) ||
      index < 0 ||
      count < 0 ||
      index + count > target.length
    ) {
      state.error ??= operationError('TextDelete', path, 'out-of-bounds')
      return
    }
    const text = target.slice(index, index + count)
    const next = `${target.slice(0, index)}${target.slice(index + count)}`
    if (!setMutableAtPath(root, path, next, state, 'TextDelete')) return
    state.operations.push({ _tag: 'TextDelete', path, index, text })
    state.inverseOperations.unshift({ _tag: 'TextInsert', path, index, text })
  },
})

/** Synchronous mutation section that becomes one atomic patch batch. */
export type TreeRecipe<A> = (
  tree: MutableTree<A>,
  operations: OperationRecorder
) => void

/**
 * Runs an Immer recipe against a temporary working copy and returns a fully
 * admitted immutable snapshot, forward/inverse patches, and semantic intent.
 */
export const produceTreeChange = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  recipe: TreeRecipe<TreeValue<S>>
): Result.Result<ProducedChange<TreeValue<S>>, ProducerError> => {
  const state: MutableRecordState = {
    operations: [],
    inverseOperations: [],
    snapshotOptions: snapshotOptionsFor(spec),
    error: undefined,
  }
  const [next, forward] = produceWithPatches(snapshot, (mutable) => {
    recipe(mutable, makeRecorder(spec, snapshot, mutable, state))
  })
  if (state.error !== undefined) return Result.fail(state.error)

  const patches = forward.map(toTreePatch)
  const canonicalNext = captureTreeSnapshot(spec, next, 'treeMutation')
  if (Result.isFailure(canonicalNext)) {
    return Result.fail(canonicalNext.failure)
  }
  const checked = applyTreePatches(spec, snapshot, patches)
  if (Result.isFailure(checked)) return Result.fail(checked.failure)

  const operations = Object.freeze(
    state.operations.map(freezeSemanticOperation)
  )
  const inverseOperations = Object.freeze(
    state.inverseOperations.map(freezeSemanticOperation)
  )

  return Result.succeed(
    Object.freeze({
      snapshot: checked.success.snapshot,
      change: Object.freeze({
        patches: checked.success.patchSet,
        operations,
        inverseOperations,
      }),
      touchedPaths: checked.success.touchedPaths,
    })
  )
}
