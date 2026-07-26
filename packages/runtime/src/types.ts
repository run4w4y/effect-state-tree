import type {
  GetAtPathFailure,
  PatchSet,
  TreePatchError,
  TreePath,
  TreePathValue,
  TreeSpec,
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
import type { TreeCheckpoint, TreeCheckpointError } from './checkpoint'
import type { SourceToken } from './context'

/** Monotonically increasing revision local to one store instance. */
export type Revision = number
/** Traceable identifier shared by one atomic commit envelope. */
export type TransactionId = string
/** Traceable identifier shared by every commit made by one tree action. */
export type ActionId = string

/** Action metadata inherited by every commit in its dynamic Effect scope. */
export interface TreeActionInfo {
  /** Identifier unique to one action execution. */
  readonly id: ActionId
  /** Effect span name and inherited default commit label. */
  readonly name: string
}

/** Raised when a state-changing operation targets a store whose scope has ended. */
export class TreeStoreShutdownError extends Data.TaggedError(
  'TreeStoreShutdownError'
) {}

/** Immutable post-commit event consumed by plugins, persistence, and adapters. */
export interface ChangeEnvelope<S extends Schema.Constraint> {
  /** Identifier unique to this atomic commit. */
  readonly transactionId: TransactionId
  /** Revision observed before the commit. */
  readonly revisionBefore: Revision
  /** Revision installed by the commit. */
  readonly revisionAfter: Revision
  /** Immutable snapshot observed before the commit. */
  readonly before: TreeValue<S>
  /** Immutable snapshot installed by the commit. */
  readonly after: TreeValue<S>
  /** Forward/inverse patches and optional semantic operations. */
  readonly change: ChangeSet
  /** Tuple paths affected by the committed patch batch. */
  readonly touchedPaths: ReadonlyArray<TreePath>
  /** Operational tags consumed by plugins and adapters. */
  readonly tags: HashSet.HashSet<string>
  /** Millisecond timestamp captured from the Effect Clock after commit. */
  readonly committedAt: number
  /** Optional human-readable commit label. */
  readonly label?: string
  /** Optional immutable application metadata. */
  readonly metadata?: unknown
  /** Optional provenance token used for echo suppression. */
  readonly source?: SourceToken
  /** Enclosing action shared by all commits in one action workflow. */
  readonly action?: TreeActionInfo
}

/** Retry-safe candidate exposed to a guard before the atomic write. */
export interface ProposedCommit<S extends Schema.Constraint> {
  /** Identifier reserved for the candidate commit. */
  readonly transactionId: TransactionId
  /** Revision against which the proposal is being evaluated. */
  readonly revisionBefore: Revision
  /** Immutable snapshot observed before the proposed transition. */
  readonly before: TreeValue<S>
  /** Immutable snapshot that would be installed. */
  readonly after: TreeValue<S>
  /** Forward/inverse patches and optional semantic operations. */
  readonly change: ChangeSet
  /** Tuple paths affected by the proposed patch batch. */
  readonly touchedPaths: ReadonlyArray<TreePath>
  /** Operational tags that would be published with the commit. */
  readonly tags: HashSet.HashSet<string>
  /** Optional human-readable commit label. */
  readonly label?: string
  /** Optional immutable application metadata. */
  readonly metadata?: unknown
  /** Optional provenance token used for echo suppression. */
  readonly source?: SourceToken
  /** Enclosing action shared by all commits in one action workflow. */
  readonly action?: TreeActionInfo
}

/** Retry-safe Effect that may reject a proposed commit before publication. */
export type CommitGuard<S extends Schema.Constraint, E = never, R = never> = (
  proposal: ProposedCommit<S>
) => Effect.Effect<void, E, R>

/** Once-only post-commit consumer run from the committed event stream. */
export type CommitSink<S extends Schema.Constraint, E = never, R = never> = (
  commit: ChangeEnvelope<S>
) => Effect.Effect<void, E, R>

/** Referentially unchanged state operation that did not publish a commit. */
export interface NoChange<S extends Schema.Constraint> {
  /** Discriminant for an unchanged operation. */
  readonly _tag: 'NoChange'
  /** Current store revision, which was not incremented. */
  readonly revision: Revision
  /** Current canonical snapshot. */
  readonly snapshot: TreeValue<S>
}

/** State operation that atomically installed and published a transition. */
export interface Committed<S extends Schema.Constraint> {
  /** Discriminant for a committed operation. */
  readonly _tag: 'Committed'
  /** Complete immutable envelope published for the transition. */
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
  /** Human-readable label overriding the current commit context. */
  readonly label?: string
  /** Immutable metadata overriding the current commit context. */
  readonly metadata?: unknown
  /** Provenance token overriding the current commit context. */
  readonly source?: SourceToken
  /** Additional operational tags unioned with inherited context tags. */
  readonly tags?: Iterable<string>
  /** Retry-safe policy evaluated against the final transactional proposal. */
  readonly guard?: CommitGuard<S, E, R>
}

/** Precomputed patch and semantic-operation data accepted by `TreeStore.apply`. */
export interface ApplyChangeInput {
  /** Authoritative forward and inverse tuple-path patch batch. */
  readonly patches: PatchSet
  /** Optional intent-preserving operations corresponding to forward patches. */
  readonly operations?: ReadonlyArray<SemanticOperation>
  /** Optional intent-preserving operations corresponding to inverse patches. */
  readonly inverseOperations?: ReadonlyArray<SemanticOperation>
}

/** Atomic snapshot/revision pair read from the transactional store. */
export interface TreeStoreState<S extends Schema.Constraint> {
  /** Current canonical immutable snapshot. */
  readonly snapshot: TreeValue<S>
  /** Current monotonically increasing store revision. */
  readonly revision: Revision
}

/** Framework-neutral external store and Effect Stream projection. */
export interface StoreView<A> {
  /** Synchronously reads the current projection. */
  readonly getSnapshot: () => A
  /** Subscribes to projection changes and returns an idempotent disposer. */
  readonly subscribe: (listener: () => void) => () => void
  /** Scoped Effect Stream containing the current and subsequent values. */
  readonly changes: Stream.Stream<A>
}

/** Equality and explicit path invalidation policy for a selector view. */
export interface SelectOptions<A> {
  /** Equality used to suppress referentially or structurally unchanged values. */
  readonly equals?: (left: A, right: A) => boolean
  /** Explicit dependencies used to skip selectors for unrelated commits. */
  readonly paths?: ReadonlyArray<TreePath>
}

/**
 * Live Effect runtime around the pure tree kernel.
 *
 * Effects own execution and services; each successful mutation publishes one
 * immutable patch batch at an atomic revision boundary.
 */
export interface TreeStore<S extends Schema.Constraint> {
  /** Compiled Schema and snapshot specification owned by this store. */
  readonly spec: TreeSpec<S>
  /** Effect that reads the current canonical snapshot. */
  readonly get: Effect.Effect<TreeValue<S>>
  /** Effect that atomically reads the current snapshot and revision. */
  readonly getState: Effect.Effect<TreeStoreState<S>>
  /** Synchronously reads the current canonical snapshot. */
  readonly getSnapshot: () => TreeValue<S>
  /** Synchronously reads the current store revision. */
  readonly getRevision: () => Revision
  /** Reports whether the store and its commit publication have shut down. */
  readonly isShutdown: Effect.Effect<boolean>
  /** Idempotently closes the store and all commit subscribers. */
  readonly shutdown: Effect.Effect<void>
  /** Stream of committed transitions published after atomic installation. */
  readonly commits: Stream.Stream<ChangeEnvelope<S>>
  /** Subscribes synchronously to committed transitions in revision order. */
  readonly subscribe: (
    listener: (commit: ChangeEnvelope<S>) => void
  ) => () => void
  /** Captures an immutable root or path checkpoint at one atomic revision. */
  readonly checkpoint: {
    (): Effect.Effect<TreeCheckpoint<S, readonly []>, GetAtPathFailure>
    <const P extends TreePath>(
      path: P
    ): Effect.Effect<TreeCheckpoint<S, P>, GetAtPathFailure>
  }
  /** Runs a synchronous mutable recipe and atomically commits its patch batch. */
  readonly update: <E = never, R = never>(
    recipe: TreeRecipe<TreeValue<S>>,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    ProducerError | TreeStoreShutdownError | E,
    R
  >
  /** Atomically applies a precomputed patch and semantic-operation batch. */
  readonly apply: <E = never, R = never>(
    change: ApplyChangeInput,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | E,
    R
  >
  /** Reconciles and atomically installs an incoming canonical snapshot. */
  readonly replace: <E = never, R = never>(
    snapshot: TreeValue<S>,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | E,
    R
  >
  /** Commits a recipe only while the checkpoint path remains unchanged. */
  readonly updateIfCurrent: <P extends TreePath, E = never, R = never>(
    checkpoint: TreeCheckpoint<S, P>,
    recipe: TreeRecipe<TreeValue<S>>,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    ProducerError | TreeStoreShutdownError | TreeCheckpointError | E,
    R
  >
  /** Applies a change only while the checkpoint path remains unchanged. */
  readonly applyIfCurrent: <P extends TreePath, E = never, R = never>(
    checkpoint: TreeCheckpoint<S, P>,
    change: ApplyChangeInput,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | TreeCheckpointError | E,
    R
  >
  /** Replaces a checkpoint path only while its captured value remains current. */
  readonly replaceAtCheckpoint: <
    const P extends TreePath,
    E = never,
    R = never,
  >(
    checkpoint: TreeCheckpoint<S, P>,
    value: TreePathValue<TreeValue<S>, P>,
    options?: CommitOptions<S, E, R>
  ) => Effect.Effect<
    CommitResult<S>,
    TreePatchError | TreeStoreShutdownError | TreeCheckpointError | E,
    R
  >
  /** Creates a framework-neutral reactive projection of the tree snapshot. */
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
  /** Initial plugin state before any commits are reduced. */
  readonly initial: State
  /** Pure transition from plugin state and commit to state and commands. */
  readonly reduce: (
    state: State,
    commit: ChangeEnvelope<S>
  ) => readonly [state: State, commands: ReadonlyArray<Command>]
}
