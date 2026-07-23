import type { Schema } from 'effect'

/** Effect Schema annotation key used to request native movable-list storage. */
export const MovableListAnnotationKey =
  '@effect-state-tree/crdt/movable-list' as const

declare module 'effect/Schema' {
  namespace Annotations {
    interface Annotations {
      readonly '@effect-state-tree/crdt/movable-list'?: boolean | undefined
    }
  }
}

/**
 * Marks an array as an identity-preserving movable CRDT list.
 *
 * Backends with a native move operation, such as Loro, materialize the array
 * using that representation. Other backends retain the same Schema and lower
 * moves to the closest operation their data model supports.
 */
export const movableList = <S extends Schema.Top>(schema: S): S['Rebuild'] =>
  schema.annotate({ [MovableListAnnotationKey]: true })
