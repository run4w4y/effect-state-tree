import { makeLoroAdapter } from '@effect-state-tree/loro'
import { Effect } from 'effect'
import { LoroDoc } from 'loro-crdt'

import { BoardTree, initialBoard } from '../domain/board'

const SeedPeerId = 1

export const makeInitialBoardUpdate = Effect.gen(function* () {
  const seed = new LoroDoc()
  seed.setPeerId(SeedPeerId)
  const adapter = makeLoroAdapter(BoardTree.spec, {
    doc: seed,
    rootName: 'board',
    origin: 'effect-state-tree-board-seed',
  })
  return yield* adapter.writeSnapshot(initialBoard).pipe(
    Effect.map(() => seed.export({ mode: 'update' })),
    Effect.ensuring(adapter.undo.dispose.pipe(Effect.ignore)),
    Effect.ensuring(Effect.sync(() => seed.free()))
  )
})

export const makeBoardDocument = (peerId: bigint) =>
  Effect.map(makeInitialBoardUpdate, (update) => {
    const doc = new LoroDoc()
    doc.import(update)
    doc.setPeerId(peerId)
    return doc
  })
