"""Problem brief: one entry per top-level question, with its deliverables and how it is judged."""
from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

from .report import Issue
from .workspace import Workspace, read_text, write_json

SCHEMA = 'mathodology.questions/1'
CN = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
LEAD = r'^\s*(?:[#>*\-]+\s*)?(?:\*\*|__)?\s*'
END = r'(?=\s|[:：.、)）*]|$)'
FAMILIES = [
    re.compile(LEAD + r'问题\s*([一二三四五六七八九十]{1,3}|\d{1,2})' + END),
    re.compile(LEAD + r'第\s*([一二三四五六七八九十]{1,3}|\d{1,2})\s*(?:问|题|小题)' + END),
    re.compile(LEAD + r'(?:Problem|Question|Task|Requirement)\s*(\d{1,2}|[IVX]{1,4})' + END, re.I),
    re.compile(LEAD + r'[（(]([一二三四五六七八九十]{1,3})[）)]'),
    re.compile(LEAD + r'(?:Q)(\d{1,2})' + END),
]
ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10}
STATEMENT_HINTS = ('statement', 'problem', 'question', 'task', '赛题', '题目', '问题')
READABLE = ('.md', '.txt', '.tex', '.pdf', '.docx')


def number(token: str) -> int | None:
    if token.isdigit():
        return int(token)
    if token.upper() in ROMAN:
        return ROMAN[token.upper()]
    if all(ch in CN for ch in token):
        if token == '十':
            return 10
        if token.startswith('十'):
            return 10 + CN[token[1]]
        if len(token) == 2 and token.endswith('十'):
            return CN[token[0]] * 10
        if len(token) == 3 and token[1] == '十':
            return CN[token[0]] * 10 + CN[token[2]]
        return CN[token] if len(token) == 1 else None
    return None


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        if not shutil.which('pdftotext'):
            raise RuntimeError('pdftotext (Poppler) is needed to read a PDF; or save the statement as .md/.txt')
        proc = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, timeout=120)
        return proc.stdout.decode('utf-8', 'replace')
    if suffix == '.docx':
        with zipfile.ZipFile(path) as z:
            xml = z.read('word/document.xml').decode('utf-8', 'replace')
        xml = re.sub(r'</w:p>', '\n', xml)
        return re.sub(r'<[^>]+>', '', xml)
    return read_text(path)


def find_statement(ws: Workspace) -> Path | None:
    candidates = [p for p in ws.files('problem', READABLE) if p.name != 'questions.json']
    if not candidates:
        return None
    return sorted(candidates, key=lambda p: (not any(h in p.name.lower() for h in STATEMENT_HINTS),
                                             p.suffix.lower() not in ('.md', '.txt'), -p.stat().st_size))[0]


def detect(text: str) -> list[dict]:
    """Top-level numbered questions only; (1)(2) or a/b inside a question are parts of it."""
    lines = text.splitlines()
    for family in FAMILIES:
        hits: list[tuple[int, int]] = []
        seen = set()
        for i, line in enumerate(lines):
            m = family.match(line)
            if m:
                n = number(m.group(1))
                if n and n not in seen:
                    seen.add(n)
                    hits.append((n, i))
        # Keep the run 1, 2, 3 ... so a stray "Question 7" in a footnote cannot add questions.
        run = []
        for n, i in sorted(hits, key=lambda h: h[1]):
            if n == len(run) + 1:
                run.append(i)
        if run:
            out = []
            for k, start in enumerate(run):
                stop = run[k + 1] if k + 1 < len(run) else len(lines)
                body = '\n'.join(lines[start:stop]).strip()
                title = re.sub(r'[*#_>`]+', '', lines[start]).strip()
                out.append({'id': f'Q{k + 1}', 'title': title[:120], 'text': body[:1500],
                            'deliverables': [], 'metrics': [], 'inputs': [], 'assumptions': [], 'depends_on': []})
            return out
    return []


def make(ws: Workspace, source: Path | None) -> tuple[dict, Path | None]:
    source = source or find_statement(ws)
    questions = detect(extract_text(source)) if source else []
    data = {'schema': SCHEMA, 'source': ws.rel(source) if source else None, 'questions': questions,
            'notes': 'Fill deliverables (what answers each question), metrics (how an answer is judged), inputs '
                     '(data and parameters), assumptions and depends_on. Edit freely; ids are referenced by results files.'}
    return data, source


def path(ws: Workspace) -> Path:
    return ws.dir('problem') / 'questions.json'


def write(ws: Workspace, data: dict, force: bool = False) -> bool:
    target = path(ws)
    if target.exists() and not force:
        return False
    write_json(target, data)
    return True


def check(ws: Workspace, result_questions: dict[str, list[str]], contract_files: int) -> tuple[list[Issue], dict]:
    target = path(ws)
    rel = ws.rel(target)
    if not target.exists():
        return [Issue('info', 'brief', 'brief.missing', 'no problem/questions.json',
                      hint='`mtd.py brief` lists the questions from the statement')], {'questions': 0}
    try:
        data = json.loads(read_text(target))
    except ValueError as exc:
        return [Issue('error', 'brief', 'brief.json', f'not valid JSON: {exc}', rel)], {'questions': 0}
    questions = data.get('questions') if isinstance(data, dict) else None
    if not isinstance(questions, list):
        return [Issue('error', 'brief', 'brief.questions', '`questions` must be a list', rel)], {'questions': 0}
    issues: list[Issue] = []
    ids = [str(q.get('id')) for q in questions if isinstance(q, dict)]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        issues.append(Issue('error', 'brief', 'brief.duplicate', f'question ids repeated: {", ".join(dupes)}', rel))
    for q in questions:
        if not isinstance(q, dict) or not q.get('id'):
            issues.append(Issue('error', 'brief', 'brief.question', 'every question needs an `id`', rel))
            continue
        qid = str(q['id'])
        if not q.get('deliverables'):
            issues.append(Issue('warning', 'brief', 'brief.deliverables', f'{qid}: no deliverables (what exactly answers it?)', rel))
        if not q.get('metrics'):
            issues.append(Issue('warning', 'brief', 'brief.metrics', f'{qid}: no metrics (how will an answer be judged?)', rel))
        for dep in q.get('depends_on') or []:
            if str(dep) not in ids:
                issues.append(Issue('error', 'brief', 'brief.depends', f'{qid} depends on unknown question {dep}', rel))
        if contract_files and qid not in result_questions:
            issues.append(Issue('warning', 'results', 'coverage.question', f'{qid} has no results file with "question": "{qid}"', rel))
    for qid, files in result_questions.items():
        if qid not in ids:
            issues.append(Issue('warning', 'results', 'coverage.unknown', f'results name question {qid}, which the brief does not list', files[0]))
    return issues, {'questions': len(questions)}
