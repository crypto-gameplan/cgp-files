// Rows glow for a moment where Claude reads, writes or commits. A file inside collapsed folders opens them, and
// those folders glow dimmer, so it is clear why they opened.

import type { FileTree, Glow, Tone } from '../../types'
import { ancestors } from './paths'

/** The id the branch line glows under. */
export const BRANCH_ROW = '#branch'

/** How long a row glows, in milliseconds. */
export const GLOW_MS = 2_700

export function isGlowing(g: Glow): boolean {
  return g.bright.length > 0 || g.dim.length > 0
}

/** Adds new glowing paths to what still glows, and opens the folders they need. */
export function addGlow(t: FileTree, tones: Record<string, Tone>): { glow: Glow; expanded: string[] } {
  const ids = Object.keys(tones)
  const open = new Set(t.expanded)
  const bright = new Set([...t.glow.bright.filter(id => !(id in tones)), ...ids])
  const dim = new Set(t.glow.dim)
  const all: Record<string, Tone> = { ...t.glow.tones }
  for (const id of ids) {
    const tone = tones[id] ?? 'write'
    all[id] = tone
    if (id === BRANCH_ROW) continue
    for (const dir of ancestors(id, t.root)) {
      if (open.has(dir)) continue
      dim.add(dir)
      all[dir] ??= tone
      open.add(dir)
    }
  }
  for (const id of bright) dim.delete(id)
  return { glow: { bright: [...bright], dim: [...dim], tones: all }, expanded: [...open] }
}
