#!/usr/bin/env python3
"""Mathodology workbench: executable checks and recorded runs for a contest workspace.

    mtd.py init [--paper-template] [--no-hooks]   create problem/ code/ results/ figures/ paper/
    mtd.py brief [STATEMENT] [--force]            list the questions in problem/questions.json
    mtd.py run [--name N] [--seed S] -- CMD ...   run an experiment and record its provenance
    mtd.py sync                                   write paper/results.tex (\\res macros) from results
    mtd.py status [--json] [--compile]            report every stage; exit 0
    mtd.py check [--json] [--compile] [--strict]  same report; exit 1 on errors (or warnings)
    mtd.py install-hooks [--remove]               merge the Claude Code hooks into .claude/settings.json
    mtd.py hook EVENT                             entry point the hooks call (reads JSON on stdin)

Standard library only (Python 3.9+). Pass --root to work on a workspace other than the
current directory's.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from workbench import brief, engine, hooks, results, runs  # noqa: E402
from workbench.report import render  # noqa: E402
from workbench.workspace import find_workspace, init, load  # noqa: E402

SKILL = Path(__file__).resolve().parents[1]
HOOKS_FILE = SKILL / 'hooks' / 'hooks.json'
MARK = 'mathodology-workbench'


def _utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='backslashreplace')
        except (AttributeError, ValueError, OSError):
            pass


def workspace(args, required: bool = True):
    start = Path(args.root) if args.root else Path.cwd()
    ws = find_workspace(start)
    if ws is None and required:
        sys.exit(f'No Mathodology workspace at or above {start}. Run `mtd.py init` there first '
                 '(a workspace has .mathodology/ or problem/ and paper/ folders).')
    return ws


def hook_command(root: Path) -> str:
    script = Path(__file__).resolve()
    try:
        target = '"$CLAUDE_PROJECT_DIR"/' + script.relative_to(root.resolve()).as_posix()
    except ValueError:
        target = '"' + script.as_posix() + '"'
    # Probe for a real Python 3.9+ (the Windows Store alias and stubs fail the probe); with none,
    # exit 0 so a missing interpreter never blocks the agent.
    return ('p=; for c in python3 python py; do "$c" -c "import sys; sys.exit(sys.version_info < (3, 9))" '
            '>/dev/null 2>&1 && { p=$c; break; }; done; [ -z "$p" ] || exec "$p" ' + target)


def install_hooks(root: Path, remove: bool = False) -> Path:
    """Merge our hooks into .claude/settings.json, keeping every other setting and hook."""
    path = root / '.claude' / 'settings.json'
    try:
        settings = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    except ValueError:
        sys.exit(f'{path} is not valid JSON; fix it before installing hooks.')
    spec = json.loads(HOOKS_FILE.read_text(encoding='utf-8'))['hooks']
    command = hook_command(root)
    current = settings.get('hooks') or {}
    merged = {}
    for event in sorted(set(current) | set(spec)):
        groups = [g for g in current.get(event, [])
                  if not any(MARK in h.get('command', '') for h in g.get('hooks', []))]
        if not remove and event in spec:
            for group in spec[event]:
                hooks_ = [{**h, 'command': h['command'].replace('{mtd}', command)} for h in group['hooks']]
                groups.append({**group, 'hooks': hooks_})
        if groups:
            merged[event] = groups
    if merged:
        settings['hooks'] = merged
    else:
        settings.pop('hooks', None)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return path


def cmd_init(args) -> int:
    root = Path(args.root or '.').resolve()
    created = init(root)
    ws = load(root)
    if args.paper_template:
        target = ws.dir('paper') / 'main.tex'
        if not target.exists():
            shutil.copyfile(SKILL / 'templates' / 'paper' / 'main.tex', target)
            created.append('paper/main.tex')
        results.sync(ws, results.load(ws)[0])  # the template inputs results.tex, so it must exist
    if not args.no_hooks:
        created.append(str(install_hooks(root).relative_to(root)) + ' (hooks)')
    print(f'Workspace ready at {root}')
    for item in created:
        print('  + ' + item)
    return 0


def cmd_brief(args) -> int:
    ws = workspace(args)
    source = Path(args.statement).resolve() if args.statement else None
    try:
        data, used = brief.make(ws, source)
    except (RuntimeError, OSError, KeyError) as exc:
        sys.exit(str(exc))
    if not used:
        sys.exit('No statement found in problem/ (.md, .txt, .tex, .pdf or .docx). Pass its path.')
    if args.print:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return 0
    if not brief.write(ws, data, args.force):
        sys.exit(f'{ws.rel(brief.path(ws))} exists; pass --force to replace it (your edits would be lost).')
    print(f'{len(data["questions"])} question(s) from {data["source"]} -> {ws.rel(brief.path(ws))}')
    for q in data['questions']:
        print(f'  {q["id"]}: {q["title"][:90]}')
    if not data['questions']:
        print('  No numbered questions recognised; add them to the file by hand.')
    print('Fill in deliverables, metrics, inputs and assumptions for each question.')
    return 0


def cmd_run(args) -> int:
    ws = workspace(args)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        sys.exit('Give the command after --, e.g. mtd.py run -- python code/q1.py')
    code, manifest = runs.run(ws, command, args.name, args.seed, args.timeout)
    print(f'\n[mtd] run {manifest["id"]}: exit {code} in {manifest["duration_s"]}s; '
          f'{len(manifest["outputs"])} output(s) changed: {", ".join(sorted(manifest["outputs"])[:6]) or "none"}', file=sys.stderr)
    rs, issues = results.load(ws)
    for issue in issues:
        if issue.severity == 'error':
            print('[mtd] ' + issue.render(), file=sys.stderr)
    if rs.values and ws.dir('paper').is_dir():
        path, changed = results.sync(ws, rs)
        if changed:
            print(f'[mtd] refreshed {ws.rel(path)}', file=sys.stderr)
    return code


def cmd_sync(args) -> int:
    ws = workspace(args)
    rs, issues = results.load(ws)
    for issue in issues:
        if issue.severity != 'info':
            print(issue.render())
    path, changed = results.sync(ws, rs)
    print(f'{ws.rel(path)}: {len(rs.values)} value(s), {"updated" if changed else "already current"}')
    return 1 if any(i.severity == 'error' for i in issues) else 0


def cmd_status(args) -> int:
    ws = workspace(args)
    report = engine.status(ws, compile=args.compile, sync=not args.no_sync)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(render(report))
    if args.command_name == 'check':
        bad = report['counts']['error'] + (report['counts']['warning'] if args.strict else 0)
        return 1 if bad else 0
    return 0


def cmd_install_hooks(args) -> int:
    root = Path(args.root or '.').resolve()
    path = install_hooks(root, args.remove)
    print(f'{"Removed" if args.remove else "Installed"} Mathodology hooks in {path}')
    return 0


def main(argv=None) -> int:
    _utf8()
    parser = argparse.ArgumentParser(prog='mtd.py', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', help='workspace directory (default: search upward from the current directory)')
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--root', default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest='command_name', required=True)
    add = sub.add_parser
    sub.add_parser = lambda *a, **k: add(*a, parents=[common], **k)
    p = sub.add_parser('init', help='create a workspace')
    p.add_argument('--paper-template', action='store_true', help='also write paper/main.tex from the template')
    p.add_argument('--no-hooks', action='store_true', help='do not touch .claude/settings.json')
    p.set_defaults(func=cmd_init)
    p = sub.add_parser('brief', help='detect questions in the statement')
    p.add_argument('statement', nargs='?')
    p.add_argument('--force', action='store_true')
    p.add_argument('--print', action='store_true', help='print instead of writing problem/questions.json')
    p.set_defaults(func=cmd_brief)
    p = sub.add_parser('run', help='run and record an experiment')
    p.add_argument('--name')
    p.add_argument('--seed', type=int)
    p.add_argument('--timeout', type=float)
    p.add_argument('command', nargs=argparse.REMAINDER)
    p.set_defaults(func=cmd_run)
    p = sub.add_parser('sync', help='write paper/results.tex')
    p.set_defaults(func=cmd_sync)
    for name in ('status', 'check'):
        p = sub.add_parser(name, help='report every stage' if name == 'status' else 'report and fail on errors')
        p.add_argument('--json', action='store_true')
        p.add_argument('--compile', action='store_true', help='compile the LaTeX paper and read its log')
        p.add_argument('--no-sync', action='store_true', help='do not refresh paper/results.tex')
        p.add_argument('--strict', action='store_true', help='check: fail on warnings too')
        p.set_defaults(func=cmd_status)
    p = sub.add_parser('install-hooks', help='merge the hooks into .claude/settings.json')
    p.add_argument('--remove', action='store_true')
    p.set_defaults(func=cmd_install_hooks)
    p = sub.add_parser('hook', help='hook entry point')
    p.add_argument('event', choices=sorted(hooks.HANDLERS))
    p.set_defaults(func=lambda a: hooks.main(a.event))
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    raise SystemExit(main())
