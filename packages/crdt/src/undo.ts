import type { Effect } from 'effect'

/** Backend-native, peer-local intention undo. */
/**
 * Backend-native local-intention undo that compensates this peer's operations
 * against the document's current collaborative state.
 */
export interface CrdtUndoController<E = never> {
  readonly canUndo: Effect.Effect<boolean, E>
  readonly canRedo: Effect.Effect<boolean, E>
  readonly undo: Effect.Effect<boolean, E>
  readonly redo: Effect.Effect<boolean, E>
  readonly clear: Effect.Effect<void, E>
  readonly dispose: Effect.Effect<void, E>
}
