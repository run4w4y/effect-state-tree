import { describe, expect, it } from 'bun:test'
import {
  applyTreePatches,
  collaborativeText,
  entity,
  makeTreeSpec,
  type TreeValue,
} from '@effect-state-tree/core'
import { Result, Schema } from 'effect'
import { produceTreeChange } from '../src/index'

const ItemSchema = Schema.Struct({
  id: Schema.String,
  value: Schema.Number,
}).pipe(entity({ type: 'Item', id: 'id' }))

const ProducerSchema = Schema.Struct({
  items: Schema.Array(ItemSchema),
  text: Schema.String.pipe(collaborativeText),
  stable: Schema.Struct({
    name: Schema.String,
    nested: Schema.Struct({ enabled: Schema.Boolean }),
  }),
})

const producerSpec = makeTreeSpec(ProducerSchema)

const makeInitial = (): TreeValue<typeof ProducerSchema> => ({
  items: [
    { id: 'a', value: 1 },
    { id: 'b', value: 2 },
    { id: 'c', value: 3 },
    { id: 'd', value: 4 },
  ],
  text: 'abcd',
  stable: {
    name: 'unchanged',
    nested: { enabled: true },
  },
})

describe('produceTreeChange', () => {
  it('preserves untouched references and round-trips forward and inverse patches', () => {
    const initial = makeInitial()
    const produced = produceTreeChange(producerSpec, initial, (tree) => {
      const item = tree.items[1]
      if (item === undefined) throw new Error('Expected the second item')
      item.value = 20
    })

    expect(Result.isSuccess(produced)).toBe(true)
    if (Result.isFailure(produced)) return

    expect(produced.success.snapshot).not.toBe(initial)
    expect(produced.success.snapshot.items).not.toBe(initial.items)
    expect(produced.success.snapshot.items[0]).toBe(initial.items[0])
    expect(produced.success.snapshot.items[1]).not.toBe(initial.items[1])
    expect(produced.success.snapshot.stable).toBe(initial.stable)
    expect(produced.success.snapshot.stable.nested).toBe(initial.stable.nested)
    expect(initial.items[1]?.value).toBe(2)

    expect(produced.success.change.patches.forward).toEqual([
      { op: 'replace', path: ['items', 1, 'value'], value: 20 },
    ])
    expect(produced.success.change.patches.inverse).toEqual([
      { op: 'replace', path: ['items', 1, 'value'], value: 2 },
    ])

    const forward = applyTreePatches(
      producerSpec,
      initial,
      produced.success.change.patches.forward
    )
    expect(Result.isSuccess(forward)).toBe(true)
    if (Result.isFailure(forward)) return
    expect(forward.success.snapshot).toEqual(produced.success.snapshot)

    const inverse = applyTreePatches(
      producerSpec,
      produced.success.snapshot,
      produced.success.change.patches.inverse
    )
    expect(Result.isSuccess(inverse)).toBe(true)
    if (Result.isFailure(inverse)) return
    expect(inverse.success.snapshot).toEqual(initial)
  })

  it('records explicit array moves and text edits with executable inverse intent', () => {
    const initial = makeInitial()
    const produced = produceTreeChange(
      producerSpec,
      initial,
      (_tree, operations) => {
        operations.arrayMove(['items'], 1, 2, 2)
        operations.textInsert(['text'], 2, 'XY')
        operations.textDelete(['text'], 0, 1)
      }
    )

    expect(Result.isSuccess(produced)).toBe(true)
    if (Result.isFailure(produced)) return

    expect(produced.success.snapshot.items.map((item) => item.id)).toEqual([
      'a',
      'd',
      'b',
      'c',
    ])
    expect(produced.success.snapshot.text).toBe('bXYcd')
    expect(produced.success.snapshot.stable).toBe(initial.stable)

    expect(produced.success.change.operations).toEqual([
      {
        _tag: 'ArrayMove',
        path: ['items'],
        from: 1,
        to: 2,
        count: 2,
        entities: [
          { entityType: 'Item', id: 'b' },
          { entityType: 'Item', id: 'c' },
        ],
      },
      { _tag: 'TextInsert', path: ['text'], index: 2, text: 'XY' },
      { _tag: 'TextDelete', path: ['text'], index: 0, text: 'a' },
    ])
    expect(produced.success.change.inverseOperations).toEqual([
      { _tag: 'TextInsert', path: ['text'], index: 0, text: 'a' },
      { _tag: 'TextDelete', path: ['text'], index: 2, text: 'XY' },
      {
        _tag: 'ArrayMove',
        path: ['items'],
        from: 2,
        to: 1,
        count: 2,
        entities: [
          { entityType: 'Item', id: 'b' },
          { entityType: 'Item', id: 'c' },
        ],
      },
    ])
    expect(Object.isFrozen(produced.success.change.operations)).toBe(true)
    expect(Object.isFrozen(produced.success.change.operations[0])).toBe(true)
    expect(Object.isFrozen(produced.success.change.inverseOperations)).toBe(
      true
    )
    expect(Object.isFrozen(produced.success.change.patches.forward)).toBe(true)

    const reverted = applyTreePatches(
      producerSpec,
      produced.success.snapshot,
      produced.success.change.patches.inverse
    )
    expect(Result.isSuccess(reverted)).toBe(true)
    if (Result.isFailure(reverted)) return
    expect(reverted.success.snapshot).toEqual(initial)
  })

  it('records move identity from the current recipe state after earlier edits', () => {
    const produced = produceTreeChange(
      producerSpec,
      makeInitial(),
      (_tree, operations) => {
        operations.arraySplice(['items'], 0, 1)
        operations.arrayMove(['items'], 0, 1)
      }
    )
    expect(Result.isSuccess(produced)).toBe(true)
    if (Result.isFailure(produced)) return

    expect(produced.success.snapshot.items.map((item) => item.id)).toEqual([
      'c',
      'b',
      'd',
    ])
    expect(produced.success.change.operations[1]).toMatchObject({
      _tag: 'ArrayMove',
      entities: [{ entityType: 'Item', id: 'b' }],
    })
  })

  it('returns an identity result with empty logs for a no-op recipe', () => {
    const initial = makeInitial()
    const produced = produceTreeChange(producerSpec, initial, () => undefined)

    expect(Result.isSuccess(produced)).toBe(true)
    if (Result.isFailure(produced)) return

    expect(produced.success.snapshot).toBe(initial)
    expect(produced.success.change.patches).toEqual({
      forward: [],
      inverse: [],
    })
    expect(produced.success.change.operations).toEqual([])
    expect(produced.success.change.inverseOperations).toEqual([])
    expect(produced.success.touchedPaths).toEqual([])
  })

  it('rejects aliases created by a recipe and semantic text edits on atomic strings', () => {
    const ObjectValue = Schema.Struct({ value: Schema.Number })
    const AliasSchema = Schema.Struct({
      left: ObjectValue,
      right: ObjectValue,
      text: Schema.String,
    })
    const aliasSpec = makeTreeSpec(AliasSchema)
    const shared = { value: 2 }
    const aliased = produceTreeChange(
      aliasSpec,
      { left: { value: 0 }, right: { value: 1 }, text: 'plain' },
      (tree) => {
        tree.left = shared
        tree.right = shared
      }
    )
    expect(aliased).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'AliasedNodeError' },
    })

    const text = produceTreeChange(
      aliasSpec,
      { left: { value: 0 }, right: { value: 1 }, text: 'plain' },
      (_tree, operations) => operations.textInsert(['text'], 0, 'x')
    )
    expect(text).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'ProducerOperationError',
        operation: 'TextInsert',
        path: ['text'],
        reason: 'not-collaborative-text',
      },
    })
  })
})
