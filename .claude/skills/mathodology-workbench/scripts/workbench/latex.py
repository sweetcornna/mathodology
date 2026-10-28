"""Static and compile-time checks of the paper source (LaTeX or Markdown)."""
from __future__ import annotations

from dataclasses import dataclass, field
import os
import posixpath
from pathlib import Path
import re
import shutil
import subprocess

from . import markdown
from .report import Issue
from .results import is_generated
from .workspace import Workspace, read_text

INPUT = re.compile(r'\\(?:input|include|subfile)\s*\{([^}]+)\}')
LABEL = re.compile(r'\\label\s*\{([^}]+)\}')
REF = re.compile(r'\\(?:ref|eqref|autoref|pageref|cref|Cref|vref|nameref)\*?\s*\{([^}]+)\}')
CITE = re.compile(r'\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]+)\}')
GRAPHIC = re.compile(r'\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}')
GRAPHICSPATH = re.compile(r'\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}')
BIBFILE = re.compile(r'\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}')
BIBITEM = re.compile(r'\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}')
BIBENTRY = re.compile(r'@(\w+)\s*\{\s*([^,\s]+)\s*,')
RES = re.compile(r'\\res(?:ci|unit)?\s*\{([^}]+)\}')
MD_IMAGE = re.compile(r'!\[[^\]]*\]\(([^)\s]+)')
PLACEHOLDER = re.compile(r'\bTODO\b|\bTBD\b|\bFIXME\b|\bXXX\b|待补充|待完善|待定|此处补充|\\todo\b|\[\s*citation needed\s*\]', re.I)
GRAPHIC_EXT = ('', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg')


@dataclass
class Line:
    file: str
    line: int
    text: str  # comment-stripped


@dataclass
class Paper:
    main: Path | None = None
    kind: str = 'none'  # tex | md | none
    files: list[Path] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)
    bib_keys: set[str] = field(default_factory=set)
    bib_files: list[Path] = field(default_factory=list)
    generated: list[Path] = field(default_factory=list)
    missing_inputs: list[tuple[Line, str]] = field(default_factory=list)
    cjk: bool = False


def strip_comment(line: str) -> str:
    # A % not preceded by an odd number of backslashes starts a comment.
    for m in re.finditer(r'%', line):
        i = m.start()
        backslashes = len(line[:i]) - len(line[:i].rstrip('\\'))
        if backslashes % 2 == 0:
            return line[:i]
    return line


def find_main(ws: Workspace) -> tuple[Path | None, str]:
    paper = ws.dir('paper')
    preferred = paper / 'main.tex'
    if preferred.is_file():
        return preferred, 'tex'
    for path in ws.files('paper', ('.tex',)):
        if '\\documentclass' in read_text(path)[:5000]:
            return path, 'tex'
    for name in ('main.md', 'paper.md'):
        if (paper / name).is_file():
            return paper / name, 'md'
    mds = ws.files('paper', ('.md',))
    return (mds[0], 'md') if mds else (None, 'none')


def load(ws: Workspace) -> Paper:
    main, kind = find_main(ws)
    paper = Paper(main, kind)
    if not main:
        return paper
    if kind == 'md':
        for path in [main] + [p for p in ws.files('paper', ('.md',)) if p != main]:
            paper.files.append(path)
            for i, text in enumerate(read_text(path).splitlines(), 1):
                paper.lines.append(Line(ws.rel(path), i, text))
        return paper
    seen: set[Path] = set()
    macros = (ws.dir('paper') / 'results.tex').resolve()

    def visit(path: Path, depth: int = 0) -> None:
        path = path.resolve()
        if path in seen or depth > 20 or not path.is_file():
            return
        seen.add(path)
        paper.files.append(path)
        for i, raw in enumerate(read_text(path).splitlines(), 1):
            text = strip_comment(raw)
            paper.lines.append(Line(ws.rel(path), i, text))
            for m in INPUT.finditer(text):
                name = m.group(1).strip()
                for base in (main.parent, path.parent):
                    target = base / (name if name.endswith('.tex') else name + '.tex')
                    if target.resolve() == macros:
                        break  # the generated macro file; `sync` keeps it current
                    if target.is_file():
                        if is_generated(target):
                            paper.generated.append(target.resolve())  # a table written by `sync`
                        else:
                            visit(target, depth + 1)
                        break
                else:
                    paper.missing_inputs.append((paper.lines[-1], name))
    visit(main)
    text = '\n'.join(l.text for l in paper.lines)
    paper.cjk = bool(re.search(r'\\(?:usepackage|documentclass)\s*(?:\[[^\]]*\])?\s*\{[^}]*(?:ctex|xeCJK|fontspec)', text))
    for m in BIBFILE.finditer(text):
        for name in m.group(1).split(','):
            name = name.strip()
            target = main.parent / (name if name.endswith('.bib') else name + '.bib')
            if target.is_file():
                paper.bib_files.append(target)
    if not paper.bib_files:
        paper.bib_files = ws.files('paper', ('.bib',))
    for bib in paper.bib_files:
        paper.bib_keys |= {m.group(2) for m in BIBENTRY.finditer(read_text(bib)) if m.group(1).lower() not in {'string', 'comment', 'preamble'}}
    paper.bib_keys |= {m.group(1).strip() for m in BIBITEM.finditer(text)}
    return paper


def keys(group: str) -> list[str]:
    return [k.strip() for k in group.split(',') if k.strip()]


def graphic_dirs(paper: Paper) -> list[Path]:
    dirs = [paper.main.parent]
    for line in paper.lines:
        for m in GRAPHICSPATH.finditer(line.text):
            dirs += [paper.main.parent / d for d in re.findall(r'\{([^}]*)\}', m.group(1))]
    return dirs


def resolve_graphic(paper: Paper, name: str, origin: Path | None = None) -> Path | None:
    bases = graphic_dirs(paper) + ([origin.parent] if origin else [])
    for base in bases:
        for ext in GRAPHIC_EXT:
            candidate = base / (name + ext)
            if candidate.is_file():
                return candidate.resolve()
    return None


def static_checks(ws: Workspace, paper: Paper, result_keys: set[str], only: str | None = None) -> tuple[list[Issue], set[Path]]:
    """Cross-reference checks. Returns issues and the set of figure files the paper uses."""
    issues: list[Issue] = []
    used: set[Path] = set()
    if not paper.main:
        return issues, used
    labels: dict[str, Line] = {}
    in_scope = (lambda l: True) if only is None else (lambda l: l.file == only)
    if paper.kind == 'tex':
        for line in paper.lines:
            for m in LABEL.finditer(line.text):
                key = m.group(1).strip()
                if key in labels and in_scope(line):
                    issues.append(Issue('error', 'paper', 'latex.duplicate-label', f'label `{key}` is defined twice (also {labels[key].file}:{labels[key].line})', line.file, line.line))
                labels.setdefault(key, line)
        for line, name in paper.missing_inputs:
            if in_scope(line):
                generated = name.replace('\\', '/').lstrip('./').startswith('tables/')
                issues.append(Issue('error', 'paper', 'latex.missing-input', f'\\input{{{name}}} names no file', line.file, line.line,
                                    'run `mtd.py sync` to write the results tables' if generated else 'fix the path or add the file'))
        cited: set[str] = set()
        for line in paper.lines:
            for m in CITE.finditer(line.text):
                for key in keys(m.group(1)):
                    cited.add(key)
                    if key != '*' and key not in paper.bib_keys and in_scope(line):
                        issues.append(Issue('error', 'paper', 'latex.undefined-cite', f'citation `{key}` is not in the bibliography', line.file, line.line,
                                            'add a verified entry (see mathodology-evidence-search) or remove the citation'))
            if not in_scope(line):
                for m in GRAPHIC.finditer(line.text):
                    found = resolve_graphic(paper, m.group(1).strip())
                    if found:
                        used.add(found)
                continue
            for m in REF.finditer(line.text):
                for key in keys(m.group(1)):
                    if key not in labels:
                        issues.append(Issue('error', 'paper', 'latex.undefined-ref', f'reference to undefined label `{key}`', line.file, line.line))
            for m in GRAPHIC.finditer(line.text):
                name = m.group(1).strip()
                found = resolve_graphic(paper, name)
                if found:
                    used.add(found)
                else:
                    issues.append(Issue('error', 'paper', 'paper.missing-figure', f'included figure `{name}` does not exist', line.file, line.line,
                                        'run the figure script or fix the path'))
            for key in dict.fromkeys(m.group(1).strip() for m in RES.finditer(line.text)):
                if key not in result_keys:
                    issues.append(Issue('error', 'paper', 'numbers.unknown-key', f'\\res{{{key}}} names no value in results/*.json', line.file, line.line,
                                        'check the key or rerun the experiment that produces it'))
            if PLACEHOLDER.search(line.text):
                issues.append(Issue('warning', 'paper', 'paper.placeholder', f'placeholder left in text: "{line.text.strip()[:80]}"', line.file, line.line))
            if re.match(r'\s*#{1,6}\s+\S', line.text) or re.search(r'\*\*[^*\n]+\*\*', line.text) or line.text.lstrip().startswith('```'):
                issues.append(Issue('warning', 'paper', 'latex.markdown-residue', 'Markdown syntax in LaTeX source', line.file, line.line))
        if only is None and paper.bib_keys and cited:
            unused = sorted(paper.bib_keys - cited)
            if unused and '*' not in cited:
                issues.append(Issue('info', 'paper', 'latex.unused-bib', f'{len(unused)} bibliography entries are never cited: {", ".join(unused[:8])}{" ..." if len(unused) > 8 else ""}'))
    else:
        for line in paper.lines:
            for m in MD_IMAGE.finditer(line.text):
                name = m.group(1)
                if re.match(r'https?:', name):
                    continue
                target = (ws.root / line.file).parent / name
                if target.is_file():
                    used.add(target.resolve())
                elif in_scope(line):
                    issues.append(Issue('error', 'paper', 'paper.missing-figure', f'image `{name}` does not exist', line.file, line.line))
            if in_scope(line) and PLACEHOLDER.search(line.text):
                issues.append(Issue('warning', 'paper', 'paper.placeholder', f'placeholder left in text: "{line.text.strip()[:80]}"', line.file, line.line))
            if in_scope(line):
                for m in re.finditer(r'\{\{\s*res:([^}\s]+)\s*\}\}', line.text):
                    if m.group(1) not in result_keys:
                        issues.append(Issue('error', 'paper', 'numbers.unknown-key', f'{{{{res:{m.group(1)}}}}} names no value in results/*.json', line.file, line.line))
        bib = '\n'.join(read_text(p) for p in ws.files('paper', ('.bib',)))
        issues += markdown.check(paper, bib, in_scope, only is None)
    return issues, used


LOG_ERROR = re.compile(r'^(?:!\s?(.+)|(.+?):(\d+): (.+))$')
LOG_UNDEF = re.compile(r"(Reference|Citation) [`']([^']+)' on page \d+ undefined.*?line (\d+)")


def _log_file(where: str | None, rel: str) -> str:
    """Paths in the log are relative to the folder LaTeX ran in, which holds the log."""
    if not where:
        return rel
    return posixpath.normpath(posixpath.join(posixpath.dirname(rel), where.replace('\\', '/')))


def parse_log(text: str, rel: str) -> list[Issue]:
    issues: list[Issue] = []
    lines = text.splitlines()
    seen = set()
    for i, line in enumerate(lines):
        m = LOG_ERROR.match(line)
        if m and (m.group(1) or (m.group(2) and m.group(2).endswith('.tex'))):
            message = (m.group(1) or m.group(4)).strip()
            where = None
            lineno = None
            if m.group(2):
                where, lineno = m.group(2), int(m.group(3))
            else:
                for follow in lines[i + 1:i + 8]:
                    lm = re.match(r'^l\.(\d+)', follow)
                    if lm:
                        lineno = int(lm.group(1))
                        break
            key = (message, where, lineno)
            if key not in seen:
                seen.add(key)
                issues.append(Issue('error', 'paper', 'latex.compile-error', message, _log_file(where, rel), lineno))
    joined = re.sub(r'\n(?=\S)', '', text)  # warnings wrap at 79 columns
    for m in LOG_UNDEF.finditer(joined):
        issues.append(Issue('warning', 'paper', f'latex.undefined-{m.group(1).lower()}', f'{m.group(1).lower()} `{m.group(2)}` undefined in the compiled PDF', rel, int(m.group(3))))
    if 'Rerun to get' in text or 'Label(s) may have changed' in text:
        issues.append(Issue('info', 'paper', 'latex.rerun', 'cross-references need another LaTeX run', rel))
    overfull = [float(x) for x in re.findall(r'Overfull \\hbox \((\d+(?:\.\d+)?)pt too wide', text)]
    wide = [x for x in overfull if x > 10]
    if wide:
        issues.append(Issue('warning', 'paper', 'latex.overfull', f'{len(wide)} lines run more than 10pt into the margin (worst {max(wide):.0f}pt)', rel,
                            hint='check tables, long formulas and URLs on the compiled pages'))
    for m in re.finditer(r"LaTeX Warning: File `([^']+)' not found", text):
        issues.append(Issue('error', 'paper', 'paper.missing-figure', f'figure `{m.group(1)}` not found while compiling', rel))
    return issues


def engine_for(paper: Paper) -> list[str] | None:
    if shutil.which('latexmk'):
        return ['latexmk', '-xelatex' if paper.cjk else '-pdf', '-interaction=nonstopmode', '-file-line-error', '-halt-on-error']
    tool = 'xelatex' if paper.cjk else 'pdflatex'
    if shutil.which(tool):
        return [tool, '-interaction=nonstopmode', '-file-line-error', '-halt-on-error']
    return None


def compile_paper(ws: Workspace, paper: Paper, timeout: int = 300) -> list[Issue]:
    if paper.kind != 'tex' or not paper.main:
        return []
    command = engine_for(paper)
    if not command:
        return [Issue('info', 'paper', 'compile.unavailable', 'no latexmk, pdflatex or xelatex found; compile check skipped',
                      hint='install TeX Live or MiKTeX to compile here')]
    cwd = paper.main.parent
    env = dict(os.environ, max_print_line='10000')
    try:
        proc = subprocess.run(command + [paper.main.name], cwd=cwd, capture_output=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return [Issue('info', 'paper', 'compile.unavailable', f'LaTeX did not finish in {timeout}s; compile check skipped', ws.rel(paper.main),
                      'compile by hand to see where it hangs (often a missing font or a prompt for input)')]
    except OSError as exc:
        return [Issue('info', 'paper', 'compile.unavailable', f'could not start {command[0]}: {exc}; compile check skipped')]
    if command[0] != 'latexmk' and proc.returncode == 0:
        if any(l.text for l in paper.lines if CITE.search(l.text)) and shutil.which('bibtex'):
            subprocess.run(['bibtex', paper.main.stem], cwd=cwd, capture_output=True, timeout=timeout)
        for _ in range(2):
            proc = subprocess.run(command + [paper.main.name], cwd=cwd, capture_output=True, timeout=timeout, env=env)
    log = paper.main.with_suffix('.log')
    issues = parse_log(read_text(log), ws.rel(log)) if log.is_file() else []
    if proc.returncode != 0 and not any(i.severity == 'error' for i in issues):
        tail = (proc.stdout or b'').decode('utf-8', 'replace').strip().splitlines()[-3:]
        issues.append(Issue('error', 'paper', 'latex.compile-error', f'{command[0]} exited with {proc.returncode}: {" / ".join(tail)}', ws.rel(paper.main)))
    return issues


def log_checks(ws: Workspace, paper: Paper) -> list[Issue]:
    """Use an existing log when it is newer than every source file (cheap; no compile)."""
    if paper.kind != 'tex' or not paper.main:
        return []
    log = paper.main.with_suffix('.log')
    if not log.is_file():
        return []
    newest = max((p.stat().st_mtime for p in paper.files if p.exists()), default=0)
    if log.stat().st_mtime < newest:
        return []
    return [i for i in parse_log(read_text(log), ws.rel(log)) if i.code in {'latex.compile-error', 'latex.undefined-reference', 'latex.undefined-citation', 'latex.overfull'}]
