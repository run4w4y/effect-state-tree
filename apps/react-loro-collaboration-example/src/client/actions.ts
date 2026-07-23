import { clamp } from 'es-toolkit'

import { BoardTree, type Card } from '../domain/board'

export const moveCard = BoardTree.operationUpdate(
  (
    state,
    operations,
    input: { readonly id: string; readonly offset: number }
  ) => {
    const from = state.cards.findIndex((card) => card.id === input.id)
    if (from === -1) return
    const to = clamp(from + input.offset, 0, state.cards.length - 1)
    if (from !== to) operations.arrayMove(['cards'], from, to)
  },
  { label: 'Move card' }
)

export const renameCard = BoardTree.operationUpdate(
  (
    state,
    operations,
    input: { readonly id: string; readonly title: string }
  ) => {
    const index = state.cards.findIndex((card) => card.id === input.id)
    if (index !== -1)
      operations.objectSet(['cards', index], 'title', input.title)
  },
  (input) => ({ label: `Rename to "${input.title}"` })
)

export const addCard = BoardTree.operationUpdate(
  (
    state,
    operations,
    input: { readonly title: string; readonly color: Card['color'] }
  ) => {
    operations.arraySplice(['cards'], state.cards.length, 0, {
      id: crypto.randomUUID(),
      title: input.title,
      color: input.color,
    })
  },
  (input) => ({ label: `Add "${input.title}"` })
)

export const removeCard = BoardTree.operationUpdate(
  (state, operations, id: string) => {
    const index = state.cards.findIndex((card) => card.id === id)
    if (index !== -1) operations.arraySplice(['cards'], index, 1)
  },
  { label: 'Remove card' }
)

export const appendNote = BoardTree.operationUpdate(
  (state, operations, text: string) => {
    if (text.length > 0)
      operations.textInsert(['notes'], state.notes.length, text)
  },
  { label: 'Insert collaborative text' }
)

export const deleteLastNoteCharacter = BoardTree.operationUpdate(
  (state, operations) => {
    if (state.notes.length > 0) {
      operations.textDelete(['notes'], state.notes.length - 1, 1)
    }
  },
  { label: 'Delete collaborative text' }
)
