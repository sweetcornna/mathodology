# Mathodology Skills 项目

本文说明本仓库如何作为 AI 编程 skills 项目组织。

## 项目级 Skills

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

## 入口

- Claude Code：打开仓库后使用 `.claude/skills/`。
- Codex 类工具：先读 `AGENTS.md`，再加载对应 skill。
- 整体迁移或备份：从 `mathodology-whole-project` 开始。
- 新开发任务：从 `mathodology-project-orientation` 开始，再加载子系统 skill。

## Runtime Skills 是另一套系统

`docs/skills/` 不是项目级 skill 目录。它包含原 Mathodology worker 的 Coder agent 在运行时读取的 runtime skills：

```text
docs/skills/chart_catalog/SKILL.md
docs/skills/evidence_mining/SKILL.md
docs/skills/matlab/SKILL.md -> ../../matlab.md
```

这些 runtime skills 可能使用 `when_to_use`、`allowed-tools`、`arguments`、`context` 等字段，因为它们由 `apps/agent-worker/src/agent_worker/skills/loader.py` 解析。

不要把 runtime skills 移到 `.claude/skills/`，也不要把项目级 skills 移到 `docs/skills/`。

## 验证

验证项目级 skill frontmatter：

```bash
for d in .claude/skills/*; do
  python3 /Users/cornna/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"
done
```

验证项目级 skill 元数据：

```bash
python3 - <<'PY'
from pathlib import Path
import re
import yaml

root = Path(".claude/skills")
for d in sorted(p for p in root.iterdir() if p.is_dir()):
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

验证 runtime skill loader：

```bash
uv run pytest apps/agent-worker/tests/test_skill_registry.py -q
uv run pytest apps/agent-worker/tests/test_skill_tool.py -q
```

## 更新 Skill

1. 先确认改动属于 `.claude/skills/` 还是 `docs/skills/`。
2. frontmatter 保持简短，聚焦触发条件。
3. `SKILL.md` 保持单一职责；尽量链接已有源码，不复制大段代码。
4. 项目级 skill 的展示文案变化时，同步更新 `agents/openai.yaml`。
5. 提交前运行验证。

## GitHub 发布

GitHub 项目应该呈现为 skills package：

- README 描述 skills 项目，而不是旧的可运行应用。
- `AGENTS.md` 是工具中立入口。
- `.claude/skills/**` 必须提交。
- `.claude/worktrees/` 等运行时状态仍保持 ignored。
- 源码备份归档留在仓库外的 `../math_agent_backups/`。
