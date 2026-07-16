import { makeTreeOperationAction } from '@effect-state-tree/runtime'
import { clamp } from 'es-toolkit'

import { BoardTree, type Card } from '../domain/board'

export const moveCard = makeTreeOperationAction(
  BoardTree,
  (state, operations, id: string, offset: number) => {
    const from = state.cards.findIndex((card) => card.id === id)
    if (from === -1) return
    const to = clamp(from + offset, 0, state.cards.length - 1)
    if (from !== to) operations.arrayMove(['cards'], from, to)
  },
  { label: 'Move card' }
)

export const renameCard = makeTreeOperationAction(
  BoardTree,
  (state, operations, id: string, title: string) => {
    const index = state.cards.findIndex((card) => card.id === id)
    if (index !== -1) operations.objectSet(['cards', index], 'title', title)
  },
  (_id, title) => ({ label: `Rename to "${title}"` })
)

export const addCard = makeTreeOperationAction(
  BoardTree,
  (state, operations, title: string, color: Card['color']) => {
    operations.arraySplice(['cards'], state.cards.length, 0, {
      id: crypto.randomUUID(),
      title,
      color,
    })
  },
  (title) => ({ label: `Add "${title}"` })
)

export const removeCard = makeTreeOperationAction(
  BoardTree,
  (state, operations, id: string) => {
    const index = state.cards.findIndex((card) => card.id === id)
    if (index !== -1) operations.arraySplice(['cards'], index, 1)
  },
  { label: 'Remove card' }
)

export const appendNote = makeTreeOperationAction(
  BoardTree,
  (state, operations, text: string) => {
    if (text.length > 0)
      operations.textInsert(['notes'], state.notes.length, text)
  },
  { label: 'Insert collaborative text' }
)

export const deleteLastNoteCharacter = makeTreeOperationAction(
  BoardTree,
  (state, operations) => {
    if (state.notes.length > 0) {
      operations.textDelete(['notes'], state.notes.length - 1, 1)
    }
  },
  { label: 'Delete collaborative text' }
)
