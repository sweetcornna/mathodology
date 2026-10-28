"""Checks for a Markdown paper: math delimiters that render, and citations that close.

A Markdown draft is usually converted by pandoc or a Markdown-to-Word tool. An unpaired `$` or
`$$` swallows the rest of a paragraph, LaTeX outside math prints as source, and a numbered citation
without its reference entry is a hole a reviewer finds at once.
"""
from __future__ import annotations

import re

from .report import Issue

FENCE = re.compile(r'^\s*(```|~~~)')
INLINE_CODE = re.compile(r'(`+)(?:(?!\1).)+?\1')
HTML_COMMENT = re.compile(r'<!--.*?-->')
ESCAPED_DOLLAR = re.compile(r'\\\$')
DISPLAY = re.compile(r'\$\$')
INLINE_MATH = re.compile(r'\$(?=\S)[^$\n]*?(?<=\S)\$|\$[^$\s]\$|\\\(.*?\\\)')
BARE_TEX = re.compile(r'\\(?:frac|dfrac|sum|int|iint|prod|sqrt|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|sigma|'
                      r'omega|Omega|partial|nabla|infty|cdot|times|leq?|geq?|neq|approx|mathbb|mathrm|mathbf|mathcal|hat|bar|'
                      r'tilde|left|right|begin\{(?:equation|align|cases|matrix|pmatrix|bmatrix|array)\*?\})(?![A-Za-z])')
REF_HEADING = re.compile(r'^\s*(#{1,6})\s*(?:\d+[.、]?\s*)?(参考文献|引用文献|References?|Bibliography|Works Cited|Literature Cited)\s*#*\s*$', re.I)
HEADING = re.compile(r'^\s*(#{1,6})\s+\S')
REF_ENTRY = re.compile(r'^\s*(?:[-*]\s*)?(?:\[(\d+)\]|(\d+)[.、)]\s|\[\^?(\d+)\]:)')
NUM_CITE = re.compile(r'(?<![\w!\]^])\[(\d+(?:\s*[-–~,，、]\s*\d+)*)\](?![(:\[])')
SUP_CITE = re.compile(r'<sup>\s*\[?(\d+(?:\s*[-–~,，、]\s*\d+)*)\]?\s*</sup>')
PANDOC_GROUP = re.compile(r'\[([^\[\]]*@[^\[\]]*)\]')
PANDOC_KEY = re.compile(r'(?:^|[\s;\-])@([A-Za-z0-9_][\w:.#$%&+?<>~/\-]*[\w])')
BIBENTRY = re.compile(r'@(\w+)\s*\{\s*([^,\s]+)\s*,')


def numbers(group: str) -> list[int]:
    out: list[int] = []
    for part in re.split(r'\s*[,，、]\s*', group):
        bounds = [int(x) for x in re.split(r'\s*[-–~]\s*', part) if x.strip().isdigit()]
        if len(bounds) == 2 and 0 < bounds[1] - bounds[0] < 200:
            out += range(bounds[0], bounds[1] + 1)
        else:
            out += bounds
    return out


def _prose(text: str) -> str:
    """The line without inline code, HTML comments and escaped dollars."""
    return ESCAPED_DOLLAR.sub('', HTML_COMMENT.sub('', INLINE_CODE.sub('', text)))


def check(paper, bib_text: str, in_scope, full: bool) -> list[Issue]:
    issues: list[Issue] = []
    by_file: dict[str, list] = {}
    for line in paper.lines:
        by_file.setdefault(line.file, []).append(line)

    refs: dict[int, object] = {}
    cites: list[tuple[object, int]] = []
    pandoc: list[tuple[object, str]] = []
    ref_heading = None
    for file, lines in by_file.items():
        fence = None
        display_open = None
        bracket_open: dict[str, object] = {}
        para: list = []
        in_refs = 0

        def close_paragraph():
            singles = [l for l in para for _ in range(_single_dollars(l.text))]
            if len(singles) % 2 and in_scope(singles[-1]):
                l = singles[-1]
                issues.append(Issue('warning', 'paper', 'md.unpaired-dollar', 'odd number of `$` in this paragraph; inline math will swallow the text after it',
                                    l.file, l.line, 'pair it, or write a literal dollar as \\$'))
            para.clear()

        for line in lines:
            if FENCE.match(line.text):
                fence = None if fence else line
                close_paragraph()
                continue
            if fence:
                continue
            text = _prose(line.text)
            heading = REF_HEADING.match(text)
            if heading:
                ref_heading, in_refs = line, len(heading.group(1))
                continue
            if in_refs and HEADING.match(text) and len(HEADING.match(text).group(1)) <= in_refs:
                in_refs = 0
            if in_refs:
                m = REF_ENTRY.match(text)
                if m:
                    refs.setdefault(int(next(g for g in m.groups() if g)), line)
                continue
            if not text.strip():
                close_paragraph()
            else:
                para.append(line)
            # display math, which may span lines
            pieces = DISPLAY.split(text)
            for i, piece in enumerate(pieces):
                if i:
                    display_open = None if display_open else line
                if not display_open:
                    _inline(line, piece, bracket_open, issues, in_scope, cites, pandoc)
        close_paragraph()
        if display_open and in_scope(display_open):
            issues.append(Issue('error', 'paper', 'md.unclosed-display-math', '`$$` is never closed; the rest of the file renders as math',
                                display_open.file, display_open.line))
        if fence and in_scope(fence):
            issues.append(Issue('error', 'paper', 'md.unclosed-fence', 'code fence is never closed', fence.file, fence.line))
        for opener, line in bracket_open.items():
            if in_scope(line):
                issues.append(Issue('error', 'paper', 'md.unclosed-math', f'`{opener}` is never closed', line.file, line.line))

    if cites and not refs and in_scope(cites[0][0]):
        l = cites[0][0]
        issues.append(Issue('error', 'paper', 'md.no-references', f'numbered citations such as [{cites[0][1]}] but no reference list',
                            l.file, l.line, 'add a "References" or "参考文献" section with numbered entries'))
    elif refs:
        for line, n in {(l.file, l.line, n): (l, n) for l, n in cites}.values():
            if n not in refs and in_scope(line):
                issues.append(Issue('error', 'paper', 'md.undefined-cite', f'citation [{n}] has no entry in the reference list', line.file, line.line))
        unused = sorted(set(refs) - {n for _, n in cites})
        if full and unused:
            issues.append(Issue('info', 'paper', 'md.unused-ref', f'{len(unused)} reference(s) never cited: '
                                + ', '.join(f'[{n}]' for n in unused[:10]), ref_heading.file if ref_heading else None,
                                ref_heading.line if ref_heading else None))
    if pandoc:
        keys = {m.group(2) for m in BIBENTRY.finditer(bib_text) if m.group(1).lower() not in {'string', 'comment', 'preamble'}}
        for line, key in {(l.file, l.line, k): (l, k) for l, k in pandoc}.values():
            if key not in keys and in_scope(line):
                issues.append(Issue('error', 'paper', 'md.undefined-cite', f'citation @{key} is not in any .bib file in paper/', line.file, line.line,
                                    'add a verified entry (see mathodology-evidence-search) or remove the citation'))
    return issues


def _single_dollars(text: str) -> int:
    return _prose(text).replace('$$', '').count('$')


def _inline(line, text: str, bracket_open: dict, issues: list, in_scope, cites: list, pandoc: list) -> None:
    for opener, closer in (('\\[', '\\]'), ('\\(', '\\)')):
        for m in re.finditer(re.escape(opener) + '|' + re.escape(closer), text):
            if m.group() == opener:
                bracket_open.setdefault(opener, line)
            elif opener in bracket_open:
                del bracket_open[opener]
            elif in_scope(line):
                issues.append(Issue('error', 'paper', 'md.unclosed-math', f'`{closer}` without a matching `{opener}`', line.file, line.line))
    if bracket_open:
        return  # inside \[ ... \] spanning lines
    prose = INLINE_MATH.sub('', text)
    prose = re.sub(r'\\\[.*?\\\]', '', prose)
    if in_scope(line) and BARE_TEX.search(prose) and '$' not in prose:
        issues.append(Issue('warning', 'paper', 'md.bare-latex', f'LaTeX outside math prints as source: "{line.text.strip()[:70]}"',
                            line.file, line.line, 'wrap it in $...$ or $$...$$'))
    for m in list(NUM_CITE.finditer(prose)) + list(SUP_CITE.finditer(prose)):
        cites += [(line, n) for n in numbers(m.group(1))]
    for m in PANDOC_GROUP.finditer(prose):
        pandoc += [(line, k.group(1)) for k in PANDOC_KEY.finditer(m.group(1))]
