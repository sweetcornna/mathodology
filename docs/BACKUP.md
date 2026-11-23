# Backup and restore

The optional utility archives the full skills pack, including new and modified
files in its source directories.

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

It writes an archive, checksum, file list, Git status and local-diff notes to
`../mathodology_skills_backups/<timestamp>/`. The archive includes all nine skills,
their references and utilities, Claude Code and Codex roles, workflow prompts,
`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, READMEs, docs, `LICENSE`,
`.gitignore` and `.mcp.json`. It also includes the Studio README, its linked
Windows workflow, and the icon and screenshots used by the root READMEs.

The archive scope is the skills pack and its documentation. Back up the local
Codex mirror in `.agents/skills/`, contest work and any Studio application
changes separately before replacing a checkout.

## Verify and restore

In the printed backup directory, verify the checksum:

```bash
shasum -a 256 -c SHA256SUMS
```

Inspect the archive's file list, then extract the named archive into a new empty
directory. Use the actual archive path and timestamp from the backup output:

```bash
mkdir -p /tmp/mathodology-restore
tar -xzf /path/to/mathodology-skills-TIMESTAMP.tar.gz -C /tmp/mathodology-restore
```

Read AGENTS.md and the installation guide in the extracted tree. From that
directory, check the exported files with Python 3.11 or newer.

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py
```

See [installation](INSTALL.md) for project/global scope and mirror migration.
