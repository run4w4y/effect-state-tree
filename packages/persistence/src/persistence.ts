import type {
  TreePatchError,
  TreeSpec,
  TreeValue,
} from '@effect-state-tree/core'
import type {
  ChangeEnvelope,
  SourceToken,
  TreeStore,
  TreeStoreShutdownError,
} from '@effect-state-tree/runtime'
import {
  Deferred,
  Effect,
  Fiber,
  HashSet,
  Option,
  Queue,
  Result,
  Schema,
  type Scope,
} from 'effect'
import {
  PersistenceBindingClosedError,
  PersistenceDecodeError,
  PersistenceEncodeError,
  PersistenceEnvelopeDecodeError,
  PersistenceMigrationDecodeError,
  PersistenceMigrationPathError,
  PersistenceVersionError,
} from './errors'
import type { PersistedEnvelope, PersistenceStorage } from './storage'
import { PersistedEnvelopeSchema } from './storage'

/** Commit tag applied when persisted state initializes the live tree. */
export const PersistenceInboundTag = 'persistence.inbound' as const
/** Commit tag preventing a transition from being written to storage. */
export const PersistenceSkipTag = 'persistence.skip' as const

/** Direction of initial synchronization when attaching persistence. */
export type PersistenceInitialization = 'storage' | 'store' | 'none'

/** Failures possible while loading, migrating, and decoding persisted state. */
export type PersistenceReadError<E, MigrationError> =
  | E
  | MigrationError
  | PersistenceEnvelopeDecodeError
  | PersistenceMigrationDecodeError
  | PersistenceMigrationPathError
  | PersistenceVersionError
  | PersistenceDecodeError

/** Failures possible while encoding and writing the current tree snapshot. */
export type PersistenceWriteError<E> = E | PersistenceEncodeError

/** Failures reported when draining an ordered persistence writer. */
export type PersistenceFlushError<E> =
  | PersistenceWriteError<E>
  | PersistenceBindingClosedError

/**
 * A Schema-backed transition from one persisted envelope version to another.
 *
 * The migration first decodes the old payload with `schema`, then transforms
 * the typed value into the encoded payload expected by the next version. This
 * keeps legacy formats explicit without weakening the canonical tree Schema.
 */
export interface PersistenceMigration<E = never, R = never> {
  /** Stored format version accepted by this migration. */
  readonly from: number
  /** Stored format version emitted by this migration. */
  readonly to: number
  /** Decodes the old payload and emits the next version's encoded payload. */
  readonly migrate: (
    encoded: unknown
  ) => Effect.Effect<unknown, E | PersistenceMigrationDecodeError, R>
}

/** Inputs used to construct one typed persistence migration. */
export interface MakePersistenceMigrationOptions<S extends Schema.Top, E, R> {
  /** Version understood by the migration input Schema. */
  readonly from: number
  /** Version emitted by the migration transformation. */
  readonly to: number
  /** Schema that decodes and validates the old encoded payload. */
  readonly schema: S
  /** Produces the encoded payload expected by version `to`. */
  readonly migrate: (value: S['Type']) => Effect.Effect<unknown, E, R>
}

/** Constructs a migration whose input is admitted by a declared Effect Schema. */
export const makePersistenceMigration = <
  S extends Schema.Top,
  E = never,
  R = never,
>(
  options: MakePersistenceMigrationOptions<S, E, R>
): PersistenceMigration<E, R | S['DecodingServices']> => ({
  from: options.from,
  to: options.to,
  migrate: (encoded) =>
    Effect.flatMap(
      Schema.decodeUnknownEffect(options.schema)(encoded).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceMigrationDecodeError({
              cause,
              from: options.from,
              to: options.to,
            })
        )
      ),
      options.migrate
    ),
})

interface PersistWork<S extends Schema.Top> {
  readonly _tag: 'PersistWork'
  readonly snapshot: TreeValue<S>
  readonly revision: number
}

interface FlushBarrier<E> {
  readonly _tag: 'FlushBarrier'
  readonly acknowledgement: Deferred.Deferred<void, PersistenceFlushError<E>>
  readonly close: boolean
}

type WriterMessage<S extends Schema.Top, E> = PersistWork<S> | FlushBarrier<E>

type BindingState = 'open' | 'closing' | 'closed' | 'aborted'

/**
 * Handle for an ordered persistence writer.
 *
 * Write failures are transient: the writer continues after a failed save.
 * `flush` reports the first failure not reported by an earlier barrier, then
 * consumes it. A later flush succeeds when no later writes failed.
 */
export interface PersistenceBinding<E> {
  /** Waits for all commits observed before invocation and reports their errors. */
  readonly flush: Effect.Effect<void, PersistenceFlushError<E>>
  /** Stops observation, drains queued writes in order, and joins the writer. */
  readonly close: Effect.Effect<void, PersistenceFlushError<E>>
  /** Interrupts the active write and drops queued writes without draining. */
  readonly abort: Effect.Effect<void>
}

/** Initialization, migration, and echo-suppression policy for persistence. */
export interface BindPersistenceOptions<
  MigrationError = never,
  MigrationRequirements = never,
> {
  /** Initial synchronization direction. Defaults to loading storage. */
  readonly initialize?: PersistenceInitialization
  /** Current persisted format version. Defaults to `1`. */
  readonly version?: number
  /** Unambiguous migration chain for older persisted envelopes. */
  readonly migrations?: ReadonlyArray<
    PersistenceMigration<MigrationError, MigrationRequirements>
  >
  /**
   * Rewrites successfully migrated data in the current canonical format.
   * Defaults to `true`, preventing the migration chain from rerunning forever.
   */
  readonly writeBackMigrations?: boolean
  /** Provenance token used for inbound initialization and echo suppression. */
  readonly source?: SourceToken
  /** Additional commit tags that opt out of persistence. */
  readonly skipTags?: ReadonlySet<string>
}

const shouldSave = <S extends Schema.Top>(
  commit: ChangeEnvelope<S>,
  source: SourceToken,
  skipTags: ReadonlySet<string>
): boolean =>
  commit.source !== source &&
  !HashSet.has(commit.tags, PersistenceSkipTag) &&
  !Array.from(skipTags).some((tag) => HashSet.has(commit.tags, tag))

const encodeSnapshot = <S extends Schema.Top>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  revision: number
): Effect.Effect<Schema.Json, PersistenceEncodeError, S['EncodingServices']> =>
  Schema.encodeUnknownEffect(spec.jsonCodec, {
    errors: 'all',
    onExcessProperty: 'error',
  })(snapshot).pipe(
    Effect.mapError((cause) => new PersistenceEncodeError({ cause, revision }))
  )

const decodeSnapshot = <S extends Schema.Top>(
  spec: TreeSpec<S>,
  encoded: unknown,
  version: number
): Effect.Effect<TreeValue<S>, PersistenceDecodeError, S['DecodingServices']> =>
  Schema.decodeUnknownEffect(spec.jsonCodec, {
    errors: 'all',
    onExcessProperty: 'error',
  })(encoded).pipe(
    Effect.map((value) => value as TreeValue<S>),
    Effect.mapError((cause) => new PersistenceDecodeError({ cause, version }))
  )

const decodeEnvelope = (
  stored: unknown
): Effect.Effect<PersistedEnvelope, PersistenceEnvelopeDecodeError> =>
  Schema.decodeUnknownEffect(PersistedEnvelopeSchema)(stored).pipe(
    Effect.mapError((cause) => new PersistenceEnvelopeDecodeError({ cause }))
  )

const migrateEnvelope = <E, R>(
  envelope: PersistedEnvelope,
  target: number,
  migrations: ReadonlyArray<PersistenceMigration<E, R>>
): Effect.Effect<
  unknown,
  | E
  | PersistenceMigrationDecodeError
  | PersistenceMigrationPathError
  | PersistenceVersionError,
  R
> =>
  Effect.gen(function* () {
    if (envelope.version > target) {
      return yield* new PersistenceVersionError({
        stored: envelope.version,
        supported: target,
      })
    }

    let version = envelope.version
    let value = envelope.value
    while (version < target) {
      const candidates = migrations.filter(
        (migration) => migration.from === version && migration.to <= target
      )
      if (candidates.length === 0) {
        return yield* new PersistenceMigrationPathError({
          from: version,
          target,
          reason: 'missing',
        })
      }
      if (candidates.length > 1) {
        return yield* new PersistenceMigrationPathError({
          from: version,
          target,
          reason: 'ambiguous',
        })
      }
      const migration = candidates[0]
      if (migration === undefined || migration.to <= version) {
        return yield* new PersistenceMigrationPathError({
          from: version,
          target,
          reason: 'invalid',
        })
      }
      value = yield* migration.migrate(value)
      version = migration.to
    }
    return value
  })

/**
 * Binds an effect-state-tree store to versioned durable storage for the current Scope.
 *
 * Commits are subscribed synchronously before this Effect returns. A single
 * worker encodes and saves eligible snapshots exactly once in commit order.
 * Normal scope finalization calls `close`, which unsubscribes and drains the
 * queue. Use `abort` only when dropping pending durability work is intentional.
 */
export const bindPersistence = <
  S extends Schema.Top,
  E,
  R,
  MigrationError = never,
  MigrationRequirements = never,
>(
  store: TreeStore<S>,
  storage: PersistenceStorage<PersistedEnvelope, E, R>,
  options: BindPersistenceOptions<MigrationError, MigrationRequirements> = {}
): Effect.Effect<
  PersistenceBinding<E>,
  | PersistenceReadError<E, MigrationError>
  | PersistenceEncodeError
  | TreePatchError
  | TreeStoreShutdownError,
  | R
  | MigrationRequirements
  | S['DecodingServices']
  | S['EncodingServices']
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const initialize = options.initialize ?? 'storage'
    const version = options.version ?? 1
    const migrations = options.migrations ?? []
    const writeBackMigrations = options.writeBackMigrations ?? true
    const source = options.source ?? storage.source
    const skipTags = options.skipTags ?? new Set<string>()

    if (!Number.isSafeInteger(version) || version < 0) {
      return yield* new PersistenceMigrationPathError({
        from: version,
        target: version,
        reason: 'invalid',
      })
    }

    if (initialize === 'storage') {
      const persisted = yield* storage.load
      if (Option.isSome(persisted)) {
        const envelope = yield* decodeEnvelope(persisted.value)
        const encoded = yield* migrateEnvelope(envelope, version, migrations)
        const decoded = yield* decodeSnapshot(store.spec, encoded, version)
        yield* store.replace(decoded, {
          source,
          tags: [PersistenceInboundTag, PersistenceSkipTag, 'history.skip'],
          label: 'Initialize from persistence',
        })
        if (writeBackMigrations && envelope.version < version) {
          const state = yield* store.getState
          const canonical = yield* encodeSnapshot(
            store.spec,
            state.snapshot,
            state.revision
          )
          yield* storage.save({ version, value: canonical })
        }
      }
    } else if (initialize === 'store') {
      const state = yield* store.getState
      const encoded = yield* encodeSnapshot(
        store.spec,
        state.snapshot,
        state.revision
      )
      yield* storage.save({ version, value: encoded })
    }

    const queue = yield* Queue.unbounded<WriterMessage<S, E>>()
    const waiters = new Set<Deferred.Deferred<void, PersistenceFlushError<E>>>()
    const closeAcknowledgement = yield* Deferred.make<
      void,
      PersistenceFlushError<E>
    >()
    let state: BindingState = 'open'

    const persist = (
      work: PersistWork<S>
    ): Effect.Effect<
      void,
      PersistenceWriteError<E>,
      R | S['EncodingServices']
    > =>
      Effect.flatMap(
        encodeSnapshot(store.spec, work.snapshot, work.revision),
        (encoded) => storage.save({ version, value: encoded })
      )

    let unreportedFailure = Option.none<PersistenceWriteError<E>>()
    const runWriter: Effect.Effect<void, never, R | S['EncodingServices']> =
      Effect.gen(function* () {
        let running = true
        while (running) {
          const message = yield* Queue.take(queue)
          if (message._tag === 'PersistWork') {
            const result = yield* Effect.result(persist(message))
            if (Result.isFailure(result) && Option.isNone(unreportedFailure)) {
              unreportedFailure = Option.some(result.failure)
            }
            continue
          }

          const completion = Option.match(unreportedFailure, {
            onNone: () => Effect.void,
            onSome: Effect.fail,
          })
          unreportedFailure = Option.none()
          yield* Deferred.complete(message.acknowledgement, completion)
          waiters.delete(message.acknowledgement)
          running = !message.close
        }
      })

    const worker = yield* Effect.forkScoped(runWriter)

    const offerCommit = (commit: ChangeEnvelope<S>): void => {
      if (state !== 'open' || !shouldSave(commit, source, skipTags)) {
        return
      }
      Queue.offerUnsafe(queue, {
        _tag: 'PersistWork',
        snapshot: commit.after,
        revision: commit.revisionAfter,
      })
    }
    const unsubscribe = store.subscribe(offerCommit)

    const awaitClose: Effect.Effect<
      void,
      PersistenceFlushError<E>
    > = Effect.gen(function* () {
      const completion = yield* Effect.result(
        Deferred.await(closeAcknowledgement)
      )
      yield* Fiber.join(worker)
      yield* Queue.shutdown(queue)
      state = 'closed'
      return yield* Effect.fromResult(completion)
    })

    const flush: PersistenceBinding<E>['flush'] = Effect.uninterruptible(
      Effect.suspend(() => {
        if (state === 'aborted') {
          return Effect.fail(
            new PersistenceBindingClosedError({ reason: 'aborted' })
          )
        }
        if (state !== 'open') return awaitClose

        const acknowledgement = Deferred.makeUnsafe<
          void,
          PersistenceFlushError<E>
        >()
        waiters.add(acknowledgement)
        Queue.offerUnsafe(queue, {
          _tag: 'FlushBarrier',
          acknowledgement,
          close: false,
        })
        return Deferred.await(acknowledgement)
      })
    )

    const close: PersistenceBinding<E>['close'] = Effect.uninterruptible(
      Effect.suspend(() => {
        if (state === 'aborted') {
          return Effect.fail(
            new PersistenceBindingClosedError({ reason: 'aborted' })
          )
        }
        if (state !== 'open') return awaitClose

        state = 'closing'
        unsubscribe()
        waiters.add(closeAcknowledgement)
        Queue.offerUnsafe(queue, {
          _tag: 'FlushBarrier',
          acknowledgement: closeAcknowledgement,
          close: true,
        })
        return awaitClose
      })
    )

    const abort: PersistenceBinding<E>['abort'] = Effect.uninterruptible(
      Effect.suspend(() => {
        if (state === 'aborted' || state === 'closed') return Effect.void
        state = 'aborted'
        unsubscribe()
        const failure = new PersistenceBindingClosedError({
          reason: 'aborted',
        })
        return Effect.andThen(
          Effect.forEach(waiters, (waiter) => Deferred.fail(waiter, failure), {
            discard: true,
          }),
          Effect.andThen(Queue.shutdown(queue), Fiber.interrupt(worker))
        )
      })
    )

    yield* Effect.addFinalizer(() => Effect.ignore(close))

    return { flush, close, abort }
  })
