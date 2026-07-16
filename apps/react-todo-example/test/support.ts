import { FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform } from 'effect/unstable/http'

import { TodoDocumentsLive } from '../src/server/handlers'
import { TodoRepositoryLive } from '../src/server/repository'

export const HttpApiTestServices = Layer.mergeAll(
  Path.layer,
  Etag.layerWeak,
  HttpPlatform.layer
).pipe(Layer.provideMerge(FileSystem.layerNoop({})))

export const TodoDocumentHandlersTest = TodoDocumentsLive.pipe(
  Layer.provide(TodoRepositoryLive)
)
