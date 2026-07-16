import type { TreeSpec, TreeValue } from '@effect-state-tree/core'
import { isJsonObject } from '@effect-state-tree/crdt'
import { Effect, Schema } from 'effect'
import { LoroRootTypeError, LoroSchemaError } from './errors'

const rootType = (value: Schema.Json): LoroRootTypeError['actual'] =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : 'primitive'

const schemaError =
  (operation: LoroSchemaError['operation']) =>
  (cause: Schema.SchemaError): LoroSchemaError =>
    new LoroSchemaError({ operation, cause })

export const encodeRoot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>
): Effect.Effect<
  Schema.JsonObject,
  LoroSchemaError | LoroRootTypeError,
  S['EncodingServices']
> =>
  Schema.encodeEffect(spec.jsonCodec)(snapshot).pipe(
    Effect.mapError(schemaError('encode-schema')),
    Effect.flatMap((encoded) =>
      Schema.decodeUnknownEffect(Schema.Json)(encoded).pipe(
        Effect.mapError(schemaError('encode-json'))
      )
    ),
    Effect.flatMap((json) =>
      isJsonObject(json)
        ? Effect.succeed(json)
        : Effect.fail(
            new LoroRootTypeError({
              operation: 'encode',
              actual: rootType(json),
            })
          )
    )
  )

export const decodeRoot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  raw: unknown
): Effect.Effect<
  TreeValue<S>,
  LoroSchemaError | LoroRootTypeError,
  S['DecodingServices']
> =>
  Schema.decodeUnknownEffect(Schema.Json)(raw).pipe(
    Effect.mapError(schemaError('decode-json')),
    Effect.flatMap((json) =>
      isJsonObject(json)
        ? Effect.succeed(json)
        : Effect.fail(
            new LoroRootTypeError({
              operation: 'decode',
              actual: rootType(json),
            })
          )
    ),
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(spec.jsonCodec)(json).pipe(
        Effect.mapError(schemaError('decode-schema')),
        // Schema guarantees S["Type"], while TS cannot reduce the alias here.
        Effect.map((value) => value as TreeValue<S>)
      )
    )
  )
