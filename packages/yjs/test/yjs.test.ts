import { describe, expect, it } from 'bun:test'
import {
  collaborativeText,
  dateAtomicInterpreter,
  makeTreeSpec,
  type TreeValue,
} from '@effect-state-tree/core'
import { bindCrdt } from '@effect-state-tree/crdt'
import type { ChangeEnvelope, CommitResult } from '@effect-state-tree/runtime'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Queue, Schema } from 'effect'
import * as Y from 'yjs'
import { makeYjsAdapter } from '../src/index'

const State = Schema.Struct({
  count: Schema.NumberFromString,
  title: Schema.String,
  items: Schema.Array(Schema.String),
  numbers: Schema.Array(Schema.NumberFromString),
  text: Schema.String.pipe(collaborativeText),
  meta: Schema.Record(Schema.String, Schema.String),
})

type StateValue = TreeValue<typeof State>

const spec = makeTreeSpec(State)

const initial = (): StateValue => ({
  count: 1,
  title: 'initial',
  items: ['a', 'b', 'c', 'd'],
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

describe('Yjs CRDT adapter', () => {
  it('materializes native Date values through the canonical JSON codec', async () => {
    const Dated = Schema.Struct({ when: Schema.Date })
    const datedSpec = makeTreeSpec(Dated, {
      atomicInterpreters: [dateAtomicInterpreter],
    })
    const adapter = makeYjsAdapter(datedSpec, { doc: new Y.Doc() })

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

  it('round-trips initial state through the Effect Schema JSON codec', async () => {
    const doc = new Y.Doc()
    const adapter = makeYjsAdapter(spec, { doc, rootName: 'app' })

    await Effect.runPromise(adapter.writeSnapshot(initial()))

    expect(adapter.root.get('count')).toBe('1')
    expect(adapter.root.get('items')).toBeInstanceOf(Y.Array)
    expect(adapter.root.get('text')).toBeInstanceOf(Y.Text)
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

  it('lowers object operations and patch fallback in one Y transaction per commit', async () => {
    const doc = new Y.Doc()
    const adapter = makeYjsAdapter(spec, { doc })
    const store = await Effect.runPromise(makeTreeStore(spec, initial()))
    await Effect.runPromise(adapter.writeSnapshot(initial()))

    let transactions = 0
    const countTransaction: Parameters<typeof doc.on<'afterTransaction'>>[1] = (
      transaction
    ) => {
      if (transaction.origin === adapter.origin) transactions += 1
    }
    doc.on('afterTransaction', countTransaction)

    const objectCommit = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.objectSet(['meta'], 'new', 'kept')
          operations.objectDelete(['meta'], 'old')
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(objectCommit))

    const itemsBeforePatch = adapter.root.get('items')
    const mixedCommit = committed(
      await Effect.runPromise(
        store.update((state, operations) => {
          state.title = 'patched'
          operations.objectSet(['meta'], 'also', 'kept too')
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(mixedCommit))
    doc.off('afterTransaction', countTransaction)

    const meta = adapter.root.get('meta')
    expect(meta).toBeInstanceOf(Y.Map)
    if (!(meta instanceof Y.Map)) throw new Error('expected Y.Map metadata')
    expect(meta.toJSON()).toEqual({ new: 'kept', also: 'kept too' })
    expect(adapter.root.get('title')).toBe('patched')
    expect(adapter.root.get('items')).toBe(itemsBeforePatch)
    expect(transactions).toBe(2)
  })

  it('applies inbound snapshots without echoing them to the same document', async () => {
    const doc = new Y.Doc()
    const adapter = makeYjsAdapter(spec, { doc })
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
          const countEcho: Parameters<typeof doc.on<'afterTransaction'>>[1] = (
            transaction
          ) => {
            if (transaction.origin === adapter.origin) outboundEchoes += 1
          }
          doc.on('afterTransaction', countEcho)

          doc.transact(
            () => {
              adapter.root.set('count', '7')
            },
            { remote: true }
          )

          const count = yield* Queue.take(updates)
          doc.off('afterTransaction', countEcho)
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

  it('keeps two bound stores convergent across repeated provider updates', async () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const leftAdapter = makeYjsAdapter(spec, { doc: leftDoc })
    await Effect.runPromise(leftAdapter.writeSnapshot(initial()))
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc), {
      bootstrap: true,
    })
    const rightAdapter = makeYjsAdapter(spec, { doc: rightDoc })
    const fromLeft = { peer: 'left' }
    const fromRight = { peer: 'right' }
    const sendLeft: Parameters<typeof leftDoc.on<'update'>>[1] = (
      update,
      origin
    ) => {
      if (origin !== fromRight) Y.applyUpdate(rightDoc, update, fromLeft)
    }
    const sendRight: Parameters<typeof rightDoc.on<'update'>>[1] = (
      update,
      origin
    ) => {
      if (origin !== fromLeft) Y.applyUpdate(leftDoc, update, fromRight)
    }
    leftDoc.on('update', sendLeft)
    rightDoc.on('update', sendRight)

    const snapshots = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const leftStore = yield* makeTreeStore(spec, initial())
          const rightStore = yield* makeTreeStore(spec, initial())
          const leftBinding = yield* bindCrdt(leftStore, leftAdapter, {
            initialize: 'backend',
          })
          const rightBinding = yield* bindCrdt(rightStore, rightAdapter, {
            initialize: 'backend',
          })

          for (let value = 1; value <= 40; value += 1) {
            const store = value % 2 === 0 ? leftStore : rightStore
            yield* store.update((state) => {
              state.count = value
              state.title = `revision-${value.toString()}`
            })
            yield* leftBinding.idle
            yield* rightBinding.idle
          }

          return {
            left: leftStore.getSnapshot(),
            right: rightStore.getSnapshot(),
            leftDocument: yield* leftAdapter.readSnapshot,
            rightDocument: yield* rightAdapter.readSnapshot,
          }
        })
      )
    )
    leftDoc.off('update', sendLeft)
    rightDoc.off('update', sendRight)

    expect(snapshots.left).toEqual(snapshots.right)
    expect(snapshots.leftDocument).toEqual(snapshots.rightDocument)
    expect(snapshots.left.count).toBe(40)
    expect(snapshots.left.title).toBe('revision-40')
  })

  it('lowers array splice/move and collaborative text operations', async () => {
    const doc = new Y.Doc()
    const adapter = makeYjsAdapter(spec, { doc })
    const store = await Effect.runPromise(makeTreeStore(spec, initial()))
    await Effect.runPromise(adapter.writeSnapshot(initial()))

    let transactions = 0
    const countTransaction: Parameters<typeof doc.on<'afterTransaction'>>[1] = (
      transaction
    ) => {
      if (transaction.origin === adapter.origin) transactions += 1
    }
    doc.on('afterTransaction', countTransaction)

    const splice = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.arraySplice(['items'], 1, 1, 'x', 'y')
          operations.arraySplice(['numbers'], 1, 0, 7)
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(splice))

    const move = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.arrayMove(['items'], 0, 3, 1)
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(move))

    const text = committed(
      await Effect.runPromise(
        store.update((_state, operations) => {
          operations.textInsert(['text'], 2, 'XY')
          operations.textDelete(['text'], 0, 1)
        })
      )
    )
    await Effect.runPromise(adapter.applyCommit(text))
    doc.off('afterTransaction', countTransaction)

    const items = adapter.root.get('items')
    const numbers = adapter.root.get('numbers')
    const sharedText = adapter.root.get('text')
    expect(items).toBeInstanceOf(Y.Array)
    expect(numbers).toBeInstanceOf(Y.Array)
    expect(sharedText).toBeInstanceOf(Y.Text)
    if (!(items instanceof Y.Array) || !(sharedText instanceof Y.Text)) {
      throw new Error('expected Yjs array and text values')
    }
    expect(items.toJSON()).toEqual(Array.from(store.getSnapshot().items))
    expect(numbers instanceof Y.Array ? numbers.toJSON() : undefined).toEqual([
      '1',
      '7',
      '2',
    ])
    expect(sharedText.toString()).toBe(store.getSnapshot().text)
    expect(await Effect.runPromise(adapter.readSnapshot)).toEqual(
      store.getSnapshot()
    )
    expect(transactions).toBe(3)
  })

  it('returns a typed error when the encoded root is not an object', async () => {
    const ArrayState = Schema.Array(Schema.Number)
    const arrayAdapter = makeYjsAdapter(makeTreeSpec(ArrayState), {
      doc: new Y.Doc(),
    })

    const exit = await Effect.runPromiseExit(
      arrayAdapter.writeSnapshot([1, 2, 3])
    )
    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') throw new Error('expected write failure')
    expect(String(exit.cause)).toContain('YjsRootError')
  })

  it('undoes only this adapter origin and preserves concurrent remote edits', async () => {
    const doc = new Y.Doc()
    const adapter = makeYjsAdapter(spec, { doc })
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

    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    const remoteVector = Y.encodeStateVector(doc)
    remote.getMap('root').set('title', 'remote title')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, remoteVector), {
      peer: 'remote',
    })

    expect(await Effect.runPromise(adapter.undo.canUndo)).toBe(true)
    expect(await Effect.runPromise(adapter.undo.undo)).toBe(true)
    expect(adapter.root.get('title')).toBe('remote title')
    expect((adapter.root.get('meta') as Y.Map<string>).has('mine')).toBe(false)
    expect(await Effect.runPromise(adapter.undo.canRedo)).toBe(true)

    expect(await Effect.runPromise(adapter.undo.redo)).toBe(true)
    expect((adapter.root.get('meta') as Y.Map<string>).get('mine')).toBe(
      'local'
    )
    expect(adapter.root.get('title')).toBe('remote title')
    await Effect.runPromise(adapter.undo.clear)
    expect(await Effect.runPromise(adapter.undo.canUndo)).toBe(false)
    await Effect.runPromise(adapter.undo.dispose)
  })
})
