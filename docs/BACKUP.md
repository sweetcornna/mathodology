# Backup and Restore

The skills project includes a source-level backup script:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

By default it writes to:

```text
../math_agent_backups/<timestamp>/
```

## Backup Contents

Each backup directory contains:

```text
math_agent-source-<timestamp>.tar.gz
SHA256SUMS
archive-files.txt
source-files.nul
git-status.txt
uncommitted-diff.patch
untracked-files.txt
```

The archive is built from:

```bash
git ls-files --cached --others --exclude-standard
```

That means it includes tracked files and untracked non-ignored source files, including new `.claude/skills` files before they are committed.

## Exclusions

Ignored local state is excluded, including:

- `.git/`
- `.env`
- `target/`
- `.venv/`
- `node_modules/`
- `apps/web/dist/`
- `runs/`
- `.run/`
- `.claude/worktrees/`
- local database and Redis dump files

## Verify a Backup

```bash
cd ../math_agent_backups/<timestamp>
shasum -a 256 -c SHA256SUMS
tar -tzf math_agent-source-<timestamp>.tar.gz | head
```

Check that the skills entrypoints exist:

```bash
tar -tzf math_agent-source-<timestamp>.tar.gz | rg '^(AGENTS.md|\\.claude/skills/mathodology-whole-project/SKILL.md)$'
```

Check that generated or secret state is absent:

```bash
tar -tzf math_agent-source-<timestamp>.tar.gz | rg '^(\\.git/|target/|node_modules/|\\.venv/|runs/|\\.run/|\\.env$|\\.claude/worktrees/)'
```

The last command should produce no matches.

## Restore

```bash
mkdir -p /tmp/mathodology-restore
tar -xzf ../math_agent_backups/<timestamp>/math_agent-source-<timestamp>.tar.gz -C /tmp/mathodology-restore
cd /tmp/mathodology-restore
git status --short --branch
```

Then read:

```text
AGENTS.md
.claude/skills/mathodology-whole-project/SKILL.md
```

For a runnable development environment, follow the commands in `mathodology-dev-test-release`. For a skills-only transfer, no build step is required.
