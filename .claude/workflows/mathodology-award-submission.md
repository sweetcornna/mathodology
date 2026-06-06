# Mathodology Award Submission Workflow

Use this workflow in Claude Code for national-first-prize or MCM/ICM O-prize level mathematical modeling submissions.

## Operating Mode

1. Start with `mathodology-lead`.
2. Load `mathodology-whole-project` and `mathodology-agent-pipeline`.
3. Run each phase in order.
4. Within each phase, dispatch the named specialist subagents in parallel when their tasks do not depend on each other.
5. End every phase with a lead synthesis and critic gate.
6. Do not proceed past a gate with unresolved critical risks.

## Universal Artifact Contract

Every specialist subagent must end with:

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

The lead merges handoffs into the phase log. The critic reviews the phase log plus source artifacts and assigns `blocker`, `high`, `medium`, or `low` severity. Any `blocker` or `high` issue stops the workflow. `medium` issues need an owner, fix plan, or explicit risk acceptance.

## Award-Level Gate Rules

Use these gates to target MCM/ICM Outstanding and CUMCM national-first-prize quality:

- No generic method stacking: every method must solve a specific prompt requirement.
- No untraceable numbers: every number must map to code, data, derivation, citation, or documented manual calculation.
- No unsupported assumptions: each major assumption needs evidence, derivation, or sensitivity analysis.
- No single-route modeling: at least three model routes must be considered before selection.
- No unaudited artifact: each phase output must pass an independent critic gate before reuse.
- No paper-only polish: computation, source tracing, and reproducibility must be strong enough for reviewer spot checks.
- No hidden compliance risk: page, size, anonymity, AI-use, citation, and final package rules are gate items, not final chores.
- No sparse result presentation: paper-first contests need a purposeful figure/table system that covers model structure, key comparisons, sensitivity, robustness or uncertainty, decision tradeoffs, and final recommendations.
- No filler visuals: extra figures or tables count only when they are reproducible, interpreted, non-duplicative, and tied to a prompt-level conclusion.
- No chart rendering bugs: overlapping labels, clipped axes, unreadable text, duplicated caption prefixes, orphaned figures, and incoherent table wrapping are gate failures in the rendered PDF, not cosmetic nits.

## Phase Review Matrix

| Phase | Specialist focus | Critic focus |
|---|---|---|
| 0 | Atomic requirement map, deliverables, scoring hypothesis, official constraints, ambiguity register | Every prompt clause has an output; only material blockers are sent to the user |
| 1 | Source ledger, data dictionary, proxy logic, benchmark methods, citation plan | Claims and model inputs are traceable or explicitly assumed with sensitivity plans |
| 2 | Three or more model routes, tradeoff table, selected route, rejected alternatives, failure modes | Selection fits scoring, data, time, interpretability, and novelty without method stacking |
| 3 | Notation, assumptions, units, objectives, constraints, algorithms, validation metrics | Coder can implement without inventing math; assumptions and equations survive adversarial review |
| 4 | Reproducible code, raw outputs, tables, figures, baseline, ablation, sensitivity, robustness, result-density map, figure contact sheet | Reported values regenerate or trace; figures have source data; no cherry-picking; figure/table coverage is not sparse; no obvious generated chart defects |
| 5 | Prompt-by-prompt interpretation, captions, recommendations, limitations, uncertainty, figure/table coverage map | Each conclusion is supported, visual or tabular where useful, and answers a prompt task |
| 6 | Summary, coherent paper draft, references, appendix, AI-use statement when needed, final figure/table placement, rendered-PDF QA | Summary is result-first; narrative is coherent; citations, notation, figures, tables, and tasks align; rendered figures/tables are readable |
| 7 | Independent audits and ranked fix list | No unresolved high-severity risk remains |
| 8 | Final PDF/source/code/data notes/README/checklist package | Package is compliant, anonymous when required, clean of secrets and scratch artifacts |

## Phase 0: Intake And Scoring

Agents: `mathodology-lead`, `mathodology-problem-analyst`, `mathodology-critic`.

Deliver:

- prompt restatement
- required submission files
- scoring criteria and likely reviewer expectations
- task dependency graph
- ambiguity and assumption register

Critic gate: every prompt requirement maps to a planned output, official constraints are separated from assumptions, and only contest-critical ambiguities block user progress.

## Phase 1: Evidence And Data

Agents: `mathodology-evidence-researcher`, `mathodology-problem-analyst`.

Deliver:

- source inventory
- dataset and proxy data plan
- benchmark methods
- domain constraints
- citation notes

Critic gate: every planned model input has data, proxy logic, or an explicit assumption with a sensitivity or robustness plan.

## Phase 2: Candidate Model Routes

Agents: `mathodology-modeler`, `mathodology-evidence-researcher`, `mathodology-critic`.

Deliver:

- at least three candidate model routes
- tradeoff table
- selected route with rejection reasons for alternatives
- expected failure modes

Critic gate: selected route fits the problem, data, time budget, scoring criteria, interpretability, and novelty; rejected alternatives have concrete reasons.

## Phase 3: Mathematical Specification

Agents: `mathodology-modeler`, `mathodology-coder`, `mathodology-critic`.

Deliver:

- notation table
- assumptions
- objective functions
- constraints
- algorithms
- validation metrics
- experiment plan

Critic gate: coder can implement from the specification without inventing missing math; notation, units, assumptions, objectives, and validation metrics are internally consistent.

## Phase 4: Computation And Experiments

Agents: `mathodology-coder`, `mathodology-modeler`.

Deliver:

- reproducible scripts or notebooks
- raw outputs
- tables
- figures
- baseline, ablation, sensitivity, and robustness results
- result-density map covering model architecture, assumptions or parameters, primary comparison, sensitivity, robustness or uncertainty, decision tradeoffs, and final recommendation dashboard
- figure/table inventory and a contact sheet or equivalent visual QA artifact

Critic gate: reported numerical results are reproducible and logged; each figure/table has source data and no result is cherry-picked without disclosure; a paper-first run fails if the figure/table set is too sparse or if generated visuals show overlap, clipping, unreadable labels, or filler content.

## Phase 5: Interpretation

Agents: `mathodology-modeler`, `mathodology-evidence-researcher`, `mathodology-paper-editor`.

Deliver:

- result interpretation for each prompt task
- figure and table captions
- practical recommendations
- limitations and uncertainty notes
- claim-to-figure/table map for the most important conclusions

Critic gate: every result answers a prompt question and is supported by a figure, table, derivation, source, or explicit assumption; major conclusions are not text-only when a visual or table would make the comparison inspectable; limitations do not negate the recommendation.

## Phase 6: Paper Draft

Agents: `mathodology-paper-editor`, `mathodology-modeler`, `mathodology-coder`.

Deliver:

- abstract
- full paper draft
- equations and notation
- figures and tables
- references
- appendix material
- rendered-PDF QA evidence for figure/table placement and caption correctness

Critic gate: draft tells one coherent solution story, contains no orphan results, and passes summary, notation, figure/table density, caption, citation, rendered-PDF readability, and requirement-coverage checks.

## Phase 7: Independent Review

Agents: `mathodology-critic`, plus one re-run of the most relevant specialist for any major flaw.

Deliver:

- prompt coverage audit
- math validity audit
- reproducibility audit
- writing and scoring audit
- fix list ranked by severity

Critic gate: no unresolved blocker or high-severity issue remains; every medium issue has an owner, fix, or explicit risk acceptance.

## Phase 8: Final Package

Agents: `mathodology-submission-packager`, `mathodology-paper-editor`, `mathodology-critic`.

Deliver:

- final paper PDF
- editable source if required
- code
- data or data provenance notes
- figures and tables
- reproduction README
- AI-use statement if required
- final checklist

Critic gate: package can be submitted by a user who has not seen the working session and passes contest format, anonymity, size, AI-use, citation, no-secret, and requirement-to-file checks.
