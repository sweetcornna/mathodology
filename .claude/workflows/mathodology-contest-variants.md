# Mathodology Contest Variant Workflows

Use this workflow in Claude Code when the user names a specific mathematical modeling contest type or asks for a workflow beyond the default MCM/ICM and CUMCM modes.

## Operating Mode

1. Start with `mathodology-lead`.
2. Load `mathodology-whole-project` and `mathodology-agent-pipeline`.
3. In Phase 0, classify the contest type and record official rules, deadline, language, file limits, identity policy, code policy, AI-use policy, and final package requirements.
4. Apply exactly one primary adapter. Add secondary gates only when the official rules require them.
5. Keep the universal `Agent handoff` and independent `mathodology-critic` gate from `mathodology-award-submission.md`.
6. If official contest rules conflict with this workflow, official rules win.

## Adapter: MCM/ICM O-Prize

Use for COMAP undergraduate MCM/ICM.

Lead emphasis:

- protect the 25-page solution budget
- force a result-first summary sheet
- require enough purposeful figures and tables to make the model, comparisons, sensitivity, robustness, and recommendations inspectable
- require AI-use disclosure and citation discipline
- keep source, model, experiment, and paper work synchronized

Critic gate:

- summary explains approach and most important conclusions
- no identifying information appears outside allowed control number
- every outside source and AI use is disclosed
- references, appendix, code, and problem-specific requirements fit the official page policy
- paper does not overrun the page limit by hiding essentials in appendices
- figure/table coverage is substantive without becoming filler or crowding out explanation

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

## Variant Handoff

After Phase 0, the lead should append this to the phase log:

```text
Contest variant:
- Contest type:
- Official rules source:
- Deadline and timezone:
- Language:
- Page, file, and size limits:
- Identity/anonymity rules:
- Code and support-material policy:
- AI-use policy:
- Adapter-specific gates:
- User confirmations needed:
```
