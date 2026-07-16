import { useStoreView } from '@effect-state-tree/react'
import * as stylex from '@stylexjs/stylex'

import type { CollaborationPeer } from '../client/peer'
import { colors, radii, spacing } from '../styles/tokens.stylex'

const styles = stylex.create({
  list: {
    display: 'grid',
    gap: spacing.sm,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  entry: {
    alignItems: 'start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    display: 'grid',
    gap: spacing.sm,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    padding: spacing.sm,
  },
  badge: {
    borderRadius: radii.round,
    fontSize: '0.62rem',
    fontWeight: 850,
    letterSpacing: '0.08em',
    paddingBlock: '0.2rem',
    paddingInline: '0.45rem',
    textTransform: 'uppercase',
  },
  local: {
    backgroundColor: colors.coralSoft,
    color: colors.coral,
  },
  inbound: {
    backgroundColor: colors.blueSoft,
    color: colors.blue,
  },
  details: {
    display: 'grid',
    gap: '0.15rem',
    minWidth: 0,
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metadata: {
    color: colors.textMuted,
    fontSize: '0.72rem',
  },
  empty: {
    color: colors.textMuted,
    fontSize: '0.85rem',
  },
})

export const CommitFeed = ({ peer }: { readonly peer: CollaborationPeer }) => {
  const entries = useStoreView(peer.commits)

  if (entries.length === 0) {
    return <p {...stylex.props(styles.empty)}>No commits yet.</p>
  }

  return (
    <ol
      {...stylex.props(styles.list)}
      aria-label="Tree commit feed"
      data-testid="commit-feed"
    >
      {entries.map((entry) => (
        <li {...stylex.props(styles.entry)} key={entry.id}>
          <span
            {...stylex.props(
              styles.badge,
              entry.direction === 'local' ? styles.local : styles.inbound
            )}
          >
            {entry.direction}
          </span>
          <span {...stylex.props(styles.details)}>
            <strong {...stylex.props(styles.label)}>{entry.label}</strong>
            <small {...stylex.props(styles.metadata)}>
              r{entry.revision} · {entry.operations}
            </small>
          </span>
        </li>
      ))}
    </ol>
  )
}
