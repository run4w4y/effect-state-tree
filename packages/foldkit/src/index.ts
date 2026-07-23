import {
  applyTreePatches,
  captureTreeSnapshot,
  reconcileTreeSnapshot,
  type TreeInvariantError,
  type TreePatchError,
  type TreePath,
  type TreeSpec,
  type TreeValue,
} from '@effect-state-tree/core'
import type { ChangeSet } from '@effect-state-tree/producer'
import { Effect, HashSet, Result, type Schema } from 'effect'

/** Opaque provenance carried through a pure Foldkit tree message. */
export type FoldkitSourceToken = string | symbol | object

/** All non-state inputs required to construct a deterministic commit. */
export interface FoldkitCommitContext {
  /** Stable identifier assigned to the commit before reduction. */
  readonly transactionId: string
  /** Timestamp supplied by the caller for deterministic replay. */
  readonly committedAt: number
  /** Optional human-readable operation label. */
  readonly label?: string
  /** Optional application-defined commit metadata. */
  readonly metadata?: unknown
  /** Optional provenance token used by integrations for echo suppression. */
  readonly source?: FoldkitSourceToken
  /** Optional plugin policy tags attached to the commit. */
  readonly tags?: Iterable<string>
}

/** Runtime-neutral committed transition passed to pure plugin reducers. */
export interface FoldkitTreeCommit<S extends Schema.Constraint> {
  /** Stable identifier copied from the originating message context. */
  readonly transactionId: string
  /** Tree revision observed before the transition. */
  readonly revisionBefore: number
  /** Tree revision produced by the transition. */
  readonly revisionAfter: number
  /** Canonical tree snapshot before the transition. */
  readonly before: TreeValue<S>
  /** Canonical tree snapshot after the transition. */
  readonly after: TreeValue<S>
  /** Forward, inverse, and semantic operations describing the transition. */
  readonly change: ChangeSet
  /** Paths affected by the committed patches. */
  readonly touchedPaths: ReadonlyArray<TreePath>
  /** Normalized plugin policy tags attached to the transition. */
  readonly tags: HashSet.HashSet<string>
  /** Deterministic commit timestamp supplied by the caller. */
  readonly committedAt: number
  /** Whether the message originated locally or from an external source. */
  readonly direction: 'local' | 'external'
  /** Optional human-readable operation label. */
  readonly label?: string
  /** Optional application-defined commit metadata. */
  readonly metadata?: unknown
  /** Optional provenance token retained from the message context. */
  readonly source?: FoldkitSourceToken
}

/** Canonical tree, revision, and plugin state stored inside the Foldkit Model. */
export interface FoldkitTreeState<
  S extends Schema.Constraint,
  PluginState = never,
> {
  /** Current canonical tree snapshot. */
  readonly tree: TreeValue<S>
  /** Monotonic revision incremented after each committed transition. */
  readonly revision: number
  /** State owned by the configured pure plugin reducer. */
  readonly plugin: PluginState
}

/** Local or external change entering the application through Foldkit update. */
export type FoldkitTreeMessage<S extends Schema.Constraint> =
  | {
      readonly _tag: 'TreeChange'
      readonly change: ChangeSet
      readonly context: FoldkitCommitContext
    }
  | {
      readonly _tag: 'TreeSnapshot'
      readonly snapshot: TreeValue<S>
      readonly context: FoldkitCommitContext
    }
  | {
      readonly _tag: 'ExternalTreeChange'
      readonly change: ChangeSet
      readonly context: FoldkitCommitContext
    }
  | {
      readonly _tag: 'ExternalTreeSnapshot'
      readonly snapshot: TreeValue<S>
      readonly context: FoldkitCommitContext
    }

/** Plugin state plus Commands and OutMessages emitted by one pure reduction. */
export interface FoldkitPluginReduction<State, Command, OutMessage> {
  /** Next plugin state. */
  readonly state: State
  /** Effect commands requested by the plugin reduction. */
  readonly commands: ReadonlyArray<Command>
  /** Messages emitted from the tree feature to its parent feature. */
  readonly outMessages: ReadonlyArray<OutMessage>
}

/** Pure plugin reducer compatible with Foldkit's Model/update architecture. */
export interface FoldkitCommitReducer<
  State,
  S extends Schema.Constraint,
  Command = never,
  OutMessage = never,
> {
  /** Initial plugin state stored alongside the tree. */
  readonly initial: State
  /** Purely reduces one committed tree transition into plugin outputs. */
  readonly reduce: (
    state: State,
    commit: FoldkitTreeCommit<S>
  ) => FoldkitPluginReduction<State, Command, OutMessage>
}

/** Referentially stable no-op or fully described committed update result. */
export type FoldkitTreeUpdateResult<
  S extends Schema.Constraint,
  PluginState,
  Command,
  OutMessage,
> =
  | {
      readonly _tag: 'NoChange'
      readonly state: FoldkitTreeState<S, PluginState>
      readonly commands: readonly []
      readonly outMessages: readonly []
    }
  | {
      readonly _tag: 'Committed'
      readonly state: FoldkitTreeState<S, PluginState>
      readonly commands: ReadonlyArray<Command>
      readonly outMessages: ReadonlyArray<OutMessage>
      readonly commit: FoldkitTreeCommit<S>
    }

/** Pure tree feature exposing initial Model state and deterministic update. */
export interface FoldkitTreeFeature<
  S extends Schema.Constraint,
  PluginState,
  Command,
  OutMessage,
> {
  /** Initial tree, revision, and plugin state for the Foldkit Model. */
  readonly initial: FoldkitTreeState<S, PluginState>
  /** Deterministically reduces a tree message against the current state. */
  readonly update: (
    state: FoldkitTreeState<S, PluginState>,
    message: FoldkitTreeMessage<S>
  ) => Result.Result<
    FoldkitTreeUpdateResult<S, PluginState, Command, OutMessage>,
    TreePatchError
  >
}

const isChangeMessage = <S extends Schema.Constraint>(
  message: FoldkitTreeMessage<S>
): message is Extract<
  FoldkitTreeMessage<S>,
  { readonly _tag: 'TreeChange' | 'ExternalTreeChange' }
> => message._tag === 'TreeChange' || message._tag === 'ExternalTreeChange'

const isExternalMessage = <S extends Schema.Constraint>(
  message: FoldkitTreeMessage<S>
): boolean =>
  message._tag === 'ExternalTreeChange' ||
  message._tag === 'ExternalTreeSnapshot'

/**
 * Creates a pure model/message/update feature. IDs, time, and provenance enter
 * through the message, so replaying the same state and message is referentially
 * transparent and produces the same result.
 */
export const makeFoldkitTree = <
  S extends Schema.Constraint,
  PluginState = never,
  Command = never,
  OutMessage = never,
>(options: {
  readonly spec: TreeSpec<S>
  readonly initial: TreeValue<S>
  readonly plugin: PluginState
  readonly reducer?: FoldkitCommitReducer<PluginState, S, Command, OutMessage>
}): Result.Result<
  FoldkitTreeFeature<S, PluginState, Command, OutMessage>,
  TreeInvariantError
> =>
  Result.map(
    captureTreeSnapshot(options.spec, options.initial),
    (admitted) => ({
      initial: {
        tree: admitted.snapshot,
        revision: 0,
        plugin: options.plugin,
      },
      update(state, message) {
        const changed = isChangeMessage(message)
          ? applyTreePatches(
              options.spec,
              state.tree,
              message.change.patches.forward
            )
          : reconcileTreeSnapshot(options.spec, state.tree, message.snapshot)

        return Result.map(changed, (applied) => {
          if (applied.patchSet.forward.length === 0) {
            return {
              _tag: 'NoChange',
              state,
              commands: [],
              outMessages: [],
            } as const
          }

          const change: ChangeSet = isChangeMessage(message)
            ? Object.freeze({
                patches: applied.patchSet,
                operations: message.change.operations,
                inverseOperations: message.change.inverseOperations,
              })
            : Object.freeze({
                patches: applied.patchSet,
                operations: [],
                inverseOperations: [],
              })
          const commit: FoldkitTreeCommit<S> = Object.freeze({
            transactionId: message.context.transactionId,
            revisionBefore: state.revision,
            revisionAfter: state.revision + 1,
            before: state.tree,
            after: applied.snapshot,
            change,
            touchedPaths: applied.touchedPaths,
            tags: HashSet.fromIterable(message.context.tags ?? []),
            committedAt: message.context.committedAt,
            direction: isExternalMessage(message) ? 'external' : 'local',
            ...(message.context.label !== undefined
              ? { label: message.context.label }
              : {}),
            ...(message.context.metadata !== undefined
              ? { metadata: message.context.metadata }
              : {}),
            ...(message.context.source !== undefined
              ? { source: message.context.source }
              : {}),
          })
          const reduced = options.reducer?.reduce(state.plugin, commit) ?? {
            state: state.plugin,
            commands: [],
            outMessages: [],
          }
          return {
            _tag: 'Committed',
            state: {
              tree: applied.snapshot,
              revision: commit.revisionAfter,
              plugin: reduced.state,
            },
            commands: reduced.commands,
            outMessages: reduced.outMessages,
            commit,
          } as const
        })
      },
    })
  )

/** Marks a replicated change as an ordinary Foldkit message. */
export const externalTreeChange = <S extends Schema.Constraint>(
  change: ChangeSet,
  context: FoldkitCommitContext
): FoldkitTreeMessage<S> => ({ _tag: 'ExternalTreeChange', change, context })

/** Marks a materialized replicated snapshot as an ordinary Foldkit message. */
export const externalTreeSnapshot = <S extends Schema.Constraint>(
  snapshot: TreeValue<S>,
  context: FoldkitCommitContext
): FoldkitTreeMessage<S> => ({
  _tag: 'ExternalTreeSnapshot',
  snapshot,
  context,
})

/** Tree feature lifted into a parent Foldkit Model. */
export interface FoldkitSubmodel<
  Parent,
  S extends Schema.Constraint,
  ParentCommand,
  ParentOutMessage,
> {
  /** Reduces a child tree message and lifts its outputs into the parent Model. */
  readonly update: (
    parent: Parent,
    message: FoldkitTreeMessage<S>
  ) => Result.Result<
    FoldkitSubmodelResult<Parent, ParentCommand, ParentOutMessage, S>,
    TreePatchError
  >
}

/** Parent Model plus mapped Commands, OutMessages, and optional commit. */
export interface FoldkitSubmodelResult<
  Parent,
  Command,
  OutMessage,
  S extends Schema.Constraint,
> {
  /** Updated parent Model. */
  readonly parent: Parent
  /** Child commands mapped into the parent command type. */
  readonly commands: ReadonlyArray<Command>
  /** Child outward messages mapped into the parent message type. */
  readonly outMessages: ReadonlyArray<OutMessage>
  /** Commit produced by the child update, absent for a no-op. */
  readonly commit?: FoldkitTreeCommit<S>
}

/**
 * Lifts a tree feature into a parent model while mapping child Commands and
 * OutMessages explicitly, matching Foldkit's submodel composition style.
 */
export const makeFoldkitSubmodel = <
  Parent,
  S extends Schema.Constraint,
  PluginState,
  Command,
  ParentCommand,
  OutMessage,
  ParentOutMessage,
>(
  feature: FoldkitTreeFeature<S, PluginState, Command, OutMessage>,
  options: {
    readonly get: (parent: Parent) => FoldkitTreeState<S, PluginState>
    readonly set: (
      parent: Parent,
      state: FoldkitTreeState<S, PluginState>
    ) => Parent
    readonly mapCommand: (command: Command) => ParentCommand
    readonly mapOutMessage: (message: OutMessage) => ParentOutMessage
  }
): FoldkitSubmodel<Parent, S, ParentCommand, ParentOutMessage> => ({
  update(parent, message) {
    return Result.map(
      feature.update(options.get(parent), message),
      (result) => ({
        parent: options.set(parent, result.state),
        commands: result.commands.map(options.mapCommand),
        outMessages: result.outMessages.map(options.mapOutMessage),
        ...(result._tag === 'Committed' ? { commit: result.commit } : {}),
      })
    )
  },
})

/** Maps an Effect command's outward message without depending on Foldkit itself. */
export const mapFoldkitEffectCommand = <A, B, E, R>(
  command: Effect.Effect<A, E, R>,
  map: (value: A) => B
): Effect.Effect<B, E, R> => Effect.map(command, map)
