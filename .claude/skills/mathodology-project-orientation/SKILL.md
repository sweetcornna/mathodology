---
name: mathodology-project-orientation
description: Use when starting non-trivial work in Mathodology, locating code, planning changes, choosing tests, or handling generated files, monorepo boundaries, and dirty worktrees.
---

# Mathodology Project Orientation

## Start Here

Run these checks before changing files:

```bash
git status --short --branch
rg --files
```

Assume the worktree may contain user changes. Do not revert unrelated files. Use focused reads before editing; prefer `rg` for search.

## Repository Map

- `crates/gateway/`: Rust Axum gateway, REST routes, WebSocket streaming, auth, LLM provider routing, exports, submission bundles, SQLx migrations.
- `apps/agent-worker/`: Python worker, five-agent pipeline, prompts, Jupyter and MATLAB execution, web search tools, HMML method library, runtime skill loader.
- `apps/web/`: Vue 3 + Pinia + Vite UI, API clients, WebSocket replay, markdown/math/code rendering, export panels, run dashboard.
- `packages/contracts/`: OpenAPI and event schemas. Treat as source of truth for generated clients.
- `packages/py-contracts/` and `packages/ts-contracts/`: generated/stubbed contract packages consumed by worker, gateway tests, and web.
- `docs/skills/`: product runtime skills loaded by the worker's Coder agent. These are not the same as project AI coding skills.
- `.claude/skills/`: project AI coding skills for Claude Code, Codex-like tools, and other Agent Skills consumers.
- `docs/superpowers/`: design and implementation plans used by prior agent work.
- `scripts/`, `Dockerfile.*`, `docker-compose*.yml`, `installer/`, `config/`: install, deployment, packaging, and service supervision.
- `runs/`, `target/`, `.venv/`, `node_modules/`, `.run/`: generated local state. Do not commit.

## Change Boundaries

- Gateway API behavior usually touches `crates/gateway`, `packages/contracts/openapi.yaml`, generated contract packages, and web API callers together.
- Worker output schema changes usually start in `packages/contracts/openapi.yaml` or `packages/py-contracts/src/mm_contracts/agent_io.py`, then flow into worker tests and web types.
- Prompt or pipeline behavior changes belong near `apps/agent-worker/src/agent_worker/prompts/`, `agents/`, `pipeline.py`, and targeted tests under `apps/agent-worker/tests/`.
- UI changes should stay in `apps/web/src/` and use generated types from `@mathodology/contracts`.
- Deployment changes should check both Docker and native scripts when user-facing behavior overlaps.

## Generated Files

- `packages/py-contracts/src/mm_contracts/generated.py` is generated and ignored by `.gitignore`; avoid hand editing unless the task is specifically about generation stubs.
- `packages/ts-contracts/src/generated.ts` is generated but checked in. If OpenAPI changes, run `just gen-ts` or `just gen`.
- `apps/web/dist/`, `target/`, `.venv/`, and `node_modules/` are build outputs.

## Commands

Bootstrap:

```bash
just bootstrap
```

Run the app:

```bash
just infra-up
just dev
```

Focused checks:

```bash
cargo test --workspace
uv run pytest apps/agent-worker -q
pnpm --filter web typecheck
pnpm --filter web build
```

`just test` and `just lint` are convenient, but some subcommands are intentionally `|| true`; use direct commands when a gate must be authoritative.

## Which Skill Next

- Whole-project backup or transfer: use `mathodology-whole-project`.
- Worker agents or runtime skills: use `mathodology-agent-pipeline`.
- Gateway routes, exports, or LLM proxy: use `mathodology-gateway-api`.
- Web UI, stores, or streaming: use `mathodology-web-ui`.
- CI, deploy, installer, or release: use `mathodology-dev-test-release`.
- Creating or revising skills: use `mathodology-skill-authoring`.
