// The pane: a header with the buttons, the branch line, the search box, the rows and a footer with the selection
// and the latest git action. Or, with "Open with: preview", one file. Pure: register.tsx hands in the surface's
// elements, the state it read and the actions it owns.

import type { FileTree, GitEvent } from '../../types'
import { BRANCH_ROW, isGlowing } from '../core/glow'
import { visibleRows } from '../core/nodes'
import { basename, displayPath } from '../core/paths'
import { isMarkdown, lineCount, previewWindow, type PreviewText } from '../core/preview'
import { T } from '../core/strings'
import { thumbOf, windowOf } from '../core/viewport'
import { GIT_ICON, pick, UI } from './icons'
import { GOLD, GREEN, HOVER, MUTED, RAMPS, RED, SELECTION, TONE_COLOR } from './palette'
import { contextOf, countSegs, noteRow, rowSpec } from './row-spec'
import type { RowSpec, RowsProps } from './rows'

export const PANE = 'cgp-files'
/** The desktop draws every row; past this much JSON the list ends with a note. */
const DESKTOP_BUDGET = 80_000

/* eslint-disable @typescript-eslint/no-explicit-any -- the surface's own element constructors */
export type Elements = { Box: any; Text: any; Button: any; Input: any; Client: any }
/* eslint-enable @typescript-eslint/no-explicit-any */

export type PaneActions = {
  up: () => void
  home: () => void
  refresh: () => void
  toggleHidden: () => void
  toggleSize: () => void
  collapse: () => void
  unselect: () => void
  search: (q: string) => void
  jump: (q: string) => void
  back: () => void
  external: () => void
}

export type PaneDraw = {
  el: Elements
  tree: FileTree
  plain: boolean
  isDesktop: boolean
  columns: number
  bodyRows: number
  home: string
  followsCwd: boolean
  followClaude: boolean
  event: GitEvent | undefined
  act: PaneActions
}

export type TreeView = { element: unknown; from: number; max: number; needSizes: string[] }

const rowsProps = (rows: RowSpec[], active: string, extra: Partial<RowsProps> = {}): RowsProps => ({
  rows,
  active,
  activeBg: SELECTION,
  hoverBg: HOVER,
  ramps: RAMPS,
  ...extra,
})

function header(d: PaneDraw) {
  const { Box, Text, Button } = d.el
  const t = d.tree
  const p = d.plain
  const title = t.repo ? [basename(t.repo.top), t.repo.prefix.replace(/\/$/, '')].filter(Boolean).join('/') : basename(t.root) || t.root
  return (
    <Box flexDirection="row">
      <Text bold color={GOLD} wrap="truncate-start">
        {title}
      </Text>
      <Box flexGrow={1} />
      <Box flexDirection="row" gap={2}>
        <Button key="up" plain dimColor label={pick(UI.up, p)} onPress={d.act.up} />
        <Button key="cwd" plain dimColor={!d.followsCwd} label={pick(UI.home, p)} onPress={d.act.home} />
        <Button key="refresh" plain dimColor label={pick(UI.refresh, p)} onPress={d.act.refresh} />
        <Button key="hidden" plain dimColor={!t.showHidden} label={pick(t.showHidden ? UI.hiddenOn : UI.hiddenOff, p)} onPress={d.act.toggleHidden} />
        <Button key="size" plain dimColor={!t.showSize} label={pick(UI.size, p)} onPress={d.act.toggleSize} />
        <Button key="collapse" plain dimColor label={pick(UI.collapse, p)} onPress={d.act.collapse} />
        {t.selected ? <Button key="unselect" plain label={pick(UI.unselect, p)} onPress={d.act.unselect} /> : null}
        <Text> </Text>
      </Box>
    </Box>
  )
}

function branchLine(d: PaneDraw) {
  const { Box, Text } = d.el
  const repo = d.tree.repo
  if (!repo?.branch) return null
  const b = repo.branch
  const tone = d.tree.glow.tones[BRANCH_ROW]
  const lit = tone && d.tree.glow.bright.includes(BRANCH_ROW) ? TONE_COLOR[tone] : undefined
  const [add, del] = repo.lines[d.tree.root] ?? [0, 0]
  const counts = countSegs(repo.counts[d.tree.root])
  return (
    <Box flexDirection="row" height={1} overflow="hidden">
      <Box flexDirection="row" flexShrink={0}>
        <Text color={lit ?? GOLD}>{`${pick(UI.branch, d.plain)} `}</Text>
        <Text bold color={lit}>
          {b.head}
        </Text>
        {b.ahead > 0 ? <Text color={TONE_COLOR.sync}>{` ↑${b.ahead}`}</Text> : null}
        {b.behind > 0 ? <Text color={TONE_COLOR.sync}>{` ↓${b.behind}`}</Text> : null}
      </Box>
      {b.upstream ? (
        <Box flexShrink={1} overflow="hidden">
          <Text color={MUTED} wrap="truncate-end">{` ${b.upstream}`}</Text>
        </Box>
      ) : null}
      <Box flexGrow={1} />
      <Box flexDirection="row" flexShrink={0}>
        {add > 0 ? <Text color={GREEN}>{` +${add}`}</Text> : null}
        {del > 0 ? <Text color={RED}>{` -${del}`}</Text> : null}
        {counts.map(c => (
          <Text color={c.c}>{c.t}</Text>
        ))}
        {counts.length === 0 && add === 0 && del === 0 ? <Text color={MUTED}>{T.clean}</Text> : null}
      </Box>
    </Box>
  )
}

function searchBox(d: PaneDraw) {
  const { Box, Button, Input } = d.el
  return (
    <Box flexDirection="row">
      <Box flexGrow={1}>
        <Input key="q" label="/ " placeholder={T.search} submitLabel={T.jump} autoFocus value={d.tree.query} onInput={d.act.search} onSubmit={d.act.jump} />
      </Box>
      {d.tree.query ? <Button key="clear" plain dimColor label={pick(UI.clear, d.plain)} onPress={() => d.act.search('')} /> : null}
    </Box>
  )
}

function eventChip(d: PaneDraw, e: GitEvent) {
  const { Box, Text } = d.el
  const color = e.state === 'failed' ? RED : TONE_COLOR[e.tone]
  return (
    <Box flexDirection="row" marginLeft={2}>
      <Text color={color}>{`${pick(GIT_ICON[e.icon as keyof typeof GIT_ICON] ?? GIT_ICON.git, d.plain)} `}</Text>
      <Text bold={e.state === 'running'} color={color}>
        {e.state === 'running' ? `${e.label}…` : e.label}
      </Text>
      {e.detail ? <Text color={MUTED}>{` ${e.detail}`}</Text> : null}
    </Box>
  )
}

function footer(d: PaneDraw) {
  const { Box, Text } = d.el
  const t = d.tree
  if (!t.selected && !d.event) return null
  return (
    <Box flexDirection="row">
      {t.selected ? (
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-start">
            {T.selected + displayPath(t.selected, t.root, d.home)}
          </Text>
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {d.event ? eventChip(d, d.event) : null}
    </Box>
  )
}

export function treeView(d: PaneDraw): TreeView {
  const { Box, Text, Client } = d.el
  const t = d.tree
  const rows = visibleRows(t)
  const glowing = isGlowing(t.glow)
  const lit = new Set([...t.glow.bright, ...t.glow.dim])
  // Lines around the rows: header, search, the branch or no-repo line, and the footer when it shows.
  const chrome = 2 + (t.repo ? (t.repo.branch ? 1 : 0) : 1) + (t.selected || d.event ? 1 : 0)
  const room = d.isDesktop ? Math.max(1, rows.length) : Math.max(5, d.bodyRows - chrome)
  const follows = d.followClaude && glowing
  const focus = follows ? ([...t.glow.bright].reverse().find(id => id !== BRANCH_ROW) ?? t.cursor) : t.cursor
  const win = windowOf({ rows, room, focus, isLit: id => lit.has(id), follow: follows && !d.isDesktop, scroll: t.scroll })

  const ctx = contextOf(t, d.plain, Math.max(24, d.columns))
  const specs: RowSpec[] = [
    ...(rows.length === 0 ? [noteRow(T.empty)] : []),
    ...win.pinned.map(r => rowSpec(r, ctx)),
    ...(win.pinned.length ? [noteRow('  ⋮')] : []),
    ...win.shown.map(r => rowSpec(r, ctx)),
  ]
  if (d.isDesktop) {
    let size = 0
    const cut = specs.findIndex(r => (size += JSON.stringify(r).length + 1) > DESKTOP_BUDGET)
    if (cut >= 0) specs.splice(cut, specs.length - cut, noteRow(T.more(specs.length - cut)))
  }
  const hasBar = !d.isDesktop && rows.length > win.shown.length + win.pinned.length
  const bar = hasBar ? { ...thumbOf(win, rows.length, specs.length), thumb: GOLD, track: MUTED } : undefined
  const needSizes = t.showSize ? [...win.pinned, ...win.shown].filter(r => r.node.kind === 'dir' && !(r.node.id in t.sizes)).map(r => r.node.id) : []

  const element = (
    <Box flexDirection="column" minHeight={Math.max(1, d.bodyRows)}>
      {header(d)}
      {branchLine(d)}
      {t.repo ? null : <Text color={MUTED}>{`${pick(UI.noRepo, d.plain)} ${T.noRepo}`}</Text>}
      {searchBox(d)}
      <Client key="rows" module="./rows.tsx" props={rowsProps(specs, t.cursor, bar ? { bar } : {})} />
      <Box flexGrow={1} />
      {footer(d)}
    </Box>
  )
  return { element, from: win.from, max: win.max, needSizes }
}

export type PreviewView = { element: unknown; rows: number }

export function previewView(d: PaneDraw, file: PreviewText | null): PreviewView {
  const { Box, Text, Button, Client } = d.el
  const t = d.tree
  const path = t.preview?.path ?? ''
  const text = file?.text ?? ''
  const all = lineCount(text)
  const markdown = isMarkdown(path)
  const rows = d.isDesktop ? all : Math.max(4, d.bodyRows - (file?.note ? 2 : 1))
  const top = d.isDesktop ? 0 : Math.min(t.preview?.top ?? 0, Math.max(0, all - rows))
  const win = previewWindow(text, top, rows, markdown)
  const element = (
    <Box flexDirection="column" minHeight={Math.max(1, d.bodyRows)}>
      <Box flexDirection="row">
        <Button key="back" plain label={`${pick(UI.back, d.plain)} ${T.back}`} onPress={d.act.back} />
        <Text> </Text>
        <Box flexShrink={1} flexGrow={1}>
          <Text bold wrap="truncate-start">
            {displayPath(path, t.root, d.home)}
          </Text>
        </Box>
        <Button key="external" plain dimColor label={pick(UI.external, d.plain)} onPress={d.act.external} />
      </Box>
      {file?.note ? <Text dimColor>{file.note}</Text> : null}
      <Client key="rows" module="./rows.tsx" props={rowsProps([], '', { preview: { text: win.text, path, startLine: win.top + 1, isMarkdown: markdown } })} />
    </Box>
  )
  return { element, rows }
}
