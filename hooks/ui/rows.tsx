// The tree's rows, drawn on the surface's own thread: hover, clicks, keys, the scroll bar and the moving shimmer
// on glowing rows all happen here without a round trip. What a click or a key means is decided in register.tsx,
// which gets it through `surface.post`.

import type { ClientModule, RenderElement } from 'claude-code'

import type { Tone } from '../../types'
import type { Ramp } from './palette'

/** One run of text in a row. */
export type Seg = {
  t: string
  c?: string
  bold?: boolean
  strike?: boolean
  /** Shimmers in this tone's ramp instead of `c`. */
  glow?: Tone
  /** The dimmed ramp, for folders that opened to show a file. */
  dim?: boolean
  /** One colour for the whole run, for icons. */
  whole?: boolean
}

export type RowSpec = { id: string; left: Seg[]; right: Seg[] }

export type RowsProps = {
  rows: RowSpec[]
  active: string
  activeBg: string
  hoverBg: string
  ramps: Record<string, Ramp>
  bar?: { pos: number; size: number; thumb: string; track: string }
  preview?: { text: string; path: string; startLine: number; isMarkdown: boolean }
}

/** What the client posts to register.tsx. */
export type RowsMessage =
  | { press: string; ctrl: boolean; shift: boolean }
  | { copy: string; shift: boolean }
  | { key: string; ctrl: boolean; shift: boolean }
  | { scrollTo: number }

type Local = { hover: number; phase: number; isDragging: boolean; timers: { stop?: () => void } }

const TICK_MS = 90
/** The engine draws at most this much JSON per client, so long trees end with a note. */
const DRAW_BUDGET = 70_000
const MAX_ROWS = 1_500

/** The ramp step for character `i` of `len` as the light band passes over it. */
function shimmer(i: number, phase: number, len: number, ramp: string[]): string {
  const band = ((phase * 1.6) % (len + 8)) - 4
  const d = Math.abs(i - band)
  return ramp[d < 0.8 ? 3 : d < 1.8 ? 2 : d < 2.8 ? 1 : 0] ?? ramp[0] ?? '#ffab19'
}

const Rows: ClientModule<RowsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const post = (m: RowsMessage) => surface.post(m)
  let local = surface.state
  if (local === undefined) {
    local = { hover: -1, phase: 0, isDragging: false, timers: {} }
    surface.setState(local)
  }
  let drawnRows = props.rows.length

  const anyGlow = props.rows.some(r => r.left.some(s => s.glow) || r.right.some(s => s.glow))
  if (anyGlow && !local.timers.stop) {
    local.timers.stop = surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1 })
    })
  } else if (!anyGlow && local.timers.stop) {
    local.timers.stop()
    local.timers.stop = undefined
  }

  surface.onPointer(e => {
    const cur = surface.state ?? local
    const span = Math.max(1, props.rows.length - 1)
    const onBar = Boolean(props.bar) && e.x >= surface.columns - 1
    if (props.bar && (cur.isDragging || (onBar && e.type === 'down' && (e.button ?? 'left') === 'left'))) {
      if (e.type === 'up' || e.type === 'leave') surface.setState({ ...cur, isDragging: false })
      else if (e.type === 'down' || e.type === 'move') {
        if (!cur.isDragging) surface.setState({ ...cur, isDragging: true, hover: -1 })
        post({ scrollTo: Math.max(0, Math.min(1, e.y / span)) })
      }
      return
    }
    if (e.type === 'leave' || e.y < 0 || e.y >= drawnRows) {
      if (cur.hover !== -1) surface.setState({ ...cur, hover: -1 })
      return
    }
    if (e.type === 'move' && !e.button && cur.hover !== e.y) surface.setState({ ...cur, hover: e.y })
    const row = props.rows[e.y]
    if (e.type !== 'down' || !row?.id) return
    if (e.button === 'right') post({ copy: row.id, shift: Boolean(e.shift) })
    else if ((e.button ?? 'left') === 'left') post({ press: row.id, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) })
  })
  surface.onKey(e => post({ key: e.key, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) }))

  // The preview draws in this same element, so the focus a click gave the tree stays where it is.
  if (props.preview) {
    const { Markdown, Code } = surface.elements
    const p = props.preview
    return p.isMarkdown ? <Markdown text={p.text} /> : <Code source={p.text} path={p.path} startLine={p.startLine} wrap="truncate-end" />
  }

  const phase = local.phase
  const draw = (s: Seg) => {
    const ramp = s.glow ? (s.dim ? props.ramps[s.glow]?.dim : props.ramps[s.glow]?.bright) : undefined
    if (!ramp) {
      return (
        <Text color={s.c} bold={s.bold} strikethrough={s.strike}>
          {s.t}
        </Text>
      )
    }
    if (s.whole) return <Text color={shimmer(-1, phase, s.t.length, ramp)}>{s.t}</Text>
    const chars = [...s.t]
    return (
      <Text bold={s.bold}>
        {chars.map((ch, i) => (
          <Text color={shimmer(i, phase, chars.length, ramp)}>{ch}</Text>
        ))}
      </Text>
    )
  }
  const bar = props.bar
  const rowEl = (r: RowSpec, i: number) => {
    const onThumb = bar && i >= bar.pos && i < bar.pos + bar.size
    const bg = r.id && r.id === props.active ? props.activeBg : r.id && i === local.hover ? props.hoverBg : undefined
    return (
      <Box flexDirection="row" height={1} overflow="hidden" backgroundColor={bg}>
        <Box flexShrink={1} overflow="hidden">
          {r.left.map(draw)}
        </Box>
        <Box flexGrow={1} />
        {r.right.map(draw)}
        {bar && <Text color={onThumb ? bar.thumb : bar.track}>{onThumb ? '┃' : '│'}</Text>}
      </Box>
    )
  }
  const drawn: RenderElement[] = []
  let size = 0
  for (let i = 0; i < props.rows.length; i++) {
    const el = rowEl(props.rows[i] as RowSpec, i)
    let cost = 1_000
    try {
      cost = JSON.stringify(el).length
    } catch {
      // A row that does not serialise counts as a typical one.
    }
    if (size + cost > DRAW_BUDGET || drawn.length >= MAX_ROWS) {
      drawnRows = i
      drawn.push(<Text dimColor>{`  … ${props.rows.length - i} more rows, collapse folders or use search`}</Text>)
      break
    }
    size += cost
    drawn.push(el)
  }
  return <Box flexDirection="column">{drawn}</Box>
}

export default Rows
