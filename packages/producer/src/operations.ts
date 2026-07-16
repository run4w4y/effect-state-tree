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

export interface ObjectSetOperation {
  readonly _tag: 'ObjectSet'
  readonly path: TreePath
  readonly key: string
  readonly value: unknown
  readonly previous: unknown
  readonly hadPrevious: boolean
}

export interface ObjectDeleteOperation {
  readonly _tag: 'ObjectDelete'
  readonly path: TreePath
  readonly key: string
  readonly previous: unknown
}

export interface ArraySpliceOperation {
  readonly _tag: 'ArraySplice'
  readonly path: TreePath
  readonly index: number
  readonly deleteCount: number
  readonly inserted: ReadonlyArray<unknown>
  readonly removed: ReadonlyArray<unknown>
}

export interface ArrayMoveOperation {
  readonly _tag: 'ArrayMove'
  readonly path: TreePath
  readonly from: number
  /** Final index after the moved range has been removed. */
  readonly to: number
  readonly count: number
  readonly entities: ReadonlyArray<EntityIdentity>
}

export interface TextInsertOperation {
  readonly _tag: 'TextInsert'
  readonly path: TreePath
  readonly index: number
  readonly text: string
}

export interface TextDeleteOperation {
  readonly _tag: 'TextDelete'
  readonly path: TreePath
  readonly index: number
  readonly text: string
}

/** Explicit intent-preserving mutations available inside a tree recipe. */
export interface OperationRecorder {
  readonly objectSet: (path: TreePath, key: string, value: unknown) => void
  readonly objectDelete: (path: TreePath, key: string) => void
  readonly arraySplice: (
    path: TreePath,
    index: number,
    deleteCount: number,
    ...inserted: ReadonlyArray<unknown>
  ) => void
  readonly arrayMove: (
    path: TreePath,
    from: number,
    to: number,
    count?: number
  ) => void
  readonly textInsert: (path: TreePath, index: number, text: string) => void
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
