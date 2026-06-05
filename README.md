# Mathodology Skills

**English** · [简体中文](./README_zh.md)

![license](https://img.shields.io/badge/license-MIT-blue)
![format](https://img.shields.io/badge/format-Agent%20Skills-black)
![tools](https://img.shields.io/badge/tools-Claude%20Code%20%7C%20Codex-blue)

Mathodology is now a skills-only repository for AI coding tools such as Claude Code, Codex, and other Agent Skills-compatible agents.

This branch intentionally does not ship the former runnable application source. The GitHub repository now contains only project skills, skill metadata, lightweight documentation, a backup helper, and the license.

## What This Repository Contains

- Claude Code project skills in `.claude/skills/<skill-name>/SKILL.md`
- Codex-style metadata in each skill's `agents/openai.yaml`
- A root `AGENTS.md` entrypoint for tools that do not auto-discover project skills
- Skills documentation under `docs/`
- A skills-only backup script under `mathodology-whole-project`

No application source, CI workflows, deployment files, generated contracts, package lockfiles, datasets, build outputs, or installer assets are kept on this branch.

## Skill Index

| Skill | Use When |
|---|---|
| [`mathodology-whole-project`](.claude/skills/mathodology-whole-project/SKILL.md) | Backing up, transferring, restoring, or orienting on the whole skills repository |
| [`mathodology-project-orientation`](.claude/skills/mathodology-project-orientation/SKILL.md) | Starting work in this skills-only checkout or verifying repository boundaries |
| [`mathodology-agent-pipeline`](.claude/skills/mathodology-agent-pipeline/SKILL.md) | Maintaining archived knowledge about the former agent pipeline |
| [`mathodology-gateway-api`](.claude/skills/mathodology-gateway-api/SKILL.md) | Maintaining archived knowledge about the former gateway and API |
| [`mathodology-web-ui`](.claude/skills/mathodology-web-ui/SKILL.md) | Maintaining archived knowledge about the former web UI |
| [`mathodology-dev-test-release`](.claude/skills/mathodology-dev-test-release/SKILL.md) | Validating the skills repository or preserving archived dev, test, and release guidance |
| [`mathodology-skill-authoring`](.claude/skills/mathodology-skill-authoring/SKILL.md) | Adding, updating, validating, or reviewing project skills |

## Quick Start

Clone the repository:

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

For Claude Code, open this repository and load skills from:

```text
.claude/skills/
```

For Codex or other AI coding tools, start from:

```text
AGENTS.md
```

Then load `mathodology-whole-project` for full-project context, or load the most specific skill for the task.

## Backup and Transfer

Create a skills-only backup:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

The backup is written outside the repository by default:

```text
../mathodology_skills_backups/<timestamp>/mathodology-skills-<timestamp>.tar.gz
```

The archive uses a skills whitelist, so it includes only the retained skills repository files. It excludes `.git/`, secrets, build outputs, runtime state, and any old application directories that may still exist locally.

See [docs/BACKUP.md](docs/BACKUP.md) for restore details.

## Validation

Validate all project skills:

```bash
for d in .claude/skills/*; do
  python3 /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"
done
```

Check metadata and directory consistency:

```bash
python3 - <<'PY'
from pathlib import Path
import re
import yaml

root = Path(".claude/skills")
for d in sorted(p for p in root.iterdir() if p.is_dir()):
    text = (d / "SKILL.md").read_text(encoding="utf-8")
    frontmatter = yaml.safe_load(re.match(r"^---\n(.*?)\n---\n", text, re.S).group(1))
    assert frontmatter["name"] == d.name
    assert frontmatter["description"].startswith("Use when")
    assert (d / "agents" / "openai.yaml").exists()
print("skills ok")
PY
```

## Repository Policy

Keep this branch focused on skills. Do not add back app source trees, generated clients, CI workflows, Docker files, installers, datasets, or build outputs unless the repository strategy changes explicitly.

Historical application implementation can be recovered from Git history if needed; it is not part of the current GitHub tree.

## License

MIT. See [LICENSE](LICENSE).
