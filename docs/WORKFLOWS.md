# Mathodology Agent Workflows

Mathodology has two supported orchestration modes:

- Claude Code: workflow-first with project subagents.
- Codex: multi-agent phase execution with parallel task agents and synthesis gates.

Both modes target national-first-prize or MCM/ICM O-prize level modeling work: complete prompt coverage, defensible math, reproducible computation, polished paper, and a submission-ready package.

## Shared Phase Model

| Phase | Goal | Main Outputs | Gate |
|---|---|---|---|
| 0. Intake and scoring | Understand the task and judging surface | restatement, deliverables, scoring criteria, ambiguity register | every prompt requirement maps to a planned output |
| 1. Evidence and data | Ground the problem | source inventory, data plan, benchmark methods, citation notes | every model input has data, proxy logic, or an assumption |
| 2. Candidate models | Explore routes before committing | three model routes, tradeoff table, selected route | route fits data, time, scoring, and prompt |
| 3. Math specification | Make the model executable | notation, assumptions, objectives, constraints, algorithms, metrics | coder can implement without inventing math |
| 4. Experiments | Generate reproducible results | code, raw outputs, tables, figures, sensitivity, robustness | reported numbers are reproducible |
| 5. Interpretation | Connect results to the prompt | findings, captions, recommendations, limitations | each result answers a prompt question |
| 6. Paper draft | Produce a coherent paper | abstract, methods, results, references, appendix | no orphan result or unsupported claim |
| 7. Independent review | Remove fixable weaknesses | prompt, math, evidence, reproducibility, writing audits | no high-severity issue remains |
| 8. Final package | Assemble submission | paper, source, code, data notes, README, AI-use statement, checklist | package is submit-ready |

## Claude Code Workflow Mode

Use this when working in a cloned repository opened by Claude Code.

Primary entrypoint:

```text
.claude/workflows/mathodology-award-submission.md
```

Subagents:

- `mathodology-lead`: phase control, synthesis, risk register
- `mathodology-problem-analyst`: prompt decomposition and scoring map
- `mathodology-evidence-researcher`: literature, data, benchmarks, citations
- `mathodology-modeler`: math formulation, method choice, validation design
- `mathodology-coder`: reproducible computation, figures, tables
- `mathodology-critic`: adversarial review and phase gates
- `mathodology-paper-editor`: paper narrative and polish
- `mathodology-submission-packager`: final package and reproducibility README

Execution pattern:

1. `mathodology-lead` loads `mathodology-whole-project`.
2. Lead starts Phase 0 and dispatches specialists.
3. Specialists produce phase artifacts independently.
4. Lead merges artifacts into a single decision log.
5. `mathodology-critic` audits the phase.
6. Lead fixes or redispatches until the gate passes.
7. Repeat through Phase 8.

For installed global skills, Claude Code may not receive `.claude/agents` and `.claude/workflows` from the `skills` CLI. In that case, load `mathodology-whole-project` and follow the same phase model from this document.

## Codex Multi-Agents Mode

Use this when the skills are installed globally for Codex.

Start prompt:

```text
Use $mathodology-whole-project. Run the Mathodology 9-phase award submission workflow in Codex multi-agents mode. For each phase, dispatch independent agents for analysis, modeling, evidence, coding, critique, and writing where applicable; synthesize their output; then run the phase gate before continuing.
```

Codex agent roles:

- Lead synthesis agent
- Problem analyst agent
- Evidence and data agent
- Model design agent
- Experiment and computation agent
- Critic agent
- Paper writing agent
- Submission packaging agent

Codex execution rules:

- Use parallel agents only when tasks have separate inputs or can be reviewed independently.
- Give each agent a narrow brief, expected files, and phase gate.
- Ask at least two agents for model-route proposals in Phase 2.
- Ask one independent critic agent to review each gate.
- Preserve a phase log with decisions, assumptions, rejected alternatives, evidence, commands, and output paths.
- Before final response, verify package completeness against Phase 8.

## Required Final Submission Contents

A complete award-level package should include:

- final paper PDF
- editable paper source if required by the contest
- code or notebooks
- data files or data provenance notes
- generated figures and tables
- reproduction README
- assumptions and notation summary
- sensitivity and robustness evidence
- AI-use statement when required
- final checklist mapping prompt requirements to submitted files

## Quality Bar

Do not treat a solution as prize-level until it has:

- multiple model alternatives and a clear selection rationale
- evidence-backed assumptions
- reproducible computations
- sensitivity or robustness analysis
- prompt-by-prompt answer coverage
- polished paper narrative
- independent critic review
- complete final package audit
