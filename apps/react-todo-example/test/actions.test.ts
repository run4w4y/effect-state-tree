import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Fiber, Layer, type Scope } from 'effect'
import { HttpApiTest } from 'effect/unstable/httpapi'

import { TodoApiClient, type TodoApiClientService } from '../src/client/api'
import {
  addTodo,
  editTodo,
  loadTodoDocument,
  redoTodoChange,
  saveTodoDocument,
  undoTodoChange,
} from '../src/client/state/actions'
import { TodoDraftInvalidError } from '../src/client/state/errors'
import { TodoSession, TodoSessionLive } from '../src/client/state/session'
import { TodoApi, TodoConflict } from '../src/shared/todo-api'
import { HttpApiTestServices, TodoDocumentHandlersTest } from './support'

const runApiTest = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

const applicationLayer = (documentId: string, client: TodoApiClientService) =>
  Layer.merge(TodoSessionLive(documentId), Layer.succeed(TodoApiClient, client))

describe('Todo Effect actions', () => {
  test('keeps local history isolated until one authoritative save', async () => {
    await runApiTest(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])

        yield* Effect.gen(function* () {
          const session = yield* TodoSession
          yield* loadTodoDocument()
          const originalCount =
            session.original.getSnapshot().document.todos.length

          yield* addTodo({ title: 'Local only', priority: 'high' })

          expect(session.draft.data.getSnapshot().document.todos).toHaveLength(
            originalCount + 1
          )
          expect(session.original.getSnapshot().document.todos).toHaveLength(
            originalCount
          )
          expect(session.history.canUndo()).toBe(true)
          expect(session.draft.isDirtyAt(['document'])).toBe(true)

          yield* undoTodoChange()
          expect(session.draft.data.getSnapshot().document.todos).toHaveLength(
            originalCount
          )
          yield* redoTodoChange()

          const saved = yield* saveTodoDocument()
          expect(saved._tag).toBe('Accepted')
          expect(saved.authoritative.version).toBe(2)
          expect(session.original.getSnapshot().document).toEqual(
            saved.authoritative
          )
          expect(session.draft.data.getSnapshot().document).toEqual(
            saved.authoritative
          )
          expect(session.history.canUndo()).toBe(false)
          expect(session.draft.isDirtyAt(['document'])).toBe(false)
        }).pipe(Effect.provide(applicationLayer('draft-save', client)))
      }).pipe(
        Effect.provide(TodoDocumentHandlersTest),
        Effect.provide(HttpApiTestServices)
      )
    )
  })

  test('updates the authoritative original after a conflict without touching the draft', async () => {
    await runApiTest(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])

        yield* Effect.gen(function* () {
          const session = yield* TodoSession
          const loaded = (yield* loadTodoDocument()).authoritative
          const first = loaded.todos[0]
          if (first === undefined) return

          yield* editTodo({
            id: first.id,
            title: 'My local title',
            notes: first.notes,
            priority: first.priority,
          })

          const current = yield* client.todoDocuments.save({
            params: { id: 'draft-conflict' },
            payload: { expectedVersion: loaded.version, todos: loaded.todos },
          })

          const conflict = yield* Effect.flip(saveTodoDocument())
          expect(conflict).toBeInstanceOf(TodoConflict)
          expect(session.draft.isDirtyAt(['document'])).toBe(true)
          expect(session.history.canUndo()).toBe(true)
          expect(
            session.draft.data.getSnapshot().document.todos[0]?.title
          ).toBe('My local title')
          expect(session.original.getSnapshot().document).toEqual(current)
          expect(session.draft.data.getSnapshot().document.version).toBe(
            loaded.version
          )
        }).pipe(Effect.provide(applicationLayer('draft-conflict', client)))
      }).pipe(
        Effect.provide(TodoDocumentHandlersTest),
        Effect.provide(HttpApiTestServices)
      )
    )
  })

  test('keeps invalid Schema diagnostics editable and rejects save', async () => {
    await runApiTest(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])

        yield* Effect.gen(function* () {
          const session = yield* TodoSession
          const loaded = (yield* loadTodoDocument()).authoritative
          const first = loaded.todos[0]
          if (first === undefined) return

          yield* editTodo({
            id: first.id,
            title: '',
            notes: first.notes,
            priority: first.priority,
          })

          expect(
            session.validation
              .issuesBelow(['document'])
              .some((issue) => issue.code === 'todo.title.non-empty')
          ).toBe(true)
          const invalid = yield* Effect.flip(saveTodoDocument())
          expect(invalid).toBeInstanceOf(TodoDraftInvalidError)
          expect(
            session.draft.data.getSnapshot().document.todos[0]?.title
          ).toBe('')
          expect(session.draft.isDirtyAt(['document'])).toBe(true)
        }).pipe(Effect.provide(applicationLayer('draft-validation', client)))
      }).pipe(
        Effect.provide(TodoDocumentHandlersTest),
        Effect.provide(HttpApiTestServices)
      )
    )
  })

  test('preserves edits committed while an asynchronous save is in flight', async () => {
    await runApiTest(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])
        const saveStarted = yield* Deferred.make<void>()
        const releaseSave = yield* Deferred.make<void>()
        const delayedClient: TodoApiClientService = {
          ...client,
          todoDocuments: {
            ...client.todoDocuments,
            save: (request) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(saveStarted, undefined)
                yield* Deferred.await(releaseSave)
                return yield* client.todoDocuments.save(request)
              }),
          },
        }

        yield* Effect.gen(function* () {
          const session = yield* TodoSession
          const loaded = (yield* loadTodoDocument()).authoritative
          const first = loaded.todos[0]
          if (first === undefined) return

          const saveFiber = yield* Effect.forkChild(saveTodoDocument())
          yield* Deferred.await(saveStarted)
          yield* editTodo({
            id: first.id,
            title: 'Edited while saving',
            notes: first.notes,
            priority: first.priority,
          })
          yield* Deferred.succeed(releaseSave, undefined)

          const saved = yield* Fiber.join(saveFiber)
          expect(saved._tag).toBe('AcceptedWithPendingChanges')
          expect(session.original.getSnapshot().document.version).toBe(2)
          expect(
            session.draft.data.getSnapshot().document.todos[0]?.title
          ).toBe('Edited while saving')
          expect(session.draft.data.getSnapshot().document.version).toBe(1)
          expect(session.history.canUndo()).toBe(true)
          expect(session.draft.isDirtyAt(['document'])).toBe(true)
        }).pipe(
          Effect.provide(applicationLayer('draft-in-flight', delayedClient))
        )
      }).pipe(
        Effect.provide(TodoDocumentHandlersTest),
        Effect.provide(HttpApiTestServices)
      )
    )
  })
})
