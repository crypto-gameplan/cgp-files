// Glyphs: Nerd Font icons where the terminal has one, plain Unicode elsewhere (the desktop app included).

import type { FileNode } from '../../types'
import type { IconName } from '../core/shell'

const cp = (n: number) => String.fromCodePoint(n)

/** One glyph in both sets. */
type Glyph = { nerd: string; plain: string }
const g = (nerd: number, plain: string): Glyph => ({ nerd: cp(nerd), plain })

export const UI = {
  open: g(0xf47c, '▾'),
  closed: g(0xf460, '▸'),
  up: g(0xf005d, '↑'),
  home: g(0xf02dc, '⌂'),
  refresh: g(0xf0450, '↻'),
  hiddenOn: g(0xf0208, '◉'),
  hiddenOff: g(0xf0209, '○'),
  size: g(0xf02ca, 'Σ'),
  collapse: g(0xeac5, '⊟'),
  unselect: g(0xf0777, '⊘'),
  clear: g(0xf0156, '×'),
  back: g(0xf004d, '←'),
  external: g(0xf08e, '↗'),
  ignored: g(0xf05e, '⊘'),
  noRepo: g(0xe702, '±'),
  branch: g(0xf418, '⑂'),
}

export const GIT_ICON: Record<IconName, Glyph> = {
  commit: g(0xf417, '●'),
  push: g(0xf0552, '↑'),
  pull: g(0xf0553, '↓'),
  branch: g(0xf418, '⑂'),
  merge: g(0xf419, '⑃'),
  pr: g(0xf407, '⇄'),
  github: g(0xf408, '◎'),
  stash: g(0xf01bc, '≡'),
  undo: g(0xf054c, '↶'),
  tag: g(0xf412, '⌖'),
  git: g(0xe702, '±'),
}

export function pick(glyph: Glyph, plain: boolean): string {
  return plain ? glyph.plain : glyph.nerd
}

const DOC = 0xf0354
const NODE = 0xf0626
const YAML = 0xe6a8
const TOML = 0xe6b2
const SHELL = 0xe795
const ARCHIVE = 0xf05c4
const VIDEO = 0xf022b
const AUDIO = 0xf0223
const IMAGE = 0xf0225
const C_HEADER = 0xf0af5

const BY_NAME: Record<string, number> = {
  'readme.md': DOC, 'agents.md': DOC, 'claude.md': DOC, 'changelog.md': DOC, 'contributing.md': DOC, 'todo.md': DOC,
  license: 0xe60a, dockerfile: 0xf0868, makefile: 0xf1064, 'cmakelists.txt': 0xf1064, justfile: 0xf05b7,
  gemfile: 0xf0d2d, rakefile: 0xf0d2d, 'cargo.toml': TOML, 'cargo.lock': TOML, 'pyproject.toml': TOML,
  'requirements.txt': 0xf160e, 'go.mod': 0xf0afa, 'go.sum': 0xf07d3,
  'package.json': NODE, 'package-lock.json': NODE, 'tsconfig.json': NODE, '.prettierrc': NODE, '.eslintrc': NODE,
  'pnpm-lock.yaml': YAML, 'yarn.lock': YAML, '.gitignore': 0xf02a2, '.gitmodules': 0xf0493, '.editorconfig': 0xe652,
}

const BY_EXT: Record<string, number> = {
  ts: 0xe628, tsx: 0xe7ba, js: 0xe60c, mjs: 0xe60c, cjs: 0xe60c, jsx: 0xe625, json: 0xe60b, jsonc: 0xe60b,
  py: 0xe606, pyi: 0xe606, go: 0xe627, rs: 0xe68b, rb: 0xe791, php: 0xe608, java: 0xe738, cs: 0xf031b, lua: 0xe620,
  c: 0xe61e, cpp: 0xe61d, cc: 0xe61d, cxx: 0xe61d, h: C_HEADER, hpp: C_HEADER, vue: 0xe6a0, svelte: 0xe697, qml: 0xf375,
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL, md: DOC, markdown: DOC, mdx: DOC, txt: 0xf09aa, csv: 0xe64a,
  yaml: YAML, yml: YAML, toml: TOML, ini: 0xf0bc2, conf: 0xf0493, xml: 0xf05c0, sql: 0xe706, graphql: 0xf20e, gql: 0xf20e,
  tf: 0xf1062, hcl: 0xf1062, css: 0xe6b8, scss: 0xf031c, html: 0xe736, htm: 0xe736,
  svg: 0xf0721, png: 0xe60d, jpg: IMAGE, jpeg: IMAGE, gif: 0xf0d78, webp: 0xf021f, pdf: 0xeaeb,
  mp4: VIDEO, mkv: VIDEO, mov: VIDEO, mp3: AUDIO, wav: AUDIO, flac: AUDIO,
  zip: ARCHIVE, gz: ARCHIVE, xz: ARCHIVE, tar: ARCHIVE,
}

const FILE = 0xf0214
const LINK = 0xf481
const FOLDER_OPEN = 0xe5fe
const FOLDER = 0xe5ff
const REPO = 0xf02a2

/** The icon in front of a row's name. */
export function iconOf(n: FileNode, isOpen: boolean, isRepo: boolean, plain: boolean): string {
  if (plain) return n.kind === 'dir' ? '■' : '·'
  if (n.kind === 'link') return cp(LINK)
  if (n.kind === 'dir') return cp(isRepo ? REPO : isOpen ? FOLDER_OPEN : FOLDER)
  const name = n.name.toLowerCase()
  const dot = name.lastIndexOf('.')
  return cp(BY_NAME[name] ?? BY_EXT[dot >= 0 ? name.slice(dot + 1) : ''] ?? FILE)
}
