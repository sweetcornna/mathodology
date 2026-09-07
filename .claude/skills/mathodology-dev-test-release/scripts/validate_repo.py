#!/usr/bin/env python3
"""Optional stdlib checks for a skill checkout/export, not a modeling workflow.

Commands: all (default), metadata, links, boundary, selftest. Use --root PATH
for an exported tree or another checkout. No files are rewritten.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit

ROOT_FILES = {'AGENTS.md', 'README.md', 'README_en.md', 'LICENSE', '.gitignore', '.mcp.json'}
DOC_FILES = {f'docs/{name}{suffix}.md' for name in ['SKILLS', 'INSTALL', 'WORKFLOWS', 'BACKUP']
             for suffix in ['', '_zh']}
PREFIXES = ('.claude/skills/', '.claude/agents/', '.claude/workflows/')
IGNORED = {'.git', '.agents', '.codex', '__pycache__', 'work', '.DS_Store'}
NAME = re.compile(r'mathodology-[a-z0-9]+(?:-[a-z0-9]+)*\Z')


def files(root):
    if (root / '.git').exists():
        result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached',
                                 '--others', '--exclude-standard'], check=True,
                                capture_output=True)
        return sorted({p for raw in result.stdout.decode().split('\0')
                       if raw and (p := root / raw).is_file()})
    return sorted(p for p in root.rglob('*') if p.is_file()
                  and not (set(p.relative_to(root).parts) & IGNORED)
                  and not p.name.startswith('._')
                  and p.suffix not in {'.pyc', '.pyo'})


def fields(text):
    """Read the pack's simple scalar fields (not a general-purpose YAML parser)."""
    result = {}
    for line in text.splitlines():
        match = re.match(r'^\s*([a-z_]+):\s*(.+?)\s*$', line)
        if match:
            key, value = match.groups()
            if value.startswith('"'):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    value = value.strip('"')
            else:
                value = value.strip("'")
            result[key] = value
    return result


def frontmatter(path):
    match = re.match(r'\A---\n(.*?)\n---(?:\n|$)', path.read_text(), re.S)
    return fields(match.group(1)) if match else {}


def metadata(root, paths):
    errors = []
    skills = {p.parent.name for p in paths if p.name == 'SKILL.md'}
    if not skills:
        errors.append('No maintained SKILL.md files found')
    for path in paths:
        is_skill = path.name == 'SKILL.md'
        is_role = path.parent == root / '.claude/agents' and path.suffix == '.md'
        if not (is_skill or is_role):
            continue
        expected = path.parent.name if is_skill else path.stem
        fm = frontmatter(path)
        if not NAME.fullmatch(expected) or fm.get('name') != expected:
            errors.append(f'{path.relative_to(root)}: invalid or mismatched name')
        description = fm.get('description', '')
        if not description or (is_skill and not description.startswith('Use when ')):
            errors.append(f'{path.relative_to(root)}: missing/invalid description')
        if is_skill:
            meta = path.parent / 'agents/openai.yaml'
            data = fields(meta.read_text()) if meta.is_file() else {}
            if not all(data.get(key) for key in ['display_name', 'short_description', 'default_prompt']):
                errors.append(f'{meta.relative_to(root)}: missing interface metadata')
            if '$' + expected not in data.get('default_prompt', ''):
                errors.append(f'{meta.relative_to(root)}: default_prompt must invoke ${expected}')
        else:
            for name in re.findall(r'mathodology-[a-z0-9-]+', fm.get('skills', '')):
                if name not in skills:
                    errors.append(f'{path.relative_to(root)}: unknown skill {name}')
    return errors


def links(root, paths):
    errors = []
    known = {p.parent.name for p in paths if p.name == 'SKILL.md'}
    known |= {p.stem for p in paths if p.parent in [root / '.claude/agents', root / '.claude/workflows']}
    for path in paths:
        if path.suffix != '.md':
            continue
        text = path.read_text()
        # Exclude fenced examples; include images as well as ordinary links.
        text = re.sub(r'^```.*?^```\s*$', '', text, flags=re.M | re.S)
        for match in re.finditer(r'\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)', text):
            target = match.group(1).strip('<>')
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            dest = path.parent / unquote(parts.path)
            if not dest.exists():
                errors.append(f'{path.relative_to(root)}: missing link {target}')
        for match in re.finditer(r'`(mathodology-[a-z0-9-]+)`|\$(mathodology-[a-z0-9-]+)', text):
            name = match.group(1) or match.group(2)
            if name not in known:
                errors.append(f'{path.relative_to(root)}: unknown reference {name}')
    return errors


def boundary(root, paths):
    return [f'Outside skills repository boundary: {p.relative_to(root)}' for p in paths
            if p.suffix in {'.pyc', '.pyo'} or '__pycache__' in p.relative_to(root).parts
            or ((rel := p.relative_to(root).as_posix()) not in ROOT_FILES | DOC_FILES
                and not rel.startswith(PREFIXES))]


CHECKS = {'metadata': metadata, 'links': links, 'boundary': boundary}


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        skill = root / '.claude/skills/mathodology-fixture'
        (skill / 'agents').mkdir(parents=True)
        entry = skill / 'SKILL.md'
        entry.write_text('---\nname: mathodology-fixture\ndescription: Use when checking a fixture.\n---\n')
        (skill / 'agents/openai.yaml').write_text('interface:\n  display_name: Fixture\n'
            '  short_description: Fixture\n  default_prompt: Use $mathodology-fixture.\n')
        readme = root / 'README.md'
        readme.write_text('[skill](.claude/skills/mathodology-fixture/SKILL.md)\n')
        # Older macOS archives can include binary AppleDouble sidecar files.
        (root / '.claude/agents').mkdir()
        (root / '.claude/agents/._mathodology-fixture.md').write_bytes(b'\x00\xff')
        for check in CHECKS.values():
            assert not check(root, files(root)), check.__name__
        bytecode = skill / '__pycache__/fixture.pyc'
        bytecode.parent.mkdir()
        bytecode.write_bytes(b'not-source')
        assert boundary(root, [bytecode])  # Git can still enumerate force-tracked caches.
        readme.write_text('[missing](missing.md)\n')
        assert links(root, files(root))
        entry.write_text(entry.read_text().replace('name: mathodology-fixture', 'name: wrong'))
        assert metadata(root, files(root))
        (root / 'application.py').write_text('# outside the skill boundary\n')
        assert boundary(root, files(root))
    print('PASS selftest: valid export and broken metadata/link/boundary fixtures')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('check', nargs='?', default='all', choices=['all', *CHECKS, 'selftest'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[4])
    args = parser.parse_args()
    if args.check == 'selftest':
        selftest()
        return 0
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f'Root directory does not exist: {root}')
    try:
        paths = files(root)
    except (OSError, subprocess.CalledProcessError) as exc:
        parser.error(f'Cannot enumerate repository files: {exc}')
    failed = False
    for name in CHECKS if args.check == 'all' else [args.check]:
        issues = CHECKS[name](root, paths)
        print(f'{"FAIL" if issues else "PASS"} {name}')
        for issue in issues:
            print('  ' + issue)
        failed |= bool(issues)
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
