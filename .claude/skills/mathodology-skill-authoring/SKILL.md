---
name: mathodology-skill-authoring
description: Use when adding, updating, validating, or reviewing Mathodology SKILL.md files for Claude Code, Codex-compatible Agent Skills, or the product's internal Coder runtime skills.
---

# Mathodology Skill Authoring

## Two Skill Audiences

Mathodology has two different skill systems:

1. Project AI coding skills in `.claude/skills/<name>/SKILL.md`.
   These help Claude Code, Codex-like agents, and other Agent Skills consumers work on this repository.
2. Product runtime skills in `docs/skills/<name>/SKILL.md`.
   These are loaded by Mathodology's own Python worker through `apps/agent-worker/src/agent_worker/skills/loader.py` and used by the Coder agent during mathematical modeling runs.

Do not move or merge the two systems. They have different audiences and frontmatter expectations.

## Project Skill Rules

Use this layout:

```text
.claude/skills/<skill-name>/
├── SKILL.md
└── agents/
    └── openai.yaml
```

Frontmatter should be minimal and Agent Skills compatible:

```yaml
---
name: skill-name
description: Use when the agent is doing a specific kind of Mathodology work.
---
```

Rules:

- Directory name and `name` must match.
- `name` uses lowercase letters, digits, and hyphens only.
- `description` should start with `Use when...` and list trigger conditions, not a full workflow summary.
- Keep `SKILL.md` under 500 lines.
- Put details in referenced files only when the skill would otherwise become large.
- Do not add README, changelog, or installation guide files inside a skill.
- If the skill should be visible in Codex-style UI, add `agents/openai.yaml`.

## OpenAI Metadata

Generate metadata with:

```bash
python /Users/cornna/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py \
  .claude/skills/<skill-name> \
  --interface display_name="Human Name" \
  --interface short_description="25 to 64 character UI summary" \
  --interface default_prompt="Use $skill-name to ..."
```

Check `agents/openai.yaml` after generation. Strings should be quoted, and `default_prompt` must explicitly mention `$skill-name`.

## Runtime Coder Skill Rules

Runtime skills live under `docs/skills/` and may use extra fields parsed by the worker:

```yaml
---
name: chart_catalog
description: Short runtime discovery description.
when_to_use:
  - "trigger text for the Coder agent"
allowed-tools:
  - run_python
context: inline
---
```

The loader accepts:

- `name`
- `description`
- `when_to_use`
- `allowed-tools` or `allowed_tools`
- `arguments`
- `context`

Runtime skill bodies are loaded through the `get_skill` tool in Coder turns. Keep descriptions short because discovery text enters the prompt before the body.

Current runtime skills:

- `docs/skills/chart_catalog/SKILL.md`
- `docs/skills/evidence_mining/SKILL.md`
- `docs/skills/matlab/SKILL.md`, a symlink to `docs/matlab.md`

The MATLAB symlink pattern is intentional: it exposes existing documentation without duplicating it.

## Validation

Project skill frontmatter:

```bash
python /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py .claude/skills/<skill-name>
```

Runtime skill loader tests:

```bash
uv run pytest apps/agent-worker/tests/test_skill_registry.py -q
uv run pytest apps/agent-worker/tests/test_skill_tool.py -q
```

Repository-wide skill search:

```bash
rg -n "name:|description:|when_to_use|allowed-tools|get_skill|docs/skills|\\.claude/skills" .claude/skills docs/skills docs/matlab.md apps/agent-worker/src/agent_worker/skills
```

## Update Checklist

Before finishing a skill change:

1. Confirm the skill belongs to the right audience: `.claude/skills` for coding agents, `docs/skills` for product runtime.
2. Confirm frontmatter parses as YAML.
3. Confirm `name` matches the directory or runtime registry name.
4. Confirm the description contains trigger terms an agent would search for.
5. Confirm `SKILL.md` references any bundled files with relative paths.
6. Run the focused validator or runtime loader tests.
