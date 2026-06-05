# Mathodology Award Submission Workflow

Use this workflow in Claude Code for national-first-prize or MCM/ICM O-prize level mathematical modeling submissions.

## Operating Mode

1. Start with `mathodology-lead`.
2. Load `mathodology-whole-project` and `mathodology-agent-pipeline`.
3. Run each phase in order.
4. Within each phase, dispatch the named specialist subagents in parallel when their tasks do not depend on each other.
5. End every phase with a lead synthesis and critic gate.
6. Do not proceed past a gate with unresolved critical risks.

## Phase 0: Intake And Scoring

Agents: `mathodology-lead`, `mathodology-problem-analyst`, `mathodology-critic`.

Deliver:

- prompt restatement
- required submission files
- scoring criteria and likely reviewer expectations
- task dependency graph
- ambiguity and assumption register

Gate: every prompt requirement maps to a planned output.

## Phase 1: Evidence And Data

Agents: `mathodology-evidence-researcher`, `mathodology-problem-analyst`.

Deliver:

- source inventory
- dataset and proxy data plan
- benchmark methods
- domain constraints
- citation notes

Gate: every planned model input has data, proxy logic, or an explicit assumption.

## Phase 2: Candidate Model Routes

Agents: `mathodology-modeler`, `mathodology-evidence-researcher`, `mathodology-critic`.

Deliver:

- at least three candidate model routes
- tradeoff table
- selected route with rejection reasons for alternatives
- expected failure modes

Gate: selected route fits the problem, available data, time budget, and scoring criteria.

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

Gate: coder can implement from the specification without inventing missing math.

## Phase 4: Computation And Experiments

Agents: `mathodology-coder`, `mathodology-modeler`.

Deliver:

- reproducible scripts or notebooks
- raw outputs
- tables
- figures
- baseline, ablation, sensitivity, and robustness results

Gate: reported numerical results are reproducible and logged.

## Phase 5: Interpretation

Agents: `mathodology-modeler`, `mathodology-evidence-researcher`, `mathodology-paper-editor`.

Deliver:

- result interpretation for each prompt task
- figure and table captions
- practical recommendations
- limitations and uncertainty notes

Gate: every result answers a prompt question and is supported by a figure, table, derivation, or source.

## Phase 6: Paper Draft

Agents: `mathodology-paper-editor`, `mathodology-modeler`, `mathodology-coder`.

Deliver:

- abstract
- full paper draft
- equations and notation
- figures and tables
- references
- appendix material

Gate: draft tells one coherent solution story and contains no orphan results.

## Phase 7: Independent Review

Agents: `mathodology-critic`, plus one re-run of the most relevant specialist for any major flaw.

Deliver:

- prompt coverage audit
- math validity audit
- reproducibility audit
- writing and scoring audit
- fix list ranked by severity

Gate: no unresolved high-severity issue remains.

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

Gate: package can be submitted by a user who has not seen the working session.
