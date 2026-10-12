// The /config options, read once when the mod registers.

export type Settings = {
  showReads: boolean
  showWrites: boolean
  /** The view scrolls to what Claude works on. */
  followClaude: boolean
  openAtStart: boolean
  sizeColumn: boolean
  /** '' for the default app, 'preview' for the pane, anything else a command. */
  openWith: string
  glyphs: 'auto' | 'nerd' | 'plain'
}

const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v.trim() : fallback)

export function readSettings(options: Record<string, unknown> | undefined): Settings {
  const activity = text(options?.activity, 'reads and writes')
  const glyphs = text(options?.glyphs, 'auto')
  return {
    showReads: activity.includes('reads'),
    showWrites: activity.includes('writes'),
    followClaude: options?.follow !== 'off',
    openAtStart: options?.start !== 'off',
    sizeColumn: options?.column === 'size',
    openWith: text(options?.open, ''),
    glyphs: glyphs === 'nerd' || glyphs === 'plain' ? glyphs : 'auto',
  }
}
