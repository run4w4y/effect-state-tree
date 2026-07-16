import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'
import { makeDevtools } from '../src/index'

const State = Schema.Struct({ count: Schema.Number })

describe('devtools timeline', () => {
  it('records full commits and time-travels without polluting the timeline', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(makeTreeSpec(State), { count: 0 })
    )
    const devtools = makeDevtools(store)

    await Effect.runPromise(
      store.update(
        (state) => {
          state.count = 1
        },
        {
          label: 'one',
        }
      )
    )
    await Effect.runPromise(
      store.update(
        (state) => {
          state.count = 2
        },
        {
          label: 'two',
        }
      )
    )

    expect(devtools.getState().entries.map((entry) => entry.label)).toEqual([
      'one',
      'two',
    ])
    expect(devtools.getState().entries[0]?.change.patches.forward).toEqual([
      { op: 'replace', path: ['count'], value: 1 },
    ])

    await Effect.runPromise(devtools.travelTo(1))
    expect(store.getSnapshot().count).toBe(1)
    expect(devtools.getState().entries).toHaveLength(2)

    await Effect.runPromise(devtools.resume)
    expect(store.getSnapshot().count).toBe(2)
    expect(devtools.getState().entries).toHaveLength(2)
    devtools.dispose()
  })

  it('reports an unknown revision in the typed error channel', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(makeTreeSpec(State), { count: 0 })
    )
    const devtools = makeDevtools(store)
    const exit = await Effect.runPromiseExit(devtools.travelTo(99))
    expect(exit._tag).toBe('Failure')
    devtools.dispose()
  })

  it('anchors its timeline at the revision where it attaches', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(makeTreeSpec(State), { count: 0 })
    )
    await Effect.runPromise(
      store.update((state) => {
        state.count = 1
      })
    )
    const devtools = makeDevtools(store)

    expect(devtools.getState().initialRevision).toBe(1)
    await Effect.runPromise(
      store.update((state) => {
        state.count = 2
      })
    )
    await Effect.runPromise(devtools.travelTo(1))
    expect(store.getSnapshot().count).toBe(1)
    expect(devtools.getState().entries).toHaveLength(1)
    devtools.dispose()
  })
})
