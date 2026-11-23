# 备份与恢复

可选工具归档完整技能包，包括源码目录内新增和已修改的文件。

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

默认输出到 `../mathodology_skills_backups/<timestamp>/`，包含归档、校验和、
文件清单、Git 状态与本地差异记录。归档包含全部 9 个技能及其参考资料和工具、
Claude Code 与 Codex 的角色、工作提示词、`.claude/settings.json`、`AGENTS.md`、
`CLAUDE.md`、README、文档、`LICENSE`、`.gitignore` 和 `.mcp.json`。同时保留 Studio
README 及其链接的 Windows 工作流，以及根 README 引用的图标和截图。

归档范围为技能包及其文档。替换仓库副本前，请单独备份 `.agents/skills/` 中的
本地 Codex 镜像、比赛工作目录和 Studio 应用源码的改动。

## 校验与恢复

进入工具打印的备份目录，核验：

```bash
shasum -a 256 -c SHA256SUMS
```

先检查归档文件清单，再把指定归档解压到新的空目录。将以下路径和时间戳
替换为工具输出的实际值：

```bash
mkdir -p /tmp/mathodology-restore
tar -xzf /path/to/mathodology-skills-TIMESTAMP.tar.gz -C /tmp/mathodology-restore
```

阅读解压目录中的 AGENTS.md 和安装指引。在该目录下用 Python 3.11 或更新版本检查导出的文件。

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py
```

项目/全局作用域及镜像迁移见 [安装指引](INSTALL_zh.md)。
