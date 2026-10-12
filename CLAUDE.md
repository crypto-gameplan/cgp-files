# cgp-files

A Claude Code plugin: one function-hooks mod that draws a file tree pane.

- Validate: `claude plugin validate .`
- Test: `claude plugin test .`
- Type-check: `bunx -p typescript@5.6.3 tsc -p .`. This needs `.claude-plugin/types/`, which appears after the mod has loaded once with `claude --plugin-dir .`.

Layout of `hooks/`:
- `register.tsx` holds every hook, the two `$.state` atoms (`cgp-files.tree`, `cgp-files.events`) and every `$` call. The validator follows `$` and atoms only inside this file, so they stay here.
- `core/` is pure logic: `paths` (posix paths, Windows drives), `nodes` (listings, visible rows), `git` (status and numstat parsing, roll-ups), `shell` (what a Bash command writes, reads and does in git), `glow`, `viewport` (the terminal's window of rows), `preview`, `open` (openers that never use a shell string), `prompt`, `settings`, `format`, `strings`.
- `ui/` is pure drawing. `pane.tsx` takes a `PaneDraw` (elements, state, actions) from `register.tsx`. `rows.tsx` is the surface module that runs on the drawing thread and posts presses, keys and scroll-bar drags back as `ui.message`. `row-spec.ts` turns a row into segments. `palette.ts` and `icons.ts` hold the colours and glyphs.

Conventions:
- UI text is English and lives in `hooks/core/strings.ts`.
- Every gating hook ends in `.catch(($, e, next) => next(e))`, and every fire-and-forget promise has a `.catch`. The tree must never block a tool call or a prompt.
- Paths are absolute and use forward slashes everywhere, on Windows too: run anything from the engine or git through `posix()` first.
- A `Client` module path is a string literal relative to the file that draws it (`./rows.tsx` from `ui/pane.tsx`).
- Colours come from `ui/palette.ts`, which matches cgp-effort and cgp-crew: CGP gold `#ffab19` for writes and folders, violet for reads, green for commits.
