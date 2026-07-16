import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Deferred, Effect, Layer, Schema } from 'effect'
import { Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { atomCommand, atomFromTreeSelector } from '../src/index'

const State = Schema.Struct({ count: Schema.Number })
const spec = makeTreeSpec(State)

describe('Effect Atom adapter', () => {
  it('exposes a read-only atom that follows a selected StoreView', async () => {
    const store = await Effect.runPromise(makeTreeStore(spec, { count: 0 }))
    const atom = atomFromTreeSelector(store, (state) => state.count)
    const registry = AtomRegistry.make({
      scheduleTask: (task) => {
        task()
        return () => undefined
      },
    })
    const values: Array<number> = []
    const unsubscribe = registry.subscribe(
      atom,
      (value) => values.push(value),
      {
        immediate: true,
      }
    )

    await Effect.runPromise(
      store.update((state) => {
        state.count = 1
      })
    )

    expect(registry.get(atom)).toBe(1)
    expect(values).toEqual([0, 1])
    unsubscribe()
    registry.dispose()
  })

  it('maps merge execution to Atom concurrent commands', async () => {
    const firstStarted = Deferred.makeUnsafe<void>()
    const secondStarted = Deferred.makeUnsafe<void>()
    const firstRelease = Deferred.makeUnsafe<void>()
    const secondRelease = Deferred.makeUnsafe<void>()
    const firstCompleted = Deferred.makeUnsafe<void>()
    const secondCompleted = Deferred.makeUnsafe<void>()
    const firstInterrupted = Deferred.makeUnsafe<void>()
    const runtime = Atom.runtime(Layer.empty)
    const command = atomCommand(
      runtime,
      (name: 'first' | 'second') =>
        Deferred.succeed(
          name === 'first' ? firstStarted : secondStarted,
          undefined
        ).pipe(
          Effect.andThen(
            Deferred.await(name === 'first' ? firstRelease : secondRelease)
          ),
          Effect.andThen(
            Deferred.succeed(
              name === 'first' ? firstCompleted : secondCompleted,
              undefined
            )
          ),
          Effect.onInterrupt(() =>
            name === 'first'
              ? Deferred.succeed(firstInterrupted, undefined)
              : Effect.void
          )
        ),
      { execution: 'merge' }
    )
    const registry = AtomRegistry.make({
      scheduleTask: (task) => {
        task()
        return () => undefined
      },
    })
    const unsubscribe = registry.subscribe(command, () => undefined, {
      immediate: true,
    })

    registry.set(command, 'first')
    await Effect.runPromise(Deferred.await(firstStarted))
    registry.set(command, 'second')
    await Effect.runPromise(Deferred.await(secondStarted))
    expect(Deferred.isDoneUnsafe(firstInterrupted)).toBe(false)

    Deferred.doneUnsafe(secondRelease, Effect.void)
    await Effect.runPromise(Deferred.await(secondCompleted))
    expect(Deferred.isDoneUnsafe(firstCompleted)).toBe(false)
    Deferred.doneUnsafe(firstRelease, Effect.void)
    await Effect.runPromise(Deferred.await(firstCompleted))

    unsubscribe()
    registry.dispose()
  })
})
