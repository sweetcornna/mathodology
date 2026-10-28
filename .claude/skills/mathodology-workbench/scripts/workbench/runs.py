"""Recorded experiment runs: what ran, on which inputs, and which results it wrote."""
from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import threading
import time

from .report import Issue
from .workspace import Workspace, read_text, sha256, write_json

CODE = ('.py', '.m', '.r', '.jl', '.ipynb', '.cpp', '.cc', '.c', '.h', '.java', '.js', '.ts', '.sh', '.toml',
        '.yaml', '.yml', '.json', '.cfg', '.ini', '.txt', '.lp', '.mod', '.gms')
MAX_FILES = 3000


def snapshot(ws: Workspace, subs: tuple[str, ...], suffixes: tuple[str, ...] | None = None) -> dict[str, str]:
    out: dict[str, str] = {}
    for sub in subs:
        for path in ws.files(sub, suffixes or ('',)):
            if len(out) >= MAX_FILES:
                return out
            digest = sha256(path)
            if digest:
                out[ws.rel(path)] = digest
    return out


def _git(ws: Workspace) -> dict | None:
    try:
        commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ws.root, capture_output=True, text=True, timeout=10)
        if commit.returncode != 0:
            return None
        dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ws.root, capture_output=True, text=True, timeout=10)
        return {'commit': commit.stdout.strip(), 'dirty': bool(dirty.stdout.strip())}
    except (OSError, subprocess.SubprocessError):
        return None


def _tee(stream, sink, echo) -> None:
    for chunk in iter(lambda: stream.readline(), b''):
        sink.write(chunk)
        sink.flush()
        try:
            echo.buffer.write(chunk)
            echo.flush()
        except (AttributeError, ValueError):
            pass


def run(ws: Workspace, command: list[str], name: str | None = None, seed: int | None = None, timeout: float | None = None) -> tuple[int, dict]:
    started = time.time()
    label = re.sub(r'[^A-Za-z0-9_-]+', '-', name or Path(command[-1] if len(command) > 1 else command[0]).stem).strip('-') or 'run'
    run_id = time.strftime('%Y%m%d-%H%M%S', time.localtime(started)) + f'-{label}'
    folder = ws.dir('runs') / run_id
    n = 1
    while folder.exists():
        n += 1
        folder = ws.dir('runs') / f'{run_id}-{n}'
    run_id = folder.name
    folder.mkdir(parents=True)
    inputs = snapshot(ws, ('code',), CODE)
    inputs.update(snapshot(ws, ('problem',)))
    before = snapshot(ws, ('results', 'figures'))
    env = dict(os.environ, MATHODOLOGY_RUN_ID=run_id, MATHODOLOGY_WORKSPACE=str(ws.root), PYTHONUNBUFFERED='1')
    if seed is not None:
        env['MATHODOLOGY_SEED'] = str(seed)
        env['PYTHONHASHSEED'] = str(seed)
    exit_code: int
    with (folder / 'stdout.log').open('wb') as out, (folder / 'stderr.log').open('wb') as err:
        try:
            proc = subprocess.Popen(command, cwd=ws.root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as exc:
            err.write(str(exc).encode())
            exit_code = 127
            proc = None
        if proc:
            threads = [threading.Thread(target=_tee, args=(proc.stdout, out, sys.stdout), daemon=True),
                       threading.Thread(target=_tee, args=(proc.stderr, err, sys.stderr), daemon=True)]
            for t in threads:
                t.start()
            try:
                exit_code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                exit_code = proc.wait()
                err.write(f'\n[mtd] killed after {timeout}s\n'.encode())
            for t in threads:
                t.join(timeout=5)
    after = snapshot(ws, ('results', 'figures'))
    outputs = {rel: digest for rel, digest in after.items() if before.get(rel) != digest}
    finished = time.time()
    manifest = {
        'schema': 'mathodology.run/1',
        'id': run_id,
        'command': command,
        'seed': seed,
        'started': time.strftime('%Y-%m-%dT%H:%M:%S%z', time.localtime(started)),
        'duration_s': round(finished - started, 3),
        'exit_code': exit_code,
        'python': sys.version.split()[0],
        'platform': platform.platform(),
        'git': _git(ws),
        'inputs': inputs,
        'outputs': outputs,
        'logs': {'stdout': ws.rel(folder / 'stdout.log'), 'stderr': ws.rel(folder / 'stderr.log')},
    }
    write_json(folder / 'manifest.json', manifest)
    with (ws.dir('runs') / 'index.jsonl').open('a', encoding='utf-8') as index:
        index.write(json.dumps({'id': run_id, 'exit_code': exit_code, 'started': manifest['started'],
                                'outputs': sorted(outputs)}, ensure_ascii=False) + '\n')
    return exit_code, manifest


def manifests(ws: Workspace) -> list[dict]:
    out = []
    for path in ws.files('runs', ('manifest.json',)):
        try:
            data = json.loads(read_text(path))
        except ValueError:
            continue
        if isinstance(data, dict) and data.get('schema') == 'mathodology.run/1':
            out.append(data)
    return sorted(out, key=lambda m: (m.get('started', ''), m.get('id', '')))


def check(ws: Workspace, result_files: list[str]) -> tuple[list[Issue], dict]:
    issues: list[Issue] = []
    runs = manifests(ws)
    failed = [m for m in runs if m.get('exit_code') != 0]
    summary = {'runs': len(runs), 'failed': len(failed)}
    if not runs:
        if result_files:
            issues.append(Issue('info', 'experiment', 'runs.none', 'no recorded runs; results have no provenance',
                                hint='run experiments with `mtd.py run -- python code/<script>.py`'))
        return issues, summary
    if failed:
        issues.append(Issue('info', 'experiment', 'runs.failed', f'{len(failed)} recorded run(s) failed, latest {failed[-1]["id"]} (exit {failed[-1]["exit_code"]})',
                            failed[-1]['logs']['stderr'], hint='report failed attempts that matter for the conclusions'))
    for rel in result_files:
        producers = [m for m in runs if rel in m.get('outputs', {})]
        if not producers:
            issues.append(Issue('info', 'results', 'runs.unrecorded', 'not written by any recorded run', rel))
            continue
        current = sha256(ws.root / rel)
        matching = [m for m in producers if m['outputs'][rel] == current]
        if not matching:
            issues.append(Issue('warning', 'results', 'runs.modified', f'changed after its last recorded run {producers[-1]["id"]}', rel,
                                hint='results come from code; rerun the experiment instead of editing numbers'))
            continue
        last = matching[-1]
        if last.get('exit_code') != 0:
            issues.append(Issue('warning', 'results', 'runs.from-failed', f'written by run {last["id"]}, which failed (exit {last["exit_code"]})', rel))
        changed = sorted(p for p, digest in last.get('inputs', {}).items()
                         if p.startswith('code/') and sha256(ws.root / p) not in (digest,))
        if changed:
            issues.append(Issue('warning', 'results', 'runs.stale-code', f'code changed since run {last["id"]} produced it: {", ".join(changed[:4])}', rel,
                                hint='rerun the experiment so results match the code'))
    return issues, summary
