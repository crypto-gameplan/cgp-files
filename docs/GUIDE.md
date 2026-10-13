# CGP Files guide

Version 1.0.0, updated 2026-10-13. This guide describes that version; a newer plugin may differ in details.

This is the reference for CGP Files, a Claude Code plugin by Crypto Gameplan. An agent that is asked how the plugin works should answer from this file. Names in quotes are the words the person sees in the app, so they can find them.

## What it does

CGP Files puts a file tree beside the session. The tree shows the git status of every file and folder, searches the whole project, and lets rows glow for a moment where Claude reads, writes or commits. A click selects a file, and the next prompt tells Claude which file is selected.

## Installing, updating and removing

CGP Files is listed in the Crypto Gameplan marketplace, `crypto-gameplan/cgp-marketplace`. Install in Claude Code with two commands:

```text
/plugin marketplace add crypto-gameplan/cgp-marketplace
/plugin install cgp-files@crypto-gameplan
```

Then run `/reload-plugins` or restart Claude Code.

The plugin is a mod. In the desktop app the pane docks on the right by itself. In the terminal it shows in the sidebar, which needs the fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide; `/cgp-files` says which of the two is missing. An inline pane, one that would push the transcript around, closes itself and waits for `/cgp-files`.

To update, run `/plugin marketplace update crypto-gameplan`, then `/plugin update cgp-files@crypto-gameplan`, and restart. To remove it, run `/plugin uninstall cgp-files@crypto-gameplan`.

## The tree

The pane is titled "Files: <folder>". Its root is the session's working folder, and it moves along when the session changes folder (a `cd` in Bash included). `/cgp-files <path>` pins another folder; the tree then stays there until "⌂" goes back to following the working folder. Opening a folder with a double-click or Enter makes it the root and pins it too.

Folders come first, then files, both in natural order (file2 before file10). Hidden files show unless "◉" switches them off. A folder is listed the first time it opens and listed again when Claude writes into it, on a refresh, when the pane gets the focus, and when the person presses a row (at most every 2 seconds).

| In the pane | Meaning |
|---|---|
| The title line | The repository and the path below it (for example `cgp-platform/apps/web`), or the folder name outside a repository. |
| ↑ ⌂ ↻ ◉ Σ ⊟ | Parent folder, back to the working folder, refresh, hidden files on or off, sizes instead of dates, collapse all. |
| ⊘ | Clears the selection. It shows only while a file is selected. |
| The branch line | The branch, its upstream, ↑ commits ahead and ↓ behind, and on the right the lines added and removed and the counts of new, modified and deleted files. "clean" when nothing changed. |
| "no git repo · git status starts after git init" | The root is not in a repository. |
| "/ search" | The search box. |
| A row | Indent, ▸ or ▾ for a folder, an icon, the name, and on the right the date, the size or the git details. |
| The footer | "selected: <path>" on the left, the latest git action on the right. |

In the desktop app the icons are plain Unicode (■ for folders, · for files). In the terminal they are Nerd Font icons when a Nerd Font is installed; see "Glyphs" under Settings.

## Git status

Inside a repository each row carries a status letter, in a colour:

| Letter | Colour | Meaning |
|---|---|---|
| `?` | green | Untracked |
| `A` | green | Added |
| `M` | yellow | Modified |
| `T` | yellow | Type changed |
| `R`, `C` | blue | Renamed, copied |
| `D` | red | Deleted; the name is struck through |
| `U` | red | Merge conflict |

A folder takes the strongest letter below it and shows counts instead of a letter: `?:2 M:1 D:1` means two new, one modified and one deleted file below it. A modified file shows `+N -N` for its lines against HEAD instead of its date. Ignored files are grey with ⊘. Files in an untracked folder count as new.

Git runs only inside the tree's folder (`git -C <root> ... -- .`) and without taking git's optional locks, so it does not get in the way of Claude's own git commands. Outside a repository the tree runs a single `git rev-parse` and no other git command. The engine watches the repository's `index` and `HEAD`, so a commit or checkout made outside Claude shows within a moment.

## Claude's work

While Claude works, the rows it touches glow for about 3 seconds with a light that moves across the name:

| Tone | Colour | When |
|---|---|---|
| Read | violet | Claude reads a file with Read, or with `rg`, `grep`, `find`, `cat`, `head`, `tail`, `sed` and similar commands in Bash. Search results count as read. |
| Write | CGP gold | Claude edits a file with Edit, Write or NotebookEdit, or a Bash command changes it. |
| Commit | green | Files of a commit Claude made, and staged files after `git add`. |
| Sync, merge, undo | blue, violet, red | The branch line after a push, pull, checkout, merge, rebase or reset. |

A file inside collapsed folders opens them, and those folders glow dimmer, so it is clear why they opened. With "Follow Claude" on, the view scrolls to what glows; glowing rows above the view stay pinned at the top of the pane.

For a Bash command that may write, the plugin notes the time before the command (a marker file in the temp folder on macOS and Linux) and afterwards looks for files changed since then: `find -newer` outside a repository, up to four folders deep; inside a repository among the files git reports. A command that only reads (known readers, no redirect) skips that search. The marker file is removed afterwards.

Git and GitHub commands show in the footer, for example "committing…", then "committed fed4321". An action only counts as done on evidence: a commit when HEAD moved, a push, merge or PR when Claude Code's git report says so, other actions when the command chained them with `&&` only and succeeded. Anything else reads "ran git push". A failed commit reads "commit failed". A command sent to the background stays "running" until its task notification arrives.

## Search

The search box filters the whole project, folders never opened included. Inside a repository it searches git's file list (tracked and untracked, without ignored files); outside one it searches up to six folders deep, leaving out `.git`, `node_modules`, `target`, `.venv`, `__pycache__`, `dist` and `.next`. Matching is on the path below the root, ignoring case. Up to 60 matches are revealed. Enter jumps to the first match, opens the folders of the first ten and clears the box. "×" clears it.

## Selection and mentions

A click on a file selects it. The footer shows "selected: <path>", and every prompt sent while the file exists carries a line telling Claude that the person has this file selected, so "what does this do?" refers to it. "⊘" clears the selection.

An `@path` in a prompt, such as `@src/app.ts`, reveals that file in the tree and moves the cursor to it.

## Moving and opening

| Do this | And this happens |
|---|---|
| Click a row | A file is selected; a folder opens or closes. |
| Click the same row twice within 0.45 s, or press Enter on a file | Opens the file with "Open with". On a folder, it becomes the root. |
| Ctrl or Shift click | Opens at once. |
| Right-click, or `y` | Copies the path relative to the root. `Y` or Shift copies it absolute. A toast says "Copied <path>". |
| ↑ ↓ or `k` `j` | Moves the cursor. Page Up and Page Down move ten rows, Home and End to the ends. |
| → or `l`, ← or `h` | Opens a folder; closes it, or moves to the parent. |
| Space | Opens or closes a folder. |
| The wheel or the scroll bar (terminal) | Scrolls. A press holds the view where it is. The desktop app scrolls the pane itself. |

The default opener is `open` on macOS, `gio open` or `xdg-open` on Linux (started detached), and PowerShell's shell-execute on Windows. The path reaches them as an argument or an environment variable, never inside a shell string. A failed opener shows a toast.

## Preview

With "Open with" set to `preview`, opening a file shows it in the pane: Markdown rendered, other files highlighted as code. "← files", ← or `h` go back to the tree, ↑ ↓ `j` `k`, Page Up, Page Down, Home and End scroll, "↗" opens the file in its default app. Files over 4 MB are not read, binary files show a note, and long files show their first lines with "first n lines of m characters". An edit Claude makes to the previewed file reloads it.

## Sizes

"Σ" swaps the date column for sizes. Files show their size in binary units (`512 B`, `1.5 K`, `120 M`). Folders show their disk usage from `du`, worked out in the background, two folders at a time and only for the rows on screen; "…" while it runs, `?` when unknown. On Windows the plugin sums the files instead, up to 50,000 entries. Writes clear the sizes of the folders they touched.

## Settings

The settings are in `/config` under cgp-files, or `/plugin configure cgp-files@crypto-gameplan`.

| Setting | Values | Default | Effect |
|---|---|---|---|
| "Claude activity" | `reads and writes`, `writes`, `reads`, `none` | `reads and writes` | What glows. Git status, line counts and the footer always show. |
| "Follow Claude" | `on`, `off` | `on` | `on` scrolls to what Claude reads, writes or commits. `off` keeps the view where the person put it; the glow still shows. |
| "Open at start" | `on`, `off` | `on` | `off` keeps the pane closed until `/cgp-files`. |
| "Right column" | `date`, `size` | `date` | What the right column shows at session start. "Σ" toggles it. |
| "Open with" | empty, `preview`, a command | empty | Empty opens files in their default app. `preview` shows them in the pane. A command runs instead: `{path}` is the file, `{dir}` its folder, and without `{path}` the path goes last. Quotes keep a word whole; no shell runs it. Examples: `code -g {path}`, `zed {path}`. |
| "Glyphs" | `auto`, `nerd`, `plain` | `auto` | `auto` uses Nerd Font icons in the terminal when a Nerd Font is installed (found with `fc-list`, or in `~/Library/Fonts` and `/Library/Fonts` on macOS), and assumes one over SSH. The desktop app always uses plain Unicode. |

## Commands

| Command | What it does |
|---|---|
| `/cgp-files` | Opens the pane on the working folder and follows it. |
| `/cgp-files <path>` | Opens the pane on that folder and pins it. `~` and relative paths work. |

## Data and costs

The plugin lists folders and runs `git`, `find`, `du` and the opener on the person's machine. It sends nothing anywhere and calls no model, so it costs no tokens. The only thing it adds to a prompt is the line naming the selected file.

## Troubleshooting

| What the person sees | What to do |
|---|---|
| "needs the fullscreen layout" | Run `/tui fullscreen`, then `/cgp-files`. |
| "needs a terminal at least 110 columns wide" | Widen the terminal, then run `/cgp-files`. |
| Boxes or question marks instead of icons | The terminal has no Nerd Font. Set "Glyphs" to `plain`, or install a Nerd Font and restart the terminal. |
| "could not list <folder>" | The folder cannot be read (permissions). The tree keeps what it had. |
| "could not open <file> with <app>" | The opener failed. Check "Open with". |
| "no git repo" in a repository | Press "↻". If it stays, the root is outside the repository. |
| "… n more rows, collapse folders or use search" | The open tree is too large to draw at once. Collapse folders with "⊟" or search. |
| `/cgp-files` is unknown in the terminal | Add `{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }` to `~/.claude/settings.json` and restart. |
| Bugs | Open an issue on `crypto-gameplan/cgp-files`. |

## Credit

The idea and the feature set come from claude-code-filetree by Kurt Buhler (MIT). CGP Files is its own implementation.
