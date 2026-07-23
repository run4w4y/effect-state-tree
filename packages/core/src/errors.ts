import type { SchemaIssue } from 'effect'
import type { TreePath } from './path'

/** Describes why a tuple path could not be resolved against a tree snapshot. */
export interface InvalidPathError {
  /** Discriminant for an invalid patch path. */
  readonly _tag: 'InvalidPathError'
  /** Complete path supplied by the rejected patch. */
  readonly path: TreePath
  /** Index of the segment that could not be followed. */
  readonly segmentIndex: number
  /** Structural reason path traversal stopped. */
  readonly reason:
    | 'missing'
    | 'not-a-container'
    | 'invalid-array-index'
    | 'invalid-object-key'
}

/** Describes why an add, remove, or replace operation was not admissible. */
export interface InvalidPatchError {
  /** Discriminant for an invalid patch operation. */
  readonly _tag: 'InvalidPatchError'
  /** Patch operation that violated its target precondition. */
  readonly operation: 'add' | 'remove' | 'replace'
  /** Tuple path targeted by the rejected patch. */
  readonly path: TreePath
  /** Precondition violated by the operation. */
  readonly reason: 'cannot-remove-root' | 'target-exists' | 'target-missing'
}

/** Reports one object or array instance appearing at two paths in one tree. */
export interface AliasedNodeError {
  /** Discriminant for one-parent ownership failure. */
  readonly _tag: 'AliasedNodeError'
  /** First path at which the object or array appeared. */
  readonly firstPath: TreePath
  /** Second path attempting to reuse the same object or array. */
  readonly secondPath: TreePath
}

/** Reports a value or Schema construct that the tree kernel cannot traverse. */
export interface UnsupportedTreeNodeError {
  /** Discriminant for an unsupported tree value or Schema node. */
  readonly _tag: 'UnsupportedTreeNodeError'
  /** Tuple path at which traversal became unsupported. */
  readonly path: TreePath
  /** Unsupported structural condition encountered by the kernel. */
  readonly reason:
    | 'symbol-key'
    | 'cyclic-schema'
    | 'atomic-descent'
    | 'ambiguous-union-descent'
    | 'structural-transformation-descent'
    | 'mutable-atomic'
}

/** Wraps the native Effect Schema issue that rejected tree admission. */
export interface SchemaAdmissionError {
  /** Discriminant for Effect Schema admission failure. */
  readonly _tag: 'SchemaAdmissionError'
  /** Complete native issue tree returned by Effect Schema. */
  readonly issue: SchemaIssue.Issue
}

/** Reports two entities with the same entity type and stable ID. */
export interface DuplicateEntityError {
  /** Discriminant for duplicate stable identity. */
  readonly _tag: 'DuplicateEntityError'
  /** Schema-annotated entity type. */
  readonly entityType: string
  /** Stable ID shared by both entities. */
  readonly id: string | number
  /** Path of the entity indexed first. */
  readonly firstPath: TreePath
  /** Path of the conflicting entity. */
  readonly secondPath: TreePath
}

/** Reports an entity whose configured identity field is missing or invalid. */
export interface InvalidEntityError {
  /** Discriminant for malformed entity identity. */
  readonly _tag: 'InvalidEntityError'
  /** Schema-annotated entity type. */
  readonly entityType: string
  /** Property expected to contain the stable ID. */
  readonly idKey: string
  /** Path of the malformed entity. */
  readonly path: TreePath
  /** Identity precondition violated by the entity. */
  readonly reason: 'missing-id' | 'unsupported-id'
}

/** Reports an identity-anchored path that now addresses a different entity. */
export interface IdentityMismatchError {
  /** Discriminant for an invalidated identity-anchored path. */
  readonly _tag: 'IdentityMismatchError'
  /** Anchored tuple path being resolved. */
  readonly path: TreePath
  /** Path depth at which identity stopped matching. */
  readonly depth: number
  /** Entity identity captured when the path was anchored. */
  readonly expected: EntityIdentity | undefined
  /** Entity identity currently present at that path depth. */
  readonly actual: EntityIdentity | undefined
}

/** Reports a typed entity reference that is absent from the current root. */
export interface EntityNotFoundError {
  /** Discriminant for unresolved entity reference. */
  readonly _tag: 'EntityNotFoundError'
  /** Referenced entity type. */
  readonly entityType: string
  /** Referenced stable ID. */
  readonly id: string | number
}

/** Stable entity type and ID observed in a canonical tree snapshot. */
export interface EntityIdentity {
  /** Schema-annotated entity type. */
  readonly entityType: string
  /** Stable string or number ID. */
  readonly id: string | number
}

/** Failures that prevent a value from satisfying the tree invariants. */
export type TreeInvariantError =
  | AliasedNodeError
  | UnsupportedTreeNodeError
  | DuplicateEntityError
  | InvalidEntityError
  | SchemaAdmissionError

/** Failures produced while applying patches to a canonical tree. */
export type TreePatchError =
  | InvalidPathError
  | InvalidPatchError
  | TreeInvariantError

/** Complete failure channel exposed by the pure tree kernel. */
export type TreeCoreError =
  | TreePatchError
  | IdentityMismatchError
  | EntityNotFoundError
