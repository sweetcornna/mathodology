# 备份与恢复

本 skills 仓库自带一个 skills-only 备份脚本：

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

默认写入：

```text
../mathodology_skills_backups/<timestamp>/
```

## 备份内容

每个备份目录包含：

```text
mathodology-skills-<timestamp>.tar.gz
SHA256SUMS
archive-files.txt
source-files.nul
git-status.txt
uncommitted-diff.patch
untracked-files.txt
```

归档按白名单构建，仅包含：

- `.claude/skills/**`
- `.claude/agents/**`
- `.claude/workflows/**`
- `docs/**`
- `AGENTS.md`
- `README.md`
- `README_en.md`
- `LICENSE`
- `.gitignore`

这样可以把旧的本地源码残留排除在 skills 备份之外。

## 排除项

归档不包含：

- `.git/`
- `.env` 及本地机密文件
- 应用源码树
- CI、部署、安装器与包管理器文件
- 构建产物与依赖目录
- 本地运行产物
- `.claude/worktrees/`

## 验证备份

```bash
cd ../mathodology_skills_backups/<timestamp>
shasum -a 256 -c SHA256SUMS
tar -tzf mathodology-skills-<timestamp>.tar.gz | head
```

检查 skills 入口文件存在：

```bash
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(AGENTS\.md|\.claude/skills/mathodology-whole-project/SKILL\.md)$'
```

检查旧应用路径不存在：

```bash
tar -tzf mathodology-skills-<timestamp>.tar.gz | rg '^(\.git/|apps/|crates/|packages/|scripts/|config/|installer/|tests/|data/|\.github/|node_modules/|target/|\.venv/|\.env$|\.claude/worktrees/)'
```

最后一条命令应当没有任何匹配。

## 恢复

```bash
mkdir -p /tmp/mathodology-skills-restore
tar -xzf ../mathodology_skills_backups/<timestamp>/mathodology-skills-<timestamp>.tar.gz -C /tmp/mathodology-skills-restore
cd /tmp/mathodology-skills-restore
```

然后阅读：

```text
AGENTS.md
.claude/skills/mathodology-whole-project/SKILL.md
.claude/workflows/mathodology-award-submission.md
docs/INSTALL.md
```

skills-only 恢复不需要任何构建步骤。
