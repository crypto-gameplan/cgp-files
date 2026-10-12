import { expect, test } from 'claude-code/testing'

import type { FileTree } from '../types'
import { clip, formatSize } from '../hooks/core/format'
import { parseNumstat, parseStatus, rollUpCounts, rollUpLines, stronger } from '../hooks/core/git'
import { addGlow } from '../hooks/core/glow'
import { emptyTree, forgetBelow, mergeListings, missingFolders, toNodes, visibleRows, type Entry } from '../hooks/core/nodes'
import { customOpener, defaultOpener, words } from '../hooks/core/open'
import { ancestors, dirname, posix, resolve, underAny, useWindowsPaths } from '../hooks/core/paths'
import { previewOf, previewWindow } from '../hooks/core/preview'
import { endedTasks, mentions } from '../hooks/core/prompt'
import { readSettings } from '../hooks/core/settings'
import { chainOf, gitActions, onlyReads, readPaths } from '../hooks/core/shell'
import { windowOf } from '../hooks/core/viewport'
import { rampOf } from '../hooks/ui/palette'

const file = (name: string): Entry => ({ name, kind: 'file', mtimeMs: 1, size: 1, isLink: false })
const dir = (name: string): Entry => ({ name, kind: 'dir', mtimeMs: 1, size: 0, isLink: false })

function treeOf(root: string, listing: Record<string, Entry[]>, extra: Partial<FileTree> = {}): FileTree {
  const listed = new Map(Object.entries(listing).map(([d, kids]) => [d, toNodes(d, kids)]))
  return { ...emptyTree(root), nodes: mergeListings([], listed), ...extra }
}

test('paths: shell-style resolve with .., ~ and absolute paths', () => {
  expect(resolve('/w/p', '../q/./r', '/home/k')).toBe('/w/q/r')
  expect(resolve('/w/p', '~/x', '/home/k')).toBe('/home/k/x')
  expect(resolve('/w/p', '/abs/')).toBe('/abs')
  expect(resolve('/w', '../../..')).toBe('/')
  expect(dirname('/a/b/c')).toBe('/a/b')
  expect(ancestors('/r/a/b/c.ts', '/r')).toEqual(['/r/a/b', '/r/a'])
  expect(ancestors('/other/a.ts', '/r')).toEqual([])
  expect(underAny('/r/node_modules/x/y.js', new Set(['/r/node_modules']), '/r')).toBe(true)
})

test('paths: Windows drives and git-style /c/ paths become C:/', () => {
  useWindowsPaths(true)
  try {
    expect(posix('C:\\Users\\k\\proj')).toBe('C:/Users/k/proj')
    expect(posix('/c/Users/k')).toBe('C:/Users/k')
    expect(dirname('C:/x')).toBe('C:/')
    expect(resolve('C:/Users/k', '..\\..')).toBe('C:/')
  } finally {
    useWindowsPaths(false)
  }
})

test('nodes: folders first in natural order, vanished folders take their children along', () => {
  const nodes = toNodes('/r', [file('file10.ts'), file('file2.ts'), dir('src'), file('.env')])
  expect(nodes.map(n => n.name)).toEqual(['src', '.env', 'file2.ts', 'file10.ts'])
  const t = treeOf('/r', { '/r': [dir('src'), dir('old'), file('a.ts')], '/r/src': [file('b.ts')], '/r/old': [file('c.ts')] })
  expect(t.nodes.find(n => n.id === '/r/src')?.isLoaded).toBe(true)
  const after = mergeListings(t.nodes, new Map([['/r', toNodes('/r', [dir('src'), file('a.ts')])]]))
  expect(after.map(n => n.id).sort()).toEqual(['/r/a.ts', '/r/src', '/r/src/b.ts'])
  expect(after.find(n => n.id === '/r/src')?.isLoaded).toBe(true)
  const collapsed = forgetBelow(after, ['/r/src'])
  expect(collapsed.map(n => n.id).sort()).toEqual(['/r/a.ts', '/r/src'])
  expect(collapsed.find(n => n.id === '/r/src')?.isLoaded).toBe(false)
})

test('nodes: rows follow the open folders, a search shows every listed match with its folders', () => {
  const t = treeOf('/r', { '/r': [dir('src'), file('README.md'), file('.env')], '/r/src': [file('app.ts'), file('util.ts')] })
  expect(visibleRows(t).map(r => r.node.name)).toEqual(['src', '.env', 'README.md'])
  expect(visibleRows({ ...t, expanded: ['/r/src'] }).map(r => `${r.depth}:${r.node.name}`)).toEqual(['0:src', '1:app.ts', '1:util.ts', '0:.env', '0:README.md'])
  expect(visibleRows({ ...t, showHidden: false }).map(r => r.node.name)).toEqual(['src', 'README.md'])
  expect(visibleRows({ ...t, query: 'UTIL' }).map(r => r.node.name)).toEqual(['src', 'util.ts'])
  expect(missingFolders(treeOf('/r', { '/r': [dir('a')] }), ['/r/a/b/c.ts'], new Set())).toEqual(['/r/a'])
})

test('git: status letters roll up, renames skip the old path, untracked folders and ignored paths are kept apart', () => {
  const out = parseStatus('## main...origin/main [ahead 2, behind 1]\0 M src/a.ts\0R  new.ts\0old.ts\0?? tmp/\0!! dist/\0D  gone.ts\0', '/r', '')
  expect(out.branch).toEqual({ head: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
  expect(out.status['/r/src/a.ts']).toBe('M')
  expect(out.status['/r/src']).toBe('M')
  expect(out.status['/r/new.ts']).toBe('R')
  expect(out.status['/r/old.ts']).toBeUndefined()
  expect(out.status['/r']).toBe('D')
  expect(out.untracked).toEqual(['/r/tmp'])
  expect(out.ignored).toEqual(['/r/dist'])
  expect(out.files).toEqual({ '/r/src/a.ts': 'mod', '/r/new.ts': 'mod', '/r/gone.ts': 'del' })
  expect(stronger('?', 'M')).toBe('M')
  expect(stronger('U', 'M')).toBe('U')
  expect(parseStatus('## HEAD (no branch)\0', '/r', '').branch?.head).toBe('detached')
})

test('git: a root below the repository top sees only its own paths', () => {
  const out = parseStatus('## main\0 M app/a.ts\0 M other/b.ts\0', '/r/app', 'app/')
  expect(Object.keys(out.files)).toEqual(['/r/app/a.ts'])
})

test('git: numstat counts lines, renames and binary files included, and rolls them up', () => {
  const lines: Record<string, [number, number]> = {}
  parseNumstat(['3\t1\tsrc/a.ts', '-\t-\tlogo.png', '2\t0\t', 'old.ts', 'new.ts', ''].join('\0'), '/r', '', lines)
  expect(lines['/r/src/a.ts']).toEqual([3, 1])
  expect(lines['/r/logo.png']).toEqual([0, 0])
  expect(lines['/r/new.ts']).toEqual([2, 0])
  expect(rollUpLines(lines, '/r')['/r']).toEqual([5, 1])
  expect(rollUpCounts({ '/r/src/a.ts': 'mod', '/r/src/b.ts': 'new', '/r/c.ts': 'del' }, '/r')['/r']).toEqual([1, 1, 1])
})

test('shell: git and GitHub actions that change something, in order', () => {
  expect(gitActions('git add -A && git commit -m "x; y" && git push').map(a => a.kind)).toEqual(['git add', 'git commit', 'git push'])
  expect(gitActions('git -C sub status && git log').length).toBe(0)
  expect(gitActions('git checkout -- a.ts')[0]?.done).toBe('restored')
  expect(gitActions('git checkout main')[0]?.done).toBe('checked out')
  expect(gitActions('GIT_EDITOR=true git rebase main')[0]?.tone).toBe('merge')
  expect(gitActions('gh pr create --fill')[0]?.running).toBe('opening PR')
  expect(gitActions('git branch -a').length).toBe(0)
  expect(gitActions('git branch feature').length).toBe(1)
  expect(gitActions('git clone x')[0]?.isInit).toBe(true)
  expect(gitActions('echo "git push"').length).toBe(0)
})

test('shell: only known readers without redirects count as read-only', () => {
  expect(onlyReads('rg foo src | head -5')).toBe(true)
  expect(onlyReads('cat a.ts 2>/dev/null')).toBe(true)
  expect(onlyReads('cd sub && ls')).toBe(true)
  expect(onlyReads('echo x > a.ts')).toBe(false)
  expect(onlyReads('echo x >> a.ts')).toBe(false)
  expect(onlyReads("sed -i 's/a/b/' a.ts")).toBe(false)
  expect(onlyReads('find . -name "*.tmp" -delete')).toBe(false)
  expect(onlyReads('npm test')).toBe(false)
  expect(onlyReads('git status')).toBe(true)
  expect(onlyReads('git stash')).toBe(false)
})

test('shell: read paths skip patterns and globs, follow cd, and come from search output', () => {
  expect(readPaths('rg -n "TODO" src/app.ts', '/r', '')).toEqual(['/r/src/app.ts'])
  expect(readPaths('cd src && cat a.ts b.ts', '/r', '')).toEqual(['/r/src/a.ts', '/r/src/b.ts'])
  expect(readPaths('cat *.ts', '/r', '')).toEqual([])
  expect(readPaths('grep -rn foo .', '/r', 'src/a.ts:3:foo\nsrc/b.ts:9:foo\n')).toEqual(['/r', '/r/src/a.ts', '/r/src/b.ts'])
  expect(readPaths('head -n 5 ~/notes.md', '/r', '', '/home/k')).toEqual(['/home/k/notes.md'])
  expect(readPaths('grep -n foo a.ts', '/r', '')).toEqual(['/r/a.ts'])
  expect(readPaths('npm test', '/r', 'src/a.ts:1:x')).toEqual([])
})

test('shell: chains say when one exit code speaks for every command', () => {
  expect(chainOf('git add . && git commit -m x')).toEqual({ size: 2, isAndOnly: true })
  expect(chainOf('git push; echo done').isAndOnly).toBe(false)
  expect(chainOf('git commit -m "a && b"').size).toBe(1)
  expect(chainOf('git push 2>&1 | tail').isAndOnly).toBe(false)
})

test('open: words keep quotes whole, placeholders fill in, the path goes last without {path}', () => {
  expect(words(`open -a "Sublime Text" 'x y'`)).toEqual(['open', '-a', 'Sublime Text', 'x y'])
  expect(customOpener('', '/a/b.md', '/a')).toBe(null)
  expect(customOpener('zed', '/w/A & B/b.md', '/w/A & B')).toEqual(['zed', '/w/A & B/b.md'])
  expect(customOpener('code -g {path}:1', '/a/b.md', '/a')).toEqual(['code', '-g', '/a/b.md:1'])
  expect(customOpener('tool --cwd {dir}', '/a/{dir}.md', '/a')).toEqual(['tool', '--cwd', '/a', '/a/{dir}.md'])
})

test('open: the target never enters a shell string', () => {
  const target = '/work/A & B/$(rm -rf).ts'
  expect(defaultOpener('darwin', target).argv).toEqual(['open', '--', target])
  expect(defaultOpener('linux', target).argv.at(-1)).toBe(target)
  const win = defaultOpener('win32', 'C:/Models/A & %NAME%/dax.ts')
  expect(win.init.env?.CGP_FILES_TARGET).toBe('C:\\Models\\A & %NAME%\\dax.ts')
  expect(win.argv.join(' ')).not.toContain('%NAME%')
  expect(defaultOpener('win32', 'https://example.test/a%20b').init.env?.CGP_FILES_TARGET).toBe('https://example.test/a%20b')
})

test('preview: control characters go, long files are cut with a note, a window inside a fence reopens it', () => {
  const p = previewOf('/r/a.ts', 'a\r\nb\u0007c\n')
  expect(p.text).toBe('a\nbc\n')
  expect(p.note).toBe('')
  const big = previewOf('/r/big.txt', `${'x'.repeat(100)}\n`.repeat(2_000))
  expect(big.note).toContain('first')
  expect(big.text.length).toBeLessThan(100_000)
  const md = '# T\n```ts\nconst a = 1\nconst b = 2\n```\nafter'
  expect(previewWindow(md, 3, 2, true).text).toBe('```ts\nconst b = 2\n```')
  expect(previewWindow(md, 5, 2, true).text).toBe('after')
  expect(previewWindow(md, 99, 2, false).top).toBe(5)
})

test('prompt: mentions inside the tree and ended background tasks', () => {
  expect(mentions('look at @src/a.ts, and @../x and @README.md.', '/r', '')).toEqual(['/r/src/a.ts', '/r/README.md'])
  expect(endedTasks('<task-notification><task-id>b1</task-id><status>completed</status></task-notification>')).toEqual([['b1', 'completed']])
})

test('glow: a file in collapsed folders opens them, and those glow dimmer', () => {
  const t = treeOf('/r', { '/r': [dir('a')] })
  const g = addGlow(t, { '/r/a/b/c.ts': 'write' })
  expect(g.expanded.sort()).toEqual(['/r/a', '/r/a/b'])
  expect(g.glow.bright).toEqual(['/r/a/b/c.ts'])
  expect(g.glow.dim.sort()).toEqual(['/r/a', '/r/a/b'])
  const again = addGlow({ ...t, glow: g.glow, expanded: g.expanded }, { '/r/a': 'read' })
  expect(again.glow.dim).toEqual(['/r/a/b'])
  expect(again.glow.tones['/r/a']).toBe('read')
})

test('viewport: centres on the focus, pins glowing rows above, and a scroll wins', () => {
  const names = Array.from({ length: 50 }, (_, i) => file(`f${String(i).padStart(2, '0')}.ts`))
  const rows = visibleRows(treeOf('/r', { '/r': names }))
  const id = (i: number) => `/r/f${String(i).padStart(2, '0')}.ts`
  const centred = windowOf({ rows, room: 10, focus: id(30), isLit: () => false, follow: true, scroll: null })
  expect(centred.from).toBe(25)
  expect(centred.shown.length).toBe(10)
  const pinned = windowOf({ rows, room: 10, focus: id(40), isLit: x => x === id(2), follow: true, scroll: null })
  expect(pinned.pinned.map(r => r.node.id)).toEqual([id(2)])
  expect(pinned.shown.map(r => r.node.id)).toContain(id(40))
  const scrolled = windowOf({ rows, room: 10, focus: id(40), isLit: x => x === id(2), follow: true, scroll: 999 })
  expect(scrolled.from).toBe(40)
  expect(scrolled.pinned).toEqual([])
})

test('format and settings', () => {
  expect(formatSize(-1)).toBe('?')
  expect(formatSize(512)).toBe('512 B')
  expect(formatSize(1536)).toBe('1.5 K')
  expect(formatSize(150 * 1024 * 1024)).toBe('150 M')
  expect(clip('abcdefgh', 5)).toBe('abcd…')
  const s = readSettings({ activity: 'writes', follow: 'off', column: 'size', open: ' preview ', glyphs: 'odd' })
  expect(s).toMatchObject({ showReads: false, showWrites: true, followClaude: false, sizeColumn: true, openWith: 'preview', glyphs: 'auto' })
  expect(readSettings(undefined)).toMatchObject({ showReads: true, showWrites: true, openAtStart: true })
  const ramp = rampOf('#ffab19')
  expect(ramp.bright[0]).toBe('#ffab19')
  expect(ramp.bright).toHaveLength(4)
  expect(ramp.dim).toHaveLength(4)
})
