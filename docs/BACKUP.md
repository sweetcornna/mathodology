# Backup and restore

The optional utility archives the current maintained source, including new and
modified files that fit the skills repository boundary:

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

It writes an archive, checksum, file list, Git status and local-diff notes to
`../mathodology_skills_backups/<timestamp>/`. Included: skills and their references,
examples and utilities, roles, workflows, docs, root instructions, READMEs,
LICENSE, .gitignore and .mcp.json.

It excludes Git history, ignored `.agents/` copies, contest outputs, caches and
secrets. Back up a customized local mirror or contest work separately before
replacing it; the source archive cannot recover those excluded files.

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

Read AGENTS.md and the installation guide in the extracted tree. Check required
skills and references before replacing an installation. This is a source export,
not a Git-history backup, and requires no application build. The lightweight
repository checker can inspect an extracted export without Git.

See [installation](INSTALL.md) for project/global scope and mirror migration.
