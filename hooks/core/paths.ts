// Path arithmetic on forward-slash paths. On Windows the engine hands out `C:\x` and git `/c/x`; both become `C:/x`
// before anything else sees them, so the rest of the mod knows one shape.

let isWindows = false

/** Turns drive-letter handling on, once per session, when the engine runs on Windows. */
export function useWindowsPaths(on: boolean): void {
  isWindows = on
}

export function windowsPaths(): boolean {
  return isWindows
}

export function posix(path: string): string {
  if (!isWindows) return path
  return path.replace(/\\/g, '/').replace(/^\/([A-Za-z])(\/|$)/, (_, d: string) => `${d.toUpperCase()}:/`)
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || (isWindows && /^[A-Za-z]:\//.test(path))
}

/** True for `/` and, on Windows, a bare drive such as `C:/`. */
export function isDiskRoot(path: string): boolean {
  return path === '/' || /^[A-Za-z]:\/$/.test(path)
}

export function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

export function dirname(path: string): string {
  if (isWindows && /^[A-Za-z]:\/[^/]*$/.test(path)) return path.slice(0, 3)
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** The path below `root`, '' for the root itself. */
export function relative(root: string, path: string): string {
  return path === root ? '' : path.slice(root.endsWith('/') ? root.length : root.length + 1)
}

/** Every folder between `path` and `root`, nearest first, neither of the two included. */
export function ancestors(path: string, root: string): string[] {
  const out: string[] = []
  if (!root) return out
  for (let dir = dirname(path), prev = path; dir !== prev && dir !== root && inside(root, dir); prev = dir, dir = dirname(dir)) out.push(dir)
  return out
}

/** True when `path` or a folder above it, down to `root`, is in `set`. */
export function underAny(path: string, set: ReadonlySet<string>, root: string): boolean {
  if (set.size === 0) return false
  for (let cur = path; cur.length >= root.length; ) {
    if (set.has(cur)) return true
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return false
}

/** Resolves `p` against `cwd` the way a shell would, `~` included. */
export function resolve(cwd: string, p: string, home = ''): string {
  let path = posix(p)
  if (home && (path === '~' || path.startsWith('~/'))) path = home + path.slice(1)
  const drive = isAbsolute(path) && !path.startsWith('/') ? path.slice(0, 2) : ''
  const parts = isAbsolute(path) ? [drive] : posix(cwd).replace(/\/+$/, '').split('/')
  for (const seg of path.slice(drive.length).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop()
    } else parts.push(seg)
  }
  const joined = parts.join('/').replace(/\/+$/, '')
  if (joined === '') return '/'
  return /^[A-Za-z]:$/.test(joined) ? `${joined}/` : joined
}

/** `~/x` for paths in the home folder, the path itself otherwise. */
export function shortPath(path: string, home: string): string {
  return home && inside(home, path) ? `~${path.slice(home.length)}` : path
}

/** What the tree shows for a path: relative inside the root, short outside it. */
export function displayPath(path: string, root: string, home: string): string {
  return path !== root && inside(root, path) ? relative(root, path) : shortPath(path, home)
}
