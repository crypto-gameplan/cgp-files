// cgp-files' hooks. This file owns the session state and every `$` call; the logic lives in core/ and the drawing
// in ui/, both pure, so they are tested without an engine.

import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'

import type { FileNode, FileTree, GitEvent, Tone } from '../types'
import { fromRepo, parseNumstat, parseStatus, rollUpCounts, rollUpLines, type Change } from './core/git'
import { addGlow, BRANCH_ROW, GLOW_MS, isGlowing } from './core/glow'
import { emptyTree, forgetBelow, mergeListings, missingFolders, NO_GLOW, openFolders, toNodes, visibleRows, type Entry } from './core/nodes'
import { customLaunch, customOpener, defaultOpener, type Os } from './core/open'
import {
  ancestors,
  basename,
  dirname,
  inside,
  isAbsolute,
  isDiskRoot,
  join,
  posix,
  relative,
  resolve,
  shortPath,
  underAny,
  useWindowsPaths,
} from './core/paths'
import { binaryNote, isBinary, lineCount, PREVIEW_MAX_BYTES, previewOf, tooLargeNote, type PreviewText } from './core/preview'
import { endedTasks, mentions, selectionContext } from './core/prompt'
import { readSettings, type Settings } from './core/settings'
import { chainOf, changesFolder, gitActions, onlyReads, readPaths, type GitAction } from './core/shell'
import { T } from './core/strings'
import { PANE, previewView, treeView, type PaneActions, type PaneDraw } from './ui/pane'

const tree = atom({ plugin: 'cgp-files', key: 'tree' } as const, emptyTree(''))
const events = atom({ plugin: 'cgp-files', key: 'events' } as const, [])

/** The terminal sidebar needs at least this many columns. */
const MIN_COLUMNS = 110
/** Folders below the root that a write outside a repository is looked for in. */
const NO_REPO_DEPTH = 4
/** Two presses on the same row within this many milliseconds open it. */
const DOUBLE_PRESS_MS = 450
/** The most written, read or committed paths one command reveals. */
const WRITE_REVEAL_LIMIT = 200
const READ_REVEAL_LIMIT = 12
const SEARCH_REVEAL_LIMIT = 60
const SEARCH_JUMP_LIMIT = 10
/** How long a finished git action stays in the footer, and the longest one may run before it is dropped. */
const EVENT_TTL_MS = 45_000
const EVENT_RUNNING_MAX_MS = 600_000
const EVENTS_KEPT = 6
/** Folders never walked into when searching or looking for writes. */
const PRUNE = ['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']
const HOME_PRUNE = ['Library', 'AppData', '.Trash']
const SIZE_JOBS = 2
const SIZE_TIMEOUT_MS = 15_000
const SIZE_WALK_LIMIT = 50_000
/** A refresh from focus or a press happens at most this often. */
const SYNC_EVERY_MS = 2_000

// --- session

let settings: Settings = readSettings(undefined)
let platform: Promise<Os> | null = null
let home = ''
let hasNerdFont = false
/** The tree follows the session's working folder until the person pins another one. */
let followsCwd = true
let lastRoot = ''
/** True while the person keeps the pane closed: renders and resets do not reopen it. */
let staysClosed = false
let view = { from: 0, max: 0 }
/** The last render was the desktop app's, which scrolls the pane body itself. */
let scrollsNatively = false
let previewRows = 20
let previewText: PreviewText | null = null
let lastPress = { id: '', at: 0 }
let lastSync = 0
let glowRun = 0
let glowTimer: Timer | null = null
let searchIndex: { root: string; paths: Promise<string[]> } | null = null
/** The files git last reported as changed, which a write on Windows is looked for among. */
let dirtyFiles: { root: string; files: Record<string, Change> } = { root: '', files: {} }
let markerSeq = 0
let listSeq = 0
let eventSeq = 0
let repoRun: Promise<void> | null = null
let repoNext: Promise<void> | null = null
let queuedReads: string[] = []
const listLatest = new Map<string, number>()
const unreadable = new Set<string>()
const sizing = { epoch: 0, active: 0, queue: [] as string[], running: new Set<string>() }

/** A Bash command's facts, kept until the scan after it runs. */
type Since = { ms: number; marker: string; os: Os }
type ScanJob = { actions: GitAction[]; since: Since; isInit: boolean; onlyReads: boolean }
type Pending = { actions: GitAction[]; ids: number[]; command: string; head: string }
type GitOperation = NonNullable<BuiltinToolResults['Bash']['gitOperation']>
type Outcome = { state: 'done' | 'failed'; label: string; detail: string }
let scanning: Promise<void> | null = null
let scanJobs: ScanJob[] = []
/** Commands Claude sent to the background, settled when their task notification arrives. */
const background = new Map<string, { pending: Pending | null; job: ScanJob; reads: string[] }>()

// --- state

async function getTree($: EngineInterface): Promise<FileTree> {
  return { ...emptyTree(''), ...(await read($, tree)) }
}

async function patch($: EngineInterface, fn: (t: FileTree) => Partial<FileTree>): Promise<void> {
  await update($, tree, cur => {
    const t = { ...emptyTree(''), ...cur }
    return { ...t, ...fn(t) }
  })
}

async function setEvents($: EngineInterface, fn: (list: GitEvent[]) => GitEvent[]): Promise<void> {
  await update($, events, cur => fn(cur ?? []).slice(-EVENTS_KEPT))
}

function osOf($: EngineInterface): Promise<Os> {
  platform ??= (async (): Promise<Os> => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
    try {
      return (await $.process.run(['uname', '-s'], { timeoutMs: 3_000 })).stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
    } catch {
      return 'linux'
    }
  })()
  return platform
}

async function cwdOf($: EngineInterface): Promise<string> {
  return posix(await $.session.cwd())
}

const toast = ($: EngineInterface, text: string) => void Promise.resolve($.ui.toast(text)).catch(() => undefined)

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

const isBroad = (root: string) => root === home || isDiskRoot(root)

// --- listing

async function listFolder($: EngineInterface, dir: string): Promise<FileNode[] | null> {
  try {
    const entries: Entry[] = await Promise.all(
      (await $.fs.list(dir)).map(async (e): Promise<Entry> => {
        if (!e.isLink) return { name: e.name, kind: e.kind === 'dir' ? 'dir' : e.kind === 'file' ? 'file' : 'other', mtimeMs: e.mtimeMs, size: e.size, isLink: false }
        try {
          const target = await $.fs.stat(join(dir, e.name))
          // A link to a folder opens like the folder; a link to a file keeps its link icon.
          return target.kind === 'dir'
            ? { name: e.name, kind: 'dir', mtimeMs: target.mtimeMs, size: 0, isLink: false }
            : { name: e.name, kind: 'file', mtimeMs: target.mtimeMs, size: target.size, isLink: true }
        } catch {
          return { name: e.name, kind: 'other', mtimeMs: 0, size: 0, isLink: true }
        }
      }),
    )
    unreadable.delete(dir)
    return toNodes(dir, entries)
  } catch (err) {
    if (!(await exists($, dir))) return []
    if (!unreadable.has(dir)) {
      unreadable.add(dir)
      toast($, T.listFailed(shortPath(dir, home), err instanceof Error ? err.message : String(err)))
    }
    return null
  }
}

/** Lists the folders and merges them in. A listing that a newer one for the same folder overtook is dropped. */
async function loadFolders($: EngineInterface, dirs: string[]): Promise<Map<string, FileNode[]>> {
  const root = (await getTree($)).root
  const seq = ++listSeq
  for (const dir of dirs) listLatest.set(dir, seq)
  const results = await Promise.all(dirs.map(async dir => [dir, await listFolder($, dir)] as const))
  const listed = new Map<string, FileNode[]>()
  for (const [dir, kids] of results) {
    if (listLatest.get(dir) !== seq) continue
    listLatest.delete(dir)
    if (kids) listed.set(dir, kids)
  }
  await patch($, t => (t.root === root ? { nodes: mergeListings(t.nodes, listed) } : {}))
  return listed
}

/** Lists every folder on the way to each path, so they can show. */
async function revealPaths($: EngineInterface, paths: string[]): Promise<void> {
  const tried = new Set<string>()
  for (let pass = 0; pass < 32; pass++) {
    const need = missingFolders(await getTree($), paths, tried)
    if (need.length === 0) return
    for (const dir of need) tried.add(dir)
    await loadFolders($, need)
  }
}

// --- git

function git($: EngineInterface, cwd: string, args: string[], timeoutMs = 20_000) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], { timeoutMs, env: { GIT_OPTIONAL_LOCKS: '0' } })
}

/** Finds the repository the root is in, if any. Outside one this is the only git call the tree makes. */
async function detectRepo($: EngineInterface): Promise<void> {
  const root = (await getTree($)).root
  if (!root) return
  let top = ''
  let prefix = ''
  try {
    const run = await git($, root, ['rev-parse', '--show-prefix', '--show-toplevel'], 5_000)
    if (run.exitCode === 0) {
      const [p = '', tl = ''] = run.stdout.split('\n')
      prefix = p.trim()
      top = posix(tl.trim())
    }
  } catch {
    top = ''
  }
  await patch($, t => {
    if (t.root !== root) return {}
    if (!top) return { repo: null }
    return { repo: t.repo?.top === top ? { ...t.repo, prefix } : { top, prefix, branch: null, status: {}, lines: {}, counts: {}, ignored: [], untracked: [] } }
  })
}

async function readRepo($: EngineInterface): Promise<void> {
  const t = await getTree($)
  const repo = t.repo
  if (!t.root || !repo) return
  const root = t.root
  try {
    const status = await git($, root, ['status', '--porcelain=v1', '-b', '-z', '--ignored=traditional', '--untracked-files=normal', '--', '.'])
    if (status.exitCode !== 0) return
    const parsed = parseStatus(status.stdout, root, repo.prefix)
    const lines: Record<string, [number, number]> = {}
    const diff = await git($, root, ['diff', 'HEAD', '--numstat', '-z', '--', '.'])
    if (diff.exitCode === 0) parseNumstat(diff.stdout, root, repo.prefix, lines)
    const files = { ...parsed.files }
    if (parsed.untracked.length) {
      const rels = parsed.untracked.map(d => relative(root, d) || '.')
      const others = await git($, root, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...rels])
      if (others.exitCode === 0) for (const rel of others.stdout.split('\0').filter(Boolean)) files[join(root, rel)] = 'new'
    }
    // A new file's lines are all its lines: the count says nothing the status letter does not.
    for (const path of Object.keys(lines)) if (files[path] === 'new') delete lines[path]
    dirtyFiles = { root, files }
    await patch($, cur =>
      cur.root === root && cur.repo
        ? {
            repo: {
              ...cur.repo,
              branch: parsed.branch,
              status: parsed.status,
              lines: rollUpLines(lines, root),
              counts: rollUpCounts(files, root),
              ignored: parsed.ignored,
              untracked: parsed.untracked,
            },
          }
        : {},
    )
  } catch {
    // git missing or too slow: the tree keeps the last status it had.
  }
}

/** One status read at a time; a request while one runs queues exactly one more. */
function refreshRepo($: EngineInterface): Promise<void> {
  if (!repoRun) {
    repoRun = readRepo($).finally(() => {
      repoRun = null
    })
    return repoRun
  }
  const again = () => {
    repoNext = null
    return refreshRepo($)
  }
  repoNext ??= repoRun.then(again, again)
  return repoNext
}

async function headOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const run = await git($, cwd, ['rev-parse', 'HEAD'], 5_000)
    return run.exitCode === 0 ? run.stdout.trim() : ''
  } catch {
    return ''
  }
}

/** The files the last commit touched, or the staged ones. */
async function committedPaths($: EngineInterface, t: FileTree, isCommit: boolean): Promise<string[]> {
  if (!t.repo) return []
  const map = fromRepo(t.root, t.repo.prefix)
  try {
    const run = isCommit
      ? await git($, t.root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], 5_000)
      : await git($, t.root, ['diff', '--cached', '--name-only', '-z'], 5_000)
    return run.exitCode === 0 ? run.stdout.split('\0').filter(Boolean).flatMap(rel => map(rel) ?? []) : []
  } catch {
    return []
  }
}

/** The repository's git folder, for the engine to watch. A worktree's `.git` is a file naming it. */
async function gitDirOf($: EngineInterface, cwd: string): Promise<string> {
  for (let dir = cwd, i = 0; i < 64; i++) {
    const dot = join(dir, '.git')
    try {
      const st = await $.fs.stat(dot)
      if (st.kind === 'dir') return dot
      const ref = /^gitdir:\s*(.+)$/m.exec(String(await $.fs.read(dot)))?.[1]?.trim()
      return ref ? resolve(dir, ref, home) : ''
    } catch {
      const up = dirname(dir)
      if (up === dir) return ''
      dir = up
    }
  }
  return ''
}

// --- the pane

function paneTitle(root: string): string {
  return T.paneTitle(basename(root) || root)
}

async function openPane($: EngineInterface, root: string, focus = false): Promise<void> {
  try {
    await $.ui.open(focus ? { id: PANE, title: paneTitle(root), focus: true } : { id: PANE, title: paneTitle(root) })
  } catch {
    // No surface (`claude -p`, the SDK): the tree keeps its state for a later session.
  }
}

/** Starts the tree afresh on `root`. */
async function reset($: EngineInterface, root: string, focus = false): Promise<void> {
  const prev = await getTree($)
  glowRun += 1
  glowTimer?.cancel()
  glowTimer = null
  lastRoot = root
  searchIndex = null
  sizing.epoch += 1
  sizing.queue = []
  await update($, tree, () => ({ ...emptyTree(root), showHidden: prev.showHidden, showSize: prev.root ? prev.showSize : settings.sizeColumn }))
  if (focus || !staysClosed) await openPane($, root, focus)
  await loadFolders($, [root])
  await detectRepo($)
  await refreshRepo($)
}

/** Moves the tree to the working folder when it follows it and the folder changed. True when it moved. */
async function followCwd($: EngineInterface): Promise<boolean> {
  if (!followsCwd) return false
  const cwd = await cwdOf($)
  if ((await getTree($)).root === cwd) return false
  await reset($, cwd)
  return true
}

/** Re-lists the open folders and re-reads git, at most every SYNC_EVERY_MS unless forced. */
async function sync($: EngineInterface, force = false): Promise<void> {
  const at = await $.clock.now()
  if (!force && at - lastSync < SYNC_EVERY_MS) return
  lastSync = at
  searchIndex = null
  const t = await getTree($)
  if (!t.root) return
  await loadFolders($, [t.root, ...openFolders(t)])
  if (t.repo) await refreshRepo($)
}

// --- glow

/** Where the view stays when the person turned "Follow Claude" off: on the row it showed at the top. */
function keepTop(t: FileTree, expanded: string[]): Partial<FileTree> {
  if (settings.followClaude) return { scroll: null }
  const top = visibleRows(t)[t.scroll ?? view.from]?.node.id
  const at = top ? visibleRows({ ...t, expanded }).findIndex(r => r.node.id === top) : -1
  return at < 0 ? {} : { scroll: at }
}

async function glow($: EngineInterface, tones: Record<string, Tone>): Promise<void> {
  if (Object.keys(tones).length === 0) return
  const run = ++glowRun
  const root = (await getTree($)).root
  glowTimer?.cancel()
  glowTimer = null
  await patch($, t => {
    if (t.root !== root) return {}
    const next = addGlow(t, tones)
    return { glow: next.glow, expanded: next.expanded, ...keepTop(t, next.expanded) }
  })
  if (glowRun !== run) return
  glowTimer = $.clock.after(GLOW_MS, () => {
    if (glowRun !== run) return
    glowTimer = null
    void patch($, () => (glowRun === run ? { glow: NO_GLOW } : {})).catch(() => undefined)
  })
}

/** An Edit, Write or Read: refreshes what it touched and lets it glow. */
async function touched($: EngineInterface, paths: string[], tone: Tone, show: boolean): Promise<void> {
  const files = paths.map(posix)
  if (tone !== 'read' && previewText && files.includes(previewText.path)) previewText = null
  if (await followCwd($)) return
  const t = await getTree($)
  if (!t.root) return
  const within = files.filter(p => inside(t.root, p))
  if (within.length === 0) return
  if (tone === 'read') await revealPaths($, within)
  else {
    searchIndex = null
    await forgetSizes($, within)
    const dirs = [...new Set(within.map(dirname))].filter(d => inside(t.root, d))
    await revealPaths($, dirs)
    await loadFolders($, dirs)
    await refreshRepo($)
  }
  if (show) await glow($, Object.fromEntries(within.map(p => [p, tone])))
}

/** Opens the folders down to each path and moves the cursor to the last one. */
async function reveal($: EngineInterface, paths: string[]): Promise<void> {
  if (await followCwd($)) return
  await revealPaths($, paths)
  await patch($, t => {
    const open = new Set(t.expanded)
    for (const p of paths) for (const a of ancestors(p, t.root)) open.add(a)
    return { expanded: [...open], cursor: paths[paths.length - 1] ?? t.cursor, scroll: null }
  })
}

// --- folder sizes

async function walkSize($: EngineInterface, dir: string): Promise<number> {
  let total = 0
  let seen = 0
  let level = [dir]
  while (level.length) {
    const next: string[] = []
    for (const d of level) {
      let entries
      try {
        entries = await $.fs.list(d)
      } catch {
        continue
      }
      for (const e of entries) {
        if (++seen > SIZE_WALK_LIMIT) return -1
        if (e.kind === 'dir' && !e.isLink) next.push(join(d, e.name))
        else if (e.kind === 'file') total += e.size
      }
    }
    level = next
  }
  return total
}

/** The folder's disk usage: `du` where there is one, a summed listing on Windows. -1 when unknown. */
async function folderSize($: EngineInterface, dir: string): Promise<number> {
  if (isDiskRoot(dir)) return -1
  if ((await osOf($)) === 'win32') return walkSize($, dir)
  try {
    const run = await $.process.run(['du', '-skxH', dir], { timeoutMs: SIZE_TIMEOUT_MS })
    const kb = Number(run.stdout.trim().split(/\s/)[0] || NaN)
    return Number.isFinite(kb) ? kb * 1024 : -1
  } catch {
    return -1
  }
}

function pumpSizes($: EngineInterface): void {
  while (sizing.active < SIZE_JOBS && sizing.queue.length) {
    const dir = sizing.queue.shift() ?? ''
    const epoch = sizing.epoch
    sizing.running.add(dir)
    sizing.active += 1
    void folderSize($, dir)
      .then(async bytes => {
        if (epoch === sizing.epoch) return patch($, t => (inside(t.root, dir) ? { sizes: { ...t.sizes, [dir]: bytes } } : {}))
        // The sizes were forgotten while this ran: ask again if the folder still shows.
        const t = await getTree($)
        if (t.showSize && inside(t.root, dir) && !(dir in t.sizes) && !sizing.queue.includes(dir)) sizing.queue.push(dir)
      })
      .catch(() => undefined)
      .finally(() => {
        sizing.running.delete(dir)
        sizing.active -= 1
        pumpSizes($)
      })
  }
}

function wantSizes($: EngineInterface, dirs: string[]): void {
  for (const dir of dirs) if (!sizing.running.has(dir) && !sizing.queue.includes(dir)) sizing.queue.push(dir)
  pumpSizes($)
}

/** Drops the sizes of the folders that hold `paths`, or all of them. */
async function forgetSizes($: EngineInterface, paths?: string[]): Promise<void> {
  sizing.epoch += 1
  sizing.queue = []
  await patch($, t => {
    if (!paths) return { sizes: {} }
    return { sizes: Object.fromEntries(Object.entries(t.sizes).filter(([dir]) => !paths.some(p => inside(dir, p)))) }
  })
}

// --- what a Bash command wrote

function pruneArgs(root: string, ignored: string[] = []): string[] {
  const names = isBroad(root) ? [...PRUNE, ...HOME_PRUNE] : PRUNE
  return ['(', ...names.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name])), ...ignored.flatMap(p => ['-o', '-path', p]), ')', '-prune', '-o']
}

/**
 * Marks the time before a command that may write. On macOS and Linux a marker file does it, which `find -newer`
 * compares against on both; Windows has no find and looks at the files git reports instead.
 */
async function markNow($: EngineInterface, mayWrite: boolean): Promise<Since> {
  const ms = await $.clock.now()
  const os = await osOf($)
  if (os === 'win32' || !mayWrite) return { ms, marker: '', os }
  const marker = `${((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')}/cgp-files-${await $.session.id()}-${++markerSeq}.mark`
  try {
    await $.process.run(['touch', marker], { timeoutMs: 3_000 })
    return { ms, marker, os }
  } catch {
    return { ms, marker: '', os }
  }
}

function dropMarkers($: EngineInterface, markers: string[]): void {
  const list = markers.filter(Boolean)
  if (list.length) void $.process.run(['rm', '-f', ...list], { timeoutMs: 3_000 }).catch(() => undefined)
}

/** Files below `root` changed since the marker. */
async function changedSince($: EngineInterface, root: string, since: Since, depth: number, ignored: string[] = []): Promise<string[]> {
  if (isDiskRoot(root) || !since.marker) return []
  try {
    const skip = pruneArgs(root, ignored.filter(p => inside(root, p)).slice(0, 40))
    const run = await $.process.run(['find', '-H', root, '-xdev', ...(depth ? ['-maxdepth', String(depth)] : []), ...skip, '-newer', since.marker, '-print0'], { timeoutMs: 8_000 })
    return run.stdout.split('\0').filter(p => p && p !== root)
  } catch {
    return []
  }
}

async function newerThan($: EngineInterface, paths: string[], ms: number): Promise<string[]> {
  const hits = await Promise.all(paths.map(async p => ((await $.fs.stat(p).catch(() => null))?.mtimeMs ?? 0) > ms))
  return paths.filter((_, i) => hits[i])
}

/** Inside a repository: what changed, and on Windows what git newly reports deleted. */
async function changedInRepo($: EngineInterface, root: string, since: Since, before: Record<string, Change>, ignored: string[]): Promise<{ hits: string[]; gone: string[] }> {
  if (since.os !== 'win32') return { hits: await changedSince($, root, since, 0, ignored), gone: [] }
  if (dirtyFiles.root !== root) return { hits: [], gone: [] }
  const entries = Object.entries(dirtyFiles.files)
  const gone = entries.filter(([p, c]) => c === 'del' && before[p] !== 'del').map(([p]) => p)
  const live = entries.filter(([, c]) => c !== 'del').map(([p]) => p)
  return { hits: await newerThan($, live.slice(0, 4_000), since.ms), gone }
}

/** After Bash commands: refreshes git and the folders they changed, and lets writes, reads and commits glow. */
async function afterBash($: EngineInterface, jobs: ScanJob[]): Promise<void> {
  const reads = queuedReads
  queuedReads = []
  if (await followCwd($)) return
  const t = await getTree($)
  if (!t.root) return
  const actions = jobs.flatMap(j => j.actions)
  const writers = jobs.filter(j => !j.onlyReads)
  const writes = writers.length > 0
  const since = (writes ? writers : jobs).reduce((a, j) => (j.since.ms < a.ms ? j.since : a), (writers[0] ?? jobs[0])?.since ?? { ms: 0, marker: '', os: 'linux' as const })
  const before = dirtyFiles.root === t.root ? dirtyFiles.files : {}
  if (jobs.some(j => j.isInit) || (!t.repo && (await exists($, join(t.root, '.git'))))) await detectRepo($)
  const probed = await getTree($)
  if (probed.repo && (writes || probed.repo.top !== t.repo?.top)) await refreshRepo($)
  if (writes) {
    searchIndex = null
    await forgetSizes($)
  }
  const fresh = await getTree($)
  const ignored = new Set(fresh.repo?.ignored ?? [])
  const tones: Record<string, Tone> = {}

  if (writes) {
    const found = fresh.repo
      ? await changedInRepo($, t.root, since, before, fresh.repo.ignored)
      : { hits: await changedSince($, t.root, since, NO_REPO_DEPTH), gone: [] }
    const hits = found.hits.filter(p => inside(t.root, p) && !underAny(p, ignored, t.root)).slice(0, WRITE_REVEAL_LIMIT)
    await revealPaths($, hits)
    const loaded = await getTree($)
    const dirs = [...new Set([loaded.root, ...openFolders(loaded), ...hits.map(dirname), ...found.gone.map(dirname)])].filter(d => inside(loaded.root, d))
    const listed = await loadFolders($, dirs)
    // Windows outside a repository: what the listings show as newer than the command is what it wrote.
    if (!fresh.repo && since.os === 'win32') {
      for (const kids of listed.values()) for (const n of kids) if (n.mtime > since.ms && hits.length < WRITE_REVEAL_LIMIT) hits.push(n.id)
    }
    await patch($, cur => {
      const ids = new Set(cur.nodes.map(n => n.id))
      return { expanded: cur.expanded.filter(id => ids.has(id)) }
    })
    const present = new Set((await getTree($)).nodes.map(n => n.id))
    const tone = actions.find(a => !['commit', 'push', 'add'].includes(a.verb))?.tone ?? 'write'
    if (settings.showWrites) for (const id of hits) if (present.has(id)) tones[id] = tone
  }

  if (settings.showReads) {
    const found: string[] = []
    for (const r of reads) {
      if (found.length >= READ_REVEAL_LIMIT) break
      if (r !== t.root && inside(t.root, r) && !underAny(r, ignored, t.root) && (await exists($, r))) found.push(r)
    }
    if (found.length) {
      await revealPaths($, found)
      const shown = new Set((await getTree($)).nodes.map(n => n.id))
      for (const r of found) if (shown.has(r) && !tones[r]) tones[r] = 'read'
    }
  }

  if (settings.showWrites && actions.length) {
    const final = await getTree($)
    const isCommit = actions.some(a => a.verb === 'commit')
    if ((isCommit || actions.some(a => a.verb === 'add')) && final.repo) {
      const paths = (await committedPaths($, final, isCommit)).filter(p => !underAny(p, ignored, final.root)).slice(0, READ_REVEAL_LIMIT)
      await revealPaths($, paths)
      const shown = new Set((await getTree($)).nodes.map(n => n.id))
      for (const p of paths) if (shown.has(p)) tones[p] = 'commit'
    }
    const moved = actions.find(a => ['push', 'pull', 'fetch', 'checkout', 'switch', 'branch', 'merge', 'rebase', 'tag'].includes(a.verb) || a.kind.startsWith('gh '))
    if (moved) tones[BRANCH_ROW] = moved.tone
    else if (isCommit) tones[BRANCH_ROW] = 'commit'
  }
  await glow($, tones)
}

/** Runs scans one after another; jobs that arrive meanwhile are scanned together. */
function scheduleScan($: EngineInterface, job: ScanJob): void {
  scanJobs.push(job)
  if (scanning) return
  scanning = (async () => {
    while (scanJobs.length) {
      const jobs = scanJobs
      scanJobs = []
      try {
        await afterBash($, jobs)
      } finally {
        dropMarkers($, jobs.map(j => j.since.marker))
      }
    }
  })().finally(() => {
    scanning = null
  })
}

// --- git actions in the footer

/** What the engine's git report proves happened. */
const PROOF: Record<string, (op: GitOperation) => boolean> = {
  push: op => Boolean(op.push),
  merge: op => op.branch?.action === 'merged',
  rebase: op => op.branch?.action === 'rebased',
  'pr create': op => op.pr?.action === 'created',
  'pr merge': op => op.pr?.action === 'merged',
  'pr comment': op => op.pr?.action === 'commented',
}

async function startEvents($: EngineInterface, actions: GitAction[]): Promise<number[]> {
  const at = await $.clock.now()
  const ids = actions.map(() => ++eventSeq)
  await setEvents($, cur => [
    ...cur.filter(e => e.state === 'running' || at - e.at < EVENT_TTL_MS),
    ...actions.map((a, i): GitEvent => ({ id: ids[i] ?? 0, kind: a.kind, label: a.running, state: 'running', detail: '', at, tone: a.tone, icon: a.icon })),
  ])
  return ids
}

/**
 * Each action's outcome, claimed only on evidence: a commit by a new HEAD, others by the engine's git report, or by
 * the exit code when `&&` alone chains the command. Anything else reads "ran git x".
 */
async function outcomes($: EngineInterface, p: Pending, ok: boolean, op: GitOperation | undefined): Promise<Outcome[]> {
  const chain = chainOf(p.command)
  const needsHead = p.actions.some(a => a.verb === 'commit') && !op?.commit
  const after = needsHead ? await headOf($, (await getTree($)).root || (await cwdOf($))) : ''
  return p.actions.map((a): Outcome => {
    if (a.verb === 'commit') {
      const sha = op?.commit?.sha || (after && after !== p.head ? after : '')
      return sha ? { state: 'done', label: a.done, detail: sha.slice(0, 7) } : { state: 'failed', label: T.failed(a.verb), detail: '' }
    }
    if ((op && PROOF[a.verb]?.(op)) || (ok && chain.isAndOnly)) return { state: 'done', label: a.done, detail: '' }
    if (!ok && chain.isAndOnly && chain.size === 1) return { state: 'failed', label: T.failed(a.verb), detail: '' }
    return { state: 'done', label: T.ran(a.kind), detail: '' }
  })
}

async function finishEvents($: EngineInterface, p: Pending, results: Outcome[]): Promise<void> {
  const at = await $.clock.now()
  await setEvents($, cur =>
    cur.map(e => {
      const result = results[p.ids.indexOf(e.id)]
      return result ? { ...e, ...result, at } : e
    }),
  )
  $.clock.after(EVENT_TTL_MS + 500, () => void setEvents($, cur => cur.filter(e => e.state === 'running' || e.at > at)).catch(() => undefined))
}

const allFailed = (p: Pending): Outcome[] => p.actions.map(a => ({ state: 'failed', label: T.failed(a.verb), detail: '' }))

/** The actions that did not fail, which the scan glows for. */
const succeeded = (p: Pending | null, results: Outcome[]): GitAction[] => (p ? p.actions.filter((_, i) => results[i]?.state !== 'failed') : [])

async function settleBackground($: EngineInterface, text: string): Promise<void> {
  if (background.size === 0 || !text.includes('<task-notification>')) return
  for (const [id, status] of endedTasks(text)) {
    const task = background.get(id)
    if (!task) continue
    background.delete(id)
    const results = task.pending ? await outcomes($, task.pending, status === 'completed', undefined) : []
    if (task.pending) await finishEvents($, task.pending, results)
    if (settings.showReads) queuedReads.push(...task.reads)
    scheduleScan($, { ...task.job, actions: succeeded(task.pending, results) })
  }
}

// --- search

function walkFiles($: EngineInterface, root: string, depth: number, limit: number): Promise<string[]> {
  return (async () => {
    const out: string[] = []
    let level = [root]
    for (let d = 0; d < depth && level.length && out.length < limit; d++) {
      const next: string[] = []
      for (const dir of level) {
        for (const n of (await listFolder($, dir)) ?? []) {
          if (n.kind !== 'dir') out.push(n.id)
          else if (!PRUNE.includes(n.name)) next.push(n.id)
        }
        if (out.length >= limit) break
      }
      level = next
    }
    return out
  })()
}

/** Every file below the root: git's list in a repository, a bounded `find` outside one. */
async function allFiles($: EngineInterface, t: FileTree): Promise<string[] | null> {
  const depth = isDiskRoot(t.root) ? 3 : 6
  try {
    if (!t.repo && (await osOf($)) === 'win32') return await walkFiles($, t.root, depth, 20_000)
    const run = t.repo
      ? await git($, t.root, ['ls-files', '-co', '--exclude-standard', '-z'], 10_000)
      : await $.process.run(['find', '-H', t.root, '-xdev', '-maxdepth', String(depth), ...pruneArgs(t.root), '-type', 'f', '-print0'], { timeoutMs: 10_000 })
    if (t.repo && run.exitCode !== 0) return null
    const paths = run.stdout.split('\0').filter(Boolean)
    if (run.isStdoutTruncated) paths.pop()
    return paths.map(p => (isAbsolute(p) ? posix(p) : join(t.root, p)))
  } catch {
    return null
  }
}

function indexOf($: EngineInterface, t: FileTree): Promise<string[]> {
  if (searchIndex?.root !== t.root) {
    const index: { root: string; paths: Promise<string[]> } = {
      root: t.root,
      paths: allFiles($, t).then(paths => {
        if (paths === null && searchIndex === index) searchIndex = null
        return paths ?? []
      }),
    }
    searchIndex = index
  }
  return searchIndex.paths
}

/** Sets the query and lists the folders of the first matches, also ones never opened. */
async function search($: EngineInterface, query: string): Promise<string[]> {
  if (!(await getTree($)).query.trim()) searchIndex = null
  await patch($, () => ({ query }))
  const q = query.trim().toLowerCase()
  if (!q) return []
  const t = await getTree($)
  const hits = (await indexOf($, t)).filter(p => relative(t.root, p).toLowerCase().includes(q)).slice(0, SEARCH_REVEAL_LIMIT)
  if ((await getTree($)).query !== query) return []
  await revealPaths($, hits)
  const shown = await getTree($)
  const ids = new Set(shown.nodes.map(n => n.id))
  const stale = [...new Set(hits.filter(p => !ids.has(p)).map(dirname))].filter(d => inside(shown.root, d))
  if (stale.length) await loadFolders($, stale)
  return hits
}

/** Enter in the search box: opens the folders of the first matches, puts the cursor on the first and clears the box. */
async function jump($: EngineInterface, query: string): Promise<void> {
  const hits = (await search($, query)).slice(0, SEARCH_JUMP_LIMIT)
  await patch($, t => {
    const open = new Set(t.expanded)
    for (const p of hits) for (const a of ancestors(p, t.root)) open.add(a)
    return { query: '', expanded: [...open], cursor: hits[0] ?? t.cursor, scroll: null }
  })
}

// --- preview and opening

async function loadPreview($: EngineInterface, path: string): Promise<void> {
  try {
    const stat = await $.fs.stat(path)
    if (stat.size > PREVIEW_MAX_BYTES) previewText = { path, text: '', note: tooLargeNote(stat.size) }
    else {
      const text = String(await $.fs.read(path))
      previewText = isBinary(text) ? { path, text: '', note: binaryNote(stat.size) } : previewOf(path, text)
    }
  } catch (err) {
    previewText = { path, text: '', note: T.readFailed(String((err as Error)?.message ?? err).split('\n')[0] ?? '') }
  }
}

async function showPreview($: EngineInterface, path: string): Promise<void> {
  await loadPreview($, path)
  await patch($, () => ({ preview: { path, top: 0 }, selected: path }))
}

async function closePreview($: EngineInterface): Promise<void> {
  await patch($, () => ({ preview: null }))
}

async function scrollPreview($: EngineInterface, by: number): Promise<void> {
  const t = await getTree($)
  if (!t.preview) return
  const last = Math.max(0, lineCount(previewText?.text ?? '') - previewRows)
  const top = Math.max(0, Math.min(last, t.preview.top + by))
  if (top !== t.preview.top) await patch($, cur => (cur.preview ? { preview: { ...cur.preview, top } } : {}))
}

/** Opens a file with the "Open with" setting, or with the system's default app when `external`. */
async function openFile($: EngineInterface, path: string, external = false): Promise<void> {
  if (!external && settings.openWith === 'preview') return showPreview($, path)
  const os = await osOf($)
  const native = (p: string) => (os === 'win32' ? p.replace(/\//g, '\\') : p)
  const custom = external ? null : customOpener(settings.openWith, native(path), native(dirname(path)))
  const launch = custom ? customLaunch(os, custom) : defaultOpener(os, path)
  const app = custom?.[0] ?? launch.argv[0] ?? ''
  try {
    const run = await $.process.run(launch.argv, launch.init)
    if (run.exitCode !== 0) toast($, T.openFailed(path, app, run.stderr.trim().split('\n')[0] || `exit ${run.exitCode}`))
  } catch {
    toast($, T.openFailed(path, app, ''))
  }
}

async function copyPath($: EngineInterface, id: string, absolute: boolean, surface?: string): Promise<void> {
  const t = await getTree($)
  const text = !absolute && id !== t.root && inside(t.root, id) ? relative(t.root, id) : id
  try {
    const done = await $.ui.copy({ text, ...(surface ? { surface: surface as 'terminal' } : {}) })
    toast($, done.isCopied ? T.copied(text) : T.copyFailed)
  } catch {
    toast($, T.copyFailed)
  }
}

// --- moving through the tree

async function toggle($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir' && !(await getTree($)).expanded.includes(n.id)) await loadFolders($, [n.id])
  await patch($, t => {
    const open = new Set(t.expanded)
    if (n.kind === 'dir') {
      if (open.has(n.id)) open.delete(n.id)
      else open.add(n.id)
    }
    return { expanded: [...open], cursor: n.id, selected: n.kind === 'dir' ? t.selected : n.id }
  })
}

/** Opening a folder makes it the root; opening a file hands it to its app. */
async function openNode($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind !== 'dir') return openFile($, n.id)
  followsCwd = false
  await reset($, n.id)
}

async function press($: EngineInterface, n: FileNode): Promise<void> {
  const at = await $.clock.now()
  const isDouble = lastPress.id === n.id && at - lastPress.at < DOUBLE_PRESS_MS
  lastPress = { id: isDouble ? '' : n.id, at }
  if (isDouble) await openNode($, n)
  else await toggle($, n)
}

async function onKey($: EngineInterface, key: string, shift: boolean, surface: string | undefined): Promise<void> {
  const t = await getTree($)
  if (t.preview) {
    const page = Math.max(1, previewRows - 2)
    const by: Record<string, number> = { up: -1, k: -1, down: 1, j: 1, pageup: -page, pagedown: page, home: -Infinity, end: Infinity }
    if (key === 'left' || key === 'h') await closePreview($)
    else if (key in by) await scrollPreview($, by[key] ?? 0)
    return
  }
  const rows = visibleRows(t)
  const at = rows.findIndex(r => r.node.id === t.cursor)
  const cur = rows[at]?.node
  const move = async (d: number) => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + d))]
    if (target) await patch($, () => ({ cursor: target.node.id, scroll: null }))
  }
  const steps: Record<string, number> = { up: -1, k: -1, down: 1, j: 1, pageup: -10, pagedown: 10, home: -rows.length, end: rows.length }
  if (key in steps) return move(steps[key] ?? 0)
  if (!cur) return
  if (key === 'y' || key === 'Y') await copyPath($, cur.id, key === 'Y' || shift, surface)
  else if ((key === 'right' || key === 'l') && cur.kind === 'dir' && !t.expanded.includes(cur.id)) await toggle($, cur)
  else if (key === 'left' || key === 'h') {
    if (cur.kind === 'dir' && t.expanded.includes(cur.id)) await toggle($, cur)
    else if (cur.parent !== t.root) await patch($, () => ({ cursor: cur.parent }))
  } else if (key === 'return') await (cur.kind === 'dir' ? toggle($, cur) : openNode($, cur))
  else if (key === ' ') await toggle($, cur)
}

async function refreshAll($: EngineInterface): Promise<void> {
  const t = await getTree($)
  searchIndex = null
  await forgetSizes($)
  await loadFolders($, [t.root, ...t.expanded])
  await detectRepo($)
  await refreshRepo($)
  if (t.query.trim()) await search($, t.query)
}

function actionsFor($: EngineInterface, t: FileTree): PaneActions {
  const run = (fn: () => Promise<unknown>) => () => void fn().catch(() => undefined)
  return {
    up: run(async () => {
      followsCwd = false
      await reset($, dirname(t.root))
    }),
    home: run(async () => {
      followsCwd = true
      await reset($, await cwdOf($))
    }),
    refresh: run(() => refreshAll($)),
    toggleHidden: run(() => patch($, cur => ({ showHidden: !cur.showHidden }))),
    toggleSize: run(() => patch($, cur => ({ showSize: !cur.showSize }))),
    collapse: run(() =>
      patch($, cur => ({ expanded: [], nodes: forgetBelow(cur.nodes, cur.nodes.filter(n => n.parent === cur.root && n.kind === 'dir').map(n => n.id)) })),
    ),
    unselect: run(() => patch($, () => ({ selected: '' }))),
    search: (q: string) => void search($, q).catch(() => undefined),
    jump: (q: string) => void jump($, q).catch(() => undefined),
    back: run(() => closePreview($)),
    external: run(() => openFile($, t.preview?.path ?? '', true)),
  }
}

/** Nerd Font icons need a Nerd Font installed; this looks for one the way fontconfig or macOS would find it. */
async function nerdFontInstalled($: EngineInterface): Promise<boolean> {
  const script =
    'if command -v fc-list >/dev/null 2>&1; then fc-list | grep -qi "nerd font" && echo yes; ' +
    'else ls "$HOME"/Library/Fonts/*Nerd* /Library/Fonts/*Nerd* >/dev/null 2>&1 && echo yes; fi; true'
  try {
    return (await $.process.run(['sh', '-c', script], { timeoutMs: 5_000 })).stdout.trim() === 'yes'
  } catch {
    return false
  }
}

function usesPlainGlyphs(surface: string): boolean {
  if (settings.glyphs === 'plain') return true
  if (settings.glyphs === 'nerd') return false
  return surface === 'desktop' || !hasNerdFont
}

/** The pre-call facts of an Edit, Write or Bash call. */
type Before = { since: Since; pending: Pending | null; actions: GitAction[]; readsOnly: boolean; cwd: string }

async function beforeTool($: EngineInterface, command: string, isBash: boolean): Promise<Before> {
  const cwd = isBash ? await cwdOf($) : ''
  const actions = gitActions(command)
  const readsOnly = actions.length === 0 && onlyReads(command)
  const since = await markNow($, isBash && !readsOnly)
  const before = actions.some(a => a.verb === 'commit') ? await getTree($) : null
  const head = before?.repo ? await headOf($, before.root) : ''
  const pending = actions.length ? { actions, ids: await startEvents($, actions), command, head } : null
  return { since, pending, actions, readsOnly, cwd }
}

/** After a Bash call: settles its git actions and schedules the scan, or waits for its background task. */
async function afterBashCall($: EngineInterface, b: Before, command: string, result: { isError?: boolean; isReadOnly?: true; result?: unknown }): Promise<void> {
  // A failed command may still have written something, so it is scanned like any other.
  const out: Partial<BuiltinToolResults['Bash']> = !result.isError && result.result && typeof result.result === 'object' ? result.result : {}
  const reads = settings.showReads ? readPaths(command, b.cwd, typeof out.stdout === 'string' ? out.stdout : '', home) : []
  const job: ScanJob = { actions: [], since: b.since, isInit: b.actions.some(a => a.isInit), onlyReads: b.readsOnly || result.isReadOnly === true }
  if (followsCwd && changesFolder(command)) $.clock.after(400, () => void followCwd($).catch(() => undefined))
  if (out.backgroundTaskId) {
    background.set(out.backgroundTaskId, { pending: b.pending, job, reads })
    return
  }
  const results = b.pending ? await outcomes($, b.pending, !result.isError, out.gitOperation) : []
  if (b.pending) await finishEvents($, b.pending, results)
  queuedReads.push(...reads)
  scheduleScan($, { ...job, actions: succeeded(b.pending, results) })
}

async function runCommand($: EngineInterface, args: string, presentation: { isFullscreen: boolean; columns: number }): Promise<{ text: string }> {
  // The layout checks are the terminal's: the desktop app docks the pane itself.
  const inTerminal = await $.session.surfaces().then(
    s => s.includes('terminal'),
    () => true,
  )
  if (inTerminal && !presentation.isFullscreen) return { text: T.needsFullscreen }
  if (inTerminal && presentation.columns < MIN_COLUMNS) return { text: T.needsWidth(MIN_COLUMNS) }
  staysClosed = false
  const arg = args.trim()
  const cwd = await cwdOf($)
  followsCwd = !arg
  const root = arg ? resolve(cwd, arg, home) : cwd
  await reset($, root, true)
  return { text: T.opened(shortPath(root, home), followsCwd) }
}

async function startSession($: EngineInterface, windows: boolean): Promise<void> {
  const remote = Boolean((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY')))
  // Over SSH the font is the local terminal's, which cannot be checked from here: assume the person has one.
  hasNerdFont = remote || (!windows && (await nerdFontInstalled($)))
  const t = await getTree($)
  if (isGlowing(t.glow) || t.preview) await patch($, () => ({ glow: NO_GLOW, preview: null }))
  await setEvents($, cur => cur.map(ev => (ev.state === 'running' ? { ...ev, state: 'failed', label: T.interrupted(ev.kind) } : ev)))
  const cwd = await cwdOf($)
  if (!t.root || t.nodes.length === 0 || (followsCwd && t.root !== cwd)) await reset($, cwd)
  else if (!staysClosed) await openPane($, t.root)
}

async function onRowsMessage($: EngineInterface, m: Record<string, unknown>, surface: string | undefined): Promise<void> {
  void sync($).catch(() => undefined)
  const t = await getTree($)
  if (typeof m.copy === 'string') await copyPath($, m.copy, Boolean(m.shift), surface)
  else if (typeof m.scrollTo === 'number') {
    const to = Math.round(Math.max(0, Math.min(1, m.scrollTo)) * view.max)
    if (to !== t.scroll) await patch($, () => ({ scroll: to }))
  } else if (typeof m.press === 'string') {
    const n = t.nodes.find(x => x.id === m.press)
    if (!n) return
    // A click holds the view where it is, so the row does not jump away from the pointer.
    if (t.scroll === null) await patch($, () => ({ scroll: view.from }))
    if (m.ctrl || m.shift) await openNode($, n)
    else await press($, n)
  } else if (typeof m.key === 'string') await onKey($, m.key, Boolean(m.shift), surface)
}

async function onWheel($: EngineInterface, by: number): Promise<void> {
  const step = Math.sign(by) * Math.max(3, Math.abs(by))
  const t = await getTree($)
  if (t.preview) return scrollPreview($, step)
  const to = Math.max(0, Math.min(view.max, (t.scroll ?? view.from) + step))
  if (to !== t.scroll) await patch($, () => ({ scroll: to }))
}

/** The context a prompt gets: the selected file. `@path` mentions are revealed on the side. */
async function promptContext($: EngineInterface, text: string, context: readonly string[]): Promise<string[]> {
  void settleBackground($, text).catch(() => undefined)
  if (!(await followCwd($))) void sync($).catch(() => undefined)
  const t = await getTree($)
  const out = [...context]
  if (t.selected && (await exists($, t.selected))) out.push(selectionContext(t.selected))
  const mentioned = mentions(text, t.root, home)
  if (mentioned.length) {
    void (async () => {
      const found: string[] = []
      for (const p of mentioned) if (await exists($, p)) found.push(p.replace(/\/$/, ''))
      if (found.length) await reveal($, found)
    })().catch(() => undefined)
  }
  return out
}

async function afterClassicStart($: EngineInterface, source: string, cwd: string): Promise<string> {
  if (source === 'clear' || source === 'resume' || source === 'fork') {
    void (async () => {
      const root = followsCwd || !lastRoot ? await cwdOf($) : lastRoot
      const t = await getTree($)
      if (t.root !== root || t.nodes.length === 0) await reset($, root)
    })().catch(() => undefined)
  }
  return gitDirOf($, posix(cwd))
}

export const register: Register = (on, options) => {
  settings = readSettings(options as Record<string, unknown> | undefined)
  staysClosed = !settings.openAtStart

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: T.command, description: T.commandHelp })
    const windows = (await $.env.get('OS')) === 'Windows_NT'
    useWindowsPaths(windows)
    home = posix(((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/[\\/]+$/, ''))
    eventSeq = Math.max(eventSeq, ...(await read($, events)).map(ev => ev.id))
    void startSession($, windows).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: T.command }, async ($, e) =>
    runCommand($, e.args ?? '', e.presentation).catch((err: unknown) => ({ text: `cgp-files: ${err instanceof Error ? err.message : String(err)}` })),
  ).catch(($, e, next) => next(e))

  // Each gating hook ends in `.catch(... next(e))`: if the tree's own work fails, the call goes on as if the tree
  // were not installed. A file tree must never block Claude.
  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit' && e.tool !== 'Bash') return next(e)
    const command = e.tool === 'Bash' ? e.command : ''
    const b = await beforeTool($, command, e.tool === 'Bash').catch(() => null)
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (err) {
      if (b?.pending) void finishEvents($, b.pending, allFailed(b.pending)).catch(() => undefined)
      if (b) dropMarkers($, [b.since.marker])
      throw err
    }
    if (!b) return result
    if (b.pending && result.deny) {
      const ids = b.pending.ids
      void setEvents($, cur => cur.filter(ev => !ids.includes(ev.id))).catch(() => undefined)
    }
    if (result.deny || (result.isError && e.tool !== 'Bash')) {
      dropMarkers($, [b.since.marker])
      return result
    }
    if (e.tool === 'Bash') void afterBashCall($, b, command, result).catch(() => undefined)
    else {
      const file = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : 'notebook_path' in e && typeof e.notebook_path === 'string' ? e.notebook_path : ''
      if (file) void touched($, [file], 'write', settings.showWrites).catch(() => undefined)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    if (!result.deny && !result.isError && e.tool === 'Read' && settings.showReads) void touched($, [e.file_path], 'read', true).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'rows' || !e.data || typeof e.data !== 'object') return next(e)
    // Data from the drawing thread, shaped as RowsMessage in ui/rows.tsx; checked field by field all the same.
    await onRowsMessage($, e.data as Record<string, unknown>, e.surface).catch(() => undefined)
    return {}
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    // The engine watches the git index and HEAD, so a commit or checkout outside Claude shows too.
    const gitDir = await afterClassicStart($, e.source, e.cwd).catch(() => '')
    return gitDir ? { ...result, watchPaths: [...(result.watchPaths ?? []), join(gitDir, 'index'), join(gitDir, 'HEAD')] } : result
  }).catch(($, e, next) => next(e))

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    void followCwd($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    if (/[\\/]\.git[\\/]|[\\/](index|HEAD)$/.test(e.file_path)) $.clock.after(300, () => void sync($, true).catch(() => undefined))
    return result
  }).catch(($, e, next) => next(e))

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    void sync($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (scrollsNatively) return next(e)
    await onWheel($, e.by).catch(() => undefined)
    return {}
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const context = await promptContext($, e.text, e.context ?? []).catch(() => [...(e.context ?? [])])
    return next(context.length ? { ...e, context } : e)
  }).catch(($, e, next) => next(e))

  on('prompt.attachment', async ($, e, next) => {
    void settleBackground($, e.text).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text, Button, Input, Client } = $.ui.resolve(e)
    // Inline, the pane would push the transcript around: it closes itself and waits for /cgp-files.
    if (e.surface === 'terminal' && e.props.placement === 'inline') {
      staysClosed = true
      void Promise.resolve($.ui.close({ id: PANE })).catch(() => undefined)
      return <Box />
    }
    const isDesktop = e.surface === 'desktop'
    scrollsNatively = isDesktop
    const t = await getTree($)
    const at = await $.clock.now()
    const live = (await read($, events)).filter(ev => at - ev.at < (ev.state === 'running' ? EVENT_RUNNING_MAX_MS : EVENT_TTL_MS))
    const draw: PaneDraw = {
      el: { Box, Text, Button, Input, Client },
      tree: t,
      plain: usesPlainGlyphs(e.surface),
      isDesktop,
      columns: e.props.bodyColumns,
      bodyRows: e.props.scroll?.bodyRows ?? 40,
      home,
      followsCwd,
      followClaude: settings.followClaude,
      event: [...live].reverse().find(ev => ev.state === 'running') ?? live[live.length - 1],
      act: actionsFor($, t),
    }
    if (t.preview) {
      if (previewText?.path !== t.preview.path) await loadPreview($, t.preview.path)
      const p = previewView(draw, previewText)
      previewRows = p.rows
      return p.element as ReturnType<typeof Box>
    }
    const v = treeView(draw)
    view = { from: v.from, max: v.max }
    if (v.needSizes.length) wantSizes($, v.needSizes)
    return v.element as ReturnType<typeof Box>
  })
}
