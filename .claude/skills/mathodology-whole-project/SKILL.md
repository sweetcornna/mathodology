---
name: mathodology-whole-project
description: Use when backing up, transferring, restoring, archiving, or fully orienting on the Mathodology skills-only repository.
---

# Mathodology Whole Project

## Purpose

This is the top-level project skill for the current Mathodology GitHub tree.

The repository is intentionally skills-only. It preserves Mathodology as an AI-coding knowledge pack, not as a runnable app checkout.

## Current Shape

The retained repository surface is:

- `.claude/skills/**`: project skills and Codex-style metadata.
- `AGENTS.md`: tool-neutral entrypoint.
- `README.md` and `README_zh.md`: public project overview.
- `docs/SKILLS.md`, `docs/SKILLS_zh.md`, `docs/INSTALL.md`, `docs/INSTALL_zh.md`, and `docs/BACKUP.md`: skill, install, and backup documentation.
- `LICENSE` and `.gitignore`.

Do not expect app source, CI workflows, deployment config, generated contracts, datasets, package manifests, lockfiles, or installers in this branch.

## Skill Set

Load these skills as needed:

- `mathodology-project-orientation`: current layout, retained files, deletion policy, and repository boundary checks.
- `mathodology-agent-pipeline`: archived knowledge about the former Python agent pipeline.
- `mathodology-gateway-api`: archived knowledge about the former Rust gateway and API.
- `mathodology-web-ui`: archived knowledge about the former Vue web UI.
- `mathodology-dev-test-release`: skills validation and archived dev, test, deploy, packaging, and release guidance.
- `mathodology-skill-authoring`: adding or updating project skills and metadata.

## User Install

For end users, prefer the mature `skills` CLI installer:

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --agent claude-code --copy --yes
```

See `docs/INSTALL.md` for target-specific variants.

## Backup Workflow

Use the bundled script:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

The script creates a timestamped backup directory outside the repo by default:

```text
../mathodology_skills_backups/<timestamp>/
├── mathodology-skills-<timestamp>.tar.gz
├── SHA256SUMS
├── archive-files.txt
├── source-files.nul
├── git-status.txt
├── uncommitted-diff.patch
└── untracked-files.txt
```

The archive is whitelist-based. It includes only the retained skills repository files, even if old application directories still exist locally.

## Restore Orientation

After extracting a backup:

```bash
tar -xzf mathodology-skills-<timestamp>.tar.gz -C <restore-dir>
cd <restore-dir>
```

Then read `AGENTS.md` and load `mathodology-project-orientation` before making edits.

## Deletion Policy

Do not reintroduce non-skills files on this branch:

- app source directories
- generated clients or contracts
- CI workflows
- Docker, service, deployment, or installer files
- datasets, run artifacts, package lockfiles, or build outputs

If historical application code is needed, inspect Git history in a separate branch or worktree instead of adding it back to `main`.
