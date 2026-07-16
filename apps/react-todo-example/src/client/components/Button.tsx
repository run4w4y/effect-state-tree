import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'

import { colors, radii, spacing } from '../styles/tokens.stylex'

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: ButtonTone
  readonly compact?: boolean
}

const styles = stylex.create({
  button: {
    alignItems: 'center',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radii.sm,
    display: 'inline-flex',
    fontWeight: 750,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: '2.65rem',
    opacity: {
      ':disabled': 0.45,
      default: 1,
    },
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
    transition: 'background-color 140ms ease, transform 140ms ease',
  },
  compact: {
    minHeight: '2.1rem',
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
  },
  primary: {
    backgroundColor: {
      ':hover': colors.primaryHover,
      default: colors.primary,
    },
    color: 'white',
  },
  secondary: {
    backgroundColor: colors.primarySoft,
    color: colors.primary,
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  ghost: {
    backgroundColor: {
      ':hover': colors.surfaceMuted,
      default: 'transparent',
    },
    borderColor: colors.border,
    color: colors.text,
  },
})

export const Button = ({
  compact = false,
  tone = 'secondary',
  type = 'button',
  ...props
}: ButtonProps) => (
  <button
    {...props}
    {...stylex.props(styles.button, styles[tone], compact && styles.compact)}
    type={type}
  />
)
