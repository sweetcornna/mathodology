# Mathodology Contest Variant Workflows

Use this workflow in Claude Code when the user names a specific mathematical modeling contest type or asks for a workflow beyond the default MCM/ICM and CUMCM modes.

## Operating Mode

1. Start with `mathodology-lead`.
2. Load `mathodology-whole-project`, `mathodology-agent-pipeline`, and `mathodology-award-gates` (the canonical home of the handoff/gate/scorecard schemas, judge thresholds, retry budgets, and QA scripts this workflow depends on).
3. In Phase 0, classify the contest type and record official rules, deadline, language, file limits, identity policy, code policy, AI-use policy, and final package requirements.
4. Apply exactly one primary adapter. Add secondary gates only when the official rules require them.
5. Keep the universal structured `handoff:` contract and independent `mathodology-critic` gate from `mathodology-award-submission.md`.
6. Keep the universal award gates from `mathodology-award-submission.md` for any top-tier target, regardless of adapter: the innovation ledger (at least one genuine modeling contribution or an explicit award-ceiling risk), the named-mechanism scope ledger (no silently descoped prompt mechanism), the Phase 6 ledger closeout (every INN-n and MECH-n entry either load-bearing in the draft or explicitly descoped in limitations), the headline-robustness stress test, recommendation consistency, paper-vs-code conformance, the Phase 7 three-seat award-tier judge-panel scorecard, and the gate iteration budgets (max 2 fix loops per critic gate, max 2 Phase 7 re-score rounds, whole-run cap of 8 fix loops, then a decision_memo). Adapters below add contest-specific emphasis; they do not relax these.
7. If the contest type is not listed below, classify it with the Unlisted-Contest Classifier at the end of this file and synthesize the closest adapter rather than defaulting to MCM.
8. If official contest rules conflict with this workflow, official rules win.

## Tier Thresholds

Each adapter's tier names map to the numeric thresholds defined in the `mathodology-award-gates` skill, not restated here. An adapter names only which tier label is its contest's flagship tier and which is its second tier (for example: MCM/ICM Outstanding and Meritorious; CUMCM 国一 and 国二; MathorCup 一等奖 and 二等奖). It must not restate or alter the pass totals or per-criterion floors — the lead reads those numbers from the skill when aggregating the Phase 7 judge panel.

In `target_tier`, `implied_tier`, and `--target`, seats and the lead use the canonical tokens (`outstanding` | `finalist` | `meritorious`) or a documented alias (`国一`, `国二`, `国一边缘`, `一等奖`, `二等奖` — `lint_run.py` accepts these); the contest's local tier label is recorded only in the `variant:` block. An undocumented local label (e.g. a sponsor cup's own tier name) in `implied_tier` cannot be ranked and fails aggregation.

## Adapter: MCM/ICM O-Prize

Use for COMAP undergraduate MCM/ICM.

Lead emphasis:

- protect the 25-page solution budget
- force a result-first summary sheet
- require enough purposeful figures and tables to make the model, comparisons, sensitivity, robustness, and recommendations inspectable
- require AI-use disclosure and citation discipline
- keep source, model, experiment, and paper work synchronized
- for MCM A/B/C (continuous, discrete, data insights): C rewards a defensible data pipeline, leakage control, and honest uncertainty over model exoticism; A/B reward an original modeling mechanism and clean sensitivity
- for ICM D/E/F (operations/network, sustainability, policy): judges reward genuine interdisciplinarity, a defensible metric/index construction, stakeholder framing, and decision-usefulness; a purely technical model with no policy translation caps the award

Critic gate:

- summary explains approach and most important conclusions
- no identifying information appears outside allowed control number
- every outside source and AI use is disclosed
- references, appendix, code, and problem-specific requirements fit the official page policy
- paper does not overrun the page limit by hiding essentials in appendices
- figure/table coverage is substantive without becoming filler or crowding out explanation
- for ICM problems, any constructed index/metric is justified, its sensitivity to weights is shown, and the recommendation is translated for the named stakeholder

## Adapter: CUMCM National-First-Prize

Use for Chinese national undergraduate mathematical modeling contests and similar paper-plus-support-material competitions.

Lead emphasis:

- separate paper PDF from support archive
- maintain an appendix file list
- keep runnable code and data provenance aligned with paper claims
- require a dense but readable figure/table system for model structure, result comparison, sensitivity, robustness, and final recommendations
- check anonymity and similarity-risk language early

Critic gate:

- paper and support archive agree on files, code, data, figures, and results
- source programs are complete enough to run or the paper explicitly explains no code was used
- no school, region, advisor, or team identity appears in prohibited locations
- support archive contains no secrets, scratch files, caches, or unrelated material
- core results survive spot reproduction
- figure/table inventory in the support archive matches the paper and source code

## Adapter: HiMCM / MidMCM

Use for high-school COMAP-style contests with longer windows and English PDF submissions.

Lead emphasis:

- make the method defensible by secondary-school students
- keep language readable and avoid unnecessary advanced machinery
- select the problem early and justify the selection
- document outside sources and AI use clearly

Critic gate:

- the team can explain the model honestly in plain language
- English paper is anonymous, readable, and properly cited
- AI-use disclosure is present when needed
- assumptions and computations are not beyond what the team can defend
- final answer favors clarity and correctness over sophistication

## Adapter: IMMC / IM2C

Use for International Mathematical Modeling Challenge workflows.

Lead emphasis:

- manage the consecutive 5-day window
- plan translation time when local-language drafting is allowed
- keep the submission paper self-contained because software packages are not judged
- explain algorithms in words, diagrams, or flowcharts

Critic gate:

- translation does not improve, alter, or hide weaknesses in the original work
- summary and table of contents follow contest structure
- control number and page headers are correct
- algorithm, testing, sensitivity, error analysis, strengths, and weaknesses are understandable without code attachments
- advisor forms and authorization requirements are not mixed into the solution paper unless rules require it

## Adapter: M3 Challenge

Use for MathWorks Math Modeling Challenge.

Lead emphasis:

- run a 14-hour sprint plan with strict checkpoints
- produce a complete baseline before pursuing refinements
- embed all charts, tables, code, and graphics in one PDF
- prepare final-event validation answers for finalists or technical computing awards

Suggested sprint checkpoints:

- Hour 0-1: problem read, requirement map, data plan, baseline route
- Hour 1-4: baseline model and first numerical answer
- Hour 4-7: improved model, validation, sensitivity
- Hour 7-10: paper body, figures, result interpretation
- Hour 10-12: summary, appendix, PDF assembly
- Hour 12-14: critic pass, upload rehearsal, final submission

Critic gate:

- a complete viable answer exists before polishing begins
- single PDF is under size guidance and preserves formatting after conversion
- main body is concise enough for judges to read quickly
- technical computing advances insight and includes accuracy or correctness checks
- final results can be defended orally in a validation round

## Adapter: Data-Science Leaderboard Contest

Use for Kaggle-like, DrivenData-like, Tianchi-like, or enterprise metric-based modeling contests.

Lead emphasis:

- treat official metric and sample submission as the scoring surface
- separate public leaderboard feedback from true validation
- prevent data leakage and target leakage
- build a reproducible pipeline and submission generator

Phase changes:

- Phase 1 adds data schema, leakage audit, train/test split policy, and metric reimplementation.
- Phase 2 compares baseline, feature, model-family, and ensembling routes.
- Phase 3 specifies validation folds, feature pipeline, inference path, and submission schema.
- Phase 4 logs local validation, public leaderboard submissions, private-risk estimates, and seed variance.
- Phases 5-6 produce a **reproducibility report + validation study** instead of a contest paper: pipeline description, validation design and results, leakage audit, ablations, seed variance, and private-leaderboard risk assessment, compiled to a PDF so the rendered-PDF gates still apply.
- Phase 7 keeps the three-seat judge panel: seats score the reproducibility report + validation study (in place of a contest paper) with the same shared criteria, where `summary` = the report's executive summary, `results` = validation quality and private-LB risk honesty. Medal-style tier labels map onto the threshold rows (top medal → the outstanding row, second medal → the finalist row); the lead records the mapping in the `variant:` block and uses the canonical tokens in `--target`.
- Phase 8 packages code, model artifacts when allowed, submission file, and reproduction instructions.

Critic gate:

- local validation mirrors the official metric
- sample submission schema is matched exactly
- no leakage from test data, public leaderboard, timestamps, IDs, or target-derived features
- public leaderboard improvements are not accepted without local validation support
- final submission can be regenerated from clean inputs

## Adapter: Operations, Policy, Or Business Case Contest

Use for logistics, energy, finance, healthcare, public-policy, business analytics, or consulting-style modeling competitions.

Lead emphasis:

- define stakeholders and decision horizon
- separate objectives, constraints, decisions, and uncertainties
- produce actionable recommendations, not only fitted models
- use decision dashboards, scenario tables, and tradeoff figures to make recommendations reviewable
- quantify cost, feasibility, risk, and implementation tradeoffs

Critic gate:

- recommendations follow from model outputs and constraints
- assumptions are acceptable to the stakeholder, not only mathematically convenient
- scenarios cover best, expected, and adverse cases
- sensitivity analysis identifies decision-changing variables
- implementation plan is feasible under time, budget, data, and policy constraints

## Adapter: Short Sprint Or Campus Invitational

Use for 6-24 hour local contests, training contests, or light-format invitational events.

Lead emphasis:

- secure one complete solution early
- avoid over-engineering and fragile computations
- keep evidence lightweight but explicit
- prioritize readable result delivery

Critic gate:

- every required question has at least one answer before refinement begins
- model is simple enough to finish and explain
- final paper or report is internally consistent
- no optional improvement blocks a valid submission
- final package can be exported and submitted within the remaining time

## Adapter: 研究生数学建模竞赛 / 华为杯 (China Postgraduate Mathematical Contest in Modeling)

Use for the China Postgraduate Mathematical Contest in Modeling ("华为杯", graduate-level) and
similar graduate contests with longer windows (typically four days), real industry/scientific
data, and an open-ended brief.

Lead emphasis:

- the problems are harder, more open, and often backed by real, messy data — engage the actual
  data and its imperfections, do not retreat to a clean toy model
- depth over breadth: graduate judges reward a deep, correct treatment of the hard core over a
  broad shallow sweep of every sub-question
- the innovation ledger matters more here than in undergraduate contests — a graduate 一等奖
  expects a non-obvious modeling or algorithmic contribution, not a textbook pipeline
- keep a complete, runnable code + data-provenance appendix; results must survive reproduction
- manage the multi-day window with a working baseline early, then deepen

Critic gate:

- the hard core of the problem is solved deeply and correctly, not skimmed
- real data is engaged honestly (missingness, noise, scale) with disclosed conditioning
- at least one genuine modeling/algorithmic contribution is present and defended
- results are reproducible from the delivered code and data notes
- paper, code, and appendix agree on files, methods, figures, and numbers
- anonymity, format, and submission-system requirements match the official rules

## Adapter: APMCM 亚太地区大学生数学建模竞赛 (Asia-Pacific)

Use for the Asia and Pacific Mathematical Contest in Modeling (English or Chinese track).

Lead emphasis:

- COMAP-style judging expectations on a shorter window: result-first summary, clean figures,
  defensible model, honest sensitivity
- confirm the submission language and template from the official rules; keep the paper anonymous
- a purposeful but not bloated figure/table system; protect readability over volume

Critic gate:

- summary is result-first and standalone
- model is defensible and specific to the prompt, with at least one non-generic move
- sensitivity/robustness present; recommendations follow from results
- language, template, anonymity, and file rules match the official APMCM policy

## Adapter: MathorCup / themed domestic cup (电工杯, 数维杯, 深圳杯, 小美赛, and similar)

Use for MathorCup and other domestic themed or sponsor-run cups with paper-plus-code submission
and a 一/二/三等奖 structure.

Lead emphasis:

- read the specific cup's rules each time — page policy, support-material policy, anonymity, and
  template vary by cup and by year
- match the depth to the window: secure one complete, defensible solution, then add a focused
  contribution rather than over-engineering
- keep code runnable and figures readable; many of these cups weight presentation heavily
- for theme-sponsored cups (energy, finance, transport), translate results into the sponsor's
  decision language

Critic gate:

- every required question has at least one defensible answer before refinement
- the paper is internally consistent and the recommendation is unified across summary, body, memo
- code and data provenance align with the paper's claims
- format, anonymity, and support-archive rules match that specific cup's official document
- presentation quality (figures, tables, layout) is competition-grade for a presentation-weighted cup

## Unlisted-Contest Classifier

When the contest is not one of the adapters above, do not default to MCM. In Phase 0, classify
it along these axes and synthesize the closest adapter, recording the choice in the variant
handoff:

- deliverable: single self-contained paper PDF, or paper plus support/code archive, or a
  metric-scored submission file?
- judging surface: human-judged narrative quality, or an automatic leaderboard metric, or both?
- window: hours (sprint), days (standard), or a week-plus (graduate/open)?
- level: secondary school, undergraduate, graduate, or open/professional?
- language and identity policy, page/size limits, code policy, AI-use policy.
- domain framing: pure modeling, data-science/ML, operations/policy/business, or interdisciplinary?

Map each axis to the nearest adapter's emphasis (e.g. leaderboard → Data-Science Leaderboard
adapter; week-plus graduate → 研究生/华为杯 adapter; hours → Short Sprint adapter; policy framing
→ Operations/Policy/Business adapter) and combine their lead emphases and critic gates. Keep all
universal award gates. State explicitly which existing adapter(s) you synthesized from and why.

## Variant Handoff

After Phase 0, the lead appends a structured `variant:` block to the phase log (no free text):

```yaml
variant:
  contest: <official contest type>
  target_tier: <flagship tier label for this contest, e.g. Outstanding / 国一 / 一等奖>
  adapter: <primary adapter applied, e.g. MCM/ICM O-Prize>
  emphasis: []                 # adapter lead-emphasis points shaping this run
  gates_added: []              # secondary gates the official rules require on top of the universal gates
  thresholds_ref: mathodology-award-gates   # numeric tier thresholds live in the skill; do not restate them here
  official_rules_source: <url or citation>
  deadline: <date + timezone>
  language: <submission language>
  limits: {pages: ..., files: ..., size: ...}
  identity_policy: <anonymity rules>
  code_policy: <code and support-material policy>
  ai_use_policy: <AI-use disclosure policy>
  user_confirmations: []       # empty unless a rule needs user sign-off
```
