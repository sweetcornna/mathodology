---
name: mathodology-project-orientation
description: Use when starting work in the Mathodology skills-only repository, checking retained files, or deciding whether a change belongs on this branch.
---

# Mathodology Project Orientation

## Repository Contract

This branch is a skills-only GitHub tree. Treat it as an AI-coding knowledge pack, not as the original runnable Mathodology application.

Current work should normally edit only:

- `.claude/skills/<skill-name>/SKILL.md`
- `.claude/skills/<skill-name>/agents/openai.yaml`
- `.claude/agents/<agent-name>.md`
- `.claude/workflows/<workflow-name>.md`
- `.claude/skills/mathodology-whole-project/scripts/create-source-backup.sh`
- `AGENTS.md`
- `README.md`
- `README_zh.md`
- `docs/SKILLS.md`
- `docs/SKILLS_zh.md`
- `docs/INSTALL.md`
- `docs/INSTALL_zh.md`
- `docs/WORKFLOWS.md`
- `docs/WORKFLOWS_zh.md`
- `docs/BACKUP.md`
- `.gitignore`

`LICENSE` is retained but should not change unless the license changes.

## What Is Absent

The current GitHub tree should not contain application source, generated clients, CI, deployment, package-manager, installer, data, or test trees.

If a task requires historical implementation detail, use Git history or another branch in a separate worktree. Do not add those files back to this branch as part of ordinary skills maintenance.

## Boundary Check

Before publishing cleanup or skill maintenance, verify tracked files:

```bash
python3 - <<'PY'
import subprocess
import sys

keep_exact = {
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "README_zh.md",
    "LICENSE",
    "docs/SKILLS.md",
    "docs/SKILLS_zh.md",
    "docs/INSTALL.md",
    "docs/INSTALL_zh.md",
    "docs/WORKFLOWS.md",
    "docs/WORKFLOWS_zh.md",
    "docs/BACKUP.md",
}
files = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
bad = [
    f for f in files
    if f not in keep_exact
    and not f.startswith(".claude/skills/")
    and not f.startswith(".claude/agents/")
    and not f.startswith(".claude/workflows/")
]
if bad:
    print("\n".join(bad))
    sys.exit(1)
print(f"tracked whitelist ok: {len(files)} files")
PY
```

## Text Check

Search for stale current-path claims before committing:

```bash
rg -n "apps/|crates/|packages/|docs/skills|Dockerfile|docker-compose|just |cargo|pnpm|uv run|\\.github|installer" README.md README_zh.md AGENTS.md docs .claude/skills
```

Hits are acceptable only when they describe removed historical material or an absence check. They must not instruct agents to edit or run missing current files.

## Choosing Skills

- Whole repository backup, transfer, or orchestration: use `mathodology-whole-project`.
- Skill text or metadata changes: use `mathodology-skill-authoring`.
- Award-level Codex or Claude Code phase workflow: use `docs/WORKFLOWS.md`.
- Former subsystem knowledge: use the matching archived subsystem skill.
- Validation and publishing checks: use `mathodology-dev-test-release`.
