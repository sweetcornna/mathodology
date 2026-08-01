---
name: mathodology-project-orientation
description: Use when maintaining or checking boundaries of the Mathodology skills repository itself, or deciding whether a change belongs on this branch.
---

# Mathodology Project Orientation

## Repository Contract

This branch is a skills-only GitHub tree. Treat it as an AI-coding knowledge pack, not as the original runnable Mathodology application.

Current work should normally edit only:

- any file under `.claude/skills/<skill-name>/` — its `SKILL.md`,
  `agents/openai.yaml`, and a `scripts/` directory when the skill ships one
  (e.g. `.claude/skills/mathodology-award-gates/**` and
  `.claude/skills/mathodology-dev-test-release/scripts/validate_repo.py`)
- `.claude/agents/<agent-name>.md` (including `.claude/agents/mathodology-award-judge.md`)
- `.claude/workflows/<workflow-name>.md`
- `.claude/skills/mathodology-whole-project/scripts/create-source-backup.sh`
- `.claude/skills/mathodology-whole-project/scripts/update-project.py`
- `AGENTS.md`
- `README.md`
- `README_en.md`
- `docs/SKILLS.md`
- `docs/SKILLS_zh.md`
- `docs/INSTALL.md`
- `docs/INSTALL_zh.md`
- `docs/WORKFLOWS.md`
- `docs/WORKFLOWS_zh.md`
- `docs/BACKUP.md`
- `docs/BACKUP_zh.md`
- `.gitignore`
- `.mcp.json`

`.mcp.json` is a deliberate exception to the "no project config" rule: it registers the
keyless `search` MCP server (`uvx free-search-mcp`) that `mathodology-evidence-search`
depends on, so a fresh clone has working evidence search with no per-user setup. It must
stay a client-configuration file — no secrets, no API keys, no local absolute paths. A user
who wants a different server (a local checkout, a keyed engine set) overrides it at local
scope, which takes precedence over the project file.

`LICENSE` is retained but should not change unless the license changes.

## What Is Absent

The current GitHub tree should not contain application source, generated clients, CI, deployment, package-manager, installer, data, or test trees. `.mcp.json` is the one configuration file that is present, and it is whitelisted for the reason given above.

If a task requires historical implementation detail, use Git history or another branch in a separate worktree. Do not add those files back to this branch as part of ordinary skills maintenance.

## Boundary Check

Before publishing cleanup or skill maintenance, verify tracked files stay inside
the skills-repository whitelist:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py whitelist
```

Run `validate_repo.py all` for the full set of maintenance gates (skills,
metadata, links, whitelist, agents, sync, evidence, updater). The whitelist logic lives only in
that script; do not re-inline it here.

## Text Check

Search for stale current-path claims before committing (requires ripgrep; the
`grep -E` fallback is shown second):

```bash
rg -n "apps/|crates/|packages/|docs/skills|Dockerfile|docker-compose|just |cargo|pnpm|uv run|\.github|installer" README.md README_en.md AGENTS.md docs .claude/skills
grep -REn "apps/|crates/|packages/|docs/skills|Dockerfile|docker-compose|just |cargo|pnpm|uv run|\.github|installer" README.md README_en.md AGENTS.md docs .claude/skills
```

Hits are acceptable only when they describe removed historical material or an absence check. They must not instruct agents to edit or run missing current files. The current skills, scripts, and award-gate content do not match this pattern, so any hit is a stale claim to review.

## Choosing Skills

- Whole repository backup, transfer, or orchestration: use `mathodology-whole-project`.
- Skill text or metadata changes: use `mathodology-skill-authoring`.
- Award-level Codex or Claude Code phase workflow: use `docs/WORKFLOWS.md`.
- Award-run gate schemas (handoff/gate/scorecard/decision_memo), judge-panel protocol, and figure/PDF QA scripts: use `mathodology-award-gates`.
- Former subsystem knowledge: use the matching archived subsystem skill.
- Validation and publishing checks: use `mathodology-dev-test-release`.
