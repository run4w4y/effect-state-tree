import { Data, type Schema } from 'effect'

export type YjsCodecStage =
  | 'encode-schema'
  | 'encode-json'
  | 'decode-json'
  | 'decode-schema'

/** A Schema codec failed while crossing the Yjs JSON boundary. */
export class YjsCodecError extends Data.TaggedError('YjsCodecError')<{
  readonly stage: YjsCodecStage
  readonly cause: unknown
}> {}

/** The encoded root cannot be represented by the root Y.Map. */
export class YjsRootError extends Data.TaggedError('YjsRootError')<{
  readonly reason: 'encoded-root-not-object'
  readonly value: Schema.Json
}> {}

/** Yjs rejected a synchronous document read or mutation. */
export class YjsMutationError extends Data.TaggedError('YjsMutationError')<{
  readonly operation:
    | 'readSnapshot'
    | 'writeSnapshot'
    | 'applyCommit'
    | 'observe'
  readonly cause: unknown
}> {}

export class YjsUndoError extends Data.TaggedError('YjsUndoError')<{
  readonly operation:
    | 'canUndo'
    | 'canRedo'
    | 'undo'
    | 'redo'
    | 'clear'
    | 'dispose'
  readonly cause: unknown
}> {}

export type YjsAdapterError = YjsCodecError | YjsRootError | YjsMutationError
