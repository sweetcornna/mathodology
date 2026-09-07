# Mathodology 数学建模 Skills

**简体中文** · [English](README_en.md)

面向数学建模竞赛的提示词与参考资料：理解问题、建立模型、检验结果，再把
结论写清楚。agent 根据题目和证据选择工作方式，按需使用专业角色。

## 复杂图表与 image2

新增 [科学图表技能](.claude/skills/mathodology-figure-presets/SKILL.md)，提供
[20 类图表预设](.claude/skills/mathodology-figure-presets/references/presets.md)：
多面板、预测区间、雨云图、山脊图、配对差异、森林图、联合分布、聚类热图、
可行域、Pareto、平行坐标、桑基图、网络、空间放大、时空演化、敏感性、
校准残差、生存曲线、消融和稳健性矩阵。

每类包含数据要求、布局、统计解释、误导反例、简化方案、绘图和图注提示词。
另附 [6 张论文图例与 8 份官方源码参考](.claude/skills/mathodology-figure-presets/references/README.md)，
保留许可和来源；以及可复现的 [6 张合成数据样张](.claude/skills/mathodology-figure-presets/examples/README.md)。

![多面板合成样张](.claude/skills/mathodology-figure-presets/examples/f01-mosaic.png)

首次设计图表时，agent 会主动询问是否有 image2 模型及使用方式；已有回答
会沿用，等待时继续分析。image2 可辅助配图、机制图和版式；真实数值图从
数据和公式绘制。没有 image2 也能完成图表。

无 image2 时默认使用 [20 类可调用绘图代码模板](.claude/skills/mathodology-figure-presets/templates/README.md)，填入真实数据并实际生成 PNG/PDF，不等待模型或只返回绘图提示词。

## 开始使用

在已有项目中安装所需宿主的技能：

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent codex
```

Claude Code 将最后一个参数改为 `claude-code`。完整仓库还包含可选角色、
工作流和 search MCP 配置；标准技能安装不自动安装这些项目级文件。
详见 [安装与更新](docs/INSTALL_zh.md)。

可直接给 agent：

> 使用 mathodology-whole-project 分析这道建模题。从题目、数据和约束出发，
> 建立可解释的基线，验证影响结论的假设，用 mathodology-figure-presets
> 选择有用的图表。首次准备配图时询问我是否有 image2 模型。保留可复现
> 计算和证据来源，按实际需要组织工作，交付结果、图表与清楚的局限。

## 简洁的工作方式

保留数学正确性、数据可追溯、结果可复现和真实渲染检查。工作流不要求
固定九阶段、格式化交接、固定数量图表或模拟奖项评分。专业角色按需使用；
备份、仓库检查、PDF 页面总览和样张生成都是可选小工具。

维护源在 `.claude/skills/`；`.agents/skills/` 是忽略跟踪的本地镜像。
仓库只存技能、文档及其教学参考，不包含建模应用或比赛数据集。
项目原创内容按 [MIT](LICENSE) 许可；第三方素材保留各自许可。

[技能索引](docs/SKILLS_zh.md) · [工作提示词](docs/WORKFLOWS_zh.md) · [备份](docs/BACKUP_zh.md)

[给 agent 的默认绘图指导](.claude/skills/mathodology-figure-presets/references/figure-guidance.md)
