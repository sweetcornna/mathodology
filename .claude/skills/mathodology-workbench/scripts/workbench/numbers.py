"""Do the numbers in the paper agree with results/*.json?

The check is deliberately conservative. It reads numbers that look like reported results
(decimals, percentages, scientific notation, magnitudes of 100 or more that are not years),
skips figure/table/equation/section numbers, lengths and code, and compares them with every
numeric leaf of the results files, allowing for the rounding the paper shows.

* matched: the printed number is a rounding of some result. Fine.
* near miss: no result rounds to it, but one lies within a small relative distance. This is
  the signature of a number copied before the experiment was rerun, or mistyped. Warning.
* unmatched: nothing close. Often legitimate (a parameter, a literature value); listed once
  per file as a note for the agent to review, never as an error.

Numbers cited through \\res{key} are bound to the results and always current after sync.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
import re

from .latex import Line, Paper, RES
from .report import Issue
from .results import ResultSet

SKIP_ARGS = re.compile(
    r'\\(?:label|ref|eqref|autoref|cref|Cref|pageref|nameref|[a-zA-Z]*cite[a-zA-Z]*|nocite|includegraphics|input|include|'
    r'usepackage|RequirePackage|documentclass|begin|end|url|href|hspace|vspace|setlength|addtolength|setcounter|'
    r'newcommand|renewcommand|providecommand|graphicspath|bibliographystyle|bibliography|addbibresource|res|resci|resunit|'
    r'color|textcolor|colorbox|cline|cmidrule|rule|scalebox|resizebox|addcontentsline|linespread|fontsize|geometry|'
    r'definecolor|hypersetup|captionsetup|setmainfont|setCJKmainfont)(?![A-Za-z])\*?'
    r'(?:\s*\([^)]*\))?(?:\s*\[[^\]]*\])*(?:\s*\{[^{}]*\})*')
SKIP_PATTERNS = [
    re.compile(r'\\(?:multicolumn|multirow)\s*\{[^}]*\}\s*\{[^}]*\}'),
    re.compile(r'-?\d*\.?\d+\s*(?:pt|cm|mm|in|em|ex|bp|sp|pc)\b'),
    re.compile(r'\d*\.?\d+\s*\\(?:textwidth|linewidth|columnwidth|textheight|hsize|paperwidth)'),
    re.compile(r'\\\\\s*\[[^\]]*\]'),
    re.compile(r'\\[a-zA-Z]+\s*\[[^\]]*\]'),
]
NUM = re.compile(
    r'(?<![A-Za-z0-9_.\\/])(?P<sign>(?<![-−])[-−])?(?P<int>\d{1,3}(?:(?:,|\{,\})\d{3})+|\d+)(?P<frac>\.\d+)?(?!\.?\d)'
    r'(?P<exp>\s*(?:\\times|×|\\cdot)\s*10\^\{?\s*[-−]?\d+\s*\}?|[eE][-+]?\d+(?![A-Za-z0-9_]))?'
    r'(?P<suffix>\s*(?:\\%|%|‰|万|亿|million\b|billion\b|thousand\b))?')
PREFIX = re.compile(
    r'(?:fig(?:ure)?s?\.?|tab(?:le)?s?\.?|eqs?\.?|equations?|sec(?:tion)?s?\.?|chapters?|appendix|problems?|questions?|'
    r'tasks?|steps?|models?|stages?|phases?|parts?|rules?|lines?|pages?|pp\.?|vol\.?|no\.?|ref\.?|theorem|lemma|'
    r'assumptions?|hypothes[ie]s|scenarios?|图|表|式|公式|问题|模型|步骤|第|附录|章|节|假设|情景|方案)\s*[(（]?\s*$', re.I)
AFTER_SKIP = re.compile(r'^\s*(?:年|月|日|章|节|号|题|问|\)?\s*(?:confidence|CI\b|置信|significan|显著))', re.I)
SCALE = {'%': 0.01, '\\%': 0.01, '‰': 0.001, '万': 1e4, '亿': 1e8, 'thousand': 1e3, 'million': 1e6, 'billion': 1e9}
SKIP_ENVS = re.compile(r'\\begin\{(verbatim|lstlisting|minted|thebibliography|filecontents|comment|tikzpicture|axis)\*?\}')


@dataclass
class Mention:
    file: str
    line: int
    text: str
    value: float
    tol: float
    alternatives: list[tuple[float, float]] = field(default_factory=list)  # (value, tol) readings


@dataclass
class Index:
    keys: list[float]
    origins: list[str]

    @classmethod
    def build(cls, rs: ResultSet) -> 'Index':
        pairs = sorted((abs(v), origin) for v, origin in rs.numbers)
        return cls([p[0] for p in pairs], [p[1] for p in pairs])

    def matches(self, value: float, tol: float) -> list[str]:
        value = abs(value)
        eps = 1e-9 * max(1.0, value)
        lo, hi = bisect_left(self.keys, value - tol - eps), bisect_right(self.keys, value + tol + eps)
        return self.origins[lo:hi]

    def nearest(self, value: float) -> tuple[float, str] | None:
        if not self.keys:
            return None
        value = abs(value)
        i = bisect_left(self.keys, value)
        best = min((j for j in (i - 1, i) if 0 <= j < len(self.keys)), key=lambda j: abs(self.keys[j] - value))
        return self.keys[best], self.origins[best]


def clean_tex(text: str) -> str:
    text = SKIP_ARGS.sub(' ', text)
    for pattern in SKIP_PATTERNS:
        text = pattern.sub(' ', text)
    text = text.replace('{,}', ',').replace('\\,', '').replace('~', ' ')
    return text


def mentions_in(lines: list[Line], kind: str, main_file: str | None) -> tuple[list[Mention], dict[str, int]]:
    found: list[Mention] = []
    bound: dict[str, int] = {}
    # Without \begin{document} (a fragment) every line is body text.
    in_body = kind != 'tex' or not any('\\begin{document}' in l.text for l in lines)
    skip_env: str | None = None
    fenced = False
    for line in lines:
        text = line.text
        if kind == 'tex':
            if not in_body:  # the preamble, including files it inputs
                if '\\begin{document}' in text:
                    in_body = True
                continue
            if skip_env:
                if re.search(r'\\end\{' + re.escape(skip_env) + r'\*?\}', text):
                    skip_env = None
                continue
            m = SKIP_ENVS.search(text)
            if m:
                skip_env = m.group(1)
                continue
            bound[line.file] = bound.get(line.file, 0) + len(RES.findall(text))
            text = clean_tex(text)
        else:
            if text.lstrip().startswith('```'):
                fenced = not fenced
                continue
            if fenced:
                continue
            n = len(re.findall(r'\{\{\s*res:[^}]+\}\}', text))
            bound[line.file] = bound.get(line.file, 0) + n
            text = re.sub(r'\{\{\s*res:[^}]+\}\}|!?\[[^\]]*\]\([^)]*\)|<!--.*?-->|`[^`]*`', ' ', text)
            text = re.sub(r'^\s*#{1,6}\s*[\d.]*', ' ', text)
        for m in NUM.finditer(text):
            before = text[max(0, m.start() - 24):m.start()]
            after = text[m.end():m.end() + 16]
            if PREFIX.search(before) or AFTER_SKIP.match(after):
                continue
            digits = re.sub(r'\D', '', m.group('int'))
            frac = m.group('frac') or ''
            try:
                value = float(digits + frac)
            except ValueError:
                continue
            decimals = len(frac) - 1 if frac else 0
            exp_text = m.group('exp') or ''
            suffix = (m.group('suffix') or '').strip()
            if exp_text:
                e = int(re.search(r'[-−+]?\d+\s*\}?\s*$', exp_text).group(0).replace('−', '-').rstrip('} '))
                scale = 10.0 ** e
            else:
                scale = 1.0
            if not (frac or suffix or exp_text or value >= 100):
                continue  # small integers are counts and labels far more often than results
            if not frac and not suffix and not exp_text and 1900 <= value <= 2100:
                continue  # years
            tol = 0.5 * 10.0 ** -decimals
            sign = -1.0 if m.group('sign') else 1.0
            mention = Mention(line.file, line.line, m.group(0).strip(), sign * value * scale, tol * scale)
            if suffix in SCALE:
                factor = SCALE[suffix]
                mention.alternatives.append((sign * value * scale * factor, tol * scale * factor))
            found.append(mention)
    return found, bound


@dataclass
class NumberReport:
    issues: list[Issue]
    checked: int = 0
    matched: int = 0
    near: int = 0
    bound: int = 0


def check(paper: Paper, rs: ResultSet, near_rel: float = 0.02, only: str | None = None) -> NumberReport:
    if not paper.main:
        return NumberReport([])
    main_rel = None
    for l in paper.lines:
        main_rel = l.file
        break
    lines = paper.lines if only is None else [l for l in paper.lines if l.file == only or l.file == main_rel]
    mentions, bound = mentions_in(lines, paper.kind, main_rel)
    if only is not None:
        mentions = [m for m in mentions if m.file == only]
    index = Index.build(rs)
    report = NumberReport([], bound=sum(bound.values()))
    unmatched: dict[str, list[Mention]] = {}
    typed: dict[str, int] = {}
    addressable = {abs(v.value) for v in rs.values.values()}
    for m in mentions:
        report.checked += 1
        readings = [(m.value, m.tol)] + m.alternatives
        hit = next((index.matches(v, t) for v, t in readings if index.matches(v, t)), None)
        if hit:
            report.matched += 1
            if any(abs(abs(v) - a) <= t + 1e-12 for v, t in readings for a in addressable):
                typed[m.file] = typed.get(m.file, 0) + 1
            continue
        near = None
        if '.' in m.text or m.alternatives:
            for v, t in readings:
                cand = index.nearest(v)
                if cand and cand[0] and abs(abs(v) - cand[0]) / cand[0] <= near_rel:
                    near = (cand, v)
                    break
        if near:
            (value, origin), reading = near
            report.near += 1
            report.issues.append(Issue('warning', 'paper', 'numbers.near-miss',
                                       f'paper says {m.text} but the closest result is {value:.6g} ({origin})', m.file, m.line,
                                       'update the text from results, or cite it with \\res{...}; never edit results to fit the paper'))
        else:
            unmatched.setdefault(m.file, []).append(m)
    for file, items in unmatched.items():
        sample = ', '.join(f'{x.text} (l.{x.line})' for x in items[:6])
        report.issues.append(Issue('info', 'paper', 'numbers.unmatched',
                                   f'{len(items)} number(s) not found in results: {sample}{" ..." if len(items) > 6 else ""}', file,
                                   hint='fine for parameters or literature values; otherwise trace each to code and results'))
    for file, count in typed.items():
        report.issues.append(Issue('info', 'paper', 'numbers.typed', f'{count} result value(s) typed by hand', file,
                                   hint='\\res{key} keeps them current when the experiment is rerun'))
    return report
