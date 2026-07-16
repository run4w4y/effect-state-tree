import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { HttpApiTest } from 'effect/unstable/httpapi'

import { TodoApi, TodoConflict } from '../src/shared/todo-api'
import { HttpApiTestServices, TodoDocumentHandlersTest } from './support'

const runApiTest = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect)

describe('Todo HttpApi contract', () => {
  test('round-trips typed documents and normalizes authoritative saves', async () => {
    await runApiTest(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])
          const initial = yield* client.todoDocuments.get({
            params: { id: 'contract-roundtrip' },
          })

          const saved = yield* client.todoDocuments.save({
            params: { id: 'contract-roundtrip' },
            payload: {
              expectedVersion: initial.version,
              todos: [
                ...initial.todos,
                {
                  id: 'normalized',
                  title: '  normalized   by server  ',
                  notes: '  persisted note  ',
                  priority: 'high',
                  completed: false,
                },
              ],
            },
          })

          expect(saved.version).toBe(initial.version + 1)
          expect(saved.todos.at(-1)?.title).toBe('normalized by server')
          expect(saved.todos.at(-1)?.notes).toBe('persisted note')

          const readBack = yield* client.todoDocuments.get({
            params: { id: 'contract-roundtrip' },
          })
          expect(readBack).toEqual(saved)
        }).pipe(
          Effect.provide(TodoDocumentHandlersTest),
          Effect.provide(HttpApiTestServices)
        )
      )
    )
  })

  test('decodes optimistic concurrency failures through the declared error Schema', async () => {
    await runApiTest(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* HttpApiTest.groups(TodoApi, ['todoDocuments'])
          const current = yield* client.todoDocuments.get({
            params: { id: 'contract-conflict' },
          })
          const conflict = yield* Effect.flip(
            client.todoDocuments.save({
              params: { id: 'contract-conflict' },
              payload: {
                expectedVersion: current.version + 1,
                todos: current.todos,
              },
            })
          )

          expect(conflict).toBeInstanceOf(TodoConflict)
          if (conflict instanceof TodoConflict) {
            expect(conflict.actualVersion).toBe(current.version)
            expect(conflict.current).toEqual(current)
          }
        }).pipe(
          Effect.provide(TodoDocumentHandlersTest),
          Effect.provide(HttpApiTestServices)
        )
      )
    )
  })
})
