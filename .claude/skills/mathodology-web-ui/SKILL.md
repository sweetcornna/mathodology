---
name: mathodology-web-ui
description: Use when changing Mathodology's Vue web app, Pinia stores, API clients, WebSocket run streaming, markdown/math rendering, generated TypeScript contracts, or frontend verification.
---

# Mathodology Web UI

## App Shape

The web app lives in `apps/web/` and uses Vue 3, Pinia, Vite, Vue Router, KaTeX, marked, and shiki.

Main areas:

- `apps/web/src/App.vue`: shell.
- `apps/web/src/router/index.ts`: routes.
- `apps/web/src/views/`: Dashboard, Workbench, Showcase.
- `apps/web/src/components/`: run output, event log, paper preview, export panel, settings, search config, stage pills.
- `apps/web/src/stores/`: Pinia stores for run state, settings, search config, and paper fine-tuning.
- `apps/web/src/api/`: HTTP, WebSocket, figures, search, stats, export clients.
- `apps/web/src/lib/`: markdown, math, and syntax highlighting helpers.
- `packages/ts-contracts/src/generated.ts`: generated API/event types.

## Contract Use

Prefer generated types from `@mathodology/contracts`. If an API shape changes:

```bash
just gen-ts
pnpm --filter web typecheck
```

Do not duplicate backend schemas in ad hoc TypeScript interfaces unless the type is UI-only state.

## WebSocket Run State

`apps/web/src/api/ws.ts` handles `/ws/runs/{run_id}`:

- Sends `hello` with `last_seq` for replay.
- Reconnects with bounded backoff.
- Stops reconnecting after terminal `done`.

`apps/web/src/stores/run.ts` is the stateful consumer:

- Hide chatty `token`, `agent.output`, and `kernel.stdout` events from the ordered feed.
- Batch token deltas through `requestAnimationFrame` to avoid render stalls.
- Keep kernel cell state separate from agent structured outputs.
- Reset module-level WebSocket and token buffers before starting a new run.

When changing event handling, run:

```bash
pnpm --filter web typecheck
pnpm --filter web build
```

Also search backend event emitters:

```bash
rg -n "emit\\(|AgentEvent|kernel\\.stdout|agent\\.output|stage\\.start|done" apps crates packages
```

## Markdown, Math, and Code Rendering

Rendering safety lives in `apps/web/src/lib/safe-markdown.ts` and related tests. Keep these constraints:

- Sanitize or escape untrusted markdown.
- Preserve math rendering through KaTeX.
- Keep code highlighting through shiki.
- Do not bypass the safe renderer for paper or agent output content.

Focused check:

```bash
pnpm --filter web typecheck
pnpm --filter web build
```

If a test runner is added or already available in the current branch, run the matching `*.test.ts` files as well.

## UI Conventions

- Keep the app work-focused: dense but readable panels, stable controls, predictable navigation.
- Avoid layout shifts in live streaming surfaces; define stable dimensions for repeated controls, event rows, stage pills, and export buttons.
- Text in compact panels should use compact headings, not hero-scale type.
- Do not put cards inside cards. Use cards for repeated items and framed tools only.
- Use existing components and styles in `apps/web/src/styles.css` before adding new patterns.

## API Clients

- `apps/web/src/api/http.ts`: base URLs and auth token.
- `apps/web/src/api/export.ts`: export requests.
- `apps/web/src/api/figures.ts`: figure URL helpers.
- `apps/web/src/api/search.ts`: search capability calls.

When backend auth or route behavior changes, verify callers and UI error mapping:

```bash
rg -n "devAuthToken|Authorization|token=|export|figures|search" apps/web/src crates/gateway/src packages/contracts
```

## Frontend Verification

Use direct commands for authoritative gates:

```bash
pnpm --filter web typecheck
pnpm --filter web build
```

For local visual checks:

```bash
just dev-web
```

The production web image is built by `Dockerfile.web` and served by Caddy in `docker-compose.prod.yml`; deployment behavior may differ from Vite dev if base URLs or baked tokens change.
