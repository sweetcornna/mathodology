"""Locate a contest workspace and read its small amount of configuration."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

MARKER = '.mathodology'
LAYOUT = ('problem', 'code', 'results', 'figures', 'paper')
DEFAULT_CONFIG = {
    # Severity at which the Stop hook asks the agent to keep working: errors, warnings or off.
    'stop_gate': 'errors',
    # Relative tolerance under which a paper number that differs from a result is reported as a
    # likely stale or mistyped copy rather than an unrelated number.
    'near_miss_rel': 0.02,
    # Hand edits to results/*.json through the agent's file tools are refused unless this is true.
    'allow_result_edits': False,
}
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'site-packages', '.mathodology', '.claude', '.agents', '.codex'}
MAX_FILES = 5000  # per folder walk; keeps hooks fast in an oversized workspace


@dataclass
class Workspace:
    root: Path
    config: dict = field(default_factory=dict)

    @property
    def state(self) -> Path:
        return self.root / MARKER

    def dir(self, name: str) -> Path:
        return self.root / name

    def rel(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return str(path)

    def files(self, sub: str, suffixes: tuple[str, ...]) -> list[Path]:
        base = self.root / sub
        if not base.is_dir():
            return []
        out = []
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')
                                 and not (Path(dirpath) / d / 'pyvenv.cfg').exists())
            if len(out) >= MAX_FILES:
                break
            for name in sorted(filenames):
                if name.lower().endswith(suffixes) and not name.startswith('._'):
                    out.append(Path(dirpath) / name)
        return out


def is_workspace(path: Path) -> bool:
    """A marker directory, or the folder layout Mathodology Studio creates for a contest project."""
    if (path / MARKER).is_dir():
        return True
    return (path / 'problem').is_dir() and (path / 'paper').is_dir()


def find_workspace(start: Path | str | None) -> Workspace | None:
    if not start:
        return None
    path = Path(start).expanduser()
    try:
        path = path.resolve()
    except OSError:
        return None
    if path.is_file() or not path.exists():
        path = path.parent
    for candidate in (path, *path.parents):
        if is_workspace(candidate):
            return load(candidate)
        if (candidate / '.git').exists():
            break
    return None


def load(root: Path) -> Workspace:
    config = dict(DEFAULT_CONFIG)
    try:
        saved = json.loads((root / MARKER / 'config.json').read_text(encoding='utf-8'))
        if isinstance(saved, dict):
            config.update({k: v for k, v in saved.items() if k in DEFAULT_CONFIG})
    except (OSError, ValueError):
        pass
    return Workspace(root.resolve(), config)


def init(root: Path) -> list[str]:
    created = []
    for name in LAYOUT:
        if not (root / name).is_dir():
            (root / name).mkdir(parents=True)
            created.append(name + '/')
    state = root / MARKER
    state.mkdir(parents=True, exist_ok=True)
    config = state / 'config.json'
    if not config.exists():
        config.write_text(json.dumps(DEFAULT_CONFIG, indent=2) + '\n', encoding='utf-8')
        created.append(f'{MARKER}/config.json')
    return created


def sha256(path: Path, limit: int = 64 * 1024 * 1024) -> str | None:
    """Digest of a file; very large data files are fingerprinted by size and mtime instead."""
    try:
        stat = path.stat()
        if stat.st_size > limit:
            return f'size:{stat.st_size}:mtime:{int(stat.st_mtime)}'
        digest = hashlib.sha256()
        with path.open('rb') as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b''):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def read_text(path: Path) -> str:
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
        except OSError:
            return ''
    return path.read_text(encoding='utf-8', errors='replace')


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(tmp, path)
