// The state cgp-files keeps in $.state. Paths are absolute and always use forward slashes, also on Windows.

/** One listed entry of a folder that has been opened at least once. */
export type FileNode = {
  /** The absolute path, which is also the node's identity. */
  id: string
  parent: string
  name: string
  kind: 'dir' | 'file' | 'link'
  hidden: boolean
  mtime: number
  size: number
  /** True once the folder's own children have been listed. */
  isLoaded: boolean
}

export type Branch = {
  head: string
  upstream: string
  ahead: number
  behind: number
}

/** What git reports for the tree's root. Absent outside a repository. */
export type Repo = {
  /** The repository's top level. */
  top: string
  /** The root's path below `top`, with a trailing slash, or '' at the top. */
  prefix: string
  branch: Branch | null
  /** One status letter per changed path, rolled up to every folder above it: ? A M T R C D U. */
  status: Record<string, string>
  /** Lines added and removed against HEAD, rolled up to folders. */
  lines: Record<string, [number, number]>
  /** New, modified and deleted file counts below each folder. */
  counts: Record<string, [number, number, number]>
  ignored: string[]
  untracked: string[]
}

/** A colour family a row glows in while Claude works on it. */
export type Tone = 'read' | 'write' | 'commit' | 'sync' | 'merge' | 'undo'

/** Rows glowing for Claude's latest work. `dim` holds collapsed folders that were opened to show a file. */
export type Glow = {
  bright: string[]
  dim: string[]
  tones: Record<string, Tone>
}

export type Preview = {
  path: string
  top: number
}

export type FileTree = {
  root: string
  nodes: FileNode[]
  expanded: string[]
  cursor: string
  selected: string
  query: string
  showHidden: boolean
  showSize: boolean
  sizes: Record<string, number>
  repo: Repo | null
  glow: Glow
  /** The first row shown when the person scrolled, or null when the view follows the cursor and Claude. */
  scroll: number | null
  preview: Preview | null
}

/** One git or GitHub command Claude ran, shown in the footer. */
export type GitEvent = {
  id: number
  kind: string
  label: string
  state: 'running' | 'done' | 'failed'
  /** A short commit hash, when there is one. */
  detail: string
  at: number
  tone: Tone
  icon: string
}

declare module 'claude-code' {
  interface PluginState {
    'cgp-files': {
      tree: FileTree
      events: GitEvent[]
    }
  }
}
