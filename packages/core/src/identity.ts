import { Result, type Schema } from 'effect'

import type {
  DuplicateEntityError,
  EntityIdentity,
  IdentityMismatchError,
  InvalidEntityError,
} from './errors'
import {
  formatTreePath,
  type GetAtPathFailure,
  getAtPath,
  type TreePath,
} from './path'
import { isPlainObject } from './snapshot'
import {
  type EntityAnnotation,
  EntityAnnotationKey,
  identityAt,
  resolveTreeAnnotationFromAsts,
  type TreeSpec,
  walkSchemaValue,
} from './spec'

/** Collision-safe serialized `(entity type, ID)` lookup key. */
export type EntityKey = string

/** Location and identity of one entity in a particular snapshot revision. */
export interface EntityIndexEntry {
  readonly key: EntityKey
  readonly identity: EntityIdentity
  readonly path: TreePath
}

/** Immutable lookup from entity key to its current tuple path. */
export type EntityIndex = ReadonlyMap<EntityKey, EntityIndexEntry>

/** Encodes an entity identity into its collision-safe index key. */
export const entityKey = (identity: EntityIdentity): EntityKey =>
  `${encodeURIComponent(identity.entityType)}:${typeof identity.id}:${encodeURIComponent(String(identity.id))}`

/** Builds and validates the stable-identity index for a snapshot. */
export const buildEntityIndex = (
  spec: TreeSpec<Schema.Constraint>,
  snapshot: unknown
): Result.Result<EntityIndex, DuplicateEntityError | InvalidEntityError> => {
  const output = new Map<EntityKey, EntityIndexEntry>()
  let error: DuplicateEntityError | InvalidEntityError | undefined

  walkSchemaValue(spec, snapshot, ({ asts, path, value }) => {
    if (error !== undefined) return
    const annotation = resolveTreeAnnotationFromAsts<EntityAnnotation>(
      asts,
      EntityAnnotationKey
    )
    if (annotation === undefined) return
    if (!isPlainObject(value) || !Object.hasOwn(value, annotation.id)) {
      error = {
        _tag: 'InvalidEntityError',
        entityType: annotation.type,
        idKey: annotation.id,
        path,
        reason: 'missing-id',
      }
      return
    }
    const id = value[annotation.id]
    if (typeof id !== 'string' && typeof id !== 'number') {
      error = {
        _tag: 'InvalidEntityError',
        entityType: annotation.type,
        idKey: annotation.id,
        path,
        reason: 'unsupported-id',
      }
      return
    }
    const identity: EntityIdentity = { entityType: annotation.type, id }
    const key = entityKey(identity)
    const previous = output.get(key)
    if (previous !== undefined) {
      error = {
        _tag: 'DuplicateEntityError',
        entityType: annotation.type,
        id,
        firstPath: previous.path,
        secondPath: path,
      }
      return
    }
    output.set(key, { key, identity, path })
  })

  return error === undefined ? Result.succeed(output) : Result.fail(error)
}

/** Entity identity observed at one prefix of an anchored path. */
export interface PathAnchor {
  readonly depth: number
  readonly identity: EntityIdentity | undefined
}

/** Tuple path protected against array reorders by entity identity anchors. */
export interface AnchoredPath {
  readonly path: TreePath
  readonly anchors: ReadonlyArray<PathAnchor>
}

/** Captures every identifiable prefix needed to resolve a path safely later. */
export const anchorPath = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath
): AnchoredPath => {
  const anchors: Array<PathAnchor> = []
  for (let depth = 1; depth <= path.length; depth += 1) {
    const prefix = path.slice(0, depth)
    const current = getAtPath(root, prefix)
    if (Result.isFailure(current)) break
    const identity = identityAt(spec, root, prefix)
    anchors.push({ depth, identity })
  }
  return { path: [...path], anchors }
}

/** Resolves an anchored path only while all captured identities still match. */
export const resolveAnchoredPath = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  anchored: AnchoredPath,
  options?: { readonly ignoreLastIdentity?: boolean }
): Result.Result<unknown, IdentityMismatchError | GetAtPathFailure> => {
  const lastDepth = anchored.path.length
  for (const anchor of anchored.anchors) {
    if (options?.ignoreLastIdentity === true && anchor.depth === lastDepth)
      continue
    const prefix = anchored.path.slice(0, anchor.depth)
    const value = getAtPath(root, prefix)
    if (Result.isFailure(value)) return value
    const actual = identityAt(spec, root, prefix)
    const matches =
      actual?.entityType === anchor.identity?.entityType &&
      actual?.id === anchor.identity?.id
    if (!matches && (actual !== undefined || anchor.identity !== undefined)) {
      return Result.fail({
        _tag: 'IdentityMismatchError',
        path: anchored.path,
        depth: anchor.depth,
        expected: anchor.identity,
        actual,
      })
    }
  }
  const resolved = getAtPath(root, anchored.path)
  return resolved
}

/** Returns a serializable diagnostic projection of an entity index. */
export const describeEntityIndex = (
  index: EntityIndex
): ReadonlyArray<string> =>
  [...index.values()].map(
    (entry) =>
      `${entry.identity.entityType}:${String(entry.identity.id)}@${formatTreePath(entry.path)}`
  )
