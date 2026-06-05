# One-Command Install

Mathodology uses the open `skills` CLI from `vercel-labs/skills` as its installer. The repository does not maintain a custom package manager.

## Install For Codex And Claude Code

Run this from any directory:

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --agent claude-code --copy --yes
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

## Install For One Agent

Codex only:

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --copy --yes
```

Claude Code only:

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent claude-code --copy --yes
```

## Install For All Supported Agents

Use this only if you want the skills installed across every supported agent directory on the machine:

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent '*' --copy --yes
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

If a skill already exists, remove or update it with the `skills` CLI before reinstalling:

```bash
npx -y skills@latest remove --global --agent codex mathodology-whole-project --yes
npx -y skills@latest update --global --yes
```

## Requirements

- Node.js and `npx`
- network access to GitHub and npm
- write access to the target agent skills directories
