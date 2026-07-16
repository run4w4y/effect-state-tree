import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Fiber, Schema } from 'effect'
import { effectScope } from 'vue'
import { useTreeCommand, useTreeSelector } from '../src/index'

const State = Schema.Struct({ left: Schema.Number, right: Schema.Number })
const spec = makeTreeSpec(State)

describe('Vue adapter', () => {
  it('updates path-aware shallow refs and stops on scope disposal', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(spec, { left: 0, right: 0 })
    )
    let evaluations = 0
    const scope = effectScope()
    const selected = scope.run(() =>
      useTreeSelector(
        store,
        (state) => {
          evaluations += 1
          return state.left
        },
        { paths: [['left']] }
      )
    )
    if (selected === undefined) throw new Error('Vue scope did not run')

    expect(selected.value).toBe(0)
    expect(evaluations).toBe(1)

    await Effect.runPromise(
      store.update((state) => {
        state.right = 1
      })
    )
    expect(selected.value).toBe(0)
    expect(evaluations).toBe(1)

    await Effect.runPromise(
      store.update((state) => {
        state.left = 2
      })
    )
    expect(selected.value).toBe(2)
    expect(evaluations).toBe(2)

    scope.stop()
    await Effect.runPromise(
      store.update((state) => {
        state.left = 3
      })
    )
    expect(selected.value).toBe(2)
  })

  it('binds Effect command lifecycle to a Vue scope', async () => {
    const scope = effectScope()
    const command = scope.run(() =>
      useTreeCommand({ runFork: Effect.runFork }, (value: number) =>
        Effect.succeed(value * 2)
      )
    )
    if (command === undefined) throw new Error('Vue scope did not run')

    const fiber = command.run(21)
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(42)
    expect(command.result.value).toMatchObject({
      _tag: 'Success',
      value: 42,
      waiting: false,
    })
    scope.stop()
  })
})
