---
name: mathodology-dev-test-release
description: Use when bootstrapping Mathodology, running tests, matching CI, changing dependencies, regenerating contracts, deploying Docker or native stacks, or editing release and installer workflows.
---

# Mathodology Dev, Test, and Release

## Bootstrap

From the repo root:

```bash
just bootstrap
```

This creates `.env` if missing, fetches Rust dependencies, syncs Python with `uv`, and installs Node packages with `pnpm`.

Infrastructure for local development:

```bash
just infra-up
just migrate
```

Run services:

```bash
just dev
just dev-gateway
just dev-worker
just dev-web
```

## Environment

Important defaults and variables:

- `DATABASE_URL`: Postgres URL used by gateway and SQLx.
- `REDIS_URL`: Redis URL for jobs and event streams.
- `DEV_AUTH_TOKEN`: bearer token required by authenticated API routes.
- `RUNS_DIR`: artifact root for notebooks, papers, figures, and metadata.
- `GATEWAY_HTTP`: worker-to-gateway URL.
- LLM keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, or compatible provider settings.
- Search keys and toggles: `TAVILY_API_KEY`, `OPEN_WEBSEARCH_DISABLED`, `OPENALEX_DISABLED`, `CROSSREF_DISABLED`, `MM_POLITE_MAILTO`.

Never commit `.env`, run artifacts, `.run/`, `target/`, `.venv/`, `node_modules/`, or `apps/web/dist/`.

## Authoritative Checks

Prefer direct commands over aggregate recipes when the result must be trusted:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --no-deps -- -D warnings
cargo test --workspace
uv run ruff check .
uv run pytest apps/agent-worker -q
pnpm --filter web typecheck
pnpm --filter web build
```

`just test` and `just lint` are convenient but include `|| true` for some Python or frontend subcommands. Use direct commands for final verification.

## Focused Checks

Use focused tests while iterating:

```bash
cargo test -p gateway <test_name_or_filter>
uv run pytest apps/agent-worker/tests/test_<area>.py -q
pnpm --filter web typecheck
```

Run broad checks only when the change touches shared contracts, public behavior, deployment, or cross-subsystem flow.

## Contracts and Codegen

Source contract:

```text
packages/contracts/openapi.yaml
```

Regenerate:

```bash
just gen
just gen-py
just gen-ts
```

After contract changes, check:

```bash
git diff -- packages/contracts packages/py-contracts packages/ts-contracts
uv run pytest apps/agent-worker -q
pnpm --filter web typecheck
cargo test --workspace
```

## Docker Deployment

One-command deployment:

```bash
./scripts/deploy.sh
```

Useful variants:

```bash
./scripts/deploy.sh --build
./scripts/deploy.sh --update
./scripts/deploy.sh --down
./scripts/deploy.sh --logs
```

Compose files:

- `docker-compose.prod.yml`: base production stack.
- `docker-compose.images.yml`: prebuilt gateway and worker image overlay.
- `Dockerfile.gateway`, `Dockerfile.worker`, `Dockerfile.web`: service images.

Security rule: while `DEV_AUTH_TOKEN` is the insecure default, deployment scripts should keep the UI loopback-bound unless the user explicitly changes the token and exposes it.

## Native Deployment

Native one-command deployment:

```bash
./scripts/deploy-local.sh
```

Useful variants:

```bash
./scripts/deploy-local.sh --status
./scripts/deploy-local.sh --logs
./scripts/deploy-local.sh --down
./scripts/deploy-local.sh --restart
```

Runtime state belongs under `.run/` and must stay ignored.

Service configs:

- `config/systemd/`: Linux systemd units and installer.
- `config/launchd/`: macOS launchd plists and installer.
- `config/windows/`: Windows service scripts.

## Release

Release workflow:

```text
.github/workflows/release.yml
```

It builds web assets, gateway binaries, Docker images, Debian packages, macOS packages, Windows installers, and release artifacts. Packaging is best-effort in some jobs; inspect `continue-on-error` before treating a missing artifact as unexpected.

Before editing release logic, check:

```bash
rg -n "gateway|worker|web-dist|docker|pkg|deb|msi|artifact|version" .github/workflows installer Dockerfile.* scripts
```

## Smoke Test

End-to-end smoke script:

```bash
bash scripts/smoke_e2e.sh
```

Use it after changes that affect run creation, worker dispatch, artifact generation, or gateway/web integration.
