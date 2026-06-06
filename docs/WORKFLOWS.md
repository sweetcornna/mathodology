# Mathodology Agent Workflows

Mathodology has two supported orchestration modes:

- Claude Code: workflow-first with project subagents.
- Codex: multi-agent phase execution with parallel task agents and synthesis gates.

Both modes target national-first-prize or MCM/ICM O-prize level modeling work: complete prompt coverage, defensible math, reproducible computation, polished paper, and a submission-ready package.

## External Quality Signals

Use these signals to calibrate the workflow. They are not templates to copy; they are constraints and reviewer expectations to convert into gates.

- COMAP MCM/ICM instructions: the summary sheet is first and heavily weighted; the whole solution is a single PDF; the current rule set uses a 25-page solution limit; references, appendices, code, and problem-specific requirements count inside the solution pages; AI use must be disclosed and separately reported when used; anonymity and proper source citation are mandatory. Source: `https://www.contest.comap.com/undergraduate/contests/mcm/instructions.php`.
- COMAP judging descriptions: Meritorious and above require clear, well-supported, organized, and well-presented modeling; Finalist papers go beyond merely addressing requirements; Outstanding papers are the best relative to modeling, problem solving, analysis, and communication. Source: `https://www.contest.comap.com/undergraduate/contests/mcm/instructions.php`.
- COMAP preparation guidance: winning-level papers are distinguished by the summary, problem analysis, justified variables and assumptions, model design, testing, error analysis, sensitivity or stability, strengths and weaknesses, explicit conclusions, and documented resources. Source: `https://www.contest.comap.com/undergraduate/contests/mcm/instructions.php`.
- CUMCM format and review rules: paper and supporting materials are treated separately; runnable source code and support materials must match the paper; national award review uses independent reviewers and anti-plagiarism checks; national-first-prize candidates face stricter independent review. Sources: `https://www.mcm.edu.cn/upload_cn/node/775/cQMeL0YY905244c8bd4b9af832f1699446d8385e.pdf`, `https://www.mcm.edu.cn/html_cn/node/b1f48689659f0660e80a2d6279d7b37d.html`.
- CUMCM review-point examples: strong papers solve the concrete problem with independent modeling, innovation, and valid real results; weak papers stack generic methods, copy standard algorithms, or look polished without substantive content; programs and results should be verifiable when possible. Source: `https://aimg8.dlssyht.cn/u/2179378/ueditor/file/1090/2179378/1663049277111493.pdf`.
- Public outstanding-paper examples commonly use a task-aligned flow: summary, problem analysis, assumptions, data preprocessing, separate model blocks, result analysis, sensitivity or robustness, strengths and weaknesses, conclusion, and appendices. Use this as a coverage checklist, not as a fixed outline. Example sources consulted: `https://reformship.github.io/pages/3competition/4mcm/MCM%20Outstanding/2024/F/2413565.pdf`, `https://explcre.github.io/files/mcm.pdf`.
- M3 Challenge rules: teams work in a continuous 14-hour window, submit a single PDF, embed charts/tables/code into the PDF, keep the main body near the recommended 20-page limit, use a first-page summary, and treat final-event validation and technical computing awards as separate scoring surfaces. Sources: `https://m3challenge.siam.org/the-challenge/rules-and-guidelines/`, `https://m3challenge.siam.org/wp-content/uploads/01-M3_Official_Rules_and_Guidelines.pdf`.
- IMMC rules: teams work within a selected consecutive 5-day period, submit a PDF solution, keep the summary first, avoid non-paper software submissions, and include model testing, sensitivity, error analysis, strengths, weaknesses, and clear algorithms in words or figures. Source: `https://www.immchallenge.org/Pages/Rules.html`.
- HiMCM/MidMCM rules: teams solve one of two problems during a longer contest window, submit an English PDF, preserve anonymity, document outside sources, and disclose AI tool use in the report and separate AI-use report when used. Source: `https://himcm.org.cn/instructions/`.
- Data-science leaderboard contests are not paper-first. Treat the competition page, rules, data card, metric definition, sample submission, public/private split, and official submission mechanism as the hard requirements. For Kaggle-like contests, the official CLI and notebook flow support downloading competition data, generating submissions, and checking submission status. Source: `https://github.com/Kaggle/kaggle-cli/blob/main/docs/README.md`.

## Shared Phase Model

| Phase | Goal | Main Outputs | Gate |
|---|---|---|---|
| 0. Intake and scoring | Understand the task and judging surface | restatement, deliverables, scoring criteria, ambiguity register | every prompt requirement maps to a planned output |
| 1. Evidence and data | Ground the problem | source inventory, data plan, benchmark methods, citation notes | every model input has data, proxy logic, or an assumption |
| 2. Candidate models | Explore routes before committing | three model routes, tradeoff table, selected route | route fits data, time, scoring, and prompt |
| 3. Math specification | Make the model executable | notation, assumptions, objectives, constraints, algorithms, metrics | coder can implement without inventing math |
| 4. Experiments | Generate reproducible results | code, raw outputs, tables, figures, sensitivity, robustness, result-density map | reported numbers are reproducible and core results are visually or tabularly supported |
| 5. Interpretation | Connect results to the prompt | findings, captions, recommendations, limitations, figure/table coverage map | each result answers a prompt question |
| 6. Paper draft | Produce a coherent paper | abstract, methods, results, figures/tables, references, appendix | no orphan result, sparse result section, or unsupported claim |
| 7. Independent review | Remove fixable weaknesses | prompt, math, evidence, reproducibility, writing audits | no high-severity issue remains |
| 8. Final package | Assemble submission | paper, source, code, data notes, README, AI-use statement, checklist | package is submit-ready |

## Detailed Phase-Agent-Critic Matrix

Every phase has three layers: specialist work, lead synthesis, and independent critic gate. No phase advances on specialist output alone.

| Phase | Primary agents | Specialist contract | Critic gate |
|---|---|---|---|
| 0. Intake and scoring | lead, problem analyst, critic | Build an atomic requirement map, deliverable list, official format constraints, scoring hypothesis, dependency graph, ambiguity register, and contest-critical questions. | Every prompt clause has an owner and output path; official constraints are separated from assumptions; only material blockers are sent to the user. |
| 1. Evidence and data | evidence researcher, problem analyst, critic | Produce a source ledger with URLs or file paths, credibility notes, extraction summaries, data dictionary, proxy logic, citation plan, and evidence gaps. | Every nontrivial constant, dataset, benchmark, or domain claim is traceable or marked as an assumption with a planned sensitivity check. |
| 2. Candidate model routes | at least two modelers, evidence researcher, critic | Propose at least three routes with inputs, equations or algorithm families, expected outputs, strengths, weaknesses, implementation cost, data fit, and failure modes. | Selected route is justified against scoring, data, time, interpretability, and novelty; rejected routes have concrete rejection reasons; no generic method stacking. |
| 3. Mathematical specification | modeler, coder, critic | Write notation, assumptions, dimensions or units, objectives, constraints, algorithms, pseudocode, validation metrics, baseline, ablation, sensitivity, and robustness plan. | Coder can implement without inventing math; equations are dimensionally coherent; assumptions are testable or evidence-backed; validation can falsify weak claims. |
| 4. Computation and experiments | coder, modeler, critic | Create reproducible scripts or notebooks, deterministic seeds, environment notes, raw outputs, cleaned tables, figures, baseline, ablations, sensitivity, robustness, run log, and a result-density map covering model structure, primary comparisons, sensitivity, robustness, tradeoffs, and recommendations. | Reported numbers can be regenerated or manually traced; figures have source data; failures are logged; no cherry-picked single run is accepted; sparse or decorative visuals fail the gate. |
| 5. Interpretation | modeler, evidence researcher, paper editor, critic | Convert numerical and analytical results into prompt-by-prompt answers, figure/table captions, recommendations, limitations, uncertainty notes, claim-source links, and a coverage map showing which visual or table supports each major conclusion. | Each result answers a task; every claim is supported by data, derivation, figure, table, citation, or explicit assumption; limitations do not undermine the main conclusion; major conclusions are not left as text-only assertions. |
| 6. Paper draft | paper editor, modeler, coder, critic | Draft summary, introduction, assumptions, methods, results, sensitivity, strengths and weaknesses, conclusion, references, appendices, AI-use statement when needed, and final figure/table placement under the page limit. | Summary states method and most important conclusions; paper is coherent and not a transcript; notation, captions, references, figure/table density, and requirement coverage are consistent. |
| 7. Independent review | critic, lead, relevant specialist reruns | Run separate audits for prompt coverage, mathematical validity, evidence, reproducibility, writing, formatting, originality, and final scoring risk. | No high-severity issue remains; each medium issue is fixed or explicitly accepted with rationale; the critic cannot be the same agent that produced the artifact. |
| 8. Final package | submission packager, paper editor, critic | Assemble final PDF, editable source if required, code, data or provenance notes, figures, tables, reproduction README, AI-use report, and requirement-to-file checklist. | Package matches contest rules, is anonymous where required, has no secrets or scratch files, satisfies size/page limits, and can be submitted by someone outside the working session. |

## Agent Handoff Contract

Every specialist response should end with a handoff block so the lead and critic can audit without rereading the full history:

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

## Critic Gate Protocol

Each critic gate must be independent, adversarial, and evidence-linked.

- The critic reads the phase handoffs, source artifacts, and lead synthesis.
- The critic assigns severity: `blocker`, `high`, `medium`, `low`.
- `blocker` or `high` issues stop progression.
- `medium` issues need an owner, fix plan, or explicit risk acceptance in the phase log.
- `low` issues may be queued only when they cannot affect scoring, correctness, reproducibility, or submission validity.
- A phase cannot pass if any artifact lacks a traceable source, calculation path, or responsible assumption.
- The lead must document critic findings and fixes before advancing.

## Figure And Table Sufficiency Gate

For MCM/ICM O-prize, CUMCM national-first-prize, and comparable paper-first contests, figure and table density is a gate item. A paper with only a few isolated plots should fail Phase 6 or Phase 7 even if the equations are plausible.

Before the final draft passes, the artifact set should cover these roles:

- model architecture, algorithm flow, or system structure
- data, parameter, assumption, or notation summary
- baseline, route, or scenario comparison
- sensitivity analysis
- robustness, uncertainty, stress test, or error analysis
- decision-facing tradeoff such as cost, time, environmental impact, risk, implementation, or policy feasibility
- final recommendation or prompt-by-prompt answer dashboard

These roles are minimum coverage, not a rigid count. A single strong visual can satisfy more than one role, but filler, duplicated, decorative, or unsupported figures do not count. Every figure and table must have source data or a documented calculation path, a caption that states the takeaway, and surrounding text that explains how it changes the answer.

## Figure And Table Generation Specification

This specification is calibrated from contest rules, public Outstanding-paper artifacts, and plotting-library behavior:

- COMAP requires the submitted solution to be one PDF containing written text, figures, charts, and supporting materials; images, figures, photographs, tables, and drawings must either be created by the team or cited at their location in the submission. Source: `https://www.contest.comap.com/undergraduate/contests/mcm/instructions.php`.
- COMAP describes the summary, clear organization, key statements, and major results as important to the judge's reading path. The figure system must help that reading path rather than decorate it. Source: `https://www.contest.comap.com/undergraduate/contests/mcm/instructions.php`.
- Public Outstanding-paper repositories often keep paper source, figure assets, code, and tables together; for example, the 2024 ICM Problem E Outstanding/INFORMS repository contains a full paper, source, and a `paper_source_24/figure` directory, and the LaTeX source introduces figures/tables in the surrounding argument. Source: `https://github.com/ydchen0806/24ICM_E_O_Award_Paper_code`.
- Matplotlib's constrained layout is designed to keep tick labels, legends, and colorbars from overlapping, but the documentation also states that other artists can still overlap or be clipped, so manual annotations and custom text require separate checks. Sources: `https://matplotlib.org/stable/users/explain/axes/constrainedlayout_guide.html`, `https://matplotlib.org/stable/api/_as_gen/matplotlib.axes.Axes.annotate.html`.
- Matplotlib's bar-label documentation says labels may require axis-limit adjustment, and a real Matplotlib GitHub issue shows bar labels can overlap under common transformations. Sources: `https://matplotlib.org/stable/api/_as_gen/matplotlib.axes.Axes.bar_label.html`, `https://github.com/matplotlib/matplotlib/issues/22414`.
- Seaborn documents explicit style and context controls, including temporary style contexts and font scaling; use this idea even when using plain Matplotlib. Source: `https://seaborn.pydata.org/tutorial/aesthetics.html`.

### Artifact Contract

Every generated figure or table must have:

- a stable file path, deterministic generation command, and source data path
- a declared evidence role: architecture, data, assumption, baseline, sensitivity, robustness, uncertainty, tradeoff, decision, memo, or appendix
- a paper location and the exact claim it supports
- a caption that states the takeaway, not only the chart type
- units on every quantitative axis or column
- significant digits justified by data precision
- a note when values are proxies, assumptions, simulated outputs, or externally sourced

The coder must produce a figure/table inventory before Phase 5. The packager must include this inventory in the final checklist or README.

### Design Rules

Use these defaults unless the contest or journal format requires otherwise:

- Prefer vector output (`.pdf` or `.svg`) for line art, diagrams, maps, and dense labels. Use `.png` only for raster images or when the PDF pipeline requires it; then use at least 180 dpi for draft and 300 dpi for final exported figures.
- Use `layout="constrained"` or explicit `GridSpec` spacing for multi-panel figures. Do not rely on `tight_layout()` alone for figures with long labels, colorbars, legends, annotations, or suptitles.
- Use figure sizes that match the paper slot. Typical full-width paper figures should be about 6.5-7.2 inches wide; multi-panel dashboards may be 7.2-9.0 inches wide only if the PDF page and caption remain readable.
- Keep in-figure text readable after PDF embedding. Axis ticks, legends, node labels, heatmap cell labels, and annotations should normally render at 8 pt or larger in the final PDF.
- Put only short descriptors in chart titles. Put the claim in the caption and surrounding prose. Avoid `Figure 2: Figure 2.` caption duplication.
- Long category labels should be wrapped, abbreviated with a table note, or moved to a horizontal bar chart. Avoid diagonal tick labels above 30 degrees unless there is no better option.
- Use colorblind-aware palettes. Do not use rainbow palettes for ordered values. Use sequential palettes for magnitude, diverging palettes for signed deviations, and categorical palettes for modes or strategies.
- Never encode an important distinction by color alone when the paper may be printed in grayscale; add markers, line styles, direct labels, hatching, or table values.
- Prefer direct labels only for the few points that need them. If every point must be identified, use a table, small multiples, or a numbered legend.
- Use log or symlog scales only when the order-of-magnitude gap is the finding; label the scale clearly and explain it in the caption.

### Plot-Type Rules

Network, flow, and architecture diagrams:

- Node text and edge labels must be separate artists at separate coordinates.
- Edge labels should sit near edge midpoints with a white or lightly tinted background, never on top of node text.
- Arrows must not cross node labels unless the crossing is semantically meaningful and still readable.
- Keep nodes large enough for their labels, or number the nodes and provide a nearby legend table.

Bar and column charts:

- Use horizontal bars for long scenario names.
- Add numeric labels only when they do not collide with bars, axes, or panel boundaries.
- If labels are outside bars, expand the axis limit by at least 5-10% after label placement.
- If values differ by more than one order of magnitude, consider log/symlog scale, an inset, or a table plus chart rather than hiding small bars.

Line charts:

- Label axes with units and scenario meaning.
- Direct-label lines at the right edge when possible; otherwise keep legends outside the plotting area or in unused white space.
- Show uncertainty bands or scenario ranges when the line supports a recommendation under uncertainty.

Heatmaps and matrices:

- Include a labeled colorbar with units.
- Choose cell-label text color based on background contrast, not a fixed black/white default.
- Keep matrix dimensions small enough to read in the paper; large matrices belong in appendix tables or support files.

Scatter, Pareto, and tradeoff plots:

- State which axis is to be minimized or maximized.
- Label only the baseline, selected solution, and dominated or frontier points needed for the argument.
- Make marker size and color legends explicit; never let bubble size imply a value without a legend or note.

Tables:

- Use compact tables for exact values and figures for patterns.
- Use `booktabs`-style rules or equivalent clean borders; avoid full gridlines unless the table is a matrix.
- Keep columns narrow by shortening headings and moving explanations into notes.
- Round consistently. Do not show more decimal places than the model or data supports.
- A table that spans the page or wraps incoherently should be split, rotated only as a last resort, or moved to support materials.

### Generation Code Rules

Figure-generating code must:

- define reusable style constants for font sizes, colors, line widths, marker sizes, and DPI
- set a random seed for simulated visuals
- write source CSV/JSON data before or alongside each generated figure
- close figures after saving to prevent hidden state
- avoid handwritten string parsing when structured data is available
- avoid placing multiple text objects at the same coordinate unless the overlap is intentional and documented
- save with a white or transparent background that works in PDF conversion
- include a build command that regenerates all visuals from a clean package root

For Matplotlib specifically:

- prefer `fig, ax = plt.subplots(..., layout="constrained")` or `fig = plt.figure(layout="constrained")`
- for annotations, use explicit `xy`, `xytext`, `textcoords`, and `bbox`; never reuse a node position as both the node label and edge label
- after `bar_label` or manual bar labels, adjust `xlim`/`ylim` so labels fit
- for heatmap labels, choose text color from the normalized cell value
- for large category labels, use `textwrap.fill` or horizontal bars
- after saving, inspect the actual exported image rather than the notebook preview

### PDF Embedding Rules

The paper editor must verify the final rendered PDF, not only the source Markdown/LaTeX:

- figure appears within one page of the paragraph that introduces it, unless the figure is explicitly an appendix artifact
- no figure is clipped, blank, pixelated, or split incoherently
- no text overlaps inside the figure or table
- no axis label, tick label, legend, colorbar, table heading, or caption is cropped
- captions are not duplicated and do not contradict the figure title
- every figure and table is mentioned in nearby prose before or immediately after it appears
- page budget remains compliant after figure placement

### Automated And Visual Verification

Before Phase 6 or Phase 8 can pass, run a figure QA sequence:

```bash
python3 <experiment_script>.py
find outputs/figures -type f \( -name '*.png' -o -name '*.pdf' -o -name '*.svg' \) | sort
python3 <make_contact_sheet_or_equivalent>.py
(cd paper && pandoc solution.md --pdf-engine=tectonic -o solution.pdf)
pdfinfo paper/solution.pdf
pdftoppm -png -r 110 paper/solution.pdf /tmp/solution-page
if pdftotext paper/solution.pdf - | rg -q "Figure [0-9]+: Figure|Table [0-9]+: Table"; then
  echo "duplicated caption prefix found" >&2
  exit 1
fi
```

The exact commands may differ by environment, but the evidence must include:

- generated figure count and table count
- contact sheet or individual screenshots of all figures
- rendered PDF page count
- rendered PDF page screenshots or contact sheet
- check for duplicated caption prefixes
- checksum or clean rebuild proof for the final package

The critic must visually inspect the contact sheet and at least the pages containing dense figures/tables. Automated checks do not replace the visual pass because layout engines can produce mathematically valid but unreadable results.

### Failure Conditions

Block the phase if any of these are present:

- node labels, edge labels, data labels, or annotations overlap
- text is too small to read in the final PDF
- a figure is blank, clipped, pixelated, or has excessive unused whitespace
- chart title, caption, and prose repeat without adding interpretation
- axes lack units or the scale is misleading
- a legend or colorbar is missing for encoded values
- figures float away from the relevant paragraph and create a pile of orphan charts
- a table wraps into incoherent lines or spills beyond the page
- a figure exists only to increase count and does not support a claim
- the code cannot regenerate the figure/table from package data

## Competition-Type Workflow Adapters

The 9-phase model is the default. Before Phase 0 finishes, the lead must classify the contest type and apply one adapter. If the contest rules conflict with the adapter, the official rules win.

| Type | Use when | Workflow emphasis | Additional critic gates |
|---|---|---|---|
| MCM/ICM O-prize | Undergraduate COMAP MCM/ICM, English paper, broad 4-day modeling task | 25-page solution discipline, summary-first narrative, AI-use transparency, source citation, prompt-by-prompt coverage | summary is not boilerplate; AI-use report and citations are compliant; no identity leak; every page-budget tradeoff protects results and conclusions |
| CUMCM national-first-prize | Chinese national contest or similar paper plus support-material package | Chinese abstract and paper format, paper/supporting-material consistency, runnable code, appendix file list, anonymity, plagiarism risk | paper PDF and support archive agree; code can reproduce key results; no team/school/region identity appears; support package excludes irrelevant files |
| HiMCM/MidMCM | High-school COMAP-style long-window contest | stronger scaffolding, accessible English exposition, problem selection support, conservative method complexity, explicit AI-use disclosure | model is explainable to high-school team members; final PDF is English, anonymous, and readable; outside-source and AI-use disclosures are complete |
| IMMC / IM2C | Five-day international secondary-school modeling challenge | local-language-to-English risk, no software package submission, concise paper, algorithm explanation in words/figures, advisor/form deadlines | translation does not improve or change the work; algorithm and testing are understandable without code files; control number and page headers are correct |
| M3 Challenge | 14-hour sprint with one-PDF submission and possible MATLAB technical computing award | aggressive timeboxing, rapid viable baseline, concise first-page summary, embedded code/figures, validation-presentation readiness | single PDF under size/page guidance; technical computing adds insight rather than clutter; final result survives oral validation questions |
| Data-science leaderboard | Kaggle-like, DrivenData-like, Tianchi-like, or enterprise metric-based contests | metric alignment, leakage prevention, train/validation split, public-private leaderboard risk, reproducible pipeline, submission-file schema | validation mirrors official metric; no leakage from test/public leaderboard; submission schema matches sample; private-LB overfitting risk is explicitly managed |
| Operations or policy case contest | Open-ended business, logistics, energy, finance, public-policy, or consulting-style modeling contest | stakeholder framing, decision variables, constraints, scenario analysis, actionable recommendations, cost and feasibility | recommendations are implementable; constraints reflect reality; scenario and sensitivity analysis cover decision risk; assumptions are acceptable to stakeholders |
| Short sprint or campus invitational | 6-24 hour local or training contest with lighter format rules | speed, baseline-first solving, selective evidence, simple robust model, clean narrative, fast package audit | at least one complete viable answer exists early; no over-complex method blocks submission; final answer prioritizes correctness and clarity |

### Adapter Dispatch Rules

- Phase 0 must record `contest_type`, official rules source, deadline, language, file limits, identity rules, code policy, AI-use policy, and final package checklist.
- The lead should ask the user only if the contest type, official rules, deadline, or submission format cannot be inferred safely.
- The critic gate for every phase must include the adapter-specific gates above.
- If the adapter is paper-first, paper editor and critic join earlier, starting in Phase 2 or Phase 3.
- If the adapter is code/leaderboard-first, coder and critic join earlier, starting in Phase 1, and paper editor may be delayed until interpretation.
- If the adapter is sprint-based, every phase should produce a minimal viable artifact first, then improve it only when time remains.
- If the adapter is school-age or translation-sensitive, the paper editor must check readability, vocabulary, and whether the method can be honestly defended by the team.
- If the adapter includes an interview, presentation, or validation round, Phase 8 adds a defense brief with likely judge questions, answer bullets, and artifact references.

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
Use $mathodology-whole-project. Run the Mathodology 9-phase award submission workflow in Codex multi-agents mode. Work phase by phase: dispatch independent agents for analysis, modeling, evidence, coding, critique, and writing where applicable; synthesize their output; require result-density maps, figure/table sufficiency gates, and rendered-PDF figure QA; run the phase gate; then continue automatically. Pause to ask the user only for contest-critical details that would change requirements, data access, model choice, compute budget, or final submission constraints. For ordinary ambiguity, make a conservative assumption, record it in the phase log, and keep going.
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

### Codex Clarification And Continuation

Codex may not complete all nine phases in one response. Treat the workflow as resumable, not single-shot:

- Keep a phase log with the current phase, completed gates, assumptions, unresolved risks, artifact paths, and next action.
- If a response boundary is reached, finish the current synthesis or gate, report the exact continuation state, and resume from that state when the user says to continue.
- Do not restart earlier phases unless new user information invalidates them.
- Continue to the next phase automatically when the gate passes and no contest-critical question is blocking progress.
- When stopping at a response boundary, end with this continuation state:

```text
Continuation state:
- Current phase:
- Completed gates:
- Blocking user question, if any:
- Assumptions to carry forward:
- Artifact paths:
- Next action:
- Suggested prompt: Continue from the current continuation state and run the next Mathodology phase gate.
```

Ask the user only when the answer would materially change one of these:

- official contest requirements, deliverable format, page limits, AI-use rules, or deadline
- access to private files, datasets, paid sources, credentials, or external services
- choice between plausible model routes with different scoring or feasibility risks
- compute, runtime, language, tool, or reproducibility constraints
- final claim, recommendation, or submission package decision that cannot be safely inferred

For non-critical ambiguity, choose the safest defensible default, mark it as an assumption, and proceed. When a user question is required, ask a compact question with the phase, why it matters, the recommended default, and the consequence of each likely answer. After the user answers, resume from the current phase log instead of rerunning completed work.

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
- enough purposeful figures and tables to make model structure, comparisons, sensitivity, robustness, tradeoffs, and final recommendations inspectable
- prompt-by-prompt answer coverage
- polished paper narrative
- independent critic review
- complete final package audit
