import type { TreeSpec, TreeValue } from '@effect-state-tree/core'
import { isJsonObject } from '@effect-state-tree/crdt'
import { Effect, Schema } from 'effect'
import { YjsCodecError, YjsRootError } from './errors'

export const encodeRoot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>
): Effect.Effect<
  Schema.JsonObject,
  YjsCodecError | YjsRootError,
  S['EncodingServices']
> =>
  Schema.encodeEffect(spec.jsonCodec)(snapshot).pipe(
    Effect.mapError(
      (cause) => new YjsCodecError({ stage: 'encode-schema', cause })
    ),
    Effect.flatMap((encoded) =>
      Schema.decodeUnknownEffect(Schema.Json)(encoded).pipe(
        Effect.mapError(
          (cause) => new YjsCodecError({ stage: 'encode-json', cause })
        )
      )
    ),
    Effect.flatMap((json) =>
      isJsonObject(json)
        ? Effect.succeed(json)
        : Effect.fail(
            new YjsRootError({
              reason: 'encoded-root-not-object',
              value: json,
            })
          )
    )
  )

export const decodeRoot = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  input: unknown
): Effect.Effect<TreeValue<S>, YjsCodecError, S['DecodingServices']> =>
  Schema.decodeUnknownEffect(Schema.Json)(input).pipe(
    Effect.mapError(
      (cause) => new YjsCodecError({ stage: 'decode-json', cause })
    ),
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(spec.jsonCodec)(json).pipe(
        Effect.mapError(
          (cause) => new YjsCodecError({ stage: 'decode-schema', cause })
        ),
        // Schema guarantees S["Type"], while TS cannot reduce the alias here.
        Effect.map((value) => value as TreeValue<S>)
      )
    )
  )
