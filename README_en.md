# Mathodology Math Modeling Contest Skills

[简体中文](./README.md) · **English**

![license](https://img.shields.io/badge/license-MIT-blue)
![format](https://img.shields.io/badge/format-Agent%20Skills-black)
![tools](https://img.shields.io/badge/tools-Claude%20Code%20%7C%20Codex-blue)
![contests](https://img.shields.io/badge/contests-MCM%2FICM%20%7C%20CUMCM%20%7C%20Huashu%20Cup-orange)

Mathodology is a set of **Agent Skills purpose-built for math modeling contests**, targeting Claude Code, Codex, and other Agent Skills-compatible AI coding tools. It distills an award-level math modeling methodology — problem decomposition, model building, reproducible experiments, award-grade paper writing, and submission packaging — into loadable project skills, subagents, and workflow templates.

Evidence discovery combines built-in `WebSearch` with the bundled `search` MCP server — **[free-search-mcp](https://github.com/sweetcornna/free-search-mcp)** — by default, then reconciles and verifies the resulting sources. The server adds keyless multi-engine search, page and PDF reading, publisher-metadata extraction, category routing to arXiv/OpenAlex/Crossref/PubMed/Zenodo, and staged downloads. The repository ships `.mcp.json`, and the full Claude Code project install writes it into a target project that has no MCP config, so cloning or that project install enables the combined workflow without per-user setup.

Supported contest types:

- **MCM/ICM**: targeting Outstanding/Finalist-level output
- **CUMCM (China Undergraduate Mathematical Contest in Modeling)**: targeting national-first-prize-level output
- **Huashu Cup**, **M3**, **HiMCM/MidMCM**, **IMMC/IM2C**
- Leaderboard/data-science, operations/policy/business-case, and short-sprint contests

This repository is a skills-only branch: it intentionally does not ship the former runnable application source. It contains only project skills, skill metadata, lightweight documentation, a backup helper, and the license.

## What This Repository Contains

- Claude Code project skills in `.claude/skills/<skill-name>/SKILL.md`
- 9 Claude Code project subagents in `.claude/agents/` (modeler, coder, paper editor, critic, blind award judge, and other specialist roles)
- Claude Code contest workflow templates in `.claude/workflows/`
- Codex-style metadata in each skill's `agents/openai.yaml`
- A root `AGENTS.md` entrypoint for tools that do not auto-discover project skills
- A root `.mcp.json` that registers the keyless `search` MCP server, so evidence search and citation verification work in a fresh clone with no setup
- Skills and workflow documentation under `docs/`
- A skills-only backup script under `mathodology-whole-project`

No application source, CI workflows, deployment files, generated contracts, package lockfiles, datasets, build outputs, or installer assets are kept on this branch.

## One-Command Install And Update

Recommended: run the transactional updater from the target project root to deploy everything (9 skills + 9 Claude Code subagents + 2 workflow templates + the project-level `search` MCP config) into that folder only, without affecting any other project. It installs a missing MCP config or migrates only an identifiable legacy canonical config; custom configurations and intentional download opt-outs remain unchanged:

```bash
curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.claude/skills/mathodology-whole-project/scripts/update-project.py -o /tmp/mathodology-update.py && test -s /tmp/mathodology-update.py && python3 /tmp/mathodology-update.py --project .
```

Run the same command from the project root for later updates. The updater resolves one immutable commit, reconciles all 9 skills, mirrors Mathodology subagents/workflows, conservatively migrates identifiable legacy MCP config, and restores managed files on failure. Missing `uvx` only skips the optional server-package refresh:

```bash
curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.claude/skills/mathodology-whole-project/scripts/update-project.py -o /tmp/mathodology-update.py && test -s /tmp/mathodology-update.py && python3 /tmp/mathodology-update.py --project .
```

Append `--check` to diagnose without writing or `--ref v0.12.0` to install a reproducible release payload. Existing custom search configurations and intentional download opt-outs are preserved.

Alternative: install all Mathodology skills globally for Codex and Claude Code (affects every project on the machine):

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

Update globally installed Mathodology skills:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

These commands use the open `skills` CLI from `vercel-labs/skills`, which installs Agent Skills from GitHub into the right agent directories.

Restart Codex or Claude Code after installation or update so the new skills, subagents, and workflow templates are discovered. Use `npx -y skills@latest --help` for CLI help; avoid `skills add <repo> --help`, because current CLI versions may treat that as an install command.

See [docs/INSTALL.md](docs/INSTALL.md) for target-specific commands and verification.

## Codex And Claude Code Modes

Mathodology ships separate contest orchestration guidance for Codex and Claude Code:

- Claude Code: use `.claude/workflows/mathodology-award-submission.md` with project subagents in `.claude/agents/`.
- Claude Code contest variants: use `.claude/workflows/mathodology-contest-variants.md` for M3, HiMCM/MidMCM, IMMC/IM2C, leaderboard/data-science, operations/policy/business-case, and short-sprint contests.
- Codex: load `mathodology-whole-project` and run the 9-phase workflow in multi-agents mode.

Both modes target national-first-prize or MCM/ICM O-prize level outputs: model alternatives, evidence-backed assumptions, reproducible experiments, polished paper, and a complete submission package. The workflow adapters tune those gates for paper-first, code-first, sprint, school-age, and policy/business-case contests.

See [docs/WORKFLOWS.md](docs/WORKFLOWS.md) for the full phase model.

## Award-Level Quality Gates

Award-level quality control is implemented as executable, bounded machinery, all owned by the `mathodology-award-gates` skill:

- **Independent three-seat blind judge panel**: Phase 7 dispatches 3 `mathodology-award-judge` seats in parallel with no shared context (flagship-general / innovation-and-decision-usefulness / correctness-and-reproducibility only); each scores from only the rendered PDF and artifact manifest, and the lead aggregates against numeric thresholds (Outstanding/national-first ≥85, floor 70). Any seat below the target tier triggers a targeted improvement loop.
- **Bounded iteration budgets**: at most 2 fix loops per phase gate, 2 re-score rounds at Phase 7, and 8 loops across the whole run; on exhaustion the lead does not silently continue but emits a structured `decision_memo` for the user.
- **Structured YAML handoffs**: specialist handoffs, critic gates, and judge scorecards are YAML blocks with fixed fields, validated by the shipped `lint_run.py`, so nothing slips through as free text.
- **Shipped figure/PDF QA gates**: `figqa.py` (bbox-collision hard gate) and `pdf_qa.sh` (rendered-PDF page count, duplicate captions, anonymity check) ship with the skill and are executed, not reimplemented per run.

## Skill Index

| Skill | Use When |
|---|---|
| [`mathodology-whole-project`](.claude/skills/mathodology-whole-project/SKILL.md) | Backing up, transferring, restoring, orienting, or running Codex/Claude Code contest workflow orchestration |
| [`mathodology-project-orientation`](.claude/skills/mathodology-project-orientation/SKILL.md) | Starting work in this skills-only checkout or checking repository boundaries |
| [`mathodology-award-gates`](.claude/skills/mathodology-award-gates/SKILL.md) | Running award-workflow phase gates, judge panels, structured handoffs, figure QA, or rendered-PDF QA during a contest run |
| [`mathodology-evidence-search`](.claude/skills/mathodology-evidence-search/SKILL.md) | Searching literature, datasets, benchmarks, or domain constants and verifying citations (combined built-in and search MCP discovery, source reconciliation, category routing, reproducible downloads, and explicit degradation) |
| [`mathodology-agent-pipeline`](.claude/skills/mathodology-agent-pipeline/SKILL.md) | Orchestrating the nine-phase award workflow (phase responsibilities, specialist roster, prize-level gates), plus archived agent-pipeline knowledge |
| [`mathodology-gateway-api`](.claude/skills/mathodology-gateway-api/SKILL.md) | Export/packaging/API reasoning for workflows, plus archived gateway and API knowledge |
| [`mathodology-web-ui`](.claude/skills/mathodology-web-ui/SKILL.md) | Figure/table presentation reasoning for workflows, plus archived web UI knowledge |
| [`mathodology-dev-test-release`](.claude/skills/mathodology-dev-test-release/SKILL.md) | Validating the skills repository or preserving archived dev, test, and release guidance |
| [`mathodology-skill-authoring`](.claude/skills/mathodology-skill-authoring/SKILL.md) | Adding, updating, validating, or reviewing project skills |

## Quick Start

Clone the repository:

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

For Claude Code, open this repository and load skills from:

```text
.claude/skills/
```

For Codex or other AI coding tools, start from:

```text
AGENTS.md
```

Then load `mathodology-whole-project` for full-project context, or load the most specific skill for the task. Once you have a contest problem, run the phase workflow from [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

## Backup and Transfer

Create a skills-only backup:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

The backup is written outside the repository by default:

```text
../mathodology_skills_backups/<timestamp>/mathodology-skills-<timestamp>.tar.gz
```

The archive uses a skills whitelist, so it includes only the retained skills repository files. It excludes `.git/`, secrets, build outputs, runtime state, and any old application directories that may still exist locally.

See [docs/BACKUP.md](docs/BACKUP.md) for restore details.

## Validation

All mechanical repository validation lives in one script, `validate_repo.py` (pure standard library, no PyYAML), shipped inside the `mathodology-dev-test-release` skill. Do not re-inline these checks as heredocs in docs or other skills.

Run every maintenance gate from the repository root:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py all
```

Run one gate by naming it — `skills`, `metadata`, `links`, `whitelist`, `agents`, `sync`, `evidence`, `updater`, or `selftest`:

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py sync
```

The `all` run covers skill and agent frontmatter, `agents/openai.yaml` metadata, markdown link and `.claude/...` path resolution, the tracked-file whitelist, en/zh doc-twin sync, the dual-source evidence/download contract, and the canonical transactional updater contract. The scripts shipped in `mathodology-award-gates` each carry a `--self-test`; `validate_repo.py selftest` also runs the updater's offline migration and rollback fixtures.

## Repository Policy

Keep this branch focused on math modeling contest skills. Do not add back app source trees, generated clients, CI workflows, Docker files, installers, datasets, or build outputs unless the repository strategy changes explicitly.

Historical application implementation can be recovered from Git history if needed; it is not part of the current GitHub tree.

## License

MIT. See [LICENSE](LICENSE).
