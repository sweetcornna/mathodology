# One-Command Install And Update

Mathodology uses the open `skills` CLI from `vercel-labs/skills` as its installer. The repository does not maintain a custom package manager.

## Install For Codex And Claude Code

Run this from any directory:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

What it does:

- downloads the skills from `github.com/sweetcornna/mathodology`
- installs all 7 skills
- targets Codex and Claude Code
- installs globally for the current user
- copies files instead of symlinking
- skips interactive prompts

Restart Codex or Claude Code after installation.

The `skills` CLI installs skill packages. For Claude Code project subagents and workflow templates, clone the repository or copy `.claude/agents/` and `.claude/workflows/` into the target project.

CLI help:

```bash
npx -y skills@latest --help
```

Do not use `skills add <repo> --help` as a help command. Current `skills` CLI versions can interpret that form as an install command and create project-local `.agents/` and `skills-lock.json` files.

## Update Installed Skills

Update only Mathodology skills:

```bash
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

Full one-command updater from a cloned Mathodology checkout:

```bash
git pull --ff-only && npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

Use the full updater when you rely on `.claude/agents/` or `.claude/workflows/`, because those project-level files live in the checkout rather than inside the global skill packages.

Update all globally installed skills:

```bash
npx -y skills@latest update --global --yes
```

Restart Codex or Claude Code after updating.

If you cloned this repository to use Claude Code project subagents and workflow templates, the full updater above already refreshes the checkout. To update only the checkout, run:

```bash
git pull --ff-only
```

Then copy `.claude/agents/` and `.claude/workflows/` into any target project that should use those project-level assets.

## Install For One Agent

Codex only:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex
```

Claude Code only:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent claude-code
```

## Install For All Supported Agents

Use this only if you want the skills installed across every supported agent directory on the machine:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --all
```

## List Skills Without Installing

```bash
npx -y skills@latest add sweetcornna/mathodology --list
```

Expected skills:

- `mathodology-agent-pipeline`
- `mathodology-dev-test-release`
- `mathodology-gateway-api`
- `mathodology-project-orientation`
- `mathodology-skill-authoring`
- `mathodology-web-ui`
- `mathodology-whole-project`

## Verify Installation

Codex global install:

```bash
ls ~/.agents/skills | rg '^mathodology-'
```

Claude Code global install:

```bash
ls ~/.claude/skills | rg '^mathodology-'
```

If a skill already exists and update is not enough, remove it before reinstalling:

```bash
npx -y skills@latest remove --global --yes --skill mathodology-whole-project --agent codex
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill mathodology-whole-project --agent codex
```

## Requirements

- Node.js and `npx`
- network access to GitHub and npm
- write access to the target agent skills directories
