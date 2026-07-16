import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'
import {
  groupHistory,
  HistoryGroupIds,
  historyGroupIdsFrom,
  makeHistory,
  withoutHistory,
} from '../src/index'

const State = Schema.Struct({ count: Schema.Number })
const spec = makeTreeSpec(State)
const makeStore = () => makeTreeStore(spec, { count: 0 })

describe('history plugin', () => {
  it('supports undo, redo, grouping, skipping, and redo clearing', async () => {
    const store = await Effect.runPromise(makeStore())
    const history = makeHistory(store)

    await Effect.runPromise(
      groupHistory(
        'two increments',
        Effect.gen(function* () {
          yield* store.update((state) => {
            state.count += 1
          })
          yield* Effect.yieldNow
          yield* store.update((state) => {
            state.count += 1
          })
        })
      )
    )
    expect(store.getSnapshot().count).toBe(2)
    expect(history.getState().undo).toHaveLength(1)

    await Effect.runPromise(history.undo)
    expect(store.getSnapshot().count).toBe(0)
    expect(history.canRedo()).toBe(true)

    await Effect.runPromise(history.redo)
    expect(store.getSnapshot().count).toBe(2)

    await Effect.runPromise(
      withoutHistory(
        store.update((state) => {
          state.count = 10
        })
      )
    )
    expect(history.getState().undo).toHaveLength(1)

    await Effect.runPromise(history.undo)
    await Effect.runPromise(
      store.update((state) => {
        state.count = 3
      })
    )
    expect(history.canRedo()).toBe(false)
    history.dispose()
  })

  it('restores falsy attached state by presence rather than truthiness', async () => {
    const store = await Effect.runPromise(makeStore())
    let attached = 0
    const history = makeHistory(store, {
      captureAttached: () => attached,
      restoreAttached: (value: number) => {
        attached = value
      },
    })

    attached = 1
    await Effect.runPromise(
      store.update((state) => {
        state.count = 1
      })
    )
    await Effect.runPromise(history.undo)
    expect(attached).toBe(0)
    await Effect.runPromise(history.redo)
    expect(attached).toBe(1)
    history.dispose()
  })

  it('allocates injected group identifiers lazily for each execution', async () => {
    const store = await Effect.runPromise(makeStore())
    const history = makeHistory(store)
    let sequence = 0
    const grouped = groupHistory(
      'increment',
      store.update((state) => {
        state.count += 1
      })
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* grouped
        yield* grouped
      }).pipe(
        Effect.provideService(
          HistoryGroupIds,
          historyGroupIdsFrom(() => `group-${++sequence}`)
        )
      )
    )

    expect(sequence).toBe(2)
    expect(history.getState().undo.map((entry) => entry.groupId)).toEqual([
      'group-1',
      'group-2',
    ])
    history.dispose()
  })
})
