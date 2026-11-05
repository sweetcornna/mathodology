# Contest paper formats

`mtd.py init --paper-template NAME` copies `templates/paper/contests/NAME/main.tex`
into `paper/` and records `"contest": "NAME"` in `.mathodology/config.json`, so
`mtd.py check` adds the mechanical format checks below. The skeletons are not
official templates. Rules change every year: read the current official rules of
the event you enter and let them override this page, the skeleton and the checks.

Checked on 2026-11-05. "Verified" means the rule text was read in an official
page, or in an official notice copied by a university; "not verified" means the
format rules could not be read, so the skeleton only organizes content.

| NAME | Contest | Rules read | Engine |
|---|---|---|---|
| `cumcm` | 全国大学生数学建模竞赛 | [格式规范（2026年修订稿）](https://www.mcm.edu.cn/html_cn/node/4cd596519c9eb9fbd866398f6df0caa3.html) | XeLaTeX |
| `mcm` | MCM/ICM | [2027 contest rules](https://contest.comap.com/undergraduate/contests/mcm/instructions.php) | pdfLaTeX |
| `stats` | 全国大学生统计建模大赛 | [2026 provincial-round notice (university copy)](https://cxcyxy.ntu.edu.cn/_upload/article/files/a8/d9/3d3c581042f5ab1a36794cac860c/9b42dbdd-eb89-4874-993a-7b2f00329ea5.pdf) | XeLaTeX |
| `huawei` | 中国研究生数学建模竞赛（华为杯） | not verified | XeLaTeX |
| `mathorcup` | MathorCup 高校数学建模挑战赛 | not verified | XeLaTeX |
| `apmcm` | APMCM | not verified | pdfLaTeX |

## CUMCM (2026 rules)

- Print version: 承诺书, then 编号专用页, then the abstract page. The electronic
  version leaves out the first two, so it starts with the abstract page.
- Abstract page: title, abstract and keywords, no English translation, in
  principle one page.
- No table of contents. Pages are numbered from the abstract page, in Arabic
  numerals, centred in the footer.
- No contestant identity, school or region on the abstract page, in the body
  or in the appendix.
- Body at most 30 pages; appendix unlimited. The appendix lists the supporting
  files and contains all complete, runnable source code. If no program was
  used, write 本论文没有用到程序; if there are no supporting files, write
  本论文没有支撑材料.
- One PDF (recommended) or Word file, at most 20 MB. Supporting material goes in
  a RAR or ZIP archive, at most 20 MB. Fonts, sizes and spacing are not
  prescribed; the paper is A4 with margins of at least 2.5 cm.
- Checks: `contest.toc` (a table of contents) and `contest.identity` (a non-empty
  `\author`).

## MCM/ICM (2027 rules)

- The summary sheet is page 1. Use COMAP's
  [official summary sheet](https://contest.comap.com/undergraduate/contests/mcm/flyer/MCM-ICM_Summary.tex)
  when you prefer it.
- 25 pages in total, including the summary sheet, table of contents, solution,
  references, notes, appendices, code and any problem-specific deliverable. The
  Report on Use of AI follows and is not counted.
- Every page shows the team control number and the page number at the top. No
  names of students, advisor or institution anywhere.
- English, a readable font of at least 12 pt, one PDF named after the control
  number, under 25 MB. Do not attach programs or data.
- The skeleton puts `\label{SolutionLastPage}` before the AI report. Checks:
  `contest.page-limit` (that label's page in `main.aux`, or the PDF page count
  when the label is missing) and `contest.identity`.

## 全国大学生统计建模大赛 (2026 provincial round)

- Submit a Word full version (cover page and acknowledgements included) and a
  PDF anonymous version without them. The skeleton builds the PDF;
  `\anonymoustrue` is the default.
- School, team and advisor may appear only on the cover and in the
  acknowledgements; the submitted title must not contain them.
- Abstract covering purpose, method, results, conclusions and innovation, with
  3 to 5 keywords. The notice does not ask for an English abstract.
- Contents to three levels, plus a list of tables and figures. Body pages are
  numbered separately, starting from 1.
- A4 with 2.54 cm top and bottom and 3.17 cm left and right margins.
  - Title: 方正小标宋, 三号.
  - Headings: level 1 黑体小三; level 2 楷体四号; level 3 宋体小四, bold.
  - Body: 宋体小四, fixed 24 pt leading. The skeleton approximates the leading,
    so check it on the compiled pages.
- Separate uploads: entry form, commitment letter, AI-use form and a CNKI
  similarity report.
- Only the provincial-round notice was read; school and national rounds may
  differ. Check: `contest.not-anonymous` (`\anonymousfalse`).

## Not verified

- **华为杯**: the 2026 invitation letter
  ([university copy](https://grd.bit.edu.cn/docs/2026-06/ed75bf2b062d4829b1002537169dc3e2.pdf))
  requires the official 《竞赛论文标准文档》 and a PDF submitted with its MD5
  code. Citations and borrowed code must name their source. The official platform
  [cpipc.acge.org.cn](https://cpipc.acge.org.cn/) holds the document; use it for
  the submission.
- **MathorCup**: the [2026 problem notice](https://www.mathorcup.org/detail/2487)
  defers to the registration site. Graduate teams may choose only problems A or B.
- **APMCM**: the [2026 rules notice](https://www.apmcm.org/detail/2513) attaches an
  image-only PDF, and the [charter](https://www.apmcm.org/list/regulation) has no
  layout rules.

For these three, `check` reports `contest.rules-unverified` as a note, and the
table of contents is a switch (`\withtoctrue` / `\withtocfalse`). Add a profile
to `scripts/workbench/contest.py` only after reading the rule text, and record
the source and date here.
