import { describe, expect, it } from 'bun:test'
import {
  type AtomicInterpreter,
  atomic,
  entity,
  makeTreeSpec,
} from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'
import { makeDraft } from '../src/index'

const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).pipe(entity({ type: 'Todo', id: 'id' }))

const State = Schema.Struct({
  count: Schema.Number,
  todos: Schema.Array(Todo),
})

const spec = makeTreeSpec(State)
const makeStore = () =>
  makeTreeStore(spec, {
    count: 0,
    todos: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
  })

describe('same-Schema drafts', () => {
  it('commits, resets, and tracks dirtiness against the live original', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))

    await Effect.runPromise(
      draft.data.update((state) => {
        const first = state.todos[0]
        if (first !== undefined) first.title = 'edited'
      })
    )
    expect(draft.isDirty()).toBe(true)
    expect(original.getSnapshot().todos[0]?.title).toBe('A')

    await Effect.runPromise(draft.commit)
    expect(original.getSnapshot().todos[0]?.title).toBe('edited')
    expect(draft.isDirty()).toBe(false)

    await Effect.runPromise(
      original.update((state) => {
        state.count = 42
      })
    )
    expect(draft.isDirty()).toBe(true)
    await Effect.runPromise(draft.reset)
    expect(draft.data.getSnapshot().count).toBe(42)
    expect(draft.isDirty()).toBe(false)
  })

  it('fails partial commits safely when an identified ancestor moved', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    await Effect.runPromise(
      draft.data.update((state) => {
        const first = state.todos[0]
        if (first !== undefined) first.title = 'edited A'
      })
    )
    await Effect.runPromise(
      original.update((_state, operations) => {
        operations.arrayMove(['todos'], 0, 1)
      })
    )

    const result = await Effect.runPromiseExit(
      draft.commitAt(['todos', 0, 'title'])
    )
    expect(result._tag).toBe('Failure')
    expect(original.getSnapshot().todos.map((todo) => todo.title)).toEqual([
      'B',
      'A',
    ])
    expect(draft.isDirtyAt(['todos', 0, 'title'])).toBe(true)
  })

  it('marks both editing and commit operations with the draft lifecycle phase', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    const phases: Array<string> = []
    draft.data.subscribe((commit) => phases.push(commit.validationPhase))
    original.subscribe((commit) => phases.push(commit.validationPhase))

    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 1
      })
    )
    await Effect.runPromise(draft.commit)

    expect(phases).toEqual(['draft', 'draft'])
  })

  it('uses the TreeSpec atomic equality contract for dirty checks', async () => {
    class Money {
      constructor(readonly cents: number) {}
    }

    const snapshots = new WeakSet<Money>()
    const moneyInterpreter: AtomicInterpreter<Money> = {
      name: 'Money',
      is: (value): value is Money => value instanceof Money,
      capture: (value) => {
        const snapshot = Object.freeze(new Money(value.cents))
        snapshots.add(snapshot)
        return snapshot
      },
      isSnapshot: (value) => snapshots.has(value),
      equals: (left, right) => left.cents === right.cents,
    }
    const Wallet = Schema.Struct({
      balance: Schema.instanceOf(Money).pipe(atomic),
    })
    const walletSpec = makeTreeSpec(Wallet, {
      atomicInterpreters: [moneyInterpreter],
    })
    const original = await Effect.runPromise(
      makeTreeStore(walletSpec, { balance: new Money(1250) })
    )
    const draft = await Effect.runPromise(makeDraft(original))

    await Effect.runPromise(
      draft.data.apply({
        patches: {
          forward: [
            {
              op: 'replace',
              path: ['balance'],
              value: new Money(1250),
            },
          ],
          inverse: [],
        },
      })
    )

    expect(draft.data.getSnapshot().balance).toBe(
      original.getSnapshot().balance
    )
    expect(draft.isDirty()).toBe(false)
    expect(draft.isDirtyAt(['balance'])).toBe(false)
  })
})
