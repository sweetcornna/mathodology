# Mathodology Agent Guide

Mathodology is a skills pack for mathematical modeling contests. Use prompts to
support mathematical judgment, reproducible computation and clear scientific
communication. Adapt the amount of work to the actual problem and deadline.

## Start from the task

Read the problem and available data. Identify the decisions to support, the
required outputs and the current contest rules. Ask only about missing details
that would change the solution. State reasonable assumptions and keep working.

Use a flexible cycle: understand the problem, formulate a model, challenge its
results, and communicate the answer. Revisit any part when evidence changes.
Do not require fixed phases, machine-readable handoffs, repeated approvals,
arbitrary figure counts or invented award scores. Quality follows from the
argument and evidence, not completion of a checklist or a predicted prize.

## Skills and roles

- `mathodology-whole-project`: entry point, installation, backup and repository use.
- `mathodology-agent-pipeline`: adaptable modeling prompts and focused collaboration.
- `mathodology-evidence-search`: literature, data, citations and licensed references.
- `mathodology-figure-presets`: scientific figure selection, design, image2 and examples.
- `mathodology-award-gates`: substantive mathematical and editorial review questions.
- `mathodology-project-orientation`: skills-only repository boundaries.
- `mathodology-skill-authoring`: maintain skills and their metadata.
- `mathodology-dev-test-release`: optional repository maintenance checks.

Choose specialists only when their contribution helps the task and the host
supports delegation. Brief them with a concrete question and relevant evidence;
ask for findings, artifacts and limitations in ordinary prose. Independent
review is useful for difficult mathematical or empirical claims. A single agent
can complete a small task. Do not invent a mandatory panel or scoring system.

## Default figure guidance

Use [the explicit agent guidance](.claude/skills/mathodology-figure-presets/references/figure-guidance.md)
when starting or delegating figure work. The expected deliverable is a rendered,
data-backed figure, with an explanation and reproduction path.

## Figures and image2

Before designing figures, load `mathodology-figure-presets`. Default to its
callable chart code templates for numerical figures. If image2 is unavailable
or the answer is pending, bind real data, execute the template and deliver
PNG/PDF outputs; do not stop at a design prompt or wait for image2. On the first figure
request in each modeling task, ask once whether image2 is available through a
current tool, a configured interface, or manual use. Reuse an answer already
in the conversation; continue independent analysis while waiting. Follow the
skill's image2 guidance, including truthful capability reporting and data-driven
quantitative marks. Synthetic demonstrations must be labeled as such.

## Repository boundary

Maintain skills in `.claude/skills/`, optional roles in `.claude/agents/`, and
short workflow prompts in `.claude/workflows/`. This is the sole source of truth;
`.agents/skills/` is a gitignored local installation mirror. Back up this project's
mirror before refreshing it; do not modify other skills or global settings.

Keep skill references, licensed exemplars and small optional utilities within
the owning skill. Contest outputs belong in a separate working project or the
ignored `work/` directory. Do not add application source, datasets, deployment,
package manifests or build outputs. `.mcp.json` configures evidence search;
keep credentials and machine-specific paths out of it. Historical application
material remains available in Git history, outside the active skill set.

See [the workflow](docs/WORKFLOWS.md) and [installation](docs/INSTALL.md).
