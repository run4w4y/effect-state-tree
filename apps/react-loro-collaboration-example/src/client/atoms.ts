import { makeTreeAtoms } from '@effect-state-tree/atom'
import { BoardTree } from '../domain/board'
import {
  addCard,
  appendNote,
  deleteLastNoteCharacter,
  moveCard,
  removeCard,
  renameCard,
} from './actions'
import type { CollaborationPeer } from './peer'

/**
 * Stable Atom surface for one independently admitted collaboration peer. CRDT
 * state, runtime views, and Effect actions share the same Atom registry and can
 * be consumed through any official Effect Atom framework binding.
 */
export const makeCollaborationAtoms = (peer: CollaborationPeer) => {
  const tree = makeTreeAtoms(BoardTree, peer.store)

  return {
    tree,
    cards: tree.select((board) => board.cards, { paths: [['cards']] }),
    notes: tree.select((board) => board.notes, { paths: [['notes']] }),
    revision: tree.select(() => peer.store.getRevision()),
    commits: tree.view(peer.commits),
    connection: tree.view(peer.transport.state),
    actions: {
      move: tree.fn(moveCard, { concurrent: true }),
      rename: tree.fn(renameCard, { concurrent: true }),
      add: tree.fn(addCard, { concurrent: true }),
      remove: tree.fn(removeCard, { concurrent: true }),
      append: tree.fn(appendNote, { concurrent: true }),
      deleteCharacter: tree.fn(deleteLastNoteCharacter, { concurrent: true }),
      undo: tree.fn(peer.undo),
      redo: tree.fn(peer.redo),
    },
  }
}

export type CollaborationAtoms = ReturnType<typeof makeCollaborationAtoms>
