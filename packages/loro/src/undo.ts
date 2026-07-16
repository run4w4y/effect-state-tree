import type { CrdtUndoController } from '@effect-state-tree/crdt'
import { Effect } from 'effect'
import { type LoroDoc, UndoManager } from 'loro-crdt'
import { LoroUndoError } from './errors'

/** Peer-local intention undo backed by Loro's current-peer UndoManager. */
export interface LoroUndoController extends CrdtUndoController<LoroUndoError> {
  readonly manager: UndoManager
}

/** Creates a Loro undo manager bound permanently to the document's current peer. */
export const makeLoroUndoController = (doc: LoroDoc): LoroUndoController => {
  const manager = new UndoManager(doc, { mergeInterval: 0 })
  let disposed = false

  const run = <A>(
    operation: LoroUndoError['operation'],
    evaluate: () => A
  ): Effect.Effect<A, LoroUndoError> =>
    Effect.try({
      try: evaluate,
      catch: (cause) => new LoroUndoError({ operation, cause }),
    })

  return {
    manager,
    canUndo: run('canUndo', () => !disposed && manager.canUndo()),
    canRedo: run('canRedo', () => !disposed && manager.canRedo()),
    undo: run('undo', () => !disposed && manager.undo()),
    redo: run('redo', () => !disposed && manager.redo()),
    clear: run('clear', () => {
      if (!disposed) manager.clear()
    }),
    dispose: run('dispose', () => {
      if (disposed) return
      disposed = true
      manager.free()
    }),
  }
}
