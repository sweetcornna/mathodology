# Workbench contracts and checks

All files are plain JSON or text in the workspace, readable by any agent or person.

## Layout

```
problem/     statement and data; questions.json (brief)
code/        experiment code
results/     results contract files, written by code
runs/        one folder per recorded run: manifest.json, stdout.log, stderr.log; index.jsonl
figures/     figure scripts and exported images
paper/       main.tex or main.md, sections, references.bib, generated results.tex
.mathodology/ config.json, report.json (last status), small hook state
```

## problem/questions.json (`mathodology.questions/1`)

```json
{"schema": "mathodology.questions/1", "source": "problem/statement.md",
 "questions": [{"id": "Q1", "title": "问题一 ...", "text": "...",
   "deliverables": ["3-month forecast with intervals"], "metrics": ["RMSE on held-out months"],
   "inputs": ["attachment 1"], "assumptions": [], "depends_on": []}]}
```

`mtd.py brief` counts only top-level numbered questions (问题一, 第一问, Problem 1,
Question 2, Task 3, （一）, Q1). Parts such as (1)(2) or a/b belong to their question;
a mention in the middle of a sentence ("在问题一的基础上") is not a question. Numbering
must run 1, 2, 3 ... from the first match. Check the result against the statement.

## results/*.json (`mathodology.results/1`)

| Field | Meaning |
|---|---|
| `values` | named numbers; a bare number or `{"value", "unit", "ci": [lo, hi], "digits", "display", "label", "note", "se", "n"}`; objects without `value` are groups |
| `question` | id from questions.json, used for coverage |
| `tables` | `{"name": {"columns": [...], "rows": [[...], ...]}}` |
| `provenance` | free-form; ignored by the number index |

Key of a value: file stem plus path, e.g. `results/q1.json` → `q1.rmse`,
`results/sens/q3.json` → `sens.q3.elasticity.high`. `digits` fixes the printed
decimals; `display` overrides the text entirely. Files without `schema` are
indexed for number matching only.

Errors: invalid JSON, missing `values`, non-numeric, NaN or infinite values,
malformed `ci`, table rows with the wrong width. Warnings: value outside its
interval, awkward key names.

## Runs (`mathodology.run/1`)

`mtd.py run [--name N] [--seed S] [--timeout T] -- CMD` runs `CMD` from the
workspace root with `MATHODOLOGY_RUN_ID`, `MATHODOLOGY_SEED` and
`PYTHONHASHSEED` set, tees output to the run folder and records: command, seed,
start, duration, exit code, Python and platform, Git commit, SHA-256 of `code/`
sources and `problem/` files, and every results or figures file that changed.
The exit code is the command's.

Checks: a results file changed since the run that wrote it (warning), code changed
since then (warning), written by a failed run (warning), never written by a
recorded run (note), failed runs exist (note, to be disclosed when relevant).

## Paper

Main file: `paper/main.tex`, else a `.tex` with `\documentclass`, else `main.md`.
`\input`, `\include` and `\subfile` are followed. `paper/results.tex` is generated
by `sync` (after every recorded run, and by the hooks) and is not scanned.

Errors: undefined `\ref`/`\eqref`/`\cref` label, duplicate label, citation key
missing from the `.bib` or `\bibitem`s, missing `\includegraphics` file (with
`\graphicspath`), `\res` key not in results, `\res` used without
`\input{results}` or with no generated file, LaTeX errors in a log newer than the
sources (or from `check --compile`). Warnings: near-miss numbers, placeholders
(TODO, 待补充 ...), Markdown syntax in LaTeX, stale macros, PDF older than its
sources, results or figures, undefined references in the compiled log, lines over
10pt into the margin. Notes: unmatched numbers, numbers typed by hand that
`\res` could cite, unused bibliography entries.

Number matching reads decimals, percentages (`12.3\%` ↔ 0.123 or 12.3), `‰`, `万`,
`亿`, thousand/million/billion, thousands separators and `a\times10^{b}`, and
accepts any result that rounds to the printed digits. It skips integers under
100, years, figure/table/equation/section/question numbers, lengths, the preamble,
code listings, TikZ and the bibliography. A near miss is a printed decimal within
2% (`near_miss_rel`) of a result that does not round to it.

`check --compile` uses `latexmk` (XeLaTeX when the source loads ctex, xeCJK or
fontspec), else `pdflatex`/`xelatex` plus BibTeX. Without a TeX engine the
compile check is skipped with a note.

## Figures

Python scripts in `figures/` and `code/` are parsed, not executed. String
literals ending in an image suffix are outputs; literals ending in a data suffix
(.json, .csv, .xlsx, .npy ...) are sources. An image older than one of its sources
or than its script is stale. Images in `figures/` that the paper does not use, and
paper figures no script produces, are notes.

## Configuration (`.mathodology/config.json`)

```json
{"stop_gate": "errors", "near_miss_rel": 0.02, "allow_result_edits": false}
```
