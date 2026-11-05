"""Mechanical checks of the contest format named in .mathodology/config.json ("contest").

Only rules that were read in an official text (or an official notice copied by a university)
are checked; the date is recorded in references/contest-formats.md. Rules change every year,
so every finding is a warning to confirm against the current rules, never a pass.
"""
from __future__ import annotations

import re

from .latex import Paper
from .report import Issue
from .workspace import Workspace, read_text

PROFILES = {
    'cumcm': {'name': 'CUMCM', 'rules': '2026 format rules', 'toc': 'forbidden', 'anonymous': True},
    'mcm': {'name': 'MCM/ICM', 'rules': '2027 contest rules', 'page_limit': 25, 'anonymous': True},
    'stats': {'name': '全国大学生统计建模大赛', 'rules': '2026 provincial-round notice', 'anonymous_switch': True},
    'huawei': {'name': '华为杯 (CPIPC)', 'rules': None},
    'mathorcup': {'name': 'MathorCup', 'rules': None},
    'apmcm': {'name': 'APMCM', 'rules': None},
}
NAMES = tuple(PROFILES)
LIMIT_LABEL = 'SolutionLastPage'
TOC = re.compile(r'\\tableofcontents\b')
AUTHOR = re.compile(r'\\author\s*\{([^{}]*)\}')
NOT_ANONYMOUS = re.compile(r'\\anonymousfalse\b')
PAGES = re.compile(r'Output written on .*?\((\d+) pages?')


def _label_page(aux_text: str, label: str) -> int | None:
    m = re.search(r'\\newlabel\{' + re.escape(label) + r'\}\{\{[^{}]*\}\{(\d+)\}', aux_text)
    return int(m.group(1)) if m else None


def check(ws: Workspace, paper: Paper) -> list[Issue]:
    name = ws.config.get('contest')
    if not name or paper.kind != 'tex' or not paper.main:
        return []
    profile = PROFILES.get(str(name).lower())
    rel = ws.rel(paper.main)
    if profile is None:
        return [Issue('info', 'paper', 'contest.unknown', f'contest `{name}` has no format profile; nothing contest-specific was checked',
                      hint='known: ' + ', '.join(NAMES))]
    issues: list[Issue] = []
    if not profile['rules']:
        issues.append(Issue('info', 'paper', 'contest.rules-unverified',
                            f'{profile["name"]} format rules were not verified for this template; check the current official rules',
                            rel, hint='see references/contest-formats.md in the workbench skill'))
    for line in paper.lines:
        if profile.get('toc') == 'forbidden' and TOC.search(line.text):
            issues.append(Issue('warning', 'paper', 'contest.toc', f'{profile["name"]} {profile["rules"]} say no table of contents',
                                line.file, line.line))
        if profile.get('anonymous'):
            m = AUTHOR.search(line.text)
            if m and m.group(1).strip():
                issues.append(Issue('warning', 'paper', 'contest.identity',
                                    f'{profile["name"]} papers must not name students, advisors or schools; \\author is not empty',
                                    line.file, line.line))
        if profile.get('anonymous_switch') and NOT_ANONYMOUS.search(line.text):
            issues.append(Issue('info', 'paper', 'contest.not-anonymous',
                                'this build includes the cover and acknowledgements; the PDF submission is the anonymous version',
                                line.file, line.line, 'use \\anonymoustrue for the PDF'))
    limit = profile.get('page_limit')
    if limit:
        aux = paper.main.with_suffix('.aux')
        log = paper.main.with_suffix('.log')
        counted = _label_page(read_text(aux), LIMIT_LABEL) if aux.is_file() else None
        if counted is not None:
            if counted > limit:
                issues.append(Issue('warning', 'paper', 'contest.page-limit',
                                    f'{profile["name"]} {profile["rules"]}: {counted} counted pages, limit {limit}', rel,
                                    hint=f'pages up to \\label{{{LIMIT_LABEL}}} count, including summary, contents, references and appendices'))
        elif log.is_file():
            m = PAGES.search(read_text(log))
            if m and int(m.group(1)) > limit:
                issues.append(Issue('info', 'paper', 'contest.page-limit',
                                    f'the PDF has {m.group(1)} pages and the {profile["name"]} limit is {limit}', rel,
                                    hint=f'put \\label{{{LIMIT_LABEL}}} after the last counted page (before any uncounted report)'))
    return issues
