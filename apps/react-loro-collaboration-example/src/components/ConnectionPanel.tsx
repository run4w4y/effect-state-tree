import { useStoreView } from '@effect-state-tree/react'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'

import type { CollaborationPeer } from '../client/peer'
import { colors, radii, spacing } from '../styles/tokens.stylex'

const styles = stylex.create({
  panel: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 18px 55px rgba(30, 43, 37, 0.08)',
    display: 'grid',
    gap: spacing.xs,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    padding: spacing.lg,
  },
  light: {
    borderRadius: radii.round,
    height: '0.75rem',
    width: '0.75rem',
  },
  connected: {
    backgroundColor: colors.mint,
    boxShadow: '0 0 0 5px rgba(67, 166, 118, 0.14)',
  },
  connecting: {
    backgroundColor: colors.gold,
    boxShadow: '0 0 0 5px rgba(214, 162, 45, 0.14)',
  },
  disconnected: {
    backgroundColor: colors.coral,
    boxShadow: '0 0 0 5px rgba(239, 118, 90, 0.14)',
  },
  title: {
    fontWeight: 800,
  },
  detail: {
    color: colors.textMuted,
    fontSize: '0.78rem',
    gridColumn: 2,
    lineHeight: 1.5,
  },
  link: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    color: 'white',
    fontSize: '0.8rem',
    fontWeight: 800,
    gridColumn: '1 / -1',
    marginTop: spacing.sm,
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
    textAlign: 'center',
    textDecoration: 'none',
  },
})

const makeAnotherPeerUrl = (peer: CollaborationPeer): string => {
  const url = new URL(window.location.href)
  url.searchParams.set('room', peer.roomId)
  url.searchParams.set('peer', `peer-${crypto.randomUUID().slice(0, 6)}`)
  return url.toString()
}

export const ConnectionPanel = ({
  peer,
}: {
  readonly peer: CollaborationPeer
}) => {
  const connection = useStoreView(peer.transport.state)
  const [anotherPeerUrl] = useState(() => makeAnotherPeerUrl(peer))
  const tone =
    connection._tag === 'Connected'
      ? styles.connected
      : connection._tag === 'Connecting'
        ? styles.connecting
        : styles.disconnected
  const title =
    connection._tag === 'Connected'
      ? `${connection.peers} peer${connection.peers === 1 ? '' : 's'} online`
      : connection._tag === 'Connecting'
        ? 'Connecting to room'
        : 'Working offline'

  return (
    <aside
      {...stylex.props(styles.panel)}
      aria-label="Collaboration connection"
      data-connection-state={connection._tag}
      data-peer-count={connection.peers}
      data-testid="connection-state"
    >
      <span {...stylex.props(styles.light, tone)} />
      <strong {...stylex.props(styles.title)}>{title}</strong>
      <small {...stylex.props(styles.detail)}>
        Room <strong>{peer.roomId}</strong> · {peer.name} · attempt{' '}
        {connection.attempt}
      </small>
      <small {...stylex.props(styles.detail)}>
        Local CRDT edits remain available offline and are sent automatically on
        reconnect.
      </small>
      <a
        {...stylex.props(styles.link)}
        href={anotherPeerUrl}
        rel="noreferrer"
        target="_blank"
      >
        Open another peer
      </a>
    </aside>
  )
}
