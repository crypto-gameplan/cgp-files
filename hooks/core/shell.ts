// What a Bash command does to the tree: which git or GitHub actions it runs, whether it can write at all, and which
// paths it reads. This is a reading of the command line, not a shell: it errs towards "may write".

import type { Tone } from '../../types'
import { posix, resolve, windowsPaths } from './paths'

export type GitAction = {
  /** `git commit`, `gh pr create`. */
  kind: string
  verb: string
  running: string
  done: string
  tone: Tone
  icon: IconName
  /** Creates a repository, so the tree checks for one afterwards. */
  isInit?: boolean
}

export type IconName = 'commit' | 'push' | 'pull' | 'branch' | 'merge' | 'pr' | 'github' | 'stash' | 'undo' | 'tag' | 'git'

type Spec = Omit<GitAction, 'kind' | 'verb'>

const spec = (running: string, done: string, tone: Tone, icon: IconName, isInit = false): Spec =>
  isInit ? { running, done, tone, icon, isInit } : { running, done, tone, icon }

const GIT: Record<string, Spec> = {
  commit: spec('committing', 'committed', 'commit', 'commit'),
  push: spec('pushing', 'pushed', 'sync', 'push'),
  pull: spec('pulling', 'pulled', 'sync', 'pull'),
  fetch: spec('fetching', 'fetched', 'sync', 'pull'),
  checkout: spec('checking out', 'checked out', 'sync', 'branch'),
  switch: spec('switching', 'switched', 'sync', 'branch'),
  branch: spec('branching', 'branched', 'sync', 'branch'),
  merge: spec('merging', 'merged', 'merge', 'merge'),
  rebase: spec('rebasing', 'rebased', 'merge', 'merge'),
  'cherry-pick': spec('cherry-picking', 'cherry-picked', 'merge', 'merge'),
  stash: spec('stashing', 'stashed', 'write', 'stash'),
  reset: spec('resetting', 'reset', 'undo', 'undo'),
  restore: spec('restoring', 'restored', 'undo', 'undo'),
  revert: spec('reverting', 'reverted', 'undo', 'undo'),
  add: spec('staging', 'staged', 'commit', 'git'),
  rm: spec('removing', 'removed', 'undo', 'git'),
  mv: spec('moving', 'moved', 'write', 'git'),
  tag: spec('tagging', 'tagged', 'merge', 'tag'),
  init: spec('initialising', 'initialised', 'commit', 'git', true),
  clone: spec('cloning', 'cloned', 'sync', 'pull', true),
}

const GH: Record<string, Spec> = {
  'pr create': spec('opening PR', 'opened PR', 'merge', 'pr'),
  'pr merge': spec('merging PR', 'merged PR', 'merge', 'merge'),
  'pr checkout': spec('checking out PR', 'checked out PR', 'sync', 'pr'),
  'pr comment': spec('commenting on PR', 'commented on PR', 'merge', 'pr'),
  'pr review': spec('reviewing PR', 'reviewed PR', 'merge', 'pr'),
  'repo clone': spec('cloning', 'cloned', 'sync', 'github', true),
  'release create': spec('releasing', 'released', 'merge', 'tag'),
  'issue create': spec('opening issue', 'opened issue', 'merge', 'github'),
}

const GIT_READERS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'grep', 'describe', 'config', 'remote', 'reflog',
  'shortlog', 'help', 'version', 'check-ignore',
])

/** Commands that only read files. */
const READERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'fdfind', 'cat', 'head', 'tail', 'bat', 'less', 'more', 'ls', 'eza', 'tree', 'wc', 'sed', 'awk', 'jq'])
/** Readers whose first plain argument is a pattern, not a path. */
const PATTERN_FIRST = new Set(['rg', 'grep', 'egrep', 'fgrep', 'sed', 'awk', 'jq'])
/** Readers that print the paths they matched, so their output names what was read. */
const PRINTS_PATHS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'fdfind'])
const HARMLESS = new Set(['cd', 'echo', 'printf', 'true', 'pwd'])
const FIND_WRITES = /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls|x|X|-exec|-exec-batch)$/
/** Reader flags whose next argument is a value, not a path. */
const TAKES_VALUE = /^-(e|f|g|t|T|m|A|B|C|-glob|-type|-max-count|name|iname|maxdepth|mindepth)$/
/** head and tail count with `-n 5` / `-c 100`, where grep's `-n` takes nothing. */
const COUNTS = new Set(['head', 'tail'])

function takesValue(name: string, flag: string): boolean {
  return TAKES_VALUE.test(flag) || (COUNTS.has(name) && (flag === '-n' || flag === '-c'))
}

export type Parsed = {
  /** The simple commands, each as its words. */
  commands: string[][]
  /** The operators between them: `;`, `&&`, `||`, `|`, `&`. */
  joins: string[]
}

/**
 * Splits a command line into simple commands and their words: quotes and backslashes are honoured, `#` starts a
 * comment, and `&>` / `>&` stay part of a word. An unclosed quote falls back to a plain split on operators.
 */
export function parse(command: string): Parsed {
  const commands: string[][] = []
  const joins: string[] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote = ''
  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endCommand = (op: string) => {
    endWord()
    if (words.length) commands.push(words)
    words = []
    if (op) joins.push(op)
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    const next = command[i + 1] ?? ''
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasWord = true
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i]
      hasWord = true
    } else if (ch === '#' && !hasWord) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (ch === ' ' || ch === '\t') endWord()
    else if (ch === '\n' || ch === ';') endCommand(';')
    else if (ch === '&' && (command[i - 1] === '>' || next === '>')) {
      word += ch
      hasWord = true
    } else if (ch === '&' || ch === '|') {
      const doubled = next === ch
      if (doubled) i++
      endCommand(doubled ? ch + ch : ch)
    } else {
      word += ch
      hasWord = true
    }
  }
  endCommand('')
  if (!quote) return { commands, joins }
  return {
    commands: command
      .split(/&&|\|\||;|\||\n/)
      .map(s => s.trim().split(/\s+/).filter(Boolean))
      .filter(s => s.length > 0),
    joins: [';'],
  }
}

/** Drops a leading `env` and `NAME=value` assignments. */
function program(words: string[]): string[] {
  const out = [...words]
  if (out[0] === 'env') out.shift()
  while (out.length && /^[A-Z_][A-Z0-9_]*=/.test(out[0] ?? '')) out.shift()
  return out
}

const commandName = (words: string[]): string => words[0]?.split('/').pop() ?? ''

/** The index of git's subcommand, past global options such as `-C dir`. */
function gitVerbAt(words: string[]): number {
  let i = 1
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    if (words[i] === '-C' || words[i] === '-c') i++
    i++
  }
  return i
}

function gitOnlyReads(verb: string, rest: string[]): boolean {
  if (!verb || GIT_READERS.has(verb)) return true
  if (verb === 'stash') return rest[0] === 'list' || rest[0] === 'show'
  if (verb === 'branch') return rest.every(t => t.startsWith('-'))
  if (verb === 'tag') return rest.length === 0 || rest.some(t => /^(-l|--list|-n\d*|--contains|--points-at|--merged|--no-merged|-v|--verify)$/.test(t))
  return false
}

/** How many commands the line chains, and whether only `&&` joins them, so one exit code speaks for all. */
export function chainOf(command: string): { size: number; isAndOnly: boolean } {
  const { commands, joins } = parse(command)
  return { size: commands.length, isAndOnly: joins.every(j => j === '&&') }
}

/** The git and GitHub actions that change something, in the order the command runs them. */
export function gitActions(command: string): GitAction[] {
  const out: GitAction[] = []
  for (const raw of parse(command).commands) {
    const words = program(raw)
    const name = commandName(words)
    if (name === 'git') {
      const at = gitVerbAt(words)
      const verb = words[at] ?? ''
      const rest = words.slice(at + 1)
      if (gitOnlyReads(verb, rest)) continue
      // `git checkout -- file` throws away changes; that is a restore, not a branch switch.
      const found = verb === 'checkout' && rest.includes('--') ? GIT.restore : GIT[verb]
      if (found) out.push({ kind: `git ${verb}`, verb, ...found })
    } else if (name === 'gh') {
      const pair = `${words[1] ?? ''} ${words[2] ?? ''}`
      const found = GH[pair]
      if (found) out.push({ kind: `gh ${pair}`, verb: pair, ...found })
    }
  }
  return out
}

/** True when nothing in the command can write a file: no redirect, and only known readers. */
export function onlyReads(command: string): boolean {
  const bare = ` ${command}`.replace(/\d*>&\d/g, ' ').replace(/(\d*|&)>>?\s*\/dev\/null/g, ' ')
  if (/[^>]>[^>&]|>>/.test(bare)) return false
  return parse(command).commands.every(raw => {
    const words = program(raw)
    const name = commandName(words)
    if (HARMLESS.has(name)) return true
    if (name === 'git') {
      const at = gitVerbAt(words)
      return gitOnlyReads(words[at] ?? '', words.slice(at + 1))
    }
    if (name === 'sed') return !words.some(t => /^-i/.test(t))
    if (name === 'find' || name === 'fd' || name === 'fdfind') return !words.some(t => FIND_WRITES.test(t))
    return READERS.has(name)
  })
}

/** The most paths one command marks as read. */
const READ_LIMIT = 60
/** Output lines looked at for matched paths. */
const OUTPUT_LINES = 400

/**
 * The paths a command reads: the path arguments of readers (following `cd`), and for search tools the paths at
 * the start of their output lines.
 */
export function readPaths(command: string, cwd: string, stdout: string, home = ''): string[] {
  let dir = cwd
  const out = new Set<string>()
  let printsPaths = false
  for (const raw of parse(command).commands) {
    const words = program(raw).map(t => posix(t.replace(/^["']|["']$/g, '')))
    const name = commandName(words)
    if (name === 'cd' && words[1]) {
      dir = resolve(dir, words[1], home)
      continue
    }
    if (!READERS.has(name)) continue
    if (name === 'sed' && words.some(t => /^-i/.test(t))) continue
    if (PRINTS_PATHS.has(name)) printsPaths = true
    const args = words.slice(1)
    let skipPattern = PATTERN_FIRST.has(name) && !args.some(t => t === '-e' || t === '-f' || t === '--files')
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? ''
      if (a.startsWith('-')) {
        if (takesValue(name, a)) i++
        continue
      }
      if (skipPattern) {
        skipPattern = false
        continue
      }
      if (/[*?<>|]/.test(a)) continue
      out.add(resolve(dir, a, home))
    }
  }
  if (printsPaths) {
    const lead = windowsPaths() ? /^((?:[A-Za-z]:)?[^:\0]+?)(?::\d+[:-]|$|:)/ : /^([^:\0]+?)(?::\d+[:-]|$|:)/
    for (const line of stdout.split('\n').slice(0, OUTPUT_LINES)) {
      const path = posix(line).match(lead)?.[1]?.trim()
      if (path && !path.includes(' ')) out.add(resolve(dir, path, home))
    }
  }
  return [...out].slice(0, READ_LIMIT)
}

/** True when the command may move the session's working folder. */
export function changesFolder(command: string): boolean {
  return /(^|[;&|\s])(cd|pushd|popd)(\s|$)/.test(command)
}
