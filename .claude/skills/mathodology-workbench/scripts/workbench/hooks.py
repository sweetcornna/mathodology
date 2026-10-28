"""Claude Code hook handlers. Each reads the hook's JSON on stdin and prints at most one JSON reply.

A hook must never break the agent's session: any internal failure is swallowed and the hook
stays silent. Outside a Mathodology workspace every handler is a no-op.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

from . import engine, results
from .report import render
from .workspace import Workspace, find_workspace, read_text, write_json

PAPER_SUFFIXES = ('.tex', '.md')
EDIT_TOOLS = {'Write', 'Edit', 'MultiEdit', 'NotebookEdit'}


def _session_file(payload: dict) -> Path:
    sid = ''.join(c for c in str(payload.get('session_id') or 'default') if c.isalnum() or c in '-_')[:80]
    user = getattr(os, 'getuid', lambda: os.environ.get('USERNAME', 'user'))()
    return Path(tempfile.gettempdir()) / f'mathodology-hooks-{user}' / f'{sid}.json'


def _remember(payload: dict, ws: Workspace) -> None:
    try:
        _remember_unsafe(payload, ws)
    except OSError:
        pass  # only a convenience for the Stop hook; never let it stop the checks


def _remember_unsafe(payload: dict, ws: Workspace) -> None:
    path = _session_file(payload)
    try:
        known = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        known = []
    if str(ws.root) not in known:
        known.append(str(ws.root))
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
        tmp.write_text(json.dumps(known[-8:]), encoding='utf-8')
        os.replace(tmp, path)


def workspaces(payload: dict) -> list[Workspace]:
    roots: list[str] = []
    try:
        roots += json.loads(_session_file(payload).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    found: dict[Path, Workspace] = {}
    for start in [payload.get('cwd'), os.environ.get('CLAUDE_PROJECT_DIR'), *roots]:
        ws = find_workspace(start)
        if ws:
            found.setdefault(ws.root, ws)
    return list(found.values())


def _target(payload: dict) -> Path | None:
    tool_input = payload.get('tool_input') or {}
    raw = tool_input.get('file_path') or tool_input.get('notebook_path')
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = Path(payload.get('cwd') or os.getcwd()) / path
    return path.resolve()


def _context(event: str, text: str) -> dict:
    return {'hookSpecificOutput': {'hookEventName': event, 'additionalContext': text}}


def mtd_hint(ws: Workspace) -> str:
    script = Path(__file__).resolve().parents[1] / 'mtd.py'
    try:
        shown = script.relative_to(ws.root).as_posix()
    except ValueError:
        shown = str(script)
    return f'python3 {shown}'


def session_start(payload: dict) -> dict | None:
    blocks = []
    for ws in workspaces(payload)[:2]:
        report = engine.status(ws, sync=True)
        blocks.append(render(report, limit=12, min_severity='warning'))
        blocks.append(f'Workbench commands: `{mtd_hint(ws)} status | brief | run -- <cmd> | sync | check --compile`. '
                      'Experiment code writes results/*.json (schema mathodology.results/1); the paper cites values with '
                      '\\res{file.key} after \\input{results}. See the mathodology-workbench skill.')
    return _context('SessionStart', '\n'.join(blocks)) if blocks else None


def pre_edit(payload: dict) -> dict | None:
    if payload.get('tool_name') not in EDIT_TOOLS:
        return None
    path = _target(payload)
    ws = find_workspace(path) if path else None
    if not ws:
        return None
    rel = ws.rel(path)
    reason = None
    if rel == ws.rel(results.macro_path(ws)) or (rel.startswith('paper/tables/') and path.is_file() and results.is_generated(path)):
        reason = f'{rel} is generated from results/*.json. Change the code that writes the results and run `{mtd_hint(ws)} sync` instead of editing it.'
    elif rel.startswith('results/') and rel.lower().endswith('.json') and not ws.config.get('allow_result_edits') \
            and os.environ.get('MATHODOLOGY_ALLOW_RESULT_EDITS') != '1':
        reason = (f'{rel} holds experiment results, which must come from code. Change the experiment and rerun it '
                  f'(`{mtd_hint(ws)} run -- python code/<script>.py`) rather than writing numbers by hand. '
                  'If the user explicitly wants a manual edit, they can set "allow_result_edits": true in .mathodology/config.json.')
    if not reason:
        return None
    return {'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny', 'permissionDecisionReason': reason}}


def _results_stamp(ws: Workspace) -> tuple[float, Path]:
    newest = max((p.stat().st_mtime for p in ws.files('results', ('.json',))), default=0.0)
    return newest, ws.state / 'results.stamp'


def post_tool(payload: dict) -> dict | None:
    tool = payload.get('tool_name')
    messages: list[str] = []
    block = False
    if tool in EDIT_TOOLS:
        path = _target(payload)
        ws = find_workspace(path) if path else None
        if not ws:
            return None
        _remember(payload, ws)
        rel = ws.rel(path)
        if rel.startswith('paper/') and rel.endswith(PAPER_SUFFIXES) and rel != ws.rel(results.macro_path(ws)) \
                and not results.is_generated(path):
            issues = engine.file_checks(ws, rel)
            if issues:
                block = any(i.severity == 'error' for i in issues)
                messages.append(f'Mathodology check of {rel}:\n' + '\n'.join('- ' + i.render() for i in issues[:12]))
        elif rel.startswith('results/') and rel.lower().endswith('.json'):
            messages += _results_changed(ws, force=True)
    elif tool in ('Bash', 'PowerShell'):
        for ws in workspaces(payload):
            messages += _results_changed(ws)
    if not messages:
        return None
    text = '\n'.join(messages)
    if block:
        return {'decision': 'block', 'reason': text}
    return _context('PostToolUse', text)


def _results_changed(ws: Workspace, force: bool = False) -> list[str]:
    newest, stamp = _results_stamp(ws)
    try:
        seen = float(read_text(stamp) or 0)
    except ValueError:
        seen = 0.0
    if not force and (newest == 0.0 or newest <= seen):
        return []
    rs, issues = results.load(ws)
    out = []
    errors = [i for i in issues if i.severity == 'error']
    if errors:
        out.append('Results contract problems:\n' + '\n'.join('- ' + i.render() for i in errors[:10]))
    target = results.macro_path(ws)
    if (rs.values or results.table_texts(rs)) and (target.exists() or ws.dir('paper').is_dir()):
        _, changed = results.sync(ws, rs)
        if changed:
            out.append(f'Results changed: refreshed {ws.rel(target)} ({len(rs.values)} values citable as \\res{{file.key}}).')
    ws.state.mkdir(parents=True, exist_ok=True)
    stamp.write_text(str(newest), encoding='utf-8')
    return out


def stop(payload: dict) -> dict | None:
    if payload.get('stop_hook_active'):
        return None
    reasons = []
    for ws in workspaces(payload):
        gate = ws.config.get('stop_gate', 'errors')
        if gate == 'off':
            continue
        report = engine.status(ws, sync=True)
        keep = ('error',) if gate == 'errors' else ('error', 'warning')
        blocking = [i for i in report['issues'] if i['severity'] in keep]
        state = ws.state / 'stop.json'
        if not blocking:
            if state.exists():
                state.unlink()
            continue
        fingerprint = hashlib.sha256(json.dumps([[i.get('code'), i.get('file'), i.get('message')] for i in blocking]).encode()).hexdigest()
        try:
            last = json.loads(read_text(state)).get('fingerprint')
        except (ValueError, AttributeError):
            last = None
        if last == fingerprint:
            continue  # already raised once; do not hold the session hostage over the same problems
        write_json(state, {'fingerprint': fingerprint})
        reasons.append(render({**report, 'issues': blocking}, limit=12, min_severity='warning'))
    if not reasons:
        return None
    return {'decision': 'block', 'reason': 'Mathodology checks found problems before you finish. Fix them, or tell the user '
                                           'why they remain (this is raised once per set of problems).\n' + '\n'.join(reasons)}


HANDLERS = {'session-start': session_start, 'pre-edit': pre_edit, 'post-tool': post_tool, 'stop': stop}


def main(event: str) -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        reply = HANDLERS[event](payload)
        if reply:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001 - a hook must not take the session down
        if os.environ.get('MATHODOLOGY_HOOK_DEBUG'):
            raise
        sys.stderr.write(f'mathodology hook {event}: {exc}\n')
    return 0
