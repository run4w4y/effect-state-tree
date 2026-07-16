import {
  CollaborativeTextAnnotationKey,
  deepEqualSnapshot,
  isPathPrefix,
  snapshotOptionsFor,
  type TreePatch,
  type TreePath,
  type TreeSpec,
  type TreeValue,
  treeAnnotationAt,
} from '@effect-state-tree/core'
import {
  type CrdtAdapter,
  type InboundCrdtNotification,
  isJsonObject,
  jsonAtPath,
  pathKey,
  samePath,
} from '@effect-state-tree/crdt'
import {
  produceTreeChange,
  type SemanticOperation,
} from '@effect-state-tree/producer'
import type { ChangeEnvelope, SourceToken } from '@effect-state-tree/runtime'
import { Deferred, Effect, Queue, Result, type Schema, Stream } from 'effect'
import * as Y from 'yjs'
import { decodeRoot, encodeRoot } from './codec'
import { type YjsAdapterError, YjsMutationError } from './errors'
import { makeYjsUndoController, type YjsUndoController } from './undo'

type YPrimitive = null | boolean | number | string
/** Yjs value shapes emitted by the Schema-coded adapter. */
export type YjsValue = YPrimitive | Y.Map<YjsValue> | Y.Array<YjsValue> | Y.Text
type YValue = YjsValue
type YContainer = Y.Map<YValue> | Y.Array<YValue> | Y.Text

interface CapturedNotification {
  readonly vector: Uint8Array
}

type RawObservedDocument = Result.Result<CapturedNotification, YjsMutationError>
type MutationPlan = () => void

/** Document ownership, provenance, and optional text materialization policy. */
export interface MakeYjsAdapterOptions {
  readonly doc: Y.Doc
  readonly rootName?: string
  readonly source?: SourceToken
  /** Extra paths that should be materialized as Y.Text in addition to Schema annotations. */
  readonly collaborativeTexts?: Iterable<TreePath>
}

/** Schema-coded Yjs adapter with peer-local native undo. */
export interface YjsAdapter<S extends Schema.Constraint>
  extends CrdtAdapter<
    S,
    YjsAdapterError,
    S['DecodingServices'] | S['EncodingServices']
  > {
  readonly doc: Y.Doc
  readonly root: Y.Map<YjsValue>
  /** Unique per-adapter Yjs transaction origin used for echo suppression. */
  readonly origin: object
  readonly undo: YjsUndoController
}

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value)

const operationTargetPath = (operation: SemanticOperation): TreePath =>
  operation.path

const operationModifiedPath = (operation: SemanticOperation): TreePath => {
  switch (operation._tag) {
    case 'ObjectSet':
    case 'ObjectDelete':
      return [...operation.path, operation.key]
    default:
      return operation.path
  }
}

/**
 * Pre-resolved plans are unsafe if another operation replaces or reindexes an
 * ancestor of their target. Those commits use the full-snapshot fallback.
 */
const hasUnstableOperationTargets = (
  operations: ReadonlyArray<SemanticOperation>
): boolean => {
  for (let leftIndex = 0; leftIndex < operations.length; leftIndex += 1) {
    const left = operations[leftIndex]
    if (left === undefined) continue
    const modified = operationModifiedPath(left)

    for (let rightIndex = 0; rightIndex < operations.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue
      const right = operations[rightIndex]
      if (right === undefined) continue
      const target = operationTargetPath(right)
      if (samePath(modified, target)) {
        if (left._tag === 'ObjectSet' || left._tag === 'ObjectDelete')
          return true
        if (
          left._tag === 'ArraySplice' &&
          (right._tag === 'ArraySplice' || right._tag === 'ArrayMove')
        ) {
          return true
        }
        continue
      }
      if (isPathPrefix(modified, target)) return true
      if (
        (left._tag === 'ArraySplice' || left._tag === 'ArrayMove') &&
        isPathPrefix(left.path, target) &&
        !samePath(left.path, target)
      ) {
        return true
      }
    }
  }
  return false
}

const resolveYValue = (
  root: Y.Map<YValue>,
  path: TreePath
): YContainer | YPrimitive | undefined => {
  let current: YContainer | YPrimitive = root

  for (const segment of path) {
    if (current instanceof Y.Map && typeof segment === 'string') {
      const next = current.get(segment)
      if (next === undefined) return undefined
      current = next
      continue
    }
    if (
      current instanceof Y.Array &&
      typeof segment === 'number' &&
      Number.isSafeInteger(segment) &&
      segment >= 0 &&
      segment < current.length
    ) {
      current = current.get(segment)
      continue
    }
    return undefined
  }

  return current
}

const sequencePlans =
  (plans: ReadonlyArray<MutationPlan>): MutationPlan =>
  () => {
    for (const plan of plans) plan()
  }

const cloneYValue = (value: YValue): YValue => {
  if (
    value instanceof Y.Map ||
    value instanceof Y.Array ||
    value instanceof Y.Text
  ) {
    return value.clone()
  }
  return value
}

const replaceRoot = (
  root: Y.Map<YValue>,
  value: Schema.JsonObject,
  makeValue: (value: Schema.Json, path: TreePath) => YValue
): void => {
  root.clear()
  for (const [key, child] of Object.entries(value)) {
    root.set(key, makeValue(child, [key]))
  }
}

const makeSemanticPlan = (
  root: Y.Map<YValue>,
  operations: ReadonlyArray<SemanticOperation>,
  encodedAfter: Schema.JsonObject,
  makeValue: (value: Schema.Json, path: TreePath) => YValue
): MutationPlan | undefined => {
  if (operations.length === 0 || hasUnstableOperationTargets(operations))
    return undefined

  const plans: Array<MutationPlan> = []
  const arrayLengths = new Map<Y.Array<YValue>, number>()
  const textLengths = new Map<Y.Text, number>()

  for (const operation of operations) {
    const target = resolveYValue(root, operation.path)

    switch (operation._tag) {
      case 'ObjectSet': {
        if (!(target instanceof Y.Map)) return undefined
        const valuePath = [...operation.path, operation.key]
        const value = jsonAtPath(encodedAfter, valuePath)
        if (value === undefined) return undefined
        const yValue = makeValue(value, valuePath)
        plans.push(() => {
          target.set(operation.key, yValue)
        })
        break
      }

      case 'ObjectDelete': {
        if (!(target instanceof Y.Map)) return undefined
        plans.push(() => {
          target.delete(operation.key)
        })
        break
      }

      case 'ArraySplice': {
        if (!(target instanceof Y.Array)) return undefined
        const length = arrayLengths.get(target) ?? target.length
        if (
          operation.index < 0 ||
          operation.index > length ||
          operation.deleteCount < 0 ||
          operation.index + operation.deleteCount > length
        ) {
          return undefined
        }
        const encodedArray = jsonAtPath(encodedAfter, operation.path)
        if (!Array.isArray(encodedArray)) return undefined
        const inserted = encodedArray
          .slice(operation.index, operation.index + operation.inserted.length)
          .map((value, offset) =>
            makeValue(value, [...operation.path, operation.index + offset])
          )
        arrayLengths.set(
          target,
          length - operation.deleteCount + inserted.length
        )
        plans.push(() => {
          if (operation.deleteCount > 0)
            target.delete(operation.index, operation.deleteCount)
          if (inserted.length > 0) target.insert(operation.index, inserted)
        })
        break
      }

      case 'ArrayMove': {
        if (!(target instanceof Y.Array)) return undefined
        const length = arrayLengths.get(target) ?? target.length
        if (
          operation.count <= 0 ||
          operation.from < 0 ||
          operation.from + operation.count > length ||
          operation.to < 0 ||
          operation.to > length - operation.count
        ) {
          return undefined
        }
        plans.push(() => {
          const moved = target
            .slice(operation.from, operation.from + operation.count)
            .map(cloneYValue)
          target.delete(operation.from, operation.count)
          target.insert(operation.to, moved)
        })
        break
      }

      case 'TextInsert': {
        if (!(target instanceof Y.Text)) return undefined
        const length = textLengths.get(target) ?? target.length
        if (operation.index < 0 || operation.index > length) return undefined
        textLengths.set(target, length + operation.text.length)
        plans.push(() => {
          target.insert(operation.index, operation.text)
        })
        break
      }

      case 'TextDelete': {
        if (!(target instanceof Y.Text)) return undefined
        const length = textLengths.get(target) ?? target.length
        if (
          operation.index < 0 ||
          operation.index + operation.text.length > length
        ) {
          return undefined
        }
        textLengths.set(target, length - operation.text.length)
        plans.push(() => {
          target.delete(operation.index, operation.text.length)
        })
        break
      }
    }
  }

  return sequencePlans(plans)
}

const semanticOperationsCoverCommit = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  commit: ChangeEnvelope<S>
): boolean => {
  if (commit.change.operations.length === 0) return false
  const replayed = produceTreeChange(
    spec,
    commit.before,
    (_state, recorder) => {
      for (const operation of commit.change.operations) {
        switch (operation._tag) {
          case 'ObjectSet':
            recorder.objectSet(operation.path, operation.key, operation.value)
            break
          case 'ObjectDelete':
            recorder.objectDelete(operation.path, operation.key)
            break
          case 'ArraySplice':
            recorder.arraySplice(
              operation.path,
              operation.index,
              operation.deleteCount,
              ...operation.inserted
            )
            break
          case 'ArrayMove':
            recorder.arrayMove(
              operation.path,
              operation.from,
              operation.to,
              operation.count
            )
            break
          case 'TextInsert':
            recorder.textInsert(operation.path, operation.index, operation.text)
            break
          case 'TextDelete':
            recorder.textDelete(
              operation.path,
              operation.index,
              operation.text.length
            )
            break
        }
      }
    }
  )
  return (
    Result.isSuccess(replayed) &&
    deepEqualSnapshot(
      replayed.success.snapshot,
      commit.after,
      snapshotOptionsFor(spec)
    )
  )
}

const patchModifiedPath = (patch: TreePatch): TreePath => patch.path

const hasUnstablePatchTargets = (
  patches: ReadonlyArray<TreePatch>
): boolean => {
  for (let leftIndex = 0; leftIndex < patches.length; leftIndex += 1) {
    const left = patches[leftIndex]
    if (left === undefined) continue
    const modified = patchModifiedPath(left)
    for (let rightIndex = 0; rightIndex < patches.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue
      const right = patches[rightIndex]
      if (right === undefined) continue
      const parent = right.path.slice(0, -1)
      if (samePath(modified, parent)) return true
      if (isPathPrefix(modified, parent)) return true
    }
  }
  return false
}

const makePatchPlan = (
  root: Y.Map<YValue>,
  patches: ReadonlyArray<TreePatch>,
  encodedAfter: Schema.JsonObject,
  makeValue: (value: Schema.Json, path: TreePath) => YValue
): MutationPlan | undefined => {
  if (patches.length === 0 || hasUnstablePatchTargets(patches)) return undefined

  const plans: Array<MutationPlan> = []
  const arrayLengths = new Map<Y.Array<YValue>, number>()

  for (const patch of patches) {
    if (patch.path.length === 0) return undefined
    const parentPath = patch.path.slice(0, -1)
    const segment = patch.path[patch.path.length - 1]
    const parent = resolveYValue(root, parentPath)

    if (parent instanceof Y.Map && typeof segment === 'string') {
      if (patch.op === 'remove') {
        plans.push(() => {
          parent.delete(segment)
        })
      } else {
        const value = jsonAtPath(encodedAfter, patch.path)
        if (value === undefined) return undefined
        const yValue = makeValue(value, patch.path)
        plans.push(() => {
          parent.set(segment, yValue)
        })
      }
      continue
    }

    if (
      parent instanceof Y.Array &&
      typeof segment === 'number' &&
      Number.isSafeInteger(segment)
    ) {
      const length = arrayLengths.get(parent) ?? parent.length
      if (patch.op === 'add') {
        if (segment < 0 || segment > length) return undefined
        const value = jsonAtPath(encodedAfter, patch.path)
        if (value === undefined) return undefined
        const yValue = makeValue(value, patch.path)
        arrayLengths.set(parent, length + 1)
        plans.push(() => {
          parent.insert(segment, [yValue])
        })
        continue
      }
      if (segment < 0 || segment >= length) return undefined
      if (patch.op === 'remove') {
        arrayLengths.set(parent, length - 1)
        plans.push(() => {
          parent.delete(segment, 1)
        })
      } else {
        const value = jsonAtPath(encodedAfter, patch.path)
        if (value === undefined) return undefined
        const yValue = makeValue(value, patch.path)
        plans.push(() => {
          parent.delete(segment, 1)
          parent.insert(segment, [yValue])
        })
      }
      continue
    }

    return undefined
  }

  return sequencePlans(plans)
}

/**
 * Creates a Schema-coded Yjs adapter. The encoded root must be a JSON object;
 * its properties are stored directly in the configured root Y.Map.
 */
export const makeYjsAdapter = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  options: MakeYjsAdapterOptions
): YjsAdapter<S> => {
  const root = options.doc.getMap<YValue>(options.rootName ?? 'root')
  const source = options.source ?? { _tag: 'YjsSource', doc: options.doc }
  const origin = { _tag: 'EffectTreeYjsOrigin', source }
  const undo = makeYjsUndoController(root, origin)
  const observerReady = Deferred.makeUnsafe<void>()
  const configuredTexts = new Set(
    Array.from(options.collaborativeTexts ?? [], pathKey)
  )

  const isCollaborativeText = (
    snapshot: TreeValue<S>,
    path: TreePath
  ): boolean => {
    if (configuredTexts.has(pathKey(path))) return true
    return (
      treeAnnotationAt<boolean>(
        spec,
        snapshot,
        path,
        CollaborativeTextAnnotationKey
      ) === true
    )
  }

  const makeValue = (
    snapshot: TreeValue<S>,
    value: Schema.Json,
    path: TreePath
  ): YValue => {
    if (typeof value === 'string' && isCollaborativeText(snapshot, path)) {
      return new Y.Text(value)
    }
    if (isJsonArray(value)) {
      const array = new Y.Array<YValue>()
      const children = value.map((child, index) =>
        makeValue(snapshot, child, [...path, index])
      )
      if (children.length > 0) array.insert(0, children)
      return array
    }
    if (isJsonObject(value)) {
      const map = new Y.Map<YValue>()
      for (const [key, child] of Object.entries(value)) {
        map.set(key, makeValue(snapshot, child, [...path, key]))
      }
      return map
    }
    return value
  }

  const captureNotification = (): Result.Result<
    CapturedNotification,
    YjsMutationError
  > =>
    Result.try({
      try: () => ({
        vector: Y.encodeStateVector(options.doc),
      }),
      catch: (cause) => new YjsMutationError({ operation: 'observe', cause }),
    })

  const rawChanges = Stream.callback<RawObservedDocument>((queue) =>
    Effect.gen(function* () {
      const observer: Parameters<typeof root.observeDeep>[0] = (
        _events,
        transaction
      ): void => {
        if (transaction.origin === origin) return
        Queue.offerUnsafe(queue, captureNotification())
      }
      root.observeDeep(observer)
      yield* Deferred.succeed(observerReady, undefined)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          root.unobserveDeep(observer)
        })
      )
    })
  )

  const changes = rawChanges.pipe(
    Stream.mapEffect(
      (
        captured
      ): Effect.Effect<InboundCrdtNotification, YjsAdapterError, never> => {
        if (Result.isFailure(captured)) return Effect.fail(captured.failure)
        return Effect.succeed({
          source,
          causality: {
            peer: String(options.doc.clientID),
            vector: Object.freeze(Array.from(captured.success.vector)),
          },
        })
      }
    )
  )

  const readSnapshot = Effect.try({
    try: () => root.toJSON(),
    catch: (cause) =>
      new YjsMutationError({ operation: 'readSnapshot', cause }),
  }).pipe(Effect.flatMap((value) => decodeRoot(spec, value)))

  const writeSnapshot = (
    snapshot: TreeValue<S>
  ): Effect.Effect<void, YjsAdapterError, S['EncodingServices']> =>
    Effect.flatMap(encodeRoot(spec, snapshot), (encoded) =>
      Effect.try({
        try: () => {
          options.doc.transact(() => {
            replaceRoot(root, encoded, (value, path) =>
              makeValue(snapshot, value, path)
            )
          }, origin)
          undo.manager.clear()
        },
        catch: (cause) =>
          new YjsMutationError({ operation: 'writeSnapshot', cause }),
      })
    )

  const applyCommit = (
    commit: ChangeEnvelope<S>
  ): Effect.Effect<void, YjsAdapterError, S['EncodingServices']> =>
    Effect.flatMap(encodeRoot(spec, commit.after), (encodedAfter) =>
      Effect.try({
        try: () => {
          const createValue = (value: Schema.Json, path: TreePath): YValue =>
            makeValue(commit.after, value, path)
          const semantic = semanticOperationsCoverCommit(spec, commit)
            ? makeSemanticPlan(
                root,
                commit.change.operations,
                encodedAfter,
                createValue
              )
            : undefined
          const patches =
            semantic === undefined
              ? makePatchPlan(
                  root,
                  commit.change.patches.forward,
                  encodedAfter,
                  createValue
                )
              : undefined
          const plan =
            semantic ??
            patches ??
            (() => {
              replaceRoot(root, encodedAfter, createValue)
            })

          options.doc.transact(plan, origin)
        },
        catch: (cause) =>
          new YjsMutationError({ operation: 'applyCommit', cause }),
      })
    )

  return {
    spec,
    source,
    ready: Deferred.await(observerReady),
    changes,
    readSnapshot,
    writeSnapshot,
    applyCommit,
    doc: options.doc,
    root,
    origin,
    undo,
  }
}
