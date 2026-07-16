import type {
  PatchSet,
  TreePatchError,
  TreePath,
  TreeSpec,
  TreeValidationPhase,
  TreeValue,
} from '@effect-state-tree/core'
import type {
  ChangeSet,
  ProducerError,
  SemanticOperation,
  TreeRecipe,
} from '@effect-state-tree/producer'
import {
  Data,
  type Effect,
  type HashSet,
  type Schema,
  type Stream,
} from 'effect'
import type { SourceToken } from './context'

/** Monotonically increasing revision local to one store instance. */
export type Revision = number
/** Traceable identifier shared by one atomic commit envelope. */
export type TransactionId = string

/** Raised when a state-changing operation targets a store whose scope has ended. */
export class TreeStoreShutdownError extends Data.TaggedError(
  'TreeStoreShutdownError'
) {}

/** Immutable post-commit event consumed by plugins, persistence, and adapters. */
export interface ChangeEnvelope<S extends Schema.Constraint> {
  readonly transactionId: TransactionId
  readonly revisionBefore: Revision
  readonly revisionAfter: Revision
  readonly before: TreeValue<S>
  readonly after: TreeValue<S>
  readonly change: ChangeSet
  readonly touchedPaths: ReadonlyArray<TreePath>
  readonly tags: HashSet.HashSet<string>
  readonly committedAt: number
  readonly validationPhase: TreeValidationPhase
  readonly label?: string
  readonly metadata?: unknown
  readonly source?: SourceToken
}

/** Retry-safe candidate exposed to a guard before the atomic write. */
export interface ProposedCommit<S extends Schema.Constraint> {
  readonly transactionId: TransactionId
  readonly revisionBefore: Revision
  readonly before: TreeValue<S>
  readonly after: TreeValue<S>
  readonly change: ChangeSet
  readonly touchedPaths: ReadonlyArray<TreePath>
  readonly tags: HashSet.HashSet<string>
  readonly validationPhase: TreeValidationPhase
  readonly label?: string
  readonly metadata?: unknown
  readonly source?: SourceToken
}

/** Retry-safe Effect that may reject a proposed commit before publication. */
export type CommitGuard<S extends Schema.Constraint, E = never, R = never> = (
  proposal: ProposedCommit<S>
) => Effect.Effect<void, E, R>

/** Once-only post-commit consumer run from the committed event stream. */
export type CommitSink<S extends Schema.Constraint, E = never, R = never> = (
  commit: ChangeEnvelope<S>
) => Effect.Effect<void, E, R>

export interface NoChange<S extends Schema.Constraint> {
  readonly _tag: 'NoChange'
  readonly revision: Revision
  readonly snapshot: TreeValue<S>
}

export interface Committed<S extends Schema.Constraint> {
  readonly _tag: 'Committed'
  readonly commit: ChangeEnvelope<S>
}

/** Result of a state operation that may be referentially unchanged. */
export type CommitResult<S extends Schema.Constraint> =
  | NoChange<S>
  | Committed<S>

/** Provenance, lifecycle, and guard policy attached to one state operation. */
export interface CommitOptions<
  S extends Schema.Constraint,
  E = never,
  R = never,
> {
  readonly label?: string
  readonly metadata?: unknown
  readonly source?: SourceToken
  readonly tags?: Iterable<string>
  /** Selects lifecycle-aware Schema checks for this commit. */
  readonly validationPhase?: TreeValidationPhase
  readonly guard?: CommitGuard<S, E, R>
}

/** Precomputed patch and semantic-operation data accepted by `TreeStore.apply`. */
export interface ApplyChangeInput {
  readonly patches: PatchSet
  readonly operations?: ReadonlyArray<SemanticOperation>
  readonly inverseOperations?: ReadonlyArray<SemanticOperation>
}

/** Atomic snapshot/revision pair read from the transactional store. */
export interface TreeStoreState<S extends Schema.Constraint> {
  readonly snapshot: TreeValue<S>
  readonly revision: Revision
}

/** Framework-neutral external store and Effect Stream projection. */
export interface StoreView<A> {
  readonly getSnapshot: () => A
  readonly subscribe: (listener: () => void) => () => void
  readonly changes: Stream.Stream<A>
}

/** Equality and explicit path invalidation policy for a selector view. */
export interface SelectOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
  readonly paths?: ReadonlyArray<TreePath>
}

/**
 * Live Effect runtime around the pure tree kernel.
 *
 * Effects own execution and services; each successful mutation publishes one
 * immutable patch batch at an atomic revision boundary.
 */
export interface TreeStore<S extends Schema.Constraint> {
  readonly spec: TreeSpec<S>
  readonly get: Effect.Effect<TreeValue<S>>
  readonly getState: Effect.Effect<TreeStoreState<S>>
  readonly getSnapshot: () => TreeValue<S>
  readonly getRevision: () => Revision
  readonly isShutdown: Effect.Effect<boolean>
  readonly shutdown: Effect.Effect<void>
  readonly commits: Stream.Stream<ChangeEnvelope<S>>
  readonly subscribe: (
    listener: (commit: ChangeEnvelope<S>) => void
  ) => () => void
  readonly update: <E = never, R = never>(
    recipe: TreeRecipe<TreeValue<S>>,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    ProducerError | TreeStoreShutdownError | E,
    R
  >
  readonly apply: <E = never, R = never>(
    change: ApplyChangeInput,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | E,
    R
  >
  readonly replace: <E = never, R = never>(
    snapshot: TreeValue<S>,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | E,
    R
  >
  readonly select: <A>(
    selector: (snapshot: TreeValue<S>) => A,
    options?: SelectOptions<A>
  ) => StoreView<A>
}

/** Portable pure plugin state machine over committed tree envelopes. */
export interface CommitReducer<
  State,
  S extends Schema.Constraint,
  Command = never,
> {
  readonly initial: State
  readonly reduce: (
    state: State,
    commit: ChangeEnvelope<S>
  ) => readonly [state: State, commands: ReadonlyArray<Command>]
}
