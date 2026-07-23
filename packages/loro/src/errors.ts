import type { TreePath } from '@effect-state-tree/core'
import { Data, type Schema } from 'effect'

/** Schema boundary stage at which Loro encoding or decoding failed. */
export type LoroSchemaOperation =
  | 'encode-schema'
  | 'encode-json'
  | 'decode-json'
  | 'decode-schema'

/** Effect Schema failure while crossing the Loro JSON boundary. */
export class LoroSchemaError extends Data.TaggedError('LoroSchemaError')<{
  readonly operation: LoroSchemaOperation
  readonly cause: Schema.SchemaError
}> {}

/** Loro document operation that may fail synchronously. */
export type LoroDocumentOperation =
  | 'read'
  | 'write-snapshot'
  | 'apply-commit'
  | 'subscribe'

/** Normalized exception raised by a Loro document read or mutation. */
export class LoroDocumentError extends Data.TaggedError('LoroDocumentError')<{
  readonly operation: LoroDocumentOperation
  readonly cause: unknown
}> {}

/** Encoded root value cannot be represented by the required Loro root map. */
export class LoroRootTypeError extends Data.TaggedError('LoroRootTypeError')<{
  readonly operation: 'encode' | 'decode'
  readonly actual: 'null' | 'array' | 'primitive'
}> {}

/** Semantic operation targeted a missing or incompatible Loro container. */
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

/** Normalized failure raised by Loro's peer-local undo manager. */
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

/** Complete failure channel exposed by the Schema-coded Loro adapter. */
export type LoroAdapterError =
  | LoroSchemaError
  | LoroDocumentError
  | LoroRootTypeError
  | LoroPathError
