# One-Command Install And Update

Mathodology uses the open `skills` CLI from `vercel-labs/skills` as its installer. The repository does not maintain a custom package manager.

There are two install scopes:

- **Project-level (recommended)**: installs into the current folder only. Other projects and user-level directories are never touched.
- **Global**: installs into the current user's agent directories and affects every project on the machine.

## Project-Level Install (Current Folder Only)

Run from the root of the target project. One command deploys everything Mathodology ships — all 8 skills, the 9 Claude Code subagents, and the 2 contest workflow templates — into that folder only:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code && curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 'mathodology-main/.claude/agents' 'mathodology-main/.claude/workflows'
```

What it creates, all inside the current folder:

- `./.claude/skills/mathodology-*` — the 8 skills (copied, no symlinks)
- `./.claude/agents/mathodology-*.md` — the 9 project subagents
- `./.claude/workflows/mathodology-*.md` — the 2 workflow templates
- `./skills-lock.json` — the `skills` CLI project lockfile

Nothing is written to `~/.claude/`, `~/.agents/`, or any other project.

If you only want the skills (no subagents or workflow templates), drop the second half:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code
```

Codex project-level install goes to `./.agents/skills/` instead:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent codex
```

Restart Claude Code (or Codex) in that project after installation.

### Update A Project-Level Install

From the project root:

```bash
npx -y skills@latest update --project --yes
```

To refresh the subagents and workflow templates, re-run the `curl ... | tar ...` half of the install command.

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

If `skills-lock.json` contains only Mathodology entries, you can delete it too.

## Global Install (All Projects On This Machine)

Run this from any directory:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

What it does:

- downloads the skills from `github.com/sweetcornna/mathodology`
- installs all 8 skills
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
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-award-gates mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
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
- `mathodology-gateway-api`
- `mathodology-project-orientation`
- `mathodology-skill-authoring`
- `mathodology-web-ui`
- `mathodology-whole-project`

## Requirements

- Node.js and `npx`
- `curl` and `tar` for the subagents/workflows half of the project-level install
- network access to GitHub and npm
- write access to the target skills directories
