import type { SchemaIssue } from 'effect'
import type { TreePath } from './path'

export interface InvalidPathError {
  readonly _tag: 'InvalidPathError'
  readonly path: TreePath
  readonly segmentIndex: number
  readonly reason:
    | 'missing'
    | 'not-a-container'
    | 'invalid-array-index'
    | 'invalid-object-key'
}

export interface InvalidPatchError {
  readonly _tag: 'InvalidPatchError'
  readonly operation: 'add' | 'remove' | 'replace'
  readonly path: TreePath
  readonly reason: 'cannot-remove-root' | 'target-exists' | 'target-missing'
}

export interface AliasedNodeError {
  readonly _tag: 'AliasedNodeError'
  readonly firstPath: TreePath
  readonly secondPath: TreePath
}

export interface UnsupportedTreeNodeError {
  readonly _tag: 'UnsupportedTreeNodeError'
  readonly path: TreePath
  readonly reason:
    | 'symbol-key'
    | 'cyclic-schema'
    | 'atomic-descent'
    | 'ambiguous-union-descent'
    | 'structural-transformation-descent'
    | 'mutable-atomic'
}

export interface SchemaAdmissionError {
  readonly _tag: 'SchemaAdmissionError'
  readonly issue: SchemaIssue.Issue
}

export interface DuplicateEntityError {
  readonly _tag: 'DuplicateEntityError'
  readonly entityType: string
  readonly id: string | number
  readonly firstPath: TreePath
  readonly secondPath: TreePath
}

export interface InvalidEntityError {
  readonly _tag: 'InvalidEntityError'
  readonly entityType: string
  readonly idKey: string
  readonly path: TreePath
  readonly reason: 'missing-id' | 'unsupported-id'
}

export interface IdentityMismatchError {
  readonly _tag: 'IdentityMismatchError'
  readonly path: TreePath
  readonly depth: number
  readonly expected: EntityIdentity | undefined
  readonly actual: EntityIdentity | undefined
}

export interface EntityNotFoundError {
  readonly _tag: 'EntityNotFoundError'
  readonly entityType: string
  readonly id: string | number
}

export interface EntityIdentity {
  readonly entityType: string
  readonly id: string | number
}

export type TreeInvariantError =
  | AliasedNodeError
  | UnsupportedTreeNodeError
  | DuplicateEntityError
  | InvalidEntityError
  | SchemaAdmissionError

export type TreePatchError =
  | InvalidPathError
  | InvalidPatchError
  | TreeInvariantError

export type TreeCoreError =
  | TreePatchError
  | IdentityMismatchError
  | EntityNotFoundError
