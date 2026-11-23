"""Recorded experiment runs: what ran, on which inputs, and which results it wrote."""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache
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


def snapshot(ws: Workspace, subs: tuple[str, ...], suffixes: tuple[str, ...] | None = None) -> dict[str, tuple[str, os.stat_result]]:
    out = {}
    for sub in subs:
        for path in ws.files(sub, suffixes or ('',)):
            if len(out) >= MAX_FILES:
                return out
            try:
                stat = path.stat()
            except OSError:
                continue
            digest = sha256(path)
            if digest:
                out[ws.rel(path)] = (digest, stat)
    return out


def _output_state(record: tuple[str, os.stat_result]) -> tuple[str, int, int, int]:
    """Include file metadata so a same-byte rewrite still has a producer."""
    digest, stat = record
    return digest, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino


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
    while True:
        try:
            folder.mkdir(parents=True)
            break
        except FileExistsError:
            n += 1
            folder = ws.dir('runs') / f'{run_id}-{n}'
    run_id = folder.name
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
    outputs = {rel: record[0] for rel, record in after.items()
               if rel not in before or _output_state(before[rel]) != _output_state(record)}
    finished = time.time()
    manifest = {
        'schema': 'mathodology.run/1',
        'id': run_id,
        'command': command,
        'seed': seed,
        'started': datetime.fromtimestamp(started).astimezone().isoformat(timespec='microseconds'),
        'duration_s': round(finished - started, 3),
        'exit_code': exit_code,
        'python': sys.version.split()[0],
        'platform': platform.platform(),
        'git': _git(ws),
        'inputs': {rel: digest for rel, (digest, _) in inputs.items()},
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

    def order(manifest):
        try:
            timestamp = re.sub(r'([+-]\d{2})(\d{2})$', r'\1:\2', manifest['started'])
            started = datetime.fromisoformat(timestamp).timestamp()
        except (KeyError, TypeError, ValueError):
            started = 0
        return started, manifest.get('id', '')

    return sorted(out, key=order)


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
    wanted = set(result_files)
    latest = {}
    matching = {}
    drift_by_run = {}

    @lru_cache(maxsize=None)
    def current_digest(rel: str) -> str | None:
        return sha256(ws.root / rel)

    for manifest in runs:
        for rel, digest in manifest.get('outputs', {}).items():
            if rel in wanted:
                latest[rel] = manifest
                if current_digest(rel) == digest:
                    matching[rel] = manifest
    for rel in result_files:
        if rel not in latest:
            issues.append(Issue('info', 'results', 'runs.unrecorded', 'not written by any recorded run', rel))
            continue
        if rel not in matching:
            issues.append(Issue('warning', 'results', 'runs.modified', f'changed after its last recorded run {latest[rel]["id"]}', rel,
                                hint='results come from code; rerun the experiment instead of editing numbers'))
            continue
        last = matching[rel]
        run_id = last['id']
        if last.get('exit_code') != 0:
            issues.append(Issue('warning', 'results', 'runs.from-failed', f'written by run {run_id}, which failed (exit {last["exit_code"]})', rel))
        if run_id not in drift_by_run:
            drift_by_run[run_id] = sorted(p for p, digest in last.get('inputs', {}).items()
                                          if p.startswith(('code/', 'problem/')) and current_digest(p) != digest)
        for folder, label, code in (('code/', 'code', 'runs.stale-code'), ('problem/', 'problem inputs', 'runs.stale-inputs')):
            changed = [p for p in drift_by_run[run_id] if p.startswith(folder)]
            if changed:
                issues.append(Issue('warning', 'results', code, f'{label} changed since run {run_id} produced it: {", ".join(changed[:4])}', rel,
                                    hint='rerun the experiment with the current inputs'))
    return issues, summary
