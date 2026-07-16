import {
  collaborativeText,
  entity,
  makeTreeSpec,
} from '@effect-state-tree/core'
import { movableList } from '@effect-state-tree/crdt'
import { defineTree, type TreeStore } from '@effect-state-tree/runtime'
import { Schema } from 'effect'

export const CardColor = Schema.Literals(['coral', 'gold', 'mint', 'blue'])
export type CardColor = typeof CardColor.Type

export const Card = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  color: CardColor,
}).pipe(entity({ type: 'Card', id: 'id' }))

export type Card = typeof Card.Type

export const Board = Schema.Struct({
  cards: Schema.Array(Card).pipe(movableList),
  notes: Schema.String.pipe(collaborativeText),
})

export type BoardState = typeof Board.Type
export type BoardStore = TreeStore<typeof Board>

export const boardSpec = makeTreeSpec(Board)

export const BoardTree = defineTree(
  '@effect-state-tree/react-loro-collaboration-example/BoardTree',
  boardSpec
)

export const initialBoard: BoardState = {
  cards: [
    { id: 'architecture', title: 'Shape the tree kernel', color: 'coral' },
    { id: 'effects', title: 'Wire Effect actions', color: 'gold' },
    { id: 'collaboration', title: 'Sync peer intent', color: 'mint' },
  ],
  notes: 'Shared notes: ',
}
