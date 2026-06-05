---
name: mathodology-gateway-api
description: Use when changing Mathodology's Rust gateway, REST or WebSocket routes, auth, Redis/Postgres state, LLM routing, OpenAPI contracts, paper export, submission bundles, or gateway tests.
---

# Mathodology Gateway API

## Core Responsibilities

The gateway is the Rust Axum service in `crates/gateway/`. It owns:

- Run creation, listing, state, cancellation, and audit persistence.
- WebSocket event replay for live runs.
- Dev-token auth.
- Redis Streams job dispatch and event fanout.
- Postgres state and SQLx migrations.
- LLM provider routing and streaming proxy behavior.
- Paper export and competition submission bundles.
- Serving run artifacts such as paper markdown and figures.

## Main Files

- `crates/gateway/src/app.rs`: router assembly and middleware.
- `crates/gateway/src/state.rs`: shared application state.
- `crates/gateway/src/config.rs`: gateway config.
- `crates/gateway/src/auth.rs`: dev-token auth.
- `crates/gateway/src/dispatch.rs`: job dispatch to Redis.
- `crates/gateway/src/routes/`: route handlers.
- `crates/gateway/src/llm/`: provider routing, canonical request/response mapping, cost handling, streaming.
- `crates/gateway/templates/`: LaTeX templates for exports.
- `crates/gateway/migrations/`: SQLx migrations.
- `crates/gateway/tests/`: Rust integration tests.
- `packages/contracts/openapi.yaml`: API contract.

## Route Ownership

Use `packages/contracts/openapi.yaml` to understand public behavior, then inspect the route:

- `/runs`: `routes/runs.rs`
- `/ws/runs/{run_id}`: `routes/ws_run.rs`
- `/runs/{run_id}/export/{format}`: `routes/export.rs`
- `/runs/{run_id}/submission`: `routes/submission.rs`
- `/runs/{run_id}/figures/{path}`: `routes/figures.rs`
- `/runs/{run_id}/cancel`: `routes/runs.rs` or nearby route modules
- `/llm/chat/completions`: `routes/llm.rs` and `llm/`

Find all callers before changing a route:

```bash
rg -n "/runs|/ws/runs|/export|/submission|/figures|/llm/chat" apps packages crates
```

## State and Security Rules

- Auth uses `DEV_AUTH_TOKEN`; frontend embeds the token at build time for deployed single-tenant use.
- Run artifact paths must stay inside `RUNS_DIR`; use existing path resolution helpers for user-controlled paths.
- Export and submission routes must reject traversal and cap archive sizes.
- Migrations are forward-only. Add new migrations with `just migrate-add <name>`.
- Redis is an event bus; Postgres and run artifacts are durable state.

## LLM Routing

Provider logic lives under `crates/gateway/src/llm/`:

- `canonical.rs`: normalized request and message fields.
- `router.rs`: provider/model selection.
- `providers/anthropic.rs`: Anthropic native mapping.
- `providers/openai_compat.rs`: OpenAI-compatible providers and proxies.
- `stream.rs`: streaming translation.
- `cost.rs`: cost accounting.
- `cache.rs`: prompt caching helpers.

When changing routing, run targeted tests first:

```bash
cargo test -p gateway router_fallback
cargo test -p gateway anthropic_stream
cargo test -p gateway llm_stream
cargo test -p gateway stream_cost_on_error
```

## Export and Submission Bundles

Export code must keep these invariants:

- `paper.meta.json` is the source of truth for title, abstract, references, figures, and competition type.
- PDF export uses LaTeX templates and Tectonic.
- DOCX export uses Pandoc when available.
- CUMCM anonymous artifacts must not leak team identity in filenames, metadata, or support archives.
- Submission ZIPs have explicit file count and byte caps.

Focused tests:

```bash
cargo test -p gateway export_paper
cargo test -p gateway submission_bundle
cargo test -p gateway figures_serve
```

## Contract Updates

When route shape changes:

1. Update `packages/contracts/openapi.yaml`.
2. Regenerate clients with `just gen`.
3. Check Python and TypeScript consumers.
4. Run drift and focused tests.

Useful commands:

```bash
just gen
cargo test --workspace
pnpm --filter web typecheck
uv run pytest apps/agent-worker -q
```

## Gateway Verification

For broad gateway changes:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --no-deps -- -D warnings
cargo test --workspace
```

If a test requires Postgres or Redis, mirror `.github/workflows/ci.yml`: `DATABASE_URL`, `REDIS_URL`, and `DEV_AUTH_TOKEN` must be set, and migrations should run first.
