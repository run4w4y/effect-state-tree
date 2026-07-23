import { bindCrdt, CrdtInboundTag } from '@effect-state-tree/crdt'
import { makeLoroAdapter } from '@effect-state-tree/loro'
import {
  type ChangeEnvelope,
  makeCommitReducerController,
} from '@effect-state-tree/runtime'
import { Effect, Exit, HashSet, Scope } from 'effect'
import { take } from 'es-toolkit'

import { makeBoardDocument } from '../collaboration/bootstrap'
import {
  type Board,
  type BoardStore,
  BoardTree,
  initialBoard,
} from '../domain/board'
import {
  type LoroTransportFactory,
  makeBrowserLoroTransport,
} from './transport'

export interface CommitLogEntry {
  readonly id: string
  readonly direction: 'local' | 'inbound'
  readonly label: string
  readonly operations: string
  readonly revision: number
}

export interface MakeCollaborationPeerOptions {
  readonly roomId: string
  readonly peerId: string
  readonly name: string
  readonly endpoint?: string
  readonly transport?: LoroTransportFactory
}

const makeCommitFeed = (
  store: BoardStore,
  adapterSource: object | string | symbol
) =>
  makeCommitReducerController<ReadonlyArray<CommitLogEntry>, typeof Board>(
    store,
    {
      initial: [],
      reduce: (entries, commit: ChangeEnvelope<typeof Board>) => {
        const direction =
          commit.source === adapterSource ||
          HashSet.has(commit.tags, CrdtInboundTag)
            ? 'inbound'
            : 'local'
        const operations =
          commit.change.operations
            .map((operation) => operation._tag)
            .join(', ') || 'patch fallback'
        const entry: CommitLogEntry = {
          id: commit.transactionId,
          direction,
          label: commit.label ?? 'Tree commit',
          operations,
          revision: commit.revisionAfter,
        }
        return [take([entry, ...entries], 8), []]
      },
    }
  )

const randomLoroPeerId = (): bigint => {
  const value = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  return BigInt(`0x${value}`)
}

export const makeCollaborationPeer = (options: MakeCollaborationPeerOptions) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const setup = Effect.gen(function* () {
      const doc = yield* makeBoardDocument(randomLoroPeerId())
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => doc.free())
      )
      const adapter = makeLoroAdapter(BoardTree.spec, {
        doc,
        rootName: 'board',
        origin: `tree:${options.peerId}:${crypto.randomUUID()}`,
      })
      yield* Scope.addFinalizer(scope, adapter.undo.dispose.pipe(Effect.ignore))
      const store = yield* BoardTree.make(initialBoard)
      yield* Scope.addFinalizer(scope, store.shutdown)
      const binding = yield* bindCrdt(store, adapter, {
        initialize: 'backend',
      }).pipe(Scope.provide(scope))
      yield* binding.ready
      yield* binding.idle

      const transportFactory = options.transport ?? makeBrowserLoroTransport
      const transport = yield* transportFactory(doc, {
        roomId: options.roomId,
        peerId: options.peerId,
        endpoint: options.endpoint ?? '/collaboration',
      }).pipe(Scope.provide(scope))
      const commits = makeCommitFeed(store, adapter.source)

      let closed = false
      const shutdown = Effect.suspend(() => {
        if (closed) return Effect.void
        closed = true
        commits.dispose()
        return Scope.close(scope, Exit.void).pipe(Effect.asVoid)
      })

      return {
        roomId: options.roomId,
        peerId: options.peerId,
        name: options.name,
        store,
        doc,
        adapter,
        binding,
        transport,
        commits,
        undo: () =>
          adapter.undo.undo.pipe(
            Effect.andThen(Effect.yieldNow),
            Effect.andThen(binding.idle)
          ),
        redo: () =>
          adapter.undo.redo.pipe(
            Effect.andThen(Effect.yieldNow),
            Effect.andThen(binding.idle)
          ),
        shutdown,
      }
    })

    return yield* setup.pipe(
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
  })

export type CollaborationPeer = Effect.Success<
  ReturnType<typeof makeCollaborationPeer>
>
