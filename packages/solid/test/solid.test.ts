import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore, type StoreView } from '@effect-state-tree/runtime'
import { Effect, Fiber, Schema, Stream } from 'effect'
import { createRoot } from 'solid-js'
import {
  createStoreViewSignal,
  createTreeCommand,
  createTreeSelector,
} from '../src/index'

const State = Schema.Struct({ left: Schema.Number, right: Schema.Number })
const spec = makeTreeSpec(State)

describe('Solid adapter', () => {
  it('updates path-aware selectors and disposes with the reactive owner', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(spec, { left: 0, right: 0 })
    )
    let evaluations = 0
    const root = createRoot((dispose) => ({
      selected: createTreeSelector(
        store,
        (state) => {
          evaluations += 1
          return state.left
        },
        { paths: [['left']] }
      ),
      dispose,
    }))

    expect(root.selected()).toBe(0)
    expect(evaluations).toBe(1)

    await Effect.runPromise(
      store.update((state) => {
        state.right = 1
      })
    )
    expect(root.selected()).toBe(0)
    expect(evaluations).toBe(1)

    await Effect.runPromise(
      store.update((state) => {
        state.left = 2
      })
    )
    expect(root.selected()).toBe(2)
    expect(evaluations).toBe(2)

    root.dispose()
    await Effect.runPromise(
      store.update((state) => {
        state.left = 3
      })
    )
    expect(root.selected()).toBe(2)
  })

  it('unsubscribes a StoreView when its owner is disposed', () => {
    let current = 0
    let listener: (() => void) | undefined
    let unsubscribed = false
    const view: StoreView<number> = {
      getSnapshot: () => current,
      subscribe: (next) => {
        listener = next
        return () => {
          unsubscribed = true
        }
      },
      changes: Stream.empty,
    }

    const root = createRoot((dispose) => ({
      value: createStoreViewSignal(view),
      dispose,
    }))
    current = 1
    listener?.()
    expect(root.value()).toBe(1)
    root.dispose()
    expect(unsubscribed).toBe(true)
  })

  it('binds Effect command lifecycle to the reactive owner', async () => {
    const root = createRoot((dispose) => ({
      command: createTreeCommand({ runFork: Effect.runFork }, (value: number) =>
        Effect.succeed(value * 2)
      ),
      dispose,
    }))

    const fiber = root.command.run(21)
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(42)
    expect(root.command.result()).toMatchObject({
      _tag: 'Success',
      value: 42,
      waiting: false,
    })
    root.dispose()
  })
})
