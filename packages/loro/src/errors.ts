import type { TreePath } from '@effect-state-tree/core'
import { Data, type Schema } from 'effect'

export type LoroSchemaOperation =
  | 'encode-schema'
  | 'encode-json'
  | 'decode-json'
  | 'decode-schema'

export class LoroSchemaError extends Data.TaggedError('LoroSchemaError')<{
  readonly operation: LoroSchemaOperation
  readonly cause: Schema.SchemaError
}> {}

export type LoroDocumentOperation =
  | 'read'
  | 'write-snapshot'
  | 'apply-commit'
  | 'subscribe'

export class LoroDocumentError extends Data.TaggedError('LoroDocumentError')<{
  readonly operation: LoroDocumentOperation
  readonly cause: unknown
}> {}

export class LoroRootTypeError extends Data.TaggedError('LoroRootTypeError')<{
  readonly operation: 'encode' | 'decode'
  readonly actual: 'null' | 'array' | 'primitive'
}> {}

export class LoroPathError extends Data.TaggedError('LoroPathError')<{
  readonly operation:
    | 'ObjectSet'
    | 'ObjectDelete'
    | 'ArraySplice'
    | 'ArrayMove'
    | 'TextInsert'
    | 'TextDelete'
  readonly path: TreePath
  readonly reason: 'missing' | 'wrong-container'
}> {}

export class LoroUndoError extends Data.TaggedError('LoroUndoError')<{
  readonly operation:
    | 'canUndo'
    | 'canRedo'
    | 'undo'
    | 'redo'
    | 'clear'
    | 'dispose'
  readonly cause: unknown
}> {}

export type LoroAdapterError =
  | LoroSchemaError
  | LoroDocumentError
  | LoroRootTypeError
  | LoroPathError
