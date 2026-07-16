import { Result, type Schema, SchemaParser } from 'effect'

import type { InvalidEntityError, TreePatchError } from './errors'
import { buildEntityIndex, entityKey } from './identity'
import { type AppliedPatches, applyPatches, diffPatchSet } from './patch'
import type { TreePath } from './path'
import {
  captureSnapshot,
  deepEqualSnapshot,
  freezeChangedContainer,
  isPlainObject,
} from './snapshot'
import {
  identityAt,
  resolveSchemaPath,
  snapshotOptionsFor,
  type TreeSpec,
  type TreeValue,
  treeSchemaParseOptions,
} from './spec'

const sameIdentity = (
  left: ReturnType<typeof identityAt>,
  right: ReturnType<typeof identityAt>
): boolean => left?.entityType === right?.entityType && left?.id === right?.id

const reconcileValue = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  currentRoot: TreeValue<S>,
  incomingRoot: TreeValue<S>,
  current: unknown,
  incoming: unknown,
  path: TreePath
): unknown => {
  if (Object.is(current, incoming)) return current

  const childProbe = resolveSchemaPath(spec, incomingRoot, [
    ...path,
    '__probe__',
  ])
  if (
    Result.isFailure(childProbe) &&
    (childProbe.failure.reason === 'atomic-descent' ||
      childProbe.failure.reason === 'ambiguous-union-descent')
  )
    return deepEqualSnapshot(current, incoming, snapshotOptionsFor(spec))
      ? current
      : incoming

  if (Array.isArray(current) && Array.isArray(incoming)) {
    const currentByIdentity = new Map<string, unknown>()
    for (let index = 0; index < current.length; index += 1) {
      const identity = identityAt(spec, currentRoot, [...path, index])
      if (identity !== undefined) {
        currentByIdentity.set(entityKey(identity), current[index])
      }
    }

    const output = new Array<unknown>(incoming.length)
    let unchanged = current.length === incoming.length
    for (let index = 0; index < incoming.length; index += 1) {
      const identity = identityAt(spec, incomingRoot, [...path, index])
      const candidate =
        identity === undefined
          ? current[index]
          : currentByIdentity.get(entityKey(identity))
      const child = reconcileValue(
        spec,
        currentRoot,
        incomingRoot,
        candidate,
        incoming[index],
        [...path, index]
      )
      output[index] = child
      if (!Object.is(child, current[index])) unchanged = false
    }
    return unchanged ? current : freezeChangedContainer(output)
  }

  if (isPlainObject(current) && isPlainObject(incoming)) {
    const incomingKeys = Object.keys(incoming)
    const currentKeys = Object.keys(current)
    const output: Record<string, unknown> = Object.create(
      Object.getPrototypeOf(incoming)
    )
    let unchanged = incomingKeys.length === currentKeys.length
    for (const key of incomingKeys) {
      const child = reconcileValue(
        spec,
        currentRoot,
        incomingRoot,
        current[key],
        incoming[key],
        [...path, key]
      )
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      })
      if (!Object.hasOwn(current, key) || !Object.is(child, current[key])) {
        unchanged = false
      }
    }
    return unchanged ? current : freezeChangedContainer(output)
  }

  return deepEqualSnapshot(current, incoming, snapshotOptionsFor(spec))
    ? current
    : incoming
}

const rootIdentityChanged = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  current: TreeValue<S>,
  incoming: TreeValue<S>
): InvalidEntityError | undefined => {
  const before = identityAt(spec, current, [])
  const after = identityAt(spec, incoming, [])
  if (
    before === undefined ||
    after === undefined ||
    sameIdentity(before, after)
  )
    return undefined
  return {
    _tag: 'InvalidEntityError',
    entityType: before.entityType,
    idKey: '<root>',
    path: [],
    reason: 'unsupported-id',
  }
}

export const reconcile = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  current: TreeValue<S>,
  incoming: TreeValue<S>
): Result.Result<AppliedPatches<TreeValue<S>>, TreePatchError> => {
  const options = snapshotOptionsFor(spec)
  const captured = captureSnapshot(incoming, options)
  if (Result.isFailure(captured)) return Result.fail(captured.failure)
  const admittedIncoming = captured.success
  const rootError = rootIdentityChanged(spec, current, admittedIncoming)
  if (rootError !== undefined) return Result.fail(rootError)

  const reconciled = reconcileValue(
    spec,
    current,
    admittedIncoming,
    current,
    admittedIncoming,
    []
  ) as TreeValue<S>
  const entities = buildEntityIndex(spec, reconciled)
  if (Result.isFailure(entities)) return Result.fail(entities.failure)
  const structural = SchemaParser.decodeUnknownResult(
    spec.typeSchema,
    treeSchemaParseOptions('treeMutation', 'admission')
  )(reconciled)
  if (Result.isFailure(structural)) {
    return Result.fail({
      _tag: 'SchemaAdmissionError',
      issue: structural.failure,
    })
  }

  const difference = diffPatchSet(current, reconciled, options)
  if (Result.isFailure(difference)) return difference

  const hasIdentityReplacement = difference.success.patchSet.forward.some(
    (patch) => {
      if (patch.path.length === 0) return false
      const parent = patch.path.slice(0, -1)
      const beforeIdentity = identityAt(spec, current, parent)
      const afterIdentity = identityAt(spec, reconciled, parent)
      return (
        beforeIdentity !== undefined &&
        afterIdentity !== undefined &&
        !sameIdentity(beforeIdentity, afterIdentity)
      )
    }
  )

  const crossesOpaqueBoundary = difference.success.patchSet.forward.some(
    (patch) => {
      const navigation = resolveSchemaPath(spec, current, patch.path, 'codec')
      return (
        Result.isFailure(navigation) &&
        (navigation.failure.reason === 'atomic-descent' ||
          navigation.failure.reason === 'ambiguous-union-descent' ||
          navigation.failure.reason === 'unsupported-structural-transformation')
      )
    }
  )

  if (hasIdentityReplacement || crossesOpaqueBoundary) {
    const replaced = applyPatches(
      current,
      [{ op: 'replace', path: [], value: reconciled }],
      options
    )
    return Result.map(replaced, (applied) => ({
      ...applied,
      snapshot: reconciled,
    }))
  }

  return Result.succeed({
    ...difference.success,
    snapshot: reconciled,
  })
}
