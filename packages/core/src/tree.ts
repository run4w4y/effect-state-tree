import { Result, type Schema, SchemaParser } from 'effect'

import type { TreeInvariantError, TreePatchError } from './errors'
import { buildEntityIndex, type EntityIndex } from './identity'
import { type AppliedPatches, applyPatches, type TreePatch } from './patch'
import { reconcile } from './reconcile'
import { captureSnapshot, validateSnapshotShape } from './snapshot'
import {
  entityAnnotationAt,
  identityAt,
  resolveSchemaPath,
  snapshotOptionsFor,
  type TreeSpec,
  type TreeValue,
} from './spec'

/** Canonical admitted snapshot and its Schema-derived identity index. */
export interface AdmittedTree<S extends Schema.Constraint> {
  /** Canonical immutable tree snapshot. */
  readonly snapshot: TreeValue<S>
  /** Stable-identity index derived from the snapshot and Schema. */
  readonly entities: EntityIndex
}

/** Validates an existing snapshot against tree and Schema invariants. */
export const validateTreeSnapshot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>
): Result.Result<EntityIndex, TreeInvariantError> => {
  const shape = validateSnapshotShape(snapshot, snapshotOptionsFor(spec))
  if (Result.isFailure(shape)) return Result.fail(shape.failure)
  const decoded = SchemaParser.decodeUnknownResult(spec.typeSchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(snapshot)
  if (Result.isFailure(decoded)) {
    return Result.fail({
      _tag: 'SchemaAdmissionError',
      issue: decoded.failure,
    })
  }
  return buildEntityIndex(spec, snapshot)
}

/** Admits unknown decoded data as an immutable Schema-described tree. */
export const captureTreeSnapshot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  value: TreeValue<S>
): Result.Result<AdmittedTree<S>, TreeInvariantError> =>
  Result.gen(function* () {
    const snapshot = yield* captureSnapshot(value, snapshotOptionsFor(spec))
    const entities = yield* validateTreeSnapshot(spec, snapshot)
    return Object.freeze({ snapshot, entities })
  })

const changesEntityId = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  patch: TreePatch
): boolean => {
  if (patch.path.length === 0) return false
  const parentPath = patch.path.slice(0, -1)
  const key = patch.path.at(-1)
  const entityAnnotation = entityAnnotationAt(spec, snapshot, parentPath)
  return entityAnnotation !== undefined && key === entityAnnotation.id
}

const unsupportedDescent = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  patch: TreePatch
): TreePatchError | undefined => {
  const navigation = resolveSchemaPath(spec, snapshot, patch.path, 'codec')
  if (Result.isSuccess(navigation)) return undefined

  if (navigation.failure.reason === 'atomic-descent') {
    return {
      _tag: 'UnsupportedTreeNodeError',
      path: patch.path,
      reason: 'atomic-descent',
    }
  }
  if (navigation.failure.reason === 'ambiguous-union-descent') {
    return {
      _tag: 'UnsupportedTreeNodeError',
      path: patch.path,
      reason: 'ambiguous-union-descent',
    }
  }
  if (navigation.failure.reason === 'unsupported-structural-transformation') {
    return {
      _tag: 'UnsupportedTreeNodeError',
      path: patch.path,
      reason: 'structural-transformation-descent',
    }
  }
  return undefined
}

/** Applies patches and revalidates Schema, identity, and ownership invariants. */
export const applyTreePatches = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  patches: ReadonlyArray<TreePatch>
): Result.Result<AppliedPatches<TreeValue<S>>, TreePatchError> => {
  for (const patch of patches) {
    const unsupported = unsupportedDescent(spec, snapshot, patch)
    if (unsupported !== undefined) return Result.fail(unsupported)
    if (changesEntityId(spec, snapshot, patch)) {
      const annotation = entityAnnotationAt(
        spec,
        snapshot,
        patch.path.slice(0, -1)
      )
      return Result.fail({
        _tag: 'InvalidEntityError',
        entityType: annotation?.type ?? 'unknown',
        idKey: String(patch.path.at(-1)),
        path: patch.path.slice(0, -1),
        reason: 'unsupported-id',
      })
    }
  }

  const applied = applyPatches(snapshot, patches, snapshotOptionsFor(spec))
  if (Result.isFailure(applied)) return applied
  const rootBefore = identityAt(spec, snapshot, [])
  const rootAfter = identityAt(spec, applied.success.snapshot, [])
  if (
    rootBefore !== undefined &&
    rootAfter !== undefined &&
    (rootBefore.entityType !== rootAfter.entityType ||
      rootBefore.id !== rootAfter.id)
  ) {
    return Result.fail({
      _tag: 'InvalidEntityError',
      entityType: rootBefore.entityType,
      idKey: entityAnnotationAt(spec, snapshot, [])?.id ?? '<root>',
      path: [],
      reason: 'unsupported-id',
    })
  }
  return Result.map(
    validateTreeSnapshot(spec, applied.success.snapshot),
    () => applied.success
  )
}

/** Reconciles an incoming snapshot while retaining unchanged/entity references. */
export const reconcileTreeSnapshot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  current: TreeValue<S>,
  incoming: TreeValue<S>
): Result.Result<AppliedPatches<TreeValue<S>>, TreePatchError> =>
  reconcile(spec, current, incoming)
