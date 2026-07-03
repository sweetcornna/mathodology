---
name: mathodology-award-gates
description: Use when running Mathodology award-workflow phase gates, judge panels, structured handoffs, figure QA, or rendered-PDF QA in a contest run.
---

# Mathodology Award Gates

Canonical home for the runtime contracts of the Mathodology award workflow: the
structured run blocks, the severity ladder, the judge-panel aggregation rule,
the iteration budgets, the run layout, the blind seat protocol, and the QA
scripts. Agents and workflows point here instead of redefining these formats.

Role-specific extra keys (e.g. a coder's deviations note) live in the agent
definitions; this skill owns the shared schema every role must satisfy.

## 1. Structured Run Blocks

Every specialist ends with a `handoff:` block. Free-text handoffs are rejected.
Lint each block with `lint_run.py handoff` (see Scripts); every `artifacts[].path`
must resolve under `work/<run-id>/`.

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

The critic writes a `gate:` block per phase. `verdict: fail` on any unresolved
`blocker`/`high`. Lint with `lint_run.py gate`.

```yaml
gate:
  phase: 4
  loop: 0
  verdict: pass                # pass | fail
  issues:
    - {severity: high, summary: ..., artifact: ..., required_fix: ..., owner: mathodology-coder}
  evidence_checked: []
  missing_evidence: []
```

Each Phase-7 judge seat returns one `scorecard:` block. Weights sum to 1.0;
scores are 0-100. Lint with `lint_run.py scorecard`.

```yaml
scorecard:
  contest: MCM
  target_tier: outstanding
  seat: A                      # A | B | C
  round: 1
  criteria:
    - {name: ..., weight: 0.25, score: 82}   # weights sum to 1.0, scores 0-100
  weighted_total: 84.5
  implied_tier: meritorious
  fix_one_thing: "..."
  ranked_gaps: []
  do_not_regress: []
```

When a budget is exhausted the lead emits a `decision_memo:` and stops for a
human decision (never silently continues). Lint with `lint_run.py memo`.

```yaml
decision_memo:
  phase: 7
  budget_spent: {loops: 2, cap: 2}
  unresolved: []               # remaining issues with severity
  options:                     # 2-3 options, each {option, consequence, recommended: bool}
    - {option: ..., consequence: ..., recommended: true}
```

## 2. Severity Ladder

- `blocker`: violates contest rules, breaks prompt coverage, invalidates the model, prevents reproduction, or makes submission unsafe.
- `high`: likely to lower award level unless fixed, including sparse result presentation or visible figure/table rendering defects in a paper-first contest.
- `medium`: should be fixed or explicitly accepted with rationale.
- `low`: polish or minor clarity issue that does not affect correctness, scoring, reproducibility, or submission validity.

No `blocker` or `high` may remain before advancing a phase. `medium` needs an
owner, a fix plan, or an explicit, rationale-backed risk acceptance.

## 3. Judge Aggregation And Thresholds

Run the panel with `lint_run.py aggregate <scorecard files> --target <tier>`.
The panel PASSES only when all of:

- (a) every seat's `implied_tier` is at or above the target tier;
- (b) the minimum seat `weighted_total` clears the target's total threshold;
- (c) no single criterion, in any seat, falls below the target's floor.

Two seats differing by more than 20 on one criterion is an **evidence conflict**:
it is surfaced and adjudicated by the lead, never averaged away, and blocks a
clean pass until resolved.

| Target tier | Total >= | Criterion floor >= |
|---|---|---|
| Outstanding / 国一 | 85 | 70 |
| Finalist / 国一边缘 | 80 | 65 |
| Meritorious / 国二 | 75 | 60 |

Calibrate against real rarity: Outstanding is roughly the top 1-2%, 国一 roughly
the top 5-8%. Do not inflate scores to force a pass.

## 4. Iteration Budgets

- Each per-phase critic gate: at most 2 fix loops (3 evaluations total).
- Phase 7: at most 2 re-score rounds.
- Whole run: capped at 8 fix loops across all phases.
- Stop early whenever a loop shows no improvement over the previous one.
- On exhaustion of any budget: emit a `decision_memo:` and stop for a human.

## 5. Run Layout

Every run writes under a single gitignored `work/<run-id>/` tree; every handoff
artifact path resolves inside it:

```text
work/<run-id>/
  phase-logs/
  gates/                       # gates/phase-<n>-loop-<k>.yaml
  scorecards/                  # scorecards/phase7-seat-<A|B|C>-round-<r>.yaml
  evidence/
  outputs/
    figures/
    tables/
    data/
  paper/
  package/
```

## 6. Blind Judge Panel

Phase 7 dispatches three parallel `mathodology-award-judge` seats in a single
message with no shared context. Each seat receives ONLY its seat brief, the
rendered PDF, and the artifact manifest -- no phase log, no other seat's
scorecard, no cross-seat contact -- so the three scorecards are independent.

- **Seat A** -- the contest's flagship-tier general judge (MCM/ICM Outstanding,
  CUMCM 国一评审): scores overall award-worthiness against named criteria.
- **Seat B** -- a flagship-tier seat weighting innovation and decision-usefulness:
  is there a genuine modeling contribution, and does the recommendation help the
  named stakeholder?
- **Seat C** -- a skeptical applied-math referee scoring ONLY correctness and
  reproducibility: do the numbers regenerate and the math hold up?

Each seat scores contest-specific criteria 0-100 with weights, produces a
weighted total, maps it to a calibrated tier, and names the single most
award-limiting weakness ("if you fix only one thing"). The lead lints and
aggregates the three scorecards per Section 3.

## 7. Scripts

All four scripts ship with this skill and self-test with `--self-test`.
**Execute the shipped scripts -- do not reimplement their logic inline.** From a
cloned repo use the repo-relative path; from a global skill install the same
files live under `scripts/` in this skill's directory.

- `figqa.py` (matplotlib) -- bbox-collision gate. Importable
  (`from figqa import assert_no_overlap; assert_no_overlap(fig)`) and CLI. Wire
  `assert_no_overlap(fig)` into the figure factory and `run_all` so any
  text/annotation/legend overlap with data artists, or any clipped artist,
  **fails the run**. The coder copies `figqa.py` into the run's code directory so
  the submission package is self-contained and reruns the gate without the skill
  installed.
- `pdf_qa.sh` (poppler-utils: pdfinfo/pdftoppm/pdftotext) -- rendered-PDF QA:
  page-count, duplicate `Figure N:`/`Table N:` caption prefixes, metadata
  anonymity (`--anonymous`), and a blank-page heuristic, run against the
  **compiled PDF**.
- `make_contact_sheet.py` (poppler-utils + matplotlib) -- builds the chart-QA
  contact sheet FROM the compiled PDF via pdftoppm, never from source images.
- `lint_run.py` (PyYAML) -- validates the Section 1 blocks and runs the Section 3
  judge aggregation.

Repo-relative invocations:

```bash
python3 .claude/skills/mathodology-award-gates/scripts/figqa.py --self-test
python3 .claude/skills/mathodology-award-gates/scripts/lint_run.py handoff work/<run-id>/phase-logs/phase4.md
python3 .claude/skills/mathodology-award-gates/scripts/lint_run.py aggregate work/<run-id>/scorecards/phase7-seat-*.yaml --target outstanding
bash    .claude/skills/mathodology-award-gates/scripts/pdf_qa.sh work/<run-id>/paper/solution.pdf --max-pages 25 --anonymous
python3 .claude/skills/mathodology-award-gates/scripts/make_contact_sheet.py work/<run-id>/paper/solution.pdf -o work/<run-id>/outputs/figures/contact_sheet.png
```

Skill-relative wording (global install): run `scripts/figqa.py`,
`scripts/pdf_qa.sh`, `scripts/make_contact_sheet.py`, and `scripts/lint_run.py`
from this skill's directory. Prerequisites: matplotlib (figqa, contact sheet),
poppler-utils (pdf_qa, contact sheet), PyYAML (lint_run); each script prints an
actionable message when a prerequisite is missing.
