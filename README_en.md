# Mathodology Math Modeling Contest Skills

[简体中文](./README.md) · **English**

![license](https://img.shields.io/badge/license-MIT-blue)
![format](https://img.shields.io/badge/format-Agent%20Skills-black)
![tools](https://img.shields.io/badge/tools-Claude%20Code%20%7C%20Codex-blue)
![contests](https://img.shields.io/badge/contests-MCM%2FICM%20%7C%20CUMCM%20%7C%20Huashu%20Cup-orange)

Mathodology is a set of **Agent Skills purpose-built for math modeling contests**, targeting Claude Code, Codex, and other Agent Skills-compatible AI coding tools. It distills an award-level math modeling methodology — problem decomposition, model building, reproducible experiments, award-grade paper writing, and submission packaging — into loadable project skills, subagents, and workflow templates.

Supported contest types:

- **MCM/ICM**: targeting Outstanding/Finalist-level output
- **CUMCM (China Undergraduate Mathematical Contest in Modeling)**: targeting national-first-prize-level output
- **Huashu Cup**, **M3**, **HiMCM/MidMCM**, **IMMC/IM2C**
- Leaderboard/data-science, operations/policy/business-case, and short-sprint contests

This repository is a skills-only branch: it intentionally does not ship the former runnable application source. It contains only project skills, skill metadata, lightweight documentation, a backup helper, and the license.

## What This Repository Contains

- Claude Code project skills in `.claude/skills/<skill-name>/SKILL.md`
- Claude Code project subagents in `.claude/agents/` (modeler, coder, paper editor, critic, and other specialist roles)
- Claude Code contest workflow templates in `.claude/workflows/`
- Codex-style metadata in each skill's `agents/openai.yaml`
- A root `AGENTS.md` entrypoint for tools that do not auto-discover project skills
- Skills and workflow documentation under `docs/`
- A skills-only backup script under `mathodology-whole-project`

No application source, CI workflows, deployment files, generated contracts, package lockfiles, datasets, build outputs, or installer assets are kept on this branch.

## One-Command Install And Update

Install all Mathodology skills globally for Codex and Claude Code:

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

Update installed Mathodology skills:

```bash
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

If you use this repository checkout for Claude Code project subagents and workflow templates, run the full one-command updater from the checkout:

```bash
git pull --ff-only && npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

This uses the open `skills` CLI from `vercel-labs/skills`, which installs Agent Skills from GitHub into the right agent directories.

Restart Codex or Claude Code after installation or update so the new skills, subagents, and workflow templates are discovered. Use `npx -y skills@latest --help` for CLI help; avoid `skills add <repo> --help`, because current CLI versions may treat that as an install command.

See [docs/INSTALL.md](docs/INSTALL.md) for target-specific commands and verification.

## Codex And Claude Code Modes

Mathodology ships separate contest orchestration guidance for Codex and Claude Code:

- Claude Code: use `.claude/workflows/mathodology-award-submission.md` with project subagents in `.claude/agents/`.
- Claude Code contest variants: use `.claude/workflows/mathodology-contest-variants.md` for M3, HiMCM/MidMCM, IMMC/IM2C, leaderboard/data-science, operations/policy/business-case, and short-sprint contests.
- Codex: load `mathodology-whole-project` and run the 9-phase workflow in multi-agents mode.

Both modes target national-first-prize or MCM/ICM O-prize level outputs: model alternatives, evidence-backed assumptions, reproducible experiments, polished paper, and a complete submission package. The workflow adapters tune those gates for paper-first, code-first, sprint, school-age, and policy/business-case contests.

See [docs/WORKFLOWS.md](docs/WORKFLOWS.md) for the full phase model.

## Skill Index

| Skill | Use When |
|---|---|
| [`mathodology-whole-project`](.claude/skills/mathodology-whole-project/SKILL.md) | Backing up, transferring, restoring, orienting, or running Codex/Claude Code contest workflow orchestration |
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

Then load `mathodology-whole-project` for full-project context, or load the most specific skill for the task. Once you have a contest problem, run the phase workflow from [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

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

Keep this branch focused on math modeling contest skills. Do not add back app source trees, generated clients, CI workflows, Docker files, installers, datasets, or build outputs unless the repository strategy changes explicitly.

Historical application implementation can be recovered from Git history if needed; it is not part of the current GitHub tree.

## License

MIT. See [LICENSE](LICENSE).
