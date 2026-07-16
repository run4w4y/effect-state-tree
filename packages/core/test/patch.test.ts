import { describe, expect, it } from 'bun:test'
import { Effect, JsonPatch, Result, Schema } from 'effect'
import * as FastCheck from 'effect/testing/FastCheck'

import {
  applyPatches,
  applyPatchSet,
  captureSnapshot,
  captureTreeSnapshot,
  dateAtomicInterpreter,
  deepEqualSnapshot,
  diffPatches,
  diffPatchSet,
  fromJsonPatch,
  makeTreeSpec,
  type TreePatch,
  toJsonPatch,
} from '../src/index'

const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error(
      `Expected success, received ${JSON.stringify(result.failure)}`
    )
  }
  return result.success
}

describe('pure patch algebra', () => {
  it('round-trips generated Schema values through forward and inverse patches', () => {
    const values = Schema.toArbitrary(Schema.Array(Schema.Int))

    FastCheck.assert(
      FastCheck.property(values, values, (before, after) => {
        const changed = diffPatchSet(before, after)
        if (Result.isFailure(changed)) return false

        const undone = applyPatchSet(
          changed.success.snapshot,
          changed.success.patchSet,
          'inverse'
        )
        if (Result.isFailure(undone)) return false

        const redone = applyPatchSet(before, changed.success.patchSet)
        if (Result.isFailure(redone)) return false

        return (
          deepEqualSnapshot(changed.success.snapshot, after) &&
          deepEqualSnapshot(undone.success.snapshot, before) &&
          deepEqualSnapshot(redone.success.snapshot, after)
        )
      }),
      { numRuns: 200 }
    )
  })

  it('orders shrinking-array removals from high to low and additions from low to high', () => {
    expect(success(diffPatches(['a', 'b', 'c', 'd'], ['a']))).toEqual([
      { op: 'remove', path: [3] },
      { op: 'remove', path: [2] },
      { op: 'remove', path: [1] },
    ])

    expect(success(diffPatches([], ['a', 'b', 'c']))).toEqual([
      { op: 'add', path: [0], value: 'a' },
      { op: 'add', path: [1], value: 'b' },
      { op: 'add', path: [2], value: 'c' },
    ])
  })

  it('stores multi-operation inverses in directly executable reverse order', () => {
    const before = success(captureSnapshot(['a', 'b', 'c', 'd']))
    const patches: ReadonlyArray<TreePatch> = [
      { op: 'remove', path: [1] },
      { op: 'add', path: [2], value: 'x' },
      { op: 'replace', path: [0], value: 'A' },
    ]

    const changed = success(applyPatches(before, patches))
    expect(changed.snapshot).toEqual(['A', 'c', 'x', 'd'])
    expect(changed.patchSet.inverse).toEqual([
      { op: 'replace', path: [0], value: 'a' },
      { op: 'remove', path: [2] },
      { op: 'add', path: [1], value: 'b' },
    ])

    const restored = success(
      applyPatchSet(changed.snapshot, changed.patchSet, 'inverse')
    )
    expect(restored.snapshot).toEqual(before)
  })

  it('preserves the root for an empty patch and supports reversible root replacement', () => {
    const before = success(
      captureSnapshot({
        left: { value: 1 },
        right: { value: 2 },
      })
    )

    const unchanged = success(applyPatches(before, []))
    expect(unchanged.snapshot).toBe(before)
    expect(unchanged.patchSet).toEqual({ forward: [], inverse: [] })
    expect(success(diffPatches(before, before))).toEqual([])

    const equivalentReplacement = success(
      applyPatches(before, [
        {
          op: 'replace',
          path: ['left'],
          value: { value: 1 },
        },
      ])
    )
    expect(equivalentReplacement.snapshot).toBe(before)
    expect(equivalentReplacement.patchSet).toEqual({
      forward: [],
      inverse: [],
    })
    expect(equivalentReplacement.touchedPaths).toEqual([])

    const changed = success(
      applyPatches<unknown>(before, [
        {
          op: 'replace',
          path: [],
          value: { replacement: true },
        },
      ])
    )
    expect(changed.snapshot).toEqual({ replacement: true })
    expect(Object.isFrozen(changed.snapshot)).toBe(true)
    expect(changed.patchSet.inverse).toEqual([
      { op: 'replace', path: [], value: before },
    ])

    const restored = success(
      applyPatchSet(changed.snapshot, changed.patchSet, 'inverse')
    )
    expect(restored.snapshot).toEqual(before)
  })

  it('copies only changed ancestors and retains untouched sibling references', () => {
    const before = success(
      captureSnapshot({
        left: { nested: { value: 1 } },
        right: { nested: { value: 2 } },
      })
    )

    const changed = success(
      applyPatches(before, [
        {
          op: 'replace',
          path: ['left', 'nested', 'value'],
          value: 10,
        },
      ])
    ).snapshot

    expect(changed).not.toBe(before)
    expect(changed.left).not.toBe(before.left)
    expect(changed.left.nested).not.toBe(before.left.nested)
    expect(changed.right).toBe(before.right)
    expect(changed.right.nested).toBe(before.right.nested)
  })

  it('rejects aliased input snapshots and aliased patch payloads', () => {
    const shared = { value: 1 }
    const input = captureSnapshot({ left: shared, right: shared })

    expect(input).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'AliasedNodeError',
        firstPath: ['left'],
        secondPath: ['right'],
      },
    })

    const before = success(captureSnapshot({ stable: true }))
    const payload = { first: shared, second: shared }
    const patched = applyPatches(before, [
      {
        op: 'add',
        path: ['payload'],
        value: payload,
      },
    ])

    expect(patched).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'AliasedNodeError',
        firstPath: ['first'],
        secondPath: ['second'],
      },
    })
  })

  it('captures forward patch values so later replay cannot observe caller mutation', () => {
    const payload = { value: 1 }
    const applied = applyPatches({ item: { value: 0 } }, [
      {
        op: 'replace',
        path: ['item'],
        value: payload,
      },
    ])
    expect(Result.isSuccess(applied)).toBe(true)
    if (Result.isFailure(applied)) return

    payload.value = 99
    const undone = applyPatchSet(
      applied.success.snapshot,
      applied.success.patchSet,
      'inverse'
    )
    expect(Result.isSuccess(undone)).toBe(true)
    if (Result.isFailure(undone)) return
    const redone = applyPatchSet(
      undone.success.snapshot,
      applied.success.patchSet
    )
    expect(Result.isSuccess(redone)).toBe(true)
    if (Result.isFailure(redone)) return

    expect(redone.success.snapshot).toEqual({ item: { value: 1 } })
    expect(applied.success.patchSet.forward[0]).toEqual({
      op: 'replace',
      path: ['item'],
      value: { value: 1 },
    })
    expect(
      Object.isFrozen(
        (applied.success.patchSet.forward[0] as { value: object }).value
      )
    ).toBe(true)
  })

  it('interoperates with Effect JsonPatch through Schema-encoded RFC 6901 pointers', async () => {
    const Document = Schema.Struct({
      'a/b': Schema.Struct({
        'x~y': Schema.Array(Schema.Struct({ '': Schema.NumberFromString })),
      }),
    })
    const spec = makeTreeSpec(Document)
    const document = success(
      captureSnapshot({
        'a/b': {
          'x~y': [{ '': 1 }],
        },
      })
    )
    const treePatch: TreePatch = {
      op: 'replace',
      path: ['a/b', 'x~y', 0, ''],
      value: 2,
    }
    const encoded = await Effect.runPromise(
      toJsonPatch(spec, document, treePatch)
    )
    expect(encoded).toEqual({
      op: 'replace',
      path: '/a~1b/x~0y/0/',
      value: '2',
    })

    const effectPatch: JsonPatch.JsonPatch = [
      {
        op: 'replace',
        path: encoded.path,
        value: '2',
      },
    ]
    const encodedDocument: Schema.Json = {
      'a/b': {
        'x~y': [{ '': '1' }],
      },
    }

    const effectResult = JsonPatch.apply(effectPatch, encodedDocument)
    expect(effectResult).toEqual({
      'a/b': {
        'x~y': [{ '': '2' }],
      },
    })

    const firstPatch = effectPatch[0]
    if (firstPatch === undefined)
      throw new Error('Expected a JSON Patch operation')
    const decoded = await Effect.runPromise(
      fromJsonPatch(spec, document, firstPatch)
    )
    expect(decoded).toEqual(treePatch)
    expect<unknown>(
      success(applyPatches(document, [decoded])).snapshot
    ).toEqual({
      'a/b': { 'x~y': [{ '': 2 }] },
    })
  })

  it('uses canonical JSON codecs for native Date patch payloads', async () => {
    const Document = Schema.Struct({ when: Schema.Date })
    const spec = makeTreeSpec(Document, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const captured = captureTreeSnapshot(spec, {
      when: new Date('2026-07-10T12:00:00.000Z'),
    })
    if (Result.isFailure(captured)) throw new Error(captured.failure._tag)

    const encoded = await Effect.runPromise(
      toJsonPatch(spec, captured.success.snapshot, {
        op: 'replace',
        path: ['when'],
        value: new Date('2027-01-02T03:04:05.000Z'),
      })
    )
    expect(encoded).toEqual({
      op: 'replace',
      path: '/when',
      value: '2027-01-02T03:04:05.000Z',
    })

    const decoded = await Effect.runPromise(
      fromJsonPatch(spec, captured.success.snapshot, encoded)
    )
    expect(decoded.op).toBe('replace')
    const value = decoded.op === 'remove' ? undefined : decoded.value
    if (!(value instanceof Date)) {
      throw new Error('Expected a Date replacement')
    }
    expect(value.toISOString()).toBe('2027-01-02T03:04:05.000Z')
    expect(() => value.setTime(0)).toThrow(TypeError)
  })
})
