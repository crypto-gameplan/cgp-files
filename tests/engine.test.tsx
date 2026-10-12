import { expect, mock, test } from 'claude-code/testing'

// A small fake machine: folders, a git repository, and a record of every process the mod starts.
type World = {
  os: 'darwin' | 'linux' | 'win32'
  env: Record<string, string>
  cwd: string
  /** The repository top, '' outside one. */
  top: string
  dirs: Record<string, [string, 'file' | 'dir'][]>
  status: string
  numstat: string
  heads?: string[]
  files?: Record<string, string>
  find?: string
  du?: Record<string, string>
  failList?: boolean
}

type Log = { ran: string[][]; opened: Record<string, unknown>[]; closed: unknown[]; toasts: string[] }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function machine(on: any, w: World) {
  const log: Log = { ran: [], opened: [], closed: [], toasts: [] }
  mock.env(on, w.env)
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_$: unknown, e: Record<string, unknown>) => {
    log.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: unknown, e: unknown) => {
    log.closed.push(e)
    return { value: undefined }
  })
  on('ui.toast', (_$: unknown, e: { text?: string }) => {
    log.toasts.push(String(e.text))
    return { value: undefined }
  })
  const kids = (p: string) => w.dirs[p]
  on('fs.list', (_$: unknown, e: { path: string }) => {
    if (w.failList) throw new Error('EIO')
    const list = kids(e.path)
    if (!list) throw new Error(`ENOENT ${e.path}`)
    return { value: list.map(([name, kind]) => ({ name, kind, size: 10, mtimeMs: 1_700_000_000_000, isLink: false })) }
  })
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const parent = e.path.slice(0, e.path.lastIndexOf('/')) || '/'
    const name = e.path.slice(e.path.lastIndexOf('/') + 1)
    const kind = kids(e.path) ? 'dir' : kids(parent)?.find(([n]) => n === name)?.[1]
    if (!kind) throw new Error(`ENOENT ${e.path}`)
    const size = w.files?.[e.path]?.length ?? 10
    return { value: { kind, size, mtimeMs: 1_700_000_000_000, isLink: false } }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = w.files?.[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const argv = [...e.argv]
    log.ran.push(argv)
    if (argv[0] === 'uname') return ok(w.os === 'darwin' ? 'Darwin\n' : 'Linux\n')
    if (argv[0] === 'find') return ok(w.find ?? '')
    if (argv[0] === 'du') return ok(w.du?.[argv.at(-1) ?? ''] ?? '')
    if (argv[0] === 'git') {
      const verb = argv.slice(4).find(a => !a.startsWith('-'))
      if (verb === 'rev-parse' && argv.at(-1) === 'HEAD') return ok(`${(w.heads && w.heads.length > 1 ? w.heads.shift() : w.heads?.[0]) ?? ''}\n`)
      if (verb === 'rev-parse') return w.top ? ok(`\n${w.top}\n`) : { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
      if (verb === 'status') return ok(w.status)
      if (verb === 'diff') return ok(w.numstat)
      if (verb === 'ls-files') {
        const out: string[] = []
        for (const [d, list] of Object.entries(w.dirs)) for (const [n, k] of list) if (k === 'file' && d.startsWith(w.top)) out.push(`${d}/${n}`.slice(w.top.length + 1))
        return ok(out.join('\0'))
      }
      return ok('')
    }
    return ok('')
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: string[] }) => ({ text: e.text, context: e.context }))
  return { clock, log }
}

const paneProps = (bodyColumns = 60, placement = 'dock') =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ title: 'Files', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows: 40 }, view: {} }) as any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shown(ui: any): Promise<string> {
  return JSON.stringify(await ui.drawn()) + JSON.stringify(await ui.drawn({ in: 'rows' }))
}

const ROOT = '/Users/k/proj'
const repo = (extra: Partial<World> = {}): World => ({
  os: 'darwin',
  env: { HOME: '/Users/k', TMPDIR: '/var/folders/x/T/' },
  cwd: ROOT,
  top: ROOT,
  dirs: { [ROOT]: [['src', 'dir'], ['README.md', 'file'], ['notes.md', 'file']], [`${ROOT}/src`]: [['a.ts', 'file']] },
  status: '## main...origin/main\0 M src/a.ts\0?? notes.md\0',
  numstat: '3\t1\tsrc/a.ts\0',
  ...extra,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = ($: any, surface: 'desktop' | 'terminal', placement = 'dock') =>
  $.ui.mount({ plugin: 'cgp-files', surface, component: 'Pane', requestId: 'cgp-files', props: paneProps(60, placement) })

test('desktop: the pane shows the tree with git status, a press selects, a second press opens with open', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, log } = machine(on, repo())
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(log.opened.at(-1)).toMatchObject({ id: 'cgp-files', title: 'Files: proj' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'desktop')
  await clock.settle()
  const view = await shown(ui)
  for (const word of ['README.md', 'notes.md', 'src', 'main', 'origin/main', ' M:1', ' ?:1']) expect(view).toContain(word)
  // The desktop draws plain glyphs: no Nerd Font private-use characters.
  expect(/[\u{e000}-\u{f8ff}\u{f0000}-\u{fffff}]/u.test(view)).toBe(false)
  await ui.post({ press: `${ROOT}/README.md` }, { in: 'rows' })
  await clock.settle()
  expect(await shown(ui)).toContain('selected: README.md')
  const sent = await $.prompt.submit({ text: 'what is this?', wait: false } as never)
  expect(JSON.stringify(sent)).toContain('selected in the cgp-files tree')
  await ui.post({ press: `${ROOT}/README.md` }, { in: 'rows' })
  await clock.settle()
  expect(log.ran).toContainEqual(['open', '--', `${ROOT}/README.md`])
  await ui.unmount()
})

test('an Edit glows the file in CGP gold, opens its folder and refreshes git', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, log } = machine(on, repo())
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal')
  await clock.settle()
  const statusBefore = log.ran.filter(a => a.includes('status')).length
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' } as never)
  await clock.settle()
  const view = await shown(ui)
  expect(view).toContain('"t":"a.ts","glow":"write"')
  expect(view).toContain('+3')
  expect(log.ran.filter(a => a.includes('status')).length).toBeGreaterThan(statusBefore)
  await clock.advance(3_000)
  await clock.settle()
  expect(await shown(ui)).not.toContain('"glow"')
  await ui.unmount()
})

test('a Bash write is found with find -newer against a marker, which is removed afterwards', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, log } = machine(on, repo({ find: `${ROOT}/notes.md\0` }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal')
  await $.tool.call({ tool: 'Bash', command: 'echo hi >> notes.md' } as never)
  await clock.settle()
  const marker = log.ran.find(a => a[0] === 'touch')?.[1] ?? ''
  expect(marker.startsWith('/var/folders/x/T/cgp-files-test-session-')).toBe(true)
  const find = log.ran.find(a => a[0] === 'find')
  expect(find).toContain('-newer')
  expect(find).toContain(marker)
  expect(log.ran).toContainEqual(['rm', '-f', marker])
  expect(await shown(ui)).toContain('"t":"notes.md","glow":"write"')
  // A read-only command makes no marker and runs no find.
  const before = log.ran.length
  await $.tool.call({ tool: 'Bash', command: 'rg TODO src' } as never)
  await clock.settle()
  expect(log.ran.slice(before).some(a => a[0] === 'touch' || a[0] === 'find')).toBe(false)
  await ui.unmount()
})

test('git actions are claimed only on evidence: a new HEAD for a commit, a plain && chain for others', { timeoutMs: 20_000 }, async ($, on) => {
  const w = repo({ heads: ['abc1234def0'] })
  const { clock } = machine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m test || true' } as never)
  await clock.settle()
  expect(await shown(ui)).toContain('commit failed')
  w.heads = ['abc1234def0', 'fed4321cba9']
  await $.tool.call({ tool: 'Bash', command: 'git commit -m real' } as never)
  await clock.settle()
  let view = await shown(ui)
  expect(view).toContain('committed')
  expect(view).toContain('fed4321')
  await $.tool.call({ tool: 'Bash', command: 'git push; echo done' } as never)
  await clock.settle()
  expect(await shown(ui)).toContain('ran git push')
  await $.tool.call({ tool: 'Bash', command: 'git fetch && git status' } as never)
  await clock.settle()
  view = await shown(ui)
  expect(view).toContain('fetched')
  await ui.unmount()
})

test('outside a repository only git rev-parse runs', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/scratch'
  const { clock, log } = machine(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['a.txt', 'file']] }, status: '', numstat: '' })
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal')
  await clock.settle()
  expect(await shown(ui)).toContain('no git repo')
  await $.tool.call({ tool: 'Bash', command: 'echo x > a.txt' } as never)
  await clock.settle()
  const gits = log.ran.filter(a => a[0] === 'git').map(a => a[4])
  expect(new Set(gits)).toEqual(new Set(['rev-parse']))
  await ui.unmount()
})

test('search finds files in folders never opened, Enter jumps there and clears the box', { timeoutMs: 20_000 }, async ($, on) => {
  const w = repo()
  w.dirs[`${ROOT}/src`] = [['deep', 'dir']]
  w.dirs[`${ROOT}/src/deep`] = [['target.ts', 'file']]
  const { clock } = machine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'desktop')
  await clock.settle()
  expect(await shown(ui)).not.toContain('target.ts')
  await ui.input({ key: 'q', text: 'target' })
  await clock.settle()
  expect(await shown(ui)).toContain('target.ts')
  await ui.press({ key: 'hidden' })
  await ui.press({ key: 'collapse' })
  await clock.settle()
  expect(await shown(ui)).not.toContain(`"id":"${ROOT}/src/deep"`)
  await ui.unmount()
})

test('Open with preview: a double press shows the file, left goes back, a binary file shows a note', { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
  const w = repo({ files: { [`${ROOT}/README.md`]: '# Title\n\nHello', [`${ROOT}/notes.md`]: 'a\0b' } })
  const { clock, log } = machine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal')
  await clock.settle()
  await ui.post({ press: `${ROOT}/README.md` }, { in: 'rows' })
  await ui.post({ press: `${ROOT}/README.md` }, { in: 'rows' })
  await clock.settle()
  expect(await shown(ui)).toContain('Hello')
  expect(log.ran.some(a => a[0] === 'open')).toBe(false)
  await ui.post({ key: 'left' }, { in: 'rows' })
  await clock.settle()
  expect(await shown(ui)).toContain('notes.md')
  await ui.post({ press: `${ROOT}/notes.md` }, { in: 'rows' })
  await ui.post({ press: `${ROOT}/notes.md` }, { in: 'rows' })
  await clock.settle()
  expect(await shown(ui)).toContain('binary file')
  await ui.press({ key: 'external' })
  await clock.settle()
  expect(log.ran).toContainEqual(['open', '--', `${ROOT}/notes.md`])
  await ui.unmount()
})

test('the size column sizes folders with du', { timeoutMs: 20_000, options: { column: 'size' } }, async ($, on) => {
  const { clock, log } = machine(on, repo({ du: { [`${ROOT}/src`]: '2048\t/x\n' } }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal')
  await clock.settle()
  await clock.settle()
  expect(log.ran).toContainEqual(['du', '-skxH', `${ROOT}/src`])
  expect(await shown(ui)).toContain('2.0 M')
  await ui.unmount()
})

test('/cgp-files checks the terminal layout, and an inline pane closes itself', { timeoutMs: 20_000, options: { start: 'off' } }, async ($, on) => {
  const { clock, log } = machine(on, repo())
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(log.opened.length).toBe(0)
  const narrow = await $.command.run({ command: 'cgp-files', args: '', origin: { kind: 'person' }, presentation: { isFullscreen: true, columns: 90 } } as never)
  expect(JSON.stringify(narrow)).toContain('110 columns')
  const flat = await $.command.run({ command: 'cgp-files', args: '', origin: { kind: 'person' }, presentation: { isFullscreen: false, columns: 200 } } as never)
  expect(JSON.stringify(flat)).toContain('/tui fullscreen')
  const okRun = await $.command.run({ command: 'cgp-files', args: 'src', origin: { kind: 'person' }, presentation: { isFullscreen: true, columns: 200 } } as never)
  await clock.settle()
  expect(JSON.stringify(okRun)).toContain(`File tree on ~/proj/src.`)
  expect(log.opened.at(-1)).toMatchObject({ id: 'cgp-files', focus: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = await mount($, 'terminal', 'inline')
  await clock.settle()
  expect(log.closed.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('a broken file system never blocks a tool call or a prompt', { timeoutMs: 20_000 }, async ($, on) => {
  const w = repo()
  const { clock } = machine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  w.failList = true
  const result = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' } as never)
  expect(JSON.stringify(result)).not.toContain('deny')
  const bash = await $.tool.call({ tool: 'Bash', command: 'echo x > y' } as never)
  expect(JSON.stringify(bash)).not.toContain('deny')
  const sent = await $.prompt.submit({ text: 'hi', wait: false } as never)
  expect(JSON.stringify(sent)).toContain('hi')
  await clock.settle()
})
