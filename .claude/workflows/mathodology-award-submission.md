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
- No textbook-only modeling: competent application of standard tools tops out at Meritorious / 国二. At least one genuine modeling contribution (a non-obvious mechanism, an analytic result, a non-obvious synthesis, a harder-than-asked extension, or a sharper validation/robustness argument) must be named, justified, and defended; a run that cannot offer one must raise an explicit award-ceiling risk rather than disguise textbook work as a contribution. For synthetic-data problems, "recovers/matches the data-generating family" is forbidden as the headline contribution or selection rationale.
- No silent descoping: every phenomenon the prompt names explicitly must be modeled or carry a justified, flagged descope decision; quietly folding a named mechanism into a coarser proxy is a scoring risk, not a simplification.
- No untraceable numbers: every number must map to code, data, derivation, citation, or documented manual calculation.
- No fragile headline: every headline number — especially a binding constraint met within its Monte-Carlo / numeric error of its threshold — must be stress-tested against the parameters that control it, including the least well-recovered ones.
- No unsupported assumptions: each major assumption needs evidence, derivation, or sensitivity analysis.
- No single-route modeling: at least three model routes must be considered before selection, and model-structure selection must rest on model-agnostic grounds (information criteria on the fitted likelihood, parsimony, out-of-sample skill, interpretability).
- No definitional free lunch: a benefit or cost that is forced by construction (rescaling, normalization, hard cap) must be labeled "by construction" and its real cost reported, never presented as a discovered result.
- No paper-vs-code drift: every method described in the paper must match the delivered code, not merely the spec; implementation deviations from the spec are recorded and the prose corrected.
- No divergent recommendation: the recommended decision and all its numeric settings must be identical across the summary sheet, every in-text recommendation, the memo, and the conclusion.
- No unverified citation specifics: a citation may print page/volume/edition numbers only when verification is confirmed against the primary publisher record.
- No unaudited artifact: each phase output must pass an independent critic gate before reuse.
- No paper-only polish: computation, source tracing, and reproducibility must be strong enough for reviewer spot checks; compared policies/scenarios share common random numbers and probabilistic constraints are reported as realized simulation probabilities with Monte-Carlo SE.
- No hidden compliance risk: page, size, anonymity, AI-use, citation, and final package rules are gate items checked against the rendered PDF, not final chores.
- No sparse result presentation: paper-first contests need a purposeful figure/table system that covers model structure, key comparisons, sensitivity, robustness or uncertainty, decision tradeoffs, and final recommendations.
- No filler visuals and no wasted pages: extra figures or tables count only when they are reproducible, interpreted, non-duplicative, and tied to a prompt-level conclusion; no full page may reprint a table already shown and no near-empty low-information panel may occupy space a denser figure would use.
- No chart rendering bugs: overlapping labels, clipped axes, unreadable text, legend or annotation boxes covering bars/points/lines, duplicated caption prefixes, orphaned figures, and incoherent table wrapping are gate failures in the rendered PDF (with the contact sheet built from the compiled PDF, not source images), not cosmetic nits.
- No unscored top-tier target: a run targeting Outstanding / 国一 must pass an award-tier judge-panel scorecard (Phase 7); "competent but unremarkable" is a failure to reach the target, not a pass.

## Phase Review Matrix

| Phase | Specialist focus | Critic focus |
|---|---|---|
| 0 | Atomic requirement map, named-mechanism scope ledger, deliverables, scoring hypothesis, official constraints, ambiguity register | Every prompt clause has an output; every prompt-named mechanism is modeled or has a flagged descope; only material blockers are sent to the user |
| 1 | Source ledger, data dictionary, proxy logic, benchmark methods, citation plan, `citations_to_verify` list | Claims and model inputs are traceable or explicitly assumed with sensitivity plans; verification URLs resolve to primary works |
| 2 | Three or more model routes, tradeoff table, selected route, rejected alternatives, failure modes, innovation ledger | Selection fits scoring, data, time, interpretability, and novelty without method stacking; at least one genuine contribution is named or an award-ceiling risk is raised; selection rationale is model-agnostic |
| 3 | Notation, assumptions, units, objectives, constraints, algorithms, validation metrics, headline-number provenance | Coder can implement without inventing math; assumptions and equations survive adversarial review; headline numbers have a baseline and a stress-test plan |
| 4 | Reproducible code, raw outputs, tables, figures, baseline, ablation, sensitivity, robustness, result-density map, figure contact sheet, deviations-from-spec and data-conditioning notes | Reported values regenerate or trace; figures have source data; no cherry-picking; CRN shared across compared runs; constraints reported as realized probabilities with MC-SE; by-construction results labeled; all-parameter recovery reported; figure/table coverage is not sparse; no obvious generated chart defects |
| 5 | Prompt-by-prompt interpretation, captions, recommendations, limitations, uncertainty, figure/table coverage map | Each conclusion is supported, visual or tabular where useful, and answers a prompt task |
| 6 | Summary, coherent paper draft, references, appendix, AI-use statement when needed, final figure/table placement, single canonical recommendation, rendered-PDF QA | Summary is result-first; recommendation is consistent across summary/body/memo/conclusion; marginal claims name baselines; citations have confirmed specifics; narrative is coherent; rendered figures/tables are readable; no wasted pages |
| 7 | Independent audits, ranked fix list, and an award-tier judge-panel scorecard | No unresolved high-severity risk remains; every judge seat places the work at or above the targeted award tier, or the weakest dimension is returned to the lead for an improvement loop |
| 8 | Final PDF/source/code/data notes/README/checklist package | Package is compliant (checked against the rendered PDF), anonymous when required, clean of secrets and scratch artifacts |

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

## Phase 7: Independent Review And Award-Tier Scoring

Agents: `mathodology-critic`, plus one re-run of the most relevant specialist for any major flaw.

Deliver:

- prompt coverage audit, including a check that no prompt-named mechanism was silently descoped
- math validity audit
- originality audit: is there a genuine modeling contribution, or only competent textbook application?
- paper-vs-code conformance audit and quantitative-claim baseline audit
- headline-robustness audit against the least well-recovered parameters
- recommendation-consistency and citation-closeout audit
- reproducibility audit
- writing and scoring audit
- fix list ranked by severity
- an **award-tier judge-panel scorecard**: at least three independent judge seats appropriate to
  the contest, each scoring named criteria 0–100 with weights, a weighted total, and a calibrated
  award tier; the single most award-limiting weakness per seat; ranked gaps to the top tier; and a
  do-not-regress list of what already works at award level
- skill attribution: for each weakness, the agent/workflow gate that should have caught it

Critic gate: no unresolved blocker or high-severity issue remains; every medium issue has an
owner, fix, or explicit risk acceptance; and for a top-tier target, every judge seat places the
work at or above the targeted award tier. If any seat scores below the target (e.g. high
Meritorious for an Outstanding target, or 国二 for a 国一 target), the lead must dispatch a targeted
improvement loop on the lowest-scoring dimension — most often an originality or scope gap, since
those set the ceiling — and re-score before Phase 8. Do not treat a correct, reproducible,
unremarkable submission as done when the target is the flagship tier.

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
