# 默认绘图指导 / Default figure guidance

这是可直接交给建模 agent 的指导提示词，也是本项目绘图行为的统一入口。
根据题目和数据调整模板，不要求固定阶段、固定图表数量或机器评分。

## 给 agent 的指导

> 先说明图表要回答的问题，再从 mathodology-figure-presets 的 20 类绘图代码
> 模板中选择合适的一类。将本题真实数据或公式计算结果填入模板，实际运行
> 并生成 PNG 与矢量 PDF；同时交付图注、数据来源和复现方式。
>
> 每个建模任务首次设计图表时，询问用户是否有可用的 image2 模型，以及
> 通过现有工具、已配置接口还是手动使用；沿用本任务已有回答，不重复问。
> 无 image2、尚未回答或暂时无法直接调用时，默认继续运行代码模板出图。
> 有 image2 时可用于配图、机制示意图和版式探索，真实数值图仍由数据驱动。
>
> 模板是可修改的起点。依据变量、单位、抽样结构和论文尺寸调整布局、配色
> 与统计标注；不适配时改造最接近的模板或选择更简单的图型。不得用样张
> 数据代替本题数据，不得凭空制造曲线、误差区间或显著性结论。
>
> 出图后核对数据与统计含义，并查看实际图片及论文页面，修正裁切、遮挡、
> 字体和图例问题。只缺少某张图所需的数据时，说明缺口并继续其他独立工作。

## 查找具体内容

- [20 类设计预设](presets.md)：选型、数据要求、解释与图注。
- [20 类代码模板](../templates/README.md)：可调用函数与真实数据的使用方式。
- [版式与导出建议](style.md)：按论文尺寸检查可读性。
- [image2 使用指引](image2.md)：可调用、手动、不可用和未回答的处理。
- [合成效果样张](../examples/README.md)：仅用来理解设计效果。

## English instruction

> Start with the question a figure must answer. Select a relevant code template,
> supply actual task data or computed results, execute it, and deliver PNG/PDF,
> a caption, provenance and reproduction instructions. Ask once per modeling
> task about image2 availability and access, reusing any existing answer. Without
> image2, while an answer is pending, or when it cannot be called directly,
> continue with code-template rendering. image2 can assist illustrations and
> layout concepts; quantitative marks remain data-driven. Adapt the template to
> the actual variables, uncertainty and page size, inspect the render, and correct
> misleading or unreadable details. Never substitute preview data or invented
> statistical results for missing evidence.
