import { describe, expect, it } from 'bun:test'
import { Result, Schema } from 'effect'

import {
  applyPatchSet,
  applyTreePatches,
  captureTreeSnapshot,
  defineEntity,
  entity,
  entityAnnotationAt,
  identityAt,
  makeTreeRef,
  makeTreeSpec,
  reconcileTreeSnapshot,
  resolveTreeRef,
} from '../src/index'

const AlwaysValid = Schema.makeFilter<unknown>(() => true)

// Applying the entity helper after a check deliberately stores the annotation
// on that check. The TreeSpec resolver must find both check and base annotations.
const TodoEntity = defineEntity(
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    done: Schema.Boolean,
    details: Schema.Struct({ note: Schema.String }),
  }).check(AlwaysValid),
  { type: 'Todo', id: 'id' }
)
const TodoSchema = TodoEntity.schema

const RootSchema = Schema.Struct({
  id: Schema.String,
  todos: Schema.Array(TodoSchema),
  settings: Schema.Struct({ theme: Schema.String }),
}).pipe(entity({ type: 'Root', id: 'id' }), Schema.check(AlwaysValid))

type Todo = Schema.Schema.Type<typeof TodoSchema>
type Root = Schema.Schema.Type<typeof RootSchema>

const spec = makeTreeSpec(RootSchema)

const todo = (id: string, title: string, note = `note:${id}`): Todo => ({
  id,
  title,
  done: false,
  details: { note },
})

const root = (id: string, todos: ReadonlyArray<Todo>): Root => ({
  id,
  todos,
  settings: { theme: 'dark' },
})

const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error(
      `Expected success, received ${JSON.stringify(result.failure)}`
    )
  }
  return result.success
}

describe('Schema entity metadata and indexes', () => {
  it('resolves entity annotations and identities from both base ASTs and checks', () => {
    const admitted = success(
      captureTreeSnapshot(spec, root('root-1', [todo('a', 'Alpha')]))
    )

    expect(entityAnnotationAt(spec, admitted.snapshot, [])).toEqual({
      type: 'Root',
      id: 'id',
    })
    expect(entityAnnotationAt(spec, admitted.snapshot, ['todos', 0])).toEqual({
      type: 'Todo',
      id: 'id',
    })
    expect(identityAt(spec, admitted.snapshot, [])).toEqual({
      entityType: 'Root',
      id: 'root-1',
    })
    expect(identityAt(spec, admitted.snapshot, ['todos', 0])).toEqual({
      entityType: 'Todo',
      id: 'a',
    })
    expect(admitted.entities.size).toBe(2)
  })

  it('rejects duplicate IDs within the same entity type', () => {
    const admitted = captureTreeSnapshot(
      spec,
      root('root-1', [todo('duplicate', 'One'), todo('duplicate', 'Two')])
    )

    expect(admitted).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'DuplicateEntityError',
        entityType: 'Todo',
        id: 'duplicate',
        firstPath: ['todos', 0],
        secondPath: ['todos', 1],
      },
    })
  })
})

describe('identity-aware reconciliation', () => {
  it('reuses entity references across reorders and reconciles changed entities', () => {
    const current = success(
      captureTreeSnapshot(
        spec,
        root('root-1', [todo('a', 'Alpha'), todo('b', 'Beta')])
      )
    ).snapshot

    const incoming = root('root-1', [
      todo('b', 'Beta'),
      todo('a', 'Alpha revised'),
    ])
    const result = success(reconcileTreeSnapshot(spec, current, incoming))
    const reconciled = result.snapshot

    expect(reconciled.todos.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(reconciled.todos[0]).toBe(current.todos[1])
    expect(reconciled.todos[1]).not.toBe(current.todos[0])
    expect(reconciled.todos[1]?.details).toBe(current.todos[0]?.details)
    expect(reconciled.settings).toBe(current.settings)

    const restored = success(
      applyPatchSet(reconciled, result.patchSet, 'inverse')
    )
    expect(restored.snapshot).toEqual(current)
  })

  it('rejects direct patches to root and nested entity ID fields', () => {
    const current = success(
      captureTreeSnapshot(spec, root('root-1', [todo('a', 'Alpha')]))
    ).snapshot

    const rootId = applyTreePatches(spec, current, [
      {
        op: 'replace',
        path: ['id'],
        value: 'root-2',
      },
    ])
    expect(rootId).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'InvalidEntityError',
        entityType: 'Root',
        idKey: 'id',
        path: [],
        reason: 'unsupported-id',
      },
    })

    const todoId = applyTreePatches(spec, current, [
      {
        op: 'replace',
        path: ['todos', 0, 'id'],
        value: 'b',
      },
    ])
    expect(todoId).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'InvalidEntityError',
        entityType: 'Todo',
        idKey: 'id',
        path: ['todos', 0],
        reason: 'unsupported-id',
      },
    })
  })

  it('does not allow a root replacement to bypass root-ID immutability', () => {
    const current = success(
      captureTreeSnapshot(spec, root('root-1', [todo('a', 'Alpha')]))
    ).snapshot

    const changed = applyTreePatches(spec, current, [
      {
        op: 'replace',
        path: [],
        value: root('root-2', [todo('a', 'Alpha')]),
      },
    ])

    expect(changed).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'InvalidEntityError',
        entityType: 'Root',
        path: [],
        reason: 'unsupported-id',
      },
    })
  })

  it('rejects an incoming snapshot whose root identity changed', () => {
    const current = success(
      captureTreeSnapshot(spec, root('root-1', [todo('a', 'Alpha')]))
    ).snapshot

    const result = reconcileTreeSnapshot(
      spec,
      current,
      root('root-2', [todo('a', 'Alpha')])
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'InvalidEntityError',
        entityType: 'Root',
        path: [],
        reason: 'unsupported-id',
      },
    })
  })
})

describe('TreeRef', () => {
  it('resolves entities through the Schema-derived identity index', () => {
    const snapshot = success(
      captureTreeSnapshot(
        spec,
        root('root-1', [todo('a', 'Alpha'), todo('b', 'Beta')])
      )
    ).snapshot

    const reference = makeTreeRef(TodoEntity, 'b')
    const resolved = success(resolveTreeRef(spec, snapshot, reference))

    const typedTodo: Todo = resolved
    const expectedTodo = snapshot.todos[1]
    if (expectedTodo === undefined) throw new Error('Expected the second todo')

    expect(typedTodo).toBe(expectedTodo)
  })

  it('returns a tagged error when the entity is absent', () => {
    const snapshot = success(
      captureTreeSnapshot(spec, root('root-1', [todo('a', 'Alpha')]))
    ).snapshot

    expect(
      resolveTreeRef(spec, snapshot, makeTreeRef(TodoEntity, 'missing'))
    ).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'EntityNotFoundError',
        entityType: 'Todo',
        id: 'missing',
      },
    })
  })

  it('derives reference IDs and resolved values from the entity Schema', () => {
    const reference = makeTreeRef(TodoEntity, 'todo-id')
    expect(reference.entityType).toBe('Todo')

    // @ts-expect-error TodoEntity's ID Schema is String.
    makeTreeRef(TodoEntity, 123)
    // @ts-expect-error makeTreeRef does not accept a caller-selected result type.
    makeTreeRef<Todo>(TodoEntity, 'todo-id')
  })
})
