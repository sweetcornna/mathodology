---
name: mathodology-whole-project
description: Use when running, backing up, transferring, restoring, archiving, or installing (project-level or global) the Mathodology skills-only repository and its award workflows.
---

# Mathodology Whole Project

## Purpose

This is the top-level orchestration skill for the current Mathodology GitHub
tree: running the award workflow, backing up, transferring, restoring, and
installing the skills globally.

The repository is intentionally skills-only. It preserves Mathodology as an
AI-coding knowledge pack, not as a runnable app checkout.

For repository maintenance, boundary and whitelist checks, and deciding whether
a change belongs on this branch, load `mathodology-project-orientation`.

## Current Shape

The retained repository surface is:

- `.claude/skills/**`: project skills and Codex-style metadata.
- `.claude/agents/**`: Claude Code project subagents for award-level modeling workflows.
- `.claude/workflows/**`: Claude Code workflow templates.
- `AGENTS.md`: tool-neutral entrypoint.
- `README.md` (Chinese-first) and `README_en.md` (English): public project overview.
- `docs/SKILLS*.md`, `docs/INSTALL*.md`, `docs/WORKFLOWS*.md`, and `docs/BACKUP.md`: skill, install, workflow, and backup documentation.
- `LICENSE` and `.gitignore`.

Do not expect app source, CI workflows, deployment config, generated contracts,
datasets, package manifests, lockfiles, or installers in this branch. For the
full retained-file and deletion policy, load `mathodology-project-orientation`.

## Skill Set

Load these skills as needed:

- `mathodology-project-orientation`: current layout, retained files, deletion policy, and repository boundary checks.
- `mathodology-award-gates`: award-run gate schemas (handoff/gate/scorecard/decision_memo), the severity ladder, judge-panel thresholds, iteration budgets, run layout, the blind seat protocol, and the figure/PDF QA scripts.
- `mathodology-agent-pipeline`: archived knowledge about the former Python agent pipeline and the reusable phase workflow pattern.
- `mathodology-gateway-api`: archived knowledge about the former Rust gateway and API.
- `mathodology-web-ui`: archived knowledge about the former Vue web UI.
- `mathodology-dev-test-release`: skills validation (`validate_repo.py`) and archived dev, test, deploy, packaging, and release guidance.
- `mathodology-skill-authoring`: adding or updating project skills and metadata.

## Runtime Modes

Choose the orchestration mode from the agent environment:

- Claude Code project checkout: use `.claude/workflows/mathodology-award-submission.md` and dispatch the `.claude/agents/mathodology-*.md` subagents.
- Claude Code contest variants: when the contest is M3, HiMCM/MidMCM, IMMC/IM2C, leaderboard/data-science, operations/policy/business-case, or short-sprint style, also load `.claude/workflows/mathodology-contest-variants.md` and apply the matching adapter.
- Claude Code global skill install: load this skill and follow `docs/WORKFLOWS.md`; copy `.claude/agents/` and `.claude/workflows/` into the project if native project subagents are needed.
- Codex global skill install: run the workflow in multi-agents mode, dispatching independent agents for each phase, synthesizing their findings, then gating with a critic. In Phase 0, classify the contest type and apply the matching adapter from `docs/WORKFLOWS.md`. Treat the run as phase-sized and resumable; ask the user only for contest-critical details, then continue automatically when the gate passes.

Codex start prompt:

```text
Use $mathodology-whole-project. Run the Mathodology 9-phase award submission workflow in Codex multi-agents mode. Work phase by phase: dispatch independent agents for analysis, modeling, evidence, coding, critique, and writing where applicable; synthesize their output; require result-density maps, figure/table sufficiency gates, and rendered-PDF figure QA; run the phase gate; then continue automatically. Pause to ask the user only for contest-critical details that would change requirements, data access, model choice, compute budget, or final submission constraints. For ordinary ambiguity, make a conservative assumption, record it in the phase log, and keep going.
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

## Award Workflow And Contest Adapters

Use the shared phase model, adapters, and gate guarantees from their canonical
homes instead of restating them here:

- Phase model (Phases 0-8) and the contest-type adapter table: `docs/WORKFLOWS.md`.
- Claude Code default workflow, phase-agent-critic matrix, and prize-level gate guarantees: `.claude/workflows/mathodology-award-submission.md`.
- Claude Code contest variants (M3, HiMCM/MidMCM, IMMC/IM2C, leaderboard, operations/policy, short-sprint, graduate/华为杯, APMCM, MathorCup, and similar): `.claude/workflows/mathodology-contest-variants.md`.
- Runtime gate schemas, judge-panel protocol, iteration budgets, and figure/PDF QA scripts: `mathodology-award-gates`.

The bar is national-first-prize or MCM/ICM Outstanding: multiple model routes,
evidence-backed assumptions, reproducible computation, sensitivity and robustness
checks, a polished paper, independent critic review, and a complete submission
package. Treat `.claude/workflows/mathodology-award-submission.md` as the source
of truth for the detailed matrix and gate guarantees.

## User Install And Update

For end users, prefer the mature `skills` CLI installer. The recommended scope is project-level: run from the target project root, deploy everything (skills, Claude Code subagents, workflow templates) into that folder only, and leave other projects untouched:

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code && curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 'mathodology-main/.claude/agents' 'mathodology-main/.claude/workflows' && { [ -f .mcp.json ] || curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.mcp.json -o .mcp.json; }
```

Update a project-level install from the project root with one command. It refreshes the skills, the subagents, the workflow templates, and the `search` MCP server package, and writes `.mcp.json` only when the project has none — an existing MCP config is never overwritten. The MCP refresh clause is non-fatal, so a machine without `uv` still gets everything else:

```bash
npx -y skills@latest update --project --yes && curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 'mathodology-main/.claude/agents' 'mathodology-main/.claude/workflows' && { [ -f .mcp.json ] || curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.mcp.json -o .mcp.json; } && { uvx free-search-mcp@latest --help >/dev/null 2>&1 || echo 'note: search MCP server not refreshed (is uv installed?)'; }
```

For a machine-wide install across all projects, use the global variant:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

Update globally installed Mathodology skills with:

```bash
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-award-gates mathodology-dev-test-release mathodology-evidence-search mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

Use `npx -y skills@latest --help` for CLI help. Do not use `skills add <repo> --help` as a help command because current CLI versions may treat that form as an install command.

See `docs/INSTALL.md` for target-specific variants, verification, and removal.

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
