---
name: mathodology-skill-authoring
description: Use when adding, updating, validating, or reviewing Mathodology project skills, SKILL.md files, or agents/openai.yaml metadata.
---

# Mathodology Skill Authoring

## Scope

This repository currently has one skill system: project skills under `.claude/skills/`.

Each skill directory contains:

```text
SKILL.md
agents/openai.yaml
```

No separate product runtime skill directory is present on this branch.

Claude Code orchestration assets are adjacent to skills:

```text
.claude/agents/<agent-name>.md
.claude/workflows/<workflow-name>.md
```

Codex orchestration belongs inside `SKILL.md`, `agents/openai.yaml`, and `docs/WORKFLOWS.md`.

## Frontmatter Rules

Every `SKILL.md` needs YAML frontmatter with:

```yaml
---
name: mathodology-example
description: Use when ...
---
```

Rules:

- `name` must match the directory name.
- `description` must start with `Use when`.
- Keep descriptions trigger-focused; do not summarize the whole workflow.
- Keep frontmatter concise.

## Body Rules

Skills should be reusable process guidance, not a record of one editing session.

For this skills-only branch:

- Be explicit when subsystem knowledge is historical.
- Do not link to current files that are no longer present.
- Do not list old build or test commands as active validation gates.
- Keep current-branch edits limited to skills, metadata, Claude Code agents/workflows, docs, and backup helper files.

## Adapter Rules

Claude Code adaptation:

- Put reusable project subagent definitions in `.claude/agents/`.
- Put repeatable phase workflow templates in `.claude/workflows/`.
- Keep each subagent role narrow and gate-driven.
- Mention which Mathodology skill the subagent should load.

Codex adaptation:

- Put startup prompts and multi-agents rules in `SKILL.md` and `docs/WORKFLOWS.md`.
- Keep `agents/openai.yaml` default prompts explicit enough to trigger the right skill.
- Phrase Codex instructions as phase tasks with synthesis and independent critic gates.

## Metadata

Each project skill should have `agents/openai.yaml` with:

```yaml
interface:
  display_name: "Readable Name"
  short_description: "Short UI label"
  default_prompt: "Use $skill-name ..."
```

The default prompt must mention the matching `$skill-name`.

## Validation

Run the shared validator from the repository root; it covers frontmatter,
metadata, links, whitelist, agents, and doc sync:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py all
```

Use a single subcommand (`skills`, `metadata`, `links`, `whitelist`, `agents`,
`sync`, `selftest`) while iterating.

Rules for validation logic and scripts:

- Shared validation logic lives ONLY in
  `.claude/skills/mathodology-dev-test-release/scripts/validate_repo.py`. Never
  re-inline these checks as heredocs in a SKILL.md, doc, or agent file; extend
  the script instead.
- A skill MAY ship a `scripts/` directory. Every shipped script must be
  executable, carry a `--self-test` (or `selftest` subcommand) that is run and
  passes before shipping, and declare its prerequisites with an actionable error
  when one is missing.
- Run-time gate contracts (the `handoff` / `gate` / `scorecard` /
  `decision_memo` schemas, judge thresholds, and QA scripts) belong to
  `mathodology-award-gates`. Reference that skill; do not invent new inline gate
  formats in individual skills or agents.

## Update Checklist

1. Pick the narrowest skill that owns the behavior.
2. Edit `SKILL.md`.
3. Update `agents/openai.yaml` if display text or default prompt should change.
4. Run validation.
5. Check that no non-skills files were added back to the repository.
