# AI Coding Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the Mathodology repository into reusable Agent Skills that Claude Code can auto-discover and Codex-like tools can read on demand.

**Architecture:** Keep runtime product skills in `docs/skills/` unchanged, and add project-level AI coding skills under `.claude/skills/`. Add a small `AGENTS.md` bridge so tools that do not auto-discover `.claude/skills` know which project skills to load.

**Tech Stack:** Agent Skills `SKILL.md`, Claude Code project skills, Codex-compatible `agents/openai.yaml`, Rust gateway, Python worker, Vue web app, OpenAPI contracts, Docker/native deploy scripts.

---

## Exploration Findings

- The repository is a monorepo with a Rust gateway (`crates/gateway`), Python worker (`apps/agent-worker`), Vue web app (`apps/web`), generated Python/TypeScript contracts (`packages/*-contracts`), installers, deployment scripts, and GitHub Actions.
- `docs/skills/` already contains runtime skills for the product's Coder agent: `chart_catalog`, `evidence_mining`, and a symlinked `matlab` skill. These should not be repurposed as coding-agent onboarding skills.
- The worker has a real `SKILL.md` loader in `apps/agent-worker/src/agent_worker/skills/`, and the Coder agent can call `get_skill` to load skill bodies. That internal mechanism is separate from Claude Code project skills.
- `.gitignore` currently ignores all of `/.claude/`, so project skills under `.claude/skills/` would be invisible to git unless `/.claude/skills/` is explicitly unignored while runtime state remains ignored.
- Claude Code discovers project skills from `.claude/skills/<skill-name>/SKILL.md`; Agent Skills require a skill directory with `SKILL.md` containing YAML frontmatter and Markdown body. Codex can reuse the same format when pointed at the skill directory, and `agents/openai.yaml` provides Codex-oriented UI metadata.

## File Structure

- Create `AGENTS.md`: root bridge for Codex and other tools; points agents at `.claude/skills` and explains the distinction from `docs/skills`.
- Modify `.gitignore`: keep `.claude` runtime state ignored but unignore `.claude/skills/**`.
- Create `.claude/skills/mathodology-project-orientation/SKILL.md`: repository map, boundary rules, common commands, generated-file cautions.
- Create `.claude/skills/mathodology-agent-pipeline/SKILL.md`: worker pipeline, agents, prompts, contracts, HMML, Coder skills, MATLAB, evidence mining.
- Create `.claude/skills/mathodology-gateway-api/SKILL.md`: Rust gateway routes, auth, Redis/Postgres state, LLM routing, export/submission bundles.
- Create `.claude/skills/mathodology-web-ui/SKILL.md`: Vue/Pinia/API/WebSocket/frontend verification patterns.
- Create `.claude/skills/mathodology-dev-test-release/SKILL.md`: setup, tests, CI parity, deployment, release and installer workflow.
- Create `.claude/skills/mathodology-skill-authoring/SKILL.md`: how to add or update either project AI coding skills or product runtime skills without confusing their audiences.
- Create `agents/openai.yaml` under every new skill directory with display name, short description, and default prompt.

## Task 1: Repository Skill Visibility

**Files:**
- Create: `AGENTS.md`
- Modify: `.gitignore`

- [x] **Step 1: Add `AGENTS.md` bridge**

Create `AGENTS.md` with concise instructions:

```markdown
# Mathodology Agent Guide

Project skills for AI coding tools live in `.claude/skills/`.

Before non-trivial work, load the relevant skill:

- `mathodology-project-orientation` for repository layout, boundaries, generated files, and common commands.
- `mathodology-agent-pipeline` for Python worker agents, prompts, pipeline orchestration, runtime `docs/skills`, HMML, MATLAB, search, and critic behavior.
- `mathodology-gateway-api` for Rust gateway routes, auth, Redis/Postgres state, LLM routing, exports, and submission bundles.
- `mathodology-web-ui` for Vue, Pinia stores, API clients, WebSocket streaming, markdown/math rendering, and UI verification.
- `mathodology-dev-test-release` for bootstrap, tests, CI parity, Docker/native deployment, packaging, and release workflows.
- `mathodology-skill-authoring` for adding or updating SKILL.md files in this repository.

Do not confuse `.claude/skills/` with `docs/skills/`: `.claude/skills/` is for external AI coding tools, while `docs/skills/` is loaded by Mathodology's own Coder agent at runtime.
```

- [x] **Step 2: Unignore project skills only**

Change `.gitignore` from ignoring all of `/.claude/` to this pattern:

```gitignore
# Claude Code runtime state stays local, but project skills are source files.
/.claude/*
!/.claude/skills/
!/.claude/skills/**
```

## Task 2: Core Project Skills

**Files:**
- Create: `.claude/skills/mathodology-project-orientation/SKILL.md`
- Create: `.claude/skills/mathodology-agent-pipeline/SKILL.md`
- Create: `.claude/skills/mathodology-gateway-api/SKILL.md`
- Create: `.claude/skills/mathodology-web-ui/SKILL.md`

- [x] **Step 1: Write `mathodology-project-orientation`**

Include repo map, safe starting checks, generated artifact rules, test command selection, and where to inspect before changing each subsystem.

- [x] **Step 2: Write `mathodology-agent-pipeline`**

Include the Analyzer -> Searcher -> Modeler -> Coder -> Writer -> Critic/Audit flow, key files, output contracts, prompt rules, runtime skill loader, HMML, MATLAB backend, evidence mining, and focused tests.

- [x] **Step 3: Write `mathodology-gateway-api`**

Include gateway state model, REST and WebSocket route ownership, OpenAPI contract flow, LLM provider routing, export/submission security constraints, auth token behavior, migrations, and focused Rust tests.

- [x] **Step 4: Write `mathodology-web-ui`**

Include Vue app structure, Pinia state rules, WebSocket replay/reconnect behavior, API client conventions, markdown/math rendering safety, generated contract use, and frontend verification commands.

## Task 3: Operations and Skill Maintenance Skills

**Files:**
- Create: `.claude/skills/mathodology-dev-test-release/SKILL.md`
- Create: `.claude/skills/mathodology-skill-authoring/SKILL.md`

- [x] **Step 1: Write `mathodology-dev-test-release`**

Include bootstrap, env and services, focused checks, full CI checks, Docker deployment, native deployment, release packaging, generated contracts, and when not to run broad commands.

- [x] **Step 2: Write `mathodology-skill-authoring`**

Include the distinction between project skills and runtime Coder skills, required frontmatter, naming, progressive disclosure, symlinked MATLAB pattern, validation commands, and update checklist.

## Task 4: Codex Metadata

**Files:**
- Create: `.claude/skills/*/agents/openai.yaml`

- [x] **Step 1: Generate OpenAI metadata**

Run `generate_openai_yaml.py` for every new skill with explicit `display_name`, `short_description`, and `default_prompt`.

- [x] **Step 2: Inspect metadata**

Verify every `openai.yaml` is valid YAML, has quoted strings, and the default prompt mentions the skill with `$skill-name`.

## Task 5: Validation

**Files:**
- Read/validate: `.claude/skills/*/SKILL.md`
- Read/validate: `.claude/skills/*/agents/openai.yaml`
- Read/validate: `AGENTS.md`
- Read/validate: `.gitignore`

- [x] **Step 1: Validate skill frontmatter**

Run the skill-creator quick validator over each new skill directory. Expected: every skill prints `Skill is valid!`.

- [x] **Step 2: Validate Agent Skills naming rules**

Run a Python check that every skill directory name equals the frontmatter `name`, uses lowercase hyphen-case, and every `description` is non-empty and under 1024 characters.

- [x] **Step 3: Verify git visibility**

Run `git status --short -- .claude/skills AGENTS.md .gitignore docs/superpowers/plans/2026-06-05-ai-coding-skills.md`. Expected: the new skill files and metadata appear as tracked changes, while `.claude/worktrees` remains ignored.

- [x] **Step 4: Review content coverage**

Run `rg -n "mathodology-(project-orientation|agent-pipeline|gateway-api|web-ui|dev-test-release|skill-authoring)|docs/skills|\\.claude/skills|just (bootstrap|test|lint|deploy)" AGENTS.md .claude/skills docs/superpowers/plans/2026-06-05-ai-coding-skills.md`. Expected: each new skill is referenced from the bridge or plan, and runtime skills are explicitly distinguished from project skills.
