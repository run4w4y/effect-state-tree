import * as stylex from '@stylexjs/stylex'

export const colors = stylex.defineVars({
  canvas: '#f2f5ef',
  surface: 'rgba(255, 255, 255, 0.92)',
  surfaceMuted: '#f7f9f5',
  text: '#15211d',
  textMuted: '#66756d',
  border: 'rgba(21, 33, 29, 0.13)',
  primary: '#24593a',
  primaryHover: '#19452c',
  primarySoft: '#e3f1e7',
  danger: '#963f34',
  dangerSoft: '#fff0ec',
  warning: '#996119',
  warningSoft: '#fff5de',
  blue: '#4c7fe8',
  blueSoft: '#eef4ff',
  coral: '#ef765a',
  coralSoft: '#fff1ed',
  gold: '#d6a22d',
  mint: '#43a676',
})

export const spacing = stylex.defineVars({
  xs: '0.35rem',
  sm: '0.65rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2.5rem',
  xxl: '4rem',
})

export const radii = stylex.defineVars({
  sm: '0.7rem',
  md: '1rem',
  lg: '1.6rem',
  xl: '2rem',
  round: '999px',
})
