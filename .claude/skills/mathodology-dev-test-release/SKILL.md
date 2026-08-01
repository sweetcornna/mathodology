---
name: mathodology-dev-test-release
description: Use when validating the Mathodology skills-only repository or preserving archived knowledge about the former development, testing, deployment, packaging, and release workflows.
---

# Mathodology Dev Test Release Archive

## Scope

This branch is skills-only. Its active validation checks are skill, metadata, link, backup, and tracked-file whitelist checks.

The former application build, CI, Docker, native service, packaging, installer, and release files are not present on this branch. Treat those workflows as archived knowledge unless recovered from Git history.

## Active Workflow Validation

For award-level modeling workflows, this skill owns final gates rather than application builds:

- phase log exists and covers Phases 0-8
- every prompt requirement maps to a paper section or package file
- every reported number maps to code, data, derivation, or documented manual calculation
- every phase has specialist handoffs, lead synthesis, and an independent critic gate
- all blocker and high-severity critic findings are fixed before final packaging
- model selection considers at least three routes with rejection reasons for alternatives
- sensitivity or robustness evidence exists for important assumptions and key results
- final paper, editable source if required, code, data notes, figures, tables, README, AI-use statement, and checklist are present
- no local caches, secrets, raw scratch files, or unrelated artifacts are in the final package

Codex should run these gates with a dedicated critic or packaging agent.

Claude Code should run `mathodology-submission-packager` and then `mathodology-critic`.

## Active Validation

Shared repository validation lives in ONE place: `scripts/validate_repo.py`
(pure standard library, no PyYAML). Do not re-inline these checks as heredocs in
docs or other skills; add or change a gate in the script.

Run every maintenance gate from the repository root:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py all
```

Run one gate by naming it: `skills`, `metadata`, `links`, `whitelist`, `agents`,
`sync`, `evidence`, `updater`, or `selftest`. The script prints per-check `PASS`/`FAIL` lines and exits
non-zero on any failure.

- `skills` / `metadata`: every `.claude/skills/*/SKILL.md` frontmatter (name ==
  dir, lowercase-hyphen, `Use when` description) and every `agents/openai.yaml`
  default prompt mentioning `$<dirname>`.
- `links`: relative markdown links, inline `.claude/...` paths, and
  `mathodology-<x>` name references in tracked docs resolve.
- `whitelist`: only skills-repository files are tracked.
- `agents`: every `.claude/agents/*.md` frontmatter (name == stem, description,
  tools, and any `model` in opus/sonnet/haiku/inherit).
- `sync`: each en/zh doc twin agrees on heading and code-block counts, and
  command-significant code is identical.
- `evidence`: the project search MCP enables staged downloads; the evidence agent
  loads both discovery channels and the evidence skill; skill, agent, and workflow
  retain the combined-mode contract; manual Claude/Codex commands enable download.
- `updater`: the transactional project updater is executable, exposes its required
  CLI and rollback contracts, and every public update surface uses one canonical
  bootstrap instead of the retired shell pipeline.
- `selftest`: proves each checker can both pass and fail on tempdir fixtures and
  runs the updater's offline drift, rollback, and installer-cleanup tests.

From a global skill install, run `scripts/validate_repo.py` from this skill's
directory instead of the repo-relative path.

## Backup Check

Create and verify a skills-only backup:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

Then check the printed backup directory:

```bash
shasum -a 256 -c SHA256SUMS
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(AGENTS\.md|\.claude/skills/)'
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(apps/|crates/|packages/|scripts/|config/|installer/|tests/|data/|\.github/)'
```

The last command should produce no matches.

## Archived Dev And Release Knowledge

The former project used a multi-language application stack with service builds, contract generation, tests, deployment files, and release packaging. Those files were removed from the current branch.

If the user needs to rebuild or audit those workflows, first recover the relevant historical tree in a separate branch or worktree. Do not treat old commands as valid gates in the skills-only checkout.
