import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'

import { colors, radii, spacing } from '../styles/tokens.stylex'

type StatusTone = 'error' | 'warning' | 'success' | 'info'

const styles = stylex.create({
  banner: {
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: radii.md,
    display: 'grid',
    fontSize: '0.88rem',
    gap: spacing.xs,
    padding: spacing.md,
    whiteSpace: 'pre-wrap',
  },
  error: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#e5b1a8',
    color: colors.danger,
  },
  warning: {
    backgroundColor: colors.warningSoft,
    borderColor: '#ead3a4',
    color: colors.warning,
  },
  success: {
    backgroundColor: colors.successSoft,
    borderColor: '#acd7b8',
    color: colors.success,
  },
  info: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    color: colors.textMuted,
  },
})

export const StatusBanner = ({
  children,
  tone = 'info',
}: {
  readonly children: ReactNode
  readonly tone?: StatusTone
}) => (
  <div {...stylex.props(styles.banner, styles[tone])} role="status">
    {children}
  </div>
)
