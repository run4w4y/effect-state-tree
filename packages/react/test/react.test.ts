import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import {
  type CommandExecution,
  defineTree,
  makeTreeAction,
} from '@effect-state-tree/runtime'
import { Deferred, Effect, Fiber, Schema } from 'effect'
import { createElement, StrictMode, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import {
  bindReactTree,
  type TreeCommandHandle,
  TreeCommandRuntimeProvider,
} from '../src/index'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const State = Schema.Struct({
  count: Schema.Number,
  ignored: Schema.Number,
})
const definition = defineTree(
  '@effect-state-tree/react-test/State',
  makeTreeSpec(State)
)
const bindings = bindReactTree(definition)
const increment = makeTreeAction(
  definition,
  (state, amount: number) => {
    state.count += amount
  },
  (amount) => ({ label: `Increment by ${amount}` })
)

type HandleFor<Action> = Action extends (
  ...args: infer Args
) => Effect.Effect<infer A, infer E, infer _R>
  ? TreeCommandHandle<Args, A, E>
  : never

describe('React adapter', () => {
  it('derives bindings from a tree definition and tracks inline selectors', async () => {
    expect(bindReactTree(definition)).toBe(bindings)
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )

    const Counter = () => {
      const count = bindings.useSelector((state) => state.count)
      return createElement('span', null, String(count))
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(bindings.Provider, { store }, createElement(Counter))
      )
    })
    if (renderer === undefined) {
      throw new Error('React renderer was not created')
    }
    expect(renderer.toJSON()).toEqual({
      type: 'span',
      props: {},
      children: ['0'],
    })

    await act(async () => {
      await Effect.runPromise(
        store.update((state) => {
          state.count = 1
        })
      )
    })
    expect(renderer.toJSON()).toEqual({
      type: 'span',
      props: {},
      children: ['1'],
    })
    await act(async () => renderer?.unmount())
  })

  it('observes a commit made between render and subscription', async () => {
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    let committedBeforeSubscription = false
    const trackedStore: typeof store = {
      ...store,
      subscribe(listener) {
        if (!committedBeforeSubscription) {
          committedBeforeSubscription = true
          Effect.runSync(
            Effect.orDie(
              store.update((state) => {
                state.count = 7
              })
            )
          )
        }
        return store.subscribe(listener)
      },
    }

    const Counter = () =>
      createElement(
        'span',
        null,
        String(bindings.useSelector((state) => state.count))
      )

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(
          bindings.Provider,
          { store: trackedStore },
          createElement(Counter)
        )
      )
    })

    expect(renderer?.toJSON()).toMatchObject({ children: ['7'] })
    await act(async () => renderer?.unmount())
  })

  it('retains one subscription across inline selector and parent renders', async () => {
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    let subscriptions = 0
    let unsubscriptions = 0
    let renders = 0
    let bump: (() => void) | undefined
    const trackedStore: typeof store = {
      ...store,
      subscribe(listener) {
        subscriptions += 1
        const unsubscribe = store.subscribe(listener)
        return () => {
          unsubscriptions += 1
          unsubscribe()
        }
      },
    }

    const Projection = ({ tick }: { readonly tick: number }) => {
      renders += 1
      const selected = bindings.useSelector(
        (state) => ({ count: state.count }),
        {
          equals: (left, right) => left.count === right.count,
          paths: [['count']],
        }
      )
      return createElement('span', null, `${selected.count}:${tick}`)
    }
    const Parent = () => {
      const [tick, setTick] = useState(0)
      bump = () => setTick((value) => value + 1)
      return createElement(Projection, { tick })
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(
          bindings.Provider,
          { store: trackedStore },
          createElement(Parent)
        )
      )
    })
    expect(subscriptions).toBe(1)

    await act(async () => {
      bump?.()
    })
    expect(subscriptions).toBe(1)

    const rendersBeforeIgnoredCommit = renders
    await act(async () => {
      await Effect.runPromise(
        store.update((state) => {
          state.ignored += 1
        })
      )
    })
    expect(renders).toBe(rendersBeforeIgnoredCommit)

    await act(async () => {
      await Effect.runPromise(
        store.update((state) => {
          state.count += 1
        })
      )
    })
    expect(renderer?.toJSON()).toMatchObject({ children: ['1:1'] })

    await act(async () => renderer?.unmount())
    expect(unsubscriptions).toBe(1)
  })

  it('keeps the external-store snapshot stable for fresh derived values', async () => {
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    let renders = 0

    const Projection = () => {
      renders += 1
      const values = bindings.useSelector((state) => [state.count], {
        paths: [['count']],
      })
      return createElement('span', null, values.join(','))
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(bindings.Provider, { store }, createElement(Projection))
      )
    })
    expect(renderer?.toJSON()).toMatchObject({ children: ['0'] })
    expect(renders).toBeLessThan(5)

    await act(async () => {
      await Effect.runPromise(
        store.update((state) => {
          state.count = 1
        })
      )
    })
    expect(renderer?.toJSON()).toMatchObject({ children: ['1'] })
    expect(renders).toBeLessThan(10)
    await act(async () => renderer?.unmount())
  })

  it('survives StrictMode effect replay and disposes after real unmount', async () => {
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    let command: HandleFor<typeof increment> | undefined
    let firstRun: HandleFor<typeof increment>['run'] | undefined
    let firstCancel: (() => void) | undefined

    const Command = () => {
      command = bindings.useCommand(increment)
      firstRun ??= command.run
      firstCancel ??= command.cancel
      return createElement('span', null, command.result._tag)
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(
          StrictMode,
          null,
          createElement(bindings.Provider, { store }, createElement(Command))
        )
      )
      await Promise.resolve()
    })

    await act(async () => {
      const fiber = command?.run(2)
      if (fiber === undefined) throw new Error('Command hook was not mounted')
      await Effect.runPromise(Fiber.join(fiber))
    })

    expect(store.getSnapshot().count).toBe(2)
    expect(command?.result._tag).toBe('Success')
    expect(command?.run).toBe(firstRun)
    expect(command?.cancel).toBe(firstCancel)

    const retainedCommand = command
    if (retainedCommand === undefined) {
      throw new Error('Command hook was not retained')
    }
    await act(async () => {
      renderer?.unmount()
      await Promise.resolve()
    })
    expect(() => retainedCommand.run(1)).toThrow(
      'Cannot run a disposed command controller'
    )
  })

  it('inherits a context runtime override instead of requiring one per hook', async () => {
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    let forks = 0
    const runtime = {
      runFork: <A, E>(
        effect: Effect.Effect<A, E>,
        options?: Effect.RunOptions
      ) => {
        forks += 1
        return Effect.runFork(effect, options)
      },
    }
    let command: HandleFor<typeof increment> | undefined

    const Command = () => {
      command = bindings.useCommand(increment)
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(
          TreeCommandRuntimeProvider,
          { runtime },
          createElement(bindings.Provider, { store }, createElement(Command))
        )
      )
    })
    await act(async () => {
      const fiber = command?.run(1)
      if (fiber === undefined) throw new Error('Command hook was not mounted')
      await Effect.runPromise(Fiber.join(fiber))
    })

    expect(forks).toBe(1)
    expect(store.getSnapshot().count).toBe(1)
    await act(async () => renderer?.unmount())
  })

  it('updates the execution strategy without recreating the controller', async () => {
    const store = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    const first = Deferred.makeUnsafe<number>()
    const second = Deferred.makeUnsafe<number>()
    const waitFor = (name: 'first' | 'second') =>
      Deferred.await(name === 'first' ? first : second)
    type Run = (name: 'first' | 'second') => Fiber.Fiber<number, never>
    let initialRun: Run | undefined
    let currentRun: Run | undefined
    let changeExecution: ((execution: CommandExecution) => void) | undefined

    const Command = () => {
      const [execution, setExecution] = useState<CommandExecution>('switch')
      const command = bindings.useCommand(waitFor, { execution })
      initialRun ??= command.run
      currentRun = command.run
      changeExecution = (next) => setExecution(next)
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(bindings.Provider, { store }, createElement(Command))
      )
    })

    const runFirst = currentRun
    if (runFirst === undefined) throw new Error('Command hook was not mounted')
    let firstFiber: Fiber.Fiber<number, never> | undefined
    await act(async () => {
      firstFiber = runFirst('first')
    })

    await act(async () => {
      changeExecution?.('merge')
    })
    expect(currentRun).toBe(initialRun)

    const runSecond = currentRun
    if (runSecond === undefined) throw new Error('Command hook was not mounted')
    let secondFiber: Fiber.Fiber<number, never> | undefined
    await act(async () => {
      secondFiber = runSecond('second')
    })

    if (secondFiber === undefined) throw new Error('Second command did not run')
    const activeSecondFiber = secondFiber
    await act(async () => {
      Deferred.doneUnsafe(second, Effect.succeed(2))
      const secondExit = await Effect.runPromise(Fiber.await(activeSecondFiber))
      expect(secondExit).toMatchObject({ _tag: 'Success', value: 2 })
    })

    if (firstFiber === undefined) throw new Error('First command did not run')
    const activeFirstFiber = firstFiber
    await act(async () => {
      Deferred.doneUnsafe(first, Effect.succeed(1))
      const firstExit = await Effect.runPromise(Fiber.await(activeFirstFiber))
      expect(firstExit).toMatchObject({ _tag: 'Success', value: 1 })
    })

    await act(async () => renderer?.unmount())
  })

  it('routes actions to a replacement Provider store', async () => {
    const firstStore = await Effect.runPromise(
      definition.make({ count: 0, ignored: 0 })
    )
    const secondStore = await Effect.runPromise(
      definition.make({ count: 10, ignored: 0 })
    )
    let command: HandleFor<typeof increment> | undefined

    const Command = () => {
      command = bindings.useCommand(increment)
      return null
    }

    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(
        createElement(
          bindings.Provider,
          { store: firstStore },
          createElement(Command)
        )
      )
    })
    await act(async () => {
      const fiber = command?.run(1)
      if (fiber === undefined) throw new Error('Command hook was not mounted')
      await Effect.runPromise(Fiber.join(fiber))
    })

    await act(async () => {
      renderer?.update(
        createElement(
          bindings.Provider,
          { store: secondStore },
          createElement(Command)
        )
      )
    })
    await act(async () => {
      const fiber = command?.run(2)
      if (fiber === undefined) throw new Error('Command hook was not mounted')
      await Effect.runPromise(Fiber.join(fiber))
    })

    expect(firstStore.getSnapshot().count).toBe(1)
    expect(secondStore.getSnapshot().count).toBe(12)
    await act(async () => renderer?.unmount())
  })
})
