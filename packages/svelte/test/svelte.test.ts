import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Fiber, Schema } from 'effect'
import { treeCommandStore, treeSelectorStore } from '../src/index'

const State = Schema.Struct({ left: Schema.Number, right: Schema.Number })
const spec = makeTreeSpec(State)

describe('Svelte adapter', () => {
  it('updates path-aware readable stores and disposes the view subscription', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(spec, { left: 0, right: 0 })
    )
    let evaluations = 0
    const selected = treeSelectorStore(
      store,
      (state) => {
        evaluations += 1
        return state.left
      },
      { paths: [['left']] }
    )
    const values: number[] = []
    const unsubscribe = selected.subscribe((value) => values.push(value))

    expect(values).toEqual([0])
    expect(evaluations).toBe(1)

    await Effect.runPromise(
      store.update((state) => {
        state.right = 1
      })
    )
    expect(values).toEqual([0])
    expect(evaluations).toBe(1)

    await Effect.runPromise(
      store.update((state) => {
        state.left = 2
      })
    )
    expect(values).toEqual([0, 2])
    expect(evaluations).toBe(2)

    unsubscribe()
    await Effect.runPromise(
      store.update((state) => {
        state.left = 3
      })
    )
    expect(values).toEqual([0, 2])
    expect(selected.getSnapshot()).toBe(3)
  })

  it('exposes Effect command lifecycle as a readable store', async () => {
    const command = treeCommandStore(
      { runFork: Effect.runFork },
      (value: number) => Effect.succeed(value * 2)
    )
    const states: Array<string> = []
    const unsubscribe = command.subscribe((result) =>
      states.push(`${result._tag}:${result.waiting}`)
    )

    const fiber = command.run(21)
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(42)
    expect(command.getSnapshot()).toMatchObject({
      _tag: 'Success',
      value: 42,
      waiting: false,
    })
    expect(states).toEqual(['Initial:false', 'Initial:true', 'Success:false'])
    unsubscribe()
    command.dispose()
  })
})
