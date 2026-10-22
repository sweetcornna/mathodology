# Mathodology Agent Guide

Mathodology is a skills pack for mathematical modeling contests: prompts that
support mathematical judgment, reproducible computation and clear scientific
communication. Adapt the amount of work to the actual problem and deadline;
quality follows from the argument and evidence, not from phase gates, panel
scores or a predicted prize.

## Skills and roles

- `mathodology-whole-project`: entry point, installation, backup and repository use.
- `mathodology-agent-pipeline`: modeling prompts and focused collaboration.
- `mathodology-evidence-search`: literature, data, citations and licensed references.
- `mathodology-figure-presets`: scientific figure selection, design, image2 and examples.
- `mathodology-award-gates`: substantive mathematical and editorial review questions.
- `mathodology-project-orientation`: skills-only repository boundaries.
- `mathodology-skill-authoring`: maintain skills and their metadata.
- `mathodology-dev-test-release`: optional repository maintenance checks.

Roles in `.claude/agents/` (Codex: `.codex/agents/`) are for parallel or
isolated work: brief one with a concrete question and evidence, and ask for
findings, artifacts and limitations in ordinary prose. A small task is done by
a single agent.

## Figures

Load `mathodology-figure-presets` before figure work. It owns the image2
availability question (ask once per task; reuse any answer already in the
conversation) and the default data-driven rendering route.

## Repository boundary

Maintain skills in `.claude/skills/`, roles in `.claude/agents/` and
`.codex/agents/`, and short workflow prompts in `.claude/workflows/`. This is
the sole source of truth; `.agents/skills/` is a gitignored local mirror for
Codex. Back up this project's mirror before refreshing it; do not modify other
skills or global settings.

Keep skill references, licensed exemplars and small optional utilities within
the owning skill. Contest outputs belong in a separate working project or the
ignored `work/` directory. `.mcp.json` configures evidence search; keep
credentials and machine-specific paths out of it.

The one application is Mathodology Studio in `apps/studio/`: an Electron
desktop workbench that drives locally installed agent CLIs (Claude Code, Codex,
Gemini CLI) and installs the contest skills into each project. Its manifest,
lockfile and sources stay inside that folder; see its
[README](apps/studio/README.md). Do not add other application source, datasets,
deployment or build outputs, and never commit `node_modules/`, `out/` or
`release/`.

See [the workflow](docs/WORKFLOWS.md) and [installation](docs/INSTALL.md).
