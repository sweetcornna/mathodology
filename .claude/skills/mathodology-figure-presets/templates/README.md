# 默认绘图代码模板 / Default plotting code templates

无 image2、暂未回答或只有手动入口时，agent 默认从这里选取与预设匹配的代码，
填入实际数据并运行，直接交付图表图片及矢量文件，不停留在设计描述或待执行
提示词。有 image2 时，真实数值图同样优先由代码生成，配图可使用已确认的模型。

[matplotlib_templates.py](matplotlib_templates.py) 提供 F01–F20 共 20 个可调用函数，
[advanced_templates.py](advanced_templates.py) 提供 F21–F46 另外 26 个，
[experiment_kits.py](experiment_kits.py) 提供 18 个实验组件，为图表计算输入。
绘图函数只绘制传入的数据，不内置合成结果，也不自动下载或调用模型。函数返回 Matplotlib
Figure，便于 agent 修改坐标单位、图例、布局与字体。它是一份可复制修改的代码
模板集合，不是自动运行框架或另一个流程检查器。

## 使用方式

把代码复制到本次建模工作目录，使用 NumPy 和 Matplotlib；F08 聚类图以及
`sobol_indices`、`profile_objective` 另外需要 SciPy。使用 F21–F46 时把
`matplotlib_templates.py` 一并复制，进阶模板从中导入颜色、输入检查和
`save_figure`。数值数据、估计区间和敏感性指标来自本次计算。先依据
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

## F01–F20 函数与输入

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
| F16 敏感性 | `global_sensitivity` | 已算好的一阶和总阶 Sobol 指标及标签；可传 `first_interval`/`total_interval`（如 `sobol_indices` 的自助区间）并写明 `interval_label`，不凭空制造。 |
| F17 校准残差 | `calibration_residuals` | 真实值与预测；regression 画拟合/残差，classification 用 10 个等宽概率箱和计数，空箱不冒充正确预测。 |
| F18 生存 | `survival_curve` | 已正确估计的阶梯时间与生存概率，可传区间、删失时间和风险集；函数不替代生存估计器。 |
| F19 消融 | `ablation_comparison` | 行为完整模型及消融项，列为匹配实验；显示逐次配对损失差和均值，不用一次最优运行。 |
| F20 稳健性 | `scenario_robustness` | 损失矩阵、行列名与可选可行掩码；缺失/不可行区别显示，minimax=True 才做完整且可行方案中的最坏损失比较。 |

## F21–F46 函数与输入

设计说明见 [进阶预设卡片](../references/presets-advanced.md)。

| 预设 | 函数 | 输入及注意事项 |
|---|---|---|
| F21 龙卷风 | `tornado` | 各输入取下界、上界时的输出与基线输出（`oat_sweep`），按最大偏离排序；传 `sweep_min`/`sweep_max` 显示区间内的全部输出范围，揭示非单调；不显示交互。 |
| F22 Morris | `morris_plot` | μ*、σ 与参数名（`morris_screening` 组件），可传 μ* 自助区间；射线仅作参考。 |
| F23 收敛带 | `convergence_band` | 每种方法一个 runs×steps 历史矩阵（`repeated_runs`）；带为 IQR；`best_so_far=False` 画扰动曲线。 |
| F24 排名变化 | `bump_chart` | 对象×期间名次矩阵（1 为最好），可突出部分对象。 |
| F25 分位点点阵 | `quantile_dotplot` | 预测或模拟样本（`monte_carlo`），点数不超过样本数；可设阈值。 |
| F26 超越概率 | `exceedance_curve` | 各方案的模拟样本列表；对数纵轴，1/n 以下不可分辨。 |
| F27 小倍数 | `small_multiples` | 共同 x 与对象×点矩阵；可传区间（必须说明含义）和参考线。 |
| F28 瀑布 | `waterfall` | 起点与可加和的各项贡献；传 `end` 时核对加和，残差需单列。 |
| F29 甘特 | `gantt` | 开始、时长、标签；`lanes` 为机器，`groups` 为工件；同一道重叠会报错。 |
| F30 路径 | `route_map` | 投影坐标与按顺序的节点索引路线；报告未访问和重复访问节点。 |
| F31 相图 | `phase_portrait` | 模型向量场函数、范围、数值轨迹、平衡点及稳定性（由 Jacobian 判断）。 |
| F32 分岔 | `bifurcation` | 扁平的参数–长期状态样本，可加解析或延拓得到的稳定/不稳定分支。 |
| F33 PDP/ICE | `pdp_ice` | 网格与 ICE 矩阵（`ice_curves`），可传观测值作刻度。 |
| F34 归因蜂群 | `attribution_beeswarm` | 样本×特征的归因矩阵和对应特征值。 |
| F35 分类诊断 | `classifier_diagnostics` | 验证集 0/1 标签、连续得分和事先确定的阈值。 |
| F36 Taylor | `taylor_diagram` | 参考序列与模型×观测预测矩阵；不含平均偏差。 |
| F37 构成面积 | `composition_area` | 时间与非负分项矩阵；`shares=True` 显示占比。 |
| F38 日历热图 | `calendar_heatmap` | 不重复的日期与数值；缺失日留白。 |
| F39 评价矩阵 | `evaluation_matrix` | 原始指标矩阵、权重、评价方法给出的总分、指标方向；可传 `rank_stability` 的名次概率。 |
| F40 三元图 | `ternary` | 每行和为 1 的三分量，可按组或数值着色，`path=True` 连接时间序列。 |
| F41 排名不确定性 | `rank_caterpillar` | 中位名次与名次区间（`rank_stability` 的 5–95%），可叠加基准权重下的名次；必须写明区间含义。 |
| F42 回测面板 | `backtest_errors` | 各模型 `rolling_origin` 的 origins×horizon 误差；可传各模型覆盖率（无区间的模型传 None）和名义水平；`error_label` 原样写入纵轴（如 `'load error (MWh)'`）。 |
| F43 蛛网图 | `spider_plot` | `oat_sweep` 的 grid 与 output、基线输入和输出；`scale='percent'`，或 `'range'`（离基线较远的区间端点为 ±1）。 |
| F44 性能剖面 | `performance_profile` | 算例×算法的正成本（时间、相对差距+ε），失败记 `np.inf`；Dolan–Moré 比值曲线。 |
| F45 斜率图 | `slope_chart` | 每个对象的两个状态值（前后、方案 A/B），标签自动错开；可突出部分对象。 |
| F46 邻接矩阵 | `adjacency_matrix` | 非负方阵；`order='cluster'`（需 SciPy，按邻域 Jaccard 距离聚类）、`'degree'` 或原顺序；权重跨数量级时 `log=True`，最弱的边也有可见底色。 |

## 实验组件

[experiment_kits.py](experiment_kits.py) 调用本题自己的模型、求解器或预测函数，
返回数组供上表模板和三线表使用；种子、预算和输入分布由调用方给出并写进论文。
设计要点见 [实验组件说明](../references/experiments.md)。

```python
from experiment_kits import morris_screening
from advanced_templates import morris_plot, save_figure

result = morris_screening(model, bounds, r=30, seed=7, n_boot=500)  # model(x) -> scalar
fig = morris_plot(result['mu_star'], result['sigma'], names,
                  mu_star_lower=result['mu_star_lower'], mu_star_upper=result['mu_star_upper'])
save_figure(fig, 'figures/morris')
```

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

English: without image2, copy and adapt the matching callable template (F01–F20 in
matplotlib_templates.py, F21–F46 in advanced_templates.py, experiment kits in
experiment_kits.py), supply real arrays, execute it and export PNG/PDF. The functions return editable Figures and
include no fabricated data. Replace placeholder units, explain statistical inputs
and inspect the actual render. These are templates, not model estimators.
