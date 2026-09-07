"""Twenty editable, data-driven chart templates; no workflow engine or demo data.

Copy this file into the task's working directory, call the relevant function with
real arrays, customize the returned Figure, then save_figure(fig, output_stem).
Requires numpy and matplotlib; clustered_heatmap additionally uses scipy.
"""
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.sankey import Sankey
from matplotlib.lines import Line2D

BLUE, ORANGE, GREEN, GRAY = '#0072B2', '#D55E00', '#009E73', '#7A7A7A'
COLORS = [BLUE, ORANGE, GREEN, '#CC79A7']


def _axes(title, **kwargs):
    fig, ax = plt.subplots(figsize=(7, 4), layout='constrained', **kwargs)
    fig.suptitle(title, fontsize=12)
    return fig, ax


def _vectors(*arrays):
    values = [np.asarray(a, dtype=float) for a in arrays]
    if any(a.ndim != 1 or not np.isfinite(a).all() for a in values):
        raise ValueError('Supply finite 1-D arrays; handle and disclose missing data first.')
    if not values or len(values[0]) == 0 or len({len(a) for a in values}) != 1:
        raise ValueError('Supply nonempty arrays of equal length.')
    return values


def _interval(lower, upper):
    low, high = _vectors(lower, upper)
    if np.any(low > high):
        raise ValueError('Lower interval bounds must not exceed upper bounds.')
    return low, high


def _density(values):
    values, = _vectors(values)
    if len(values) < 3 or np.std(values) == 0:
        return None  # Show raw points rather than inventing a smooth density.
    bandwidth = 1.06 * values.std(ddof=1) * len(values) ** (-.2)
    grid = np.linspace(values.min() - 3 * bandwidth, values.max() + 3 * bandwidth, 200)
    density = np.exp(-.5 * ((grid[:, None] - values) / bandwidth) ** 2).mean(1)
    return grid, density / (bandwidth * np.sqrt(2 * np.pi))


def save_figure(fig, output_stem, dpi=300):
    """Export PNG plus vector PDF; keep the caller's editable plotting script."""
    stem = Path(output_stem)
    stem.parent.mkdir(parents=True, exist_ok=True)
    paths = [stem.with_suffix('.png'), stem.with_suffix('.pdf')]
    fig.savefig(paths[0], dpi=dpi, bbox_inches='tight')
    fig.savefig(paths[1], bbox_inches='tight')
    return paths


# F01: arrays on the same observations; error panel is descriptive, not validation.
def evidence_mosaic(x, observed, predicted, baseline):
    x, observed, predicted, baseline = _vectors(x, observed, predicted, baseline)
    fig = plt.figure(figsize=(7, 4.5), layout='constrained')
    axes = fig.subplot_mosaic([['main', 'error'], ['main', 'residual']],
                              gridspec_kw={'width_ratios': [2, 1]})
    axes['main'].scatter(x, observed, s=12, c=GRAY, label='Observed')
    axes['main'].plot(x, predicted, c=BLUE, label='Model')
    axes['main'].plot(x, baseline, '--', c=ORANGE, label='Baseline')
    axes['main'].set(title='(a) Observed and predicted', xlabel='x', ylabel='Response')
    axes['main'].legend(frameon=False)
    axes['error'].barh(['Model', 'Baseline'],
                       [abs(observed-predicted).mean(), abs(observed-baseline).mean()],
                       color=[BLUE, ORANGE])
    axes['error'].set(title='(b) Error', xlabel='Mean absolute error')
    axes['residual'].scatter(x, observed-predicted, s=12, c=BLUE)
    axes['residual'].axhline(0, c=GRAY, lw=.8)
    axes['residual'].set(title='(c) Residuals', xlabel='x', ylabel='Observed − predicted')
    return fig


# F02: interval bounds are inputs, not fabricated from the curve's appearance.
def forecast_fan(time, center, lower, upper, *, interval_label, observed=None, cutoff=None):
    time, center, lower, upper = _vectors(time, center, lower, upper)
    lower, upper = _interval(lower, upper)
    if np.any(np.diff(time) <= 0):
        raise ValueError('Time must be strictly increasing.')
    fig, ax = _axes('Trajectory and uncertainty')
    future = np.ones(len(time), dtype=bool) if cutoff is None else time >= cutoff
    ax.fill_between(time, lower, upper, where=future, alpha=.2, color=BLUE, label=interval_label)
    ax.plot(time, center, c=BLUE, label='Provided center')
    if observed is not None:
        obs = np.asarray(observed, dtype=float)
        if obs.shape != time.shape:
            raise ValueError('Observed values must match time; NaN can mark unavailable observations.')
        ax.scatter(time, obs, s=15, c=GRAY, label='Observed')
    if cutoff is not None:
        ax.axvline(cutoff, c=GRAY, ls=':')
    ax.set(xlabel='Time', ylabel='Response')
    ax.legend(frameon=False)
    return fig


# F03: groups contain raw observations, not reconstructed summary statistics.
def raincloud(groups, labels, seed=0):
    fig, ax = _axes('Distributions and observations')
    rng = np.random.default_rng(seed)
    groups = [_vectors(group)[0] for group in groups]
    densities = [_density(group) for group in groups]
    scale = .45/max((result[1].max() for result in densities if result is not None), default=1)
    for i, group in enumerate(groups):
        values, = _vectors(group)
        color = COLORS[i % len(COLORS)]
        result = densities[i]
        if result is not None:
            grid, density = result
            ax.fill_between(grid, i+.12, i+.12+scale*density, color=color, alpha=.3)
        ax.scatter(values, i-.12+rng.uniform(-.04, .04, len(values)), s=12, c=color, alpha=.5)
        q1, median, q3 = np.quantile(values, [.25, .5, .75])
        ax.plot([q1, q3], [i, i], c=color, lw=3)
        ax.scatter([median], [i], c='white', edgecolors=color, zorder=4)
    ax.set(yticks=range(len(groups)), yticklabels=labels, xlabel='Value')
    ax.set_title('Line: sample IQR · point: median; no inferential interval', fontsize=9)
    return fig


# F04: normalized KDEs share a height multiplier; group size is shown explicitly.
def ridgeline(groups, labels):
    fig, ax = _axes('Distribution shifts')
    groups = [_vectors(group)[0] for group in groups]
    densities = [_density(group) for group in groups]
    scale = .65/max((result[1].max() for result in densities if result is not None), default=1)
    for i, group in enumerate(groups):
        values, = _vectors(group)
        result = densities[i]
        if result is None:
            ax.plot(values, np.full(len(values), i), '|', c=BLUE)
        else:
            grid, density = result
            ax.fill_between(grid, i, i+scale*density, color=BLUE, alpha=.45)
        ax.axhline(i, lw=.4, color=GRAY)
    ax.set(yticks=range(len(groups)),
           yticklabels=[f'{label} (n={len(group)})' for label, group in zip(labels, groups)],
           xlabel='Value')
    return fig


# F05: aligned arrays must already be matched by subject/run ID.
def paired_difference(before, after, *, mean_interval=None, interval_label=None):
    before, after = _vectors(before, after)
    fig, (left, right) = _axes('Within-pair changes', ncols=2)
    left.plot([0, 1], np.vstack([before, after]), color=GRAY, alpha=.3, marker='o', ms=3)
    left.set(xticks=[0, 1], xticklabels=['Before', 'After'], ylabel='Value')
    delta = after-before
    right.scatter(np.zeros(len(delta)), delta, s=14, c=BLUE, alpha=.4)
    right.scatter([.4], [delta.mean()], c=ORANGE, label='Mean difference')
    if mean_interval is not None:
        if interval_label is None:
            raise ValueError('Name the supplied paired-mean interval and its method.')
        low, high = _interval([mean_interval[0]], [mean_interval[1]])
        right.vlines(.4, low[0], high[0], color=ORANGE, label=interval_label)
    right.axhline(0, c=GRAY, lw=.8)
    right.set(xticks=[], ylabel='After − before')
    right.legend(frameon=False)
    return fig


# F06: supply estimates and intervals on a common scientific scale.
def forest(estimates, lower, upper, labels, *, interval_label, ratio=False):
    estimates, lower, upper = _vectors(estimates, lower, upper)
    lower, upper = _interval(lower, upper)
    if ratio and np.any(np.r_[estimates, lower, upper] <= 0):
        raise ValueError('A logarithmic ratio axis requires positive values and bounds.')
    fig, ax = _axes('Estimates and uncertainty')
    y = np.arange(len(estimates))
    ax.hlines(y, lower, upper, colors=BLUE, label=interval_label)
    ax.scatter(estimates, y, c=BLUE)
    ax.axvline(1 if ratio else 0, c=GRAY, ls=':')
    if ratio:
        ax.set_xscale('log')
    ax.set(yticks=y, yticklabels=labels, xlabel='Effect ratio' if ratio else 'Effect difference')
    ax.legend(frameon=False)
    return fig


# F07: descriptively display paired measurements without implying causation.
def joint_distribution(x, y):
    x, y = _vectors(x, y)
    fig = plt.figure(figsize=(6, 5), layout='constrained')
    grid = fig.add_gridspec(2, 2, width_ratios=[4, 1], height_ratios=[1, 4])
    main = fig.add_subplot(grid[1, 0])
    top = fig.add_subplot(grid[0, 0], sharex=main)
    side = fig.add_subplot(grid[1, 1], sharey=main)
    main.scatter(x, y, s=12, alpha=.45, c=BLUE)
    top.hist(x, bins='auto', color=BLUE, alpha=.6)
    side.hist(y, bins='auto', orientation='horizontal', color=BLUE, alpha=.6)
    top.tick_params(labelbottom=False)
    side.tick_params(labelleft=False)
    main.set(xlabel='x', ylabel='y')
    top.set_ylabel('Count')
    side.set_xlabel('Count')
    return fig


# F08: Euclidean clustering of supplied features; preprocessing is caller-owned.
def clustered_heatmap(values, row_labels, column_labels, *, method='average', value_label='Value'):
    try:
        from scipy.cluster.hierarchy import dendrogram, linkage, leaves_list
    except ImportError as exc:
        raise ImportError('F08 requires scipy: install it in the working environment, or use a plain heatmap.') from exc
    values = np.asarray(values, dtype=float)
    if values.ndim != 2 or min(values.shape) < 2 or not np.isfinite(values).all():
        raise ValueError('Clustering requires a finite matrix with at least two rows and columns; disclose preprocessing.')
    row_tree, col_tree = linkage(values, method=method), linkage(values.T, method=method)
    rows, cols = leaves_list(row_tree), leaves_list(col_tree)
    fig = plt.figure(figsize=(7, 5), layout='constrained')
    grid = fig.add_gridspec(2, 2, width_ratios=[1, 4], height_ratios=[1, 4])
    top, left = fig.add_subplot(grid[0, 1]), fig.add_subplot(grid[1, 0])
    dendrogram(col_tree, ax=top, no_labels=True, color_threshold=0, above_threshold_color=GRAY)
    dendrogram(row_tree, ax=left, orientation='left', no_labels=True, color_threshold=0, above_threshold_color=GRAY)
    top.axis('off')
    left.invert_yaxis()
    left.axis('off')
    ax = fig.add_subplot(grid[1, 1])
    im = ax.imshow(values[np.ix_(rows, cols)], aspect='auto', cmap='viridis')
    ax.set(yticks=range(len(rows)), yticklabels=np.asarray(row_labels)[rows],
           xticks=range(len(cols)), xticklabels=np.asarray(column_labels)[cols])
    fig.colorbar(im, ax=ax, label=value_label)
    return fig


# F09: values and feasibility on an actual evaluated grid, not inferred pixels.
def feasible_contour(x, y, objective, feasible, *, solution=None):
    values = np.asarray(objective, dtype=float)
    feasible = np.asarray(feasible, dtype=bool)
    if values.shape != feasible.shape or not np.any(feasible & np.isfinite(values)):
        raise ValueError('Supply matching objective/feasibility grids with at least one finite feasible value.')
    fig, ax = _axes('Response within the feasible domain')
    im = ax.contourf(x, y, np.ma.masked_where(~feasible, values), levels=12, cmap='viridis')
    if feasible.any() and not feasible.all():
        ax.contour(x, y, feasible.astype(float), levels=[.5], colors=[GRAY])
    if solution is not None:
        ax.scatter(*solution, marker='*', c=ORANGE, s=100, label='Provided solution')
        ax.legend(frameon=False)
    ax.set(xlabel='x', ylabel='y')
    fig.colorbar(im, ax=ax, label='Objective')
    return fig


# F10: direction-aware non-dominance among the supplied feasible alternatives.
def pareto_front(x, y, *, x_goal='min', y_goal='min', selected=None):
    x, y = _vectors(x, y)
    if x_goal not in {'min', 'max'} or y_goal not in {'min', 'max'}:
        raise ValueError('Objective directions must be min or max.')
    values = np.column_stack([x, y]) * [1 if x_goal=='min' else -1, 1 if y_goal=='min' else -1]
    front = np.array([not np.any(np.all(values <= row, axis=1) & np.any(values < row, axis=1)) for row in values])
    fig, ax = _axes('Tradeoffs among evaluated feasible alternatives')
    ax.scatter(x[~front], y[~front], c=GRAY, alpha=.35, label='Other feasible alternatives')
    ax.scatter(x[front], y[front], c=BLUE, label='Non-dominated')
    if selected is not None:
        ax.scatter(x[selected], y[selected], c=ORANGE, marker='*', s=120, label='User-specified selection')
    ax.set(xlabel=f'Objective 1 ({x_goal})', ylabel=f'Objective 2 ({y_goal})')
    ax.legend(frameon=False)
    return fig


# F11: supply common reference ranges when comparing more than one dataset.
def parallel_coordinates(values, columns, *, ranges=None, highlight=()):
    values = np.asarray(values, dtype=float)
    if values.ndim != 2 or not np.isfinite(values).all():
        raise ValueError('Supply a finite alternatives-by-metrics matrix.')
    bounds = np.column_stack([values.min(0), values.max(0)]) if ranges is None else np.asarray(ranges)
    span = bounds[:, 1]-bounds[:, 0]
    if np.any(span < 0):
        raise ValueError('Reference ranges must have lower <= upper.')
    normalized = np.divide(values-bounds[:, 0], span, out=np.full_like(values, .5), where=span!=0)
    fig, ax = _axes('Metric tradeoffs · normalized to stated reference ranges')
    for i, row in enumerate(normalized):
        ax.plot(range(len(columns)), row, c=BLUE if i in highlight else GRAY,
                alpha=1 if i in highlight else .25)
    ax.set(xticks=range(len(columns)), xticklabels=[f'{c}\n[{lo:g}, {hi:g}]' for c, (lo, hi) in zip(columns, bounds)],
           ylabel='Normalized value (constant columns at 0.5)')
    return fig


# F12: one conservation junction; positive=inflow, negative=outflow, same units.
def sankey_balance(flows, labels, *, unit, orientations=None):
    flows, = _vectors(flows)
    if not np.isclose(flows.sum(), 0, atol=1e-8*max(1, abs(flows).sum())) or not np.any(flows > 0):
        raise ValueError('Provide balanced signed flows; explicitly include losses or storage changes.')
    if orientations is None:
        counts = {True: 0, False: 0}
        orientations = []
        for flow in flows:
            side = flow > 0
            orientations.append([0, -1, 1][counts[side] % 3])
            counts[side] += 1
    fig, ax = _axes('Resource balance')
    Sankey(ax=ax, scale=1/flows[flows>0].sum(), unit=unit).add(
        flows=flows, labels=labels, orientations=orientations, trunklength=1.4,
        facecolor=BLUE, edgecolor=GRAY, linewidth=.8).finish()
    ax.set_aspect('equal', adjustable='box')
    ax.axis('off')
    return fig


# F13: coordinates are provided by a geographic or topology layout, not invented.
def network_map(node_xy, edges, *, weights=None, labels=None, directed=False):
    xy = np.asarray(node_xy, dtype=float)
    if xy.ndim != 2 or xy.shape[1] != 2 or len(xy) == 0 or not np.isfinite(xy).all():
        raise ValueError('Supply finite nonempty node coordinates with two columns.')
    raw_edges = np.asarray(edges, dtype=float)
    if not np.isfinite(raw_edges).all() or np.any(raw_edges != np.floor(raw_edges)):
        raise ValueError('Edges must contain integer node indices.')
    edges = raw_edges.astype(int).reshape(-1, 2)
    if np.any((edges < 0) | (edges >= len(xy))):
        raise ValueError('An edge refers to a node outside the coordinate table.')
    weighted = weights is not None
    weights = np.ones(len(edges)) if weights is None else np.asarray(weights, dtype=float)
    if np.any(weights < 0) or not np.isfinite(weights).all() or len(weights) != len(edges):
        raise ValueError('Supply nonnegative finite edge weights matching the edge list.')
    fig, ax = _axes('Network structure')
    for (a, b), weight in zip(edges, weights):
        if weight == 0:
            continue
        width = 3*weight/weights.max()
        ax.annotate('', xy=xy[b], xytext=xy[a], arrowprops={'arrowstyle': '->' if directed else '-',
                    'color': GRAY, 'alpha': .6, 'lw': width, 'shrinkA': 5, 'shrinkB': 5})
    ax.scatter(xy[:, 0], xy[:, 1], c=BLUE, s=40, zorder=3)
    for point, label in zip(xy, labels if labels is not None else range(len(xy))):
        ax.annotate(str(label), point, xytext=(4, 5), textcoords='offset points', fontsize=8)
    if weighted and np.any(weights > 0):
        levels = np.unique(np.quantile(weights[weights>0], [0, .5, 1]))
        ax.legend(handles=[Line2D([], [], color=GRAY, lw=3*w/weights.max(), label=f'Weight {w:g}')
                           for w in levels], frameon=False)
    ax.set_aspect('equal', adjustable='box')
    ax.set(xlabel='Provided layout x', ylabel='Provided layout y')
    return fig


# F14: point-map template; input coordinates must already use the stated CRS.
def spatial_inset(x, y, values, *, inset_bounds, coordinate_label, value_label):
    x, y, values = _vectors(x, y, values)
    fig, (ax, inset) = _axes('Spatial distribution and local detail', ncols=2,
                            gridspec_kw={'width_ratios': [2, 1]})
    norm = plt.Normalize(values.min(), values.max())
    im = ax.scatter(x, y, c=values, cmap='viridis', norm=norm, s=18)
    inset.scatter(x, y, c=values, cmap='viridis', norm=norm, s=12)
    inset.set(xlim=inset_bounds[:2], ylim=inset_bounds[2:])
    inset.set_aspect('equal', adjustable='box')
    inset.set_title('Local detail', fontsize=9)
    ax.indicate_inset_zoom(inset, edgecolor=GRAY)
    ax.set(xlabel=coordinate_label+' x', ylabel=coordinate_label+' y', aspect='equal')
    fig.colorbar(im, ax=[ax, inset], label=value_label)
    return fig


# F15: explicit bin edges preserve irregular time/space spacing; no interpolation.
def spatiotemporal(time_edges, position_edges, field, *, value_label):
    fig, ax = _axes('Evolution across space and time')
    im = ax.pcolormesh(time_edges, position_edges, np.ma.masked_invalid(field), cmap='viridis', shading='flat')
    ax.set(xlabel='Time', ylabel='Position')
    fig.colorbar(im, ax=ax, label=value_label)
    return fig


# F16: display computed Sobol indices; do not invent Monte Carlo uncertainty.
def global_sensitivity(first_order, total_order, labels):
    first, total = _vectors(first_order, total_order)
    fig, ax = _axes('Global sensitivity · supplied Sobol indices')
    y = np.arange(len(first))
    ax.barh(y-.17, first, height=.3, color=BLUE, label='First order')
    ax.barh(y+.17, total, height=.3, color=ORANGE, label='Total order')
    ax.set(yticks=y, yticklabels=labels, xlabel='Fraction of output variance')
    ax.legend(frameon=False)
    return fig


# F17: choose the actual task; use held-out data for generalization claims.
def calibration_residuals(observed, predicted, *, task='regression'):
    observed, predicted = _vectors(observed, predicted)
    fig, (left, right) = _axes('Prediction diagnostics', ncols=2)
    if task == 'regression':
        left.scatter(predicted, observed, c=BLUE, s=13, alpha=.5)
        limits = [min(observed.min(), predicted.min()), max(observed.max(), predicted.max())]
        left.plot(limits, limits, ':', c=GRAY)
        left.set(xlabel='Predicted', ylabel='Observed')
        right.scatter(predicted, observed-predicted, c=BLUE, s=13, alpha=.5)
        right.axhline(0, c=GRAY, ls=':')
        right.set(xlabel='Predicted', ylabel='Residual')
    elif task == 'classification':
        if not np.isin(observed, [0, 1]).all() or np.any((predicted < 0) | (predicted > 1)):
            raise ValueError('Classification needs binary outcomes and probabilities in [0,1].')
        edges = np.linspace(0, 1, 11)
        bins = np.minimum(np.digitize(predicted, edges)-1, 9)
        points = [(predicted[bins==i].mean(), observed[bins==i].mean()) for i in range(10) if np.any(bins==i)]
        left.scatter(*np.asarray(points).T, c=BLUE)
        left.plot([0, 1], [0, 1], ':', c=GRAY)
        left.set(xlabel='Mean predicted probability', ylabel='Observed fraction', title='10 equal-width bins')
        right.hist(predicted, bins=edges, color=BLUE)
        right.set(xlabel='Predicted probability', ylabel='Count')
    else:
        raise ValueError('Task must be regression or classification.')
    return fig


# F18: plot an externally estimated survival curve and actual risk-set counts.
def survival_curve(time, survival, *, lower=None, upper=None, interval_label=None,
                   censor_times=None, risk_times=None, risk_counts=None):
    time, survival = _vectors(time, survival)
    if np.any(np.diff(time) <= 0) or np.any(np.diff(survival) > 1e-10) or np.any((survival < 0) | (survival > 1)):
        raise ValueError('Supply increasing times and a non-increasing survival probability in [0,1].')
    fig, ax = _axes('Time-to-event distribution')
    ax.step(time, survival, where='post', c=BLUE)
    if lower is not None or upper is not None:
        if lower is None or upper is None or interval_label is None:
            raise ValueError('Provide both survival interval bounds and their statistical definition.')
        low, high = _interval(lower, upper)
        if len(low) != len(time) or np.any((low < 0) | (high > 1)):
            raise ValueError('Survival bounds must match time and remain in [0,1].')
        ax.fill_between(time, low, high, step='post', color=BLUE, alpha=.2, label=interval_label)
        ax.legend(frameon=False)
    if censor_times is not None:
        censor = np.asarray(censor_times)
        if np.any((censor < time[0]) | (censor > time[-1])):
            raise ValueError('Censor marks must lie in the displayed time range.')
        ax.plot(censor, survival[np.searchsorted(time, censor, side='right')-1], '|', c=BLUE)
    if risk_counts is not None:
        if risk_times is None or len(risk_counts) != len(risk_times):
            raise ValueError('Risk counts need matching evaluation times.')
        ax.set_xlabel('Time\nAt risk: '+', '.join(f't={t:g}: {n}' for t, n in zip(risk_times, risk_counts)))
    else:
        ax.set_xlabel('Time')
    ax.set(ylabel='Survival probability', ylim=(0, 1.02))
    return fig


# F19: rows=full model then ablations, columns=matched replicate/run IDs.
def ablation_comparison(loss_by_run, labels):
    values = np.asarray(loss_by_run, dtype=float)
    if values.ndim != 2 or values.shape[0] < 2 or values.shape[1] == 0 or not np.isfinite(values).all():
        raise ValueError('Supply finite paired run results, with the full model in row zero.')
    differences = values[1:]-values[0]
    fig, ax = _axes('Component removal · paired loss differences')
    for i, row in enumerate(differences):
        ax.scatter(row, np.full(len(row), i), c=BLUE, s=16, alpha=.4)
        ax.scatter(row.mean(), i, c=ORANGE, marker='D', s=35)
    ax.axvline(0, c=GRAY, ls=':')
    ax.set(yticks=range(len(differences)), yticklabels=labels[1:], xlabel='Ablated − full loss (positive is worse)')
    ax.set_title('Dots: paired runs · diamonds: means; no invented intervals', fontsize=9)
    return fig


# F20: absent probabilities, never report expected loss; selection is opt-in.
def scenario_robustness(loss, row_labels, scenario_labels, *, feasible=None, minimax=False):
    values = np.asarray(loss, dtype=float)
    feasible = np.ones_like(values, dtype=bool) if feasible is None else np.asarray(feasible, dtype=bool)
    if values.ndim != 2 or feasible.shape != values.shape:
        raise ValueError('Supply matching plan-by-scenario loss and feasibility matrices.')
    if not np.any(feasible & np.isfinite(values)):
        raise ValueError('No finite feasible loss is available; do not invent a quantitative color scale.')
    fig, ax = _axes('Scenario robustness')
    cmap = plt.get_cmap('cividis').copy()
    cmap.set_bad('#eeeeee')
    masked = np.ma.masked_where(~feasible | ~np.isfinite(values), values)
    im = ax.imshow(masked, cmap=cmap, aspect='auto')
    for (i, j), value in np.ndenumerate(values):
        if not feasible[i, j] or not np.isfinite(value):
            ax.text(j, i, '×' if not feasible[i, j] else '—', ha='center', va='center')
    ax.set(yticks=range(len(row_labels)), yticklabels=row_labels,
           xticks=range(len(scenario_labels)), xticklabels=scenario_labels)
    ax.tick_params(axis='x', labelrotation=25)
    ax.set_xlabel('× Infeasible · — Missing')
    if minimax:
        complete = np.flatnonzero(np.isfinite(values).all(1) & feasible.all(1))
        choice = row_labels[complete[np.argmin(values[complete].max(1))]] if len(complete) else 'none'
        ax.set_title(f'Minimax among complete feasible rows: {choice}', fontsize=9)
    fig.colorbar(im, ax=ax, label='Loss (lower is better)')
    return fig
