import * as stylex from '@stylexjs/stylex'

import type { CollaborationAtoms } from '../client/atoms'
import type { CollaborationPeer } from '../client/peer'
import { colors, spacing } from '../styles/tokens.stylex'
import { BoardEditor } from './BoardEditor'
import { ConnectionPanel } from './ConnectionPanel'

const styles = stylex.create({
  shell: {
    marginInline: 'auto',
    maxWidth: '78rem',
    paddingBlock: spacing.xxl,
    paddingInline: spacing.md,
  },
  hero: {
    alignItems: 'end',
    display: 'grid',
    gap: spacing.xl,
    gridTemplateColumns: {
      '@media (max-width: 780px)': '1fr',
      default: 'minmax(0, 1fr) minmax(18rem, 24rem)',
    },
    marginBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: '0.7rem',
    fontWeight: 850,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  },
  heading: {
    fontFamily: 'Georgia, serif',
    fontSize: 'clamp(3rem, 8vw, 6.5rem)',
    fontWeight: 500,
    letterSpacing: '-0.06em',
    lineHeight: 0.9,
    marginBlock: spacing.sm,
    maxWidth: '12ch',
  },
  intro: {
    color: colors.textMuted,
    lineHeight: 1.65,
    margin: 0,
    maxWidth: '45rem',
  },
  footer: {
    color: colors.textMuted,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: '0.72rem',
    fontWeight: 800,
    gap: spacing.sm,
    justifyContent: 'center',
    letterSpacing: '0.06em',
    marginTop: spacing.xl,
    textTransform: 'uppercase',
  },
})

export const App = ({
  atoms,
  peer,
}: {
  readonly atoms: CollaborationAtoms
  readonly peer: CollaborationPeer
}) => (
  <main {...stylex.props(styles.shell)}>
    <header {...stylex.props(styles.hero)}>
      <div>
        <span {...stylex.props(styles.eyebrow)}>
          Effect Tree + Loro + Effect Socket
        </span>
        <h1 {...stylex.props(styles.heading)}>
          One room. Any number of peers.
        </h1>
        <p {...stylex.props(styles.intro)}>
          This page is one independent peer. Open another peer in a separate
          browser context, edit offline, and reconnect. Loro transports native
          list and text intent while the tree keeps universal patches.
        </p>
      </div>
      <ConnectionPanel atoms={atoms} peer={peer} />
    </header>

    <BoardEditor atoms={atoms} peer={peer} />

    <footer {...stylex.props(styles.footer)}>
      <span>Schema-described entities</span>
      <span>Automatic reconnection</span>
      <span>Native CRDT moves</span>
      <span>Collaborative text</span>
      <span>Echo suppression</span>
      <span>Peer-local undo</span>
    </footer>
  </main>
)
