import { makeTreeAtomsWithLayer } from '@effect-state-tree/atom'
import { type Context, Layer } from 'effect'
import { Atom } from 'effect/unstable/reactivity'
import type { TodoApiClient } from '../api'
import {
  addTodo,
  changeFilter,
  editTodo,
  loadTodoDocument,
  redoTodoChange,
  reloadTodoDocument,
  removeTodo,
  resetTodoDraft,
  saveTodoDocument,
  toggleTodo,
  undoTodoChange,
} from './actions'
import {
  selectFilter,
  selectRemaining,
  selectTotal,
  selectVersion,
  selectVisibleTodos,
  todoCountOptions,
  visibleTodoOptions,
} from './selectors'
import type { TodoSession, TodoSessionService } from './session'
import { TodoTree } from './tree'

/**
 * Derives all stable UI atoms from the admitted original and draft stores.
 * React only consumes these atoms through Effect's official binding; the same
 * values remain usable by every other official Atom framework package.
 */
export const makeTodoAtoms = (
  session: TodoSessionService,
  services: Context.Context<TodoSession | TodoApiClient>
) => {
  const tree = makeTreeAtomsWithLayer(
    TodoTree,
    session.draft.data,
    Layer.succeedContext(services)
  )
  const draftDocument = tree.select((state) => state.document, {
    paths: [['document']],
  })
  const originalDocument = tree.view(
    session.original.select((state) => state.document, {
      paths: [['document']],
    })
  )
  const dirty = Atom.make((get) => {
    get(draftDocument)
    get(originalDocument)
    return session.draft.isDirtyAt(['document'])
  })

  return {
    tree,
    initialLoad: tree.runtime.atom(loadTodoDocument()),
    total: tree.select(selectTotal, todoCountOptions),
    remaining: tree.select(selectRemaining, todoCountOptions),
    filter: tree.select(selectFilter, { paths: [['filter']] }),
    visibleTodos: tree.select(selectVisibleTodos, visibleTodoOptions),
    draftVersion: tree.select(selectVersion, {
      paths: [['document', 'version']],
    }),
    originalVersion: tree.view(
      session.original.select(selectVersion, {
        paths: [['document', 'version']],
      })
    ),
    validation: tree.view(session.validation),
    history: tree.view(session.history),
    dirty,
    todo: Atom.family((id: string) =>
      tree.select(
        (state) =>
          state.document.todos.find((candidate) => candidate.id === id),
        { paths: [['document', 'todos']] }
      )
    ),
    todoIndex: Atom.family((id: string) =>
      tree.select(
        (state) =>
          state.document.todos.findIndex((candidate) => candidate.id === id),
        { paths: [['document', 'todos']] }
      )
    ),
    actions: {
      add: tree.fn(addTodo, { concurrent: true }),
      toggle: Atom.family((id: string) =>
        tree.fn(() => toggleTodo(id), { concurrent: true })
      ),
      edit: tree.fn(editTodo, { concurrent: true }),
      remove: Atom.family((id: string) =>
        tree.fn(() => removeTodo(id), { concurrent: true })
      ),
      changeFilter: tree.fn(changeFilter),
      undo: tree.fn(undoTodoChange),
      redo: tree.fn(redoTodoChange),
      save: tree.fn(saveTodoDocument),
      reload: tree.fn(reloadTodoDocument),
      reset: tree.fn(resetTodoDraft),
    },
  }
}

export type TodoAtoms = ReturnType<typeof makeTodoAtoms>
