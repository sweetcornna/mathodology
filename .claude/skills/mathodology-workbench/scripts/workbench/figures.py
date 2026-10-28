"""Trace figures to the scripts and data that produce them, without running any code."""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path

from .report import Issue
from .workspace import Workspace, read_text

IMAGE = ('.png', '.pdf', '.svg', '.jpg', '.jpeg', '.eps', '.tif', '.tiff')
DATA = ('.json', '.csv', '.tsv', '.xlsx', '.xls', '.npy', '.npz', '.parquet', '.mat', '.txt', '.pkl', '.h5')


@dataclass
class Script:
    path: Path
    outputs: set[Path] = field(default_factory=set)
    sources: set[Path] = field(default_factory=set)


def _literals(tree: ast.AST) -> list[str]:
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and 3 < len(node.value) < 300 and '\n' not in node.value:
            out.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            # f"figures/{name}.png": keep the literal tail so the suffix and directory are still visible
            parts = [v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str)]
            if parts:
                out.append('*' + parts[-1])
    return out


def _resolve(ws: Workspace, script: Path, literal: str, pool: dict[str, list[Path]]) -> list[Path]:
    if not literal.startswith('*'):
        for base in (script.parent, ws.root):
            candidate = (base / literal)
            try:
                candidate = candidate.resolve()
            except OSError:
                continue
            if candidate.is_file():
                return [candidate]
    name = Path(literal.lstrip('*')).name
    if literal.startswith('*'):
        return []
    return pool.get(name, [])


def scan(ws: Workspace) -> list[Script]:
    images = ws.files('figures', IMAGE) + ws.files('paper', IMAGE) + ws.files('results', IMAGE)
    data = ws.files('results', DATA) + ws.files('problem', DATA) + ws.files('code', DATA)
    image_pool: dict[str, list[Path]] = {}
    data_pool: dict[str, list[Path]] = {}
    for p in images:
        image_pool.setdefault(p.name, []).append(p.resolve())
    for p in data:
        data_pool.setdefault(p.name, []).append(p.resolve())
    scripts = []
    for path in ws.files('figures', ('.py',)) + ws.files('code', ('.py',)):
        try:
            tree = ast.parse(read_text(path))
        except (SyntaxError, ValueError):
            continue
        script = Script(path.resolve())
        for literal in _literals(tree):
            lower = literal.lower()
            if lower.endswith(IMAGE):
                script.outputs.update(_resolve(ws, path, literal, image_pool))
            elif lower.endswith(DATA):
                script.sources.update(_resolve(ws, path, literal, data_pool))
        if script.outputs:
            scripts.append(script)
    return scripts


def check(ws: Workspace, used: set[Path], paper_present: bool) -> tuple[list[Issue], dict]:
    issues: list[Issue] = []
    scripts = scan(ws)
    produced: dict[Path, Script] = {}
    for s in scripts:
        for out in s.outputs:
            produced.setdefault(out, s)
    for out, s in sorted(produced.items()):
        if not out.exists():
            continue
        mtime = out.stat().st_mtime
        newer = sorted(ws.rel(src) for src in s.sources if src.exists() and src.stat().st_mtime > mtime + 1)
        if newer:
            issues.append(Issue('warning', 'figures', 'figures.stale', f'{ws.rel(out)} is older than its data ({", ".join(newer[:3])})',
                                ws.rel(out), hint=f'rerun {ws.rel(s.path)}'))
        elif s.path.stat().st_mtime > mtime + 1:
            issues.append(Issue('warning', 'figures', 'figures.stale', f'{ws.rel(out)} is older than the script that draws it',
                                ws.rel(out), hint=f'rerun {ws.rel(s.path)}'))
    figure_files = [p.resolve() for p in ws.files('figures', IMAGE)]
    if paper_present:
        # A PDF and PNG export of the same figure count as one figure.
        used_stems = {(p.parent, p.stem) for p in used}
        unused = [p for p in figure_files if (p.parent, p.stem) not in used_stems]
        if unused:
            names = ', '.join(ws.rel(p) for p in unused[:6])
            issues.append(Issue('info', 'figures', 'figures.unused', f'{len(unused)} figure file(s) not used in the paper: {names}{" ..." if len(unused) > 6 else ""}'))
        orphan = sorted(ws.rel(p) for p in used if p not in produced and p.suffix.lower() in IMAGE)
        if orphan:
            issues.append(Issue('info', 'figures', 'figures.untraced', f'{len(orphan)} figure(s) in the paper come from no script found here: {", ".join(orphan[:6])}',
                                hint='fine for illustrations; numerical figures should be drawn from results by code'))
    traced = sum(1 for p in figure_files if p in produced)
    summary = {'figures': len(figure_files), 'traced': traced, 'scripts': len(scripts)}
    return issues, summary
