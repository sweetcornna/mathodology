# Mathodology Skills Project

This document describes how the repository is structured as an AI coding skills project.

## Project Skills

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

- Claude Code: open the repository and use `.claude/skills/`.
- Codex-like tools: read `AGENTS.md`, then load the relevant skill.
- Full transfer or backup: start with `mathodology-whole-project`.
- New development work: start with `mathodology-project-orientation`, then load a subsystem skill.

## Runtime Skills Are Different

`docs/skills/` is not the project skill directory. It contains runtime skills consumed by the original Mathodology worker's Coder agent:

```text
docs/skills/chart_catalog/SKILL.md
docs/skills/evidence_mining/SKILL.md
docs/skills/matlab/SKILL.md -> ../../matlab.md
```

These runtime skills may use fields like `when_to_use`, `allowed-tools`, `arguments`, and `context` because they are parsed by `apps/agent-worker/src/agent_worker/skills/loader.py`.

Do not move runtime skills into `.claude/skills/` and do not move project skills into `docs/skills/`.

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
for d in sorted(p for p in root.iterdir() if p.is_dir()):
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

Validate runtime skill loading:

```bash
uv run pytest apps/agent-worker/tests/test_skill_registry.py -q
uv run pytest apps/agent-worker/tests/test_skill_tool.py -q
```

## Updating a Skill

1. Confirm whether the change belongs in `.claude/skills/` or `docs/skills/`.
2. Keep frontmatter concise and trigger-focused.
3. Keep `SKILL.md` scoped; link to existing source files instead of copying large code.
4. Update `agents/openai.yaml` when project skill display text changes.
5. Run validation before committing.

## GitHub Publishing

The GitHub project should present this repository as a skills package:

- README describes the skills project, not the old runnable app.
- `AGENTS.md` is the tool-neutral entrypoint.
- `.claude/skills/**` is committed.
- Runtime state under `.claude/worktrees/` remains ignored.
- Source backup archives stay outside the repository in `../math_agent_backups/`.
