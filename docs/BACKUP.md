# Backup and Restore

The skills repository includes a skills-only backup script:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

By default it writes to:

```text
../mathodology_skills_backups/<timestamp>/
```

## Backup Contents

Each backup directory contains:

```text
mathodology-skills-<timestamp>.tar.gz
SHA256SUMS
archive-files.txt
source-files.nul
git-status.txt
uncommitted-diff.patch
untracked-files.txt
```

The archive is built from a whitelist. It includes only:

- `.claude/skills/**`
- `docs/**`
- `AGENTS.md`
- `README.md`
- `README_zh.md`
- `LICENSE`
- `.gitignore`

This keeps old local source remnants out of the skills backup.

## Exclusions

The archive does not include:

- `.git/`
- `.env` or local secret files
- application source trees
- CI, deployment, installer, or package-manager files
- build outputs and dependency directories
- local run artifacts
- `.claude/worktrees/`

## Verify a Backup

```bash
cd ../mathodology_skills_backups/<timestamp>
shasum -a 256 -c SHA256SUMS
tar -tzf mathodology-skills-<timestamp>.tar.gz | head
```

Check that the skills entrypoints exist:

```bash
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(AGENTS.md|\\.claude/skills/mathodology-whole-project/SKILL.md)$'
```

Check that old application paths are absent:

```bash
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(\\.git/|apps/|crates/|packages/|scripts/|config/|installer/|tests/|data/|\\.github/|node_modules/|target/|\\.venv/|\\.env$|\\.claude/worktrees/)'
```

The last command should produce no matches.

## Restore

```bash
mkdir -p /tmp/mathodology-skills-restore
tar -xzf ../mathodology_skills_backups/<timestamp>/mathodology-skills-<timestamp>.tar.gz -C /tmp/mathodology-skills-restore
cd /tmp/mathodology-skills-restore
```

Then read:

```text
AGENTS.md
.claude/skills/mathodology-whole-project/SKILL.md
```

No build step is required for a skills-only restore.
