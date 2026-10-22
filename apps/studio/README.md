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
  never overwritten.
- **Sessions.** Any agent per session, switchable between turns. Conversations
  resume through each CLI's own session store.
- **Models.** The model picker lists what each CLI reports for the signed-in
  account (Claude Code's SDK handshake, Codex `model/list`, the models bundled
  with Gemini CLI), with each provider's mark and a reasoning-effort setting
  where the model supports one.
- **Transcript.** Streamed replies and thinking, Markdown with KaTeX math, tool
  calls rolled up into short phrases with expandable details and diffs, a row
  of the files each turn produced (figure thumbnails, version, line changes),
  and duration, tokens and (where the CLI reports it) cost in each footer.
- **Message queue.** Messages sent while the agent works wait above the
  composer, where they can be edited or removed, and run in order. After an
  interrupted or failed turn the queue pauses until you send the next one.
- **Approvals.** File edits and commands pause in an approval card above the
  composer (Allow once, Always allow, Deny; `⌘↵`, `⌘⇧↵`, `Esc`).
- **Artifacts.** Every figure, table, document, code and data file the project
  produces is versioned: each change is an immutable version with a checksum,
  its bytes kept outside the project. Each version records where it came from,
  strongest evidence first: a tool call that wrote the file, a turn during which
  a script wrote it, a restore in Studio, or an edit made outside any turn. The
  artifact library groups outputs by session; the viewer steps through
  versions, compares any two (line diff, or images side by side), restores an
  earlier one as a new version and links back to the turn that produced it.
- **Review.** "Review this session" runs the session's agent again, read-only
  and without saving a CLI session, over a digest of the transcript: prompts,
  every tool call with its outcome and output, replies and produced files. The
  reviewer traces each substantive claim to that record and the project files
  instead of redoing the work, and returns findings marked fails, doubtful,
  inconclusive or holds, with evidence. Findings can be sent back to the agent
  as a fix request, resolved or dismissed.
- **Literature.** A side-pane search over papers, preprints, math, CS,
  biomedical sources and datasets through the search connector. "Add
  reference" fetches BibTeX from the DOI registry or arXiv (or builds an entry
  from the result), gives it a predictable `surnameYEARword` key, appends it to
  `paper/references.bib` once, and warns if the DOI has been retracted.
- **Connectors.** MCP servers, local commands or remote URLs, configured once
  in Settings and written into `.mcp.json` (Claude Code), `.codex/config.toml`
  (Codex) and `.gemini/settings.json` (Gemini CLI) in every project with the
  kit. Servers you added to those files yourself are left alone. The built-in
  Mathodology Search runs `free-search-mcp` through `uvx` and needs no key.
- **Side pane.** File tree, artifacts, literature, the agent's task list with
  session usage, and previews for PDF, images, Markdown (with math), CSV and
  highlighted source.
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
| `pnpm test` | Run the unit tests (stream parsers, models, artifacts, reviews, connectors, literature) |
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
tests          Unit tests for the adapters, artifact store, reviews, connectors and literature
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
`state.json` (projects and sessions), one `events/<session>.jsonl` per session,
`artifacts/<project>/` (the version index and a content-addressed copy of each
version up to 25 MB) and `reviews/<session>.json`. Streaming deltas are not
persisted; finished messages are. Project
files reach the renderer through a `studio-file://` scheme confined to
registered project folders.

The kit comes from this repository: `pnpm dev` reads it from the checkout, and
packaged builds bundle a copy under `Contents/Resources/kit`.
