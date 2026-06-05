# Mathodology Skills

[English](./README.md) · **简体中文**

![license](https://img.shields.io/badge/license-MIT-blue)
![format](https://img.shields.io/badge/format-Agent%20Skills-black)
![tools](https://img.shields.io/badge/tools-Claude%20Code%20%7C%20Codex-blue)

Mathodology 现在被整理成一个面向 Claude Code、Codex 等 AI 编程工具的项目级 skills 仓库。

原 Mathodology 源码仍保留在仓库里，作为 skills 的知识基底。公开入口变为 `.claude/skills/` 下的技能集，`AGENTS.md` 则给不会自动发现 Claude project skills 的工具使用。

## 这个仓库是什么

这是一个自包含的 Mathodology AI 编程知识包：

- `.claude/skills/<skill-name>/SKILL.md` 中的 Claude Code 项目技能
- 每个 skill 自带 `agents/openai.yaml`，方便 Codex 风格工具展示和调用
- 根目录 `AGENTS.md` 告诉 AI 编程工具应该加载哪个 skill
- 源码级备份脚本，方便把整个项目作为 skills bundle 迁移
- 原 Rust/Python/Vue Mathodology 代码库作为 skills 的参考材料

这个分支不再主要作为可运行的数学建模应用来发布。先用 skills；只有任务需要实现细节时，再深入源码。

## Skill 索引

| Skill | 适用场景 |
|---|---|
| [`mathodology-whole-project`](.claude/skills/mathodology-whole-project/SKILL.md) | 整项目备份、迁移、恢复，或把项目作为 skills 包整体理解 |
| [`mathodology-project-orientation`](.claude/skills/mathodology-project-orientation/SKILL.md) | 开始仓库工作、定位代码、选择测试、处理生成文件 |
| [`mathodology-agent-pipeline`](.claude/skills/mathodology-agent-pipeline/SKILL.md) | Python worker、agents、prompts、Coder 执行、HMML、MATLAB、搜索、critic、runtime skills |
| [`mathodology-gateway-api`](.claude/skills/mathodology-gateway-api/SKILL.md) | Rust gateway、路由、认证、Redis/Postgres、LLM 路由、导出、提交包 |
| [`mathodology-web-ui`](.claude/skills/mathodology-web-ui/SKILL.md) | Vue UI、Pinia stores、API clients、WebSocket streaming、Markdown/数学渲染、前端验证 |
| [`mathodology-dev-test-release`](.claude/skills/mathodology-dev-test-release/SKILL.md) | bootstrap、测试、CI 对齐、contracts 生成、部署、打包、release |
| [`mathodology-skill-authoring`](.claude/skills/mathodology-skill-authoring/SKILL.md) | 新增、更新、验证或 review 项目 skills 与 runtime Coder skills |

## 快速开始

克隆仓库：

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

Claude Code 打开本仓库后，可从这里发现项目技能：

```text
.claude/skills/
```

Codex 或其他 AI 编程工具从这里开始：

```text
AGENTS.md
```

然后按任务加载 `mathodology-whole-project` 或更具体的子系统 skill。

## 备份与迁移

创建源码级 skills 备份：

```bash
bash .claude/skills/mathodology-whole-project/scripts/create-source-backup.sh
```

默认备份到仓库外：

```text
../math_agent_backups/<timestamp>/math_agent-source-<timestamp>.tar.gz
```

归档包含 tracked 文件和未被 ignore 的 untracked 源文件；排除 `.git/`、`.env`、`target/`、`.venv/`、`node_modules/`、`runs/`、`.run/` 和 Claude runtime worktrees。

恢复细节见 [docs/BACKUP.md](docs/BACKUP.md)。

## Skill 编写规则

项目级 skills 放在：

```text
.claude/skills/<skill-name>/SKILL.md
```

每个项目 skill 还包含：

```text
.claude/skills/<skill-name>/agents/openai.yaml
```

Mathodology worker 的 runtime skills 是另一套系统，放在 `docs/skills/`，由原 Python worker 的 Coder agent 运行时加载。不要混淆这两套 skill。

完整布局和验证流程见 [docs/SKILLS_zh.md](docs/SKILLS_zh.md)。

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
    assert (d / "agents" / "openai.yaml").exists()
print("skills ok")
PY
```

## 仓库地图

原源码仍作为上下文保留：

- `crates/gateway/`：Rust gateway 和 API 实现
- `apps/agent-worker/`：Python worker 与 agent pipeline
- `apps/web/`：Vue web app
- `packages/contracts/`：OpenAPI 和事件 contracts
- `docs/skills/`：原 worker 运行时使用的 runtime skills
- `.claude/skills/`：AI 编程工具使用的项目 skills

先读 skills，再按需读源码。skills 已经编码了 AI 编程 agent 最常用的边界、命令和验证路径。

## 许可证

MIT。见 [LICENSE](LICENSE)。
