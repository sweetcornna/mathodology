# Mathodology Skills

**English** · [简体中文](./README_zh.md)

![license](https://img.shields.io/badge/license-MIT-blue)
![format](https://img.shields.io/badge/format-Agent%20Skills-black)
![tools](https://img.shields.io/badge/tools-Claude%20Code%20%7C%20Codex-blue)

Mathodology is now packaged as a project-level skills repository for AI coding tools such as Claude Code, Codex, and other Agent Skills-compatible agents.

The original Mathodology source tree remains in this repository as the knowledge substrate. The public entrypoint is the skill set under `.claude/skills/`, with `AGENTS.md` acting as the bridge for tools that do not auto-discover Claude project skills.

## What This Repository Is

This repository is a self-contained AI coding knowledge pack for the Mathodology codebase:

- Claude Code project skills in `.claude/skills/<skill-name>/SKILL.md`
- Codex-style metadata in each skill's `agents/openai.yaml`
- A root `AGENTS.md` that tells AI coding tools which skill to load
- Source-level backup tooling for transferring the project as a skills bundle
- The original Rust/Python/Vue Mathodology codebase as reference material for the skills

It is not published primarily as a runnable math-modeling app from this branch anymore. Use the skills first; inspect the source only when a task requires implementation detail.

## Skill Index

| Skill | Use When |
|---|---|
| [`mathodology-whole-project`](.claude/skills/mathodology-whole-project/SKILL.md) | Backing up, transferring, restoring, or orienting on the whole project as a skills package |
| [`mathodology-project-orientation`](.claude/skills/mathodology-project-orientation/SKILL.md) | Starting repository work, locating code, choosing tests, and handling generated files |
| [`mathodology-agent-pipeline`](.claude/skills/mathodology-agent-pipeline/SKILL.md) | Working on the Python worker, agents, prompts, Coder execution, HMML, MATLAB, search, critic, or runtime skills |
| [`mathodology-gateway-api`](.claude/skills/mathodology-gateway-api/SKILL.md) | Working on the Rust gateway, routes, auth, Redis/Postgres state, LLM routing, exports, or submission bundles |
| [`mathodology-web-ui`](.claude/skills/mathodology-web-ui/SKILL.md) | Working on the Vue UI, Pinia stores, API clients, WebSocket streaming, markdown/math rendering, or frontend checks |
| [`mathodology-dev-test-release`](.claude/skills/mathodology-dev-test-release/SKILL.md) | Bootstrapping, testing, matching CI, regenerating contracts, deploying, packaging, or releasing |
| [`mathodology-skill-authoring`](.claude/skills/mathodology-skill-authoring/SKILL.md) | Adding, updating, validating, or reviewing project skills and runtime Coder skills |

## Quick Start

Clone the repository:

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

For Claude Code, open this repository. Claude Code can discover project skills from:

```text
.claude/skills/
```

For Codex or other AI coding tools, start from:

```text
AGENTS.md
```

Then load `mathodology-whole-project` for full-project context, or load the most specific subsystem skill for the task.

## Backup and Transfer

Create a source-level skills backup:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

The backup is written outside the repository by default:

```text
../math_agent_backups/<timestamp>/math_agent-source-<timestamp>.tar.gz
```

The archive includes tracked files plus untracked non-ignored source files. It excludes `.git/`, `.env`, `target/`, `.venv/`, `node_modules/`, `runs/`, `.run/`, and Claude runtime worktrees.

See [docs/BACKUP.md](docs/BACKUP.md) for restore details.

## Skill Authoring Rules

Project skills live here:

```text
.claude/skills/<skill-name>/SKILL.md
```

Each project skill also has:

```text
.claude/skills/<skill-name>/agents/openai.yaml
```

Runtime skills for the Mathodology worker are different. They live under `docs/skills/` and are loaded by the original Python worker's Coder agent. Do not merge the two skill systems.

See [docs/SKILLS.md](docs/SKILLS.md) for the full layout and validation workflow.

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
    assert (d / "agents" / "openai.yaml").exists()
print("skills ok")
PY
```

## Repository Map

The original source tree is still available for context:

- `crates/gateway/`: Rust gateway and API implementation
- `apps/agent-worker/`: Python worker and agent pipeline
- `apps/web/`: Vue web app
- `packages/contracts/`: OpenAPI and event contracts
- `docs/skills/`: runtime skills used by the original worker
- `.claude/skills/`: project skills for AI coding tools

Use skills before deep source reads. They encode the repository boundaries, commands, and verification paths that AI coding agents need most often.

## License

MIT. See [LICENSE](LICENSE).
