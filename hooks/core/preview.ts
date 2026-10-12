// Turning a file into the text the preview shows, and the window of it that fits the pane.

import { formatSize } from './format'

/** Files above this size are not read at all. */
export const PREVIEW_MAX_BYTES = 4_000_000
/** The most characters the preview hands the engine, after JSON escaping. */
const MAX_CHARS = 90_000
const MAX_LINE = 2_000

export type PreviewText = { path: string; text: string; note: string }

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

export function isBinary(text: string): boolean {
  return text.slice(0, 8_000).includes('\0')
}

export function tooLargeNote(bytes: number): string {
  return `${formatSize(bytes)}, too large to preview`
}

export function binaryNote(bytes: number): string {
  return `binary file, ${formatSize(bytes)}`
}

/**
 * Cleans the file for drawing: one newline style, no control characters, long lines cut, and as many whole lines
 * as fit the budget. The note says when something was left out.
 */
export function previewOf(path: string, text: string): PreviewText {
  const total = text.length
  let lines = text
    .slice(0, MAX_CHARS)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split('\n')
  if (total > MAX_CHARS && lines.length > 1) lines.pop()
  lines = lines.map(l => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l))
  let size = 0
  let fit = lines.length
  for (let i = 0; i < lines.length; i++) {
    size += JSON.stringify(lines[i]).length
    if (size > MAX_CHARS) {
      fit = i
      break
    }
  }
  const kept = lines.slice(0, fit)
  const note = total > MAX_CHARS || fit < lines.length ? `first ${fit.toLocaleString('en')} lines of ${total.toLocaleString('en')} characters` : ''
  return { path, text: kept.join('\n'), note }
}

export function lineCount(text: string): number {
  return text.split('\n').length
}

/**
 * The lines from `top` on that fit in `rows`. In Markdown, a window that starts inside a code fence gets the fence's
 * opening line first, so the code is not drawn as prose.
 */
export function previewWindow(text: string, top: number, rows: number, markdown: boolean): { text: string; top: number } {
  const lines = text.split('\n')
  const from = Math.max(0, Math.min(top, lines.length - 1))
  let shown = lines.slice(from, from + rows)
  if (markdown) {
    let fence = ''
    let opener = ''
    for (const line of lines.slice(0, from)) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!m) continue
      const mark = m[1] ?? ''
      if (!fence) {
        fence = mark
        opener = line.trimStart()
      } else if (mark[0] === fence[0] && mark.length >= fence.length && !(m[2] ?? '').trim()) fence = ''
    }
    if (fence) shown = [opener, ...shown]
  }
  return { text: shown.join('\n'), top: from }
}
