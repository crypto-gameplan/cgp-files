// Opening a file in another app. Every path goes to the opener as an argument or an environment variable, never
// into a shell string, so names with spaces, `&` or `%` stay literal.

export type Os = 'linux' | 'darwin' | 'win32'

/**
 * Linux: starts the given command detached in its own session and waits a second, so an opener that fails at once
 * still reports its exit code while one that keeps running does not hold the hook.
 */
export const DETACH = 'setsid -f -w "$@" </dev/null >/dev/null 2>&1 & p=$!; sleep 1; kill -0 "$p" 2>/dev/null && exit 0; wait "$p"'

const LINUX_OPEN = 'if command -v gio >/dev/null 2>&1 && gio open "$1"; then exit 0; fi; exec xdg-open "$1"'

const WINDOWS_OPEN =
  "$ErrorActionPreference = 'Stop'; [Diagnostics.Process]::Start([Diagnostics.ProcessStartInfo]@{ FileName = $env:CGP_FILES_TARGET; UseShellExecute = $true }) | Out-Null"

export type Launch = { argv: string[]; init: { timeoutMs: number; env?: Record<string, string> } }

/** The system's default app for a file or URL. */
export function defaultOpener(os: Os, target: string): Launch {
  if (os === 'darwin') return { argv: ['open', '--', target], init: { timeoutMs: 10_000 } }
  if (os === 'linux') return { argv: ['sh', '-c', DETACH, 'sh', 'sh', '-c', LINUX_OPEN, 'sh', target], init: { timeoutMs: 10_000 } }
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
  return {
    argv: ['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_OPEN],
    init: { timeoutMs: 10_000, env: { CGP_FILES_TARGET: isUrl ? target : target.replace(/\//g, '\\') } },
  }
}

/** Splits on whitespace; single or double quotes keep a word whole. No other shell syntax. */
export function words(command: string): string[] {
  const out: string[] = []
  let word: string | null = null
  let quote = ''
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = ''
      else word = (word ?? '') + ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      word ??= ''
    } else if (/\s/.test(ch)) {
      if (word !== null) out.push(word)
      word = null
    } else word = (word ?? '') + ch
  }
  if (word !== null) out.push(word)
  return out
}

/**
 * The person's own "Open with" command: `{path}` and `{dir}` are filled in, and without `{path}` the path goes
 * last. Null when the setting is empty.
 */
export function customOpener(command: string, path: string, dir: string): string[] | null {
  const argv = words(command)
  if (argv.length === 0) return null
  const filled = argv.map(w => w.replace(/\{(path|dir)\}/g, (_, key: string) => (key === 'path' ? path : dir)))
  return argv.some(w => w.includes('{path}')) ? filled : [...filled, path]
}

/** The launch for a custom command: detached on Linux like the default opener, run as is elsewhere. */
export function customLaunch(os: Os, argv: string[]): Launch {
  return { argv: os === 'linux' ? ['sh', '-c', DETACH, 'sh', ...argv] : argv, init: { timeoutMs: 10_000 } }
}
