# 实验组件与结果呈现 / Experiment kits

建模论文的说服力常来自实验设计：模型与什么比较、在什么扰动下仍成立、结论
对哪些假设敏感。本文件把常见实验形式整理为可调用组件
[experiment_kits.py](../templates/experiment_kits.py)，每个组件调用本题自己的
模型、求解器或预测函数，返回数组，交给对应图表模板和三线表。组件不判断
结论，不制造数据；种子、预算和输入分布都由调用方给出并写进论文。

按题目需要选用，不要求每篇都做全部实验。先写出实验要回答的问题，再选组件。

## 评审关注什么 / What judges ask for

以下要点转述自组委会与评审公开材料，说明哪些实验能被认可，不保证获奖。COMAP
评述原载 The UMAP Journal 43(4)（2022）的 Judges' Commentaries（© COMAP），这里
链接的是第三方镜像；CUMCM 材料链接的是 GitHub 上的收集仓库（镜像），并非
组委会官网原件。

- **敏感性分析必须真做、要解释**：2022 年 MCM B 题评述称，没有好的敏感性分析的
  论文都没有进入最后几轮，很多分析只是象征性的；A 题评述称清楚、执行良好的敏感性
  分析几乎总能让论文脱颖而出，并要求每张图都在正文中讨论
  （镜像：[A 题](https://www.shumo.com/nudtdb/2023MCM/2022_MCM_A_JC.pdf)、
  [B 题](https://www.shumo.com/nudtdb/2023MCM/2022_MCM_B_JC.pdf)）。
- **一次模拟不够，说明验证基线**：COMAP
  [20 Years of Good Advice](https://www.contest.comap.com/undergraduate/contests/resources/PDF/20YearsofGoodAdvice.pdf)
  指出单次运行不够、应说明用什么基线验证，并要求图表有图注、单位和坐标轴说明。
- **不确定性带进决策**：2022 年 MCM C 题评述把预测的置信界列为一篇论文获评
  Outstanding 的原因之一（镜像：[C 题](https://www.shumo.com/nudtdb/2023MCM/2022_MCM_C_JC.pdf)）。
- **AHP 要给一致性比率**：同一 B 题评述批评没有报告一致性比率的 AHP 论文（E17）。
- **加噪检验稳定性**：CUMCM 2018A 评阅要点写明应对附件数据加随机误差考察方法的
  稳定性，并考察重要参数对结果的影响；2017A 评阅要点对能自行构造数据检验模型的
  论文给予较好评价（E15、E10；GitHub 镜像：[2018A](https://raw.githubusercontent.com/Hel10o/CUMCM-2026/main/%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9/2018/2018%E9%AB%98%E6%95%99%E7%A4%BE%E6%9D%AF%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%95%B0%E5%BB%BA%E6%A8%A1%E7%AB%9E%E8%B5%9BA%E9%A2%98%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9.pdf)、
  [2017A](https://raw.githubusercontent.com/Hel10o/CUMCM-2026/main/%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9/2017/2017%E6%95%B0%E5%AD%A6%E5%BB%BA%E6%A8%A1A%E9%A2%98%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9.pdf)）。
- **启发式算法要评估**：CUMCM 2020B 讲评把启发式算法的评估列为要点：算法的普适性
  与解的可行性，在一定数量的实例上数值模拟，并与最优值比较；2025A 讲评批评只给出
  智能算法的一般描述而不给超参数具体数值，以及直接用赛题数据建立、不具通用性的
  模型（E07、F23、F44；GitHub 镜像：[2020B](https://raw.githubusercontent.com/Hel10o/CUMCM-2026/main/%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9/2020/%E8%B5%9B%E9%A2%98%E8%AE%B2%E8%AF%84/2020%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%95%B0%E5%AD%A6%E5%BB%BA%E6%A8%A1%E7%AB%9E%E8%B5%9BB%E9%A2%98%E8%AE%B2%E8%AF%84%EF%BC%9A%E7%A9%BF%E8%B6%8A%E6%B2%99%E6%BC%A0.pdf)、[2025A](https://raw.githubusercontent.com/Hel10o/CUMCM-2026/main/%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9/2025/%E8%B5%9B%E9%A2%98%E8%AE%B2%E8%AF%84/2025%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%95%B0%E5%AD%A6%E5%BB%BA%E6%A8%A1%E7%AB%9E%E8%B5%9BA%E9%A2%98%E8%AE%B2%E8%AF%84%EF%BC%9A%E7%83%9F%E5%B9%95%E5%B9%B2%E6%89%B0%E5%BC%B9%E7%9A%84%E6%8A%95%E6%94%BE%E7%AD%96%E7%95%A5.pdf)）。
- **说明数据划分与指标含义，避免套路化**：CUMCM 2020C 讲评批评用机器学习却不说明
  训练与验证样本的论文、把因素简单加权成含义不明的综合指标的论文，并指出
  “模板化”“套路化”的论文较为普遍（E06、F39；GitHub 镜像：[2020C](https://raw.githubusercontent.com/Hel10o/CUMCM-2026/main/%E8%AF%84%E9%98%85%E8%A6%81%E7%82%B9/2020/%E8%B5%9B%E9%A2%98%E8%AE%B2%E8%AF%84/2020%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%95%B0%E5%AD%A6%E5%BB%BA%E6%A8%A1%E7%AB%9E%E8%B5%9BC%E9%A2%98%E8%AE%B2%E8%AF%84%EF%BC%9A%E4%B8%AD%E5%B0%8F%E5%BE%AE%E4%BC%81%E4%B8%9A%E7%9A%84%E4%BF%A1%E8%B4%B7%E7%AD%96%E7%95%A5.pdf)）。
- **代码可运行**：CUMCM 论文格式规范（2026 年修订稿）要求附录给出全部可运行的
  源程序，缺少程序、程序不能运行或结果与论文不符都可能被取消评奖资格；因此每个
  实验都应能由脚本重跑（GitHub 镜像：[格式规范](https://raw.githubusercontent.com/Hel10o/CUMCM-2026/main/%E5%85%A8%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%95%B0%E5%AD%A6%E5%BB%BA%E6%A8%A1%E7%AB%9E%E8%B5%9B%E8%AE%BA%E6%96%87%E6%A0%BC%E5%BC%8F%E8%A7%84%E8%8C%83-2026%E5%B9%B4%E4%BF%AE%E8%AE%A2%E7%A8%BF.pdf)）。

公开获奖论文中较突出的做法：把基准或界画成参考线（完美信息收益、证明的上界）；
展示排名或决策在扰动下的稳定性；标出阈值和失效点（如需求无法满足的临界水位）；
设置随机或朴素基线；做留出或回溯检验；用独立外部数据交叉验证。这些是归纳，
用时应结合本题实际。

## 组件一览

| 编号 | 函数 | 回答的问题 | 成本 | 图 | 表 |
|---|---|---|---|---|---|
| E01 | `oat_sweep` | 单个参数变化时结论摆动多大？ | p×n 次 | F21 | 参数、区间、输出范围 |
| E02 | `morris_screening` | 哪些参数可以固定、哪些需深入？ | r(p+1) 次 | F22 | μ*、σ、排名 |
| E03 | `sobol_indices` | 输出方差由哪些参数及交互贡献？ | n(p+2) 次 | F16 | S1、ST 及区间 |
| E04 | `monte_carlo` | 输入不确定时输出分布与风险如何？ | n 次 | F25、F26 | 均值、分位数、超越概率 |
| E05 | `bootstrap_interval` | 统计量的抽样不确定性有多大？ | B 次统计量 | F06 | 估计值与区间 |
| E06 | `rolling_origin` | 预测在不同起点、步长下是否可靠？优于朴素基线吗？ | 起点数×拟合 | F02、F17 | 各步长 MAE/RMSE |
| E07 | `repeated_runs` | 随机算法是否稳定，优于对照吗？ | 种子数×求解 | F23 | 最好/中位/IQR/最差/用时 |
| E08 | `paired_variants` + `paired_summary` | 去掉某组件或换成基线，效果变化多少？ | 变体×种子 | F19 | 配对差、区间、胜负次数 |
| E09 | `scenario_matrix` | 推荐方案在各情景下是否仍可接受？ | 方案×情景 | F20 | 损失、遗憾值 |
| E10 | `perturbation_curve` | 数据噪声、缺失或参数误差增大时性能如何退化？ | 水平×种子 | F23 | 各水平的中位数与 IQR |
| E11 | `ice_curves` | 模型对一个特征如何响应，个体是否不同？ | 网格×行 | F33 | — |
| E12 | `permutation_importance` | 哪些特征对验证集性能最关键？ | p×重复 | F06 | 损失增量及置换间离散 |
| E13 | `profile_objective` | 参数能否由数据唯一确定（可辨识性）？ | 网格×优化 | 折线 | 剖面区间 |
| E14 | `rank_stability` | 权重变化时排名是否稳定？ | n 次评价 | F39、F41 | 名次概率、5–95% 名次区间 |
| E15 | `synthetic_recovery` | 已知真值时模型能否把参数找回来？噪声多大时失效？ | 水平×种子×拟合 | F23 | 各噪声水平的相对误差 |
| E16 | `refinement_study` | 数值解是否收敛，收敛阶是否符合方法？ | 步长数×求解 | 对数折线 | 步长、误差或其 Richardson 估计、观测阶 |
| E17 | `ahp_weights` | 判断矩阵是否一致，权重是多少？ | 一次 | F39 | 权重、λmax、CI、CR |
| E18 | `interval_coverage` | 预测区间的实际覆盖率是否接近名义水平？ | 一次 | F42 | 各步长覆盖率与平均宽度 |

`summarize`、`booktabs_table` 和 `markdown_table` 把多次运行整理为三线表单元
（`均值 ± 标准差` 或 `中位数 [Q1, Q3]`），LaTeX 需要 `\usepackage{booktabs}`。

## 按题型组织实验

- **预测类**：E06 滚动起点回测，与朴素/季节朴素基线（`naive_forecast`、
  `seasonal_naive`）及一个简单统计模型比较，F42 画各步长误差；E18 检查区间
  覆盖率；E05 给误差指标区间；E10 测试数据噪声或缺失；预测区间用 F02，残差用 F17。
- **优化类**：E07 多种子运行比较算法与对照（随机搜索、贪心、精确解或下界），
  F23 画收敛并加上界或最优值参考线，多算例时用 F44 性能剖面；三线表报告最终值
  统计、与界的差距、用时、求解器和硬件；E09 在参数情景下重新求解并检验遗憾值；
  E01/E02 与 F43 看最优目标对参数的敏感性。
- **评价类**：E17 报告 AHP 一致性比率；E14 扰动权重检验排名稳定性，F41 画名次
  区间；比较不同赋权或归一化方法的排名，用 Kendall τ（`scipy.stats.kendalltau`）
  量化一致性并用 F24 展示；F39 合并展示指标、权重、总分与名次概率。
- **机理/微分方程类**：E15 用已知参数模拟数据检验能否回收参数，并逐级加噪；
  E13 检查可辨识性；E16 检查步长或网格加密后的收敛；E01/E03 做参数敏感性；
  F31 相图、F32 分岔图说明定性行为；E04 把参数不确定性传播到关键输出。
- **机器学习类**：E06 或独立验证集，E08 消融与基线比较，E12 置换重要性，
  E11 与 F33/F34 解释模型，F35 诊断分类阈值。

## 设计要点

### E01 单因素扫描与 E02 Morris 筛选

区间应来自文献、数据分位数或题目约束，并在表中列出来源；统一 ±10% 只能
作为无依据时的初筛并说明。OAT 在基线附近有效，无法发现交互：例如输出只
在两个参数同时变化时才变化，单因素扫描会显示零摆幅。参数多时先用 Morris
（r 取 10–50、4 水平）筛选，再对保留参数做 Sobol。报告 r、水平数和种子；
换种子重复一次可检验排序是否稳定。

### E03 Sobol 全局敏感性

Saltelli 2010 一阶与 Jansen 总阶估计，总运行次数为 n(p+2)；输入独立，可给区间
（均匀）或 SciPy 冻结分布。自助区间对同一批运行重抽样并使用同一种子，重复调用
结果一致。报告 S1 与 ST 及区间，在 F16 用 `first_interval`/`total_interval`
显示；ST 明显大于 S1 表示交互。输入相关时 Sobol
指数解释受限，应说明。模型很慢时先用代理模型，并说明代理误差。

### E04 蒙特卡罗不确定性传播

`sample_inputs(rng, n)` 由调用方编写：每个输入的分布和参数要有依据（数据拟合、
文献或专家区间），相关输入需联合抽样。报告样本数、均值的蒙特卡罗标准误和
`running_mean` 是否稳定；尾部概率小于 1/n 时不能报告，估计的概率应附蒙特卡罗
区间（F26 图例给出 k/n 与 Wilson 区间）。比较方案时可让各方案使用同一组随机数
（公共随机数）以降低差异的方差；独立抽样同样无偏，只是需要更多样本。

### E05 自助法区间

独立样本用普通重抽样；时间序列或空间相关数据用 `block_length` 的移动块自助
（整数，2 ≤ 块长 ≤ n/2）。块长常以 n^(1/3) 量级为起点，或用 Politis–White 自动
选择，并报告结果对块长的敏感性。百分位区间在小样本、偏态时近似较差，应说明。
重抽样单位必须与抽样结构一致（按对象、按天或按地区）。

### E06 滚动起点回测

每个起点只用其之前的数据拟合，包括标准化、特征选择和超参数选择，杜绝信息
泄漏。协变量同样如此：只有事先已知的协变量（日历、计划价格、既定政策）才可
设 `future_X_known=True` 把预测期的实际值交给预测函数；其他协变量要由预测函数
自行预测，否则误差会被低估。至少与朴素基线比较；季节数据加季节朴素。按预测步长报告误差，误差随
步长增长是正常现象。只做一次划分的“测试集”结果应注明其局限。

### E07 重复运行与算法比较

所有方法使用同一组种子和相同预算（函数评估次数或运行时间）；不同方法每代
评估数不同时横轴用评估次数。报告最好、中位数、四分位、最差、成功率和用时，
不只报告最好一次。差异需要检验时：若同一种子固定了相同的算例或初始解，
运行是配对的，用 Wilcoxon 符号秩检验；否则用 Mann–Whitney 检验；并报告效应
大小。多种方法、多算例时注意多重比较。

### E08 消融与基线比较

完整模型放在第一行，每次只移除或替换一个组件，所有变体使用相同的种子和数据
划分，使差异成对。`paired_summary` 给出平均配对差、自助区间及变差/变好次数；
区间跨 0 时只说明“该组件的作用在本实验中不明确”。

### E09 情景与稳健性

情景应覆盖题目关心的不确定来源（需求高低、政策、参数极端值），并说明为何
选这些情景。未给出情景概率时报告最坏损失和最大遗憾，不计算期望值。F20 中
不可行组合要明确标出。

### E10 扰动强度曲线

扰动类型要对应现实问题：测量噪声、缺失比例、参数误差、需求冲击。每个强度
使用多个种子，`convergence_band(..., best_so_far=False, x=levels)` 画中位数和
四分位带。退化拐点比单一数值更能说明模型适用范围。

### E11 ICE/PDP 与 E12 置换重要性

置换重要性返回的 `p025`/`p975` 是多次置换之间的离散范围，不是置信区间；需要
抽样不确定性时，对验证集做自助重抽样再重复计算。

在验证集上计算；网格限制在观测分位范围内。特征相关时置换会产生不现实样本，
重要性会被分摊或高估，应改为成组置换或条件方法并说明。两者都描述模型行为，
不支持因果结论。

### E13 剖面与可辨识性

固定一个参数、重新优化其余参数，得到目标函数剖面。对负对数似然，剖面高出
最小值 1.92（χ²₁ 的 95% 分位的一半）的范围给出近似 95% 剖面区间；平坦剖面
说明参数不可辨识，需要更多数据、固定该参数或重新参数化。最小二乘目标需先
换算为似然或说明使用的阈值。示例画法：

```python
import matplotlib.pyplot as plt
result = profile_objective(nll, theta_hat, index=1, grid=grid)
fig, ax = plt.subplots(figsize=(4.5, 3), layout='constrained')
ax.plot(result['grid'], result['profile'] - result['minimum'], c='#0072B2')
ax.axhline(1.92, ls='--', c='#7A7A7A', label='95% profile threshold')
ax.set(xlabel='β (per day)', ylabel='Δ negative log-likelihood')
```

### E14 权重扰动下的排名稳定性

`overall_score(weights)` 用与正文相同的评价方法（TOPSIS、加权和、灰色关联）
计算各方案总分。权重从以原权重为中心的 Dirichlet 分布抽样，`concentration`
越大扰动越小，需报告取值；也可另做“各权重 ±20%”的确定性扫描。报告每个方案
排第一的比例和名次概率矩阵，在 F39 中用 `rank_probability` 显示。

### E15 已知真值的参数回收

`simulate(theta, noise, rng)` 用设定的真实参数生成数据，`fit` 用与正文相同的方法
估计；噪声从 0 逐级增大，每级多个种子。噪声为 0 时应几乎精确回收，否则先查
模型或代码；相对误差随噪声的增长给出方法的适用范围，可用
`convergence_band(..., best_so_far=False, x=noise_levels)` 按参数画出。真实参数应
取在实际数据拟合值附近。

### E16 步长与网格加密

步长至少取三档。有解析解时传 `reference`，返回 `error`，步长比例可以不等。
没有解析解时步长必须按固定比例 r 缩小（如减半），返回相邻两档之差
`successive_difference`：它等于粗步长误差的 (1 − r^p) 倍，减半时一阶方法只有误差的
一半，所以另给出按观测阶 p 做 Richardson 换算的 `error_estimate`。观测收敛阶应接近
方法理论阶（显式 Euler 为 1，经典 Runge–Kutta 为 4）；明显偏低说明存在不光滑、
实现错误或舍入误差主导。用 `plt.loglog(result['steps'], result['error_estimate'])`
（或 `error`）画出并标注斜率。同时检查常识极限（守恒量、非负性、极端参数下的已知行为）。

### E17 AHP 一致性

由主特征向量得到权重，CI = (λmax − n)/(n − 1)，CR = CI/RI。`ahp_weights` 的 RI
采用 Saaty 的随机一致性指标表（n ≤ 15，n = 3 时为 0.58）；国内教材也有略不同的 RI
取值（如 n = 3 取 0.52），CR 随所用表格变化，论文中应写明用了哪一张表。CR < 0.1
为常用接受标准。报告判断矩阵本身和 CR；不一致时修改判断
而不是只调数字凑到 0.1 以下。层次结构中每个判断矩阵都要检验。

### E18 区间覆盖率

对回测或留出数据计算每个步长的区间覆盖率和平均宽度。覆盖率显著低于名义水平
说明区间过窄（常见原因是忽略参数不确定性）；过高且很宽则区间缺乏信息量。样本
较少时覆盖率本身有抽样误差，n 个点的标准误约为 √(p(1−p)/n)。

## 结果表 / Tables

- 三线表：顶线、栏目线、底线，不用竖线；单位写在栏目名中；同一列小数位一致，
  数字右对齐，有效数字与不确定性匹配。
- 多次运行写 `均值 ± 标准差（n=…）` 或 `中位数 [Q1, Q3]`，在表注中说明。
- 最优值可加粗，但需同时给出差异是否超过运行间波动；不要只标星号显著性。
- 模型比较表：行是方法（含朴素基线），列为指标、用时、求解器与硬件，有界时
  给出与界的差距。
- 符号表：符号、含义、单位、取值、来源；不要出现未定义的希腊字母。
- 排名表：名次、得分、名次区间、进入前 k 名的频率。
- 题目规定了结果表格式时，严格按给定格式填写，省略的行指向支撑文件。
- 表与图分工：图显示模式和不确定性，表给出精确数值，同一结果不必重复呈现。

```python
from experiment_kits import repeated_runs, summarize, booktabs_table
rows = []
for name, solver in methods.items():
    run = repeated_runs(solver, seeds=range(30))
    rows.append([name, summarize(run['final']), f"{run['summary']['best']:.4g}",
                 f"{run['summary']['median_seconds']:.2f}"])
print(booktabs_table(rows, ['Method', 'Final cost (mean ± sd)', 'Best', 'Time (s)'],
                     caption='Thirty seeded runs per method under equal evaluation budgets.',
                     label='tab:runs'))
```

English summary: the kits wrap eighteen common experiment forms (one-at-a-time
and Morris screening, Sobol indices, Monte Carlo propagation, bootstrap and
moving-block intervals, rolling-origin backtests with naive baselines, seeded
repeated runs, paired ablations, scenario regret, perturbation curves, ICE,
permutation importance, likelihood profiles, weight-perturbed rank stability,
synthetic-truth recovery, step-size refinement, AHP consistency and interval
coverage). Each calls the task's own model, returns arrays for a matching figure
template and a three-line table, and leaves the conclusions to the author.
Record seeds, budgets and input distributions in the paper. The section on what
judges ask for paraphrases COMAP and CUMCM commentaries and links to them.
