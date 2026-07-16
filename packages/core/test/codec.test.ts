import { describe, expect, it } from 'bun:test'
import { Effect, Result, Schema, SchemaGetter } from 'effect'

import {
  applyTreePatches,
  atomic,
  captureTreeSnapshot,
  dateAtomicInterpreter,
  decodeAt,
  decodeJsonAt,
  encodeAt,
  encodeJsonAt,
  makeTreeSpec,
  reconcileTreeSnapshot,
  schemaAt,
} from '../src/index'

const State = Schema.Struct({
  settings: Schema.Struct({
    retry: Schema.Struct({
      count: Schema.NumberFromString,
    }),
  }),
})

const spec = makeTreeSpec(State)
const captured = captureTreeSnapshot(spec, {
  settings: { retry: { count: 3 } },
})
if (Result.isFailure(captured)) throw new Error(captured.failure._tag)
const snapshot = captured.success.snapshot

describe('tree path codecs', () => {
  it('retains and runs a nested field transformation', async () => {
    const field = await Effect.runPromise(
      schemaAt(spec, snapshot, ['settings', 'retry', 'count'])
    )
    expect(field.ast.encoding).toBeDefined()

    expect(
      await Effect.runPromise(
        encodeAt(spec, snapshot, ['settings', 'retry', 'count'], 42)
      )
    ).toBe('42')
    expect(
      await Effect.runPromise(
        decodeAt(spec, snapshot, ['settings', 'retry', 'count'], '17')
      )
    ).toBe(17)
  })

  it('derives canonical JSON field codecs independently of declared encoding', async () => {
    const Dated = Schema.Struct({ when: Schema.Date })
    const datedSpec = makeTreeSpec(Dated, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const dated = captureTreeSnapshot(datedSpec, {
      when: new Date('2026-07-10T12:00:00.000Z'),
    })
    if (Result.isFailure(dated)) throw new Error(dated.failure._tag)

    expect(
      await Effect.runPromise(
        encodeJsonAt(
          datedSpec,
          dated.success.snapshot,
          ['when'],
          dated.success.snapshot.when
        )
      )
    ).toBe('2026-07-10T12:00:00.000Z')

    const decoded = await Effect.runPromise(
      decodeJsonAt(
        datedSpec,
        dated.success.snapshot,
        ['when'],
        '2027-01-02T03:04:05.000Z'
      )
    )
    expect(decoded).toBeInstanceOf(Date)
    if (!(decoded instanceof Date)) throw new Error('Expected Date')
    expect(decoded.toISOString()).toBe('2027-01-02T03:04:05.000Z')
  })

  it('reports codec failures with the operation and path', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodeAt(spec, snapshot, ['settings', 'retry', 'count'], true)
      )
    )
    expect(error).toMatchObject({
      _tag: 'TreeCodecOperationError',
      operation: 'decode',
      path: ['settings', 'retry', 'count'],
      cause: { _tag: 'SchemaError' },
    })
  })

  it('fails missing schema paths with a typed path error', async () => {
    const error = await Effect.runPromise(
      Effect.flip(schemaAt(spec, snapshot, ['settings', 'unknown']))
    )
    expect(error).toEqual({
      _tag: 'TreeCodecPathError',
      path: ['settings', 'unknown'],
      segmentIndex: 1,
      reason: 'missing-path',
      astTag: 'Objects',
    })
  })

  it('treats a root structural transformation as an indivisible codec', async () => {
    const RootTransform = Schema.String.pipe(
      Schema.decodeTo(Schema.Struct({ count: Schema.Number }), {
        decode: SchemaGetter.transform((value) => ({ count: Number(value) })),
        encode: SchemaGetter.transform((value) => String(value.count)),
      })
    )
    const transformedSpec = makeTreeSpec(RootTransform)
    const transformed = captureTreeSnapshot(transformedSpec, { count: 1 })
    if (Result.isFailure(transformed)) throw new Error(transformed.failure._tag)

    expect(
      await Effect.runPromise(
        encodeAt(transformedSpec, transformed.success.snapshot, [], {
          count: 2,
        })
      )
    ).toBe('2')

    const error = await Effect.runPromise(
      Effect.flip(
        schemaAt(transformedSpec, transformed.success.snapshot, ['count'])
      )
    )
    expect(error).toEqual({
      _tag: 'TreeCodecPathError',
      path: ['count'],
      segmentIndex: 0,
      reason: 'unsupported-structural-transformation',
      astTag: 'Objects',
    })

    expect(
      applyTreePatches(transformedSpec, transformed.success.snapshot, [
        { op: 'replace', path: ['count'], value: 2 },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'UnsupportedTreeNodeError',
        path: ['count'],
        reason: 'structural-transformation-descent',
      },
    })

    const reconciled = reconcileTreeSnapshot(
      transformedSpec,
      transformed.success.snapshot,
      { count: 2 }
    )
    expect(Result.isSuccess(reconciled)).toBe(true)
    if (Result.isSuccess(reconciled)) {
      expect(reconciled.success.patchSet.forward).toEqual([
        { op: 'replace', path: [], value: { count: 2 } },
      ])
    }
  })

  it('does not traverse through explicitly atomic nodes', async () => {
    const AtomicState = Schema.Struct({
      payload: Schema.Struct({ value: Schema.NumberFromString }).pipe(atomic),
    })
    const atomicSpec = makeTreeSpec(AtomicState)
    const atomicSnapshot = captureTreeSnapshot(atomicSpec, {
      payload: { value: 1 },
    })
    if (Result.isFailure(atomicSnapshot))
      throw new Error(atomicSnapshot.failure._tag)

    const error = await Effect.runPromise(
      Effect.flip(
        schemaAt(atomicSpec, atomicSnapshot.success.snapshot, [
          'payload',
          'value',
        ])
      )
    )
    expect(error).toMatchObject({
      _tag: 'TreeCodecPathError',
      segmentIndex: 1,
      reason: 'atomic-descent',
    })
  })
})
