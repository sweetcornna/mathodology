---
name: mathodology-gateway-api
description: Use when maintaining archived knowledge about Mathodology's former gateway, API routes, auth, state, LLM routing, exports, submission bundles, or contracts.
---

# Mathodology Gateway API Archive

## Scope

This skill preserves architectural knowledge about the former Mathodology gateway and public API surface.

The current GitHub branch does not contain the gateway source, contracts, migrations, tests, or generated clients. Use this skill for archived guidance and reconstruction planning, not for editing or compiling a gateway in this checkout.

## Archived Concepts

The former gateway acted as the service boundary for the product:

- request intake for modeling runs
- run status, event streaming, and artifact access
- authentication for development and hosted usage
- persistence through application state and backing stores
- LLM provider routing, streaming, fallback, and cost accounting
- paper export and submission bundle generation
- API contracts shared with the worker and web UI

## Workflow Adapter Role

In the award-level workflow, use this skill when the submission package needs service or product-style reasoning from the former gateway design:

- define a clean boundary between user prompt, computation, artifacts, and final package
- preserve event-log thinking for phase logs and reproducibility trails
- treat exports and submission bundles as first-class deliverables
- keep API-contract thinking when specifying output schemas for code, data, tables, figures, and paper sections

Codex agents should use this as architecture guidance, not as a command to rebuild the removed gateway.

Claude Code subagents should reference this only when package boundaries, artifacts, exports, or reproducibility contracts are unclear.

## How To Maintain This Skill

When updating archived gateway guidance:

1. Mark implementation details as historical unless verified from Git history.
2. Prefer behavior and contract concepts over missing source paths.
3. Do not add build, test, migration, or contract-generation commands as current validation.
4. If exact route behavior is needed, recover it from an older commit in a separate worktree.
5. Keep cross-boundary notes aligned with the pipeline and web UI archive skills.

## Useful Questions

Use this skill for questions like:

- What responsibilities did the former gateway own?
- How did gateway concepts connect worker runs, web streaming, exports, and LLM providers?
- What should be preserved before reconstructing API contracts?
- Which historical areas need Git-history inspection before implementation work?

## Current-Branch Rule

Any current-branch edit should be limited to skills or documentation. Do not add gateway source, contracts, migrations, generated clients, service config, or tests back to this branch unless the user explicitly changes the repository strategy.
