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
    sync        en/zh doc twins agree on heading + code-block counts, and the
                command-significant code (comments stripped) is identical.
    evidence    search MCP download config, dual-source agent/skill contract,
                workflow guidance, and manual install commands.
    updater     canonical transactional updater and synchronized distribution guidance.
    selftest    construct pass/fail fixtures and run shipped updater self-tests.
    all         run skills, metadata, links, whitelist, agents, sync, evidence, updater.

Exit status is non-zero if any run check fails.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys

# --------------------------------------------------------------------------
# whitelist definition (shared with the backup script's intent)
# --------------------------------------------------------------------------
KEEP_EXACT = {
    ".gitignore",
    ".mcp.json",
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
    "docs/BACKUP_zh.md",
}
KEEP_PREFIXES = (".claude/skills/", ".claude/agents/", ".claude/workflows/")

DOC_TWINS = [
    ("docs/SKILLS.md", "docs/SKILLS_zh.md"),
    ("docs/INSTALL.md", "docs/INSTALL_zh.md"),
    ("docs/WORKFLOWS.md", "docs/WORKFLOWS_zh.md"),
    ("docs/BACKUP.md", "docs/BACKUP_zh.md"),
    ("README_en.md", "README.md"),
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
        # normalize keys to lowercase so a case-variant (e.g. 'Model:') cannot
        # slip past a lookup that expects the canonical lowercase key.
        key, val = mm.group(1).lower(), mm.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        fm[key] = val
    return fm


def _frontmatter_tokens(value):
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return {
        token.strip().strip("\"'")
        for token in value.split(",")
        if token.strip().strip("\"'")
    }


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


_INLINE_COMMENT_RE = re.compile(r"\s#\s.*$")


def _code_signif(block_lines):
    """Reduce a fenced block to its command-significant content.

    Drops full-line comments and strips ' # ...' inline-comment tails, so a
    *translated* comment (the only place CJK should appear in a shared command
    block) is ignored, while a divergent COMMAND -- even one hidden behind a
    CJK comment on the same line -- still shows up as a difference. This is
    stricter than dropping the whole CJK line, which masked such divergences.
    """
    out = []
    for ln in block_lines:
        if ln.strip().startswith("#"):
            continue  # full-line comment (may be a translated note)
        m = _INLINE_COMMENT_RE.search(ln)
        code = (ln[:m.start()] if m else ln).rstrip()
        if code:
            out.append(code)
    return "\n".join(out)


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
            if _code_signif(be[i]) != _code_signif(bz[i]):
                errs.append(f"code block #{i + 1} commands differ (comments ignored)")
        if errs:
            ok = False
            lines.append(f"FAIL sync[{en} <-> {zh}]:")
            lines += [f"       - {e}" for e in errs]
        else:
            lines.append(f"PASS sync[{en} <-> {zh}]")
    return ok, lines


UPDATER_REL = ".claude/skills/mathodology-whole-project/scripts/update-project.py"
UPDATER_DOCS = (
    "README.md",
    "README_en.md",
    "docs/INSTALL.md",
    "docs/INSTALL_zh.md",
    ".claude/skills/mathodology-whole-project/SKILL.md",
)
UPDATER_BOOTSTRAP = (
    'curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/'
    + UPDATER_REL
    + ' -o /tmp/mathodology-update.py && test -s /tmp/mathodology-update.py && '
    + 'python3 /tmp/mathodology-update.py --project .'
)
GLOBAL_RECONCILE = (
    "npx -y skills@latest add sweetcornna/mathodology --global --copy --yes "
    "--skill '*' --agent codex claude-code"
)


def check_updater(root):
    errors = []
    updater = os.path.join(root, UPDATER_REL)
    if not os.path.isfile(updater):
        errors.append(f"missing canonical updater: {UPDATER_REL}")
    else:
        if not os.access(updater, os.X_OK):
            errors.append(f"canonical updater is not executable: {UPDATER_REL}")
        try:
            text = _read(updater)
            for token in (
                "--project",
                "--ref",
                "--check",
                "--self-test",
                "skills@latest",
                '"add"',
                '"*"',
                "transaction-rollback",
                "DOWNLOAD_ENV",
            ):
                if token not in text:
                    errors.append(f"canonical updater missing contract token: {token}")
        except OSError as exc:
            errors.append(f"cannot read canonical updater: {exc}")

    legacy_tokens = (
        "skills@latest update --project",
        "archive/refs/heads/main.tar.gz | tar -xz --strip-components=1",
        "uvx free-search-mcp@latest --help >/dev/null",
        "skills@latest update --global --yes mathodology-",
    )
    # README and docs/ ship with the repository, not with an installed skill
    # tree. Outside a repo checkout their absence means "nothing to check" rather
    # than a broken repo; the SKILL.md entry travels with the skill either way.
    in_repo_checkout = os.path.isfile(os.path.join(root, "README.md"))
    for rel in UPDATER_DOCS:
        if not in_repo_checkout and not rel.startswith(".claude/"):
            continue
        path = os.path.join(root, rel)
        try:
            text = _read(path)
        except OSError as exc:
            errors.append(f"cannot read updater guidance {rel}: {exc}")
            continue
        if UPDATER_BOOTSTRAP not in text:
            errors.append(f"{rel} missing canonical updater bootstrap")
        if GLOBAL_RECONCILE not in text:
            errors.append(f"{rel} missing wildcard global reconciliation command")
        for token in legacy_tokens:
            if token in text:
                errors.append(f"{rel} retains legacy updater guidance: {token}")

    if not errors:
        try:
            completed = subprocess.run(
                [sys.executable, updater, "--self-test"],
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"canonical updater self-test could not complete: {exc}")
        else:
            if completed.returncode != 0:
                detail = completed.stdout.strip() or completed.stderr.strip()
                errors.append(
                    "canonical updater self-test failed"
                    + (f": {detail}" if detail else "")
                )

    if errors:
        return False, ["FAIL updater: " + error for error in errors]
    return True, [
        "PASS updater[canonical-executable]",
        "PASS updater[synchronized-bootstrap]",
        "PASS updater[global-reconciliation]",
        "PASS updater[legacy-pipeline-removed]",
        "PASS updater[behavioral-self-test]",
    ]


def check_evidence(root):
    lines, errors = [], []

    mcp_path = os.path.join(root, ".mcp.json")
    try:
        with open(mcp_path, "r", encoding="utf-8") as fh:
            mcp = json.load(fh)
        search = mcp.get("mcpServers", {}).get("search", {})
        if search.get("command") != "uvx":
            errors.append(".mcp.json search command must be uvx")
        if search.get("args") != ["free-search-mcp"]:
            errors.append(".mcp.json search args must equal ['free-search-mcp']")
        download_dir = search.get("env", {}).get("SEARCH_MCP_DOWNLOAD_DIR")
        if not isinstance(download_dir, str) or not download_dir.strip():
            errors.append(".mcp.json must set non-empty SEARCH_MCP_DOWNLOAD_DIR")
    except (OSError, ValueError, TypeError) as exc:
        errors.append(f".mcp.json is missing or invalid JSON: {exc}")

    agent_path = os.path.join(
        root, ".claude", "agents", "mathodology-evidence-researcher.md"
    )
    skill_path = os.path.join(
        root, ".claude", "skills", "mathodology-evidence-search", "SKILL.md"
    )
    workflow_path = os.path.join(
        root, ".claude", "workflows", "mathodology-award-submission.md"
    )
    try:
        agent_text = _read(agent_path)
        fm = parse_frontmatter(agent_text) or {}
        skills = _frontmatter_tokens(fm.get("skills", ""))
        tools = _frontmatter_tokens(fm.get("tools", ""))
        if "mathodology-evidence-search" not in skills:
            errors.append("evidence researcher must load mathodology-evidence-search")
        for tool in (
            "WebSearch", "WebFetch", "mcp__search__search", "mcp__search__download"
        ):
            if tool not in tools:
                errors.append(f"evidence researcher tools missing {tool}")
        skill_text = _read(skill_path)
        workflow_text = _read(workflow_path)
        contract_assertions = (
            "dual-source-default: WebSearch + mcp__search__search",
            "single-source-mode: explicit degradation",
            "search_backend: combined",
        )
        for label, text in (
            ("evidence skill", skill_text),
            ("evidence researcher", agent_text),
            ("award workflow", workflow_text),
        ):
            for assertion in contract_assertions:
                if assertion not in text:
                    errors.append(
                        f"{label} missing evidence contract assertion: {assertion}"
                    )
        old_phrases = (
            "use them as the primary path",
            "fall back to `WebSearch`/`WebFetch`",
            "WebSearch`/`WebFetch` as the declared fallback",
        )
        for label, text in (
            ("evidence skill", skill_text),
            ("evidence researcher", agent_text),
            ("award workflow", workflow_text),
        ):
            for phrase in old_phrases:
                if phrase in text:
                    errors.append(f"{label} retains old fallback contract: {phrase}")
            for line in text.splitlines():
                normalized = " ".join(line.lower().split())
                has_mcp = "mcp" in normalized
                has_builtin = "websearch" in normalized or "built-in search" in normalized
                if "fallback" in normalized or "fall back" in normalized:
                    errors.append(f"{label} contains a fallback-first search directive")
                    break
                if (
                    has_mcp
                    and re.search(r"\b(?:primary|prefer|preferred)\b", normalized)
                    and re.search(r"\b(?:discovery|search|channel|path)\b", normalized)
                ):
                    errors.append(f"{label} makes MCP a preferred discovery backend")
                    break
                if (
                    has_mcp
                    and has_builtin
                    and re.search(r"\b(?:only if|only when|unless)\b", normalized)
                ):
                    errors.append(f"{label} conditionally suppresses one search backend")
                    break
            else:
                normalized_lines = []
                for line in text.splitlines():
                    normalized = " ".join(line.lower().split())
                    normalized = re.sub(r"^(?:>\s*)+", "", normalized)
                    normalized = re.sub(
                        r"^(?:(?:[-*+]|\d+[.)])\s+)+(?:\[[ x]\]\s+)?",
                        "",
                        normalized,
                    )
                    normalized_lines.append(normalized)
                start_with_mcp = re.compile(
                    r"^(?:start|begin|first|try)\b.{0,100}\bmcp\b"
                )
                switch_to_builtin = re.compile(
                    r"^(?:[-*]\s+)?(?:if|when)\b.{0,60}"
                    r"\b(?:it|mcp)\b.{0,40}"
                    r"\b(?:unavailable|fails?|failure|not available)\b.{0,80}"
                    r"\b(?:use|invoke|search)\b.{0,40}"
                    r"(?:websearch|built-in(?: web)? search)"
                )
                for first, second in zip(normalized_lines, normalized_lines[1:]):
                    if start_with_mcp.search(first) and switch_to_builtin.search(second):
                        errors.append(
                            f"{label} conditionally switches from MCP to built-in search"
                        )
                        break
    except OSError as exc:
        errors.append(f"evidence contract file missing: {exc}")

    command_tokens = (
        "claude mcp add --transport stdio --env "
        '"SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" '
        "search -- uvx free-search-mcp",
        "codex mcp add --env "
        '"SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" '
        "search -- uvx free-search-mcp",
    )
    for rel in (
        ".claude/skills/mathodology-evidence-search/SKILL.md",
        "docs/INSTALL.md",
        "docs/INSTALL_zh.md",
    ):
        try:
            text = _read(os.path.join(root, rel))
            for command in command_tokens:
                if command not in text:
                    errors.append(f"{rel} missing download-enabled command: {command}")
        except OSError as exc:
            errors.append(f"{rel} missing: {exc}")

    if errors:
        return False, ["FAIL evidence: " + error for error in errors]
    lines.append("PASS evidence[search-mcp-download-config]")
    lines.append("PASS evidence[dual-source-agent-contract]")
    lines.append("PASS evidence[manual-install-commands]")
    return True, lines


CHECKS = {
    "skills": check_skills,
    "metadata": check_metadata,
    "links": check_links,
    "whitelist": check_whitelist,
    "agents": check_agents,
    "sync": check_sync,
    "evidence": check_evidence,
    "updater": check_updater,
}
ALL_ORDER = [
    "skills",
    "metadata",
    "links",
    "whitelist",
    "agents",
    "sync",
    "evidence",
    "updater",
]


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


def _good_evidence_tree(root):
    contract = (
        "dual-source-default: WebSearch + mcp__search__search\n"
        "single-source-mode: explicit degradation\n"
        "search_backend: combined\n"
    )
    agent = (
        "---\n"
        "name: mathodology-evidence-researcher\n"
        "description: Demo evidence agent.\n"
        "tools: Read, WebSearch, WebFetch, mcp__search__search, mcp__search__download\n"
        "skills: [mathodology-evidence-search]\n"
        "---\n\n" + contract
    )
    _mk(os.path.join(root, ".claude", "agents", "mathodology-evidence-researcher.md"),
        agent)
    commands = (
        'claude mcp add --transport stdio --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp\n'
        'codex mcp add --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp\n'
    )
    _mk(os.path.join(root, ".claude", "skills", "mathodology-evidence-search", "SKILL.md"),
        contract + commands)
    _mk(os.path.join(root, ".claude", "workflows", "mathodology-award-submission.md"),
        contract)
    mcp = {
        "mcpServers": {
            "search": {
                "command": "uvx",
                "args": ["free-search-mcp"],
                "env": {"SEARCH_MCP_DOWNLOAD_DIR": "~/.cache/search-mcp/downloads"},
            }
        }
    }
    _mk(os.path.join(root, ".mcp.json"), json.dumps(mcp))
    _mk(os.path.join(root, "docs", "INSTALL.md"), commands)
    _mk(os.path.join(root, "docs", "INSTALL_zh.md"), commands)


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

    # agents: a case-variant 'Model:' key must not bypass the enum
    t = tempfile.mkdtemp()
    _mk(os.path.join(t, ".claude", "agents", "mathodology-case.md"),
        "---\nname: mathodology-case\ndescription: x\ntools: Read\nModel: gpt\n---\n")
    expect("agents-fail(case-variant-model)", check_agents, t, False)
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
    # a purely translated inline comment must still PASS
    _mk(os.path.join(t, "docs", "SKILLS.md"), "## H\n\n```bash\nls -la  # list files\n```\n")
    _mk(os.path.join(t, "docs", "SKILLS_zh.md"), "## 标题\n\n```bash\nls -la  # 列出文件\n```\n")
    expect("sync-pass(translated-inline-comment)", check_sync, t, True)
    # a divergent command hidden behind a translated comment must FAIL
    _mk(os.path.join(t, "docs", "SKILLS.md"), "## H\n\n```bash\nls -la  # list files\n```\n")
    _mk(os.path.join(t, "docs", "SKILLS_zh.md"), "## 标题\n\n```bash\nls -R  # 列出文件\n```\n")
    expect("sync-fail(command-behind-cjk-comment)", check_sync, t, False)
    shutil.rmtree(t, ignore_errors=True)

    # evidence contract
    t = tempfile.mkdtemp()
    _good_evidence_tree(t)
    expect("evidence-pass", check_evidence, t, True)
    mcp = json.loads(_read(os.path.join(t, ".mcp.json")))
    del mcp["mcpServers"]["search"]["env"]["SEARCH_MCP_DOWNLOAD_DIR"]
    _mk(os.path.join(t, ".mcp.json"), json.dumps(mcp))
    expect("evidence-fail(missing-download-env)", check_evidence, t, False)
    _good_evidence_tree(t)
    agent_path = os.path.join(t, ".claude", "agents", "mathodology-evidence-researcher.md")
    _mk(agent_path, _read(agent_path).replace("mcp__search__download", ""))
    expect("evidence-fail(missing-agent-tool)", check_evidence, t, False)
    _good_evidence_tree(t)
    agent_text = _read(agent_path).replace(
        "skills: [mathodology-evidence-search]",
        "skills: [not-mathodology-evidence-search-suffix]",
    ).replace(
        "tools: Read, WebSearch, WebFetch, mcp__search__search, mcp__search__download",
        "tools: Read, NotWebSearch, NotWebFetch, "
        "xmcp__search__searchx, xmcp__search__downloadx",
    )
    _mk(agent_path, agent_text)
    expect("evidence-fail(frontmatter-substring-bypass)", check_evidence, t, False)
    _good_evidence_tree(t)
    workflow_path = os.path.join(t, ".claude", "workflows", "mathodology-award-submission.md")
    _mk(workflow_path, "use them as the primary path\n")
    expect("evidence-fail(old-fallback-contract)", check_evidence, t, False)
    _good_evidence_tree(t)
    fallback_text = _read(workflow_path) + (
        "Prefer MCP discovery and use built-in search only when MCP is unavailable.\n"
    )
    _mk(workflow_path, fallback_text)
    expect("evidence-fail(paraphrased-fallback-contract)", check_evidence, t, False)
    _good_evidence_tree(t)
    fallback_text = _read(workflow_path) + (
        "Make MCP the primary discovery channel; invoke WebSearch only if MCP fails.\n"
    )
    _mk(workflow_path, fallback_text)
    expect("evidence-fail(primary-only-if-contract)", check_evidence, t, False)
    _good_evidence_tree(t)
    fallback_text = _read(workflow_path) + (
        "The MCP server is the primary discovery path. "
        "Use WebSearch as a fallback if MCP is unavailable.\n"
    )
    _mk(workflow_path, fallback_text)
    expect("evidence-fail(primary-fallback-contract)", check_evidence, t, False)
    _good_evidence_tree(t)
    fallback_text = _read(workflow_path) + (
        "Start with MCP search.\nIf it is unavailable, use WebSearch.\n"
    )
    _mk(workflow_path, fallback_text)
    expect("evidence-fail(two-line-fallback-contract)", check_evidence, t, False)
    _good_evidence_tree(t)
    fallback_text = _read(workflow_path) + (
        "1. Start with MCP search.\n2. If it is unavailable, use WebSearch.\n"
    )
    _mk(workflow_path, fallback_text)
    expect("evidence-fail(numbered-fallback-contract)", check_evidence, t, False)
    _good_evidence_tree(t)
    install_path = os.path.join(t, "docs", "INSTALL_zh.md")
    _mk(install_path, _read(install_path).replace("SEARCH_MCP_DOWNLOAD_DIR", "DOWNLOAD_DIR"))
    expect("evidence-fail(manual-command)", check_evidence, t, False)
    _good_evidence_tree(t)
    skill_path = os.path.join(
        t, ".claude", "skills", "mathodology-evidence-search", "SKILL.md"
    )
    _mk(skill_path, _read(skill_path).replace("codex mcp add", "codex mcp missing"))
    expect("evidence-fail(skill-manual-command)", check_evidence, t, False)
    shutil.rmtree(t, ignore_errors=True)

    updater = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "mathodology-whole-project",
            "scripts",
            "update-project.py",
        )
    )
    t = tempfile.mkdtemp()
    fixture_updater = os.path.join(t, UPDATER_REL)
    os.makedirs(os.path.dirname(fixture_updater), exist_ok=True)
    shutil.copy2(updater, fixture_updater)
    os.chmod(fixture_updater, 0o755)
    valid_updater_guidance = UPDATER_BOOTSTRAP + "\n" + GLOBAL_RECONCILE + "\n"
    for rel in UPDATER_DOCS:
        _mk(os.path.join(t, rel), valid_updater_guidance)
    expect("updater-pass", check_updater, t, True)
    readme = os.path.join(t, "README.md")
    _mk(readme, valid_updater_guidance + "npx -y skills@latest update --project --yes\n")
    expect("updater-fail(legacy-update-pipeline)", check_updater, t, False)
    _mk(
        readme,
        valid_updater_guidance
        + "curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1\n",
    )
    expect("updater-fail(legacy-install-pipeline)", check_updater, t, False)
    _mk(
        readme,
        valid_updater_guidance
        + "npx -y skills@latest update --global --yes mathodology-whole-project mathodology-evidence-search\n",
    )
    expect("updater-fail(hardcoded-global-update)", check_updater, t, False)
    _mk(readme, UPDATER_BOOTSTRAP + "\n")
    expect("updater-fail(missing-global-reconciliation)", check_updater, t, False)
    shutil.rmtree(t, ignore_errors=True)

    # An installed skill tree carries .claude/ but none of the repository docs;
    # the gate must still run there instead of failing on the absent files.
    t = tempfile.mkdtemp()
    fixture_updater = os.path.join(t, UPDATER_REL)
    os.makedirs(os.path.dirname(fixture_updater), exist_ok=True)
    shutil.copy2(updater, fixture_updater)
    os.chmod(fixture_updater, 0o755)
    for rel in UPDATER_DOCS:
        if rel.startswith(".claude/"):
            _mk(os.path.join(t, rel), valid_updater_guidance)
    expect("updater-pass(installed-skill-tree-without-repo-docs)", check_updater, t, True)
    _mk(
        os.path.join(t, ".claude/skills/mathodology-whole-project/SKILL.md"),
        UPDATER_BOOTSTRAP + "\n",
    )
    expect("updater-fail(installed-skill-md-drift)", check_updater, t, False)
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
