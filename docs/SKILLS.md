# Mathodology Skills Project

This repository is the skills-only GitHub tree for Mathodology. It is not a runnable application checkout.

## Retained Layout

Project skills live under `.claude/skills/`:

```text
.claude/skills/
├── mathodology-whole-project/
├── mathodology-project-orientation/
├── mathodology-award-gates/
│   └── scripts/                 # figqa.py, pdf_qa.sh, make_contact_sheet.py, lint_run.py
├── mathodology-evidence-search/
├── mathodology-agent-pipeline/
├── mathodology-gateway-api/
├── mathodology-web-ui/
├── mathodology-dev-test-release/
│   └── scripts/                 # validate_repo.py
└── mathodology-skill-authoring/
```

Each skill has:

```text
SKILL.md
agents/openai.yaml
```

`SKILL.md` is the agent-facing instruction body. `agents/openai.yaml` is metadata for Codex-style interfaces. Some skills also ship a `scripts/` directory with executable gates: `mathodology-award-gates` carries the figure/PDF QA and run-block linting scripts, and `mathodology-dev-test-release` carries the repository validator. These scripts run from a cloned checkout or a global skill install.

Claude Code project orchestration assets live under:

```text
.claude/agents/
.claude/workflows/
```

These files are for cloned Claude Code project usage. Installed global skills still carry the workflow instructions inside `SKILL.md`.

Current workflow templates:

- `.claude/workflows/mathodology-award-submission.md`: default award-level 9-phase modeling workflow.
- `.claude/workflows/mathodology-contest-variants.md`: adapters for M3, HiMCM/MidMCM, IMMC/IM2C, leaderboard/data-science, operations/policy/business-case, and short-sprint contests.

## Entry Points

- Claude Code: open the repository and load `.claude/skills/`.
- Codex-like tools: read `AGENTS.md`, then load the relevant skill.
- Award-level workflow orchestration: use `docs/WORKFLOWS.md`.
- Contest-type workflow variants: use `docs/WORKFLOWS.md` and `.claude/workflows/mathodology-contest-variants.md`.
- One-command user install: use `docs/INSTALL.md`.
- Full transfer or backup: start with `mathodology-whole-project`.
- Repository cleanup or policy checks: start with `mathodology-project-orientation`.
- Skill edits: start with `mathodology-skill-authoring`.
- External evidence, literature, datasets, or citation verification: start with `mathodology-evidence-search`. It combines built-in `WebSearch` with the project `search` MCP server (free-search-mcp) by default, reconciles their sources, and records any single-source degradation explicitly. The repository's `.mcp.json` registers the server and enables staged downloads, so a clone needs no setup — see `docs/INSTALL.md`.

## What Is Not Present

The old application tree was removed from this branch. Do not expect current files for the former gateway, worker, web UI, generated contracts, runtime skills, deployment, CI, datasets, or installers.

The subsystem skills now preserve archived design knowledge. They should not tell agents to run old build commands or edit missing source paths.

## Validation

All mechanical repository validation lives in one script, `validate_repo.py`, shipped inside the `mathodology-dev-test-release` skill (pure standard library, no PyYAML). Do not re-inline these checks as heredocs in docs or other skills; add or change a gate in the script.

Run every maintenance gate from the repository root:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py all
```

Run one gate by naming it — `skills`, `metadata`, `links`, `whitelist`, `agents`, `sync`, `evidence`, `updater`, or `selftest`:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py sync
```

The `all` run covers skill and agent frontmatter, `agents/openai.yaml` metadata, markdown link and `.claude/...` path resolution, the tracked-file whitelist, en/zh doc-twin sync (heading and code-block counts, with command-significant code identical), the dual-source evidence/download configuration contract, and the canonical transactional updater/distribution contract. `selftest` also runs the updater's offline migration and rollback fixtures. From a global skill install, run `scripts/validate_repo.py` from the skill's directory instead of the repo-relative path.

## Updating a Skill

1. Keep frontmatter concise and trigger-focused.
2. Keep `SKILL.md` scoped to reusable guidance, not a narrative changelog.
3. Use archived subsystem details only as knowledge; do not link to missing current files.
4. Update `agents/openai.yaml` when display text or default prompts should change.
5. Keep Codex orchestration in skill text and Claude Code orchestration in `.claude/agents/`, `.claude/workflows/`, and `docs/WORKFLOWS.md`.
6. Run validation before committing.

## GitHub Publishing

The GitHub project should present this repository as a skills package:

- README describes the skills-only project.
- `AGENTS.md` is the tool-neutral entrypoint.
- `.claude/skills/**` is committed.
- `.claude/agents/**` and `.claude/workflows/**` are committed as Claude Code project orchestration assets.
- `.mcp.json` is committed so a clone gets the keyless `search` MCP server without setup. It carries no secrets and no local paths.
- `.claude/worktrees/` and local runtime state remain ignored.
- Skills backup archives stay outside the repository in `../mathodology_skills_backups/`.
