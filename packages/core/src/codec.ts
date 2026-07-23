import { Effect, Result, Schema } from 'effect'

import type { TreePath } from './path'
import {
  resolveSchemaPath,
  type SchemaNavigationError,
  type TreeSpec,
  type TreeValue,
} from './spec'

/** Schema navigation failure while resolving a patch-value codec. */
export interface TreeCodecPathError {
  /** Discriminant for Schema path-navigation failure. */
  readonly _tag: 'TreeCodecPathError'
  /** Tuple path that could not be resolved. */
  readonly path: TreePath
  /** Index of the first unresolved segment. */
  readonly segmentIndex: number
  /** Structural reason the Schema could not be traversed. */
  readonly reason: SchemaNavigationError['reason']
  /** Tag of the Schema AST at which traversal stopped. */
  readonly astTag: string
}

/** Effect Schema encode/decode failure at a resolved tree path. */
export interface TreeCodecOperationError {
  /** Discriminant for path-local Schema codec failure. */
  readonly _tag: 'TreeCodecOperationError'
  /** Codec operation that failed. */
  readonly operation: 'encode' | 'decode'
  /** Tuple path whose field codec failed. */
  readonly path: TreePath
  /** Native Effect Schema failure. */
  readonly cause: Schema.SchemaError
}

/** Typed failures returned by path-local Schema codecs. */
export type TreeCodecError = TreeCodecPathError | TreeCodecOperationError

const codecAt = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  path: TreePath
): Result.Result<Schema.Top, TreeCodecPathError> => {
  const resolved = resolveSchemaPath(spec, root, path, 'codec')
  return Result.mapError(
    Result.map(resolved, ({ ast }) => Schema.make<Schema.Top>(ast)),
    (error): TreeCodecPathError => ({
      _tag: 'TreeCodecPathError',
      path: error.path,
      segmentIndex: error.segmentIndex,
      reason: error.reason,
      astTag: error.astTag,
    })
  )
}

/** Builds the original Effect Schema codec represented at a tuple path. */
export const schemaAt = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  path: TreePath
): Effect.Effect<Schema.Top, TreeCodecPathError> =>
  Effect.fromResult(codecAt(spec, root, path))

/** Encodes a decoded patch value through the Schema at its tuple path. */
export const encodeAt = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  path: TreePath,
  value: unknown
): Effect.Effect<unknown, TreeCodecError, S['EncodingServices']> => {
  const stablePath = [...path]
  const codec = codecAt(spec, root, stablePath)
  if (Result.isFailure(codec)) return Effect.fail(codec.failure)

  return Schema.encodeUnknownEffect(Schema.make<S>(codec.success.ast))(
    value
  ).pipe(
    Effect.mapError(
      (cause): TreeCodecOperationError => ({
        _tag: 'TreeCodecOperationError',
        operation: 'encode',
        path: stablePath,
        cause,
      })
    )
  )
}

/** Decodes an external patch value through the Schema at its tuple path. */
export const decodeAt = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  path: TreePath,
  encoded: unknown
): Effect.Effect<unknown, TreeCodecError, S['DecodingServices']> => {
  const stablePath = [...path]
  const codec = codecAt(spec, root, stablePath)
  if (Result.isFailure(codec)) return Effect.fail(codec.failure)

  return Schema.decodeUnknownEffect(Schema.make<S>(codec.success.ast))(
    encoded
  ).pipe(
    Effect.mapError(
      (cause): TreeCodecOperationError => ({
        _tag: 'TreeCodecOperationError',
        operation: 'decode',
        path: stablePath,
        cause,
      })
    )
  )
}

/** Encodes a decoded field value through its canonical Effect JSON codec. */
export const encodeJsonAt = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  path: TreePath,
  value: unknown
): Effect.Effect<Schema.Json, TreeCodecError, S['EncodingServices']> => {
  const stablePath = [...path]
  const codec = codecAt(spec, root, stablePath)
  if (Result.isFailure(codec)) return Effect.fail(codec.failure)

  return Schema.encodeUnknownEffect(
    Schema.toCodecJson(Schema.make<S>(codec.success.ast))
  )(value).pipe(
    Effect.mapError(
      (cause): TreeCodecOperationError => ({
        _tag: 'TreeCodecOperationError',
        operation: 'encode',
        path: stablePath,
        cause,
      })
    )
  )
}

/** Decodes a canonical JSON field value through the Schema at `path`. */
export const decodeJsonAt = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  root: TreeValue<S>,
  path: TreePath,
  encoded: unknown
): Effect.Effect<unknown, TreeCodecError, S['DecodingServices']> => {
  const stablePath = [...path]
  const codec = codecAt(spec, root, stablePath)
  if (Result.isFailure(codec)) return Effect.fail(codec.failure)

  return Schema.decodeUnknownEffect(
    Schema.toCodecJson(Schema.make<S>(codec.success.ast))
  )(encoded).pipe(
    Effect.mapError(
      (cause): TreeCodecOperationError => ({
        _tag: 'TreeCodecOperationError',
        operation: 'decode',
        path: stablePath,
        cause,
      })
    )
  )
}
