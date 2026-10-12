# CGP Files

A Claude Code plugin by [Crypto Gameplan](https://github.com/crypto-gameplan). It puts an IDE-style file tree beside your session. The tree shows the git status of every file and folder. You can search the whole project from it. While Claude works, the rows it reads, writes or commits glow for a moment.

## Install

CGP Files is listed in the Crypto Gameplan marketplace ([crypto-gameplan/cgp-marketplace](https://github.com/crypto-gameplan/cgp-marketplace)). In Claude Code, run:

```text
/plugin marketplace add crypto-gameplan/cgp-marketplace
```

```text
/plugin install cgp-files@crypto-gameplan
```

Then run `/reload-plugins` or restart Claude Code.

CGP Files is a mod, so it needs a Claude Code version that loads mods. In the desktop app the pane docks on the right. In the terminal it shows in the sidebar, which needs the fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide.

## What it shows

- **The tree.** It shows the working folder and follows it when the session changes folder. `/cgp-files <path>` pins another folder, and `⌂` goes back to following.
- **Git status per row.** Each row is coloured by its status: new in green, modified in yellow, renamed in blue, deleted in red. Modified files show `+N -N` lines. Folders count what changed below them (`?:2 M:1 D:1`). Ignored files are greyed out.
- **The branch line.** It shows the branch with its upstream, `↑ahead ↓behind`, and the line totals for the folder.
- **Claude's work.** Reads glow violet, writes glow in CGP gold, and commits glow green. If the file sits in collapsed folders, they open and glow dimmer, so you can see why they opened. Git and GitHub commands show at the bottom of the pane, for example "committed fed4321" or "opened PR". An action only counts as done when there is evidence: a new HEAD for a commit, or the exit code when the command chains with `&&` only.
- **Search.** The search box covers the whole project, including folders you never opened. Enter jumps to the first match.
- **The selection.** Click a file to select it. The next prompt tells Claude which file is selected, so "what does this do?" works. An `@path` in a prompt reveals that file in the tree.
- **Sizes.** `Σ` swaps the date column for sizes. Folder sizes come from `du` and are worked out in the background, only for the rows on screen.

## Using the tree

| Do this | And this happens |
| --- | --- |
| Click a row | Selects a file, or opens and closes a folder |
| Double-click a row, or press Enter | Opens the file with "Open with". On a folder, makes it the root |
| Right-click a row, or press `y` | Copies the path relative to the root (`Y` or shift copies it absolute) |
| Arrow keys, `j` `k` `h` `l`, Page Up/Down, Home, End | Move through the tree |
| `↑` `⌂` `↻` `◉` `Σ` `⊟` in the header | Parent folder, back to the working folder, refresh, hidden files, sizes, collapse all |

## Settings

All settings are in `/config` under cgp-files.

| Setting | Default | What it does |
| --- | --- | --- |
| Claude activity | `reads and writes` | What glows: `reads and writes`, `writes`, `reads` or `none`. Git status always shows. |
| Follow Claude | `on` | `on` scrolls the tree to what Claude works on. `off` keeps your view where it is; the glow still shows. |
| Open at start | `on` | `off` keeps the pane closed until you run `/cgp-files`. |
| Right column | `date` | `date` or `size` at session start. `Σ` toggles it. |
| Open with | empty | Empty opens a file in its default app. `preview` shows it in the pane, with Markdown rendered and code highlighted. Anything else is a command, for example `code -g {path}` or `zed {path}`: `{path}` is the file and `{dir}` its folder. Without `{path}`, the path goes last. No shell runs it. |
| Glyphs | `auto` | `auto` uses Nerd Font icons if a Nerd Font is installed, and plain Unicode in the desktop app. `nerd` or `plain` forces one. |

## Safe by design

- A failure inside the tree never blocks Claude. Every hook that a tool call or prompt waits on lets the call through if the tree's own work fails.
- File paths reach `open`, `xdg-open` or PowerShell as arguments or as an environment variable, never inside a shell string. A name like `A & B $(x).ts` stays literal.
- Outside a repository the tree runs a single `git rev-parse` and no other git command. Inside one, every git call is limited to the tree's folder and runs without taking git's optional locks.

## Development

```bash
claude plugin validate .
claude plugin test .
```

`CLAUDE.md` describes the layout of `hooks/`.

## License

[MIT](LICENSE). The idea and the feature set come from [claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) by Kurt Buhler. CGP Files is its own implementation.
