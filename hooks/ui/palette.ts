// Crypto Gameplan colours, the same family cgp-effort and cgp-crew draw with.

import type { Tone } from '../../types'

export const GOLD = '#ffab19'
export const ICE = '#7cc4ff'
export const VIOLET = '#b79cff'
export const GREEN = '#7fe0a4'
export const YELLOW = '#e0a33a'
export const RED = '#e5534b'
export const MUTED = '#8b8b93'
export const SELECTION = '#2a3d52'
export const HOVER = '#1a2633'

/** Git status letter → colour. D and U take RED; letters not listed take MUTED. */
export const STATUS_COLOR: Record<string, string> = {
  A: GREEN,
  '?': GREEN,
  R: ICE,
  C: ICE,
  M: YELLOW,
  T: YELLOW,
  D: RED,
  U: RED,
}

/** The solid colour of each glow tone: reads violet, writes CGP gold, commits green. */
export const TONE_COLOR: Record<Tone, string> = {
  read: VIOLET,
  write: GOLD,
  commit: GREEN,
  sync: ICE,
  merge: VIOLET,
  undo: RED,
}

export type Ramp = { bright: string[]; dim: string[] }

function mix(hex: string, toward: number, share: number): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(((v >> shift) & 255) + (toward - ((v >> shift) & 255)) * share)
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')}`
}

/** Four steps from the tone's colour to near white, and the same dimmed, for the moving shimmer. */
export function rampOf(hex: string): Ramp {
  const bright = [0, 0.3, 0.55, 0.85].map(s => mix(hex, 255, s))
  return { bright, dim: bright.map(c => mix(c, 0x14, 0.55)) }
}

export const RAMPS: Record<Tone, Ramp> = Object.fromEntries(Object.entries(TONE_COLOR).map(([k, v]) => [k, rampOf(v)])) as Record<Tone, Ramp>
