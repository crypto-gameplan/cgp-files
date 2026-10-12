// Which rows the terminal pane shows. The view centres on the cursor, or on what Claude works on while that glows;
// glowing rows above the window stay pinned at the top so none of them scrolls out of sight. A scroll by the person
// wins over both. The desktop app scrolls the pane itself, so there every row is shown.

import type { Row } from './nodes'

export type Window = {
  from: number
  /** The largest `from` that still fills the room. */
  max: number
  pinned: Row[]
  shown: Row[]
}

export type WindowInput = {
  rows: Row[]
  room: number
  focus: string
  isLit: (id: string) => boolean
  follow: boolean
  scroll: number | null
}

export function windowOf(v: WindowInput): Window {
  const { rows, room } = v
  const at = Math.max(0, rows.findIndex(r => r.node.id === v.focus))
  const firstLit = v.follow ? rows.findIndex(r => v.isLit(r.node.id)) : -1
  const max = Math.max(0, rows.length - room)
  const clamp = (n: number, size: number) => Math.max(0, Math.min(n, rows.length - size))
  // Show from the first glowing row when the focus still fits below it, else centre on the focus.
  let from = clamp(firstLit >= 0 && at - firstLit < room - 2 ? Math.max(0, firstLit - 1) : at - Math.floor(room / 2), room)
  const cap = Math.max(1, Math.floor(room / 3))
  const litAbove = (end: number) => (v.follow ? rows.slice(0, end).filter(r => v.isLit(r.node.id)).slice(-cap) : [])
  let pinned = litAbove(from)
  if (pinned.length) {
    const rest = Math.max(3, room - pinned.length)
    from = clamp(at - Math.floor(rest / 2), rest)
    pinned = litAbove(from)
  }
  if (v.scroll !== null) {
    from = Math.max(0, Math.min(v.scroll, max))
    pinned = []
  }
  return { from, max, pinned, shown: rows.slice(from, from + room - pinned.length) }
}

/** The scroll bar's thumb, in rows of the drawn list. */
export function thumbOf(w: Window, total: number, drawn: number): { pos: number; size: number } {
  const size = Math.max(1, Math.round((drawn * w.shown.length) / Math.max(1, total)))
  return { pos: w.max ? Math.round((w.from / w.max) * (drawn - size)) : 0, size }
}
