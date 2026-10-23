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
- **Humanizer.** Kit projects also get [humanizer](https://github.com/blader/humanizer)
  (MIT), which rewrites AI-sounding prose without changing what it says: the
  Claude Code plugin at project scope (`claude plugin … --scope project`, user
  settings untouched) and a copy of the skill in `.agents/skills` for Codex and
  Gemini CLI. Without the `claude` CLI the skill goes into `.claude/skills`
  instead. At each launch Studio checks for a newer version: `claude plugin
  update` for the plugin, and the repository's newest commit for the copies it
  installed (copies you edited are left alone). It runs in the background, also
  for existing projects, and can be switched off in Settings.
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
  as a fix request, resolved or dismissed. Before the reviewer starts, Studio
  traces every DOI, arXiv id, PMID, trial id, `\cite` key and author-year
  reference in the replies and in documents the session produced to a tool
  result, a user message or the project bibliography, and looks up untraced
  DOIs: one the DOI system does not know is reported as likely made up, a
  missing `\cite` key or a retracted paper as a failure. These findings carry
  a "Citation" tag, and the reviewer is told about them so it can judge
  whether sources support claims instead.
- **Literature.** A side-pane search over papers, preprints, math, CS,
  biomedical sources and datasets through the search connector. Results are
  labelled published, preprint, dataset or web; a preprint and its journal
  version are folded into one result, and "Find the published version" follows
  the registry's version link or a close title match. Each result opens its
  references and citing works. "Add reference" first asks the DOI system about
  the DOI: one that does not exist or is registered to a different title is
  refused; otherwise the registry's BibTeX (or an entry built from its
  metadata) gets a predictable `surnameYEARword` key and is appended to
  `paper/references.bib` once, with retractions, withdrawals and corrections
  reported from Crossref, Retraction Watch and OpenAlex.
- **Reference check.** The Literature pane's second view checks any `.bib` in
  the project entry by entry. A DOI is `resolves`, `not found` or
  `unverifiable`, never guessed: Crossref first, then doi.org's registration
  agency lookup (DataCite, or CSL metadata for agencies such as ISTIC, CNKI and
  JaLC). The registered title, first author and year are compared with the
  entry, and notices are listed. Entries without a DOI get their arXiv DOI or a
  close Crossref match, which "Write DOI" inserts. "Ask the agent" puts the
  doubtful entries into the composer as a fix request. Crossref is queried one
  request at a time and rate limits are retried.
- **Connectors.** MCP servers, local commands or remote URLs, configured once
  in Settings and written into `.mcp.json` (Claude Code), `.codex/config.toml`
  (Codex) and `.gemini/settings.json` (Gemini CLI) in every project with the
  kit. Servers you added to those files yourself, or edited after Studio wrote
  them, are left alone, also when one has a connector's name. The built-in
  Mathodology Search runs `free-search-mcp` through `uvx` and needs no key;
  each launch refreshes it to the newest release (`uvx free-search-mcp@latest`).
- **Side pane.** File tree, artifacts, literature, the agent's task list with
  session usage, and previews for PDF, images, Markdown (with math), CSV and
  highlighted source.
- **Onboarding and settings.** First-run setup for language, agent detection,
  workspace folder and a first project. Settings cover agent paths, default
  models and extra arguments, permission defaults, theme, font size, the kit and
  shortcuts. Simplified Chinese and English, light and dark.

## Requirements

- macOS on Apple silicon, Windows 10 or 11 (x64), or Linux (x64 or arm64; the
  .deb for Debian and Ubuntu, the AppImage elsewhere).
- At least one agent CLI on your `PATH`, signed in from a terminal once:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`
  - Codex: `npm install -g @openai/codex`
  - Gemini CLI: `npm install -g @google/gemini-cli`
- For development: Node.js 22.12 or newer and pnpm 10.

On macOS and Linux, Studio resolves CLIs through your login shell, so tools
installed with Homebrew, npm, nvm or `~/.local/bin` are found even when the app
starts from Finder or a desktop menu. On Windows it searches `PATH` for `.exe`
and `.cmd` files, plus `%APPDATA%\npm` and `~/.local/bin`, and starts npm's
`.cmd` shims with node directly so multi-line prompts arrive intact. A binary
path can also be set per agent in Settings → Agents.

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
| `pnpm test` | Run the unit tests (stream parsers, models, artifacts, reviews, connectors, literature, reference checks, citation trace, humanizer and search updates, Windows CLI launching) |
| `pnpm package` | Build an unpacked `.app` under `release/<version>/` |
| `pnpm dist` | Build the macOS DMG and ZIP |
| `pnpm dist:win` | Build the Windows x64 installer |
| `pnpm dist:linux` | Build the Linux .deb and AppImage for x64 and arm64 |

All three build on a Mac, including Apple silicon, without Wine.

Builds are unsigned for now; signing for Windows is being set up (see the code
signing policy below). On first launch macOS asks for confirmation; open the app
from Finder with Control-click → Open, or clear the quarantine flag on the copy
you built yourself. Windows SmartScreen may warn about an unknown publisher:
choose More info → Run anyway. On Ubuntu 23.10 and later, AppArmor keeps
AppImages from using Chromium's sandbox; the .deb installs a profile that
allows it.

Release packages: the
[Studio Windows workflow](../../.github/workflows/studio-windows.yml) builds the
Windows installer on a GitHub-hosted runner when a `v*` tag is pushed, and its
artifact is attached to the release; the macOS and Linux packages are built
with `pnpm dist` and `pnpm dist:linux`. Pull requests that touch Studio or the
kit run the same workflow, unsigned.

## Code signing policy

Windows installers on the releases page are built from this repository by the
Studio Windows workflow on GitHub-hosted runners. Signing them through
[SignPath.io](https://about.signpath.io), free for open source with a
certificate from [SignPath Foundation](https://signpath.org), is being set up;
until the first signed release they are unsigned. Once it is on, the installer
and the `Mathodology Studio.exe` inside it are signed only after an approver
accepts the release's signing request in SignPath, and Windows shows the
publisher as SignPath Foundation. Electron's own libraries ship as upstream
builds them.

- Committers and reviewers: [@sweetcornna](https://github.com/sweetcornna).
  Pull requests from anyone else are reviewed before they are merged.
- Approvers: [@sweetcornna](https://github.com/sweetcornna).

Privacy: Studio sends nothing to the Mathodology project. It contacts other
systems only for what you use:

- The agent CLIs you run (Claude Code, Codex, Gemini CLI) send your prompts and
  project files to their own providers under your accounts.
- Reference checks look up the DOIs and titles you check at Crossref, DataCite,
  OpenAlex, arXiv and doi.org. The Mathodology Search connector
  (free-search-mcp) sends the queries you or an agent search for to public
  search engines; it also serves the Literature panel.
- At each launch Studio asks GitHub whether the humanizer has a newer version,
  and uvx fetches the newest free-search-mcp from PyPI. These requests carry no
  project data. Turn them off in Settings with **Install and update Humanizer**
  and the Mathodology Search connector.

Set `STUDIO_USER_DATA=/some/dir` to run with a separate data directory, for
example to see onboarding again or to test without touching your projects.

## How it works

```
src/main       Electron main process: storage, project kit, IPC, agent adapters
src/preload    The typed window.studio bridge (contextIsolation, sandboxed renderer)
src/renderer   React interface
src/shared     Types and IPC contracts used by both sides
tests          Unit tests for the adapters, artifact store, reviews, connectors, literature,
               reference checks and citation trace
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
auto-edit. Use Plan only for read-only work with Gemini. Codex's workspace-write
sandbox is started with network access (`sandbox_workspace_write.network_access=true`),
because modeling installs packages with pip and downloads data.

Data lives in the app's user-data folder under `studio/`: `settings.json`,
`state.json` (projects and sessions), one `events/<session>.jsonl` per session,
`artifacts/<project>/` (the version index and a content-addressed copy of each
version up to 25 MB), `reviews/<session>.json` and `connectors/<project>.json`
(the connector entries Studio wrote into that project). A state file that cannot
be parsed is kept as `<name>.corrupt-<time>` before Studio starts over.
Streaming deltas are not persisted; finished messages are. Project files reach
the renderer through a `studio-file://` scheme confined to registered project
folders, symbolic links included.

The kit comes from this repository: `pnpm dev` reads it from the checkout, and
packaged builds bundle a copy under `Contents/Resources/kit`.
