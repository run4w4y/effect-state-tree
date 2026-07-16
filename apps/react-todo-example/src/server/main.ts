import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'

import { TodoApiLive } from './handlers'

const port = Number(process.env.TODO_API_PORT ?? 4312)

const RoutesLive = TodoApiLive.pipe(Layer.provide(HttpRouter.cors()))

HttpRouter.serve(RoutesLive).pipe(
  Layer.provide(BunHttpServer.layer({ hostname: '127.0.0.1', port })),
  Layer.launch,
  BunRuntime.runMain
)
