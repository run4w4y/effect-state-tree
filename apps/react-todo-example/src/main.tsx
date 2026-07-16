import { BrowserHttpClient } from '@effect/platform-browser'
import { Effect } from 'effect'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { makeTodoApiClient } from './client/api'
import { makeTodoWorkspace } from './client/state/workspace'
import './client/styles/global.css'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('Missing #root element')

const documentId =
  new URL(globalThis.location.href).searchParams.get('document') ?? 'main'
const apiUrl = new URL(
  import.meta.env.VITE_TODO_API_URL ?? 'http://127.0.0.1:4312'
)

const program = Effect.gen(function* () {
  const client = yield* makeTodoApiClient(apiUrl)
  const workspace = yield* makeTodoWorkspace(client, documentId)
  yield* workspace.load
  return workspace
}).pipe(Effect.provide(BrowserHttpClient.layerFetch))

Effect.runPromise(program).then(
  (workspace) => {
    const root = createRoot(rootElement)
    root.render(
      <StrictMode>
        <App workspace={workspace} />
      </StrictMode>
    )
    globalThis.addEventListener(
      'pagehide',
      () => {
        root.unmount()
        Effect.runFork(workspace.shutdown)
      },
      { once: true }
    )
  },
  (error) => {
    rootElement.textContent = `Unable to start the todo workspace: ${String(error)}`
  }
)
