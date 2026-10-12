// Reading `git status --porcelain=v1 -b -z` and `git diff --numstat -z` into per-path facts, rolled up to folders.

import type { Branch } from '../../types'
import { dirname, join } from './paths'

export type Change = 'new' | 'mod' | 'del'

export type Status = {
  branch: Branch | null
  status: Record<string, string>
  files: Record<string, Change>
  ignored: string[]
  untracked: string[]
}

/** Status letters, strongest first: a folder shows the strongest letter below it. */
const STRENGTH = ['U', 'D', 'M', 'T', 'R', 'C', 'A', '?']

export function stronger(a: string | undefined, b: string): string {
  if (!a) return b
  return STRENGTH.indexOf(b) < STRENGTH.indexOf(a) ? b : a
}

export function parseBranch(record: string): Branch {
  const body = record.replace(/^## /, '')
  if (body.startsWith('HEAD (no branch)')) return { head: 'detached', upstream: '', ahead: 0, behind: 0 }
  return {
    head: body.match(/^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.|\s|$)/)?.[1] ?? body,
    upstream: body.match(/\.\.\.(\S+)/)?.[1] ?? '',
    ahead: Number(body.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(body.match(/behind (\d+)/)?.[1] ?? 0),
  }
}

/** Maps a path git reports relative to the repository top to the absolute path below `root`, or null outside it. */
export function fromRepo(root: string, prefix: string): (rel: string) => string | null {
  return rel => (rel.startsWith(prefix) ? join(root, rel.slice(prefix.length).replace(/\/$/, '')).replace(/\/$/, '') : null)
}

/** Calls `fn` for every folder above `path`, up to and including `root`. */
function eachFolderUp(path: string, root: string, fn: (dir: string) => void): void {
  for (let dir = dirname(path); dir.length >= root.length && dir !== '/'; dir = dirname(dir)) {
    fn(dir)
    if (dir === root) break
  }
}

function letterOf(xy: string): string {
  if (xy === '??') return '?'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'U'
  return ['D', 'M', 'R', 'C', 'A', 'T'].find(c => xy.includes(c)) ?? ''
}

function changeOf(xy: string): Change {
  if (xy === '??' || (xy.includes('A') && !xy.includes('D'))) return 'new'
  if (xy.includes('D') && !xy.includes('U')) return 'del'
  return 'mod'
}

export function parseStatus(stdout: string, root: string, prefix: string): Status {
  const map = fromRepo(root, prefix)
  const out: Status = { branch: null, status: {}, files: {}, ignored: [], untracked: [] }
  const records = stdout.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i] ?? ''
    if (rec.startsWith('## ')) {
      out.branch = parseBranch(rec)
      continue
    }
    if (rec.length < 4) continue
    const xy = rec.slice(0, 2)
    const raw = rec.slice(3)
    // A rename or copy carries its old path as the next record.
    if (xy[0] === 'R' || xy[0] === 'C') i++
    const path = map(raw)
    if (!path) continue
    if (xy === '!!') {
      out.ignored.push(path)
      continue
    }
    if (xy === '??' && raw.endsWith('/')) out.untracked.push(path)
    else out.files[path] = changeOf(xy)
    const letter = letterOf(xy)
    if (!letter) continue
    out.status[path] = stronger(out.status[path], letter)
    eachFolderUp(path, root, dir => {
      out.status[dir] = stronger(out.status[dir], letter)
    })
  }
  return out
}

/** Adds `git diff --numstat -z` line counts into `into`. Binary files count as 0. */
export function parseNumstat(stdout: string, root: string, prefix: string, into: Record<string, [number, number]>): void {
  const map = fromRepo(root, prefix)
  const records = stdout.split('\0')
  for (let i = 0; i < records.length; i++) {
    const m = (records[i] ?? '').match(/^(-|\d+)\t(-|\d+)\t(.*)$/s)
    if (!m) continue
    let path = m[3] ?? ''
    // A rename puts an empty path here, then the old and the new path as two records.
    if (path === '') {
      i += 2
      path = records[i] ?? ''
    }
    const abs = path ? map(path) : null
    if (!abs) continue
    const prev = into[abs] ?? [0, 0]
    into[abs] = [prev[0] + (m[1] === '-' ? 0 : Number(m[1])), prev[1] + (m[2] === '-' ? 0 : Number(m[2]))]
  }
}

export function rollUpLines(lines: Record<string, [number, number]>, root: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = { ...lines }
  for (const [path, [add, del]] of Object.entries(lines)) {
    eachFolderUp(path, root, dir => {
      const prev = out[dir] ?? [0, 0]
      out[dir] = [prev[0] + add, prev[1] + del]
    })
  }
  return out
}

export function rollUpCounts(files: Record<string, Change>, root: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {}
  const slot = { new: 0, mod: 1, del: 2 } as const
  for (const [path, change] of Object.entries(files)) {
    eachFolderUp(path, root, dir => {
      const cur = out[dir] ?? [0, 0, 0]
      cur[slot[change]] += 1
      out[dir] = cur
    })
  }
  return out
}
