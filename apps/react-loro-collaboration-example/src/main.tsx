import { Effect } from 'effect'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { makeCollaborationPeer } from './client/peer'
import { App } from './components/App'
import './global.css'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('Missing #root element')

const locationUrl = new URL(window.location.href)
const roomId = locationUrl.searchParams.get('room')?.trim() || 'lobby'
const existingPeerId = locationUrl.searchParams.get('peer')?.trim()
const peerId = existingPeerId || `peer-${crypto.randomUUID().slice(0, 6)}`

if (existingPeerId === undefined || existingPeerId.length === 0) {
  locationUrl.searchParams.set('room', roomId)
  locationUrl.searchParams.set('peer', peerId)
  window.history.replaceState({}, '', locationUrl)
}

const peer = await Effect.runPromise(
  makeCollaborationPeer({ roomId, peerId, name: peerId })
)
const root = createRoot(rootElement)

root.render(
  <StrictMode>
    <App peer={peer} />
  </StrictMode>
)

const shutdown = (): void => {
  Effect.runFork(peer.shutdown)
}

window.addEventListener('beforeunload', shutdown, { once: true })
import.meta.hot?.dispose(() => {
  window.removeEventListener('beforeunload', shutdown)
  root.unmount()
  shutdown()
})
