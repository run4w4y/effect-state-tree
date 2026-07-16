import { describe, expect, it } from 'bun:test'
import {
  collaborativeText,
  dateAtomicInterpreter,
  entity,
  makeTreeSpec,
  type TreeValue,
} from '@effect-state-tree/core'
import { bindCrdt, movableList } from '@effect-state-tree/crdt'
import type { ChangeEnvelope, CommitResult } from '@effect-state-tree/runtime'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Queue, Schema } from 'effect'
import {
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
} from 'loro-crdt'
import { makeLoroAdapter } from '../src/index'

const Item = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
}).pipe(entity({ type: 'Item', id: 'id' }))

const State = Schema.Struct({
  count: Schema.NumberFromString,
  title: Schema.String,
  profile: Schema.Struct({ active: Schema.Boolean }),
  items: Schema.Array(Item).pipe(movableList),
  tags: Schema.Array(Schema.String),
  numbers: Schema.Array(Schema.NumberFromString),
  text: Schema.String.pipe(collaborativeText),
  meta: Schema.Record(Schema.String, Schema.String),
})

type StateValue = TreeValue<typeof State>

const spec = makeTreeSpec(State)

const initial = (): StateValue => ({
  count: 1,
  title: 'initial',
  profile: { active: true },
  items: [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ],
  tags: ['one', 'two', 'three'],
  numbers: [1, 2],
  text: 'abcd',
  meta: { old: 'remove me' },
})

const committed = (
  result: CommitResult<typeof State>
): ChangeEnvelope<typeof State> => {
  expect(result._tag).toBe('Committed')
  if (result._tag !== 'Committed')
    throw new Error('expected a committed result')
  return result.commit
}

describe('Loro CRDT adapter', () => {
  it('materializes native Date values through the canonical JSON codec', async () => {
    const Dated = Schema.Struct({ when: Schema.Date })
    const datedSpec = makeTreeSpec(Dated, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const adapter = makeLoroAdapter(datedSpec, { doc: new LoroDoc() })

    await Effect.runPromise(
      adapter.writeSnapshot({
        when: new Date('2026-07-10T12:00:00.000Z'),
      })
    )

    expect(adapter.root.get('when')).toBe('2026-07-10T12:00:00.000Z')
    const decoded = await Effect.runPromise(adapter.readSnapshot)
    expect(decoded.when).toBeInstanceOf(Date)
    expect(decoded.when.toISOString()).toBe('2026-07-10T12:00:00.000Z')
  })

  it('round-trips initial state through the Effect Schema JSON codec and native containers', async () => {
    const doc = new LoroDoc()
    const adapter = makeLoroAdapter(spec, {
      doc,
      rootName: 'app',
    })

    await Effect.runPromise(adapter.writeSnapshot(initial()))

    expect(adapter.root.get('count')).toBe('1')
    expect(adapter.root.get('profile')).toBeInstanceOf(LoroMap)
    expect(adapter.root.get('tags')).toBeInstanceOf(LoroList)
    expect(adapter.root.get('items')).toBeInstanceOf(LoroMovableList)
    expect(adapter.root.get('text')).toBeInstanceOf(LoroText)
    expect(await Effect.runPromise(adapter.readSnapshot)).toEqual(initial())

    const initialized = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, {
            ...initial(),
            count: 99,
          })
          yield* bindCrdt(store, adapter, { initialize: 'backend' })
          return store.getSnapshot()
        })
      )
    )

    expect(initialized).toEqual(initial())
  })

  it('lowers every semantic operation and preserves patch-only fallback in one Loro commit', async () => {
    const doc = new LoroDoc()
    const adapter = makeLoroAdapter(spec, {
      doc,
      origin: 'effect-state-tree-test',
    })
    const store = await Effect.runPromise(makeTreeStore(spec, initial()))
    await Effect.runPromise(adapter.writeSnapshot(initial()))

    let transactions = 0
    const unsubscribe = doc.subscribe((event) => {
      if (event.origin === adapter.origin) transactions += 1
    })

    const object = committed(
      await Effect.runPromise(
        store.update((state, operations) => {
          operations.objectSet(['meta'], 'new', 'kept')
          operations.objectDelete(['meta'], 'old')
          state.title = 'mixed-direct-mutation'
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(object))
    expect(adapter.root.get('title')).toBe('mixed-direct-mutation')

    const splice = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.arraySplice(['tags'], 1, 1, 'x', 'y')
          operations.arraySplice(['numbers'], 1, 0, 7)
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(splice))

    const text = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.textInsert(['text'], 2, 'XY')
          operations.textDelete(['text'], 0, 1)
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(text))

    // No semantic operation covers this direct producer mutation. The encoded
    // snapshot reconciliation in the same commit is the correctness fallback.
    const fallback = committed(
      await Effect.runPromise(
        store.update((state) => {
          state.title = 'patch-only'
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(fallback))
    unsubscribe()

    expect(await Effect.runPromise(adapter.readSnapshot)).toEqual(
      store.getSnapshot()
    )
    expect(adapter.root.get('title')).toBe('patch-only')
    expect(adapter.root.get('numbers')).toBeInstanceOf(LoroList)
    expect((adapter.root.get('numbers') as LoroList).toJSON()).toEqual([
      '1',
      '7',
      '2',
    ])
    expect(transactions).toBe(4)
  })

  it("uses Loro's native movable-list operation for ArrayMove", async () => {
    const doc = new LoroDoc()
    const adapter = makeLoroAdapter(spec, {
      doc,
    })
    const store = await Effect.runPromise(makeTreeStore(spec, initial()))
    await Effect.runPromise(adapter.writeSnapshot(initial()))

    const move = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.arrayMove(['items'], 0, 2)
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(move))

    expect(adapter.root.get('items')).toBeInstanceOf(LoroMovableList)
    expect(adapter.root.toJSON()).toMatchObject({
      items: [
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
        { id: 'a', title: 'A' },
      ],
    })

    const history = JSON.stringify(doc.exportJsonUpdates())
    expect(history).toContain('"type":"move"')
  })

  it('applies inbound snapshots without echoing them to the same Loro document', async () => {
    const doc = new LoroDoc()
    const adapter = makeLoroAdapter(spec, {
      doc,
    })
    await Effect.runPromise(adapter.writeSnapshot(initial()))

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeTreeStore(spec, initial())
          yield* bindCrdt(store, adapter, { initialize: 'none' })
          const updates = yield* Queue.unbounded<number>()
          const unsubscribeStore = store.subscribe((commit) => {
            Queue.offerUnsafe(updates, commit.after.count)
          })

          let outboundEchoes = 0
          const unsubscribe = doc.subscribe((event) => {
            if (event.origin === adapter.origin) outboundEchoes += 1
          })

          adapter.root.set('count', '7')
          doc.commit({ origin: 'external-peer' })

          const count = yield* Queue.take(updates)
          unsubscribe()
          unsubscribeStore()

          return {
            snapshot: store.getSnapshot(),
            count,
            outboundEchoes,
          }
        })
      )
    )

    expect(result.snapshot.count).toBe(7)
    expect(result.count).toBe(7)
    expect(result.outboundEchoes).toBe(0)
  })

  it('converges a native move with a concurrent property edit on the moved entity', async () => {
    const docA = new LoroDoc()
    const docB = new LoroDoc()
    const adapterA = makeLoroAdapter(spec, {
      doc: docA,
    })
    const adapterB = makeLoroAdapter(spec, {
      doc: docB,
    })

    await Effect.runPromise(adapterA.writeSnapshot(initial()))
    docB.import(docA.export({ mode: 'snapshot' }))

    const storeA = await Effect.runPromise(makeTreeStore(spec, initial()))
    const storeB = await Effect.runPromise(makeTreeStore(spec, initial()))

    const move = committed(
      await Effect.runPromise(
        storeA.update((_state, operations) => {
          operations.arrayMove(['items'], 0, 2)
        })
      )
    )
    const edit = committed(
      await Effect.runPromise(
        storeB.update((_state, operations) => {
          operations.objectSet(['items', 0], 'title', 'A edited')
        })
      )
    )

    await Effect.runPromise(adapterA.applyCommit(move))
    await Effect.runPromise(adapterB.applyCommit(edit))

    const updateA = docA.export({ mode: 'update' })
    const updateB = docB.export({ mode: 'update' })
    docA.import(updateB)
    docB.import(updateA)

    const expected = {
      ...initial(),
      items: [
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
        { id: 'a', title: 'A edited' },
      ],
    }
    expect(await Effect.runPromise(adapterA.readSnapshot)).toEqual(expected)
    expect(await Effect.runPromise(adapterB.readSnapshot)).toEqual(expected)
    expect(docA.toJSON()).toEqual(docB.toJSON())
  })

  it('uses a unique source and returns a typed error for a non-object encoded root', async () => {
    const first = makeLoroAdapter(spec, { doc: new LoroDoc() })
    const second = makeLoroAdapter(spec, { doc: new LoroDoc() })
    expect(first.source).not.toBe(second.source)
    expect(first.origin).not.toBe(second.origin)

    const ArrayState = Schema.Array(Schema.Number)
    const arrayAdapter = makeLoroAdapter(makeTreeSpec(ArrayState), {
      doc: new LoroDoc(),
    })
    const exit = await Effect.runPromiseExit(
      arrayAdapter.writeSnapshot([1, 2, 3])
    )
    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') throw new Error('expected write failure')
    expect(String(exit.cause)).toContain('LoroRootTypeError')
  })

  it('undoes only the current peer and preserves imported remote edits', async () => {
    const doc = new LoroDoc()
    const adapter = makeLoroAdapter(spec, { doc })
    const store = await Effect.runPromise(makeTreeStore(spec, initial()))
    await Effect.runPromise(adapter.writeSnapshot(initial()))

    const local = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.objectSet(['meta'], 'mine', 'local')
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(local))

    const remote = new LoroDoc()
    remote.import(doc.export({ mode: 'snapshot' }))
    remote.getMap('root').set('title', 'remote title')
    remote.commit({ origin: 'remote-peer' })
    doc.import(remote.export({ mode: 'update' }))

    expect(await Effect.runPromise(adapter.undo.canUndo)).toBe(true)
    expect(await Effect.runPromise(adapter.undo.undo)).toBe(true)
    const undone = await Effect.runPromise(adapter.readSnapshot)
    expect(undone.title).toBe('remote title')
    expect(undone.meta).toEqual({ old: 'remove me' })
    expect(await Effect.runPromise(adapter.undo.canRedo)).toBe(true)

    expect(await Effect.runPromise(adapter.undo.redo)).toBe(true)
    const redone = await Effect.runPromise(adapter.readSnapshot)
    expect(redone.title).toBe('remote title')
    expect(redone.meta.mine).toBe('local')
    await Effect.runPromise(adapter.undo.clear)
    expect(await Effect.runPromise(adapter.undo.canUndo)).toBe(false)
    await Effect.runPromise(adapter.undo.dispose)
  })
})
