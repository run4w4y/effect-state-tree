import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { HttpApiTest } from 'effect/unstable/httpapi'

import { addTodo, editTodo } from '../src/client/state/actions'
import { TodoTree } from '../src/client/state/todo-tree'
import {
  makeTodoWorkspace,
  TodoDraftInvalidError,
} from '../src/client/state/workspace'
import { TodoApi, TodoConflict } from '../src/shared/todo-api'
import { HttpApiTestServices, TodoDocumentHandlersTest } from './support'

const runApiTest = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect)

describe('Todo draft workspace', () => {
  test('keeps local history isolated until one authoritative save', async () => {
    await runApiTest(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])
          const workspace = yield* makeTodoWorkspace(client, 'draft-save')
          yield* workspace.load
          const originalCount =
            workspace.original.getSnapshot().document.todos.length

          yield* addTodo({ title: 'Local only', priority: 'high' }).pipe(
            Effect.provideService(TodoTree.service, workspace.draft.data)
          )

          expect(
            workspace.draft.data.getSnapshot().document.todos
          ).toHaveLength(originalCount + 1)
          expect(workspace.original.getSnapshot().document.todos).toHaveLength(
            originalCount
          )
          expect(workspace.history.canUndo()).toBe(true)
          expect(workspace.isDirty()).toBe(true)

          yield* workspace.history.undo
          expect(
            workspace.draft.data.getSnapshot().document.todos
          ).toHaveLength(originalCount)
          yield* workspace.history.redo

          const saved = yield* workspace.save
          expect(saved.version).toBe(2)
          expect(workspace.original.getSnapshot().document).toEqual(saved)
          expect(workspace.draft.data.getSnapshot().document).toEqual(saved)
          expect(workspace.history.canUndo()).toBe(false)
          expect(workspace.isDirty()).toBe(false)
          yield* workspace.shutdown
        }).pipe(
          Effect.provide(TodoDocumentHandlersTest),
          Effect.provide(HttpApiTestServices)
        )
      )
    )
  })

  test('retains local draft and history after a server conflict', async () => {
    await runApiTest(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])
          const workspace = yield* makeTodoWorkspace(client, 'draft-conflict')
          const loaded = yield* workspace.load
          const first = loaded.todos[0]
          if (first === undefined) throw new Error('Expected a seeded todo')

          yield* editTodo({
            id: first.id,
            title: 'My local title',
            notes: first.notes,
            priority: first.priority,
          }).pipe(Effect.provideService(TodoTree.service, workspace.draft.data))

          yield* client.todoDocuments.save({
            params: { id: 'draft-conflict' },
            payload: { expectedVersion: loaded.version, todos: loaded.todos },
          })

          const conflict = yield* Effect.flip(workspace.save)
          expect(conflict).toBeInstanceOf(TodoConflict)
          expect(workspace.isDirty()).toBe(true)
          expect(workspace.history.canUndo()).toBe(true)
          expect(
            workspace.draft.data.getSnapshot().document.todos[0]?.title
          ).toBe('My local title')
          expect(workspace.original.getSnapshot().document.version).toBe(
            loaded.version
          )
          yield* workspace.shutdown
        }).pipe(
          Effect.provide(TodoDocumentHandlersTest),
          Effect.provide(HttpApiTestServices)
        )
      )
    )
  })

  test('keeps invalid Schema diagnostics editable and rejects save', async () => {
    await runApiTest(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])
          const workspace = yield* makeTodoWorkspace(client, 'draft-validation')
          const loaded = yield* workspace.load
          const first = loaded.todos[0]
          if (first === undefined) throw new Error('Expected a seeded todo')

          yield* editTodo({
            id: first.id,
            title: '',
            notes: first.notes,
            priority: first.priority,
          }).pipe(Effect.provideService(TodoTree.service, workspace.draft.data))

          expect(
            workspace.validation
              .issuesBelow(['document'])
              .some((issue) => issue.code === 'todo.title.non-empty')
          ).toBe(true)
          const invalid = yield* Effect.flip(workspace.save)
          expect(invalid).toBeInstanceOf(TodoDraftInvalidError)
          expect(
            workspace.draft.data.getSnapshot().document.todos[0]?.title
          ).toBe('')
          expect(workspace.isDirty()).toBe(true)
          yield* workspace.shutdown
        }).pipe(
          Effect.provide(TodoDocumentHandlersTest),
          Effect.provide(HttpApiTestServices)
        )
      )
    )
  })
})
