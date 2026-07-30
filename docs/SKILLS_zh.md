# Mathodology Skills 项目

本仓库是 Mathodology 的 skills-only GitHub tree，不是可运行应用 checkout。

## 保留布局

项目级 skills 放在 `.claude/skills/`：

```text
.claude/skills/
├── mathodology-whole-project/
├── mathodology-project-orientation/
├── mathodology-award-gates/
│   └── scripts/                 # figqa.py, pdf_qa.sh, make_contact_sheet.py, lint_run.py
├── mathodology-evidence-search/
├── mathodology-agent-pipeline/
├── mathodology-gateway-api/
├── mathodology-web-ui/
├── mathodology-dev-test-release/
│   └── scripts/                 # validate_repo.py
└── mathodology-skill-authoring/
```

每个 skill 包含：

```text
SKILL.md
agents/openai.yaml
```

`SKILL.md` 是 agent 读取的技能正文。`agents/openai.yaml` 是给 Codex 风格界面使用的元数据。部分 skill 还带一个 `scripts/` 目录，内含可执行 gate：`mathodology-award-gates` 携带图表/PDF QA 和 run-block lint 脚本，`mathodology-dev-test-release` 携带仓库验证器。这些脚本可从 clone checkout 或全局安装的 skill 运行。

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
- 外部证据、文献、数据集或引用核验：从 `mathodology-evidence-search` 开始。它使用名为 `search` 的 MCP server（free-search-mcp），由仓库自带的 `.mcp.json` 在项目作用域注册，克隆后无需配置，见 `docs/INSTALL_zh.md`。

## 不再存在的内容

旧应用 tree 已从这个分支删除。不要期待当前文件中存在原 gateway、worker、Web UI、生成 contracts、runtime skills、部署、CI、数据集或安装器。

子系统 skills 现在保存归档设计知识。它们不应该要求 agent 运行旧构建命令，也不应该要求编辑已经不存在的源码路径。

## 验证

仓库的全部机械验证集中在一个脚本 `validate_repo.py`，它随 `mathodology-dev-test-release` skill 一起交付（纯标准库，不依赖 PyYAML）。不要再把这些检查以 heredoc 形式内联到文档或其他 skill；要加或改 gate 就改脚本。

从仓库根运行全部维护 gate：

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py all
```

也可以只运行某个 gate —— `skills`、`metadata`、`links`、`whitelist`、`agents`、`sync` 或 `selftest`：

```bash
python3 .claude/skills/mathodology-dev-test-release/scripts/validate_repo.py sync
```

`all` 覆盖 skill 和 agent frontmatter、`agents/openai.yaml` 元数据、markdown 链接和 `.claude/...` 路径解析、跟踪文件白名单，以及 en/zh 文档孪生同步（标题数与代码块数，代码块在剔除 CJK 行后逐字节一致）。从全局安装的 skill 运行时，用 skill 目录内的 `scripts/validate_repo.py` 代替仓库相对路径。

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
- `.mcp.json` 提交，让克隆者无需配置即可拿到免 key 的 `search` MCP server。其中不含任何密钥和本地路径。
- `.claude/worktrees/` 和本地运行时状态保持 ignored。
- skills 备份归档留在仓库外的 `../mathodology_skills_backups/`。
