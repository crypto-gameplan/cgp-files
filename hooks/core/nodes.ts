// The tree as a flat list of listed nodes, and the rows it shows.

import type { FileNode, FileTree } from '../../types'
import { ancestors, dirname, join, relative } from './paths'

/** One entry of a folder listing, after links were followed. */
export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number; size: number; isLink: boolean }

/** One row the pane shows. */
export type Row = { node: FileNode; depth: number; isOpen: boolean }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const NO_GLOW = { bright: [], dim: [], tones: {} }

export function emptyTree(root: string): FileTree {
  return {
    root,
    nodes: [],
    expanded: [],
    cursor: '',
    selected: '',
    query: '',
    showHidden: true,
    showSize: false,
    sizes: {},
    repo: null,
    glow: NO_GLOW,
    scroll: null,
    preview: null,
  }
}

/** Folders first, then names in natural order (file2 before file10). */
export function toNodes(dir: string, entries: Entry[]): FileNode[] {
  return entries
    .map(e => ({
      id: join(dir, e.name),
      parent: dir,
      name: e.name,
      kind: e.isLink ? ('link' as const) : e.kind === 'dir' ? ('dir' as const) : ('file' as const),
      hidden: e.name.startsWith('.'),
      mtime: e.mtimeMs,
      size: e.size,
      isLoaded: false,
    }))
    .sort((a, b) => Number(a.kind !== 'dir') - Number(b.kind !== 'dir') || collator.compare(a.name, b.name))
}

/**
 * Replaces the children of every listed folder with its fresh listing. A folder that vanished takes everything
 * below it along; a folder that is still there keeps its own listing.
 */
export function mergeListings(nodes: FileNode[], listed: ReadonlyMap<string, FileNode[]>): FileNode[] {
  if (listed.size === 0) return nodes
  const old = new Map<string, FileNode>()
  for (const n of nodes) if (listed.has(n.parent)) old.set(n.id, n)
  const fresh = new Set<string>()
  for (const kids of listed.values()) for (const k of kids) fresh.add(k.id)
  const gone = new Set([...old.keys()].filter(id => !fresh.has(id)))
  const isGone = (id: string): boolean => {
    if (gone.size === 0) return false
    for (let dir = dirname(id), prev = id; dir !== prev; prev = dir, dir = dirname(dir)) if (gone.has(dir)) return true
    return false
  }
  const kept = nodes.filter(n => !listed.has(n.parent) && !isGone(n.id)).map(n => (listed.has(n.id) ? { ...n, isLoaded: true } : n))
  const added: FileNode[] = []
  for (const kids of listed.values()) {
    for (const k of kids) {
      if (isGone(k.id)) continue
      const was = old.get(k.id)
      // Listed in this same batch, or listed before and still a folder: its children are known.
      const isLoaded = k.kind === 'dir' && (listed.has(k.id) || (was?.kind === 'dir' && was.isLoaded))
      added.push(isLoaded ? { ...k, isLoaded } : k)
    }
  }
  return [...kept, ...added]
}

/** Forgets everything below the given folders, so the next open lists them afresh. */
export function forgetBelow(nodes: FileNode[], dirs: string[]): FileNode[] {
  if (dirs.length === 0) return nodes
  const set = new Set(dirs)
  const isBelow = (id: string) => {
    for (let dir = dirname(id), prev = id; dir !== prev; prev = dir, dir = dirname(dir)) if (set.has(dir)) return true
    return false
  }
  return nodes.filter(n => !isBelow(n.id)).map(n => (set.has(n.id) && n.isLoaded ? { ...n, isLoaded: false } : n))
}

/** The folders that are open and listed, whose listings a refresh renews. */
export function openFolders(t: FileTree): string[] {
  const open = new Set(t.expanded)
  return t.nodes.filter(n => n.kind === 'dir' && n.isLoaded && open.has(n.id)).map(n => n.id)
}

/**
 * The rows in drawing order. With a search the open state is ignored: every listed match shows, with the folders
 * that lead to it.
 */
export function visibleRows(t: FileTree): Row[] {
  const kids = new Map<string, FileNode[]>()
  for (const n of t.nodes) {
    if (!t.showHidden && n.hidden) continue
    const list = kids.get(n.parent)
    if (list) list.push(n)
    else kids.set(n.parent, [n])
  }
  const q = t.query.trim().toLowerCase()
  let matches: Set<string> | null = null
  if (q) {
    matches = new Set()
    for (const n of t.nodes) {
      if (!relative(t.root, n.id).toLowerCase().includes(q)) continue
      matches.add(n.id)
      for (const a of ancestors(n.id, t.root)) matches.add(a)
    }
  }
  const open = new Set(t.expanded)
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    for (const n of kids.get(dir) ?? []) {
      if (matches && !matches.has(n.id)) continue
      const isOpen = n.kind === 'dir' && (matches ? kids.has(n.id) : open.has(n.id))
      rows.push({ node: n, depth, isOpen })
      if (isOpen) walk(n.id, depth + 1)
    }
  }
  walk(t.root, 0)
  return rows
}

/** The folders that have to be listed, root first, before every path in `paths` can show. */
export function missingFolders(t: FileTree, paths: string[], tried: ReadonlySet<string>): string[] {
  const loaded = new Set(t.nodes.filter(n => n.isLoaded).map(n => n.id))
  if (t.nodes.some(n => n.parent === t.root)) loaded.add(t.root)
  const need = new Set<string>()
  for (const p of paths) {
    for (const dir of [t.root, ...ancestors(p, t.root).reverse()]) {
      if (loaded.has(dir)) continue
      if (!tried.has(dir)) need.add(dir)
      break
    }
  }
  return [...need]
}
