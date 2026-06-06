# Mathodology Skills 项目

本仓库是 Mathodology 的 skills-only GitHub tree，不是可运行应用 checkout。

## 保留布局

项目级 skills 放在 `.claude/skills/`：

```text
.claude/skills/
├── mathodology-whole-project/
├── mathodology-project-orientation/
├── mathodology-agent-pipeline/
├── mathodology-gateway-api/
├── mathodology-web-ui/
├── mathodology-dev-test-release/
└── mathodology-skill-authoring/
```

每个 skill 包含：

```text
SKILL.md
agents/openai.yaml
```

`SKILL.md` 是 agent 读取的技能正文。`agents/openai.yaml` 是给 Codex 风格界面使用的元数据。

Claude Code 项目编排资产放在：

```text
.claude/agents/
.claude/workflows/
```

这些文件用于 clone 仓库后在 Claude Code 项目中直接使用。全局安装 skills 时，workflow 指导仍保留在 `SKILL.md` 正文里。

当前 workflow 模板：

- `.claude/workflows/mathodology-award-submission.md`：默认奖项级 9-phase 数模 workflow。
- `.claude/workflows/mathodology-contest-variants.md`：M3、HiMCM/MidMCM、IMMC/IM2C、leaderboard/data-science、运筹/政策/商业案例和短时冲刺赛适配器。

## 入口

- Claude Code：打开仓库后加载 `.claude/skills/`。
- Codex 类工具：先读 `AGENTS.md`，再加载对应 skill。
- 奖项级 workflow 编排：使用 `docs/WORKFLOWS_zh.md`。
- 竞赛类型 workflow 适配：使用 `docs/WORKFLOWS_zh.md` 和 `.claude/workflows/mathodology-contest-variants.md`。
- 用户一键安装：使用 `docs/INSTALL_zh.md`。
- 整体迁移或备份：从 `mathodology-whole-project` 开始。
- 仓库清理或策略检查：从 `mathodology-project-orientation` 开始。
- Skill 修改：从 `mathodology-skill-authoring` 开始。

## 不再存在的内容

旧应用 tree 已从这个分支删除。不要期待当前文件中存在原 gateway、worker、Web UI、生成 contracts、runtime skills、部署、CI、数据集或安装器。

子系统 skills 现在保存归档设计知识。它们不应该要求 agent 运行旧构建命令，也不应该要求编辑已经不存在的源码路径。

## 验证

验证项目 skill frontmatter：

```bash
for d in .claude/skills/*; do
  python3 /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"
done
```

验证项目 skill 元数据：

```bash
python3 - <<'PY'
from pathlib import Path
import re
import yaml

root = Path(".claude/skills")
skills = sorted(p for p in root.iterdir() if p.is_dir())
assert skills, "no skills found"
for d in skills:
    text = (d / "SKILL.md").read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    assert match, d
    frontmatter = yaml.safe_load(match.group(1))
    assert frontmatter["name"] == d.name, d
    assert frontmatter["description"].startswith("Use when"), d
    metadata = yaml.safe_load((d / "agents" / "openai.yaml").read_text(encoding="utf-8"))
    assert f"${d.name}" in metadata["interface"]["default_prompt"], d
print("skills ok")
PY
```

验证只跟踪 skills 仓库文件：

```bash
python3 - <<'PY'
import subprocess
import sys

keep_exact = {
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "README_zh.md",
    "LICENSE",
    "docs/SKILLS.md",
    "docs/SKILLS_zh.md",
    "docs/INSTALL.md",
    "docs/INSTALL_zh.md",
    "docs/WORKFLOWS.md",
    "docs/WORKFLOWS_zh.md",
    "docs/BACKUP.md",
}
files = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
bad = [
    f for f in files
    if f not in keep_exact
    and not f.startswith(".claude/skills/")
    and not f.startswith(".claude/agents/")
    and not f.startswith(".claude/workflows/")
]
if bad:
    print("\n".join(bad))
    sys.exit(1)
print(f"tracked whitelist ok: {len(files)} files")
PY
```

## 更新 Skill

1. frontmatter 保持简短，聚焦触发条件。
2. `SKILL.md` 只写可复用指导，不写过程流水账。
3. 子系统归档细节只能作为知识保存；不要链接当前不存在的文件。
4. 展示文案或默认提示变化时，同步更新 `agents/openai.yaml`。
5. Codex 编排写入 skill 正文；Claude Code 编排写入 `.claude/agents/`、`.claude/workflows/` 和 `docs/WORKFLOWS_zh.md`。
6. 提交前运行验证。

## GitHub 发布

GitHub 项目应该呈现为 skills package：

- README 描述 skills-only 项目。
- `AGENTS.md` 是工具中立入口。
- `.claude/skills/**` 必须提交。
- `.claude/agents/**` 和 `.claude/workflows/**` 作为 Claude Code 项目编排资产提交。
- `.claude/worktrees/` 和本地运行时状态保持 ignored。
- skills 备份归档留在仓库外的 `../mathodology_skills_backups/`。
