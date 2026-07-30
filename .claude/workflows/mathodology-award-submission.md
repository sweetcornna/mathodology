# Mathodology Award Submission Workflow

Use this workflow in Claude Code for national-first-prize or MCM/ICM O-prize level mathematical modeling submissions.

This file is canonical for Claude Code execution; `docs/WORKFLOWS.md` mirrors the shared phase model for humans and must not diverge from it.

## Operating Mode

1. Start with `mathodology-lead`.
2. Load `mathodology-whole-project`, `mathodology-agent-pipeline`, and `mathodology-award-gates` (the canonical home of the handoff/gate/scorecard schemas, judge thresholds, retry budgets, run layout, seat briefs, and QA scripts).
3. Run `mathodology-lead` as the MAIN Claude Code thread, never through the Agent tool. Subagents cannot spawn subagents, so a dispatched lead cannot dispatch the specialists this workflow requires. The lead orchestrates and scores; it does not self-author the work it must gate.
4. Run each phase in order.
5. Within each phase, dispatch the named specialist subagents in parallel when their tasks do not depend on each other, subject to the Dispatch rules below.
6. End every phase with a lead synthesis and critic gate.
7. Do not proceed past a gate with unresolved critical risks.

### Dispatch rules

Parallelism is a deliberate per-phase decision, not a default. Over-spawning on phases whose artifacts share state is a known failure mode.

- Phase 1 MAY split evidence work into two parallel `mathodology-evidence-researcher` invocations — one for source verification, one for data hunting — when the two do not depend on each other.
- Phase 2 dispatches TWO parallel `mathodology-modeler` invocations with disjoint route-family briefs before route selection, so the candidate routes are genuinely independent rather than variations on one idea.
- Phases 3-6 stay deliberately SERIAL. Their artifacts share state (spec → code → prose), each depends on the previous, and running them in parallel corrupts that chain. This is a decision, not an omission.
- Phase 7 dispatches THREE parallel `mathodology-award-judge` seats in a single message, with no shared context: each seat receives only its seat brief, the rendered PDF, and `work/<run-id>/package/manifest.md` (compiled by the lead at Phase 6 close) — never the target tier or thresholds — so the three scorecards are independent and un-anchored.

## Universal Artifact Contract

Every specialist subagent must end with a structured `handoff:` block. Free-text handoffs are rejected.

```yaml
handoff:
  phase: 4
  agent: mathodology-coder
  loop: 0                      # 0 = first attempt; increments per gate retry
  status: complete             # complete | partial | blocked
  artifacts:
    - {path: work/<run-id>/outputs/figures/sens.pdf, role: sensitivity}
  decisions: []
  assumptions: []              # each: {id: A7, text: ..., evidence: ...|assumed, sensitivity_plan: ...}
  evidence: []
  commands: []                 # exact rerun commands
  weaknesses: []
  questions: []                # empty unless contest-critical
  critic_focus: []
```

The lead lints every block with `python3 .claude/skills/mathodology-award-gates/scripts/lint_run.py handoff --agent <agent-name>` (the `--agent` flag also enforces the role-specific extra keys, e.g. the coder's `collision_gate_result`) and rejects any handoff that fails the schema or arrives as free text; every `artifacts[].path` must resolve under `work/<run-id>/`. The lead merges valid handoffs into the phase log. The critic reviews the phase log plus source artifacts and assigns `blocker`, `high`, `medium`, or `low` severity. Any `blocker` or `high` issue stops the workflow. `medium` issues need an owner, fix plan, or explicit risk acceptance.

## Canonical Run Layout

Every run writes under a single gitignored `work/<run-id>/` tree; every handoff artifact path resolves inside it:

```text
work/<run-id>/
  phase-logs/
  gates/                       # gates/phase-<n>-loop-<k>.yaml
  scorecards/                  # scorecards/phase7-seat-<A|B|C>-round-<r>.yaml
  evidence/
  code/                        # the coder's code and run_all.py
  outputs/
    figures/
    tables/
    data/
  paper/
  package/                     # incl. manifest.md, compiled by the lead at Phase 6 close
```

## Gate Iteration Budget

Fix loops are bounded so a run cannot churn indefinitely:

- Each per-phase critic gate allows at most 2 fix loops (3 evaluations total).
- Phase 7 allows at most 2 re-score rounds. These do not count against the whole-run cap: the initial panel is round 1, the two permitted re-scores are rounds 2 and 3 (max r = 3), filed as `scorecards/phase7-seat-<A|B|C>-round-<r>.yaml`.
- The whole run is capped at 8 fix loops across all phases.
- Stop early when a loop fails to improve. Improvement metric: a gate fix loop improves iff the count of open blocker+high issues strictly decreases (match findings by their stable `id`); a Phase 7 re-score improves iff the minimum seat weighted_total strictly increases.
- On exhaustion of any budget, the lead does NOT silently continue: it emits a `decision_memo:` block and stops for a human decision.

```yaml
decision_memo:
  phase: 7
  budget_spent: {loops: 2, cap: 2}
  unresolved: []               # remaining issues with severity
  options:                     # 2-3 options, each {option, consequence, recommended: bool}
    - {option: ..., consequence: ..., recommended: true}
```

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
- No chart rendering bugs: overlapping labels, clipped axes, unreadable text, legend or annotation boxes covering bars/points/lines, label text typeset over a foreign filled region, annotation boxes clipped at the axes edge, duplicated caption prefixes, orphaned figures, and incoherent table wrapping are gate failures in the rendered PDF (with the contact sheet built from the compiled PDF, not source images), not cosmetic nits. For a top-tier paper-first target this gate is enforced **programmatically** by the committed scripts: `figqa.assert_no_overlap(fig)` (the rendered `get_window_extent` bbox-collision check of text/annotation/legend artists against data artists, plus a clipped-artist check) is wired into every figure factory and `run_all.py`, so a zero-collision pass is evidenced by re-running `run_all.py` and observing exit 0 — `python3 .claude/skills/mathodology-award-gates/scripts/figqa.py --self-test` proves the gate itself works — and `bash .claude/skills/mathodology-award-gates/scripts/pdf_qa.sh` checks the compiled PDF. Their passing output is the required evidence — any collision fails the run, and hand-placed annotations in data coordinates plus low-resolution visual review are not a reliable gate on their own.
- No unscored top-tier target: a run targeting Outstanding / 国一 must pass an award-tier judge-panel scorecard (Phase 7); "competent but unremarkable" is a failure to reach the target, not a pass.

## Phase Review Matrix

| Phase | Specialist focus | Critic focus |
|---|---|---|
| 0 | Atomic requirement map, named-mechanism scope ledger, deliverables, scoring hypothesis, official constraints, ambiguity register | Every prompt clause has an output; every prompt-named mechanism is modeled or has a flagged descope; only material blockers are sent to the user |
| 1 | Source ledger, data dictionary, proxy logic, benchmark methods, citation plan, `citations_to_verify` list | Claims and model inputs are traceable or explicitly assumed with sensitivity plans; verification URLs resolve to primary works |
| 2 | Three or more model routes, tradeoff table, selected route, rejected alternatives, failure modes, innovation ledger | Selection fits scoring, data, time, interpretability, and novelty without method stacking; at least one genuine contribution is named or an award-ceiling risk is raised; selection rationale is model-agnostic |
| 3 | Notation, assumptions, units, objectives, constraints, algorithms, validation metrics, headline-number provenance | Coder can implement without inventing math; assumptions and equations survive adversarial review; headline numbers have a baseline and a stress-test plan |
| 4 | Reproducible code, raw outputs, tables, figures, baseline, ablation, sensitivity, robustness, result-density map, draft source-render figure sheet, deviations-from-spec and data-conditioning notes | Reported values regenerate or trace; figures have source data; no cherry-picking; CRN shared across compared runs; constraints reported as realized probabilities with MC-SE; by-construction results labeled; all-parameter recovery reported; figure/table coverage is not sparse; no obvious generated chart defects |
| 5 | Prompt-by-prompt interpretation, captions, recommendations, limitations, uncertainty, figure/table coverage map | Each conclusion is supported, visual or tabular where useful, and answers a prompt task |
| 6 | Summary, coherent paper draft, references, appendix, AI-use statement when needed, final figure/table placement, single canonical recommendation, innovation-ledger (INN-n) and scope-ledger (MECH-n) closeout, rendered-PDF QA | Summary is result-first; recommendation is consistent across summary/body/memo/conclusion; marginal claims name baselines; citations have confirmed specifics; every INN-n and MECH-n ledger entry is load-bearing in the draft or explicitly descoped in limitations; narrative is coherent; rendered figures/tables are readable; no wasted pages |
| 7 | Critic-run independent audits and ranked fix list; lead-dispatched three-seat `mathodology-award-judge` panel, each returning one `scorecard:` block | No unresolved high-severity risk remains; lead validates each scorecard with lint_run.py and aggregates per the judge thresholds; panel passes only when every seat's implied tier meets the target, min total clears the threshold, and no criterion falls below its floor; re-score capped at 2 rounds, then a decision_memo |
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

Agents: `mathodology-evidence-researcher`, `mathodology-problem-analyst`, `mathodology-critic`.

Deliver:

- source inventory
- dataset and proxy data plan
- benchmark methods
- domain constraints
- citation notes

Evidence acquisition follows `.claude/skills/mathodology-evidence-search/SKILL.md`: `mcp__search__*` (free-search-mcp) as the primary stack with `category=paper`/`dataset` routing to the literature and dataset databases, `WebSearch`/`WebFetch` as the declared fallback, and `search_backend` recorded in the handoff either way.

Critic gate: every planned model input has data, proxy logic, or an explicit assumption with a sensitivity or robustness plan; blocked or gated searches are reported as `missing_evidence` rather than silently treated as evidence of absence.

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

Agents: `mathodology-coder`, `mathodology-modeler`, `mathodology-critic`.

Deliver:

- reproducible scripts or notebooks
- raw outputs
- tables
- figures
- baseline, ablation, sensitivity, and robustness results
- result-density map covering model architecture, assumptions or parameters, primary comparison, sensitivity, robustness or uncertainty, decision tradeoffs, and final recommendation dashboard
- figure/table inventory and a **draft** visual QA sheet built from the source figure renders (coverage/density review only — the authoritative contact sheet is built from the compiled PDF at Phase 6 via `make_contact_sheet.py`)

Critic gate: reported numerical results are reproducible and logged; each figure/table has source data and no result is cherry-picked without disclosure; a paper-first run fails if the figure/table set is too sparse or if generated visuals show overlap, clipping, unreadable labels, or filler content.

## Phase 5: Interpretation

Agents: `mathodology-modeler`, `mathodology-evidence-researcher`, `mathodology-paper-editor`, `mathodology-critic`.

Deliver:

- result interpretation for each prompt task
- figure and table captions
- practical recommendations
- limitations and uncertainty notes
- claim-to-figure/table map for the most important conclusions

Critic gate: every result answers a prompt question and is supported by a figure, table, derivation, source, or explicit assumption; major conclusions are not text-only when a visual or table would make the comparison inspectable; limitations do not negate the recommendation.

## Phase 6: Paper Draft

Agents: `mathodology-paper-editor`, `mathodology-modeler`, `mathodology-coder`, `mathodology-critic`.

Deliver:

- abstract
- full paper draft
- equations and notation
- figures and tables
- references
- appendix material
- innovation-ledger (INN-n) and scope-ledger (MECH-n) closeout: each ledger entry is either load-bearing in the draft or explicitly descoped in the limitations section, mirroring the citation closeout
- the compiled PDF (`work/<run-id>/paper/solution.pdf`, compiled by the paper-editor, with the exact compile command recorded in its handoff)
- rendered-PDF QA evidence for figure/table placement and caption correctness, plus the authoritative compiled-PDF contact sheet
- at phase close, the lead compiles the artifact manifest `work/<run-id>/package/manifest.md` (rendered PDF path plus figures, tables, data, and code paths) for the Phase-7 judge seats

Critic gate: draft tells one coherent solution story, contains no orphan results, and passes summary, notation, figure/table density, caption, citation, rendered-PDF readability, and requirement-coverage checks; every innovation-ledger (INN-n) and scope-ledger (MECH-n) entry is traced to a load-bearing use in the draft or an explicit descope in limitations, with no ledger entry left dangling.

## Phase 7: Independent Review And Award-Tier Scoring

Agents: `mathodology-critic` (audits), three blind `mathodology-award-judge` seats (scoring, dispatched by the lead), plus one re-run of the most relevant specialist for any major flaw.

The audits stay with `mathodology-critic`. The award-tier scorecard is NOT written by the critic or the lead: the lead dispatches three parallel, blind `mathodology-award-judge` seats in a single message, each with no shared context and receiving only its seat brief, the rendered PDF, and `work/<run-id>/package/manifest.md` — never the target tier or the pass thresholds.

Critic delivers:

- prompt coverage audit, including a check that no prompt-named mechanism was silently descoped
- math validity audit
- originality audit: is there a genuine modeling contribution, or only competent textbook application?
- paper-vs-code conformance audit and quantitative-claim baseline audit
- headline-robustness audit against the least well-recovered parameters
- recommendation-consistency and citation-closeout audit
- reproducibility audit
- writing and scoring audit
- fix list ranked by severity
- skill attribution: for each weakness, the agent/workflow gate that should have caught it

Judge panel: the lead dispatches three seats, each returning exactly one `scorecard:` block. Seat briefs are built from the canonical rubrics in the mathodology-award-gates skill — all seats score the shared criteria `summary`, `modeling`, `results` (so cross-seat conflict detection has overlap), plus their seat-specific criteria:

- Seat A — contest flagship-tier general judge (adds `writing`, `completeness`).
- Seat B — flagship-tier judge weighting innovation and decision-usefulness (adds `innovation`, `evidence`).
- Seat C — skeptical applied-math referee (adds `correctness`, `reproducibility`, weighted heaviest).

```yaml
scorecard:
  contest: MCM
  seat: A                      # A | B | C; no target_tier -- seats are blind to the target
  round: 1
  criteria:                    # one row per criterion; weights sum to 1.0
    - {name: summary, weight: 0.25, score: 82}
    - {name: modeling, weight: 0.25, score: 80}
    - {name: results, weight: 0.20, score: 84}
    - {name: writing, weight: 0.15, score: 85}
    - {name: completeness, weight: 0.15, score: 83}
  weighted_total: 82.4
  implied_tier: finalist       # by weighted-total band; tier_justification required to go below it
  fix_one_thing: "..."
  ranked_gaps: []
  do_not_regress: []
```

Aggregation (lead-run): the lead validates each seat's block with `python3 .claude/skills/mathodology-award-gates/scripts/lint_run.py scorecard`, then aggregates one round at a time with `lint_run.py aggregate work/<run-id>/scorecards/phase7-seat-*-round-<r>.yaml --target <tier>` (the lead supplies the target only here — a bare `phase7-seat-*.yaml` glob would mix rounds and be rejected as duplicate seats). The panel passes only when (a) every seat's `implied_tier` meets or exceeds the target tier, (b) the minimum `weighted_total` across seats clears the threshold, (c) no single criterion falls below its floor, and (d) no unresolved evidence conflict remains — two seats disagreeing by more than 20 on a shared criterion is a conflict the lead must adjudicate: examine both seats' cited artifact evidence, re-dispatch ONLY the outlier seat once with the specific evidence question (this consumes one re-score round), and record the outcome in the decision_memo; never average it away. Thresholds: Outstanding / 国一 → total ≥ 85, floor 70; Finalist / 国一边缘 → 80 / 65; Meritorious / 国二 → 75 / 60. `lint_run.py aggregate` enforces all four conditions.

Critic gate: no unresolved blocker or high-severity issue remains and every medium issue has an owner, fix, or explicit risk acceptance; and the judge panel passes per the aggregation rule above. If the panel fails — any seat below the target tier, min total under threshold, a below-floor criterion, or an unresolved >20 shared-criterion conflict — the lead dispatches a targeted improvement loop on the lowest-scoring dimension (most often an originality or scope gap, since those set the ceiling) and re-scores. Re-score is capped at 2 rounds; on exhaustion the lead emits a `decision_memo:` block and stops rather than shipping. Do not treat a correct, reproducible, unremarkable submission as done when the target is the flagship tier.

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
