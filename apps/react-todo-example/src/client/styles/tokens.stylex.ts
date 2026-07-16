import * as stylex from '@stylexjs/stylex'

export const colors = stylex.defineVars({
  canvas: '#f4f0e7',
  canvasAccent: '#d9f2dc',
  surface: 'rgba(255, 255, 255, 0.92)',
  surfaceMuted: '#f4f6f2',
  text: '#19211d',
  textMuted: '#667068',
  border: 'rgba(25, 33, 29, 0.12)',
  primary: '#285d3b',
  primaryHover: '#1f4a2f',
  primarySoft: '#dceee0',
  danger: '#8a3d35',
  dangerSoft: '#fff0ec',
  warning: '#8a5a19',
  warningSoft: '#fff5df',
  success: '#287246',
  successSoft: '#e4f5e8',
  focus: '#8bc79b',
})

export const spacing = stylex.defineVars({
  xs: '0.35rem',
  sm: '0.65rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2.5rem',
})

export const radii = stylex.defineVars({
  sm: '0.7rem',
  md: '1rem',
  lg: '1.6rem',
  round: '999px',
})
