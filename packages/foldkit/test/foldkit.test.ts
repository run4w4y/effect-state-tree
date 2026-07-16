import { describe, expect, it } from 'bun:test'
import { diffPatchSet, makeTreeSpec } from '@effect-state-tree/core'
import { Result, Schema } from 'effect'
import {
  externalTreeChange,
  makeFoldkitSubmodel,
  makeFoldkitTree,
} from '../src/index'

const State = Schema.Struct({ count: Schema.Number })
const spec = makeTreeSpec(State)

const context = (transactionId: string, committedAt = 1) => ({
  transactionId,
  committedAt,
})

describe('Foldkit-compatible pure reducer', () => {
  it('keeps the canonical tree in the model and returns commands and OutMessages', () => {
    const feature = makeFoldkitTree({
      spec,
      initial: { count: 0 },
      plugin: 0,
      reducer: {
        initial: 0,
        reduce: (state) => ({
          state: state + 1,
          commands: ['persist'],
          outMessages: ['changed'],
        }),
      },
    })
    expect(Result.isSuccess(feature)).toBe(true)
    if (Result.isFailure(feature)) return
    const changed = diffPatchSet({ count: 0 }, { count: 1 })
    expect(Result.isSuccess(changed)).toBe(true)
    if (Result.isFailure(changed)) return

    const result = feature.success.update(feature.success.initial, {
      _tag: 'TreeChange',
      change: {
        patches: changed.success.patchSet,
        operations: [],
        inverseOperations: [],
      },
      context: context('message-1'),
    })
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result) || result.success._tag !== 'Committed') return
    expect(result.success.state).toEqual({
      tree: { count: 1 },
      revision: 1,
      plugin: 1,
    })
    expect(result.success.commands).toEqual(['persist'])
    expect(result.success.outMessages).toEqual(['changed'])
    expect(result.success.commit.transactionId).toBe('message-1')
  })

  it('is referentially transparent and does not create revisions for no-ops', () => {
    const feature = makeFoldkitTree({
      spec,
      initial: { count: 0 },
      plugin: undefined,
    })
    if (Result.isFailure(feature)) throw feature.failure
    const message = {
      _tag: 'TreeSnapshot' as const,
      snapshot: { count: 0 },
      context: context('same', 10),
    }

    const first = feature.success.update(feature.success.initial, message)
    const second = feature.success.update(feature.success.initial, message)
    expect(first).toEqual(second)
    if (Result.isFailure(first)) throw first.failure
    expect(first.success).toEqual({
      _tag: 'NoChange',
      state: feature.success.initial,
      commands: [],
      outMessages: [],
    })
    expect(first.success.state).toBe(feature.success.initial)
  })

  it('admits and freezes the initial model through the tree kernel', () => {
    const initial = { count: 0 }
    const feature = makeFoldkitTree({ spec, initial, plugin: undefined })
    expect(Result.isSuccess(feature)).toBe(true)
    if (Result.isFailure(feature)) return

    initial.count = 2
    expect(feature.success.initial.tree.count).toBe(0)
    expect(Object.isFrozen(feature.success.initial.tree)).toBe(true)
  })

  it('represents external resources as messages and composes as a submodel', () => {
    const feature = makeFoldkitTree({
      spec,
      initial: { count: 0 },
      plugin: 0,
      reducer: {
        initial: 0,
        reduce: (state) => ({
          state: state + 1,
          commands: ['sync'],
          outMessages: ['tree-changed'],
        }),
      },
    })
    if (Result.isFailure(feature)) throw feature.failure
    const changed = diffPatchSet({ count: 0 }, { count: 2 })
    if (Result.isFailure(changed)) throw changed.failure

    const submodel = makeFoldkitSubmodel(feature.success, {
      get: (parent: { tree: typeof feature.success.initial; name: string }) =>
        parent.tree,
      set: (parent, tree) => ({ ...parent, tree }),
      mapCommand: (command) => `parent:${command}`,
      mapOutMessage: (message) => `parent:${message}`,
    })
    const parent = { tree: feature.success.initial, name: 'app' }
    const result = submodel.update(
      parent,
      externalTreeChange(
        {
          patches: changed.success.patchSet,
          operations: [],
          inverseOperations: [],
        },
        { ...context('remote'), source: 'peer-a' }
      )
    )

    if (Result.isFailure(result)) throw result.failure
    expect(result.success.parent.tree.tree.count).toBe(2)
    expect(result.success.commands).toEqual(['parent:sync'])
    expect(result.success.outMessages).toEqual(['parent:tree-changed'])
    expect(result.success.commit?.direction).toBe('external')
  })
})
