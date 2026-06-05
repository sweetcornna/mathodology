---
name: mathodology-agent-pipeline
description: Use when maintaining archived knowledge about Mathodology's former Python agent pipeline, worker roles, prompts, Coder execution, HMML, MATLAB, search, or critic behavior.
---

# Mathodology Agent Pipeline Archive

## Scope

This skill preserves architectural knowledge about the former Mathodology Python worker and multi-agent pipeline.

The current GitHub branch does not contain the worker source. Use this skill to update archived guidance, explain the former design, or help reconstruct context from history. Do not instruct agents to edit or test missing worker files in this checkout.

## Archived Concepts

The former worker coordinated specialized modeling agents around a mathematical modeling run:

- problem interpretation and task decomposition
- literature and evidence search
- model selection and method grounding
- code execution for numerical work
- draft generation and revision
- critique, audit, and final evidence checks

The worker also carried knowledge about HMML-style method retrieval, MATLAB or Octave execution, web and scholarly search tools, figure generation, and runtime skills used by the Coder role.

## How To Maintain This Skill

When updating archived pipeline guidance:

1. State clearly that the implementation is historical and not present on this branch.
2. Prefer conceptual boundaries over file paths.
3. Avoid commands that imply the current checkout can run the old worker tests.
4. If exact implementation evidence is needed, inspect Git history in a separate worktree.
5. Keep details reusable for future agents who need to understand or rebuild the pipeline.

## Useful Questions

Use this skill for questions like:

- How did the former multi-agent modeling pipeline divide responsibility?
- What did the Coder, Critic, Search, MATLAB, or HMML concepts mean?
- Which archived behavior should be preserved in skills documentation?
- What must be recovered from Git history before rebuilding a worker?

## Current-Branch Rule

Any current-branch edit should be limited to skills or documentation. Do not add worker source, tests, package files, run artifacts, or runtime skill directories back to this branch unless the user explicitly changes the repository strategy.
