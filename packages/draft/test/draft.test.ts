import { describe, expect, it } from 'bun:test'
import {
  type AtomicInterpreter,
  atomic,
  entity,
  makeTreeSpec,
} from '@effect-state-tree/core'
import { makeTreeStore, type TreeStore } from '@effect-state-tree/runtime'
import { Data, Deferred, Effect, Fiber, Option, Schema } from 'effect'
import { DraftDirtyError, makeDraft, makeDraftScoped } from '../src/index'

class AuthoritativeConflict extends Data.TaggedError('AuthoritativeConflict')<{
  readonly current: number
}> {}

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
  it('submits a captured path and reconciles the authoritative response', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 1
      })
    )

    const result = await Effect.runPromise(
      draft.submitAt(['count'], ({ original: before, submitted }) => {
        expect(before).toBe(0)
        expect(submitted).toBe(1)
        return Effect.succeed(2)
      })
    )

    expect(result).toEqual({ _tag: 'Accepted', authoritative: 2 })
    expect(original.getSnapshot().count).toBe(2)
    expect(draft.data.getSnapshot().count).toBe(2)
  })

  it('preserves edits made while a submission is in flight', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 1
      })
    )
    const started = await Effect.runPromise(Deferred.make<void>())
    const release = await Effect.runPromise(Deferred.make<void>())
    const fiber = Effect.runFork(
      draft.submitAt(['count'], () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          return 2
        })
      )
    )
    await Effect.runPromise(Deferred.await(started))
    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 3
      })
    )
    await Effect.runPromise(Deferred.succeed(release, undefined))

    const result = await Effect.runPromise(Fiber.join(fiber))
    expect(result).toEqual({
      _tag: 'AcceptedWithPendingChanges',
      authoritative: 2,
    })
    expect(original.getSnapshot().count).toBe(2)
    expect(draft.data.getSnapshot().count).toBe(3)
  })

  it('does not let a stale response overwrite a newer accepted response', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 1
      })
    )
    const firstStarted = await Effect.runPromise(Deferred.make<void>())
    const releaseFirst = await Effect.runPromise(Deferred.make<void>())
    const first = Effect.runFork(
      draft.submitAt(['count'], () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(firstStarted, undefined)
          yield* Deferred.await(releaseFirst)
          return 2
        })
      )
    )
    await Effect.runPromise(Deferred.await(firstStarted))

    const second = await Effect.runPromise(
      draft.submitAt(['count'], () => Effect.succeed(3))
    )
    await Effect.runPromise(Deferred.succeed(releaseFirst, undefined))
    const stale = await Effect.runPromise(Fiber.join(first))

    expect(second._tag).toBe('Accepted')
    expect(stale).toEqual({ _tag: 'Superseded', authoritative: 2 })
    expect(original.getSnapshot().count).toBe(3)
    expect(draft.data.getSnapshot().count).toBe(3)
  })

  it('rejects refresh when the path is already dirty', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 1
      })
    )

    const error = await Effect.runPromise(
      Effect.flip(draft.refreshAt(['count'], () => Effect.succeed(2)))
    )
    expect(error).toBeInstanceOf(DraftDirtyError)
    expect(original.getSnapshot().count).toBe(0)
    expect(draft.data.getSnapshot().count).toBe(1)
  })

  it('reconciles mapped authoritative failures without touching the draft', async () => {
    const original = await Effect.runPromise(makeStore())
    const draft = await Effect.runPromise(makeDraft(original))
    await Effect.runPromise(
      draft.data.update((state) => {
        state.count = 1
      })
    )

    const error = await Effect.runPromise(
      Effect.flip(
        draft.submitAt(
          ['count'],
          () => Effect.fail(new AuthoritativeConflict({ current: 4 })),
          {
            authoritativeFailure: (failure) => Option.some(failure.current),
          }
        )
      )
    )

    expect(error).toBeInstanceOf(AuthoritativeConflict)
    expect(original.getSnapshot().count).toBe(4)
    expect(draft.data.getSnapshot().count).toBe(1)
  })

  it('closes the editing store with its surrounding Scope', async () => {
    const original = await Effect.runPromise(makeStore())
    let data: TreeStore<typeof State> | undefined

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const draft = yield* makeDraftScoped(original)
          data = draft.data
          expect(yield* draft.data.isShutdown).toBe(false)
        })
      )
    )

    if (data === undefined) throw new Error('Expected the scoped draft store')
    expect(await Effect.runPromise(data.isShutdown)).toBe(true)
    await Effect.runPromise(original.shutdown)
  })

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
