---
name: mathodology-agent-pipeline
description: Use when changing Mathodology's Python worker, agent pipeline, prompts, Coder execution, HMML, runtime docs/skills, MATLAB backend, search tools, critic loop, or worker tests.
---

# Mathodology Agent Pipeline

## Core Flow

The worker pipeline is:

```text
Analyzer -> Searcher -> Modeler -> Coder -> Writer -> Critic/Audit
```

Key file: `apps/agent-worker/src/agent_worker/pipeline.py`.

The pipeline emits run events through `EventEmitter`, persists artifacts under `runs/<run_id>/`, and talks to the Rust gateway through `GatewayClient`.

## Main Files

- `apps/agent-worker/src/agent_worker/agents/`: agent implementations and shared parse/revision logic.
- `apps/agent-worker/src/agent_worker/prompts/<agent>/v1.toml`: system and user prompts.
- `apps/agent-worker/src/agent_worker/pipeline.py`: orchestration, cancellation, revisions, audit, skill registry loading.
- `apps/agent-worker/src/agent_worker/kernel/`: persistent Jupyter execution.
- `apps/agent-worker/src/agent_worker/matlab/`: MATLAB/Octave session and backend resolution.
- `apps/agent-worker/src/agent_worker/hmml/`: canonical method retrieval for Modeler.
- `apps/agent-worker/src/agent_worker/tools/`: arXiv, OpenAlex, Crossref, Tavily, PDF, and MCP web search.
- `apps/agent-worker/src/agent_worker/skills/`: runtime `SKILL.md` loader and `get_skill` tool.
- `docs/skills/`: runtime skills the worker can load for Coder.
- `apps/agent-worker/tests/`: worker unit and integration tests.

## Contract Discipline

Structured agent outputs come from `mm_contracts`. Before changing an output shape, find every consumer:

```bash
rg -n "AnalyzerOutput|SearchFindings|ModelSpec|CoderOutput|PaperDraft|CritiqueReport" apps packages crates
```

Common consumers:

- Worker Pydantic parsing and revision code.
- Gateway audit/export routes.
- OpenAPI schema and generated packages.
- Web event and output rendering.

When OpenAPI changes, regenerate contracts:

```bash
just gen
```

## Prompt Changes

Prompts are behavioral contracts. For any prompt edit:

1. Check the matching parser/model in `apps/agent-worker/src/agent_worker/agents/`.
2. Keep JSON-only requirements aligned with Pydantic models.
3. Add or update a focused test that proves parsing, revision, or prompt rendering.
4. Avoid increasing prompt body size with reference material that can live in a runtime skill.

Focused prompt tests often include:

```bash
uv run pytest apps/agent-worker/tests/test_prompt_loader.py -q
uv run pytest apps/agent-worker/tests/test_base_agent_parse.py -q
uv run pytest apps/agent-worker/tests/test_base_agent_revision.py -q
```

## Coder Execution

`CoderAgent` loops up to `MAX_ITERATIONS` around LLM output -> execution feedback. It can execute Python in a persistent Jupyter kernel or MATLAB/Octave through `MatlabSession`.

Important invariants:

- `figures_saved[*].id` must match files written to `figures/<id>.png` and `figures/<id>.svg`.
- `language` is `"python"` or `"matlab"`.
- `skill_request` loads a runtime skill body through `get_skill` and must not burn a code execution iteration.
- Coder prompt rules and `CoderDirective` must stay synchronized.

Useful tests:

```bash
uv run pytest apps/agent-worker/tests/test_coder_agent.py -q
uv run pytest apps/agent-worker/tests/test_skill_tool.py -q
uv run pytest apps/agent-worker/tests/test_matlab_session.py -q
uv run pytest apps/agent-worker/tests/test_figure_pipeline.py -q
```

## Runtime Skills

Runtime skills live in `docs/skills/<name>/SKILL.md` and are loaded by `load_skills_dir()` from `apps/agent-worker/src/agent_worker/skills/loader.py`.

Current runtime skills:

- `chart_catalog`: figure selection and caption discipline.
- `evidence_mining`: deterministic sensitivity and anonymity checks.
- `matlab`: symlink to `docs/matlab.md`.

These skills are for Mathodology's own Coder agent, not for Claude Code or Codex repository onboarding. Use `mathodology-skill-authoring` before editing them.

## Search and Evidence

Searcher combines arXiv, scholarly APIs, and optional web search. Settings live in `apps/agent-worker/src/agent_worker/config.py`.

Focused tests:

```bash
uv run pytest apps/agent-worker/tests/test_searcher_agent.py -q
uv run pytest apps/agent-worker/tests/test_searcher_orchestration.py -q
uv run pytest apps/agent-worker/tests/test_arxiv_tool.py -q
uv run pytest apps/agent-worker/tests/test_openalex_tool.py -q
uv run pytest apps/agent-worker/tests/test_crossref_tool.py -q
uv run pytest apps/agent-worker/tests/test_tavily_client.py -q
```

## Critic and Audit

The critic loop is cost-capped by `CriticPolicy` in `pipeline.py`. Deterministic checks in `agents/evidence.py` inject blocking criteria for weak sensitivity analysis and anonymity leaks. Final paper audit lives in `apps/agent-worker/src/agent_worker/audit.py`.

Focused tests:

```bash
uv run pytest apps/agent-worker/tests/test_critic_agent.py -q
uv run pytest apps/agent-worker/tests/test_critic_contracts.py -q
uv run pytest apps/agent-worker/tests/test_evidence_mining.py -q
uv run pytest apps/agent-worker/tests/test_audit.py -q
uv run pytest apps/agent-worker/tests/test_pipeline_critic_gate.py -q
```

## Worker Verification

For broad worker changes:

```bash
uv run ruff check .
uv run pytest apps/agent-worker -q
```

If the change touches gateway contracts or event schemas, also run the relevant Rust and web checks.
