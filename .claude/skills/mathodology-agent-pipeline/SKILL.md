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
- Use `.claude/workflows/mathodology-contest-variants.md` when the contest is not the default MCM/ICM or CUMCM-style paper workflow.
- Dispatch `.claude/agents/mathodology-*.md` roles.
- Lead owns phase gates and synthesis.

For Codex:

- Use multi-agents mode.
- Dispatch separate agents for problem analysis, evidence, model design, experiments, critique, writing, and packaging.
- Keep a phase log and run an independent critic gate before advancing.
- Treat execution as phase-sized and resumable. Ask the user only for contest-critical details, then continue automatically when the gate passes.
- In Phase 0, classify the contest type and apply the adapter from `docs/WORKFLOWS.md`.

## Human Confirmation Checkpoints

The workflow should not stop for every ambiguity. Most modeling details can be handled by conservative, explicit assumptions and later critic review.

Ask the user only when the answer would change official requirements, private data access, model route selection, compute or reproducibility constraints, or final submission decisions. The question should state the current phase, why the detail blocks progress, the recommended default, and the consequence of common answers.

For all other ambiguity, record the assumption in the phase log and proceed. If Codex must stop because a response boundary is reached, preserve the current phase, completed gates, unresolved risks, artifact paths, and next action so the next response resumes rather than restarts.

## Phase Responsibilities

- Phase 0: problem analyst maps prompt clauses, scoring surface, contest type, deliverables, official constraints, dependencies, and material ambiguities; critic checks requirement coverage, adapter selection, and whether user questions are truly contest-critical.
- Phase 1: evidence researcher builds source ledger, data dictionary, proxy logic, benchmark inventory, citation plan, and evidence gaps; critic checks traceability and proxy defensibility.
- Phase 2: at least two model agents propose alternatives; lead compares at least three routes and selects one with rejection reasons; critic checks route fit, novelty, time feasibility, and absence of generic method stacking.
- Phase 3: modeler writes notation, assumptions, units, objectives, constraints, algorithms, pseudocode, validation metrics, baseline, ablation, sensitivity, and robustness plan; critic checks implementability and mathematical coherence.
- Phase 4: coder produces reproducible computation, environment notes, raw outputs, tables, figures, baseline, ablations, sensitivity, robustness outputs, and run logs; critic checks number traceability and no cherry-picking.
- Phase 5: modeler and paper editor translate results into prompt-level answers, captions, recommendations, limitations, uncertainty notes, and claim-source links; critic checks answer coverage and support.
- Phase 6: paper editor builds summary, coherent paper narrative, references, appendix, and AI-use statement when required; critic checks summary quality, paper coherence, notation, citations, and page/format risk.
- Phase 7: critic audits prompt coverage, math, evidence, reproducibility, writing, formatting, originality, and final scoring risk; lead reruns specialists until no blocker or high issue remains.
- Phase 8: packager assembles final paper, source, code, data notes, figures, tables, README, AI-use statement, and checklist; critic checks compliance, anonymity, size/page limits, secrets, scratch artifacts, and submit-readiness.

## Agent Handoff Format

Every specialist must end with:

```text
Agent handoff:
- Phase:
- Agent:
- Files or artifacts produced:
- Decisions made:
- Assumptions introduced:
- Evidence used:
- Commands or computations run:
- Known weaknesses:
- Questions for lead or user:
- Critic focus requested:
```

## Prize-Level Gates

Block progression if any of these are missing:

- prompt requirement without an output
- major assumption without evidence, derivation, or sensitivity check
- selected model without rejected alternatives
- reported number without reproducibility path
- figure or table without interpretation
- paper claim without support
- final package without README and requirement-to-file checklist
- phase artifact without independent critic review
- blocker or high-severity critic issue without a fix

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
