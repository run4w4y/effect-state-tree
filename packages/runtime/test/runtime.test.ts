import { describe, expect, it } from 'bun:test'
import {
  dateAtomicInterpreter,
  makeTreeSpec,
  type TreeValue,
} from '@effect-state-tree/core'
import { Deferred, Effect, Exit, Fiber, HashSet, Schema, Stream } from 'effect'
import type { ChangeEnvelope, CommitResult, TreeStore } from '../src/index'
import {
  defineTree,
  makeTreeStore,
  makeTreeStoreScoped,
  runCommitSink,
  TransactionIds,
  TreeCheckpointConflict,
  TreeCheckpointStoreMismatch,
  transactionIdsFrom,
  withCommitContext,
} from '../src/index'

const RuntimeSchema = Schema.Struct({
  counter: Schema.Number,
  left: Schema.Struct({
    value: Schema.Number,
    other: Schema.Number,
  }),
  right: Schema.Struct({
    value: Schema.Number,
  }),
})

type RuntimeState = TreeValue<typeof RuntimeSchema>
type RuntimeStore = TreeStore<typeof RuntimeSchema>

const ActionSchema = Schema.Struct({
  counter: Schema.Number,
  items: Schema.Array(Schema.String),
})
const actionDefinition = defineTree(
  '@effect-state-tree/runtime-test/ActionState',
  makeTreeSpec(ActionSchema)
)
const addToCounter = actionDefinition.update(
  (state, amount: number) => {
    state.counter += amount
  },
  (amount) => ({ label: `Add ${amount}` })
)
const appendItem = actionDefinition.operationUpdate(
  (state, operations, value: string) => {
    operations.arraySplice(['items'], state.items.length, 0, value)
  },
  { label: 'Append item' }
)
const asynchronousAction = actionDefinition.action(
  'Action.asynchronous',
  (input: {
    readonly started: Deferred.Deferred<void>
    readonly release: Deferred.Deferred<void>
  }) =>
    Effect.gen(function* () {
      yield* addToCounter(1)
      yield* Deferred.succeed(input.started, undefined)
      yield* Deferred.await(input.release)
      yield* appendItem('after-await')
    })
)

const runtimeSpec = makeTreeSpec(RuntimeSchema)

const makeInitial = (): RuntimeState => ({
  counter: 0,
  left: { value: 0, other: 0 },
  right: { value: 0 },
})

const makeStore = async (): Promise<RuntimeStore> => {
  return Effect.runPromise(makeTreeStore(runtimeSpec, makeInitial()))
}

const committed = <S extends Schema.Constraint>(
  result: CommitResult<S>
): ChangeEnvelope<S> => {
  expect(result._tag).toBe('Committed')
  if (result._tag !== 'Committed')
    throw new Error('expected a committed result')
  return result.commit
}

describe('TreeStore runtime', () => {
  it('rejects a conditional write when its watched path changed', async () => {
    const store = await makeStore()
    const checkpoint = await Effect.runPromise(store.checkpoint(['left']))
    await Effect.runPromise(
      store.update((state) => {
        state.left.value = 1
      })
    )

    const error = await Effect.runPromise(
      Effect.flip(store.replaceAtCheckpoint(checkpoint, { value: 2, other: 0 }))
    )
    expect(error).toBeInstanceOf(TreeCheckpointConflict)
    expect(store.getSnapshot().left.value).toBe(1)
  })

  it('keeps a path checkpoint valid across unrelated commits', async () => {
    const store = await makeStore()
    const checkpoint = await Effect.runPromise(store.checkpoint(['left']))
    await Effect.runPromise(
      store.update((state) => {
        state.right.value = 1
      })
    )

    await Effect.runPromise(
      store.replaceAtCheckpoint(checkpoint, { value: 2, other: 3 })
    )
    expect(store.getSnapshot()).toMatchObject({
      left: { value: 2, other: 3 },
      right: { value: 1 },
    })
  })

  it('rejects checkpoints captured by another store instance', async () => {
    const first = await makeStore()
    const second = await makeStore()
    const checkpoint = await Effect.runPromise(first.checkpoint(['left']))

    const error = await Effect.runPromise(
      Effect.flip(
        second.replaceAtCheckpoint(checkpoint, { value: 2, other: 3 })
      )
    )
    expect(error).toBeInstanceOf(TreeCheckpointStoreMismatch)
  })

  it('preserves every concurrent update and notifies in revision order', async () => {
    const store = await makeStore()
    const observed: Array<ChangeEnvelope<typeof RuntimeSchema>> = []
    const unsubscribe = store.subscribe((commit) => observed.push(commit))
    const updateCount = 16

    const results = await Effect.runPromise(
      Effect.all(
        Array.from({ length: updateCount }, () =>
          store.update(
            (tree) => {
              tree.counter += 1
            },
            { guard: () => Effect.yieldNow }
          )
        ),
        { concurrency: 'unbounded' }
      )
    )
    unsubscribe()

    expect(results.every((result) => result._tag === 'Committed')).toBe(true)
    expect(store.getSnapshot().counter).toBe(updateCount)
    expect(store.getRevision()).toBe(updateCount)
    expect(observed).toHaveLength(updateCount)
    expect(observed.map((commit) => commit.revisionBefore)).toEqual(
      Array.from({ length: updateCount }, (_, index) => index)
    )
    expect(observed.map((commit) => commit.revisionAfter)).toEqual(
      Array.from({ length: updateCount }, (_, index) => index + 1)
    )
    expect(observed.map((commit) => commit.after.counter)).toEqual(
      Array.from({ length: updateCount }, (_, index) => index + 1)
    )
  })

  it('does not commit, run guards, or notify for an unchanged recipe', async () => {
    const store = await makeStore()
    const before = store.getSnapshot()
    let guardRuns = 0
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    const result = await Effect.runPromise(
      store.update(() => undefined, {
        guard: () =>
          Effect.sync(() => {
            guardRuns += 1
          }),
      })
    )
    unsubscribe()

    expect(result).toEqual({
      _tag: 'NoChange',
      revision: 0,
      snapshot: before,
    })
    if (result._tag !== 'NoChange')
      throw new Error('expected a no-change result')
    expect(result.snapshot).toBe(before)
    expect(store.getSnapshot()).toBe(before)
    expect(store.getRevision()).toBe(0)
    expect(guardRuns).toBe(0)
    expect(notifications).toBe(0)
  })

  it('publishes the exact committed envelope atomically to the commit stream', async () => {
    const store = await makeStore()

    const [result, events] = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            store.commits.pipe(Stream.take(1), Stream.runCollect),
            { startImmediately: true }
          )
          yield* Effect.yieldNow
          const result = yield* store.update((tree) => {
            tree.counter = 1
          })
          const events = yield* Fiber.join(fiber)
          return [result, events] as const
        })
      )
    )

    const commit = committed(result)
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(commit)
    expect(events[0]).toMatchObject({
      revisionBefore: 0,
      revisionAfter: 1,
      before: { counter: 0 },
      after: { counter: 1 },
    })
    expect(store.getSnapshot()).toBe(commit.after)
    expect(store.getRevision()).toBe(commit.revisionAfter)
  })

  it('rejects a guarded proposal without changing state or publishing', async () => {
    const store = await makeStore()
    const before = store.getSnapshot()
    const observed: Array<ChangeEnvelope<typeof RuntimeSchema>> = []
    let proposedAfter: RuntimeState | undefined
    const unsubscribe = store.subscribe((commit) => observed.push(commit))

    const exit = await Effect.runPromise(
      Effect.exit(
        store.update(
          (tree) => {
            tree.counter = 1
          },
          {
            guard: (proposal) => {
              proposedAfter = proposal.after
              return Effect.fail('rejected' as const)
            },
          }
        )
      )
    )
    unsubscribe()

    expect(Exit.isFailure(exit)).toBe(true)
    expect(proposedAfter?.counter).toBe(1)
    expect(store.getSnapshot()).toBe(before)
    expect(store.getRevision()).toBe(0)
    expect(observed).toEqual([])
  })

  it('merges CurrentCommitContext and lets explicit options override inherited fields', async () => {
    const store = await makeStore()
    const metadata = { request: 'request-1' }
    const source = { adapter: 'test' }

    const result = await Effect.runPromise(
      withCommitContext(
        withCommitContext(
          store.update(
            (tree) => {
              tree.counter = 1
            },
            { tags: ['direct'], label: 'explicit' }
          ),
          { tags: ['inner'], metadata }
        ),
        { tags: ['outer'], label: 'inherited', source }
      )
    )

    const commit = committed(result)
    expect([...commit.tags].sort()).toEqual(['direct', 'inner', 'outer'])
    expect(commit.label).toBe('explicit')
    expect(commit.metadata).toEqual(metadata)
    expect(commit.metadata).not.toBe(metadata)
    expect(commit.source).toBe(source)
  })

  it('filters selector notifications by paths and selected-value equality', async () => {
    const store = await makeStore()
    let evaluations = 0
    let notifications = 0
    const view = store.select(
      (snapshot) => {
        evaluations += 1
        return { value: snapshot.left.value }
      },
      {
        paths: [['left']],
        equals: (left, right) => left.value === right.value,
      }
    )

    expect(view.getSnapshot()).toEqual({ value: 0 })
    const unsubscribe = view.subscribe(() => {
      notifications += 1
    })

    await Effect.runPromise(
      store.update((tree) => {
        tree.right.value += 1
      })
    )
    expect(evaluations).toBe(1)
    expect(notifications).toBe(0)

    await Effect.runPromise(
      store.update((tree) => {
        tree.left.other += 1
      })
    )
    expect(evaluations).toBe(2)
    expect(notifications).toBe(0)

    await Effect.runPromise(
      store.update((tree) => {
        tree.left.value += 1
      })
    )
    expect(evaluations).toBe(3)
    expect(notifications).toBe(1)
    expect(view.getSnapshot()).toEqual({ value: 1 })
    expect(evaluations).toBe(3)

    unsubscribe()
  })

  it('delivers committed changes to post-commit sinks', async () => {
    const store = await makeStore()
    const seen: Array<ChangeEnvelope<typeof RuntimeSchema>> = []

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const delivered = yield* Deferred.make<void>()
          const sinkFiber = yield* Effect.forkChild(
            runCommitSink(store, (commit) =>
              Effect.gen(function* () {
                yield* Effect.sync(() => seen.push(commit))
                yield* Deferred.succeed(delivered, undefined)
              })
            ),
            { startImmediately: true }
          )
          yield* Effect.yieldNow

          const result = yield* store.update((tree) => {
            tree.counter = 1
          })
          yield* Deferred.await(delivered)
          yield* Fiber.interrupt(sinkFiber)
          return result
        })
      )
    )

    const commit = committed(result)
    expect(seen).toEqual([commit])
  })

  it('isolates throwing synchronous listeners after an irreversible commit', async () => {
    const listenerErrors: Array<unknown> = []
    const store = await Effect.runPromise(
      makeTreeStore(runtimeSpec, makeInitial(), {
        onListenerError: (error) => listenerErrors.push(error),
      })
    )
    const observed: Array<number> = []
    store.subscribe(() => {
      throw new Error('listener failed')
    })
    store.subscribe((commit) => observed.push(commit.revisionAfter))

    const result = await Effect.runPromise(
      store.update((state) => {
        state.counter = 1
      })
    )

    expect(result._tag).toBe('Committed')
    expect(store.getSnapshot().counter).toBe(1)
    expect(observed).toEqual([1])
    expect(listenerErrors).toHaveLength(1)
  })

  it('drains reentrant synchronous commits without reordering listeners', async () => {
    const store = await makeStore()
    const first: Array<number> = []
    const second: Array<number> = []

    store.subscribe((commit) => {
      first.push(commit.revisionAfter)
      if (commit.revisionAfter === 1) {
        Effect.runSync(
          store.update((state) => {
            state.counter = 2
          })
        )
      }
    })
    store.subscribe((commit) => second.push(commit.revisionAfter))

    await Effect.runPromise(
      store.update((state) => {
        state.counter = 1
      })
    )

    expect(store.getSnapshot().counter).toBe(2)
    expect(first).toEqual([1, 2])
    expect(second).toEqual([1, 2])
  })

  it('gives StoreView subscriptions and streams identical filtering semantics', async () => {
    const store = await makeStore()
    const view = store.select((state) => state.left.value, {
      paths: [['left']],
    })
    let callbacks = 0
    const unsubscribe = view.subscribe(() => {
      callbacks += 1
    })

    const streamed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(view.changes, 2)),
            { startImmediately: true }
          )
          yield* Effect.yieldNow
          yield* store.update((state) => {
            state.right.value += 1
          })
          yield* store.update((state) => {
            state.left.other += 1
          })
          yield* store.update((state) => {
            state.left.value += 1
          })
          return yield* Fiber.join(fiber)
        })
      )
    )

    unsubscribe()
    expect(streamed).toEqual([0, 1])
    expect(callbacks).toBe(1)
  })

  it('captures immutable commit data before notifying listeners', async () => {
    const store = await makeStore()
    const metadata = { nested: { value: 1 } }
    let observedValue = 0

    store.subscribe((commit) => {
      expect(Object.isFrozen(commit)).toBe(true)
      expect(Object.isFrozen(commit.touchedPaths)).toBe(true)
      expect(Object.isFrozen(commit.change.patches.forward)).toBe(true)
      expect(HashSet.has(commit.tags, 'immutable')).toBe(true)
      if (
        typeof commit.metadata === 'object' &&
        commit.metadata !== null &&
        'nested' in commit.metadata &&
        typeof commit.metadata.nested === 'object' &&
        commit.metadata.nested !== null
      ) {
        expect(Object.isFrozen(commit.metadata.nested)).toBe(true)
        Reflect.set(commit.metadata.nested, 'value', 99)
      }
    })
    store.subscribe((commit) => {
      if (
        typeof commit.metadata === 'object' &&
        commit.metadata !== null &&
        'nested' in commit.metadata &&
        typeof commit.metadata.nested === 'object' &&
        commit.metadata.nested !== null &&
        'value' in commit.metadata.nested &&
        typeof commit.metadata.nested.value === 'number'
      )
        observedValue = commit.metadata.nested.value
    })

    await Effect.runPromise(
      store.update(
        (state) => {
          state.counter = 1
        },
        {
          metadata,
          tags: ['immutable'],
        }
      )
    )
    metadata.nested.value = 7

    expect(observedValue).toBe(1)
  })

  it('captures typed-array metadata without failing the committed update', async () => {
    const store = await makeStore()
    const result = await Effect.runPromise(
      store.update(
        (state) => {
          state.counter = 1
        },
        { metadata: { vector: new Uint8Array([1, 2, 3]) } }
      )
    )
    const metadata = committed(result).metadata

    expect(metadata).toEqual({ vector: [1, 2, 3] })
    expect(
      typeof metadata === 'object' &&
        metadata !== null &&
        'vector' in metadata &&
        Object.isFrozen(metadata.vector)
    ).toBe(true)
  })

  it('uses only explicitly registered atomic interpreters for metadata', async () => {
    const spec = makeTreeSpec(RuntimeSchema, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const store = await Effect.runPromise(makeTreeStore(spec, makeInitial()))
    const when = new Date('2026-07-10T12:00:00.000Z')
    const result = await Effect.runPromise(
      store.update(
        (state) => {
          state.counter = 1
        },
        { metadata: { when } }
      )
    )
    when.setUTCFullYear(2030)

    const metadata = committed(result).metadata
    const capturedWhen =
      typeof metadata === 'object' && metadata !== null && 'when' in metadata
        ? metadata.when
        : undefined
    if (!(capturedWhen instanceof Date)) throw new Error('Expected Date')
    expect(capturedWhen.toISOString()).toBe('2026-07-10T12:00:00.000Z')
    expect(() => capturedWhen.setTime(0)).toThrow(TypeError)
  })

  it('does not commit an update that replaces an atomic value with an equivalent value', async () => {
    const DatedState = Schema.Struct({ when: Schema.Date })
    const spec = makeTreeSpec(DatedState, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const store = await Effect.runPromise(
      makeTreeStore(spec, {
        when: new Date('2026-07-10T12:00:00.000Z'),
      })
    )
    const before = store.getSnapshot()

    const result = await Effect.runPromise(
      store.update((state) => {
        state.when = new Date('2026-07-10T12:00:00.000Z')
      })
    )

    expect(result._tag).toBe('NoChange')
    expect(store.getRevision()).toBe(0)
    expect(store.getSnapshot()).toBe(before)
  })

  it('uses an injectable transaction id service at commit execution', async () => {
    const store = await makeStore()
    const result = await Effect.runPromise(
      store
        .update((state) => {
          state.counter = 1
        })
        .pipe(
          Effect.provideService(
            TransactionIds,
            transactionIdsFrom(() => 'deterministic-transaction')
          )
        )
    )

    expect(committed(result).transactionId).toBe('deterministic-transaction')
  })

  it('closes a scoped store and rejects later commits', async () => {
    const store = await Effect.runPromise(
      Effect.scoped(makeTreeStoreScoped(runtimeSpec, makeInitial()))
    )

    expect(await Effect.runPromise(store.isShutdown)).toBe(true)
    const exit = await Effect.runPromiseExit(
      store.update((state) => {
        state.counter = 1
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(
        exit.cause.reasons.some(
          (reason) =>
            reason._tag === 'Fail' &&
            reason.error._tag === 'TreeStoreShutdownError'
        )
      ).toBe(true)
    }
  })

  it('derives scoped Layers and context-resolved semantic actions', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* actionDefinition.service
          const counterResult = yield* addToCounter(3)
          const itemResult = yield* appendItem('first')
          return {
            snapshot: store.getSnapshot(),
            counterResult,
            itemResult,
          }
        }).pipe(
          Effect.provide(
            actionDefinition.layer({
              counter: 0,
              items: [],
            })
          )
        )
      )
    )

    expect(result.snapshot).toEqual({
      counter: 3,
      items: ['first'],
    })
    expect(committed(result.counterResult).label).toBe('Add 3')
    const itemCommit = committed(result.itemResult)
    expect(itemCommit.change.operations).toHaveLength(1)
    expect(itemCommit.change.operations[0]).toMatchObject({
      _tag: 'ArraySplice',
      path: ['items'],
      index: 0,
      deleteCount: 0,
      inserted: ['first'],
    })
  })

  it('keeps async action metadata across commits separated by an await', async () => {
    const commits = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* actionDefinition.service
          const observed: Array<ChangeEnvelope<typeof ActionSchema>> = []
          store.subscribe((commit) => observed.push(commit))
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const fiber = yield* Effect.forkChild(
            asynchronousAction({ started, release })
          )
          yield* Deferred.await(started)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(fiber)
          return observed
        }).pipe(
          Effect.provide(
            actionDefinition.layer({
              counter: 0,
              items: [],
            })
          )
        )
      )
    )

    expect(commits).toHaveLength(2)
    expect(commits[0]?.action?.name).toBe('Action.asynchronous')
    expect(commits[1]?.action).toEqual(commits[0]?.action)
  })

  it('uses ordinary Effect interruption semantics for async actions', async () => {
    const snapshot = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* actionDefinition.service
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const fiber = yield* Effect.forkChild(
            asynchronousAction({ started, release })
          )
          yield* Deferred.await(started)
          yield* Fiber.interrupt(fiber)
          return store.getSnapshot()
        }).pipe(
          Effect.provide(
            actionDefinition.layer({
              counter: 0,
              items: [],
            })
          )
        )
      )
    )

    expect(snapshot).toEqual({ counter: 1, items: [] })
  })
})
