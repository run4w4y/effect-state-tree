import type { CrdtUndoController } from '@effect-state-tree/crdt'
import { Effect } from 'effect'
import * as Y from 'yjs'
import { YjsUndoError } from './errors'
import type { YjsValue } from './yjs'

/** Peer-local intention undo backed by `Y.UndoManager`. */
export interface YjsUndoController extends CrdtUndoController<YjsUndoError> {
  readonly manager: Y.UndoManager
}

/** Creates an undo manager that captures only this adapter's transaction origin. */
export const makeYjsUndoController = (
  root: Y.Map<YjsValue>,
  origin: object
): YjsUndoController => {
  const manager = new Y.UndoManager(root, {
    captureTimeout: 0,
    trackedOrigins: new Set([origin]),
  })
  let disposed = false

  const run = <A>(
    operation: YjsUndoError['operation'],
    evaluate: () => A
  ): Effect.Effect<A, YjsUndoError> =>
    Effect.try({
      try: evaluate,
      catch: (cause) => new YjsUndoError({ operation, cause }),
    })

  return {
    manager,
    canUndo: run('canUndo', () => !disposed && manager.canUndo()),
    canRedo: run('canRedo', () => !disposed && manager.canRedo()),
    undo: run('undo', () => !disposed && manager.undo() !== null),
    redo: run('redo', () => !disposed && manager.redo() !== null),
    clear: run('clear', () => {
      if (!disposed) manager.clear()
    }),
    dispose: run('dispose', () => {
      if (disposed) return
      disposed = true
      manager.destroy()
    }),
  }
}
