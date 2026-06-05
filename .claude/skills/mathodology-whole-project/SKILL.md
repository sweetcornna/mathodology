---
name: mathodology-whole-project
description: Use when backing up, transferring, restoring, archiving, or fully orienting on the entire Mathodology project as a project-level skill set.
---

# Mathodology Whole Project

## Purpose

This is the top-level project skill. Use it when the user wants the whole Mathodology repository to exist as an AI-coding-tool knowledge pack, or when making a source backup that can be restored elsewhere.

It does not replace subsystem skills. It routes work to them and preserves the project as a clean source archive.

## Skill Set

Load these skills as needed:

- `mathodology-project-orientation`: repository map, generated files, change boundaries, common commands.
- `mathodology-agent-pipeline`: Python worker, agents, prompts, Coder execution, HMML, MATLAB, runtime `docs/skills`.
- `mathodology-gateway-api`: Rust gateway, routes, auth, Redis/Postgres, LLM routing, exports, submission bundles.
- `mathodology-web-ui`: Vue app, Pinia stores, API clients, WebSocket streaming, markdown/math rendering.
- `mathodology-dev-test-release`: bootstrap, tests, CI parity, Docker/native deployment, packaging, release.
- `mathodology-skill-authoring`: adding or updating project skills and runtime Coder skills.

## Backup Workflow

Use the bundled script:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

The script creates a timestamped backup directory outside the repo by default:

```text
../math_agent_backups/<timestamp>/
├── math_agent-source-<timestamp>.tar.gz
├── SHA256SUMS
├── archive-files.txt
├── source-files.nul
├── git-status.txt
├── uncommitted-diff.patch
└── untracked-files.txt
```

The archive includes tracked files and untracked non-ignored files. That captures current project skills and working-tree source changes while excluding ignored secrets, build outputs, caches, vendored dependencies, local run artifacts, and Claude runtime state.

## Restore Orientation

After extracting a backup:

```bash
tar -xzf math_agent-source-<timestamp>.tar.gz -C <restore-dir>
cd <restore-dir>
git status --short --branch
```

Then read `AGENTS.md` and load `mathodology-project-orientation` before making edits.

## What Not To Archive

Do not intentionally include:

- `.git/`
- `.env` or local secret files
- `target/`
- `.venv/`
- `node_modules/`
- `apps/web/dist/`
- `runs/`
- `.run/`
- `.claude/worktrees/`
- local database, Redis dump, or Docker volume state

If the user needs a production data backup, use deployment docs and database/run-artifact backup commands instead of this source-skill backup.
