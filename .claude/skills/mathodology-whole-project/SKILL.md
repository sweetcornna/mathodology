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
- `.claude/agents/**`: Claude Code project subagents for award-level modeling workflows.
- `.claude/workflows/**`: Claude Code workflow templates.
- `AGENTS.md`: tool-neutral entrypoint.
- `README.md` and `README_zh.md`: public project overview.
- `docs/SKILLS.md`, `docs/SKILLS_zh.md`, `docs/INSTALL.md`, `docs/INSTALL_zh.md`, `docs/WORKFLOWS.md`, `docs/WORKFLOWS_zh.md`, and `docs/BACKUP.md`: skill, install, workflow, and backup documentation.
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

## Runtime Modes

Choose the orchestration mode from the agent environment:

- Claude Code project checkout: use `.claude/workflows/mathodology-award-submission.md` and dispatch the `.claude/agents/mathodology-*.md` subagents.
- Claude Code global skill install: load this skill and follow `docs/WORKFLOWS.md`; copy `.claude/agents/` and `.claude/workflows/` into the project if native project subagents are needed.
- Codex global skill install: run the workflow in multi-agents mode, dispatching independent agents for each phase, synthesizing their findings, then gating with a critic.

Codex start prompt:

```text
Use $mathodology-whole-project. Run the Mathodology 9-phase award submission workflow in Codex multi-agents mode. For each phase, dispatch independent agents for analysis, modeling, evidence, coding, critique, and writing where applicable; synthesize their output; then run the phase gate before continuing.
```

## Award-Level Phase Model

Use the shared phase model in `docs/WORKFLOWS.md`:

- Phase 0: Intake and scoring.
- Phase 1: Evidence and data.
- Phase 2: Candidate model routes.
- Phase 3: Mathematical specification.
- Phase 4: Computation and experiments.
- Phase 5: Interpretation.
- Phase 6: Paper draft.
- Phase 7: Independent review.
- Phase 8: Final package.

The bar is national-first-prize or MCM/ICM O-prize level: multiple model routes, evidence-backed assumptions, reproducible computation, sensitivity and robustness checks, polished paper, independent critic review, and complete submission package.

## User Install And Update

For end users, prefer the mature `skills` CLI installer:

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --agent claude-code --copy --yes
```

Update installed Mathodology skills with:

```bash
npx -y skills@latest update -g -y mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
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
