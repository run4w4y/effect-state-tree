import type { EntityIdentity, TreePath } from '@effect-state-tree/core'

/**
 * Mutation intent preserved alongside universal tree patches.
 *
 * CRDT adapters may lower these operations to native moves, splices, and text
 * edits; patches remain the authoritative correctness representation.
 */
export type SemanticOperation =
  | ObjectSetOperation
  | ObjectDeleteOperation
  | ArraySpliceOperation
  | ArrayMoveOperation
  | TextInsertOperation
  | TextDeleteOperation

/** Captured object-property assignment with its previous value. */
export interface ObjectSetOperation {
  /** Operation discriminant. */
  readonly _tag: 'ObjectSet'
  /** Path of the containing object. */
  readonly path: TreePath
  /** Property assigned by the mutation. */
  readonly key: string
  /** New property value. */
  readonly value: unknown
  /** Property value before the mutation. */
  readonly previous: unknown
  /** Whether the property existed before the mutation. */
  readonly hadPrevious: boolean
}

/** Captured object-property deletion with the removed value. */
export interface ObjectDeleteOperation {
  /** Operation discriminant. */
  readonly _tag: 'ObjectDelete'
  /** Path of the containing object. */
  readonly path: TreePath
  /** Property deleted by the mutation. */
  readonly key: string
  /** Property value removed by the mutation. */
  readonly previous: unknown
}

/** Captured array splice retaining both inserted and removed values. */
export interface ArraySpliceOperation {
  /** Operation discriminant. */
  readonly _tag: 'ArraySplice'
  /** Path of the mutated array. */
  readonly path: TreePath
  /** Starting index of the splice. */
  readonly index: number
  /** Number of values removed. */
  readonly deleteCount: number
  /** Values inserted in array order. */
  readonly inserted: ReadonlyArray<unknown>
  /** Values removed in their previous array order. */
  readonly removed: ReadonlyArray<unknown>
}

/** Captured identity-preserving array move. */
export interface ArrayMoveOperation {
  /** Operation discriminant. */
  readonly _tag: 'ArrayMove'
  /** Path of the mutated array. */
  readonly path: TreePath
  /** Starting index of the moved range. */
  readonly from: number
  /** Final index after the moved range has been removed. */
  readonly to: number
  /** Number of contiguous values moved. */
  readonly count: number
  /** Stable identities of identifiable moved values. */
  readonly entities: ReadonlyArray<EntityIdentity>
}

/** Captured insertion into a Schema field materialized as collaborative text. */
export interface TextInsertOperation {
  /** Operation discriminant. */
  readonly _tag: 'TextInsert'
  /** Path of the collaborative text field. */
  readonly path: TreePath
  /** Character offset at which text was inserted. */
  readonly index: number
  /** Inserted text. */
  readonly text: string
}

/** Captured deletion from a Schema field materialized as collaborative text. */
export interface TextDeleteOperation {
  /** Operation discriminant. */
  readonly _tag: 'TextDelete'
  /** Path of the collaborative text field. */
  readonly path: TreePath
  /** Character offset from which text was removed. */
  readonly index: number
  /** Removed text, retained for inverse operations. */
  readonly text: string
}

/** Explicit intent-preserving mutations available inside a tree recipe. */
export interface OperationRecorder {
  /** Assigns an object property while recording previous-value intent. */
  readonly objectSet: (path: TreePath, key: string, value: unknown) => void
  /** Deletes an object property while recording the removed value. */
  readonly objectDelete: (path: TreePath, key: string) => void
  /** Splices an array and records inserted and removed values. */
  readonly arraySplice: (
    path: TreePath,
    index: number,
    deleteCount: number,
    ...inserted: ReadonlyArray<unknown>
  ) => void
  /** Moves a contiguous array range while preserving identifiable entities. */
  readonly arrayMove: (
    path: TreePath,
    from: number,
    to: number,
    count?: number
  ) => void
  /** Inserts characters into a collaborative text field. */
  readonly textInsert: (path: TreePath, index: number, text: string) => void
  /** Deletes characters from a collaborative text field. */
  readonly textDelete: (path: TreePath, index: number, count: number) => void
}

/** Captures an operation as immutable commit data before it leaves a recipe. */
export const freezeSemanticOperation = (
  operation: SemanticOperation
): SemanticOperation => {
  const path = Object.freeze([...operation.path])
  switch (operation._tag) {
    case 'ArraySplice':
      return Object.freeze({
        ...operation,
        path,
        inserted: Object.freeze([...operation.inserted]),
        removed: Object.freeze([...operation.removed]),
      })
    case 'ArrayMove':
      return Object.freeze({
        ...operation,
        path,
        entities: Object.freeze(
          operation.entities.map((identity) => Object.freeze({ ...identity }))
        ),
      })
    default:
      return Object.freeze({ ...operation, path })
  }
}
