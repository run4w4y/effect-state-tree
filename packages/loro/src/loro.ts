import {
  CollaborativeTextAnnotationKey,
  type EntityAnnotation,
  EntityAnnotationKey,
  type TreePath,
  type TreeSpec,
  type TreeValue,
  treeAnnotationAt,
} from '@effect-state-tree/core'
import type { CrdtAdapter } from '@effect-state-tree/crdt'
import {
  type InboundCrdtNotification,
  isJsonObject,
  jsonAtPath,
  MovableListAnnotationKey,
  pathKey,
} from '@effect-state-tree/crdt'
import type { SemanticOperation } from '@effect-state-tree/producer'
import type { ChangeEnvelope, SourceToken } from '@effect-state-tree/runtime'
import { Deferred, Effect, Queue, type Schema, Stream } from 'effect'
import {
  type Container,
  isContainer,
  type LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
} from 'loro-crdt'
import { decodeRoot, encodeRoot } from './codec'
import {
  type LoroAdapterError,
  LoroDocumentError,
  type LoroDocumentOperation,
} from './errors'
import { type LoroUndoController, makeLoroUndoController } from './undo'

/** Document ownership, provenance, and native container materialization policy. */
export interface MakeLoroAdapterOptions {
  readonly doc: LoroDoc
  readonly rootName?: string
  readonly source?: SourceToken
  /**
   * Array paths that should be represented by `LoroMovableList` instead of
   * `LoroList`. A semantic `ArrayMove` is native at these paths.
   */
  readonly movableLists?: Iterable<TreePath>
  /**
   * Additional string paths represented by `LoroText`. Schema fields marked
   * with `collaborativeText` are detected automatically.
   */
  readonly collaborativeTexts?: Iterable<TreePath>
  /** Loro origin used only for echo suppression. It is not persisted. */
  readonly origin?: string
}

export type LoroAdapterOptions = MakeLoroAdapterOptions

type AdapterServices<S extends Schema.Constraint> =
  | S['DecodingServices']
  | S['EncodingServices']

/** Schema-coded Loro adapter with native movable lists, text, and peer undo. */
export interface LoroAdapter<S extends Schema.Constraint>
  extends CrdtAdapter<S, LoroAdapterError, AdapterServices<S>> {
  readonly doc: LoroDoc
  readonly root: LoroMap
  /** Unique per-adapter Loro transaction origin used for echo suppression. */
  readonly origin: string
  readonly undo: LoroUndoController
}

type JsonObject = Schema.JsonObject
type JsonPrimitive = null | number | boolean | string
type ListContainer = LoroList | LoroMovableList
type ContainerKind = 'Map' | 'List' | 'MovableList' | 'Text'

interface SyncContext<S extends Schema.Constraint> {
  readonly spec: TreeSpec<S>
  readonly decoded: TreeValue<S>
  readonly movableLists: ReadonlySet<string>
  readonly collaborativeTexts: ReadonlySet<string>
}

let adapterSequence = 0

const nextOrigin = (): string => {
  adapterSequence += 1
  return `@effect-state-tree/loro/${Date.now().toString(36)}/${adapterSequence.toString(36)}`
}

const pathSet = (paths: Iterable<TreePath> | undefined): ReadonlySet<string> =>
  new Set(Array.from(paths ?? [], pathKey))

const documentError =
  (operation: LoroDocumentOperation) =>
  (cause: unknown): LoroDocumentError =>
    new LoroDocumentError({ operation, cause })

const isMap = (value: unknown): value is LoroMap =>
  isContainer(value) && value.kind() === 'Map'

const isList = (value: unknown): value is LoroList =>
  isContainer(value) && value.kind() === 'List'

const isMovableList = (value: unknown): value is LoroMovableList =>
  isContainer(value) && value.kind() === 'MovableList'

const isText = (value: unknown): value is LoroText =>
  isContainer(value) && value.kind() === 'Text'

const isListContainer = (value: unknown): value is ListContainer =>
  isList(value) || isMovableList(value)

const isPrimitive = (value: Schema.Json): value is JsonPrimitive =>
  value === null || typeof value !== 'object'

const collaborativeAt = <S extends Schema.Constraint>(
  context: SyncContext<S>,
  path: TreePath
): boolean => {
  if (context.collaborativeTexts.has(pathKey(path))) return true
  return (
    treeAnnotationAt<boolean>(
      context.spec,
      context.decoded,
      path,
      CollaborativeTextAnnotationKey
    ) === true
  )
}

const movableAt = <S extends Schema.Constraint>(
  context: SyncContext<S>,
  path: TreePath
): boolean => {
  if (context.movableLists.has(pathKey(path))) return true
  return (
    treeAnnotationAt<boolean>(
      context.spec,
      context.decoded,
      path,
      MovableListAnnotationKey
    ) === true
  )
}

const containerKindAt = <S extends Schema.Constraint>(
  context: SyncContext<S>,
  path: TreePath,
  value: Schema.Json
): ContainerKind | undefined => {
  if (typeof value === 'string' && collaborativeAt(context, path)) return 'Text'
  if (Array.isArray(value)) {
    return movableAt(context, path) ? 'MovableList' : 'List'
  }
  if (isJsonObject(value)) return 'Map'
  return undefined
}

const containerMatches = (
  value: unknown,
  kind: ContainerKind
): value is Container => {
  switch (kind) {
    case 'Map':
      return isMap(value)
    case 'List':
      return isList(value)
    case 'MovableList':
      return isMovableList(value)
    case 'Text':
      return isText(value)
  }
}

const detachedContainer = (kind: ContainerKind): Container => {
  switch (kind) {
    case 'Map':
      return new LoroMap()
    case 'List':
      return new LoroList()
    case 'MovableList':
      return new LoroMovableList()
    case 'Text':
      return new LoroText()
  }
}

const ensureMapContainer = (
  map: LoroMap,
  key: string,
  kind: ContainerKind,
  current: unknown
): Container => {
  if (containerMatches(current, kind)) return current
  if (current === undefined) {
    switch (kind) {
      case 'Map':
        return map.ensureMergeableMap(key)
      case 'List':
        return map.ensureMergeableList(key)
      case 'MovableList':
        return map.ensureMergeableMovableList(key)
      case 'Text':
        return map.ensureMergeableText(key)
    }
  }
  return map.setContainer(key, detachedContainer(kind))
}

const entityAnnotationAt = <S extends Schema.Constraint>(
  context: SyncContext<S>,
  path: TreePath
): EntityAnnotation | undefined => {
  return treeAnnotationAt<EntityAnnotation>(
    context.spec,
    context.decoded,
    path,
    EntityAnnotationKey
  )
}

const entityMatches = <S extends Schema.Constraint>(
  context: SyncContext<S>,
  path: TreePath,
  current: unknown,
  desired: Schema.Json
): boolean => {
  const entity = entityAnnotationAt(context, path)
  if (entity === undefined) return true
  if (!isMap(current) || !isJsonObject(desired)) return false
  const currentJson: unknown = current.toJSON()
  return (
    currentJson !== null &&
    typeof currentJson === 'object' &&
    !Array.isArray(currentJson) &&
    Object.is(Reflect.get(currentJson, entity.id), desired[entity.id])
  )
}

const findEntity = <S extends Schema.Constraint>(
  list: LoroMovableList,
  from: number,
  context: SyncContext<S>,
  path: TreePath,
  desired: Schema.Json
): number | undefined => {
  for (let index = from; index < list.length; index += 1) {
    if (entityMatches(context, [...path, index], list.get(index), desired))
      return index
  }
  return undefined
}

const replaceListValue = (
  list: ListContainer,
  index: number,
  value: JsonPrimitive
): void => {
  if (isMovableList(list)) {
    list.set(index, value)
    return
  }
  list.delete(index, 1)
  list.insert(index, value)
}

const replaceListContainer = (
  list: ListContainer,
  index: number,
  kind: ContainerKind
): Container => {
  const detached = detachedContainer(kind)
  if (isMovableList(list)) return list.setContainer(index, detached)
  list.delete(index, 1)
  return list.insertContainer(index, detached)
}

const insertListValue = <S extends Schema.Constraint>(
  list: ListContainer,
  index: number,
  value: Schema.Json,
  context: SyncContext<S>,
  path: TreePath
): void => {
  const kind = containerKindAt(context, path, value)
  if (kind === undefined) {
    if (!isPrimitive(value)) return
    list.insert(index, value)
    return
  }
  const child = list.insertContainer(index, detachedContainer(kind))
  syncContainer(child, value, context, path)
}

const syncMapKey = <S extends Schema.Constraint>(
  map: LoroMap,
  key: string,
  value: Schema.Json,
  context: SyncContext<S>,
  path: TreePath
): void => {
  const kind = containerKindAt(context, path, value)
  const current: unknown = map.get(key)
  if (kind === undefined) {
    if (isPrimitive(value) && !Object.is(current, value)) map.set(key, value)
    return
  }
  const child = ensureMapContainer(map, key, kind, current)
  syncContainer(child, value, context, path)
}

const syncMap = <S extends Schema.Constraint>(
  map: LoroMap,
  value: JsonObject,
  context: SyncContext<S>,
  path: TreePath
): void => {
  const expected = new Set(Object.keys(value))
  for (const key of map.keys()) {
    if (typeof key === 'string' && !expected.has(key)) map.delete(key)
  }
  for (const [key, child] of Object.entries(value)) {
    syncMapKey(map, key, child, context, [...path, key])
  }
}

const syncList = <S extends Schema.Constraint>(
  list: ListContainer,
  value: Schema.JsonArray,
  context: SyncContext<S>,
  path: TreePath
): void => {
  if (list.length > value.length)
    list.delete(value.length, list.length - value.length)

  for (let index = 0; index < value.length; index += 1) {
    const desired = value[index]
    if (desired === undefined) continue
    const childPath = [...path, index]
    if (index >= list.length) {
      insertListValue(list, index, desired, context, childPath)
      continue
    }

    const kind = containerKindAt(context, childPath, desired)
    let current: unknown = list.get(index)
    if (
      kind !== undefined &&
      isMovableList(list) &&
      containerMatches(current, kind) &&
      !entityMatches(context, childPath, current, desired)
    ) {
      const matching = findEntity(list, index + 1, context, path, desired)
      if (matching !== undefined) {
        list.move(matching, index)
        current = list.get(index)
      }
    }

    if (kind === undefined) {
      if (isPrimitive(desired) && !Object.is(current, desired)) {
        replaceListValue(list, index, desired)
      }
      continue
    }

    const child =
      containerMatches(current, kind) &&
      entityMatches(context, childPath, current, desired)
        ? current
        : replaceListContainer(list, index, kind)
    syncContainer(child, desired, context, childPath)
  }
}

const syncContainer = <S extends Schema.Constraint>(
  container: Container,
  value: Schema.Json,
  context: SyncContext<S>,
  path: TreePath
): void => {
  if (isMap(container) && isJsonObject(value)) {
    syncMap(container, value, context, path)
    return
  }
  if (isListContainer(container) && Array.isArray(value)) {
    syncList(container, value, context, path)
    return
  }
  if (isText(container) && typeof value === 'string') container.update(value)
}

const getContainerAt = (
  root: LoroMap,
  path: TreePath
): Container | undefined => {
  let current: Container = root
  for (const segment of path) {
    const child: unknown =
      isMap(current) && typeof segment === 'string'
        ? current.get(segment)
        : isListContainer(current) && typeof segment === 'number'
          ? current.get(segment)
          : undefined
    if (!isContainer(child)) return undefined
    current = child
  }
  return current
}

const applyArrayMove = (
  list: LoroMovableList,
  from: number,
  to: number,
  count: number
): void => {
  if (from === to) return
  if (to < from) {
    for (let offset = 0; offset < count; offset += 1) {
      list.move(from + offset, to + offset)
    }
    return
  }
  const finalTarget = to + count - 1
  for (let offset = 0; offset < count; offset += 1) {
    list.move(from, finalTarget)
  }
}

const applySemanticOperation = <S extends Schema.Constraint>(
  root: LoroMap,
  operation: SemanticOperation,
  encodedAfter: JsonObject,
  context: SyncContext<S>
): boolean => {
  const target = getContainerAt(root, operation.path)
  switch (operation._tag) {
    case 'ObjectSet': {
      if (!isMap(target)) return false
      const path = [...operation.path, operation.key]
      const encoded = jsonAtPath(encodedAfter, path)
      if (encoded === undefined) return false
      syncMapKey(target, operation.key, encoded, context, path)
      return true
    }
    case 'ObjectDelete':
      if (!isMap(target)) return false
      target.delete(operation.key)
      return true
    case 'ArraySplice': {
      if (!isListContainer(target)) return false
      const encodedArray = jsonAtPath(encodedAfter, operation.path)
      if (!Array.isArray(encodedArray)) return false
      const inserted = encodedArray.slice(
        operation.index,
        operation.index + operation.inserted.length
      )
      if (
        operation.index < 0 ||
        operation.index > target.length ||
        operation.deleteCount < 0 ||
        operation.index + operation.deleteCount > target.length
      )
        return false
      if (operation.deleteCount > 0)
        target.delete(operation.index, operation.deleteCount)
      for (let offset = 0; offset < inserted.length; offset += 1) {
        const value = inserted[offset]
        if (value !== undefined) {
          insertListValue(target, operation.index + offset, value, context, [
            ...operation.path,
            operation.index + offset,
          ])
        }
      }
      return true
    }
    case 'ArrayMove':
      if (!isMovableList(target)) return false
      if (
        operation.from < 0 ||
        operation.count <= 0 ||
        operation.from + operation.count > target.length ||
        operation.to < 0 ||
        operation.to > target.length - operation.count
      )
        return false
      applyArrayMove(target, operation.from, operation.to, operation.count)
      return true
    case 'TextInsert':
      if (!isText(target)) return false
      if (operation.index < 0 || operation.index > target.length) return false
      target.insert(operation.index, operation.text)
      return true
    case 'TextDelete':
      if (!isText(target)) return false
      if (
        operation.index < 0 ||
        operation.index + operation.text.length > target.length
      )
        return false
      target.delete(operation.index, operation.text.length)
      return true
  }
}

const writeDocument = <S extends Schema.Constraint>(
  doc: LoroDoc,
  root: LoroMap,
  origin: string,
  encoded: JsonObject,
  context: SyncContext<S>,
  operation: Extract<LoroDocumentOperation, 'write-snapshot' | 'apply-commit'>,
  semanticOperations: ReadonlyArray<SemanticOperation>,
  message?: string
): Effect.Effect<void, LoroDocumentError> =>
  Effect.try({
    try: () => {
      for (const semantic of semanticOperations) {
        applySemanticOperation(root, semantic, encoded, context)
      }
      // The encoded snapshot is the correctness fallback. When semantic
      // operations were applied successfully this reconciliation is normally a
      // no-op and therefore preserves their native Loro representation.
      syncMap(root, encoded, context, [])
      doc.commit(message === undefined ? { origin } : { origin, message })
    },
    catch: documentError(operation),
  })

/**
 * Creates an Effect Tree CRDT adapter backed by one Loro document root map.
 *
 * The tree's decoded value is encoded through its Effect Schema before it is
 * materialized as Loro containers. Consequently rich Schema codecs remain at
 * the application boundary while Loro only stores valid JSON.
 */
export const makeLoroAdapter = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  options: MakeLoroAdapterOptions
): LoroAdapter<S> => {
  const rootName = options.rootName ?? 'root'
  const root = options.doc.getMap(rootName)
  const origin = options.origin ?? nextOrigin()
  const undo = makeLoroUndoController(options.doc)
  const observerReady = Deferred.makeUnsafe<void>()
  const source: SourceToken =
    options.source ??
    Object.freeze({
      _tag: 'LoroSource',
      origin,
    })
  const movableLists = pathSet(options.movableLists)
  const collaborativeTexts = pathSet(options.collaborativeTexts)

  const readRaw = Effect.try({
    try: () => root.toJSON() as unknown,
    catch: documentError('read'),
  })

  const readSnapshot = readRaw.pipe(
    Effect.flatMap((raw) => decodeRoot(spec, raw))
  )

  const writeSnapshot = (
    snapshot: TreeValue<S>
  ): Effect.Effect<void, LoroAdapterError, AdapterServices<S>> =>
    encodeRoot(spec, snapshot).pipe(
      Effect.flatMap((encoded) =>
        writeDocument(
          options.doc,
          root,
          origin,
          encoded,
          {
            spec,
            decoded: snapshot,
            movableLists,
            collaborativeTexts,
          },
          'write-snapshot',
          []
        )
      ),
      Effect.tap(() =>
        Effect.try({
          try: () => undo.manager.clear(),
          catch: documentError('write-snapshot'),
        })
      )
    )

  const applyCommit = (
    commit: ChangeEnvelope<S>
  ): Effect.Effect<void, LoroAdapterError, AdapterServices<S>> => {
    if (commit.source === source) return Effect.void
    return encodeRoot(spec, commit.after).pipe(
      Effect.flatMap((encoded) =>
        writeDocument(
          options.doc,
          root,
          origin,
          encoded,
          {
            spec,
            decoded: commit.after,
            movableLists,
            collaborativeTexts,
          },
          'apply-commit',
          commit.change.operations,
          commit.label
        )
      )
    )
  }

  const changes = Stream.callback<InboundCrdtNotification, LoroDocumentError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.try({
          try: () =>
            options.doc.subscribe((event) => {
              if (event.origin === origin) return
              Queue.offerUnsafe(queue, {
                source,
                causality: {
                  clock: event.to,
                  vector: event.to,
                },
              })
            }),
          catch: documentError('subscribe'),
        }).pipe(Effect.tap(() => Deferred.succeed(observerReady, undefined))),
        (unsubscribe) => Effect.sync(unsubscribe)
      )
  )

  return {
    doc: options.doc,
    root,
    origin,
    spec,
    source,
    ready: Deferred.await(observerReady),
    changes,
    readSnapshot,
    writeSnapshot,
    applyCommit,
    undo,
  }
}
