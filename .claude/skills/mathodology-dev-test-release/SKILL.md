---
name: mathodology-dev-test-release
description: Use when validating the Mathodology skills-only repository or preserving archived knowledge about the former development, testing, deployment, packaging, and release workflows.
---

# Mathodology Dev Test Release Archive

## Scope

This branch is skills-only. Its active validation checks are skill, metadata, link, backup, and tracked-file whitelist checks.

The former application build, CI, Docker, native service, packaging, installer, and release files are not present on this branch. Treat those workflows as archived knowledge unless recovered from Git history.

## Active Validation

Validate all project skills:

```bash
for d in .claude/skills/*; do
  python3 /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"
done
```

Validate metadata:

```bash
python3 - <<'PY'
from pathlib import Path
import re
import yaml

root = Path(".claude/skills")
skills = sorted(p for p in root.iterdir() if p.is_dir())
assert skills, "no skills found"
for d in skills:
    text = (d / "SKILL.md").read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    assert match, d
    frontmatter = yaml.safe_load(match.group(1))
    assert frontmatter["name"] == d.name, d
    assert frontmatter["description"].startswith("Use when"), d
    metadata = yaml.safe_load((d / "agents" / "openai.yaml").read_text(encoding="utf-8"))
    assert f"${d.name}" in metadata["interface"]["default_prompt"], d
print("skills metadata ok")
PY
```

Validate local markdown links:

```bash
python3 - <<'PY'
from pathlib import Path
import re
import sys

files = [
    Path("README.md"),
    Path("README_zh.md"),
    Path("docs/SKILLS.md"),
    Path("docs/SKILLS_zh.md"),
    Path("docs/BACKUP.md"),
    Path("AGENTS.md"),
]
errors = []
for f in files:
    text = f.read_text(encoding="utf-8")
    for m in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", text):
        target = m.group(1)
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        path = target.split("#", 1)[0]
        if path and not (f.parent / path).exists():
            errors.append(f"{f}: missing link {target}")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print("markdown local links ok")
PY
```

Validate tracked files:

```bash
python3 - <<'PY'
import subprocess
import sys

keep_exact = {
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "README_zh.md",
    "LICENSE",
    "docs/SKILLS.md",
    "docs/SKILLS_zh.md",
    "docs/BACKUP.md",
}
files = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
bad = [f for f in files if f not in keep_exact and not f.startswith(".claude/skills/")]
if bad:
    print("\n".join(bad))
    sys.exit(1)
print(f"tracked whitelist ok: {len(files)} files")
PY
```

## Backup Check

Create and verify a skills-only backup:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

Then check the printed backup directory:

```bash
shasum -a 256 -c SHA256SUMS
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(AGENTS.md|\\.claude/skills/)'
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(apps/|crates/|packages/|scripts/|config/|installer/|tests/|data/|\\.github/)'
```

The last command should produce no matches.

## Archived Dev And Release Knowledge

The former project used a multi-language application stack with service builds, contract generation, tests, deployment files, and release packaging. Those files were removed from the current branch.

If the user needs to rebuild or audit those workflows, first recover the relevant historical tree in a separate branch or worktree. Do not treat old commands as valid gates in the skills-only checkout.
