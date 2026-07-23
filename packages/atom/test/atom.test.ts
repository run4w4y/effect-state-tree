import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { defineTree, makeTreeStore } from '@effect-state-tree/runtime'
import { Context, Effect, Layer, Schema } from 'effect'
import { AtomRegistry } from 'effect/unstable/reactivity'
import {
  atomFromTreeSelector,
  makeTreeAtoms,
  makeTreeAtomsWithLayer,
} from '../src/index'

const State = Schema.Struct({ count: Schema.Number })
const spec = makeTreeSpec(State)
const StateTree = defineTree('@effect-state-tree/atom-test/State', spec)
const increment = StateTree.update(
  (state, amount: number) => {
    state.count += amount
  },
  (amount) => ({ label: `Increment by ${amount}` })
)

const makeRegistry = (): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({
    scheduleTask: (task) => {
      task()
      return () => undefined
    },
  })

describe('Effect Atom adapter', () => {
  it('exposes a read-only atom that follows a selected StoreView', async () => {
    const store = await Effect.runPromise(makeTreeStore(spec, { count: 0 }))
    const atom = atomFromTreeSelector(store, (state) => state.count)
    const registry = makeRegistry()
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

  it('provides the tree service to native Atom function actions', async () => {
    const store = await Effect.runPromise(StateTree.make({ count: 1 }))
    const atoms = makeTreeAtoms(StateTree, store)
    const count = atoms.select((state) => state.count, { paths: [['count']] })
    const incrementAtom = atoms.fn(increment)
    const registry = makeRegistry()
    const unmountCount = registry.mount(count)
    const unmountIncrement = registry.mount(incrementAtom)

    registry.set(incrementAtom, 4)
    const result = await Effect.runPromise(
      AtomRegistry.getResult(registry, incrementAtom, {
        suspendOnWaiting: true,
      })
    )

    expect(result._tag).toBe('Committed')
    expect(registry.get(count)).toBe(5)
    expect(store.getSnapshot()).toEqual({ count: 5 })
    unmountIncrement()
    unmountCount()
    registry.dispose()
  })

  it('merges application services into the tree Atom runtime', async () => {
    class Prefix extends Context.Service<Prefix, string>()(
      '@effect-state-tree/atom-test/Prefix'
    ) {}

    const store = await Effect.runPromise(StateTree.make({ count: 0 }))
    const atoms = makeTreeAtomsWithLayer(
      StateTree,
      store,
      Layer.succeed(Prefix, 'count')
    )
    const describeCount = atoms.fn((suffix: string) =>
      Effect.gen(function* () {
        const prefix = yield* Prefix
        const tree = yield* StateTree.service
        return `${prefix}:${tree.getSnapshot().count}:${suffix}`
      })
    )
    const registry = makeRegistry()
    const unmount = registry.mount(describeCount)

    registry.set(describeCount, 'ready')

    expect(
      await Effect.runPromise(
        AtomRegistry.getResult(registry, describeCount, {
          suspendOnWaiting: true,
        })
      )
    ).toBe('count:0:ready')
    unmount()
    registry.dispose()
  })
})
