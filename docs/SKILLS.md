# Mathodology Skills Project

This repository is the skills-only GitHub tree for Mathodology. It is not a runnable application checkout.

## Retained Layout

Project skills live under `.claude/skills/`:

```text
.claude/skills/
├── mathodology-whole-project/
├── mathodology-project-orientation/
├── mathodology-agent-pipeline/
├── mathodology-gateway-api/
├── mathodology-web-ui/
├── mathodology-dev-test-release/
└── mathodology-skill-authoring/
```

Each skill has:

```text
SKILL.md
agents/openai.yaml
```

`SKILL.md` is the agent-facing instruction body. `agents/openai.yaml` is metadata for Codex-style interfaces.

## Entry Points

- Claude Code: open the repository and load `.claude/skills/`.
- Codex-like tools: read `AGENTS.md`, then load the relevant skill.
- One-command user install: use `docs/INSTALL.md`.
- Full transfer or backup: start with `mathodology-whole-project`.
- Repository cleanup or policy checks: start with `mathodology-project-orientation`.
- Skill edits: start with `mathodology-skill-authoring`.

## What Is Not Present

The old application tree was removed from this branch. Do not expect current files for the former gateway, worker, web UI, generated contracts, runtime skills, deployment, CI, datasets, or installers.

The subsystem skills now preserve archived design knowledge. They should not tell agents to run old build commands or edit missing source paths.

## Validation

Validate project skill frontmatter:

```bash
for d in .claude/skills/*; do
  python3 /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"
done
```

Validate project skill metadata:

```bash
python3 - <<'PY'
from pathlib import Path
import re
import yaml

root = Path(".claude/skills")
skills = sorted(p for p in root.iterdir() if p.is_dir())
assert skills, "no skills found"
for d in skills:
    text = (d / "SKILL.md").read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    assert match, d
    frontmatter = yaml.safe_load(match.group(1))
    assert frontmatter["name"] == d.name, d
    assert frontmatter["description"].startswith("Use when"), d
    metadata = yaml.safe_load((d / "agents" / "openai.yaml").read_text(encoding="utf-8"))
    assert f"${d.name}" in metadata["interface"]["default_prompt"], d
print("skills ok")
PY
```

Validate that only skills-repository files are tracked:

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
    "docs/BACKUP.md",
}
files = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
bad = [f for f in files if f not in keep_exact and not f.startswith(".claude/skills/")]
if bad:
    print("\n".join(bad))
    sys.exit(1)
print(f"tracked whitelist ok: {len(files)} files")
PY
```

## Updating a Skill

1. Keep frontmatter concise and trigger-focused.
2. Keep `SKILL.md` scoped to reusable guidance, not a narrative changelog.
3. Use archived subsystem details only as knowledge; do not link to missing current files.
4. Update `agents/openai.yaml` when display text or default prompts should change.
5. Run validation before committing.

## GitHub Publishing

The GitHub project should present this repository as a skills package:

- README describes the skills-only project.
- `AGENTS.md` is the tool-neutral entrypoint.
- `.claude/skills/**` is committed.
- `.claude/worktrees/` and local runtime state remain ignored.
- Skills backup archives stay outside the repository in `../mathodology_skills_backups/`.
