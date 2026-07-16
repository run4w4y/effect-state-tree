import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'

import { CollaborationRoutesLive } from './routes'

const port = Number(process.env.COLLABORATION_PORT ?? 4313)

HttpRouter.serve(CollaborationRoutesLive).pipe(
  Layer.provide(BunHttpServer.layer({ hostname: '127.0.0.1', port })),
  Layer.launch,
  BunRuntime.runMain
)
