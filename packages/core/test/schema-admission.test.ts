import { describe, expect, it } from 'bun:test'
import { Result, Schema } from 'effect'

import {
  type AtomicInterpreter,
  applyTreePatches,
  atomic,
  captureTreeSnapshot,
  dateAtomicInterpreter,
  diffPatches,
  makeTreeSpec,
  reconcileTreeSnapshot,
  snapshotOptionsFor,
} from '../src/index'

const Payload = Schema.Struct({ value: Schema.Number }).pipe(atomic)
const State = Schema.Struct({
  count: Schema.Number,
  payload: Payload,
})
const spec = makeTreeSpec(State)

const initial = () => {
  const captured = captureTreeSnapshot(spec, {
    count: 0,
    payload: { value: 1 },
  })
  if (Result.isFailure(captured)) throw new Error(String(captured.failure._tag))
  return captured.success.snapshot
}

describe('Schema structural admission', () => {
  it('rejects wrong primitive types and undeclared object properties in the core', () => {
    expect(
      applyTreePatches(spec, initial(), [
        {
          op: 'replace',
          path: ['count'],
          value: 'wrong',
        },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'SchemaAdmissionError' },
    })

    expect(
      applyTreePatches(spec, initial(), [
        {
          op: 'add',
          path: ['unexpected'],
          value: true,
        },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'SchemaAdmissionError' },
    })
  })

  it('treats ordinary Schema checks as hard admission constraints', () => {
    const Checked = Schema.Struct({ count: Schema.Int })
    const checkedSpec = makeTreeSpec(Checked)
    expect(captureTreeSnapshot(checkedSpec, { count: 1.5 })).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'SchemaAdmissionError' },
    })

    const admitted = captureTreeSnapshot(checkedSpec, { count: 1 })
    expect(Result.isSuccess(admitted)).toBe(true)
    if (Result.isFailure(admitted)) return
    expect(
      applyTreePatches(checkedSpec, admitted.success.snapshot, [
        {
          op: 'replace',
          path: ['count'],
          value: 1.5,
        },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'SchemaAdmissionError' },
    })
  })

  it('allows atomic replacement but rejects patches through atomic leaves', () => {
    expect(
      applyTreePatches(spec, initial(), [
        {
          op: 'replace',
          path: ['payload', 'value'],
          value: 2,
        },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'UnsupportedTreeNodeError',
        path: ['payload', 'value'],
        reason: 'atomic-descent',
      },
    })

    const replaced = applyTreePatches(spec, initial(), [
      {
        op: 'replace',
        path: ['payload'],
        value: { value: 2 },
      },
    ])
    expect(Result.isSuccess(replaced)).toBe(true)
    if (Result.isSuccess(replaced)) {
      expect(replaced.success.snapshot.payload.value).toBe(2)
    }

    const reconciled = reconcileTreeSnapshot(spec, initial(), {
      count: 0,
      payload: { value: 2 },
    })
    expect(Result.isSuccess(reconciled)).toBe(true)
    if (Result.isSuccess(reconciled)) {
      expect(reconciled.success.patchSet.forward).toEqual([
        {
          op: 'replace',
          path: [],
          value: { count: 0, payload: { value: 2 } },
        },
      ])
    }
  })

  it('retains tree annotations declared on Union wrappers', () => {
    const UnionPayload = Schema.Union([
      Schema.Struct({ _tag: Schema.Literal('a'), value: Schema.Number }),
      Schema.Struct({ _tag: Schema.Literal('b'), value: Schema.Number }),
    ]).pipe(atomic)
    const UnionState = Schema.Struct({ payload: UnionPayload })
    const unionSpec = makeTreeSpec(UnionState)
    const captured = captureTreeSnapshot(unionSpec, {
      payload: { _tag: 'a' as const, value: 1 },
    })
    expect(Result.isSuccess(captured)).toBe(true)
    if (Result.isFailure(captured)) return

    expect(
      applyTreePatches(unionSpec, captured.success.snapshot, [
        {
          op: 'replace',
          path: ['payload', 'value'],
          value: 2,
        },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'UnsupportedTreeNodeError', reason: 'atomic-descent' },
    })
  })

  it('rejects native Dates and unknown mutable atoms without an interpreter', () => {
    const Dated = Schema.Struct({
      when: Schema.Date,
    })
    const input = new Date('2026-07-10T12:00:00.000Z')
    const captured = captureTreeSnapshot(makeTreeSpec(Dated), { when: input })
    expect(captured).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'UnsupportedTreeNodeError',
        path: ['when'],
        reason: 'mutable-atomic',
      },
    })

    class MutableBox {
      constructor(public value: number) {}
    }
    const Mutable = Schema.Struct({ box: Schema.instanceOf(MutableBox) })
    const rejected = captureTreeSnapshot(makeTreeSpec(Mutable), {
      box: new MutableBox(1),
    })
    expect(rejected).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'UnsupportedTreeNodeError',
        path: ['box'],
        reason: 'mutable-atomic',
      },
    })

    const FrozenMap = Schema.Struct({
      values: Schema.instanceOf(Map),
    })
    const values = Object.freeze(new Map([['a', 1]]))
    expect(
      captureTreeSnapshot(makeTreeSpec(FrozenMap), { values })
    ).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'UnsupportedTreeNodeError',
        path: ['values'],
        reason: 'mutable-atomic',
      },
    })
  })

  it('offers native Date support only through the explicit compatibility interpreter', () => {
    const Dated = Schema.Struct({ when: Schema.Date })
    const datedSpec = makeTreeSpec(Dated, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const input = new Date('2026-07-10T12:00:00.000Z')
    const captured = captureTreeSnapshot(datedSpec, { when: input })
    if (Result.isFailure(captured)) throw new Error(captured.failure._tag)

    input.setUTCFullYear(2030)
    expect(captured.success.snapshot.when.toISOString()).toBe(
      '2026-07-10T12:00:00.000Z'
    )
    expect(Object.prototype.toString.call(captured.success.snapshot.when)).toBe(
      '[object Date]'
    )
    expect(captured.success.snapshot.when.toISOString).toBe(
      captured.success.snapshot.when.toISOString
    )
    expect(() => captured.success.snapshot.when.setTime(0)).toThrow(TypeError)
    expect(() =>
      Date.prototype.setTime.call(captured.success.snapshot.when, 0)
    ).toThrow(TypeError)

    const recaptured = captureTreeSnapshot(datedSpec, captured.success.snapshot)
    if (Result.isFailure(recaptured)) throw new Error(recaptured.failure._tag)
    expect(recaptured.success.snapshot.when).toBe(
      captured.success.snapshot.when
    )

    const equivalent = captureTreeSnapshot(datedSpec, {
      when: new Date('2026-07-10T12:00:00.000Z'),
    })
    if (Result.isFailure(equivalent)) throw new Error(equivalent.failure._tag)
    expect(
      diffPatches(
        captured.success.snapshot,
        equivalent.success.snapshot,
        snapshotOptionsFor(datedSpec)
      )
    ).toEqual(Result.succeed([]))

    const unchanged = applyTreePatches(datedSpec, captured.success.snapshot, [
      {
        op: 'replace',
        path: ['when'],
        value: new Date('2026-07-10T12:00:00.000Z'),
      },
    ])
    if (Result.isFailure(unchanged)) throw new Error(unchanged.failure._tag)
    expect(unchanged.success.snapshot).toBe(captured.success.snapshot)
    expect(unchanged.success.patchSet.forward).toEqual([])

    const reconciled = reconcileTreeSnapshot(
      datedSpec,
      captured.success.snapshot,
      equivalent.success.snapshot
    )
    if (Result.isFailure(reconciled)) throw new Error(reconciled.failure._tag)
    expect(reconciled.success.snapshot.when).toBe(
      captured.success.snapshot.when
    )
    expect(reconciled.success.patchSet.forward).toEqual([])
  })

  it('captures custom atomic values through the TreeSpec interpreter registry', () => {
    class Money {
      constructor(readonly cents: number) {}
    }

    const immutableMoney = new WeakSet<Money>()
    const moneyInterpreter: AtomicInterpreter<Money> = {
      name: 'Money',
      is: (value): value is Money => value instanceof Money,
      capture: (value) => {
        const snapshot = Object.freeze(new Money(value.cents))
        immutableMoney.add(snapshot)
        return snapshot
      },
      isSnapshot: (value) => immutableMoney.has(value),
      equals: (left, right) => left.cents === right.cents,
    }

    const Wallet = Schema.Struct({
      balance: Schema.instanceOf(Money).pipe(atomic),
    })
    const walletSpec = makeTreeSpec(Wallet, {
      atomicInterpreters: [moneyInterpreter],
    })
    const input = new Money(1250)
    const captured = captureTreeSnapshot(walletSpec, { balance: input })
    if (Result.isFailure(captured)) throw new Error(captured.failure._tag)

    expect(captured.success.snapshot.balance).not.toBe(input)
    expect(captured.success.snapshot.balance.cents).toBe(1250)
    expect(Object.isFrozen(captured.success.snapshot.balance)).toBe(true)

    const changed = applyTreePatches(walletSpec, captured.success.snapshot, [
      {
        op: 'replace',
        path: ['balance'],
        value: new Money(2400),
      },
    ])
    if (Result.isFailure(changed)) throw new Error(changed.failure._tag)
    expect(changed.success.snapshot.balance.cents).toBe(2400)
    expect(Object.isFrozen(changed.success.patchSet.forward)).toBe(true)
    expect(Object.isFrozen(changed.success.patchSet.forward[0])).toBe(true)

    const equivalent = captureTreeSnapshot(walletSpec, {
      balance: new Money(1250),
    })
    if (Result.isFailure(equivalent)) throw new Error(equivalent.failure._tag)
    expect(
      diffPatches(
        captured.success.snapshot,
        equivalent.success.snapshot,
        snapshotOptionsFor(walletSpec)
      )
    ).toEqual(Result.succeed([]))

    const reconciled = reconcileTreeSnapshot(
      walletSpec,
      captured.success.snapshot,
      equivalent.success.snapshot
    )
    if (Result.isFailure(reconciled)) throw new Error(reconciled.failure._tag)
    expect(reconciled.success.snapshot.balance).toBe(
      captured.success.snapshot.balance
    )
    expect(reconciled.success.patchSet.forward).toEqual([])
  })

  it('treats structurally ambiguous unions as opaque traversal boundaries', () => {
    const Ambiguous = Schema.Union([
      Schema.Struct({ value: Schema.Number }),
      Schema.Struct({ value: Schema.Number, label: Schema.String }),
    ])
    const AmbiguousState = Schema.Struct({ payload: Ambiguous })
    const ambiguousSpec = makeTreeSpec(AmbiguousState)
    const captured = captureTreeSnapshot(ambiguousSpec, {
      payload: { value: 1, label: 'selected by full Schema validation' },
    })
    if (Result.isFailure(captured)) throw new Error(captured.failure._tag)

    expect(
      applyTreePatches(ambiguousSpec, captured.success.snapshot, [
        {
          op: 'replace',
          path: ['payload', 'value'],
          value: 2,
        },
      ])
    ).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'UnsupportedTreeNodeError',
        reason: 'ambiguous-union-descent',
      },
    })
  })
})
