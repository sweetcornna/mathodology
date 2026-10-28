"""Run every check over a workspace and summarise each stage."""
from __future__ import annotations

from . import brief, figures, latex, numbers, results, runs
from .report import Issue, build, stage_state
from .workspace import Workspace, read_text, write_json


def status(ws: Workspace, compile: bool = False, sync: bool = False, save: bool = True) -> dict:
    rs, issues = results.load(ws)
    contract_files = sum(1 for d in rs.files.values() if isinstance(d, dict) and d.get('schema') == results.SCHEMA)

    brief_issues, brief_summary = brief.check(ws, rs.questions, contract_files)
    issues += brief_issues
    run_issues, run_summary = runs.check(ws, sorted(rs.files))
    issues += run_issues

    paper = latex.load(ws)
    static, used = latex.static_checks(ws, paper, set(rs.values))
    issues += static
    num = numbers.check(paper, rs, float(ws.config.get('near_miss_rel', 0.02)))
    issues += num.issues
    issues += macro_checks(ws, paper, rs, sync)
    if compile:
        issues += latex.compile_paper(ws, paper)
    else:
        issues += latex.log_checks(ws, paper)
    issues += pdf_freshness(ws, paper, rs, used)

    fig_issues, fig_summary = figures.check(ws, used, paper.main is not None)
    issues += fig_issues

    code_files = ws.files('code', runs.CODE)
    by_stage = lambda s: [i for i in issues if i.stage == s]
    stages = {
        'brief': {'state': stage_state(brief.path(ws).exists(), by_stage('brief')),
                  'summary': f"{brief_summary['questions']} question(s)" if brief.path(ws).exists() else 'no questions.json yet'},
        'experiment': {'state': stage_state(bool(run_summary['runs'] or code_files), by_stage('experiment')),
                       'summary': (f"{run_summary['runs']} recorded run(s), {run_summary['failed']} failed" if run_summary['runs']
                                   else f'{len(code_files)} code file(s), no recorded runs')},
        'results': {'state': stage_state(bool(rs.files), by_stage('results')),
                    'summary': f'{len(rs.files)} file(s), {len(rs.values)} citable value(s)'},
        'figures': {'state': stage_state(bool(fig_summary['figures']), by_stage('figures')),
                    'summary': f"{fig_summary['figures']} figure(s), {fig_summary['traced']} traced to a script"},
        'paper': {'state': stage_state(paper.main is not None, by_stage('paper')),
                  'summary': (f'{ws.rel(paper.main)}: {num.checked} number(s) checked, {num.matched} match results, '
                              f'{num.near} near miss(es), {num.bound} cited with \\res') if paper.main else 'no paper source yet'},
    }
    report = build(str(ws.root), stages, issues)
    if save:
        write_json(ws.state / 'report.json', report)
    return report


def macro_checks(ws: Workspace, paper: latex.Paper, rs: results.ResultSet, sync: bool) -> list[Issue]:
    if paper.kind != 'tex' or not paper.main:
        return []
    uses_res = any(latex.RES.search(l.text) for l in paper.lines)
    target = results.macro_path(ws)
    inputs_macros = any(m.group(1).strip().endswith(('results', 'results.tex')) for l in paper.lines for m in latex.INPUT.finditer(l.text))
    if sync and (uses_res or inputs_macros or target.exists()):
        results.sync(ws, rs)
    if not uses_res:
        return []
    out = []
    rel = ws.rel(target)
    if not target.exists():
        out.append(Issue('error', 'paper', 'numbers.macros-missing', f'the paper uses \\res but {rel} does not exist', rel, hint='run `mtd.py sync`'))
    elif read_text(target) != results.macros(rs):
        out.append(Issue('warning', 'paper', 'numbers.macros-stale', f'{rel} is older than results/*.json', rel, hint='run `mtd.py sync`'))
    loads_macros = any(m.group(1).strip().endswith(('results', 'results.tex'))
                       for l in paper.lines for m in latex.INPUT.finditer(l.text))
    if not loads_macros:
        out.append(Issue('error', 'paper', 'numbers.macros-not-loaded', 'the paper uses \\res but never \\input{results}', ws.rel(paper.main),
                         hint='add \\input{results} to the preamble'))
    return out


def pdf_freshness(ws: Workspace, paper: latex.Paper, rs: results.ResultSet, used: set) -> list[Issue]:
    if paper.kind != 'tex' or not paper.main:
        return []
    pdf = paper.main.with_suffix('.pdf')
    if not pdf.exists():
        return []
    inputs = list(paper.files) + [ws.root / rel for rel in rs.files] + list(used)
    newer = [p for p in inputs if p.exists() and p.stat().st_mtime > pdf.stat().st_mtime + 1]
    if not newer:
        return []
    names = ', '.join(ws.rel(p) for p in newer[:3])
    return [Issue('warning', 'paper', 'paper.stale-pdf', f'{ws.rel(pdf)} is older than {names}{" ..." if len(newer) > 3 else ""}', ws.rel(pdf),
                  hint='recompile with `mtd.py check --compile`')]


def file_checks(ws: Workspace, rel: str) -> list[Issue]:
    """Fast checks scoped to one edited paper file, for the post-edit hook."""
    rs, _ = results.load(ws)
    paper = latex.load(ws)
    if not any(l.file == rel for l in paper.lines):
        return []
    static, _ = latex.static_checks(ws, paper, set(rs.values), only=rel)
    num = numbers.check(paper, rs, float(ws.config.get('near_miss_rel', 0.02)), only=rel)
    return [i for i in static + num.issues if i.severity in ('error', 'warning')]
