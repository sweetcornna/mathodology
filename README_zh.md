# Mathodology Skills

[English](./README.md) · **简体中文**

![license](https://img.shields.io/badge/license-MIT-blue)
![format](https://img.shields.io/badge/format-Agent%20Skills-black)
![tools](https://img.shields.io/badge/tools-Claude%20Code%20%7C%20Codex-blue)

Mathodology 现在是面向 Claude Code、Codex 等 AI 编程工具的 skills-only 仓库。

这个分支刻意不再发布原来的可运行应用源码。GitHub 仓库现在只保留项目级 skills、skill 元数据、轻量文档、备份脚本和许可证。

## 仓库内容

- `.claude/skills/<skill-name>/SKILL.md` 中的 Claude Code 项目 skills
- `.claude/agents/` 中的 Claude Code 项目 subagents
- `.claude/workflows/` 中的 Claude Code workflow 模板
- 每个 skill 自带 `agents/openai.yaml`，方便 Codex 风格工具展示和调用
- 根目录 `AGENTS.md`，给不会自动发现 project skills 的工具使用
- `docs/` 下的 skills 和 workflow 文档
- `mathodology-whole-project` skill 中的 skills-only 备份脚本

这个分支不保留应用源码、CI workflow、部署文件、生成的 contracts、包锁文件、数据集、构建产物或安装器资源。

## 一键安装

一条命令把全部 Mathodology skills 全局安装到 Codex 和 Claude Code：

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --agent claude-code --copy --yes
```

这条命令使用 `vercel-labs/skills` 提供的开放 `skills` CLI，从 GitHub 安装 Agent Skills 到对应 agent 的 skills 目录。

安装后重启 Codex 或 Claude Code，让新 skills 被发现。

更多目标和验证方式见 [docs/INSTALL_zh.md](docs/INSTALL_zh.md)。

## Codex 与 Claude Code 模式

Mathodology 分别提供 Codex 和 Claude Code 的编排指导：

- Claude Code：使用 `.claude/workflows/mathodology-award-submission.md`，并调用 `.claude/agents/` 中的项目 subagents。
- Codex：加载 `mathodology-whole-project`，按多 agents 模式执行 9 个 phase。

两种模式都面向国奖或 MCM/ICM O 奖级别产出：多模型备选、有证据支撑的假设、可复现实验、成熟论文、完整提交包。

完整 phase 模型见 [docs/WORKFLOWS_zh.md](docs/WORKFLOWS_zh.md)。

## Skill 索引

| Skill | 适用场景 |
|---|---|
| [`mathodology-whole-project`](.claude/skills/mathodology-whole-project/SKILL.md) | 整个 skills 仓库的备份、迁移、恢复、整体理解，或 Codex/Claude Code 工作流编排 |
| [`mathodology-project-orientation`](.claude/skills/mathodology-project-orientation/SKILL.md) | 在 skills-only checkout 中开始工作，或验证仓库边界 |
| [`mathodology-agent-pipeline`](.claude/skills/mathodology-agent-pipeline/SKILL.md) | 维护原 agent pipeline 的归档知识 |
| [`mathodology-gateway-api`](.claude/skills/mathodology-gateway-api/SKILL.md) | 维护原 gateway 和 API 的归档知识 |
| [`mathodology-web-ui`](.claude/skills/mathodology-web-ui/SKILL.md) | 维护原 Web UI 的归档知识 |
| [`mathodology-dev-test-release`](.claude/skills/mathodology-dev-test-release/SKILL.md) | 验证 skills 仓库，或保留 dev、test、release 归档指导 |
| [`mathodology-skill-authoring`](.claude/skills/mathodology-skill-authoring/SKILL.md) | 新增、更新、验证或 review 项目 skills |

## 快速开始

克隆仓库：

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

Claude Code 打开本仓库后，从这里加载 skills：

```text
.claude/skills/
```

Codex 或其他 AI 编程工具从这里开始：

```text
AGENTS.md
```

然后按任务加载 `mathodology-whole-project` 或更具体的 skill。

## 备份与迁移

创建 skills-only 备份：

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

默认备份到仓库外：

```text
../mathodology_skills_backups/<timestamp>/mathodology-skills-<timestamp>.tar.gz
```

归档使用 skills 白名单，只包含当前保留的 skills 仓库文件。它会排除 `.git/`、secret、构建产物、运行时状态，以及本地可能残留的旧应用目录。

恢复细节见 [docs/BACKUP.md](docs/BACKUP.md)。

## 验证

验证所有项目 skills：

```bash
for d in .claude/skills/*; do
  python3 /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"
done
```

检查元数据和目录一致性：

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

## 仓库策略

保持这个分支只服务 skills。除非明确改变仓库策略，不要加回应用源码树、生成客户端、CI workflow、Docker 文件、安装器、数据集或构建产物。

如果需要历史应用实现，可以从 Git 历史恢复；它不是当前 GitHub tree 的一部分。

## 许可证

MIT。见 [LICENSE](LICENSE)。
