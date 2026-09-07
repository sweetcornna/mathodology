# 默认绘图代码模板 / Default plotting code templates

无 image2、暂未回答或只有手动入口时，agent 默认从这里选取与预设匹配的代码，
填入实际数据并运行，直接交付图表图片及矢量文件，不停留在设计描述或待执行
提示词。有 image2 时，真实数值图同样优先由代码生成，配图可使用已确认的模型。

[matplotlib_templates.py](matplotlib_templates.py) 提供 20 个可调用函数。它们只绘制
传入的数据，不内置合成结果，也不自动下载或调用模型。函数返回 Matplotlib
Figure，便于 agent 修改坐标单位、图例、布局与字体。它是一份可复制修改的代码
模板集合，不是自动运行框架或另一个流程检查器。

## 使用方式

把代码复制到本次建模工作目录，使用 NumPy 和 Matplotlib；F08 聚类图另外需要
SciPy。数值数据、估计区间和敏感性指标来自本次计算。先依据
[预设卡片](../references/presets.md) 检查是否适用，再运行匹配函数。

以下例子假设当前工作目录中已有真实的 `forecast.csv`，列名来自你的数据。
`lower95`/`upper95` 必须是模型实际计算的逐点预测区间，不得临时编造：

```python
import matplotlib
matplotlib.use('Agg')
import numpy as np
from matplotlib_templates import forecast_fan, save_figure

result = np.genfromtxt('forecast.csv', delimiter=',', names=True)
fig = forecast_fan(result['time'], result['mean'], result['lower95'], result['upper95'],
                   interval_label='95% pointwise predictive interval')
fig.axes[0].set(xlabel='Time (days)', ylabel='Demand (units/day)')
save_figure(fig, 'figures/forecast')
```

此示例中的列名、单位和区间定义都要换成真实含义。时间列应按实际顺序排列；
数据读入、缺失处理和类型转换由本题计算代码承担，并说明排除样本的数量。
不安装依赖到本仓库，不创建包管理工程；使用宿主已有环境或本次任务的独立环境。

## 20 类函数与输入

| 预设 | 函数 | 输入及注意事项 |
|---|---|---|
| F01 多面板 | `evidence_mosaic` | 同一观测上的 x、observed、predicted、baseline；误差面板是描述统计，验证性质由数据划分决定。 |
| F02 预测区间 | `forecast_fan` | 有序时间、中心、上下界，必须明确 interval_label；可传观察值与分界。 |
| F03 雨云 | `raincloud` | 原始观测分组和组名；显示点、中位数、IQR，极小/常数组不拟合密度。 |
| F04 山脊 | `ridgeline` | 有自然顺序的原始分组与组名；同一密度高度系数，标 n。 |
| F05 配对差异 | `paired_difference` | 已按 ID 配对的前后数组；可传实际估计的均值差区间和定义，不自动计算置信区间。 |
| F06 森林 | `forest` | 点估计、上下界、标签和区间定义；ratio=True 使用正数比值对数轴。 |
| F07 联合分布 | `joint_distribution` | 同一对象的 x、y；边际是计数，主图是散点，不自动添加因果或置信椭圆。 |
| F08 聚类热图 | `clustered_heatmap` | 有限的对象×特征矩阵与行列标签；默认 average linkage、欧氏距离，额外依赖 SciPy，预处理由调用方说明。 |
| F09 可行域 | `feasible_contour` | 网格 x、y、目标矩阵、可行掩码及可选的实际求解点。 |
| F10 Pareto | `pareto_front` | 已满足硬约束的两目标数组、min/max 方向；selected 仅是调用方按明确规则指定的方案索引。 |
| F11 平行坐标 | `parallel_coordinates` | 方案×指标矩阵、列名、可选共同参考范围；显示原始范围，常数列放在 0.5。 |
| F12 桑基 | `sankey_balance` | 一个收支节点的有符号流量、标签与单位；正为流入、负为流出，损耗或存量变化应作为真实项目列出。复杂多节点可按官方参考扩展。 |
| F13 网络 | `network_map` | 实际布局坐标、整数节点索引边表、可选权重/标签和有向性；布局距离不自动代表地理距离。 |
| F14 空间放大 | `spatial_inset` | 已投影或明确坐标系的 x、y、值，放大范围 (xmin,xmax,ymin,ymax) 和坐标/值单位；点地图，行政区面图需用实际边界扩展。 |
| F15 时空 | `spatiotemporal` | 明确的时间/位置分箱边界和位置×时间矩阵；保留不等间隔，不插值制造观测。 |
| F16 敏感性 | `global_sensitivity` | 已算好的一阶和总阶 Sobol 指标及标签；如有可靠区间可在返回 Figure 中加入，不凭空制造。 |
| F17 校准残差 | `calibration_residuals` | 真实值与预测；regression 画拟合/残差，classification 用 10 个等宽概率箱和计数，空箱不冒充正确预测。 |
| F18 生存 | `survival_curve` | 已正确估计的阶梯时间与生存概率，可传区间、删失时间和风险集；函数不替代生存估计器。 |
| F19 消融 | `ablation_comparison` | 行为完整模型及消融项，列为匹配实验；显示逐次配对损失差和均值，不用一次最优运行。 |
| F20 稳健性 | `scenario_robustness` | 损失矩阵、行列名与可选可行掩码；缺失/不可行区别显示，minimax=True 才做完整且可行方案中的最坏损失比较。 |

## 出图和交付

使用 `save_figure(fig, output_stem)` 输出 300 dpi PNG 和矢量 PDF。也可用
Matplotlib 的 savefig 另导出 SVG。检查实际图片与论文插入尺寸，调整字体、
色域、图例和长标签；不要把函数成功返回当作视觉质量验收。

模板默认的 x/Response/Value 等标签只是可编辑占位名称，交付前必须替换为
实际变量和单位。按实际抽样结构计算统计量，并依照卡片补齐图注、样本量、
方法、数据来源和局限。仅有汇总量时不要套用需要原始观测的模板。

没有匹配模板或数据结构不同：先改造最接近的函数，或使用熟悉的 R/MATLAB
等代码模板；解释必要调整并实际生成图片，不默认等待 image2。模板与本次
数据不适配时应改图型，不能用样张数据顶替。

English: without image2, copy and adapt the matching callable template, supply real
arrays, execute it and export PNG/PDF. The functions return editable Figures and
include no fabricated data. Replace placeholder units, explain statistical inputs
and inspect the actual render. These are templates, not twenty model estimators.
