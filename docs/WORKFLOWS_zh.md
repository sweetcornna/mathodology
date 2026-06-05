# Mathodology Agent 工作流

Mathodology 支持两种编排模式：

- Claude Code：workflow 优先，使用项目 subagents。
- Codex：多 agents 分阶段并行执行，再由主 agent 综合。

两种模式都以国奖或 MCM/ICM O 奖级别为目标：题目覆盖完整、数学模型可辩护、计算可复现、论文表达成熟、提交包完整。

## 共享 Phase 模型

| Phase | 目标 | 主要产出 | 验收门槛 |
|---|---|---|---|
| 0. 题目与评分 | 理解任务和评审面 | 题意重述、提交物、评分点、歧义登记 | 每个题目要求都有计划产出 |
| 1. 证据与数据 | 给问题建立依据 | 来源清单、数据计划、benchmark、引用笔记 | 每个模型输入都有数据、代理逻辑或假设 |
| 2. 候选模型 | 先比较路线再定型 | 三条模型路线、取舍表、最终路线 | 路线匹配数据、时间、评分和题目 |
| 3. 数学规格 | 让模型可执行 | 符号、假设、目标、约束、算法、指标 | coder 不需要临时发明数学 |
| 4. 实验计算 | 生成可复现结果 | 代码、原始输出、表格、图、敏感性、鲁棒性 | 论文中的数字可复现 |
| 5. 解释结果 | 把结果接回题目 | 结论、图表说明、建议、局限 | 每个结果回答题目问题 |
| 6. 论文初稿 | 形成完整论文 | 摘要、方法、结果、参考文献、附录 | 没有孤立结果或无支撑论断 |
| 7. 独立审稿 | 删除可修缺陷 | 题目、数学、证据、复现、写作审计 | 无高严重度未解决问题 |
| 8. 最终提交 | 组装提交包 | 论文、源码、代码、数据说明、README、AI 使用说明、清单 | 用户可直接提交 |

## Claude Code Workflow 模式

适用于把本仓库 clone 后在 Claude Code 中打开。

主入口：

```text
.claude/workflows/mathodology-award-submission.md
```

Subagents：

- `mathodology-lead`：phase 控制、综合、风险登记
- `mathodology-problem-analyst`：题目拆解和评分映射
- `mathodology-evidence-researcher`：文献、数据、benchmark、引用
- `mathodology-modeler`：数学建模、方法选择、验证设计
- `mathodology-coder`：可复现计算、图、表
- `mathodology-critic`：对抗审稿和 phase gate
- `mathodology-paper-editor`：论文叙事与润色
- `mathodology-submission-packager`：最终提交包和复现 README

执行方式：

1. `mathodology-lead` 加载 `mathodology-whole-project`。
2. Lead 启动 Phase 0 并分派专家。
3. 专家独立产出本阶段材料。
4. Lead 合并为统一决策记录。
5. `mathodology-critic` 审计本阶段。
6. Lead 修复或重新分派，直到 gate 通过。
7. 重复到 Phase 8。

如果用户只通过 `skills` CLI 全局安装 skills，Claude Code 可能不会获得 `.claude/agents` 和 `.claude/workflows` 文件。这时加载 `mathodology-whole-project`，并按本文的 phase 模型执行。

## Codex 多 Agents 模式

适用于把 skills 全局安装到 Codex 后使用。

启动提示：

```text
Use $mathodology-whole-project. Run the Mathodology 9-phase award submission workflow in Codex multi-agents mode. For each phase, dispatch independent agents for analysis, modeling, evidence, coding, critique, and writing where applicable; synthesize their output; then run the phase gate before continuing.
```

Codex agent 角色：

- 主综合 agent
- 题目分析 agent
- 证据与数据 agent
- 模型设计 agent
- 实验计算 agent
- Critic agent
- 论文写作 agent
- 提交打包 agent

Codex 执行规则：

- 只有任务输入独立或可独立 review 时才并行。
- 每个 agent 都要有窄 brief、预期文件和 phase gate。
- Phase 2 至少让两个 agent 独立提出模型路线。
- 每个 gate 都由独立 critic agent 审查。
- 保留 phase log：决策、假设、被拒路线、证据、命令、输出路径。
- 最终回复前，按 Phase 8 检查提交包完整性。

## 最终提交包内容

完整奖项级提交包应包含：

- 最终论文 PDF
- 竞赛要求的可编辑论文源文件
- 代码或 notebooks
- 数据文件或数据来源说明
- 生成的图和表
- 复现 README
- 假设和符号说明
- 敏感性与鲁棒性证据
- 必要时的 AI 使用说明
- 题目要求到提交文件的最终映射清单

## 质量线

未满足以下条件前，不要声称达到奖项级：

- 有多条模型备选路线和清晰选择理由
- 假设有证据支撑
- 计算可复现
- 有敏感性或鲁棒性分析
- 逐问覆盖题目
- 论文叙事成熟
- 经过独立 critic 审稿
- 最终提交包完整
