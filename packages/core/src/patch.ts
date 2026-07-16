import { Effect, type JsonPatch, Result, type Schema } from 'effect'
import { uniq } from 'es-toolkit/array'

import { decodeJsonAt, encodeJsonAt, type TreeCodecError } from './codec'
import type {
  InvalidPatchError,
  InvalidPathError,
  TreePatchError,
} from './errors'
import {
  type JsonPointerDecodeError,
  jsonPointerToPath,
  pathToJsonPointer,
  type TreePath,
  type TreePathSegment,
} from './path'
import {
  atomicSnapshotEquality,
  captureSnapshot,
  deepEqualSnapshot,
  freezeChangedContainer,
  isPlainObject,
  type SnapshotError,
  type SnapshotOptions,
  validateSnapshotShape,
} from './snapshot'
import type { TreeSpec, TreeValue } from './spec'

/** Ordered tuple-path add, remove, or replace operation. */
export type TreePatch =
  | {
      readonly op: 'add'
      readonly path: TreePath
      readonly value: unknown
    }
  | {
      readonly op: 'remove'
      readonly path: TreePath
    }
  | {
      readonly op: 'replace'
      readonly path: TreePath
      readonly value: unknown
    }

/** Forward changes paired with directly executable inverse changes. */
export interface PatchSet {
  readonly forward: ReadonlyArray<TreePatch>
  /** Directly executable in stored order against the post-change snapshot. */
  readonly inverse: ReadonlyArray<TreePatch>
}

/** Immutable result of applying or diffing a patch sequence. */
export interface AppliedPatches<A> {
  readonly snapshot: A
  readonly patchSet: PatchSet
  readonly touchedPaths: ReadonlyArray<TreePath>
}

const invalidPath = (
  path: TreePath,
  segmentIndex: number,
  reason: InvalidPathError['reason']
): InvalidPathError => ({
  _tag: 'InvalidPathError',
  path,
  segmentIndex,
  reason,
})

const invalidPatch = (
  operation: TreePatch['op'],
  path: TreePath,
  reason: InvalidPatchError['reason']
): InvalidPatchError => ({
  _tag: 'InvalidPatchError',
  operation,
  path,
  reason,
})

const freezePatch = (patch: TreePatch): TreePatch =>
  Object.freeze({
    ...patch,
    path: Object.freeze([...patch.path]),
  })

const isValidArrayIndex = (segment: TreePathSegment): segment is number =>
  typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0

const cloneObject = (
  object: Record<string, unknown>
): Record<string, unknown> => {
  const output: Record<string, unknown> = Object.create(
    Object.getPrototypeOf(object)
  )
  for (const key of Object.keys(object)) {
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: object[key],
      writable: true,
    })
  }
  return output
}

interface AppliedOne {
  readonly snapshot: unknown
  readonly inverse: TreePatch
}

const applyAtTarget = (
  current: unknown,
  patch: TreePatch,
  value: unknown,
  options: SnapshotOptions
): Result.Result<AppliedOne, TreePatchError> => {
  if (patch.op === 'remove') {
    return Result.fail(invalidPatch(patch.op, patch.path, 'cannot-remove-root'))
  }
  if (deepEqualSnapshot(current, value, options)) {
    return Result.succeed({
      snapshot: current,
      inverse: { op: 'replace', path: [], value: current },
    })
  }
  return Result.succeed({
    snapshot: value,
    inverse: { op: 'replace', path: [], value: current },
  })
}

const applyToContainer = (
  container: unknown,
  segment: TreePathSegment,
  patch: TreePatch,
  value: unknown,
  options: SnapshotOptions
): Result.Result<AppliedOne, TreePatchError> => {
  if (Array.isArray(container)) {
    if (!isValidArrayIndex(segment)) {
      return Result.fail(
        invalidPath(patch.path, patch.path.length - 1, 'invalid-array-index')
      )
    }
    const index = segment
    const output = container.slice()

    if (patch.op === 'add') {
      if (index > container.length) {
        return Result.fail(
          invalidPath(patch.path, patch.path.length - 1, 'missing')
        )
      }
      output.splice(index, 0, value)
      return Result.succeed({
        snapshot: freezeChangedContainer(output),
        inverse: { op: 'remove', path: patch.path },
      })
    }

    if (index >= container.length || !Object.hasOwn(container, index)) {
      return Result.fail(invalidPatch(patch.op, patch.path, 'target-missing'))
    }
    const previous = container[index]

    if (patch.op === 'remove') {
      output.splice(index, 1)
      return Result.succeed({
        snapshot: freezeChangedContainer(output),
        inverse: { op: 'add', path: patch.path, value: previous },
      })
    }

    output[index] = value
    const unchanged = deepEqualSnapshot(previous, value, options)
    return Result.succeed({
      snapshot: unchanged ? container : freezeChangedContainer(output),
      inverse: { op: 'replace', path: patch.path, value: previous },
    })
  }

  if (!isPlainObject(container)) {
    return Result.fail(
      invalidPath(patch.path, patch.path.length - 1, 'not-a-container')
    )
  }
  if (typeof segment !== 'string') {
    return Result.fail(
      invalidPath(patch.path, patch.path.length - 1, 'invalid-object-key')
    )
  }

  const exists = Object.hasOwn(container, segment)
  if (patch.op !== 'add' && !exists) {
    return Result.fail(invalidPatch(patch.op, patch.path, 'target-missing'))
  }

  const previous = container[segment]
  const output = cloneObject(container)

  if (patch.op === 'remove') {
    Reflect.deleteProperty(output, segment)
    return Result.succeed({
      snapshot: freezeChangedContainer(output),
      inverse: { op: 'add', path: patch.path, value: previous },
    })
  }

  Object.defineProperty(output, segment, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
  const inverse: TreePatch = exists
    ? { op: 'replace', path: patch.path, value: previous }
    : { op: 'remove', path: patch.path }
  const unchanged = exists && deepEqualSnapshot(previous, value, options)
  return Result.succeed({
    snapshot: unchanged ? container : freezeChangedContainer(output),
    inverse,
  })
}

const applyOne = (
  root: unknown,
  patch: TreePatch,
  options: SnapshotOptions
): Result.Result<AppliedOne, TreePatchError> => {
  const value = patch.op === 'remove' ? undefined : patch.value

  if (patch.path.length === 0) {
    return applyAtTarget(root, patch, value, options)
  }

  const descend = (
    current: unknown,
    depth: number
  ): Result.Result<AppliedOne, TreePatchError> => {
    const segment = patch.path[depth]
    if (segment === undefined) {
      return applyAtTarget(current, patch, value, options)
    }
    if (depth === patch.path.length - 1) {
      return applyToContainer(current, segment, patch, value, options)
    }

    if (Array.isArray(current)) {
      if (!isValidArrayIndex(segment)) {
        return Result.fail(
          invalidPath(patch.path, depth, 'invalid-array-index')
        )
      }
      if (segment >= current.length || !Object.hasOwn(current, segment)) {
        return Result.fail(invalidPath(patch.path, depth, 'missing'))
      }
      const child = descend(current[segment], depth + 1)
      if (Result.isFailure(child)) return child
      if (Object.is(child.success.snapshot, current[segment])) {
        return Result.succeed({
          snapshot: current,
          inverse: child.success.inverse,
        })
      }
      const output = current.slice()
      output[segment] = child.success.snapshot
      return Result.succeed({
        snapshot: freezeChangedContainer(output),
        inverse: child.success.inverse,
      })
    }

    if (!isPlainObject(current)) {
      return Result.fail(invalidPath(patch.path, depth, 'not-a-container'))
    }
    if (typeof segment !== 'string') {
      return Result.fail(invalidPath(patch.path, depth, 'invalid-object-key'))
    }
    if (!Object.hasOwn(current, segment)) {
      return Result.fail(invalidPath(patch.path, depth, 'missing'))
    }
    const child = descend(current[segment], depth + 1)
    if (Result.isFailure(child)) return child
    if (Object.is(child.success.snapshot, current[segment])) {
      return Result.succeed({
        snapshot: current,
        inverse: child.success.inverse,
      })
    }
    const output = cloneObject(current)
    Object.defineProperty(output, segment, {
      configurable: true,
      enumerable: true,
      value: child.success.snapshot,
      writable: true,
    })
    return Result.succeed({
      snapshot: freezeChangedContainer(output),
      inverse: child.success.inverse,
    })
  }

  return descend(root, 0)
}

/** Applies ordered patches with copy-on-write and generates their inverse. */
export const applyPatches = <A>(
  snapshot: A,
  patches: ReadonlyArray<TreePatch>,
  options: SnapshotOptions = {}
): Result.Result<AppliedPatches<A>, TreePatchError> => {
  let current: unknown = snapshot
  const forward: Array<TreePatch> = []
  const inverse: Array<TreePatch> = []

  for (const patch of patches) {
    const stablePath = Object.freeze([...patch.path])
    const normalized: Result.Result<TreePatch, TreePatchError> =
      patch.op === 'remove'
        ? Result.succeed(Object.freeze({ op: 'remove', path: stablePath }))
        : Result.map(
            captureSnapshot(patch.value, options),
            (value): TreePatch =>
              Object.freeze({ op: patch.op, path: stablePath, value })
          )
    if (Result.isFailure(normalized)) return Result.fail(normalized.failure)
    const applied = applyOne(current, normalized.success, options)
    if (Result.isFailure(applied)) return Result.fail(applied.failure)
    if (Object.is(current, applied.success.snapshot)) continue
    current = applied.success.snapshot
    forward.push(normalized.success)
    inverse.unshift(freezePatch(applied.success.inverse))
  }

  const valid = validateSnapshotShape(current, options)
  if (Result.isFailure(valid)) return Result.fail(valid.failure)

  const frozenForward = Object.freeze(forward)
  const frozenInverse = Object.freeze(inverse)
  const touchedPaths = Object.freeze(frozenForward.map((patch) => patch.path))

  return Result.succeed(
    Object.freeze({
      snapshot: current as A,
      patchSet: Object.freeze({
        forward: frozenForward,
        inverse: frozenInverse,
      }),
      touchedPaths,
    })
  )
}

/** Applies the forward half of a patch set to an immutable snapshot. */
export const applyPatchSet = <A>(
  snapshot: A,
  patchSet: PatchSet,
  direction: 'forward' | 'inverse' = 'forward',
  options: SnapshotOptions = {}
): Result.Result<AppliedPatches<A>, TreePatchError> =>
  applyPatches(snapshot, patchSet[direction], options)

/** Swaps a patch set's already executable forward and inverse sequences. */
export const invertPatchSet = (patchSet: PatchSet): PatchSet =>
  Object.freeze({
    forward: Object.freeze([...patchSet.inverse]),
    inverse: Object.freeze([...patchSet.forward]),
  })

const diffInto = (
  before: unknown,
  after: unknown,
  path: TreePath,
  output: Array<TreePatch>,
  options: SnapshotOptions
): void => {
  if (Object.is(before, after)) return

  const atomicEquality = atomicSnapshotEquality(before, after, options)
  if (atomicEquality === true) return
  if (atomicEquality === false) {
    output.push({ op: 'replace', path, value: after })
    return
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length)
    for (let index = 0; index < shared; index += 1) {
      diffInto(before[index], after[index], [...path, index], output, options)
    }
    for (let index = before.length - 1; index >= after.length; index -= 1) {
      output.push({ op: 'remove', path: [...path, index] })
    }
    for (let index = before.length; index < after.length; index += 1) {
      output.push({ op: 'add', path: [...path, index], value: after[index] })
    }
    return
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = uniq([...Object.keys(before), ...Object.keys(after)]).sort()
    for (const key of keys) {
      const inBefore = Object.hasOwn(before, key)
      const inAfter = Object.hasOwn(after, key)
      if (inBefore && inAfter)
        diffInto(before[key], after[key], [...path, key], output, options)
      else if (inAfter)
        output.push({ op: 'add', path: [...path, key], value: after[key] })
      else output.push({ op: 'remove', path: [...path, key] })
    }
    return
  }

  output.push({ op: 'replace', path, value: after })
}

/** Computes ordered add/remove/replace operations between two snapshots. */
export const diffPatches = <A>(
  before: A,
  after: A,
  options: SnapshotOptions = {}
): Result.Result<ReadonlyArray<TreePatch>, TreePatchError> => {
  const capturedBefore = captureSnapshot(before, options)
  if (Result.isFailure(capturedBefore))
    return Result.fail(capturedBefore.failure)
  const capturedAfter = captureSnapshot(after, options)
  if (Result.isFailure(capturedAfter)) return Result.fail(capturedAfter.failure)

  const output: Array<TreePatch> = []
  diffInto(capturedBefore.success, capturedAfter.success, [], output, options)
  return Result.succeed(Object.freeze(output.map(freezePatch)))
}

/** Diffs two snapshots and returns both forward and inverse operations. */
export const diffPatchSet = <A>(
  before: A,
  after: A,
  options: SnapshotOptions = {}
): Result.Result<AppliedPatches<A>, TreePatchError> =>
  Result.flatMap(diffPatches(before, after, options), (patches) =>
    applyPatches(before, patches, options)
  )

/** Relocates one patch beneath a parent tuple path. */
export const prefixPatch = (prefix: TreePath, patch: TreePatch): TreePatch =>
  freezePatch({ ...patch, path: [...prefix, ...patch.path] })

/** Relocates both halves of a patch set beneath a parent tuple path. */
export const prefixPatchSet = (
  prefix: TreePath,
  patchSet: PatchSet
): PatchSet =>
  Object.freeze({
    forward: Object.freeze(
      patchSet.forward.map((patch) => Object.freeze(prefixPatch(prefix, patch)))
    ),
    inverse: Object.freeze(
      patchSet.inverse.map((patch) => Object.freeze(prefixPatch(prefix, patch)))
    ),
  })

export type TreeJsonPatchError =
  | TreeCodecError
  | JsonPointerDecodeError
  | SnapshotError

/**
 * Encodes a tuple-path patch as an Effect JsonPatch operation. Payloads pass
 * through the field's canonical Effect JSON codec.
 */
export const toJsonPatch = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  patch: TreePatch
): Effect.Effect<
  JsonPatch.JsonPatchOperation,
  TreeJsonPatchError,
  S['EncodingServices']
> => {
  const path = Object.freeze([...patch.path])
  const pointer = pathToJsonPointer(path)
  if (patch.op === 'remove') {
    return Effect.succeed(Object.freeze({ op: 'remove', path: pointer }))
  }

  return encodeJsonAt(spec, root, path, patch.value).pipe(
    Effect.flatMap((json) => Effect.fromResult(captureSnapshot(json))),
    Effect.map((value) => Object.freeze({ op: patch.op, path: pointer, value }))
  )
}

/** Decodes an Effect JsonPatch operation into a Schema-typed tuple patch. */
export const fromJsonPatch = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  patch: JsonPatch.JsonPatchOperation
): Effect.Effect<TreePatch, TreeJsonPatchError, S['DecodingServices']> =>
  Effect.gen(function* () {
    const path = yield* Effect.fromResult(jsonPointerToPath(patch.path))
    if (patch.op === 'remove') return freezePatch({ op: 'remove', path })

    const value = yield* decodeJsonAt(spec, root, path, patch.value)
    const captured = yield* Effect.fromResult(
      captureSnapshot(value, { atomicInterpreters: spec.atomicInterpreters })
    )
    return freezePatch({ op: patch.op, path, value: captured })
  })
