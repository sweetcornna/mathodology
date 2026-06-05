# Mathodology Agent Guide

Project skills for AI coding tools live in `.claude/skills/`.

Before non-trivial work, load the relevant skill:

- `mathodology-whole-project` for full-project backup, transfer, restore orientation, and choosing the right project skill set.
- `mathodology-project-orientation` for repository layout, boundaries, generated files, and common commands.
- `mathodology-agent-pipeline` for Python worker agents, prompts, pipeline orchestration, runtime `docs/skills`, HMML, MATLAB, search, and critic behavior.
- `mathodology-gateway-api` for Rust gateway routes, auth, Redis/Postgres state, LLM routing, exports, and submission bundles.
- `mathodology-web-ui` for Vue, Pinia stores, API clients, WebSocket streaming, markdown/math rendering, and UI verification.
- `mathodology-dev-test-release` for bootstrap, tests, CI parity, Docker/native deployment, packaging, and release workflows.
- `mathodology-skill-authoring` for adding or updating `SKILL.md` files in this repository.

Do not confuse `.claude/skills/` with `docs/skills/`: `.claude/skills/` is for external AI coding tools, while `docs/skills/` is loaded by Mathodology's own Coder agent at runtime.
