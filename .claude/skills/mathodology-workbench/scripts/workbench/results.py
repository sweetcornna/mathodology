"""The results contract: experiment code writes results/*.json, everything downstream reads it.

A contract file looks like::

    {"schema": "mathodology.results/1", "question": "Q1",
     "values": {"rmse": {"value": 0.0912, "unit": "kWh", "digits": 3, "ci": [0.081, 0.101]},
                "best_cost": 1532.4, "scenario": {"high": {"value": 0.31}}},
     "tables": {"compare": {"columns": ["model", "rmse"], "rows": [["ARIMA", 0.12], ["ours", 0.09]]}},
     "provenance": {"script": "code/q1.py", "seed": 1}}

Values may be bare numbers or objects with ``value``; groups nest. A value is addressed as
``<file stem>.<path>``, e.g. ``q1.rmse`` or ``q1.scenario.high``. Files without the schema
field are still indexed for the number checks but are not validated.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import re

from .report import Issue
from .workspace import Workspace, read_text

SCHEMA = 'mathodology.results/1'
VALUE_KEYS = {'value', 'unit', 'ci', 'digits', 'display', 'label', 'note', 'se', 'n'}
KEY = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_\-]*$')
MAX_NUMBERS = 50000
MAX_BYTES = 20 * 1024 * 1024


@dataclass
class Value:
    key: str
    value: float
    file: str
    unit: str = ''
    ci: tuple[float, float] | None = None
    digits: int | None = None
    display: str | None = None
    label: str = ''

    def text(self) -> str:
        return format_number(self.value, self.digits, self.display)


@dataclass
class ResultSet:
    values: dict[str, Value] = field(default_factory=dict)  # addressable scalars (macros, coverage)
    numbers: list[tuple[float, str]] = field(default_factory=list)  # every numeric leaf: (number, origin)
    files: dict[str, dict] = field(default_factory=dict)  # rel path -> parsed JSON
    questions: dict[str, list[str]] = field(default_factory=dict)  # question id -> result files


def is_number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def format_number(value: float, digits: int | None = None, display: str | None = None) -> str:
    if display is not None:
        return str(display)
    if digits is not None:
        return f'{value:.{int(digits)}f}'
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer() and abs(value) < 1e15):
        return str(int(value))
    text = f'{value:.6g}'
    if 'e' in text:
        mantissa, exp = text.split('e')
        return f'{mantissa}\\times10^{{{int(exp)}}}'
    return text


def stem(rel: str) -> str:
    name = rel[len('results/'):] if rel.startswith('results/') else rel
    return name[:-5].replace('/', '.') if name.endswith('.json') else name.replace('/', '.')


def _leaves(obj, path: str, out: list[tuple[float, str]], in_table: bool = False) -> None:
    """Numbers a paper may quote: scalars, intervals and table cells. Raw series (lists outside
    tables) are left out: hundreds of arbitrary values would match almost any stale number."""
    if len(out) >= MAX_NUMBERS:
        return
    if is_number(obj):
        if math.isfinite(obj):
            out.append((obj, path))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in ('provenance', 'digits'):
                continue
            if isinstance(v, list) and not in_table and k not in ('tables', 'rows', 'ci'):
                continue
            _leaves(v, f'{path}.{k}' if path else str(k), out, in_table or k == 'tables')
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _leaves(v, f'{path}[{i}]', out, in_table)


def _values(obj, prefix: str, rel: str, out: dict[str, Value], issues: list[Issue], file_issue) -> None:
    if not isinstance(obj, dict):
        file_issue('error', 'results.values-type', f'`{prefix}` must be an object of named values')
        return
    for name, item in obj.items():
        key = f'{prefix}.{name}'
        if not KEY.match(str(name)):
            file_issue('warning', 'results.key', f'value name `{name}` is hard to cite; use letters, digits, _ or -')
        if is_number(item):
            item = {'value': item}
        if isinstance(item, dict) and 'value' in item:
            v = item['value']
            if not is_number(v):
                file_issue('error', 'results.value', f'`{key}` has a non-numeric value {v!r}')
                continue
            if not math.isfinite(v):
                file_issue('error', 'results.nonfinite', f'`{key}` is {v}; a failed computation should not be reported as a result')
                continue
            ci = item.get('ci')
            if ci is not None:
                if not (isinstance(ci, list) and len(ci) == 2 and all(is_number(c) and math.isfinite(c) for c in ci)):
                    file_issue('error', 'results.ci', f'`{key}` ci must be [low, high]')
                    ci = None
                elif not ci[0] <= ci[1]:
                    file_issue('error', 'results.ci', f'`{key}` ci [{ci[0]}, {ci[1]}] is reversed')
                    ci = None
                elif not ci[0] <= v <= ci[1]:
                    file_issue('warning', 'results.ci', f'`{key}` value {v} lies outside its interval [{ci[0]}, {ci[1]}]')
            digits = item.get('digits')
            if digits is not None and not (isinstance(digits, int) and 0 <= digits <= 12):
                file_issue('warning', 'results.digits', f'`{key}` digits must be an integer from 0 to 12')
                digits = None
            unknown = set(item) - VALUE_KEYS
            if unknown:
                file_issue('info', 'results.fields', f'`{key}` has extra fields {sorted(unknown)}; they are kept but not used')
            out[key] = Value(key, v, rel, str(item.get('unit') or ''), tuple(ci) if ci else None, digits,
                             item.get('display'), str(item.get('label') or ''))
        elif isinstance(item, dict):
            _values(item, key, rel, out, issues, file_issue)
        elif isinstance(item, list):
            file_issue('info', 'results.list', f'`{key}` is a list; put series in `tables` or a data file, values hold scalars')
        else:
            file_issue('error', 'results.value', f'`{key}` must be a number or an object with `value`')


def load(ws: Workspace) -> tuple[ResultSet, list[Issue]]:
    rs = ResultSet()
    issues: list[Issue] = []
    for path in ws.files('results', ('.json',)):
        rel = ws.rel(path)

        def file_issue(sev, code, msg, rel=rel):
            issues.append(Issue(sev, 'results', code, msg, rel))

        if path.stat().st_size > MAX_BYTES:
            file_issue('info', 'results.size', f'over {MAX_BYTES >> 20} MB; skipped (keep raw data out of results/)')
            continue
        try:
            data = json.loads(read_text(path))
        except ValueError as exc:
            file_issue('error', 'results.json', f'not valid JSON: {exc}')
            continue
        rs.files[rel] = data
        _leaves(data, stem(rel), rs.numbers)
        if not isinstance(data, dict) or data.get('schema') != SCHEMA:
            file_issue('info', 'results.schema', f'no "schema": "{SCHEMA}"; its numbers are indexed but not validated or citable with \\res')
            continue
        if 'values' not in data:
            file_issue('error', 'results.values', 'contract file has no `values` object')
        else:
            _values(data['values'], stem(rel), rel, rs.values, issues, file_issue)
            if not data['values'] and not data.get('tables'):
                file_issue('warning', 'results.empty', 'contract file has no values and no tables; did the experiment finish?')
        q = data.get('question')
        if q is not None:
            rs.questions.setdefault(str(q), []).append(rel)
        for name, table in (data.get('tables') or {}).items():
            if not (isinstance(table, dict) and isinstance(table.get('columns'), list) and isinstance(table.get('rows'), list)):
                file_issue('error', 'results.table', f'table `{name}` needs `columns` and `rows` lists')
                continue
            width = len(table['columns'])
            bad = [i for i, row in enumerate(table['rows']) if not isinstance(row, list) or len(row) != width]
            if bad:
                file_issue('error', 'results.table', f'table `{name}` rows {bad[:5]} do not have {width} cells')
    return rs, issues


TEX_SPECIAL = {'&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_', '{': r'\{', '}': r'\}',
               '~': r'\textasciitilde{}', '^': r'\textasciicircum{}', '\\': r'\textbackslash{}'}


def tex_escape(text: str) -> str:
    return ''.join(TEX_SPECIAL.get(ch, ch) for ch in text)


def display_escape(text: str) -> str:
    """`display` may hold LaTeX (e.g. $10^{3}$); only an unescaped % would swallow the rest of the file."""
    return re.sub(r'(?<!\\)%', r'\\%', text)


def macros(rs: ResultSet) -> str:
    """LaTeX definitions so the paper cites results instead of retyping them: \\res{q1.rmse}."""
    lines = [
        '% Generated by `mtd.py sync` from results/*.json. Do not edit; rerun the code and sync.',
        '% \\res{key} prints a value, \\resci{key} its interval and \\resunit{key} its unit.',
        '\\makeatletter',
        '\\providecommand\\mtd@get[2]{\\@ifundefined{mtdres@#1#2}{\\textbf{??\\detokenize{#1}??}'
        '\\PackageWarning{mathodology}{Unknown result \\detokenize{#1}}}{\\@nameuse{mtdres@#1#2}}}',
        '\\providecommand\\res[1]{\\mtd@get{#1}{}}',
        '\\providecommand\\resci[1]{\\mtd@get{#1}{@ci}}',
        '\\providecommand\\resunit[1]{\\mtd@get{#1}{@unit}}',
    ]
    for key in sorted(rs.values):
        v = rs.values[key]
        text = display_escape(v.text())
        if '\\times' in text:
            text = f'\\ensuremath{{{text}}}'
        lines.append(f'\\@namedef{{mtdres@{key}}}{{{text}}}')
        if v.ci:
            lo, hi = (format_number(c, v.digits) for c in v.ci)
            lines.append(f'\\@namedef{{mtdres@{key}@ci}}{{[{lo}, {hi}]}}')
        if v.unit:
            lines.append(f'\\@namedef{{mtdres@{key}@unit}}{{{tex_escape(v.unit)}}}')
    lines.append('\\makeatother')
    return '\n'.join(lines) + '\n'


def macro_path(ws: Workspace) -> Path:
    return ws.dir('paper') / 'results.tex'


TABLE_HEADER = '% Generated by `mtd.py sync` from {source}, table "{name}". Do not edit; rerun the code and sync.'


def tables_dir(ws: Workspace) -> Path:
    return ws.dir('paper') / 'tables'


def is_generated(path: Path) -> bool:
    try:
        with path.open(encoding='utf-8') as handle:
            return handle.readline().startswith('% Generated by `mtd.py sync`')
    except (OSError, UnicodeDecodeError):
        return False


def _cell(value, digits) -> str:
    if value is None:
        return '--'
    if is_number(value):
        if isinstance(value, float) and not math.isfinite(value):
            return '--'
        return f'${format_number(value, digits)}$' if '\\times' in format_number(value, digits) else format_number(value, digits)
    return tex_escape(str(value))


def table_tex(source: str, name: str, table: dict) -> str | None:
    """A booktabs tabular for one valid contract table; wrap it in a table float with a caption."""
    columns, rows = table.get('columns'), table.get('rows')
    if not (isinstance(columns, list) and isinstance(rows, list) and columns
            and all(isinstance(r, list) and len(r) == len(columns) for r in rows)):
        return None
    digits = table.get('digits')
    per_col = digits if isinstance(digits, list) and len(digits) == len(columns) else [digits if isinstance(digits, int) else None] * len(columns)
    align = table.get('align')
    if not (isinstance(align, str) and len(align) == len(columns)):
        align = ''.join('r' if rows and all(is_number(r[i]) or r[i] is None for r in rows) else 'l' for i in range(len(columns)))
    lines = [TABLE_HEADER.format(source=source, name=name),
             f'\\begin{{tabular}}{{{align}}}', '\\toprule',
             ' & '.join(tex_escape(str(c)) for c in columns) + ' \\\\', '\\midrule']
    for row in rows:
        lines.append(' & '.join(_cell(v, per_col[i]) for i, v in enumerate(row)) + ' \\\\')
    lines += ['\\bottomrule', '\\end{tabular}']
    return '\n'.join(lines) + '\n'


def table_texts(rs: ResultSet) -> dict[str, str]:
    """File name under paper/tables/ -> content, for every table in every contract file."""
    out = {}
    for rel, data in sorted(rs.files.items()):
        if not (isinstance(data, dict) and data.get('schema') == SCHEMA and isinstance(data.get('tables'), dict)):
            continue
        for name, table in data['tables'].items():
            text = table_tex(rel, str(name), table) if isinstance(table, dict) else None
            if text:
                safe = re.sub(r'[^A-Za-z0-9_-]+', '-', f'{stem(rel)}-{name}'.replace('.', '-')).strip('-')
                out[f'{safe}.tex'] = text
    return out


def _write(path: Path, text: str) -> bool:
    if path.exists() and read_text(path) == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)  # hooks may run concurrently for parallel tool calls
    return True


def sync(ws: Workspace, rs: ResultSet) -> tuple[Path, bool]:
    """Write paper/results.tex and paper/tables/*.tex when they differ; returns (macro path, changed).

    Generated tables whose source table is gone are removed; hand-written files are never touched."""
    path = macro_path(ws)
    changed = _write(path, macros(rs))
    wanted = table_texts(rs)
    folder = tables_dir(ws)
    for name, text in wanted.items():
        if (folder / name).exists() and not is_generated(folder / name):
            continue  # a hand-written file with the same name wins
        changed |= _write(folder / name, text)
    if folder.is_dir():
        for old in folder.glob('*.tex'):
            if old.name not in wanted and is_generated(old):
                old.unlink()
                changed = True
    return path, changed
