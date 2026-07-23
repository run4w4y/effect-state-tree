import { RegistryProvider } from '@effect/atom-react'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { type TodoApiClient, TodoApiClientLive } from './client/api'
import { makeTodoAtoms } from './client/state/atoms'
import { TodoSession, TodoSessionLive } from './client/state/session'
import './client/styles/global.css'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('Missing #root element')

const documentId =
  new URL(globalThis.location.href).searchParams.get('document') ?? 'main'
const apiUrl = new URL(
  import.meta.env.PUBLIC_TODO_API_URL ?? 'http://127.0.0.1:4312'
)

const applicationRuntime = ManagedRuntime.make(
  Layer.merge(TodoSessionLive(documentId), TodoApiClientLive(apiUrl))
)

applicationRuntime
  .runPromise(
    Effect.gen(function* () {
      const session = yield* TodoSession
      const services = yield* Effect.context<TodoSession | TodoApiClient>()
      return makeTodoAtoms(session, services)
    })
  )
  .then(
    (atoms) => {
      const root = createRoot(rootElement)
      root.render(
        <StrictMode>
          <RegistryProvider>
            <App atoms={atoms} />
          </RegistryProvider>
        </StrictMode>
      )
      globalThis.addEventListener(
        'pagehide',
        () => {
          root.unmount()
          void applicationRuntime.dispose()
        },
        { once: true }
      )
    },
    (error) => {
      rootElement.textContent = `Unable to start the todo application: ${String(error)}`
    }
  )
