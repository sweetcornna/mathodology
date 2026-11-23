#!/usr/bin/env python3
"""Optional stdlib checks for a skill checkout/export, not a modeling workflow.

Commands: all (default), metadata, links, boundary, selftest. Use --root PATH
for an exported tree or another checkout. No files are rewritten.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib
from urllib.parse import unquote, urlsplit

ROOT_FILES = {'AGENTS.md', 'CLAUDE.md', 'README.md', 'README_en.md', 'LICENSE', '.gitignore', '.mcp.json',
              '.claude/settings.json', '.github/workflows/studio-windows.yml'}
DOC_FILES = {f'docs/{name}{suffix}.md' for name in ['SKILLS', 'INSTALL', 'WORKFLOWS', 'BACKUP']
             for suffix in ['', '_zh']}
PREFIXES = ('.claude/skills/', '.claude/agents/', '.claude/workflows/', '.codex/agents/', 'apps/studio/')
IGNORED = {'.git', '.agents', '__pycache__', 'work', '.DS_Store'}
STUDIO_OUTPUTS = {'node_modules', 'out', 'release'}
NAME = re.compile(r'mathodology-[a-z0-9]+(?:-[a-z0-9]+)*\Z')
SKILL_NAME = re.compile(r'mathodology-[a-z0-9-]+')


def studio_output(rel):
    return (rel.parts[:2] == ('apps', 'studio') and len(rel.parts) > 2
            and (rel.parts[2] in STUDIO_OUTPUTS or rel.name.endswith('.tsbuildinfo')))


def files(root):
    if (root / '.git').exists():
        result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached',
                                 '--others', '--exclude-standard'], check=True,
                                capture_output=True)
        return sorted({root / os.fsdecode(raw) for raw in result.stdout.split(b'\0') if raw})
    paths = []
    for directory, dirs, filenames in os.walk(root):
        base = Path(directory)
        if base == root / '.codex':
            dirs[:] = [name for name in dirs if name == 'agents']
            continue
        for name in dirs[:]:
            path = base / name
            if studio_output(path.relative_to(root)):
                paths.append(path)
                dirs.remove(name)
            elif name in IGNORED:
                dirs.remove(name)
        for name in filenames:
            path = base / name
            if name not in IGNORED and not name.startswith('._') and path.suffix not in {'.pyc', '.pyo'}:
                paths.append(path)
    return sorted(paths)


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
    text = path.read_text(encoding='utf-8')
    match = re.match(r'\A---\n(.*?)\n---(?:\n|$)', text, re.S)
    return (fields(match.group(1)), text[match.end():].strip()) if match else ({}, text.strip())


def metadata(root, paths):
    errors = []
    paths = [p for p in paths if p.is_file()]
    skills = {p.parent.name for p in paths if p.name == 'SKILL.md'}
    claude_roles = {}
    codex_roles = {}
    if not skills:
        errors.append('No maintained SKILL.md files found')
    for path in paths:
        is_skill = path.name == 'SKILL.md'
        is_role = path.parent == root / '.claude/agents' and path.suffix == '.md'
        if path.parent == root / '.codex/agents' and path.suffix == '.toml':
            codex_roles[path.stem] = path
        if not (is_skill or is_role):
            continue
        expected = path.parent.name if is_skill else path.stem
        fm, body = frontmatter(path)
        if not NAME.fullmatch(expected) or fm.get('name') != expected:
            errors.append(f'{path.relative_to(root)}: invalid or mismatched name')
        description = fm.get('description', '')
        if not description or (is_skill and not description.startswith('Use when ')):
            errors.append(f'{path.relative_to(root)}: missing/invalid description')
        if is_skill:
            meta = path.parent / 'agents/openai.yaml'
            data = fields(meta.read_text(encoding='utf-8')) if meta.is_file() else {}
            if not all(data.get(key) for key in ['display_name', 'short_description', 'default_prompt']):
                errors.append(f'{meta.relative_to(root)}: missing interface metadata')
            if '$' + expected not in data.get('default_prompt', ''):
                errors.append(f'{meta.relative_to(root)}: default_prompt must invoke ${expected}')
        else:
            role_skills = SKILL_NAME.findall(fm.get('skills', ''))
            claude_roles[expected] = (description, role_skills, body)
            for name in role_skills:
                if name not in skills:
                    errors.append(f'{path.relative_to(root)}: unknown skill {name}')
    for name in sorted(claude_roles.keys() - codex_roles.keys()):
        errors.append(f'.codex/agents/{name}.toml: missing counterpart to Claude role')
    for name, path in codex_roles.items():
        rel = path.relative_to(root)
        if name not in claude_roles:
            errors.append(f'{rel}: missing counterpart in .claude/agents/')
        try:
            with path.open('rb') as handle:
                data = tomllib.load(handle)
        except (ValueError, OSError) as exc:
            errors.append(f'{rel}: cannot read role TOML ({exc})')
            continue
        if not NAME.fullmatch(name) or data.get('name') != name:
            errors.append(f'{rel}: invalid or mismatched name')
        description = data.get('description')
        if not isinstance(description, str) or not description.strip():
            errors.append(f'{rel}: missing/invalid description')
        prompt = data.get('developer_instructions')
        if not isinstance(prompt, str) or not prompt.strip():
            errors.append(f'{rel}: missing/invalid developer_instructions')
            continue
        preamble, _, body = prompt.strip().partition('\n\n')
        role_skills = SKILL_NAME.findall(preamble)
        for skill in role_skills:
            if skill not in skills:
                errors.append(f'{rel}: unknown skill {skill}')
        if name in claude_roles:
            for field, actual, expected in zip(('description', 'skills', 'instructions'),
                                               (description, role_skills, body), claude_roles[name]):
                if actual != expected:
                    errors.append(f'{rel}: {field} differs from the Claude role')
    return errors


def links(root, paths):
    errors = []
    paths = [p for p in paths if p.is_file()]
    known = {p.parent.name for p in paths if p.name == 'SKILL.md'}
    known |= {p.stem for p in paths if p.parent in [root / '.claude/agents', root / '.claude/workflows']}
    for path in paths:
        if path.suffix != '.md':
            continue
        text = path.read_text(encoding='utf-8')
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
            or studio_output(p.relative_to(root))
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
        roles = root / '.claude/agents'
        roles.mkdir()
        (roles / '._mathodology-fixture.md').write_bytes(b'\x00\xff')
        role_body = r'Cite with \res{}.'
        (roles / 'mathodology-fixture.md').write_text(
            '---\nname: mathodology-fixture\ndescription: Fixture role\nskills: [mathodology-fixture]\n---\n\n'
            + role_body + '\n')
        codex = root / '.codex/agents/mathodology-fixture.toml'
        codex.parent.mkdir(parents=True)
        good_role = ('name = "mathodology-fixture"\ndescription = "Fixture role"\n'
                     "developer_instructions = '''\nLoad the skills `mathodology-fixture`.\n\n" + role_body + "\n'''\n")
        codex.write_text(good_role)
        for check in CHECKS.values():
            assert not check(root, files(root)), check.__name__
        codex.write_text(good_role.replace("'''", '"""'))
        assert any('instructions differs' in issue for issue in metadata(root, files(root)))
        codex.write_text('name = [')
        assert any('cannot read role TOML' in issue for issue in metadata(root, files(root)))
        codex.unlink()
        assert any('missing counterpart' in issue for issue in metadata(root, files(root)))
        codex.write_text(good_role)
        studio = root / 'apps/studio'
        for name in STUDIO_OUTPUTS:
            output = studio / name
            output.mkdir(parents=True)
            assert any(name in issue for issue in boundary(root, files(root)))
        build_info = studio / 'source' / 'app.tsbuildinfo'
        assert boundary(root, [build_info])  # A tracked path can be absent from the worktree.
        build_info.parent.mkdir()
        build_info.touch()
        assert any('app.tsbuildinfo' in issue for issue in boundary(root, files(root)))
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
