#!/usr/bin/env python3
"""validate_repo.py -- Mathodology skills-repository maintenance gates (pure stdlib).

Single home for the repo's mechanical validation. No third-party deps: the
simple frontmatter/openai.yaml files are regex-parsed rather than loaded with
PyYAML, so this runs anywhere python3 does.

Run from the repository root:

    python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py [subcommand]

Subcommands (default: all):
    skills      SKILL.md frontmatter: name==dir, lowercase-hyphen, <=64 chars;
                description non-empty, <=1024 chars, starts with "Use when".
    metadata    agents/openai.yaml default_prompt contains $<dirname>.
    links       relative markdown links and inline .claude/... paths in tracked
                *.md resolve; every mathodology-<x> name maps to a skill/agent/workflow.
    whitelist   tracked files stay inside the skills-repo whitelist.
    agents      .claude/agents/*.md frontmatter: name==stem, description, tools,
                and model (if present) in {opus,sonnet,haiku,inherit}.
    sync        en/zh doc twins agree on heading + code-block counts, and code
                blocks are byte-identical after dropping CJK lines.
    selftest    construct pass/fail fixtures in a tempdir; prove each checker works.
    all         run skills, metadata, links, whitelist, agents, sync.

Exit status is non-zero if any run check fails.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

# --------------------------------------------------------------------------
# whitelist definition (shared with the backup script's intent)
# --------------------------------------------------------------------------
KEEP_EXACT = {
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "README_en.md",
    "LICENSE",
    "docs/SKILLS.md",
    "docs/SKILLS_zh.md",
    "docs/INSTALL.md",
    "docs/INSTALL_zh.md",
    "docs/WORKFLOWS.md",
    "docs/WORKFLOWS_zh.md",
    "docs/BACKUP.md",
}
KEEP_PREFIXES = (".claude/skills/", ".claude/agents/", ".claude/workflows/")

DOC_TWINS = [
    ("docs/SKILLS.md", "docs/SKILLS_zh.md"),
    ("docs/INSTALL.md", "docs/INSTALL_zh.md"),
    ("docs/WORKFLOWS.md", "docs/WORKFLOWS_zh.md"),
]

# Historical mathodology-<x> names that may appear in archive text but do not
# map to a live skill/agent/workflow. Prefer fixing the doc over extending this.
HISTORICAL_NAMES = set()

# Intentionally-absent gitignored runtime paths that docs legitimately mention.
IGNORED_RUNTIME_PATHS = (".claude/worktrees",)


# --------------------------------------------------------------------------
# small parsing helpers (regex, no PyYAML)
# --------------------------------------------------------------------------
def _read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def parse_frontmatter(text):
    """Parse a leading '--- ... ---' YAML block into a flat dict (simple values)."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return None
    fm = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not mm:
            continue
        key, val = mm.group(1), mm.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        fm[key] = val
    return fm


def _tracked_files(root):
    try:
        out = subprocess.check_output(
            ["git", "-C", root, "ls-files"], text=True, stderr=subprocess.DEVNULL
        )
    except Exception:
        return None
    return [f for f in out.splitlines() if f]


def _skill_dirs(root):
    base = os.path.join(root, ".claude", "skills")
    if not os.path.isdir(base):
        return []
    return sorted(
        os.path.join(base, d)
        for d in os.listdir(base)
        if os.path.isdir(os.path.join(base, d))
    )


# --------------------------------------------------------------------------
# checkers: each returns (ok: bool, lines: list[str])
# --------------------------------------------------------------------------
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def check_skills(root):
    lines, ok = [], True
    dirs = _skill_dirs(root)
    if not dirs:
        return False, ["FAIL skills: no .claude/skills/*/ directories found"]
    for d in dirs:
        name = os.path.basename(d)
        skill_md = os.path.join(d, "SKILL.md")
        if not os.path.isfile(skill_md):
            ok = False
            lines.append(f"FAIL skills[{name}]: missing SKILL.md")
            continue
        fm = parse_frontmatter(_read(skill_md))
        if fm is None:
            ok = False
            lines.append(f"FAIL skills[{name}]: missing YAML frontmatter")
            continue
        fn = fm.get("name", "")
        desc = fm.get("description", "")
        errs = []
        if fn != name:
            errs.append(f"name '{fn}' != directory '{name}'")
        if not NAME_RE.match(fn):
            errs.append(f"name '{fn}' is not lowercase-hyphen")
        if len(fn) > 64:
            errs.append(f"name is {len(fn)} chars (>64)")
        if not desc:
            errs.append("description is empty")
        elif not desc.startswith("Use when"):
            errs.append("description must start with 'Use when'")
        elif len(desc) > 1024:
            errs.append(f"description is {len(desc)} chars (>1024)")
        if errs:
            ok = False
            lines.append(f"FAIL skills[{name}]: " + "; ".join(errs))
        else:
            lines.append(f"PASS skills[{name}]")
    return ok, lines


def check_metadata(root):
    lines, ok = [], True
    dirs = _skill_dirs(root)
    if not dirs:
        return False, ["FAIL metadata: no skills found"]
    for d in dirs:
        name = os.path.basename(d)
        yaml_path = os.path.join(d, "agents", "openai.yaml")
        if not os.path.isfile(yaml_path):
            ok = False
            lines.append(f"FAIL metadata[{name}]: missing agents/openai.yaml")
            continue
        text = _read(yaml_path)
        errs = []
        for key in ("display_name", "short_description", "default_prompt"):
            if not re.search(rf"^\s*{key}:\s*\S", text, re.M):
                errs.append(f"missing interface.{key}")
        m = re.search(r"^\s*default_prompt:\s*(.*)$", text, re.M)
        prompt = ""
        if m:
            prompt = m.group(1).strip()
            if len(prompt) >= 2 and prompt[0] == prompt[-1] and prompt[0] in "\"'":
                prompt = prompt[1:-1]
        token = f"${name}"
        if token not in prompt:
            errs.append(f"default_prompt does not mention {token}")
        if errs:
            ok = False
            lines.append(f"FAIL metadata[{name}]: " + "; ".join(errs))
        else:
            lines.append(f"PASS metadata[{name}]")
    return ok, lines


_MD_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
_CLAUDE_PATH_RE = re.compile(r"(?<![\w/])\.claude/[\w./*-]+")
_NAME_REF_RE = re.compile(r"mathodology-[a-z0-9]+(?:-[a-z0-9]+)+")


def _resolvable(root, rel):
    """True if rel exists under root, treating '*' as a glob."""
    if "*" in rel:
        import glob as _glob
        pattern = os.path.join(root, rel)
        return bool(_glob.glob(pattern, recursive=True))
    return os.path.exists(os.path.join(root, rel))


def _strip_code_fences(text):
    """Blank out lines inside ``` fenced blocks (keep line count stable).

    Path/name references are only checked in prose and inline-code, not in
    fenced command blocks -- those hold commands, regex alternations, and
    <placeholder> tokens that legitimately do not resolve.
    """
    out, in_fence = [], False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append("")
            continue
        out.append("" if in_fence else line)
    return "\n".join(out)


def check_links(root):
    lines, ok = [], True
    tracked = _tracked_files(root)
    if tracked is None:
        return False, ["FAIL links: not a git repository (git ls-files failed)"]
    md_files = [f for f in tracked if f.lower().endswith(".md")]

    # live mathodology-<x> names
    live_names = set()
    for d in _skill_dirs(root):
        live_names.add(os.path.basename(d))
    for kind in ("agents", "workflows"):
        base = os.path.join(root, ".claude", kind)
        if os.path.isdir(base):
            for f in os.listdir(base):
                if f.endswith(".md"):
                    live_names.add(f[:-3])

    problems = []
    for md in md_files:
        raw = _read(os.path.join(root, md))
        text = _strip_code_fences(raw)  # prose + inline-code only
        md_dir = os.path.dirname(md)
        # 1) relative markdown link targets
        for target in _MD_LINK_RE.findall(text):
            if target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            path = target.split("#", 1)[0].strip()
            if not path:
                continue
            rel = os.path.normpath(os.path.join(md_dir, path))
            if not _resolvable(root, rel):
                problems.append(f"{md}: broken link -> {target}")
        # 2) inline-code .claude/... path tokens
        for tok in _CLAUDE_PATH_RE.findall(text):
            tok = tok.rstrip(".,;:")
            if "..." in tok:  # template placeholder, not a literal path
                continue
            if tok.rstrip("/").startswith(IGNORED_RUNTIME_PATHS):
                continue  # intentionally-absent gitignored runtime path
            if not _resolvable(root, tok):
                problems.append(f"{md}: missing path -> {tok}")
        # 3) mathodology-<x> references
        for ref in set(_NAME_REF_RE.findall(text)):
            if ref in live_names or ref in HISTORICAL_NAMES:
                continue
            problems.append(f"{md}: unresolved name -> {ref}")

    if problems:
        ok = False
        for p in sorted(set(problems)):
            lines.append(f"FAIL links: {p}")
    else:
        lines.append(f"PASS links: {len(md_files)} markdown file(s), all references resolve")
    return ok, lines


def check_whitelist(root):
    tracked = _tracked_files(root)
    if tracked is None:
        return False, ["FAIL whitelist: not a git repository (git ls-files failed)"]
    bad = [
        f for f in tracked
        if f not in KEEP_EXACT and not f.startswith(KEEP_PREFIXES)
    ]
    if bad:
        lines = ["FAIL whitelist: unexpected tracked file(s):"]
        lines += [f"       - {f}" for f in bad]
        return False, lines
    return True, [f"PASS whitelist: {len(tracked)} tracked file(s), all inside the skills repo"]


def check_agents(root):
    lines, ok = [], True
    base = os.path.join(root, ".claude", "agents")
    if not os.path.isdir(base):
        return True, ["PASS agents: no .claude/agents/ directory (nothing to check)"]
    files = sorted(f for f in os.listdir(base) if f.endswith(".md"))
    if not files:
        return True, ["PASS agents: no agent files"]
    for f in files:
        stem = f[:-3]
        fm = parse_frontmatter(_read(os.path.join(base, f)))
        errs = []
        if fm is None:
            errs.append("missing YAML frontmatter")
        else:
            if fm.get("name", "") != stem:
                errs.append(f"name '{fm.get('name', '')}' != filename stem '{stem}'")
            if not fm.get("description", ""):
                errs.append("description is empty")
            if "tools" not in fm:
                errs.append("missing tools line")
            model = fm.get("model")
            if model is not None and model not in {"opus", "sonnet", "haiku", "inherit"}:
                errs.append(f"model '{model}' not in opus|sonnet|haiku|inherit")
        if errs:
            ok = False
            lines.append(f"FAIL agents[{stem}]: " + "; ".join(errs))
        else:
            lines.append(f"PASS agents[{stem}]")
    return ok, lines


def _has_cjk(s):
    for ch in s:
        o = ord(ch)
        if (
            0x4E00 <= o <= 0x9FFF
            or 0x3400 <= o <= 0x4DBF
            or 0x3000 <= o <= 0x30FF
            or 0xFF00 <= o <= 0xFFEF
            or 0x2E80 <= o <= 0x2EFF
        ):
            return True
    return False


def _scan_md(text):
    """Return (h2, h3, code_blocks) counting headings outside fenced blocks."""
    h2 = h3 = 0
    blocks = []
    cur = None
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            if not in_fence:
                in_fence, cur = True, []
            else:
                in_fence = False
                blocks.append(cur)
                cur = None
            continue
        if in_fence:
            cur.append(line)
            continue
        if re.match(r"^###\s", line):
            h3 += 1
        elif re.match(r"^##\s", line):
            h2 += 1
    if in_fence and cur is not None:
        blocks.append(cur)
    return h2, h3, blocks


def check_sync(root):
    lines, ok = [], True
    for en, zh in DOC_TWINS:
        en_p, zh_p = os.path.join(root, en), os.path.join(root, zh)
        if not os.path.isfile(en_p) or not os.path.isfile(zh_p):
            ok = False
            lines.append(f"FAIL sync[{en} <-> {zh}]: one or both files missing")
            continue
        h2e, h3e, be = _scan_md(_read(en_p))
        h2z, h3z, bz = _scan_md(_read(zh_p))
        errs = []
        if (h2e, h3e) != (h2z, h3z):
            errs.append(f"heading counts differ: en(##={h2e},###={h3e}) vs zh(##={h2z},###={h3z})")
        if len(be) != len(bz):
            errs.append(f"code-block counts differ: en={len(be)} vs zh={len(bz)}")
        for i in range(min(len(be), len(bz))):
            en_code = "\n".join(ln for ln in be[i] if not _has_cjk(ln))
            zh_code = "\n".join(ln for ln in bz[i] if not _has_cjk(ln))
            if en_code != zh_code:
                errs.append(f"code block #{i + 1} differs after dropping CJK lines")
        if errs:
            ok = False
            lines.append(f"FAIL sync[{en} <-> {zh}]:")
            lines += [f"       - {e}" for e in errs]
        else:
            lines.append(f"PASS sync[{en} <-> {zh}]")
    return ok, lines


CHECKS = {
    "skills": check_skills,
    "metadata": check_metadata,
    "links": check_links,
    "whitelist": check_whitelist,
    "agents": check_agents,
    "sync": check_sync,
}
ALL_ORDER = ["skills", "metadata", "links", "whitelist", "agents", "sync"]


# --------------------------------------------------------------------------
# selftest: build minimal pass/fail trees and prove each checker discriminates
# --------------------------------------------------------------------------
def _mk(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def _git_init(root):
    subprocess.run(["git", "-C", root, "init", "-q"], check=True)
    subprocess.run(["git", "-C", root, "add", "-A"], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _good_skill(root, name="mathodology-demo"):
    d = os.path.join(root, ".claude", "skills", name)
    _mk(os.path.join(d, "SKILL.md"),
        f"---\nname: {name}\ndescription: Use when demoing the validator.\n---\n\n# Demo\n")
    _mk(os.path.join(d, "agents", "openai.yaml"),
        "interface:\n"
        '  display_name: "Demo"\n'
        '  short_description: "demo"\n'
        f'  default_prompt: "Use ${name} to demo."\n')


def _good_agent(root, name="mathodology-demo-agent"):
    _mk(os.path.join(root, ".claude", "agents", f"{name}.md"),
        f"---\nname: {name}\ndescription: Demo agent.\ntools: Read, Write\nmodel: opus\n---\n\n# A\n")


def _selftest():
    import tempfile
    import shutil

    ok = True

    def expect(label, fn, root, want_pass):
        nonlocal ok
        got, _ = fn(root)
        if got == want_pass:
            print(f"PASS selftest[{label}] -> {'pass' if got else 'fail'} as expected")
        else:
            ok = False
            print(f"FAIL selftest[{label}] -> got {'pass' if got else 'fail'}, "
                  f"expected {'pass' if want_pass else 'fail'}")

    # skills + metadata
    t = tempfile.mkdtemp()
    _good_skill(t)
    expect("skills-pass", check_skills, t, True)
    expect("metadata-pass", check_metadata, t, True)
    shutil.rmtree(t, ignore_errors=True)

    t = tempfile.mkdtemp()
    d = os.path.join(t, ".claude", "skills", "mathodology-demo")
    _mk(os.path.join(d, "SKILL.md"),
        "---\nname: wrong-name\ndescription: lacks the required prefix.\n---\n")
    _mk(os.path.join(d, "agents", "openai.yaml"),
        'interface:\n  display_name: "x"\n  short_description: "x"\n  default_prompt: "no token"\n')
    expect("skills-fail", check_skills, t, False)
    expect("metadata-fail", check_metadata, t, False)
    shutil.rmtree(t, ignore_errors=True)

    # agents
    t = tempfile.mkdtemp()
    _good_agent(t)
    expect("agents-pass", check_agents, t, True)
    _mk(os.path.join(t, ".claude", "agents", "mathodology-bad.md"),
        "---\nname: mismatch\ndescription: \nmodel: gpt\n---\n")
    expect("agents-fail", check_agents, t, False)
    shutil.rmtree(t, ignore_errors=True)

    # whitelist (needs git)
    t = tempfile.mkdtemp()
    _good_skill(t)
    _mk(os.path.join(t, "README.md"), "# ok\n")
    _git_init(t)
    expect("whitelist-pass", check_whitelist, t, True)
    _mk(os.path.join(t, "src", "app.py"), "print(1)\n")
    _git_init(t)
    expect("whitelist-fail", check_whitelist, t, False)
    shutil.rmtree(t, ignore_errors=True)

    # links (needs git for tracked *.md)
    t = tempfile.mkdtemp()
    _good_skill(t, "mathodology-demo")
    _mk(os.path.join(t, "docs", "OK.md"),
        "See `.claude/skills/mathodology-demo/SKILL.md` and load mathodology-demo.\n")
    _git_init(t)
    expect("links-pass", check_links, t, True)
    _mk(os.path.join(t, "docs", "BAD.md"),
        "See `.claude/skills/mathodology-missing/SKILL.md` and load mathodology-ghost.\n")
    _git_init(t)
    expect("links-fail", check_links, t, False)
    shutil.rmtree(t, ignore_errors=True)

    # sync
    t = tempfile.mkdtemp()
    en = "## H\n\n```bash\nls -la\n```\n"
    zh = "## 标题\n\n```bash\n# 列出文件\nls -la\n```\n"
    _mk(os.path.join(t, "docs", "SKILLS.md"), en)
    _mk(os.path.join(t, "docs", "SKILLS_zh.md"), zh)
    # neutralise the other twins so they don't interfere
    for a, b in DOC_TWINS[1:]:
        _mk(os.path.join(t, a), "## X\n")
        _mk(os.path.join(t, b), "## X\n")
    expect("sync-pass", check_sync, t, True)
    _mk(os.path.join(t, "docs", "SKILLS_zh.md"), "## 标题\n\n```bash\nls -R\n```\n")
    expect("sync-fail", check_sync, t, False)
    shutil.rmtree(t, ignore_errors=True)

    print("validate_repo selftest:", "OK" if ok else "FAILED")
    return 0 if ok else 1


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------
def run(subcommand, root):
    if subcommand == "selftest":
        return _selftest()
    if subcommand == "all":
        names = ALL_ORDER
    elif subcommand in CHECKS:
        names = [subcommand]
    else:
        print(f"validate_repo: unknown subcommand '{subcommand}'", file=sys.stderr)
        print(f"  choose from: {', '.join(ALL_ORDER + ['selftest', 'all'])}", file=sys.stderr)
        return 2

    overall = 0
    for name in names:
        ok, lines = CHECKS[name](root)
        print(f"== {name} ==")
        for line in lines:
            print(line)
        if not ok:
            overall = 1
        print()
    print("validate_repo:", "OK" if overall == 0 else "FAILED")
    return overall


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    sub = argv[0] if argv else "all"
    if sub in ("-h", "--help"):
        print(__doc__)
        return 0
    root = os.environ.get("VALIDATE_REPO_ROOT", os.getcwd())
    return run(sub, root)


if __name__ == "__main__":
    raise SystemExit(main())
