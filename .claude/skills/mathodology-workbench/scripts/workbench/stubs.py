"""Outputs that exist but hold nothing: empty files, placeholder-only scripts, stub functions."""
from __future__ import annotations

import ast

from .report import Issue
from .workspace import Workspace, read_text

PLACEHOLDER_DOCS = ('todo', 'placeholder', 'not implemented', '待实现', '待补充', '占位')


def _is_noop(node: ast.stmt) -> bool:
    if isinstance(node, ast.Pass):
        return True
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
        return True  # docstring or bare `...`
    if isinstance(node, ast.Raise) and node.exc is not None:
        target = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
        return isinstance(target, ast.Name) and target.id == 'NotImplementedError'
    return False


def _stub_functions(tree: ast.Module) -> list[str]:
    names = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and all(_is_noop(s) for s in node.body):
            if any(isinstance(d, ast.Name) and d.id in ('abstractmethod', 'overload') or
                   isinstance(d, ast.Attribute) and d.attr in ('abstractmethod', 'overload') for d in node.decorator_list):
                continue
            names.append(node.name)
    return names


def check(ws: Workspace) -> list[Issue]:
    issues: list[Issue] = []
    for sub, stage in (('code', 'experiment'), ('results', 'results'), ('figures', 'figures')):
        for path in ws.files(sub, ('',)):
            try:
                empty = path.stat().st_size == 0
            except OSError:
                continue
            if empty and not path.name.startswith('.') and path.name != '__init__.py':
                issues.append(Issue('warning', stage, 'stubs.empty-file', 'file is empty', ws.rel(path)))
    for path in ws.files('code', ('.py',)):
        if path.name.startswith('test_') or path.name == '__init__.py' or path.stat().st_size == 0:
            continue
        try:
            tree = ast.parse(read_text(path))
        except (SyntaxError, ValueError) as exc:
            issues.append(Issue('error', 'experiment', 'stubs.syntax', f'does not parse: {getattr(exc, "msg", exc)}', ws.rel(path),
                                getattr(exc, 'lineno', None)))
            continue
        if all(_is_noop(s) for s in tree.body):
            issues.append(Issue('warning', 'experiment', 'stubs.placeholder-script', 'has no statements beyond pass, docstrings or ...',
                                ws.rel(path), hint='an experiment script that does nothing cannot produce results'))
            continue
        stubs = _stub_functions(tree)
        if stubs:
            issues.append(Issue('warning', 'experiment', 'stubs.functions',
                                f'function(s) with an empty body: {", ".join(stubs[:6])}{" ..." if len(stubs) > 6 else ""}', ws.rel(path),
                                hint='implement them or remove them; results computed through a stub are not results'))
    return issues

