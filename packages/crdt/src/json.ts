import type { TreePath } from '@effect-state-tree/core'
import type { Schema } from 'effect'
import { isEqual } from 'es-toolkit/predicate'

/** Narrows an Effect Schema JSON value to a non-array object. */
export const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Produces a collision-safe in-memory key for a tuple path. */
export const pathKey = (path: TreePath): string => JSON.stringify(path)

/** Compares tuple paths by segment value. */
export const samePath = (left: TreePath, right: TreePath): boolean =>
  isEqual(left, right)

/** Resolves a tuple path through encoded Effect Schema JSON. */
export const jsonAtPath = (
  root: Schema.Json,
  path: TreePath
): Schema.Json | undefined => {
  let current = root
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      const child = current[segment]
      if (child === undefined) return undefined
      current = child
      continue
    }
    if (isJsonObject(current) && typeof segment === 'string') {
      const child = current[segment]
      if (child === undefined) return undefined
      current = child
      continue
    }
    return undefined
  }
  return current
}
