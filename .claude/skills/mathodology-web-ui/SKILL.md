---
name: mathodology-web-ui
description: Use when maintaining archived knowledge about Mathodology's former web UI, run dashboard, API clients, streaming behavior, rendering, or frontend verification.
---

# Mathodology Web UI Archive

## Scope

This skill preserves architectural knowledge about the former Mathodology web interface.

The current GitHub branch does not contain frontend source, package manifests, generated TypeScript contracts, or build configuration. Use this skill for archived guidance and reconstruction planning, not for editing or building a UI in this checkout.

## Archived Concepts

The former web UI presented modeling runs and artifacts through:

- dashboard and workbench views
- run creation, settings, and search configuration
- WebSocket event streaming and replay into local state
- paper, figure, critique, and export panels
- markdown, math, and code rendering
- API clients generated or aligned from shared contracts

## Workflow Adapter Role

In the award-level workflow, use this skill when the submission needs reader-facing presentation quality:

- design clear figure and table narratives
- keep result panels in mind when organizing outputs
- make progress, assumptions, and limitations visible in the paper
- treat captions as part of the argument, not decoration
- make final deliverables easy for a reviewer to inspect

Codex agents should use this as presentation and artifact-organization guidance.

Claude Code paper and packaging subagents should reference this when deciding how figures, tables, exports, and final files should be arranged for review.

## How To Maintain This Skill

When updating archived UI guidance:

1. State that implementation files are historical and absent from this branch.
2. Keep guidance focused on behavior, component responsibilities, and reconstruction concerns.
3. Do not list current frontend commands or missing source paths as active instructions.
4. If exact component details are needed, inspect Git history in a separate worktree.
5. Coordinate API and event assumptions with the gateway archive skill.

## Useful Questions

Use this skill for questions like:

- What UI responsibilities existed in the former product?
- How did run streaming and rendering concepts fit together?
- What behavior should be preserved if a new frontend is rebuilt?
- Which historical UI details need Git-history verification?

## Current-Branch Rule

Any current-branch edit should be limited to skills or documentation. Do not add frontend source, package manifests, generated contracts, static assets, or build outputs back to this branch unless the user explicitly changes the repository strategy.
