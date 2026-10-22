# Mathodology Studio

A desktop workbench for mathematical modeling contests. Studio drives the agent
CLIs you already use (Claude Code, Codex and Gemini CLI) inside a contest project
that carries the Mathodology skills, and shows their work as a readable
conversation with files, figures and a paper preview beside it.

Studio does not call model APIs itself, holds no API keys and collects no data.
Every turn runs through a CLI installed and signed in on your machine, under that
CLI's own account and limits. It is MIT-licensed like the rest of the repository.

## What it does

- **Projects.** Each contest is a folder (`problem/`, `attachments/`, `code/`,
  `figures/`, `paper/`). Creating one installs the five contest skills, the eight
  specialist roles, the workflow prompts and an `AGENTS.md` that Claude Code
  (`CLAUDE.md`), Codex and Gemini CLI (`GEMINI.md`) all read. Existing files are
  never overwritten. Search MCP configuration is optional.
- **Sessions.** Any agent per session, switchable between turns. Conversations
  resume through each CLI's own session store.
- **Transcript.** Streamed replies and thinking, Markdown with KaTeX math, tool
  calls rolled up into short phrases with expandable details and diffs, an
  "Edited N files" card per turn, and duration, tokens and (where the CLI
  reports it) cost in each footer.
- **Approvals.** File edits and commands pause in an approval card above the
  composer (Allow once, Always allow, Deny; `⌘↵`, `⌘⇧↵`, `Esc`).
- **Side pane.** File tree, a figure gallery that refreshes as the agent writes,
  the agent's task list with session usage, and previews for PDF, images,
  Markdown (with math), CSV and highlighted source.
- **Onboarding and settings.** First-run setup for language, agent detection,
  workspace folder and a first project. Settings cover agent paths, default
  models and extra arguments, permission defaults, theme, font size, the kit and
  shortcuts. Simplified Chinese and English, light and dark.

## Requirements

- macOS on Apple silicon. Electron builds for Windows and Linux are configured
  but untested.
- At least one agent CLI on your `PATH`, signed in from a terminal once:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`
  - Codex: `npm install -g @openai/codex`
  - Gemini CLI: `npm install -g @google/gemini-cli`
- For development: Node.js 22.12 or newer and pnpm 10.

Studio resolves CLIs through your login shell, so tools installed with Homebrew,
npm, nvm or `~/.local/bin` are found even when the app starts from Finder. A
binary path can also be set per agent in Settings → Agents.

## Develop

```bash
cd apps/studio
pnpm install
pnpm dev
```

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run with hot reload |
| `pnpm typecheck` | Type-check the main/preload and renderer projects |
| `pnpm test` | Run the stream-parser tests |
| `pnpm package` | Build an unpacked `.app` under `release/<version>/` |
| `pnpm dist` | Build the macOS DMG and ZIP |

Builds are unsigned. On first launch macOS asks for confirmation; open the app
from Finder with Control-click → Open, or clear the quarantine flag on the copy
you built yourself.

Set `STUDIO_USER_DATA=/some/dir` to run with a separate data directory, for
example to see onboarding again or to test without touching your projects.

## How it works

```
src/main       Electron main process: storage, project kit, IPC, agent adapters
src/preload    The typed window.studio bridge (contextIsolation, sandboxed renderer)
src/renderer   React interface
src/shared     Types and IPC contracts used by both sides
tests          Parser and argument tests for each adapter
```

Each adapter starts the CLI for a turn and translates its output into one event
model (`src/shared/types.ts`), so the interface does not depend on any one agent.

| Agent | Protocol | Approvals | Resume |
| --- | --- | --- | --- |
| Claude Code | `-p` with `stream-json` input and output and partial messages; SDK control messages on stdin/stdout for permission prompts and interrupts | Per tool call | `--session-id`, then `--resume` |
| Codex | `codex app-server` JSON-RPC: threads, turns, item notifications, plan updates and token usage | Per command and file change | `thread/resume` |
| Gemini CLI | `--output-format stream-json`, one process per turn | Approval mode only | `--session-id`, then `--resume` |

Permission modes map onto each CLI:

| Studio mode | Claude Code | Codex | Gemini CLI |
| --- | --- | --- | --- |
| Ask each time | `manual` | workspace-write, `untrusted` | `auto_edit` |
| Accept edits | `acceptEdits` | workspace-write, `on-request` | `auto_edit` |
| Plan only | `plan` | read-only, `never` | `plan` |
| Full autonomy | `bypassPermissions` | danger-full-access, `never` | `yolo` |

Gemini CLI has no headless approval channel, so its "Ask each time" runs as
auto-edit. Use Plan only for read-only work with Gemini.

Data lives in the app's user-data folder under `studio/`: `settings.json`,
`state.json` (projects and sessions) and one `events/<session>.jsonl` per
session. Streaming deltas are not persisted; finished messages are. Project
files reach the renderer through a `studio-file://` scheme confined to
registered project folders.

The kit comes from this repository: `pnpm dev` reads it from the checkout, and
packaged builds bundle a copy under `Contents/Resources/kit`.
