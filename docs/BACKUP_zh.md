# 备份与恢复

可选工具归档当前维护源，包括符合仓库边界的新增和已修改文件：

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

默认输出到 `../mathodology_skills_backups/<timestamp>/`，包含归档、校验和、
文件清单、Git 状态与本地差异记录。归档包含技能及参考素材、样张、工具、
角色、工作流、文档、根指引、README、LICENSE、.gitignore 和 .mcp.json。

不含 Git 历史、被忽略的 `.agents/` 副本、比赛成果、缓存和密钥。替换本地
镜像或比赛工作目录前，应单独备份；源码归档无法恢复这些排除项。

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

阅读解压目录中的 AGENTS.md 和安装指引，确认技能及参考素材完整后再替换
安装副本。归档是源码导出，不是 Git 历史备份，不需要应用构建；轻量仓库
检查器可检查不带 Git 的解压目录。

项目/全局作用域及镜像迁移见 [安装指引](INSTALL_zh.md)。
