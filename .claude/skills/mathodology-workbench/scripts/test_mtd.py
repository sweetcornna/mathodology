#!/usr/bin/env python3
"""Offline tests for mtd.py and the workbench package; every fixture lives in a temporary folder.

Run with ``python3 test_mtd.py`` from any directory (or ``python3 -m unittest`` from this folder).
No network, no third-party packages, and no LaTeX run: the compile path is tested on log text.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import time
import unittest
from unittest import mock
import zipfile
import zlib

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import mtd  # noqa: E402
from workbench import assets, brief, engine, figures, hooks, latex, numbers, results, runs, stubs  # noqa: E402
from workbench.workspace import find_workspace, init, load  # noqa: E402

MTD = HERE / 'mtd.py'
DOC = '\\documentclass{article}\n\\usepackage{graphicx}\n\\input{results}\n\\begin{document}\n'
END = '\\end{document}\n'


def write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(text, bytes):
        path.write_bytes(text)
    else:
        path.write_text(text, encoding='utf-8')
    return path


def png(width=1200, height=800):
    """The bytes of a valid (blank, greyscale) PNG of the given size."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + b'\xff' * width for _ in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


PDF = b'%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'


def contract(values, question='Q1', **extra):
    return json.dumps({'schema': results.SCHEMA, 'question': question, 'values': values, **extra})


def make_ws(tmp, files=None, config=None):
    """A workspace in tmp/ws with the given {relative path: text} files."""
    root = Path(tmp) / 'ws'
    root.mkdir()
    init(root)
    if config:
        write(root / '.mathodology' / 'config.json', json.dumps(config))
    for rel, text in (files or {}).items():
        write(root / rel, text)
    return load(root)


def age(path, seconds):
    """Move a file's mtime `seconds` into the past (relative to now)."""
    t = time.time() - seconds
    os.utime(path, (t, t))


def codes(issues):
    return [i['code'] if isinstance(i, dict) else i.code for i in issues]


def paper_issues(ws, rs=None):
    rs = rs or results.load(ws)[0]
    paper = latex.load(ws)
    return latex.static_checks(ws, paper, set(rs.values))


def number_report(ws, tex_body=None, md=None):
    if tex_body is not None:
        write(ws.root / 'paper' / 'main.tex', DOC + tex_body + END)
    if md is not None:
        write(ws.root / 'paper' / 'main.md', md)
    rs, _ = results.load(ws)
    return numbers.check(latex.load(ws), rs, ws.config['near_miss_rel'])


def hook_env(tmp):
    env = {k: v for k, v in os.environ.items() if k not in ('CLAUDE_PROJECT_DIR', 'MATHODOLOGY_ALLOW_RESULT_EDITS',
                                                            'MATHODOLOGY_HOOK_DEBUG')}
    hook_tmp = Path(tmp) / 'hooktmp'
    hook_tmp.mkdir(exist_ok=True)
    env['TMPDIR'] = str(hook_tmp)  # the session file lives under tempfile.gettempdir()
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    return env


def run_hook(tmp, event, payload, cwd=None):
    stdin = payload if isinstance(payload, str) else json.dumps(payload)
    proc = subprocess.run([sys.executable, str(MTD), 'hook', event], input=stdin, capture_output=True, text=True,
                          cwd=cwd or tmp, env=hook_env(tmp), timeout=120)
    return proc.returncode, proc.stdout, proc.stderr


def run_cli(tmp, *args):
    proc = subprocess.run([sys.executable, str(MTD), *args], capture_output=True, text=True, cwd=tmp,
                          env=hook_env(tmp), timeout=120)
    return proc.returncode, proc.stdout, proc.stderr


class BriefTests(unittest.TestCase):
    def ids_titles(self, text):
        return [(q['id'], q['title']) for q in brief.detect(text)]

    def test_chinese_questions_ignore_subparts_and_mid_line_mentions(self):
        text = ('# 赛题\n背景介绍。\n'
                '## 问题一：预测用电量\n(1) 建立模型；\n(2) 给出误差。\n'
                '在问题一的基础上，考虑天气。\n'
                '**问题二** 优化调度方案。\n（1）约束；（2）目标。\n'
                '问题三、灵敏度分析。\n')
        got = brief.detect(text)
        self.assertEqual([q['id'] for q in got], ['Q1', 'Q2', 'Q3'])
        self.assertEqual(got[0]['title'], '问题一：预测用电量')
        self.assertIn('在问题一的基础上', got[0]['text'])  # stays inside Q1's body
        self.assertIn('(2) 给出误差', got[0]['text'])
        self.assertEqual(got[1]['title'], '问题二 优化调度方案。')
        self.assertTrue(got[2]['text'].startswith('问题三'))
        self.assertEqual(set(got[0]), {'id', 'title', 'text', 'deliverables', 'metrics', 'inputs', 'assumptions', 'depends_on'})

    def test_english_problem_and_question_keywords(self):
        text = 'Intro.\nProblem 1: Forecast demand.\n(1) a part\n(2) another\nQuestion 2. Schedule units.\nTask 3 Sensitivity.\n'
        self.assertEqual(self.ids_titles(text), [('Q1', 'Problem 1: Forecast demand.'), ('Q2', 'Question 2. Schedule units.'),
                                                 ('Q3', 'Task 3 Sensitivity.')])

    def test_numbering_must_start_at_one_and_run_consecutively(self):
        self.assertEqual(brief.detect('Question 2: x\nQuestion 3: y\n'), [])
        got = brief.detect('Question 1: a\nQuestion 2: b\nSee Question 7: footnote.\nQuestion 4: d\n')
        self.assertEqual([q['title'] for q in got], ['Question 1: a', 'Question 2: b'])
        self.assertIn('Question 4', got[1]['text'])  # later lines belong to the last question

    def test_roman_numerals_and_di_ji_wen(self):
        got = brief.detect('Problem I: alpha\nProblem II: beta\nProblem III: gamma\n')
        self.assertEqual([q['id'] for q in got], ['Q1', 'Q2', 'Q3'])
        got = brief.detect('第一问 求解。\n第二问 优化。\n')
        self.assertEqual(len(got), 2)
        self.assertEqual(brief.number('十二'), 12)
        self.assertEqual(brief.number('二十'), 20)
        self.assertEqual(brief.number('二十三'), 23)
        self.assertEqual(brief.number('IV'), 4)

    def test_no_questions(self):
        self.assertEqual(brief.detect('Just some text about problem one.\n'), [])

    def test_docx_extraction_via_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp)
            body = ''.join(f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>' for t in
                           ['赛题背景', '问题一 建立预测模型', '(1) 数据清洗', '问题二 制定调度方案'])
            xml = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
                   f'wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>')
            docx = ws.root / 'problem' / 'statement.docx'
            with zipfile.ZipFile(docx, 'w') as z:
                z.writestr('[Content_Types].xml', '<Types/>')
                z.writestr('word/document.xml', xml)
            self.assertIn('问题一 建立预测模型', brief.extract_text(docx))
            data, used = brief.make(ws, None)
            self.assertEqual(used, docx)
            self.assertEqual(data['source'], 'problem/statement.docx')
            self.assertEqual([q['title'] for q in data['questions']], ['问题一 建立预测模型', '问题二 制定调度方案'])
            self.assertTrue(brief.write(ws, data))
            self.assertFalse(brief.write(ws, data))  # will not clobber edits without force
            self.assertTrue(brief.write(ws, data, force=True))

    def test_brief_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp)
            issues, summary = brief.check(ws, {}, 0)
            self.assertEqual((codes(issues), summary), (['brief.missing'], {'questions': 0}))
            write(brief.path(ws), json.dumps({'questions': [
                {'id': 'Q1', 'deliverables': ['x'], 'metrics': ['rmse']},
                {'id': 'Q2', 'depends_on': ['Q9']}]}))
            issues, summary = brief.check(ws, {'Q1': ['results/q1.json'], 'Q5': ['results/q5.json']}, 2)
            self.assertEqual(summary, {'questions': 2})
            self.assertEqual(sorted(codes(issues)), ['brief.deliverables', 'brief.depends', 'brief.metrics',
                                                     'coverage.question', 'coverage.unknown'])


class ResultsTests(unittest.TestCase):
    def test_load_validates_contract_files_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {
                'results/raw.json': '{"rmse": NaN, "x": 1.5, "series": [9.25, 9.75], "provenance": {"seed": 777}}',
                'results/q1.json': contract({
                    'rmse': {'value': 0.0912, 'unit': 'kWh', 'digits': 3, 'ci': [0.081, 0.101]},
                    'best_cost': 1532.4,
                    'scenario': {'high': {'value': 0.31}, 'low': 0.12, 'deep': {'deeper': 7}},
                    'bad_inf': {'value': float('inf')},
                    'bad_nan': float('nan'),
                    'rev': {'value': 1.0, 'ci': [2.0, 0.5]},
                    'outside': {'value': 5.0, 'ci': [1.0, 2.0]},
                    'shape': {'value': 1.0, 'ci': [1.0]},
                    'text': {'value': 'high'},
                    'digits_bad': {'value': 1.0, 'digits': 20},
                    'extra': {'value': 2.0, 'colour': 'red'},
                    'series': [1, 2, 3],
                    'flag': 'yes',
                }, tables={'ok': {'columns': ['a', 'b'], 'rows': [[1, 2], [3, 4]]},
                           'ragged': {'columns': ['a', 'b'], 'rows': [[1, 2], [3]]},
                           'shapeless': {'rows': []}}),
                'results/broken.json': '{not json',
            })
            rs, issues = results.load(ws)
            by_code = {}
            for i in issues:
                by_code.setdefault(i.code, []).append(i)
            # The non-schema file is indexed for number checks but not validated.
            self.assertEqual([i.file for i in by_code['results.schema']], ['results/raw.json'])
            self.assertEqual(by_code['results.schema'][0].severity, 'info')
            self.assertIn(1.5, [n for n, _ in rs.numbers])
            self.assertNotIn(777, [n for n, _ in rs.numbers])  # provenance is not a result
            self.assertNotIn(9.25, [n for n, _ in rs.numbers])  # raw series would match almost anything
            self.assertFalse(any(math.isnan(n) for n, _ in rs.numbers))
            self.assertIn('results/raw.json', rs.files)
            self.assertFalse(any(k.startswith('raw.') for k in rs.values))
            self.assertEqual(by_code['results.json'][0].file, 'results/broken.json')
            # Nested groups produce dotted keys.
            self.assertEqual(sorted(rs.values), ['q1.best_cost', 'q1.digits_bad', 'q1.extra', 'q1.outside', 'q1.rev',
                                                 'q1.rmse', 'q1.scenario.deep.deeper', 'q1.scenario.high',
                                                 'q1.scenario.low', 'q1.shape'])
            rmse = rs.values['q1.rmse']
            self.assertEqual((rmse.unit, rmse.ci, rmse.digits, rmse.file), ('kWh', (0.081, 0.101), 3, 'results/q1.json'))
            self.assertIsNone(rs.values['q1.rev'].ci)
            self.assertIsNone(rs.values['q1.digits_bad'].digits)
            self.assertEqual(rs.questions, {'Q1': ['results/q1.json']})
            nonfinite = sorted(i.message for i in by_code['results.nonfinite'])
            self.assertEqual(len(nonfinite), 2)
            self.assertTrue(all(i.severity == 'error' for i in by_code['results.nonfinite']))
            ci = {i.message: i.severity for i in by_code['results.ci']}
            self.assertEqual(sorted(ci.values()), ['error', 'error', 'warning'])
            self.assertTrue(any('reversed' in m for m in ci))
            self.assertTrue(any('outside' in m and s == 'warning' for m, s in ci.items()))
            self.assertEqual(len(by_code['results.value']), 2)  # 'high' and 'yes'
            self.assertEqual(by_code['results.digits'][0].severity, 'warning')
            self.assertEqual(by_code['results.fields'][0].severity, 'info')
            self.assertEqual(by_code['results.list'][0].severity, 'info')
            tables = [i.message for i in by_code['results.table']]
            self.assertEqual(len(tables), 2)
            self.assertTrue(any('ragged' in m and '[1]' in m for m in tables))
            self.assertTrue(any('shapeless' in m for m in tables))

    def test_contract_without_values_and_subfolder_stems(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/a.json': json.dumps({'schema': results.SCHEMA}),
                               'results/q2/sub.json': contract({'k': 1.25}, question='Q2')})
            rs, issues = results.load(ws)
            self.assertIn('results.values', codes(issues))
            self.assertEqual(list(rs.values), ['q2.sub.k'])
            self.assertEqual(results.stem('results/q2/sub.json'), 'q2.sub')

    def test_format_number(self):
        f = results.format_number
        self.assertEqual(f(0.091234, 3), '0.091')
        self.assertEqual(f(2.0, 2), '2.00')
        self.assertEqual(f(0.5, 3, 'about one half'), 'about one half')
        self.assertEqual(f(42), '42')
        self.assertEqual(f(3.0), '3')
        self.assertEqual(f(0.1234567891), '0.123457')
        self.assertEqual(f(1.5e-7), '1.5\\times10^{-7}')
        self.assertEqual(f(1e20), '1\\times10^{20}')
        self.assertEqual(f(-2.5e-8), '-2.5\\times10^{-8}')
        self.assertEqual(f(-2.5e8), '-250000000')  # integral floats print as integers

    def test_sync_macros_content_idempotence_and_escaping(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({
                'rmse': {'value': 0.0912, 'unit': 'kWh', 'digits': 3, 'ci': [0.081, 0.101]},
                'share': {'value': 0.25, 'unit': '% of load_total & $'},
                'tiny': 1.5e-7,
                'shown': {'value': 3.14159, 'display': '\\pi'},
            })})
            rs, _ = results.load(ws)
            path, changed = results.sync(ws, rs)
            self.assertTrue(changed)
            self.assertEqual(path, ws.root / 'paper' / 'results.tex')
            text = path.read_text(encoding='utf-8')
            self.assertIn('\\@namedef{mtdres@q1.rmse}{0.091}', text)
            self.assertIn('\\@namedef{mtdres@q1.rmse@ci}{[0.081, 0.101]}', text)
            self.assertIn('\\@namedef{mtdres@q1.rmse@unit}{kWh}', text)
            self.assertIn('\\@namedef{mtdres@q1.share@unit}{\\% of load\\_total \\& \\$}', text)
            self.assertIn('\\@namedef{mtdres@q1.tiny}{\\ensuremath{1.5\\times10^{-7}}}', text)
            self.assertIn('\\@namedef{mtdres@q1.shown}{\\pi}', text)
            self.assertIn('\\providecommand\\res[1]', text)
            self.assertTrue(text.rstrip().endswith('\\makeatother'))
            self.assertEqual(text.count('\\@namedef{mtdres@q1.share'), 2)  # value + unit, no ci
            mtime = path.stat().st_mtime_ns
            self.assertEqual(results.sync(ws, rs), (path, False))
            self.assertEqual(path.stat().st_mtime_ns, mtime)  # not rewritten
            write(ws.root / 'results' / 'q1.json', contract({'rmse': 0.5}))
            self.assertTrue(results.sync(ws, results.load(ws)[0])[1])
            self.assertIn('{mtdres@q1.rmse}{0.5}', path.read_text(encoding='utf-8'))


class NumbersTests(unittest.TestCase):
    VALUES = {'rmse': 0.0912, 'share': 0.1234, 'cost': 1234.5, 'count': 15230, 'big': 1215.0, 'r2': 0.876,
              'pop': 2.35e8, 'mape': 4.56}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = make_ws(self.tmp.name, {'results/q1.json': contract(self.VALUES)})
        results.sync(self.ws, results.load(self.ws)[0])

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, body):
        return number_report(self.ws, tex_body=body)

    def assert_matched(self, body, n=1):
        report = self.check(body)
        self.assertEqual((report.checked, report.matched, report.near), (n, n, 0), [i.render() for i in report.issues])
        self.assertNotIn('numbers.unmatched', codes(report.issues))
        return report

    def test_rounding_matches(self):
        self.assert_matched('The RMSE is 0.091 and also 0.09 and 0.0912.\n', 3)
        self.assert_matched('$R^2 = 0.88$.\n')

    def test_percent_vs_fraction(self):
        self.assert_matched('A share of 12.3\\% of the load.\n')
        self.assert_matched('A share of 12\\% of the load.\n')
        self.assert_matched('MAPE 4.56%.\n')  # percent matching the plain number also counts

    def test_wan_and_yi(self):
        self.assert_matched('共计1.523万人。\n')
        self.assert_matched('人口2.35亿。\n')
        self.assert_matched('约为2.4亿人。\n')

    def test_thousands_separators(self):
        self.assert_matched('Total cost 1,234.5 yuan.\n')
        self.assert_matched('Total cost 1{,}234.5 yuan.\n')
        self.assert_matched('Count 15,230 people.\n')

    def test_scientific(self):
        self.assert_matched('Approx $1.2\\times10^{3}$ units.\n')
        self.assert_matched('Approx $1.215 \\times 10^{3}$ units.\n')
        self.assert_matched('Population 2.35e8 people.\n')

    def test_near_miss_is_warning(self):
        report = self.check('The RMSE is 0.0925 here.\n')
        self.assertEqual((report.checked, report.matched, report.near), (1, 0, 1))
        issue = report.issues[0]
        self.assertEqual((issue.severity, issue.code, issue.file, issue.line), ('warning', 'numbers.near-miss',
                                                                                 'paper/main.tex', 5))
        self.assertIn('0.0912', issue.message)
        report = self.check('Share 12.5\\% here.\n')  # 0.125 vs 0.1234: 1.3 %
        self.assertEqual(report.near, 1)
        report = self.check('预测误差为0.0925，较基线下降。\n')  # a number right after CJK text is still read
        self.assertEqual((report.checked, report.near), (1, 1))

    def test_unmatched_is_one_info_per_file(self):
        report = self.check('Values 3.7 and 55.5 and 987654 are parameters.\n')
        self.assertEqual((report.checked, report.matched, report.near), (3, 0, 0))
        self.assertEqual([(i.severity, i.code) for i in report.issues], [('info', 'numbers.unmatched')])
        self.assertIn('3 number(s)', report.issues[0].message)
        self.assertIn('(l.5)', report.issues[0].message)

    def test_typed_values_are_noted(self):
        report = self.check('RMSE 0.091.\n')
        self.assertIn('numbers.typed', codes(report.issues))

    def test_skipped_contexts(self):
        body = ('See Figure 3 and Figure 3.5, Table 2 and Table 2.1, Section 4.2, 式(3.1) and 图 2.1.\n'
                'In 2023 and 1999 we ran it. 第3问 is hard.\n'
                '\\includegraphics[width=0.8\\textwidth]{fig1}\n'
                'Use width 0.8\\textwidth and 12pt and 3.5cm here.\n'
                '\\vspace{2.5mm}\\setlength{\\parindent}{2.25em}\n'
                'Ref \\ref{fig:3.3} and \\cite{key2.2} and \\label{eq:7.7}.\n'
                '\\begin{verbatim}\nx = 77.77\n\\end{verbatim}\n'
                '\\begin{lstlisting}\ny = 88.88\n\\end{lstlisting}\n'
                '\\begin{thebibliography}{9}\n\\bibitem{a} Smith, 2019, vol. 66.6\n\\end{thebibliography}\n'
                'Cited \\res{q1.rmse} and \\resci{q1.rmse} and \\resunit{q1.rmse} % comment 55.55\n'
                'Small counts 3, 7 and 12 are labels.\n')
        report = self.check(body)
        self.assertEqual(report.bound, 3)
        self.assertEqual(report.checked, 0, [i.render() for i in report.issues])

    def test_preamble_is_skipped(self):
        write(self.ws.root / 'paper' / 'main.tex',
              '\\documentclass[12pt]{article}\n\\def\\alpha{0.75}\nTitle 33.33\n\\input{settings}\n\\begin{document}\nBody 44.44\n' + END)
        write(self.ws.root / 'paper' / 'settings.tex', '\\def\\beta{66.66}\nSetting 55.55\n')
        rs, _ = results.load(self.ws)
        report = numbers.check(latex.load(self.ws), rs)
        self.assertEqual(report.checked, 1, [i.render() for i in report.issues])
        self.assertIn('44.44', report.issues[0].message)

    def test_sections_after_begin_document_are_checked(self):
        write(self.ws.root / 'paper' / 'main.tex', DOC + '\\input{sections/intro}\n' + END)
        write(self.ws.root / 'paper' / 'sections' / 'intro.tex', 'RMSE 0.0925.\n')
        rs, _ = results.load(self.ws)
        report = numbers.check(latex.load(self.ws), rs)
        self.assertEqual(report.near, 1)
        self.assertEqual(report.issues[0].file, 'paper/sections/intro.tex')
        only = numbers.check(latex.load(self.ws), rs, only='paper/sections/intro.tex')
        self.assertEqual(only.near, 1)

    def test_markdown_paper(self):
        (self.ws.root / 'paper' / 'results.tex').unlink()
        md = ('# 1 Introduction\n'
              '## 3.2 Results\n'
              'RMSE is {{res:q1.rmse}} and {{ res:q1.cost }}; typed 0.0925.\n'
              '![fig](../figures/f1.png) `code 77.77`\n'
              '```\nx = 66.66\n```\n'
              'Share 12.3% and 2.35亿.\n')
        report = number_report(self.ws, md=md)
        self.assertEqual(latex.load(self.ws).kind, 'md')
        self.assertEqual(report.bound, 2)
        self.assertEqual((report.checked, report.matched, report.near), (3, 2, 1), [i.render() for i in report.issues])


class LatexTests(unittest.TestCase):
    def test_static_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            main = (DOC.replace('\\input{results}', '\\graphicspath{{../figures/}}\n\\input{results}') +
                    '\\input{sections/intro}\n'
                    '\\section{A}\\label{sec:a}\n'
                    'See \\ref{sec:a}, \\ref{sec:missing} and \\eqref{eq:1}. % \\ref{commented}\n'
                    '\\cite{good, bad1}\\citep[p.~3]{bad2}\n'
                    '\\includegraphics[width=0.5\\textwidth]{fig1}\n'
                    '\\includegraphics{nofig}\n'
                    '\\res{q1.rmse} \\res{q1.nope}\n'
                    '\\bibliography{refs}\n' + END)
            ws = make_ws(tmp, {
                'paper/main.tex': main,
                'paper/sections/intro.tex': '\\label{sec:a}\n\\begin{equation}\\label{eq:1}\\end{equation}\nTODO write this\n## heading\n',
                'paper/refs.bib': '@article{good, title={G}}\n@book{unused1, title={U}}\n@string{x = "y"}\n',
                'figures/fig1.png': 'png',
                'results/q1.json': contract({'rmse': 0.1}),
            })
            write(ws.root / 'paper' / 'results.tex', '\\label{sec:a}\\ref{from-macros}\n')
            paper = latex.load(ws)
            rels = [ws.rel(p) for p in paper.files]
            self.assertEqual(rels, ['paper/main.tex', 'paper/sections/intro.tex'])  # results.tex not scanned
            self.assertEqual(paper.bib_keys, {'good', 'unused1'})
            issues, used = paper_issues(ws)
            got = sorted((i.code, i.message.split('`')[1] if '`' in i.message else '', i.severity) for i in issues)
            self.assertIn(('latex.undefined-ref', 'sec:missing', 'error'), got)
            self.assertNotIn(('latex.undefined-ref', 'eq:1', 'error'), got)
            self.assertFalse(any(c == 'latex.undefined-ref' and k in ('commented', 'from-macros') for c, k, _ in got))
            self.assertEqual(sorted(k for c, k, _ in got if c == 'latex.undefined-cite'), ['bad1', 'bad2'])
            dup = [i for i in issues if i.code == 'latex.duplicate-label']
            self.assertEqual(len(dup), 1)
            self.assertEqual((dup[0].file, dup[0].line), ('paper/main.tex', 7))  # intro.tex is \\input before it
            missing = [i for i in issues if i.code == 'paper.missing-figure']
            self.assertEqual([m.message for m in missing], ['included figure `nofig` does not exist'])
            self.assertEqual(used, {(ws.root / 'figures' / 'fig1.png').resolve()})
            self.assertEqual([i.message for i in issues if i.code == 'numbers.unknown-key'],
                             ['\\res{q1.nope} names no value in results/*.json'])
            unused = [i for i in issues if i.code == 'latex.unused-bib']
            self.assertEqual((unused[0].severity, 'unused1' in unused[0].message), ('info', True))
            self.assertIn('paper.placeholder', codes(issues))
            self.assertIn('latex.markdown-residue', codes(issues))

            scoped, _ = latex.static_checks(ws, paper, {'q1.rmse'}, only='paper/sections/intro.tex')
            self.assertEqual(sorted(set(codes(scoped))), ['latex.markdown-residue', 'paper.placeholder'])
            scoped, _ = latex.static_checks(ws, paper, {'q1.rmse'}, only='paper/main.tex')
            self.assertIn('latex.duplicate-label', codes(scoped))
            self.assertNotIn('latex.unused-bib', codes(scoped))  # whole-paper note only

    def test_graphicspath_needed_and_main_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/report.tex': DOC + '\\includegraphics{fig1}\n' + END,
                               'paper/notes.tex': 'no class here\n', 'figures/fig1.pdf': '%PDF'})
            paper = latex.load(ws)
            self.assertEqual(ws.rel(paper.main), 'paper/report.tex')
            self.assertIn('paper.missing-figure', codes(paper_issues(ws)[0]))  # no \graphicspath
            write(paper.main, DOC.replace('\\input{results}', '\\graphicspath{{../figures/}{./img/}}') +
                  '\\includegraphics{fig1}\n' + END)
            self.assertEqual(paper_issues(ws)[0], [])

    def test_markdown_paper_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.md': '![a](../figures/a.png) ![b](missing.png) ![c](https://x/y.png)\n'
                                                '{{res:q1.v}} {{res:q1.nope}} TBD\n',
                               'figures/a.png': 'x', 'results/q1.json': contract({'v': 1.5})})
            issues, used = paper_issues(ws)
            self.assertEqual(sorted(codes(issues)), ['numbers.unknown-key', 'paper.missing-figure', 'paper.placeholder'])
            self.assertEqual(used, {(ws.root / 'figures' / 'a.png').resolve()})

    def test_parse_log(self):
        log = '\n'.join([
            'This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2023) (preloaded format=pdflatex)',
            '(./main.tex',
            'LaTeX2e <2022-11-01> patch level 1',
            '! Undefined control sequence.',
            'l.42 \\foo',
            '          bar',
            './sections/intro.tex:17: LaTeX Error: Environment foo undefined.',
            'See the LaTeX manual or LaTeX Companion for explanation.',
            '! Undefined control sequence.',
            'l.42 \\foo',
            "LaTeX Warning: Reference `fig:a' on page 3 undefined on input line 55.",
            "LaTeX Warning: Citation `smith2020' on page 4 undefined on input line 6",
            '0.',
            "LaTeX Warning: File `fig1.png' not found on input line 20.",
            'Overfull \\hbox (15.2pt too wide) in paragraph at lines 10--12',
            'Overfull \\hbox (3.0pt too wide) in paragraph at lines 20--21',
            'Overfull \\hbox (22.75pt too wide) in alignment at lines 30--40',
            'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.',
            ')',
            'Output written on main.pdf (5 pages, 123456 bytes).',
        ])
        issues = latex.parse_log(log, 'paper/main.log')
        errors = [(i.code, i.message, i.file, i.line) for i in issues if i.severity == 'error']
        self.assertEqual(errors, [
            ('latex.compile-error', 'Undefined control sequence.', 'paper/main.log', 42),
            ('latex.compile-error', 'LaTeX Error: Environment foo undefined.', 'paper/sections/intro.tex', 17),
            ('paper.missing-figure', 'figure `fig1.png` not found while compiling', 'paper/main.log', None),
        ])
        warnings = {(i.code, i.line) for i in issues if i.severity == 'warning'}
        self.assertEqual(warnings, {('latex.undefined-reference', 55), ('latex.undefined-citation', 60),
                                    ('latex.overfull', None)})
        overfull = [i for i in issues if i.code == 'latex.overfull'][0]
        self.assertIn('2 lines', overfull.message)
        self.assertIn('23pt', overfull.message)
        self.assertIn('latex.rerun', codes(issues))
        self.assertEqual(latex.parse_log('Output written on main.pdf (1 page).\n', 'paper/main.log'), [])

    def test_compile_without_engine_is_info(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + 'Hello.\n' + END})
            paper = latex.load(ws)
            with mock.patch.object(latex.shutil, 'which', return_value=None):
                self.assertIsNone(latex.engine_for(paper))
                issues = latex.compile_paper(ws, paper)
                self.assertEqual([(i.severity, i.code) for i in issues], [('info', 'compile.unavailable')])
                report = engine.status(ws, compile=True)
            self.assertIn('compile.unavailable', codes(report['issues']))
            self.assertEqual(report['counts']['error'], 0)

    def test_engine_choice_follows_cjk(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': '\\documentclass[UTF8]{ctexart}\n\\begin{document}\n' + END})
            paper = latex.load(ws)
            self.assertTrue(paper.cjk)
            with mock.patch.object(latex.shutil, 'which', side_effect=lambda t: '/x/' + t if t == 'xelatex' else None):
                self.assertEqual(latex.engine_for(paper)[0], 'xelatex')

    def test_log_checks_use_only_a_fresh_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + END,
                               'paper/main.log': '! Missing $ inserted.\nl.9 x\nLaTeX Warning: Label(s) may have changed.\n'})
            paper = latex.load(ws)
            self.assertEqual(codes(latex.log_checks(ws, paper)), ['latex.compile-error'])  # rerun note is dropped
            age(ws.root / 'paper' / 'main.log', 100)
            self.assertEqual(latex.log_checks(ws, paper), [])

    def test_strip_comment(self):
        self.assertEqual(latex.strip_comment('50\\% done % note'), '50\\% done ')
        self.assertEqual(latex.strip_comment('a \\\\% b'), 'a \\\\')


class EngineTests(unittest.TestCase):
    def stage(self, report, name):
        return next(s for s in report['stages'] if s['id'] == name)

    def test_empty_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp)
            report = engine.status(ws)
            self.assertEqual(report['schema'], 'mathodology.report/1')
            self.assertEqual({s['id']: s['state'] for s in report['stages']},
                             {'brief': 'missing', 'experiment': 'missing', 'results': 'missing', 'figures': 'missing',
                              'paper': 'missing'})
            self.assertEqual(report['counts'], {'error': 0, 'warning': 0, 'info': 1})
            saved = json.loads((ws.root / '.mathodology' / 'report.json').read_text(encoding='utf-8'))
            self.assertEqual(saved['counts'], report['counts'])
            self.assertFalse((ws.root / 'paper' / 'results.tex').exists())

    def test_stage_states(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {
                'problem/questions.json': json.dumps({'questions': [{'id': 'Q1', 'deliverables': ['a'], 'metrics': ['b']}]}),
                'code/q1.py': 'print(1)\n',
                'results/q1.json': contract({'rmse': 0.0912}),
                'figures/f.png': png(),
                'paper/main.tex': DOC + 'RMSE \\res{q1.rmse}; see \\ref{nope}. \\includegraphics{../figures/f}\n' + END,
            })
            report = engine.status(ws, sync=True)
            states = {s['id']: s['state'] for s in report['stages']}
            self.assertEqual(states, {'brief': 'ok', 'experiment': 'ok', 'results': 'ok', 'figures': 'ok', 'paper': 'error'})
            self.assertIn('1 code file(s), no recorded runs', self.stage(report, 'experiment')['summary'])
            self.assertIn('1 citable value(s)', self.stage(report, 'results')['summary'])
            self.assertIn('1 cited with \\res', self.stage(report, 'paper')['summary'])
            self.assertEqual(report['issues'][0]['code'], 'latex.undefined-ref')  # errors rank first
            self.assertTrue((ws.root / 'paper' / 'results.tex').exists())
            self.assertNotIn('numbers.macros-missing', codes(report['issues']))

    def test_macros_missing_and_not_loaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.0912}),
                               'paper/main.tex': DOC + 'RMSE \\res{q1.rmse}.\n' + END})
            report = engine.status(ws, sync=False)
            self.assertIn('numbers.macros-missing', codes(report['issues']))
            self.assertNotIn('numbers.macros-not-loaded', codes(report['issues']))
            results.sync(ws, results.load(ws)[0])
            write(ws.root / 'results' / 'q1.json', contract({'rmse': 0.5}))
            self.assertIn('numbers.macros-stale', codes(engine.status(ws, sync=False)['issues']))
            report = engine.status(ws, sync=True)
            self.assertFalse({'numbers.macros-missing', 'numbers.macros-stale'} & set(codes(report['issues'])))
            for preamble in ('', '% \\input{results}\n'):
                write(ws.root / 'paper' / 'main.tex', DOC.replace('\\input{results}\n', preamble) + '\\res{q1.rmse}\n' + END)
                report = engine.status(ws, sync=True)
                self.assertIn('numbers.macros-not-loaded', codes(report['issues']), preamble)
                self.assertEqual(self.stage(report, 'paper')['state'], 'error')

    def test_stale_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + 'Text.\n' + END, 'paper/main.pdf': '%PDF',
                               'results/q1.json': contract({'v': 1.5})})
            pdf = ws.root / 'paper' / 'main.pdf'
            self.assertNotIn('paper.stale-pdf', codes(engine.status(ws)['issues']))
            age(pdf, 100)
            report = engine.status(ws)
            stale = [i for i in report['issues'] if i['code'] == 'paper.stale-pdf']
            self.assertEqual(len(stale), 1)
            self.assertEqual(stale[0]['severity'], 'warning')
            self.assertIn('paper/main.tex', stale[0]['message'])
            self.assertIn('results/q1.json', stale[0]['message'])
            self.assertEqual(self.stage(report, 'paper')['state'], 'warning')

    def test_file_checks_scoped_to_one_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + '\\ref{a}\n\\input{sec}\n' + END,
                               'paper/sec.tex': 'ok \\ref{b} 0.0925\n', 'paper/other.tex': '\\ref{c}\n',
                               'results/q1.json': contract({'rmse': 0.0912})})
            got = engine.file_checks(ws, 'paper/sec.tex')
            self.assertEqual(sorted(codes(got)), ['latex.undefined-ref', 'numbers.near-miss'])
            self.assertEqual({i.file for i in got}, {'paper/sec.tex'})
            self.assertEqual(engine.file_checks(ws, 'paper/other.tex'), [])  # not part of the paper


class RunsTests(unittest.TestCase):
    SCRIPT = ('import json, os, sys\n'
              'seed = os.environ.get("MATHODOLOGY_SEED")\n'
              'json.dump({"schema": "mathodology.results/1", "question": "Q1", "values": {"seed": int(seed or -1), "rmse": 0.25},\n'
              '           "provenance": {"run": os.environ.get("MATHODOLOGY_RUN_ID")}}, open("results/q1.json", "w"))\n'
              'open("figures/f1.png", "w").write("png")\n'
              'print("done"); print("warn", file=sys.stderr)\n'
              'sys.exit(int(os.environ.get("EXIT_WITH", "0")))\n')

    def run_quiet(self, ws, command, **kw):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return runs.run(ws, command, **kw)

    def test_run_records_manifest_and_check_flags_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'code/q1.py': self.SCRIPT, 'problem/statement.md': '问题一 x\n'})
            code, manifest = self.run_quiet(ws, [sys.executable, 'code/q1.py'], seed=42)
            self.assertEqual(code, 0)
            self.assertEqual(manifest['schema'], 'mathodology.run/1')
            self.assertTrue(manifest['id'].endswith('-q1'))
            self.assertEqual(manifest['seed'], 42)
            self.assertEqual(manifest['exit_code'], 0)
            self.assertEqual(sorted(manifest['outputs']), ['figures/f1.png', 'results/q1.json'])
            self.assertEqual(sorted(manifest['inputs']), ['code/q1.py', 'problem/statement.md'])
            for key in ('command', 'started', 'duration_s', 'python', 'platform', 'git', 'logs'):
                self.assertIn(key, manifest)
            data = json.loads((ws.root / 'results' / 'q1.json').read_text())
            self.assertEqual(data['values']['seed'], 42)  # the child saw MATHODOLOGY_SEED
            self.assertEqual(data['provenance']['run'], manifest['id'])
            folder = ws.root / 'runs' / manifest['id']
            self.assertEqual((folder / 'stdout.log').read_text().strip(), 'done')
            self.assertEqual((folder / 'stderr.log').read_text().strip(), 'warn')
            self.assertEqual(json.loads((folder / 'manifest.json').read_text())['id'], manifest['id'])
            index = [json.loads(l) for l in (ws.root / 'runs' / 'index.jsonl').read_text().splitlines()]
            self.assertEqual([i['id'] for i in index], [manifest['id']])

            issues, summary = runs.check(ws, ['results/q1.json'])
            self.assertEqual((issues, summary), ([], {'runs': 1, 'failed': 0}))

            # A rerun lists only the files whose content changed (the figure is identical).
            _, again = self.run_quiet(ws, [sys.executable, 'code/q1.py'], seed=42, name='same')
            self.assertNotEqual(again['id'], manifest['id'])
            self.assertEqual(sorted(again['outputs']), ['results/q1.json'])  # the run id inside changed
            self.assertTrue(again['id'].endswith('-same'))

            # Hand edit of the results file.
            write(ws.root / 'results' / 'q1.json', contract({'seed': 42, 'rmse': 0.2}))
            issues, _ = runs.check(ws, ['results/q1.json'])
            self.assertEqual([(i.code, i.severity, i.file) for i in issues], [('runs.modified', 'warning', 'results/q1.json')])

            # Code changed after the run that produced the current results.
            self.run_quiet(ws, [sys.executable, 'code/q1.py'], seed=42)
            write(ws.root / 'code' / 'q1.py', self.SCRIPT + '# tweak\n')
            issues, _ = runs.check(ws, ['results/q1.json', 'results/other.json'])
            self.assertEqual(codes(issues), ['runs.stale-code', 'runs.unrecorded'])
            self.assertIn('code/q1.py', issues[0].message)

    def test_exit_code_propagates_and_failed_runs_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'code/q1.py': self.SCRIPT})
            with mock.patch.dict(os.environ, {'EXIT_WITH': '3'}):
                code, manifest = self.run_quiet(ws, [sys.executable, 'code/q1.py'])
            self.assertEqual((code, manifest['exit_code'], manifest['seed']), (3, 3, None))
            data = json.loads((ws.root / 'results' / 'q1.json').read_text())
            self.assertEqual(data['values']['seed'], -1)  # no seed given, none in the environment
            issues, summary = runs.check(ws, ['results/q1.json'])
            self.assertEqual(summary, {'runs': 1, 'failed': 1})
            self.assertEqual([(i.code, i.severity) for i in issues], [('runs.failed', 'info'), ('runs.from-failed', 'warning')])
            code, manifest = self.run_quiet(ws, ['definitely-not-a-command-xyz'])
            self.assertEqual(code, 127)
            self.assertEqual(runs.check(ws, [])[1], {'runs': 2, 'failed': 2})

    def test_no_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp)
            self.assertEqual(runs.check(ws, []), ([], {'runs': 0, 'failed': 0}))
            self.assertEqual(codes(runs.check(ws, ['results/a.json'])[0]), ['runs.none'])

    def test_cli_run_exit_code_and_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'code/q1.py': self.SCRIPT})
            code, out, err = run_cli(tmp, '--root', str(ws.root), 'run', '--seed', '7', '--', sys.executable, 'code/q1.py')
            self.assertEqual(code, 0, err)
            self.assertIn('done', out)
            self.assertIn('2 output(s) changed', err)
            self.assertIn('{mtdres@q1.seed}{7}', (ws.root / 'paper' / 'results.tex').read_text())
            env_code = subprocess.run([sys.executable, str(MTD), '--root', str(ws.root), 'run', '--', sys.executable, 'code/q1.py'],
                                      capture_output=True, text=True, env={**hook_env(tmp), 'EXIT_WITH': '5'}).returncode
            self.assertEqual(env_code, 5)


class FiguresTests(unittest.TestCase):
    def test_stale_and_unused_figures(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {
                'code/plot.py': 'import json\nd = json.load(open("results/q1.json"))\nsavefig("figures/fig1.png")\n'
                                'name = "x"\nsavefig(f"figures/{name}.png")\n',
                'results/q1.json': contract({'v': 1.5}),
                'figures/fig1.png': 'png',
                'figures/extra.png': 'png',
                'figures/fig1.pdf': 'pdf',
            })
            script, data, image = ws.root / 'code' / 'plot.py', ws.root / 'results' / 'q1.json', ws.root / 'figures' / 'fig1.png'
            age(script, 300)
            age(image, 200)
            age(data, 100)
            scanned = figures.scan(ws)
            self.assertEqual(len(scanned), 1)
            self.assertEqual(scanned[0].outputs, {image.resolve()})
            self.assertEqual(scanned[0].sources, {data.resolve()})
            used = {(ws.root / 'figures' / 'fig1.pdf').resolve()}
            issues, summary = figures.check(ws, used, True)
            got = {i.code: i for i in issues}
            self.assertEqual(got['figures.stale'].severity, 'warning')
            self.assertEqual(got['figures.stale'].file, 'figures/fig1.png')
            self.assertIn('results/q1.json', got['figures.stale'].message)
            self.assertEqual(got['figures.unused'].severity, 'info')
            self.assertIn('figures/extra.png', got['figures.unused'].message)
            self.assertNotIn('fig1', got['figures.unused'].message)  # the PNG twin of a used PDF counts as used
            self.assertIn('figures.untraced', got)  # fig1.pdf is in the paper but no script names it
            self.assertEqual(summary, {'figures': 3, 'traced': 1, 'scripts': 1})

            age(data, 400)  # data older than the image again, but the script is newer
            age(script, 50)
            issues, _ = figures.check(ws, set(), False)
            self.assertEqual([(i.code, 'script' in i.message) for i in issues], [('figures.stale', True)])
            age(script, 500)
            self.assertEqual(figures.check(ws, set(), False)[0], [])


class HookTests(unittest.TestCase):
    def setUp(self):
        self.tmp_obj = tempfile.TemporaryDirectory()
        self.tmp = self.tmp_obj.name
        self.ws = make_ws(self.tmp, {'results/q1.json': contract({'rmse': 0.0912}),
                                     'paper/main.tex': DOC + 'Text \\res{q1.rmse}.\n' + END})
        self.root = self.ws.root

    def tearDown(self):
        self.tmp_obj.cleanup()

    def hook(self, event, payload, cwd=None):
        code, out, err = run_hook(self.tmp, event, payload, cwd)
        self.assertEqual(code, 0, err)
        return json.loads(out) if out.strip() else None

    def edit(self, rel, tool='Write', **extra):
        return {'session_id': 's1', 'cwd': str(self.root), 'tool_name': tool,
                'tool_input': {'file_path': str(self.root / rel)}, **extra}

    def test_pre_edit_guards_results_and_macros(self):
        for rel in ('results/q1.json', 'results/new/q2.json', 'paper/results.tex'):
            reply = self.hook('pre-edit', self.edit(rel))
            out = reply['hookSpecificOutput']
            self.assertEqual((out['hookEventName'], out['permissionDecision']), ('PreToolUse', 'deny'), rel)
            self.assertIn(rel, out['permissionDecisionReason'])
        relative = {'cwd': str(self.root), 'tool_name': 'Edit', 'tool_input': {'file_path': 'results/q1.json'}}
        self.assertEqual(self.hook('pre-edit', relative)['hookSpecificOutput']['permissionDecision'], 'deny')
        for rel in ('paper/main.tex', 'code/q1.py', 'results/notes.md', 'results/data.csv'):
            self.assertIsNone(self.hook('pre-edit', self.edit(rel)), rel)
        self.assertIsNone(self.hook('pre-edit', self.edit('results/q1.json', tool='Read')))
        write(self.root / '.mathodology' / 'config.json', json.dumps({'allow_result_edits': True}))
        self.assertIsNone(self.hook('pre-edit', self.edit('results/q1.json')))
        # The generated macro file stays protected even then.
        self.assertEqual(self.hook('pre-edit', self.edit('paper/results.tex'))['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_post_tool_paper_edit_blocks_on_errors_only(self):
        write(self.root / 'paper' / 'main.tex', DOC + 'See \\ref{nope}.\n' + END)
        reply = self.hook('post-tool', self.edit('paper/main.tex', tool='Edit'))
        self.assertEqual(reply['decision'], 'block')
        self.assertIn('nope', reply['reason'])
        write(self.root / 'paper' / 'main.tex', DOC + 'RMSE 0.0925.\n' + END)
        reply = self.hook('post-tool', self.edit('paper/main.tex', tool='Edit'))
        self.assertNotIn('decision', reply)
        self.assertEqual(reply['hookSpecificOutput']['hookEventName'], 'PostToolUse')
        self.assertIn('0.0925', reply['hookSpecificOutput']['additionalContext'])
        write(self.root / 'paper' / 'main.tex', DOC + 'Fine.\n' + END)
        self.assertIsNone(self.hook('post-tool', self.edit('paper/main.tex', tool='Edit')))
        self.assertIsNone(self.hook('post-tool', self.edit('code/q1.py', tool='Edit')))

    def test_post_tool_after_bash_syncs_only_when_results_change(self):
        macros = self.root / 'paper' / 'results.tex'
        bash = {'session_id': 's2', 'cwd': str(self.root), 'tool_name': 'Bash', 'tool_input': {'command': 'python x.py'}}
        reply = self.hook('post-tool', bash)
        self.assertIn('refreshed paper/results.tex', reply['hookSpecificOutput']['additionalContext'])
        self.assertIn('{mtdres@q1.rmse}{0.0912}', macros.read_text())
        self.assertIsNone(self.hook('post-tool', bash))  # nothing changed since
        before = macros.stat().st_mtime_ns
        self.assertIsNone(self.hook('post-tool', bash))
        self.assertEqual(macros.stat().st_mtime_ns, before)
        q1 = write(self.root / 'results' / 'q1.json', contract({'rmse': 0.5}))
        t = time.time() + 5
        os.utime(q1, (t, t))
        reply = self.hook('post-tool', bash)
        self.assertIn('refreshed', reply['hookSpecificOutput']['additionalContext'])
        self.assertIn('{mtdres@q1.rmse}{0.5}', macros.read_text())
        # Contract errors are reported too.
        bad = write(self.root / 'results' / 'q1.json', contract({'rmse': 'oops'}))
        os.utime(bad, (t + 5, t + 5))
        reply = self.hook('post-tool', bash)
        self.assertIn('Results contract problems', reply['hookSpecificOutput']['additionalContext'])
        # Bash from another folder still finds the workspace remembered for this session.
        write(self.root / 'results' / 'q1.json', contract({'rmse': 0.75}))
        os.utime(self.root / 'results' / 'q1.json', (t + 10, t + 10))
        self.hook('post-tool', self.edit('paper/main.tex', tool='Edit', session_id='s3'))
        elsewhere = Path(self.tmp) / 'elsewhere'
        elsewhere.mkdir()
        reply = self.hook('post-tool', {**bash, 'session_id': 's3', 'cwd': str(elsewhere)}, cwd=elsewhere)
        self.assertIn('refreshed', reply['hookSpecificOutput']['additionalContext'])

    def test_post_tool_results_write_syncs(self):
        write(self.root / 'results' / 'q1.json', contract({'rmse': 0.33}))
        reply = self.hook('post-tool', self.edit('results/q1.json'))
        self.assertIn('refreshed', reply['hookSpecificOutput']['additionalContext'])
        self.assertIn('{0.33}', (self.root / 'paper' / 'results.tex').read_text())

    def test_stop_blocks_once_and_rearms(self):
        stop = {'session_id': 's4', 'cwd': str(self.root)}
        main = self.root / 'paper' / 'main.tex'
        broken = DOC + 'See \\ref{sec:x}.\n' + END
        write(main, broken)
        reply = self.hook('stop', stop)
        self.assertEqual(reply['decision'], 'block')
        self.assertIn('sec:x', reply['reason'])
        self.assertTrue((self.root / '.mathodology' / 'stop.json').exists())
        self.assertIsNone(self.hook('stop', stop))  # same problems: raised once only
        self.assertIsNone(self.hook('stop', {**stop, 'stop_hook_active': True}))
        write(main, DOC + '\\section{X}\\label{sec:x} See \\ref{sec:x}.\n' + END)
        self.assertIsNone(self.hook('stop', stop))
        self.assertFalse((self.root / '.mathodology' / 'stop.json').exists())
        write(main, broken)
        self.assertEqual(self.hook('stop', stop)['decision'], 'block')  # re-armed after the fix
        write(main, DOC + 'See \\ref{sec:y}.\n' + END)
        self.assertEqual(self.hook('stop', stop)['decision'], 'block')  # a different problem set

    def test_stop_respects_active_flag_and_gate(self):
        write(self.root / 'paper' / 'main.tex', DOC + 'See \\ref{sec:x}.\n' + END)
        stop = {'session_id': 's5', 'cwd': str(self.root)}
        self.assertIsNone(self.hook('stop', {**stop, 'stop_hook_active': True}))
        write(self.root / '.mathodology' / 'config.json', json.dumps({'stop_gate': 'off'}))
        self.assertIsNone(self.hook('stop', stop))
        self.assertFalse((self.root / '.mathodology' / 'stop.json').exists())
        # 'warnings' also blocks on a warning-only problem set; 'errors' does not.
        write(self.root / 'paper' / 'main.tex', DOC + 'RMSE 0.0925.\n' + END)
        write(self.root / '.mathodology' / 'config.json', json.dumps({'stop_gate': 'errors'}))
        self.assertIsNone(self.hook('stop', stop))
        write(self.root / '.mathodology' / 'config.json', json.dumps({'stop_gate': 'warnings'}))
        self.assertEqual(self.hook('stop', stop)['decision'], 'block')

    def test_session_start(self):
        reply = self.hook('session-start', {'session_id': 's6', 'cwd': str(self.root), 'source': 'startup'})
        context = reply['hookSpecificOutput']['additionalContext']
        self.assertEqual(reply['hookSpecificOutput']['hookEventName'], 'SessionStart')
        self.assertIn('Mathodology workspace', context)
        self.assertIn('mtd.py', context)
        self.assertTrue((self.root / 'paper' / 'results.tex').exists())

    def test_silent_outside_workspace_and_on_bad_input(self):
        outside = Path(self.tmp) / 'plain'
        (outside / 'results').mkdir(parents=True)
        payloads = {
            'session-start': {'session_id': 'z', 'cwd': str(outside)},
            'pre-edit': {'session_id': 'z', 'cwd': str(outside), 'tool_name': 'Write',
                         'tool_input': {'file_path': str(outside / 'results' / 'q1.json')}},
            'post-tool': {'session_id': 'z', 'cwd': str(outside), 'tool_name': 'Bash', 'tool_input': {'command': 'ls'}},
            'stop': {'session_id': 'z', 'cwd': str(outside)},
        }
        for event, payload in payloads.items():
            for stdin in (payload, '', 'not json {', '[1, 2]', '"text"', 'null'):
                code, out, _ = run_hook(self.tmp, event, stdin, cwd=outside)
                self.assertEqual((code, out), (0, ''), (event, stdin))
        # Malformed input is silent inside a workspace too.
        for event in payloads:
            for stdin in ('not json {', '[1, 2]', '{"tool_input": "x", "tool_name": "Write"}'):
                code, out, _ = run_hook(self.tmp, event, stdin, cwd=self.root)
                self.assertEqual((code, out), (0, ''), (event, stdin))


class InstallHooksTests(unittest.TestCase):
    def our_groups(self, settings):
        return {event: [g for g in groups if any(mtd.MARK in h['command'] for h in g['hooks'])]
                for event, groups in settings.get('hooks', {}).items()}

    def test_merge_idempotent_and_remove(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            other = {'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'echo other'}]}
            original = {'permissions': {'allow': ['Bash(ls)']}, 'model': 'x',
                        'hooks': {'PreToolUse': [other], 'Notification': [{'hooks': [{'type': 'command', 'command': 'notify'}]}]}}
            write(root / '.claude' / 'settings.json', json.dumps(original))
            path = mtd.install_hooks(root)
            first = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(first['permissions'], original['permissions'])
            self.assertEqual(first['model'], 'x')
            self.assertEqual(first['hooks']['Notification'], original['hooks']['Notification'])
            self.assertEqual(first['hooks']['PreToolUse'][0], other)
            ours = self.our_groups(first)
            self.assertEqual({e: len(g) for e, g in ours.items() if g},
                             {'SessionStart': 1, 'PreToolUse': 1, 'PostToolUse': 1, 'Stop': 1})
            command = ours['PreToolUse'][0]['hooks'][0]['command']
            self.assertTrue(command.endswith('mtd.py" hook pre-edit'), command)
            self.assertIn(str(MTD), command)  # script outside the root: absolute path
            self.assertNotIn('{mtd}', path.read_text())
            mtd.install_hooks(root)
            second = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(second, first)
            mtd.install_hooks(root, remove=True)
            removed = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(removed, original)

    def test_install_into_empty_and_remove_drops_hooks_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = mtd.install_hooks(root)
            self.assertEqual(sorted(json.loads(path.read_text())['hooks']), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'])
            mtd.install_hooks(root, remove=True)
            self.assertEqual(json.loads(path.read_text()), {})

    def test_command_relative_to_project_when_inside(self):
        inside = MTD.parents[4]  # the repository that contains .claude/skills/...
        command = mtd.hook_command(inside)
        self.assertTrue(command.endswith('exec "$p" "$CLAUDE_PROJECT_DIR"/.claude/skills/mathodology-workbench/scripts/mtd.py'))
        self.assertIn('sys.version_info < (3, 9)', command)
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(mtd.hook_command(Path(tmp)).endswith(f'exec "$p" "{MTD.as_posix()}"'))

    def test_invalid_settings_json_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(Path(tmp, '.claude', 'settings.json'), '{oops')
            with self.assertRaises(SystemExit):
                mtd.install_hooks(Path(tmp))
            self.assertEqual(Path(tmp, '.claude', 'settings.json').read_text(), '{oops')

    def test_installed_command_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mtd.install_hooks(root)
            command = self.our_groups(json.loads((root / '.claude' / 'settings.json').read_text()))['Stop'][0]['hooks'][0]['command']
            proc = subprocess.run(['bash', '-c', command], input='{}', capture_output=True, text=True, cwd=tmp,
                                  env=hook_env(tmp), timeout=60)
            self.assertEqual((proc.returncode, proc.stdout), (0, ''), proc.stderr)


class CliTests(unittest.TestCase):
    def test_init_check_status_json_sync_and_brief(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'proj'
            code, out, err = run_cli(tmp, '--root', str(root), 'init', '--paper-template')
            self.assertEqual(code, 0, err)
            for name in ('problem', 'code', 'results', 'figures', 'paper', '.mathodology/config.json', 'paper/main.tex',
                         '.claude/settings.json'):
                self.assertTrue((root / name).exists(), name)
            self.assertIsNotNone(find_workspace(root / 'paper'))

            code, out, err = run_cli(tmp, '--root', str(root), 'check')
            self.assertEqual(code, 0, out + err)  # template paper is clean

            write(root / 'problem' / 'statement.md', '问题一 预测\n问题二 优化\n')
            code, out, err = run_cli(tmp, '--root', str(root), 'brief')
            self.assertEqual(code, 0, err)
            self.assertIn('2 question(s)', out)
            self.assertEqual(run_cli(tmp, '--root', str(root), 'brief')[0], 1)  # refuses to overwrite
            self.assertEqual(run_cli(tmp, '--root', str(root), 'brief', '--force')[0], 0)

            write(root / 'results' / 'q1.json', contract({'rmse': 0.0912}))
            code, out, _ = run_cli(tmp, '--root', str(root), 'sync')
            self.assertEqual(code, 0)
            self.assertIn('1 value(s), 0 table(s) in paper/tables/, updated', out)
            self.assertIn('already current', run_cli(tmp, '--root', str(root), 'sync')[1])

            main = root / 'paper' / 'main.tex'
            main.write_text(main.read_text().replace('\\maketitle', '\\maketitle\nSee \\ref{missing}.'))
            code, out, _ = run_cli(tmp, '--root', str(root), 'check')
            self.assertEqual(code, 1)
            self.assertIn('FAIL', out)
            code, out, _ = run_cli(tmp, '--root', str(root), 'status')
            self.assertEqual(code, 0)
            code, out, _ = run_cli(tmp, '--root', str(root), 'status', '--json')
            self.assertEqual(code, 0)
            report = json.loads(out)
            self.assertGreaterEqual(report['counts']['error'], 1)
            self.assertIn('latex.undefined-ref', codes(report['issues']))
            code, out, _ = run_cli(tmp, '--root', str(root), 'check', '--json')
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(out)['schema'], 'mathodology.report/1')

            # --strict fails on warnings alone.
            main.write_text(main.read_text().replace('See \\ref{missing}.', 'RMSE 0.0925.'))
            self.assertEqual(run_cli(tmp, '--root', str(root), 'check')[0], 0)
            self.assertEqual(run_cli(tmp, '--root', str(root), 'check', '--strict')[0], 1)

            # Found from a subfolder without --root.
            code, out, _ = run_cli(str(root / 'paper'), 'status')
            self.assertEqual(code, 0)
            self.assertIn(str(root.resolve()), out)

    def test_no_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, _, err = run_cli(tmp, 'status')
            self.assertEqual(code, 1)
            self.assertIn('No Mathodology workspace', err)


class ReviewRegressionTests(unittest.TestCase):
    """Problems found in review; each test reproduces the original report."""

    def test_chinese_text_numbers_are_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.0912})})
            report = number_report(ws, '误差为0.0925，成本为1532元。\n')
            self.assertEqual(report.near, 1)

    def test_range_dash_is_not_a_minus_sign(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'lo': 0.80, 'hi': 0.96})})
            report = number_report(ws, 'Accuracy ranged over 0.80--0.96 across folds.\n')
            self.assertEqual((report.checked, report.matched, report.near), (2, 2, 0))

    def test_resizebox_is_not_res(self):
        self.assertIn('0.75', numbers.clean_tex('\\residual 0.75'))

    def test_display_percent_and_unit_specials_are_escaped(self):
        rs = results.ResultSet()
        rs.values['q2.acc'] = results.Value('q2.acc', 0.953, 'results/q2.json', unit='m^2', display='95.3%')
        text = results.macros(rs)
        self.assertIn('{95.3\\%}', text)
        self.assertIn('m\\textasciicircum{}2', text)

    def test_init_template_has_its_macro_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, _, err = run_cli(tmp, '--root', tmp, 'init', '--paper-template', '--no-hooks')
            self.assertEqual(code, 0, err)
            self.assertTrue((Path(tmp) / 'paper' / 'results.tex').is_file())

    def test_virtualenv_inside_code_is_not_walked(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'code/env/pyvenv.cfg': 'home = /usr\n', 'code/env/lib/x.py': 'x = 1\n', 'code/q1.py': 'y = 2\n'})
            self.assertEqual([p.name for p in ws.files('code', ('.py',))], ['q1.py'])

    def test_uppercase_json_results_are_guarded(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp)
            payload = {'session_id': 's', 'cwd': str(ws.root), 'tool_name': 'Write',
                       'tool_input': {'file_path': str(ws.root / 'results' / 'Q2.JSON')}}
            code, out, _ = run_hook(tmp, 'pre-edit', payload)
            self.assertEqual(json.loads(out)['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_unwritable_session_state_does_not_disable_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + '\\ref{nowhere}\n' + END})
            hook_tmp = Path(tmp) / 'hooktmp'
            hook_tmp.mkdir()
            user = os.getuid() if hasattr(os, 'getuid') else os.environ.get('USERNAME', 'user')
            (hook_tmp / f'mathodology-hooks-{user}').write_text('a file where a folder should be')
            payload = {'session_id': 's', 'cwd': str(ws.root), 'tool_name': 'Edit',
                       'tool_input': {'file_path': str(ws.root / 'paper' / 'main.tex')}}
            code, out, err = run_hook(tmp, 'post-tool', payload)
            self.assertEqual(json.loads(out)['decision'], 'block', err)


class FigureAssetTests(unittest.TestCase):
    def test_inspect_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            image = assets.inspect(write(t / 'a.png', png(640, 480)))
            self.assertEqual((image.ok, image.width_px, image.height_px), (True, 640, 480))
            self.assertTrue(assets.inspect(write(t / 'a.pdf', PDF)).ok)
            cut = assets.inspect(write(t / 'b.pdf', PDF[:30]))
            self.assertFalse(cut.ok)
            self.assertIn('truncated', cut.problem)
            self.assertIn('empty', assets.inspect(write(t / 'c.png', b'')).problem)
            self.assertFalse(assets.inspect(write(t / 'd.png', b'<html>not an image</html>')).ok)
            jpeg = b'\xff\xd8\xff\xe0\x00\x04ab\xff\xc0\x00\x0b\x08\x01\x2c\x02\x58\x01\x01\x11\x00\xff\xd9'
            image = assets.inspect(write(t / 'e.jpg', jpeg))
            self.assertEqual((image.ok, image.width_px, image.height_px), (True, 600, 300))
            self.assertFalse(assets.inspect(write(t / 'f.jpg', jpeg[:4])).ok)

    def test_print_width(self):
        self.assertAlmostEqual(assets.print_width_in('width=0.5\\textwidth', 6.0), 3.0)
        self.assertAlmostEqual(assets.print_width_in('width=\\linewidth', 6.0), 6.0)
        self.assertAlmostEqual(assets.print_width_in('height=3cm, width=5.08cm', 6.0), 2.0)
        self.assertIsNone(assets.print_width_in('height=3cm', 6.0))
        self.assertIsNone(assets.print_width_in('textwidth=3cm', 6.0))

    def test_corrupt_and_low_resolution_figures(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {
                'figures/good.png': png(2000, 1000), 'figures/small.png': png(300, 200), 'figures/bad.pdf': PDF[:20],
                'figures/orphan.png': b'', 'figures/fine.pdf': PDF,
                'paper/main.tex': DOC.replace('\\usepackage{graphicx}', '\\usepackage{graphicx}\n\\usepackage[margin=2cm]{geometry}')
                + '\\includegraphics[width=\\textwidth]{../figures/good}\n\\includegraphics[width=0.8\\linewidth]{../figures/small}\n'
                  '\\includegraphics{../figures/bad}\n\\includegraphics[width=8cm]{../figures/fine}\n' + END,
            })
            report = engine.status(ws, sync=True)
            got = {(i['code'], i.get('file'), i['severity']) for i in report['issues'] if i['code'].startswith('figures.')
                   and i['code'] in ('figures.corrupt', 'figures.low-resolution')}
            self.assertEqual(got, {('figures.low-resolution', 'paper/main.tex', 'warning'),
                                   ('figures.corrupt', 'paper/main.tex', 'error'),
                                   ('figures.corrupt', 'figures/orphan.png', 'warning')})
            low = next(i for i in report['issues'] if i['code'] == 'figures.low-resolution')
            self.assertEqual(low['line'], 7)
            self.assertIn('300 px wide', low['message'])
            bad = next(i for i in report['issues'] if i['code'] == 'figures.corrupt' and i['severity'] == 'error')
            self.assertIn('figures/bad.pdf', bad['message'])
            self.assertEqual(self.stage(report)['state'], 'error')

    def stage(self, report):
        return next(s for s in report['stages'] if s['id'] == 'figures')


class StubTests(unittest.TestCase):
    def test_placeholder_code_and_empty_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {
                'code/todo.py': '"""Q2 model."""\n# TODO\npass\n',
                'code/half.py': 'def fit(x):\n    """Fit."""\n    ...\n\ndef run():\n    raise NotImplementedError\n\n'
                                'def ok():\n    return 1\n',
                'code/abstract.py': 'from abc import ABC, abstractmethod\nclass M(ABC):\n    @abstractmethod\n    def f(self):\n        pass\n',
                'code/broken.py': 'def f(:\n',
                'code/empty.py': '',
                'code/__init__.py': '',
                'code/test_x.py': 'def test_a():\n    pass\n',
                'code/real.py': 'print(sum(range(3)))\n',
                'results/q2.json': contract({}),
                'results/q3.json': contract({}, tables={'t': {'columns': ['a'], 'rows': [[1]]}}),
            })
            got = {(i.code, i.file) for i in stubs.check(ws)}
            self.assertEqual(got, {('stubs.placeholder-script', 'code/todo.py'), ('stubs.functions', 'code/half.py'),
                                   ('stubs.syntax', 'code/broken.py'), ('stubs.empty-file', 'code/empty.py')})
            half = next(i for i in stubs.check(ws) if i.code == 'stubs.functions')
            self.assertIn('fit, run', half.message)
            self.assertNotIn('ok', half.message)
            _, issues = results.load(ws)
            self.assertEqual([(i.code, i.file) for i in issues if i.code == 'results.empty'], [('results.empty', 'results/q2.json')])
            report = engine.status(ws)
            self.assertIn('stubs.syntax', codes(report['issues']))
            self.assertEqual(next(s for s in report['stages'] if s['id'] == 'experiment')['state'], 'error')


class UnavailableTests(unittest.TestCase):
    def test_broken_checker_is_a_note_not_a_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.5}), 'paper/main.tex': DOC + 'See \\ref{nope}.\n' + END})
            with mock.patch.object(figures, 'check', side_effect=RuntimeError('boom')):
                report = engine.status(ws, sync=True)
            note = next(i for i in report['issues'] if i['code'] == 'figures.unavailable')
            self.assertEqual(note['severity'], 'info')
            self.assertIn('boom', note['message'])
            fig = next(s for s in report['stages'] if s['id'] == 'figures')
            self.assertIn('(1 check(s) could not run)', fig['summary'])
            self.assertIn('latex.undefined-ref', codes(report['issues']))  # the other checks still ran

    def test_stop_gate_ignores_unavailable_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.5}), 'paper/main.tex': DOC + 'Text \\res{q1.rmse}.\n' + END},
                         config={'stop_gate': 'warnings'})
            with mock.patch.object(latex, 'static_checks', side_effect=ValueError('parser broke')), \
                    mock.patch.object(stubs, 'check', side_effect=OSError('denied')):
                self.assertIsNone(hooks.stop({'session_id': 'u1', 'cwd': str(ws.root)}))
                report = engine.status(ws)
            self.assertEqual(report['counts']['error'] + report['counts']['warning'], 0)
            self.assertTrue({'latex.unavailable', 'stubs.unavailable'} <= set(codes(report['issues'])))

    def test_compile_timeout_and_missing_engine_are_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + 'Hi.\n' + END})
            paper = latex.load(ws)
            with mock.patch.object(latex, 'engine_for', return_value=['pdflatex']), \
                    mock.patch.object(latex.subprocess, 'run', side_effect=subprocess.TimeoutExpired('pdflatex', 5)):
                issues = latex.compile_paper(ws, paper, timeout=5)
            self.assertEqual([(i.severity, i.code) for i in issues], [('info', 'compile.unavailable')])
            with mock.patch.object(latex, 'engine_for', return_value=['pdflatex']), \
                    mock.patch.object(latex.subprocess, 'run', side_effect=OSError('no such file')):
                issues = latex.compile_paper(ws, paper)
            self.assertEqual([(i.severity, i.code) for i in issues], [('info', 'compile.unavailable')])


class TableTests(unittest.TestCase):
    TABLE = {'compare': {'columns': ['Model', 'RMSE', 'R^2 & co'], 'rows': [['ARIMA', 0.123456, 0.9], ['LSTM_v2', 0.0981, None]],
                         'digits': [None, 3, 2]}}

    def test_sync_writes_booktabs_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.5}, tables=self.TABLE),
                               'paper/main.tex': DOC + '\\begin{table}\\centering\\input{tables/q1-compare}\\end{table}\n' + END})
            results.sync(ws, results.load(ws)[0])
            table = ws.root / 'paper' / 'tables' / 'q1-compare.tex'
            text = table.read_text(encoding='utf-8')
            self.assertTrue(results.is_generated(table))
            self.assertIn('\\begin{tabular}{lrr}', text)
            self.assertIn('Model & RMSE & R\\textasciicircum{}2 \\& co \\\\', text)
            self.assertIn('ARIMA & 0.123 & 0.90 \\\\', text)
            self.assertIn('LSTM\\_v2 & 0.098 & -- \\\\', text)
            for rule in ('\\toprule', '\\midrule', '\\bottomrule'):
                self.assertIn(rule, text)
            report = engine.status(ws)
            self.assertFalse({'latex.missing-input', 'numbers.tables-stale'} & set(codes(report['issues'])))
            # Numbers inside the generated table are not read as hand-typed paper numbers.
            self.assertNotIn('numbers.unbound', codes(report['issues']))
            write(table, text.replace('0.123', '0.100'))
            report = engine.status(ws)
            self.assertIn('numbers.tables-stale', codes(report['issues']))
            engine.status(ws, sync=True)
            self.assertEqual(table.read_text(encoding='utf-8'), text)

    def test_stale_tables_removed_and_hand_written_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.5}, tables=self.TABLE),
                               'paper/tables/mine.tex': 'hand written\n', 'paper/main.tex': DOC + END})
            results.sync(ws, results.load(ws)[0])
            write(ws.root / 'paper' / 'tables' / 'q1-other.tex', 'mine too\n')
            write(ws.root / 'results' / 'q1.json', contract({'rmse': 0.5}))
            write(ws.root / 'results' / 'q2.json', contract({}, tables={'other': {'columns': ['a'], 'rows': [[1]]}}))
            results.sync(ws, results.load(ws)[0])
            names = sorted(p.name for p in (ws.root / 'paper' / 'tables').iterdir())
            self.assertEqual(names, ['mine.tex', 'q1-other.tex', 'q2-other.tex'])
            self.assertEqual((ws.root / 'paper' / 'tables' / 'q1-other.tex').read_text(encoding='utf-8'), 'mine too\n')

    def test_missing_table_input_hints_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'paper/main.tex': DOC + '\\input{tables/q9-x}\n\\input{sections/gone}\n' + END})
            issues, _ = paper_issues(ws)
            missing = [i for i in issues if i.code == 'latex.missing-input']
            self.assertEqual([i.line for i in missing], [5, 6])
            self.assertIn('mtd.py sync', missing[0].hint)
            self.assertNotIn('sync', missing[1].hint)

    def test_cli_sync_reports_tables_and_hook_guards_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = make_ws(tmp, {'results/q1.json': contract({'rmse': 0.5}, tables=self.TABLE), 'paper/main.tex': DOC + END})
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(mtd.main(['--root', str(ws.root), 'sync']), 0)
            self.assertIn('1 table(s) in paper/tables/', out.getvalue())
            edit = lambda rel: {'cwd': str(ws.root), 'tool_name': 'Edit', 'tool_input': {'file_path': str(ws.root / rel)}}
            self.assertEqual(hooks.pre_edit(edit('paper/tables/q1-compare.tex'))['hookSpecificOutput']['permissionDecision'], 'deny')
            write(ws.root / 'paper' / 'tables' / 'mine.tex', 'x\n')
            self.assertIsNone(hooks.pre_edit(edit('paper/tables/mine.tex')))
            self.assertIsNone(hooks.pre_edit(edit('paper/tables/new.tex')))


class MarkdownTests(unittest.TestCase):
    def check(self, text, bib=None):
        with tempfile.TemporaryDirectory() as tmp:
            files = {'paper/main.md': text}
            if bib:
                files['paper/refs.bib'] = bib
            ws = make_ws(tmp, files)
            issues, _ = paper_issues(ws)
            return [(i.code, i.line) for i in issues if i.code.startswith('md.')], issues

    def test_clean_document(self):
        got, _ = self.check('# Model\n\nThe loss $L = \\sum_i (y_i - \\hat y_i)^2$ and price \\$5 [1].\n\n'
                            '$$\nE = mc^2\n$$\n\nAlso \\(a+b\\) and \\[x\\] [2-3]<sup>[4]</sup>.\n\n'
                            '```python\nx = "$" + "\\\\frac"  # [9]\n```\n\nCode `a$b` here.\n\n'
                            '## 参考文献\n\n[1] A. One.\n[2] B. Two.\n3. C. Three.\n- [4] D. Four.\n')
        self.assertEqual(got, [])

    def test_math_delimiters(self):
        got, _ = self.check('Cost is $x + y here.\n\nNext $a$ paragraph.\n\nOpen \\[ x\n\nand \\) stray.\n')
        self.assertEqual(sorted(got), [('md.unclosed-math', 5), ('md.unclosed-math', 7), ('md.unpaired-dollar', 1)])
        got, _ = self.check('Fine $$a$$ and\n\n$$\nE = mc^2\n$$\n\n$$\nx = 1\n\nnever closed\n')
        self.assertEqual(got, [('md.unclosed-display-math', 7)])
        got, _ = self.check('```\ncode\n')
        self.assertEqual(got, [('md.unclosed-fence', 1)])

    def test_bare_latex(self):
        got, _ = self.check('The rate is \\frac{a}{b} per day.\n\nFine: $\\alpha$ and $$\\beta$$.\n\n\\begin{equation}\nx\n\\end{equation}\n')
        self.assertEqual(got, [('md.bare-latex', 1), ('md.bare-latex', 5)])

    def test_citation_closure(self):
        got, issues = self.check('Prior work [1, 3] and [5-6]; see [link](x) and ![i](y) and [^1].\n\n'
                                 '# References\n\n[1] One.\n[2] Two.\n[3] Three.\n[5] Five.\n\n# Appendix\n\nAgain [6], outside the list.\n')
        self.assertEqual(sorted(got), [('md.undefined-cite', 1), ('md.undefined-cite', 12), ('md.unused-ref', 3)])
        undefined = next(i for i in issues if i.code == 'md.undefined-cite')
        self.assertIn('[6]', undefined.message)
        self.assertIn('[2]', next(i for i in issues if i.code == 'md.unused-ref').message)

    def test_numbered_citations_without_list(self):
        got, _ = self.check('As shown in [2].\n')
        self.assertEqual(got, [('md.no-references', 1)])

    def test_pandoc_citations(self):
        bib = '@article{smith2020, title={X}}\n@book{li2019, title={Y}}\n'
        got, issues = self.check('See [@smith2020; @li2019, p. 3] and [-@ghost2021]. Mail me at a@b.com.\n', bib)
        self.assertEqual(got, [('md.undefined-cite', 1)])
        self.assertIn('@ghost2021', next(i for i in issues if i.code == 'md.undefined-cite').message)
        got, _ = self.check('See [@smith2020].\n')
        self.assertEqual(got, [('md.undefined-cite', 1)])


if __name__ == '__main__':
    unittest.main()
