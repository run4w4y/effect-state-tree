import { Context, Effect, Layer, SynchronizedRef } from 'effect'
import type { SaveTodoDocument, Todo, TodoDocument } from '../shared/todo'
import { TodoConflict } from '../shared/todo-api'

const seedTodos: ReadonlyArray<Todo> = [
  {
    id: 'design-context-actions',
    title: 'Move updates into context-backed actions',
    notes:
      'Every local edit targets the draft store supplied by React context.',
    priority: 'high',
    completed: true,
  },
  {
    id: 'ship-drafts',
    title: 'Edit locally, then save once',
    notes: 'Undo and redo stay local until the document is saved.',
    priority: 'normal',
    completed: false,
  },
]

const normalizeTodo = (todo: Todo): Todo => ({
  ...todo,
  title: todo.title.trim().replaceAll(/\s+/g, ' '),
  notes: todo.notes.trim(),
})

const initialDocument = (): TodoDocument => ({
  version: 1,
  todos: seedTodos.map((todo) => ({ ...todo })),
})

const documentFor = (
  documents: ReadonlyMap<string, TodoDocument>,
  id: string
): TodoDocument => documents.get(id) ?? initialDocument()

export interface TodoRepositoryService {
  readonly get: (id: string) => Effect.Effect<TodoDocument>
  readonly save: (
    id: string,
    input: SaveTodoDocument
  ) => Effect.Effect<TodoDocument, TodoConflict>
}

export class TodoRepository extends Context.Service<
  TodoRepository,
  TodoRepositoryService
>()('@effect-state-tree/react-todo-example/TodoRepository') {}

export const TodoRepositoryLive = Layer.effect(
  TodoRepository,
  Effect.gen(function* () {
    const documents = yield* SynchronizedRef.make<
      ReadonlyMap<string, TodoDocument>
    >(new Map())

    const get = (id: string): Effect.Effect<TodoDocument> =>
      SynchronizedRef.modify(documents, (current) => {
        const document = documentFor(current, id)
        if (current.has(id)) return [document, current] as const
        const next = new Map(current)
        next.set(id, document)
        return [document, next] as const
      })

    const save = (
      id: string,
      input: SaveTodoDocument
    ): Effect.Effect<TodoDocument, TodoConflict> =>
      SynchronizedRef.modifyEffect(documents, (documentsAtSave) => {
        const current = documentFor(documentsAtSave, id)
        if (current.version !== input.expectedVersion) {
          return Effect.fail(
            new TodoConflict({
              expectedVersion: input.expectedVersion,
              actualVersion: current.version,
              current,
            })
          )
        }

        const nextDocument: TodoDocument = {
          version: current.version + 1,
          todos: input.todos.map(normalizeTodo),
        }
        const next = new Map(documentsAtSave)
        next.set(id, nextDocument)
        return Effect.succeed([nextDocument, next] as const)
      })

    return TodoRepository.of({ get, save })
  })
)
