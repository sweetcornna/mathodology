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

## New Orchestration Use

This skill now also carries the reusable workflow pattern that replaced the removed worker source.

For Claude Code:

- Use `.claude/workflows/mathodology-award-submission.md`.
- Dispatch `.claude/agents/mathodology-*.md` roles.
- Lead owns phase gates and synthesis.

For Codex:

- Use multi-agents mode.
- Dispatch separate agents for problem analysis, evidence, model design, experiments, critique, writing, and packaging.
- Keep a phase log and run an independent critic gate before advancing.

## Phase Responsibilities

- Phase 0: problem analyst maps prompt, scoring, deliverables, assumptions.
- Phase 1: evidence researcher builds source, data, and benchmark inventory.
- Phase 2: at least two model agents propose alternatives; lead selects route with rejection reasons.
- Phase 3: modeler writes notation, assumptions, objective, constraints, algorithms, and metrics.
- Phase 4: coder produces reproducible computation, tables, figures, sensitivity, and robustness outputs.
- Phase 5: modeler and paper editor translate results into prompt-level answers.
- Phase 6: paper editor builds the paper narrative and appendix.
- Phase 7: critic audits prompt coverage, math, evidence, reproducibility, and writing.
- Phase 8: packager assembles final paper, source, code, data notes, README, AI-use statement, and checklist.

## Prize-Level Gates

Block progression if any of these are missing:

- prompt requirement without an output
- major assumption without evidence, derivation, or sensitivity check
- selected model without rejected alternatives
- reported number without reproducibility path
- figure or table without interpretation
- paper claim without support
- final package without README and requirement-to-file checklist

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
