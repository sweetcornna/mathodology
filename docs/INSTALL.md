# One-Command Install And Update

Mathodology uses the open `skills` CLI from `vercel-labs/skills` as its installer. The repository does not maintain a custom package manager.

Evidence work additionally uses the keyless `search` MCP server, **[free-search-mcp](https://github.com/sweetcornna/free-search-mcp)**. The repository ships `.mcp.json`, and the project-level command below installs it alongside the skills, so no manual MCP setup is needed. See [Search MCP For Evidence Work](#search-mcp-for-evidence-work).

There are two install scopes:

- **Project-level (recommended)**: installs into the current folder only. Other projects and user-level directories are never touched.
- **Global**: installs into the current user's agent directories and affects every project on the machine.

## Project-Level Install (Current Folder Only)

Run from the root of the target project. The transactional updater deploys everything Mathodology ships — all 9 skills, the 9 Claude Code subagents, the 2 contest workflow templates, and the project-level `search` MCP config — into that folder only. It installs a missing MCP config or migrates only an identifiable legacy canonical config; custom configurations and intentional download opt-outs remain unchanged:

```bash
curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.claude/skills/mathodology-whole-project/scripts/update-project.py -o /tmp/mathodology-update.py && test -s /tmp/mathodology-update.py && python3 /tmp/mathodology-update.py --project .
```

What it creates, all inside the current folder:

- `./.claude/skills/mathodology-*` — the 9 skills (copied, no symlinks)
- `./.claude/agents/mathodology-*.md` — the 9 project subagents
- `./.claude/workflows/mathodology-*.md` — the 2 workflow templates
- `./.mcp.json` — the `search` MCP server registration, created when missing and rewritten only for a positively identified legacy canonical migration
- `./skills-lock.json` — the `skills` CLI project lockfile

Nothing is written to `~/.claude/`, `~/.agents/`, or any other project.

For a skills-only install without subagents, workflow templates, or project MCP handling, invoke the underlying CLI directly:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code
```

Codex project-level install goes to `./.agents/skills/` instead:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent codex
```

Restart Claude Code (or Codex) in that project after installation.

If this directory is a clone of the Mathodology repository itself, update the checkout instead of running the copy updater:

```bash
git pull --ff-only
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py all
```

### Update A Project-Level Install

From the project root. The updater first resolves `main` (or `--ref`) to an immutable commit, then uses that same commit to reconcile all 9 skills, mirror Mathodology subagents/workflows, and handle MCP configuration:

```bash
curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.claude/skills/mathodology-whole-project/scripts/update-project.py -o /tmp/mathodology-update.py && test -s /tmp/mathodology-update.py && python3 /tmp/mathodology-update.py --project .
```

Diagnose without writing:

```bash
python3 /tmp/mathodology-update.py --project . --check
```

Install a reproducible release payload:

```bash
python3 /tmp/mathodology-update.py --project . --ref v0.12.0
```

The updater uses a complete `skills add` reconciliation so legacy locks gain newly introduced skills, while non-Mathodology lock entries remain unchanged. It replaces only `mathodology-*` managed assets. On failure, it restores the original skills, agents, workflows, `skills-lock.json`, and `.mcp.json`. Exit `0` means success, `1` means the update failed and was rolled back, and `2` means an argument, dependency, or configuration error.

MCP handling is conservative: a missing file receives the shipped config; a download env is added only when both an old evidence skill and the old canonical `uvx free-search-mcp` registration identify a legacy install. Custom search entries, a missing search entry, invalid JSON, and intentional download opt-outs in a current installation are never overwritten speculatively. Invalid JSON fails before any write; other preserved states appear in the JSON summary. Use the manual registration command in [Search MCP For Evidence Work](#search-mcp-for-evidence-work) when no `search` entry exists.

After a successful asset update, `uvx free-search-mcp@latest --help` refreshes the MCP package. Missing `uvx` or a refresh failure is recorded as non-fatal.

### Verify A Project-Level Install

```bash
ls .claude/skills | rg '^mathodology-'
ls .claude/agents .claude/workflows
```

### Remove A Project-Level Install

Project-level files are plain copies, so removal is a targeted delete inside the project:

```bash
rm -rf .claude/skills/mathodology-* .claude/agents/mathodology-*.md .claude/workflows/mathodology-*.md
```

If `skills-lock.json` contains only Mathodology entries, you can delete it too. Delete `.mcp.json` as well if the install created it and you keep no other MCP servers in that project.

## Global Install (All Projects On This Machine)

Run this from any directory:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

What it does:

- downloads the skills from `github.com/sweetcornna/mathodology`
- installs all 9 skills
- targets Codex and Claude Code
- installs globally for the current user
- copies files instead of symlinking
- skips interactive prompts

Restart Codex or Claude Code after installation.

The `skills` CLI installs skill packages. For Claude Code project subagents and workflow templates, use the project-level install above, or copy `.claude/agents/` and `.claude/workflows/` from a checkout into the target project.

CLI help:

```bash
npx -y skills@latest --help
```

Do not use `skills add <repo> --help` as a help command. Current `skills` CLI versions can interpret that form as an install command and create project-local `.agents/` and `skills-lock.json` files.

### Update A Global Install

Update only Mathodology skills:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

Update all globally installed skills:

```bash
npx -y skills@latest update --global --yes
```

Restart Codex or Claude Code after updating.

### Verify A Global Install

Codex:

```bash
ls ~/.codex/skills | rg '^mathodology-'
```

Claude Code:

```bash
ls ~/.claude/skills | rg '^mathodology-'
```

If a skill already exists and update is not enough, remove it before reinstalling:

```bash
npx -y skills@latest remove --global --yes --skill mathodology-whole-project --agent codex
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill mathodology-whole-project --agent codex
```

## Other Targets

Install globally for every supported agent directory on the machine:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --all
```

List skills without installing:

```bash
npx -y skills@latest add sweetcornna/mathodology --list
```

Expected skills:

- `mathodology-agent-pipeline`
- `mathodology-award-gates`
- `mathodology-dev-test-release`
- `mathodology-evidence-search`
- `mathodology-gateway-api`
- `mathodology-project-orientation`
- `mathodology-skill-authoring`
- `mathodology-web-ui`
- `mathodology-whole-project`

## Search MCP For Evidence Work

`mathodology-evidence-search` drives its evidence and citation-verification protocol
through an MCP server named `search` ([free-search-mcp](https://github.com/sweetcornna/free-search-mcp)):
keyless multi-engine web search, page and PDF reading, publisher-metadata extraction,
a two-level category tree routing to literature, dataset, news, finance, code, forum,
and image sources (arXiv, OpenAlex, Crossref, PubMed, Zenodo, and many more — see
`mathodology-evidence-search`'s Routing Rules for the full catalogue), and a
`paper_graph` prior-art and retraction check.

A clone needs no configuration. The repository ships a `.mcp.json` that registers the
server at project scope, so Claude Code offers `search` the first time you open the
folder — approve it once and the evidence tools are live. The only requirement is `uv`
on `PATH`; the package itself is fetched from PyPI on first run:

```bash
uv --version
```

The skills-only commands do not copy `.mcp.json` into the target project; the full
Claude Code project command above does, provided the project does not already have one.
For a skills-only install or an existing MCP config, register the server with downloads
enabled. Claude Code:

```bash
claude mcp add --transport stdio --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp
```

Codex:

```bash
codex mcp add --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp
```

Verify the server is reachable, then restart the client:

```bash
claude mcp list
```

The shipped `.mcp.json` and both manual commands set `SEARCH_MCP_DOWNLOAD_DIR`,
so `download` is expected in a normal Mathodology project install. The server itself
keeps disk writes opt-in, which is why omitting that environment variable removes only
the download tool. Files land in `~/.cache/search-mcp/downloads`, are capped at 100 MB
each, and are purged after 24 hours, so the workflow treats that directory as staging
and copies anything it keeps into the run directory. If search MCP tools are present
but `download` is absent, treat that as a configuration degradation; agents report it
rather than silently changing MCP configuration. Delete the `env` block from
`.mcp.json` to turn downloads back off intentionally; the rest of the server is unaffected.

`uvx` serves whatever version its cache already holds, so a machine that ran
`free-search-mcp` before a new release keeps the old one indefinitely. Refresh it
with one command — `--help` exits immediately, and the next server start picks up
the version it just cached:

```bash
uvx free-search-mcp@latest --help
```

To run a local checkout or a keyed engine set instead of the published package, register
the same server name at local scope — local scope overrides the project `.mcp.json`.
Browser-rendered engines additionally need Chromium once; without it, HTTP search and
fetch still work.

The server is optional, but a normal evidence run uses it together with built-in
`WebSearch`: MCP category routing supplies vertical coverage across its literature,
dataset, news, finance, code, forum, and image sources while the built-in channel
independently broadens discovery, and the researcher reconciles both result sets. If either channel is unavailable, the handoff records a single-source
`search_backend` plus the degradation reason; `none` blocks evidence work. The critic
reports every non-`combined` run as reduced coverage.

## Requirements

- Python 3.9 or newer for the transactional project updater
- Node.js and `npx`
- `uv` for the `search` MCP server used by evidence work (optional; skills install without it)
- `curl` for the one-command updater bootstrap
- network access to GitHub and npm
- write access to the target skills directories
