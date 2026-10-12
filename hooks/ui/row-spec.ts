// One tree row as the segments rows.tsx draws: indent, caret, icon and name on the left; date or size, line counts,
// folder counts and the status letter on the right.

import type { FileTree, Repo } from '../../types'
import { clip, formatSize, stamp, width } from '../core/format'
import type { Row } from '../core/nodes'
import { dirname, underAny } from '../core/paths'
import { iconOf, pick, UI } from './icons'
import { GOLD, GREEN, MUTED, RED, STATUS_COLOR, YELLOW } from './palette'
import type { RowSpec, Seg } from './rows'

export type RowContext = {
  tree: FileTree
  plain: boolean
  columns: number
  ignored: ReadonlySet<string>
  untracked: ReadonlySet<string>
  bright: ReadonlySet<string>
  dim: ReadonlySet<string>
}

export function contextOf(t: FileTree, plain: boolean, columns: number): RowContext {
  return {
    tree: t,
    plain,
    columns,
    ignored: new Set(t.repo?.ignored ?? []),
    untracked: new Set(t.repo?.untracked ?? []),
    bright: new Set(t.glow.bright),
    dim: new Set(t.glow.dim),
  }
}

/** ` ?:2 M:1 D:1` for a folder, in the status colours. */
export function countSegs(c: [number, number, number] | undefined): Seg[] {
  if (!c) return []
  const out: Seg[] = []
  if (c[0] > 0) out.push({ t: ` ?:${c[0]}`, c: GREEN })
  if (c[1] > 0) out.push({ t: ` M:${c[1]}`, c: YELLOW })
  if (c[2] > 0) out.push({ t: ` D:${c[2]}`, c: RED })
  return out
}

/** Leaves out unset keys, so the props the engine compares stay small and stable. */
function tidy(segs: Seg[]): Seg[] {
  for (const s of segs) for (const k of Object.keys(s) as (keyof Seg)[]) if (s[k] === undefined || s[k] === false) delete s[k]
  return segs
}

function statusOf(id: string, repo: Repo | null, ctx: RowContext): string | undefined {
  return repo?.status[id] ?? (underAny(dirname(id), ctx.untracked, ctx.tree.root) ? '?' : undefined)
}

export function rowSpec(r: Row, ctx: RowContext): RowSpec {
  const { tree: t, plain } = ctx
  const n = r.node
  const repo = t.repo
  const status = statusOf(n.id, repo, ctx)
  const isIgnored = !status && underAny(n.id, ctx.ignored, t.root)
  const statusColor = status ? (STATUS_COLOR[status] ?? MUTED) : undefined
  const isBright = ctx.bright.has(n.id)
  const isDim = !isBright && ctx.dim.has(n.id)
  const tone = t.glow.tones[n.id] ?? 'write'
  const iconColor = isIgnored ? MUTED : (statusColor ?? (n.hidden ? MUTED : n.kind === 'dir' ? GOLD : MUTED))
  const nameColor = isIgnored ? MUTED : (statusColor ?? (n.hidden ? MUTED : undefined))

  const lines = repo?.lines[n.id]
  const sizeText = n.kind === 'dir' ? (n.id in t.sizes ? formatSize(t.sizes[n.id] ?? -1) : '…') : n.kind === 'file' || n.size > 0 ? formatSize(n.size) : ''
  const meta = t.showSize ? sizeText : !lines && n.kind === 'file' ? stamp(n.mtime) : ''
  const counts = n.kind === 'dir' ? countSegs(repo?.counts[n.id]) : []
  const badge = counts.length ? '' : status ? ` ${status}` : isIgnored ? ` ${pick(UI.ignored, plain)}` : '  '

  const right: Seg[] = []
  if (meta) right.push({ t: ` ${meta}`, c: MUTED })
  if (lines && lines[0] > 0) right.push({ t: ` +${lines[0]}`, c: GREEN })
  if (lines && lines[1] > 0) right.push({ t: ` -${lines[1]}`, c: RED })
  right.push(...counts)
  if (badge) right.push({ t: badge, c: status ? statusColor : MUTED, bold: true })

  const used = right.reduce((sum, s) => sum + width(s.t), 0)
  const name = clip(n.name, Math.max(4, ctx.columns - r.depth * 2 - 6 - used))
  const caret = n.kind === 'dir' ? `${pick(r.isOpen ? UI.open : UI.closed, plain)} ` : '  '
  const icon = `${iconOf(n, r.isOpen, n.kind === 'dir' && n.id === repo?.top, plain)} `
  const isLit = isBright || isDim
  const left: Seg[] = [
    { t: '  '.repeat(r.depth) },
    { t: caret, c: MUTED },
    isLit ? { t: icon, glow: tone, dim: isDim, whole: true } : { t: icon, c: iconColor },
    isLit
      ? { t: name, glow: tone, dim: isDim, bold: isBright }
      : { t: name, c: nameColor, bold: n.id === t.selected, strike: status === 'D' && n.kind !== 'dir' },
  ]
  return { id: n.id, left: tidy(left), right: tidy(right) }
}

export function noteRow(text: string): RowSpec {
  return { id: '', left: [{ t: text, c: MUTED }], right: [] }
}
