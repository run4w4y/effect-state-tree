import type { Effect } from 'effect'

/**
 * Backend-native local-intention undo that compensates this peer's operations
 * against the document's current collaborative state.
 */
export interface CrdtUndoController<E = never> {
  /** Reports whether this peer has an operation available to undo. */
  readonly canUndo: Effect.Effect<boolean, E>
  /** Reports whether this peer has an operation available to redo. */
  readonly canRedo: Effect.Effect<boolean, E>
  /** Compensates the latest local operation and reports whether it ran. */
  readonly undo: Effect.Effect<boolean, E>
  /** Reapplies the latest locally undone operation and reports whether it ran. */
  readonly redo: Effect.Effect<boolean, E>
  /** Clears this peer's native undo and redo history. */
  readonly clear: Effect.Effect<void, E>
  /** Releases native undo resources. */
  readonly dispose: Effect.Effect<void, E>
}
