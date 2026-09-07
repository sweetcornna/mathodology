# Installation and updates

Mathodology uses the standard [skills CLI](https://github.com/vercel-labs/skills).
A full checkout contains eight skills, eight optional Claude Code roles, two
workflow prompts and a project search MCP configuration. No custom updater runs.

## Use a full checkout

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

Claude Code can use the project skill and role directories. Codex can install a
local skill copy from this checkout:

```bash
npx -y skills@latest add . --copy --yes --skill '*' --agent codex
```

The maintained source remains `.claude/skills/`; the Codex copy is in the ignored
`.agents/skills/` mirror. Restart or refresh the host's skill discovery after an
update. Project MCP configuration support depends on the host.

## Install skills into an existing project

From the target project, choose the appropriate command:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent codex
```

These commands install skills, including their references and examples. They do
not copy root AGENTS.md, project roles, workflows or MCP configuration. Do not
overwrite the target project's instructions or custom MCP settings. Optional roles
and workflows can be copied from the checkout after checking destination conflicts.
Add only the needed Mathodology guidance to existing project instructions.

For a deliberate global skills install, add `--global` to the selected command.
Global scope affects other projects and is not required for project use. It does
not install project roles or MCP configuration.

## Evidence tools

The checkout's `.mcp.json` registers
[free-search-mcp](https://github.com/sweetcornna/free-search-mcp) through `uvx`.
It requires uv to be available and enables a local staged-download directory.
The host may require enabling the server. It is a keyless search service; underlying
engines can still be unavailable. The evidence skill records actual coverage and
can continue with built-in search.

A skills-only installation can register the server using its host's MCP settings.
Where the corresponding CLI is available, these are the standard commands:

```bash
claude mcp add --transport stdio --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp
codex mcp add --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp
```

Run only the command for your host and intended scope; inspect existing server
settings first. Do not replace a custom server or intentional download opt-out.
No image2 service is installed: the agent asks about the user's actual tool,
configured interface or manual usage when figure work begins.

## Update and migrate

Back up local edits first. For a clean checkout:

```bash
git status --short
git pull --ff-only
```

Do not reset or discard local work when fast-forwarding is unavailable. For an
installed skills copy, back up its Mathodology directories, then reinstall from
the selected source with the appropriate command above. Compare the new skill
list with the old installation and remove retired Mathodology entries after
backing them up. Leave unrelated skills, custom settings and global installs alone.
Do not use a broad update command if only this project should change.

For this repository's local Codex mirror, back up `.agents/skills/mathodology-*`
separately before refreshing those entries from `.claude/skills/`. The source
backup intentionally excludes the ignored mirror. Resolve customizations in the
backup explicitly; never turn the mirror into a second authoring source.

See [backup](BACKUP.md), [skills](SKILLS.md), and [workflow prompts](WORKFLOWS.md).
