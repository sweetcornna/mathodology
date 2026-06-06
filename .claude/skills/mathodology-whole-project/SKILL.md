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
- Claude Code contest variants: when the contest is M3, HiMCM/MidMCM, IMMC/IM2C, leaderboard/data-science, operations/policy/business-case, or short-sprint style, also load `.claude/workflows/mathodology-contest-variants.md` and apply the matching adapter.
- Claude Code global skill install: load this skill and follow `docs/WORKFLOWS.md`; copy `.claude/agents/` and `.claude/workflows/` into the project if native project subagents are needed.
- Codex global skill install: run the workflow in multi-agents mode, dispatching independent agents for each phase, synthesizing their findings, then gating with a critic. In Phase 0, classify the contest type and apply the matching adapter from `docs/WORKFLOWS.md`. Treat the run as phase-sized and resumable; ask the user only for contest-critical details, then continue automatically when the gate passes.

Codex start prompt:

```text
Use $mathodology-whole-project. Run the Mathodology 9-phase award submission workflow in Codex multi-agents mode. Work phase by phase: dispatch independent agents for analysis, modeling, evidence, coding, critique, and writing where applicable; synthesize their output; run the phase gate; then continue automatically. Pause to ask the user only for contest-critical details that would change requirements, data access, model choice, compute budget, or final submission constraints. For ordinary ambiguity, make a conservative assumption, record it in the phase log, and keep going.
```

## Codex Resumable Execution

Codex may need multiple responses to finish the full award workflow. The lead agent should keep the run moving without asking the user to approve routine steps.

Ask the user only when the answer would materially change:

- official contest requirements, deliverable format, page limits, AI-use rules, or deadline
- access to private files, datasets, paid sources, credentials, or external services
- choice between plausible model routes with different scoring or feasibility risks
- compute, runtime, language, tool, or reproducibility constraints
- final claim, recommendation, or submission package decision that cannot be safely inferred

For all other ambiguity, choose the safest defensible default, mark it as an assumption, and continue to the next task or phase gate.

When a user confirmation is required, ask a compact question that includes:

- current phase and blocking decision
- why the detail matters
- recommended default
- effect of the likely answers

After the user answers, resume from the current phase log. Do not restart completed phases unless the new answer invalidates them.

If a response boundary is reached before Phase 8, finish the current synthesis or gate, then end with this continuation state:

```text
Continuation state:
- Current phase:
- Completed gates:
- Blocking user question, if any:
- Assumptions to carry forward:
- Artifact paths:
- Next action:
- Suggested prompt: Continue from the current continuation state and run the next Mathodology phase gate.
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

## Contest-Type Adapters

Use the adapter table in `docs/WORKFLOWS.md` for non-default contest types:

- MCM/ICM O-prize.
- CUMCM national-first-prize.
- HiMCM/MidMCM.
- IMMC/IM2C.
- M3 Challenge.
- Data-science leaderboard contests.
- Operations, policy, or business-case contests.
- Short sprint or campus invitational contests.

For Claude Code, `.claude/workflows/mathodology-contest-variants.md` contains the repeatable adapter workflow. For Codex, Phase 0 must record the selected `contest_type`, official rules source, deadline, language, page/file limits, identity rules, code policy, AI-use policy, and adapter-specific critic gates.

## Prize-Level Workflow Guarantees

Codex and Claude Code runs must preserve these guarantees:

- Every phase has specialist production, lead synthesis, and independent critic review.
- Every specialist response ends with an `Agent handoff` block listing artifacts, decisions, assumptions, evidence, commands, weaknesses, questions, and requested critic focus.
- Every critic gate assigns `blocker`, `high`, `medium`, or `low` severity.
- No `blocker` or `high` issue may remain before advancing.
- Every reported number maps to code, data, derivation, citation, or documented manual calculation.
- Every major assumption maps to evidence, derivation, or sensitivity analysis.
- At least three model routes are considered before the final route is selected.
- The final paper is checked against prompt coverage, math validity, evidence, reproducibility, writing, formatting, originality, and submission compliance.

Use `docs/WORKFLOWS.md` as the source of truth for the detailed phase-agent-critic matrix.

## User Install And Update

For end users, prefer the mature `skills` CLI installer:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

Update installed Mathodology skills with:

```bash
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

If the user relies on a cloned checkout for Claude Code project subagents and workflow templates, use the full one-command updater from the checkout:

```bash
git pull --ff-only && npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

Use `npx -y skills@latest --help` for CLI help. Do not use `skills add <repo> --help` as a help command because current CLI versions may install into the current project.

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
