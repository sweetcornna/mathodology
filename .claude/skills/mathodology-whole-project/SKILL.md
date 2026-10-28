---
name: mathodology-whole-project
description: Use when starting a modeling task or installing, backing up or maintaining the skills pack.
---

# Mathodology Modeling Companion

Mathodology helps turn a problem into a justified model, reproducible results and
clear scientific communication. It is a skills pack with one executable part:
the [workbench](../mathodology-workbench/SKILL.md) records runs and checks that
results, figures and the paper agree, through a script and Claude Code hooks.
Use [modeling prompts](../mathodology-agent-pipeline/SKILL.md)
as a flexible guide. For figures use
[figure presets](../mathodology-figure-presets/SKILL.md), including its image2
availability question. For evidence use
[evidence search](../mathodology-evidence-search/SKILL.md).

## Start or resume a modeling task

Work in the user's chosen directory or an ignored `work/` directory in this
checkout. Produce only artifacts needed for the requested deliverable and keep
numerical results traceable: `mtd.py init` sets up a workspace whose hooks keep
results, figures and the paper consistent, and `mtd.py status` shows where an
existing one stands. Use specialists where they help and the host allows
it.

## Maintain and distribute

The maintained source is `.claude/skills/`. Claude Code roles and workflow prompts
are adjacent. Codex may use an installed `.agents/skills/` mirror. Back up this
project's mirror before updating its Mathodology entries. Do not modify unrelated
skills, project instructions, custom MCP settings or global configuration.

For installation in other projects, use the standard skills CLI; for a clean
repository checkout, use `git pull --ff-only`. Resolve local edits before updating;
do not reset them. Installation details are in the repository's docs/INSTALL.md.
A skills-only global install does not install project roles or MCP settings.

The optional [backup utility](scripts/create-source-backup.sh) saves skills,
references and repository docs, including local uncommitted source changes:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

It excludes the ignored Codex mirror, contest outputs and Git history. Back those
up separately when needed. Extract a backup into an empty directory and verify
its checksum before replacing an installation. No application build is required.
