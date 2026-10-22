"""Further data-driven chart templates (F21–F46); no demo data inside.

Keep matplotlib_templates.py beside this file: it supplies the colors, input
checks and save_figure. Pass real arrays or results computed for the task,
customize the returned Figure, then save_figure(fig, output_stem). Requires
numpy and matplotlib. experiment_kits.py computes inputs for several of these.
"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, LogNorm, Normalize
from matplotlib.patches import Circle, Polygon

from matplotlib_templates import BLUE, ORANGE, GREEN, GRAY, _axes, _vectors, _interval, save_figure

PURPLE, SKY, AMBER = '#CC79A7', '#56B4E9', '#E69F00'
PALETTE = [BLUE, ORANGE, GREEN, PURPLE, SKY, AMBER, '#000000']  # Okabe-Ito order
DIVERGING = LinearSegmentedColormap.from_list('blue_gray_vermillion', [BLUE, '#D9D9D9', ORANGE])
# Blues without its near-white start, so the weakest value stays distinguishable from blank.
TINTED_BLUES = LinearSegmentedColormap.from_list('tinted_blues', plt.cm.Blues(np.linspace(.25, 1, 256)))

__all__ = ['tornado', 'morris_plot', 'convergence_band', 'bump_chart', 'quantile_dotplot',
           'exceedance_curve', 'small_multiples', 'waterfall', 'gantt', 'route_map',
           'phase_portrait', 'bifurcation', 'pdp_ice', 'attribution_beeswarm',
           'classifier_diagnostics', 'taylor_diagram', 'composition_area', 'calendar_heatmap',
           'evaluation_matrix', 'ternary', 'rank_caterpillar', 'backtest_errors', 'spider_plot',
           'performance_profile', 'slope_chart', 'adjacency_matrix', 'save_figure']


def _matrix(values, what='values'):
    values = np.asarray(values, dtype=float)
    if values.ndim != 2 or 0 in values.shape or not np.isfinite(values).all():
        raise ValueError(f'Supply {what} as a finite, nonempty 2-D array; handle missing data first.')
    return values


def _labels(labels, n, what='label'):
    labels = [str(x) for x in labels]
    if len(labels) != n:
        raise ValueError(f'Supply exactly one {what} per row or item ({n}).')
    return labels


# F21: one-at-a-time output swings from the caller's runs; interactions are not shown.
# sweep_min/sweep_max (e.g. oat_sweep output.min(1)/.max(1)) reveal non-monotone inputs.
def tornado(low, high, labels, *, base, output_label, input_ranges=None, sweep_min=None, sweep_max=None):
    low, high = _vectors(low, high)
    labels = _labels(labels, len(low), 'input label')
    reach = np.maximum(np.abs(low - base), np.abs(high - base))
    if sweep_min is not None:
        sweep_min, sweep_max = _interval(sweep_min, sweep_max)
        if len(sweep_min) != len(low):
            raise ValueError('Supply one sweep range per input.')
        reach = np.maximum(reach, np.maximum(base - sweep_min, sweep_max - base))
    order = np.argsort(reach, kind='stable')  # barh draws bottom-up, so the largest lands on top
    fig, ax = _axes('One-at-a-time sensitivity · output swing per input')
    for row, i in enumerate(order):
        if sweep_min is not None:
            ax.plot([sweep_min[i], sweep_max[i]], [row, row], c='black', lw=.9, marker='|', ms=9,
                    zorder=3, label='Range over the sweep' if row == 0 else None)
        ax.barh(row + .18, low[i] - base, left=base, height=.34, color=BLUE,
                label='Input at lower bound' if row == 0 else None)
        ax.barh(row - .18, high[i] - base, left=base, height=.34, color=ORANGE,
                label='Input at upper bound' if row == 0 else None)
    ax.axvline(base, c='black', lw=.8)
    short = lambda v: f'{float(f"{v:.4g}"):g}'  # 4 significant digits without exponents
    names = [labels[i] + (f'\n[{short(input_ranges[i][0])}, {short(input_ranges[i][1])}]'
                          if input_ranges is not None else '') for i in order]
    ax.set(yticks=range(len(order)), yticklabels=names, xlabel=output_label)
    ax.legend(frameon=False, loc='lower right')
    ax.set_title(f'Bars start at the baseline output {base:.4g}; sorted by largest departure', fontsize=9)
    return fig


# F22: Morris mu* (importance) against sigma (nonlinearity or interaction).
def morris_plot(mu_star, sigma, labels, *, mu_star_lower=None, mu_star_upper=None):
    mu_star, sigma = _vectors(mu_star, sigma)
    labels = _labels(labels, len(mu_star), 'input label')
    if np.any(mu_star < 0) or np.any(sigma < 0):
        raise ValueError('mu* and sigma are nonnegative by definition.')
    fig, ax = _axes('Morris screening · elementary effects')
    top = max(mu_star.max(), sigma.max())
    if mu_star_lower is not None:
        low, high = _interval(mu_star_lower, mu_star_upper)
        ax.errorbar(mu_star, sigma, xerr=[mu_star - low, high - mu_star], fmt='none',
                    ecolor=GRAY, elinewidth=.8, capsize=2)
        top = max(top, high.max())
    ax.scatter(mu_star, sigma, s=36, c=BLUE, zorder=3)
    top = top * 1.15 or 1
    for ratio, style in [(.1, ':'), (.5, '--'), (1, '-')]:
        ax.plot([0, top], [0, ratio * top], ls=style, c=GRAY, lw=.8)
        ax.annotate(f'σ/μ* = {ratio:g}', (top, min(ratio * top, top)), fontsize=8, color=GRAY,
                    ha='right', va='bottom')
    for x, y, name in zip(mu_star, sigma, labels):
        ax.annotate(name, (x, y), xytext=(4, 4), textcoords='offset points', fontsize=8)
    ax.set(xlim=(0, top), ylim=(0, top), xlabel='μ* (mean |elementary effect|)',
           ylabel='σ (std of elementary effects)')
    ax.set_title('Right: influential · up: nonlinear or interacting; rays are guides', fontsize=9)
    return fig


# F23: median and IQR across independent runs; best_so_far=False for stress curves.
def convergence_band(histories, labels, *, x=None, best_so_far=True, goal='min',
                     value_label='Objective', x_label='Iteration', log_y=False):
    labels = _labels(labels, len(histories), 'method label')
    if goal not in {'min', 'max'}:
        raise ValueError("goal must be 'min' or 'max'.")
    fig, ax = _axes('Convergence across independent runs' if best_so_far else 'Response across runs')
    for k, (runs, name) in enumerate(zip(histories, labels)):
        runs = _matrix(runs, 'runs × steps histories')
        if best_so_far:
            runs = (np.minimum if goal == 'min' else np.maximum).accumulate(runs, axis=1)
        steps = np.arange(1, runs.shape[1] + 1) if x is None else _vectors(x)[0]
        if len(steps) != runs.shape[1]:
            raise ValueError('x must have one value per step.')
        color = PALETTE[k % len(PALETTE)]
        if runs.shape[0] <= 30:
            ax.plot(steps, runs.T, c=color, lw=.5, alpha=.18)
        q1, median, q3 = np.percentile(runs, [25, 50, 75], axis=0)
        ax.fill_between(steps, q1, q3, color=color, alpha=.25, lw=0)
        ax.plot(steps, median, c=color, lw=1.8, label=f'{name} (n={runs.shape[0]})')
    ax.set(xlabel=x_label, ylabel=('Best-so-far ' if best_so_far else '') + value_label)
    if log_y:
        ax.set_yscale('log')
    ax.legend(frameon=False)
    ax.set_title('Lines: median · bands: interquartile range of runs, not a confidence interval',
                 fontsize=9)
    return fig


# F24: rank changes across periods or scenarios; rank 1 is the best.
def bump_chart(ranks, item_labels, period_labels, *, highlight=()):
    ranks = _matrix(ranks, 'items × periods ranks')
    items = _labels(item_labels, ranks.shape[0], 'item label')
    periods = _labels(period_labels, ranks.shape[1], 'period label')
    if np.any(ranks < 1):
        raise ValueError('Ranks start at 1 (best).')
    fig, ax = _axes('Rank changes')
    steps = np.arange(ranks.shape[1])
    # Color the highlighted items, or every item when few enough to tell apart.
    colored = list(highlight) if highlight else list(range(len(items))) if len(items) <= len(PALETTE) else []
    for i, row in enumerate(ranks):
        on = i in colored
        color = PALETTE[colored.index(i) % len(PALETTE)] if on else '#BBBBBB'
        ax.plot(steps, row, '-o', c=color, lw=2.2 if on else 1, ms=5, zorder=3 if on else 2)
        ax.annotate(items[i], (steps[-1], row[-1]), xytext=(6, 0), textcoords='offset points',
                    va='center', fontsize=8, color=color if on else GRAY)
        ax.annotate(f'{items[i]}  {row[0]:g}', (0, row[0]), xytext=(-6, 0), textcoords='offset points',
                    va='center', ha='right', fontsize=8, color=color if on else GRAY)
    ax.set(xticks=steps, xticklabels=periods, yticks=[])
    ax.set_ylim(ranks.max() + .5, .5)
    ax.spines[['left', 'bottom']].set_visible(False)
    ax.set_title('Left labels give the starting rank; 1 is the best', fontsize=9)
    ax.tick_params(length=0)
    return fig


# F25: n quantile dots of a predictive sample; each dot is a 1/n chance.
def quantile_dotplot(samples, *, value_label, n_dots=50, threshold=None):
    samples, = _vectors(samples)
    if len(samples) < n_dots:
        raise ValueError('Use at least as many predictive draws as dots.')
    q = np.quantile(samples, (np.arange(n_dots) + .5) / n_dots)
    span = (q.max() - q.min()) or abs(q.max()) or 1.0
    for bins in range(min(8, n_dots), n_dots + 1):  # smallest bin count whose tallest stack stays short
        counts, edges = np.histogram(q, bins=bins, range=(q.min() - 1e-9 * span, q.max() + 1e-9 * span))
        if counts.max() / bins <= .3:
            break
    width = edges[1] - edges[0]
    if threshold is not None:  # put the threshold on a bin edge so no dot straddles it
        k = np.arange(np.floor((q.min() - threshold) / width) - 1, np.ceil((q.max() - threshold) / width) + 1)
        edges = threshold + width * k
    which = np.clip(np.searchsorted(edges, q, side='left') - 1, 0, len(edges) - 2)
    counts = np.bincount(which, minlength=len(edges) - 1)
    fig, ax = _axes(f'Quantile dotplot · {n_dots} equally likely outcomes')
    height = np.zeros(len(counts), int)
    for value, b in zip(q, which):
        beyond = threshold is not None and value > threshold
        ax.add_patch(Circle((edges[b] + width / 2, (height[b] + .5) * width), width * .45,
                            color=ORANGE if beyond else BLUE, lw=0))
        height[b] += 1
    used = edges[np.r_[which.min(), which.max() + 1]]
    ax.set(xlim=(used[0] - width, used[1] + width), ylim=(0, (counts.max() + .5) * width),
           xlabel=value_label, yticks=[])
    ax.set_aspect('equal')
    ax.spines['left'].set_visible(False)
    rows = (counts.max() + .5) * width / (used[1] - used[0] + 2 * width)
    fig.set_size_inches(7, 1.5 + 6.2 * rows)  # keep round dots without a tall empty frame
    if threshold is not None:
        ax.axvline(threshold, c='black', lw=.8, ls='--')
        share = np.mean(samples > threshold)
        ax.set_title(f'{np.sum(q > threshold)}/{n_dots} dots above {threshold:g}; '
                     f'all {len(samples)} draws: {share:.1%}', fontsize=9)
    return fig


# F26: P(X > x) from Monte Carlo draws; resolution is limited to 1/n.
def exceedance_curve(samples_by_case, labels, *, value_label, threshold=None, log_y=True):
    labels = _labels(labels, len(samples_by_case), 'case label')
    fig, ax = _axes('Exceedance probability')
    for k, (samples, name) in enumerate(zip(samples_by_case, labels)):
        values = np.sort(_vectors(samples)[0])
        n = len(values)
        prob = 1 - np.arange(1, n + 1) / n
        keep = prob > 0
        label = f'{name} (n={n})'
        if threshold is not None:  # Monte Carlo uncertainty of the estimate: Wilson 95% interval
            hits = int(np.sum(values > threshold))
            p, z = hits / n, 1.96
            mid, half = (p + z * z / (2 * n)), z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
            label += (f': P(> {threshold:g}) = {hits}/{n} = {p:.3g} '
                      f'[{(mid - half) / (1 + z * z / n):.2g}, {(mid + half) / (1 + z * z / n):.2g}]')
        ax.step(values[keep], prob[keep], where='post', c=PALETTE[k % len(PALETTE)], lw=1.6,
                label=label)
    if threshold is not None:
        ax.axvline(threshold, c='black', lw=.8, ls='--')
    if log_y:
        ax.set_yscale('log')
    ax.set(xlabel=value_label, ylabel='Probability of exceeding')
    ax.legend(frameon=False, fontsize=8)
    ax.set_title('Empirical curves; brackets: Wilson 95% Monte Carlo interval; '
                 'below 1/n is not resolved', fontsize=9)
    return fig


# F27: one panel per series with the others as gray context; shared axes by default.
def small_multiples(x, series, panel_labels, *, value_label, ncols=3, sharey=True,
                    lower=None, upper=None, interval_label=None, reference=None):
    x, = _vectors(x)
    series = _matrix(series, 'panels × points series')
    names = _labels(panel_labels, series.shape[0], 'panel label')
    if series.shape[1] != len(x):
        raise ValueError('Each series needs one value per x.')
    if lower is not None:
        if interval_label is None:
            raise ValueError('State what the interval is with interval_label.')
        lower, upper = _matrix(lower, 'lower bounds'), _matrix(upper, 'upper bounds')
        if lower.shape != series.shape or upper.shape != series.shape or np.any(lower > upper):
            raise ValueError('Bounds must match the series and keep lower ≤ upper.')
    nrows = int(np.ceil(len(names) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(7, 1.9 * nrows + .6), sharex=True,
                             sharey=sharey, layout='constrained', squeeze=False)
    fig.suptitle('Small multiples · each series against the others', fontsize=12)
    for i, ax in enumerate(axes.flat):
        if i >= len(names):
            ax.set_visible(False)
            continue
        ax.plot(x, np.delete(series, i, axis=0).T, c='#CCCCCC', lw=.7)
        if lower is not None:
            ax.fill_between(x, lower[i], upper[i], color=BLUE, alpha=.2, lw=0)
        if reference is not None:
            ax.axhline(reference, c='black', lw=.7, ls=':') if np.ndim(reference) == 0 \
                else ax.plot(x, reference, c='black', lw=.7, ls=':')
        ax.plot(x, series[i], c=BLUE, lw=1.6)
        ax.set_title(names[i], fontsize=9, loc='left')
    fig.supylabel(value_label, fontsize=9)
    if lower is not None:
        fig.supxlabel(f'Band: {interval_label}', fontsize=8, color=GRAY)
    return fig


# F28: exact decomposition of a change; include any residual as its own item.
def waterfall(contributions, labels, *, start, start_label, end_label, unit, end=None):
    contributions, = _vectors(contributions)
    labels = _labels(labels, len(contributions), 'contribution label')
    total = start + contributions.sum()
    if end is not None and not np.isclose(end, total, rtol=1e-6, atol=1e-9):
        raise ValueError(f'Start plus contributions is {total:g}, not end={end:g}; add a residual item.')
    fig, ax = _axes('Decomposition of change')
    level = np.concatenate([[start], start + np.cumsum(contributions)])
    ax.bar(0, start, color=GRAY, width=.6)
    for i, c in enumerate(contributions, 1):
        ax.bar(i, c, bottom=level[i - 1], color=BLUE if c >= 0 else ORANGE, width=.6)
        ax.annotate(f'{c:+.3g}', (i, max(level[i - 1], level[i])), xytext=(0, 2),
                    textcoords='offset points', ha='center', fontsize=8)
    ax.bar(len(contributions) + 1, total, color=GRAY, width=.6)
    for i, y in enumerate(level):
        ax.plot([i + .3, i + .7], [y, y], c='black', lw=.6, ls=':')
    ax.set(xticks=range(len(contributions) + 2), xticklabels=[start_label, *labels, end_label],
           ylabel=unit)
    ax.tick_params(axis='x', labelrotation=30)
    low, high = min(level.min(), 0), max(level.max(), 0)
    ax.set_ylim(low - (.06 * (high - low) if low < 0 else 0), high + .12 * (high - low))  # room for labels
    ax.set_title(f'Blue increases · vermillion decreases · {start:.4g} → {total:.4g}', fontsize=9)
    return fig


# F29: schedule bars; lanes are machines or crews, groups are jobs or resources.
def gantt(starts, durations, labels, *, lanes=None, lane_labels=None, groups=None,
          group_labels=None, critical=(), time_label='Time'):
    starts, durations = _vectors(starts, durations)
    labels = _labels(labels, len(starts), 'bar label')
    if np.any(durations < 0):
        raise ValueError('Durations must be nonnegative.')
    if (lanes is None) != (lane_labels is None):
        raise ValueError('Pass lanes and lane_labels together, or neither for one bar per row.')
    lanes = np.arange(len(starts)) if lanes is None else np.asarray(lanes, int)
    lane_names = labels if lane_labels is None else [str(x) for x in lane_labels]
    if len(lanes) != len(starts) or lanes.min() < 0 or lanes.max() >= len(lane_names):
        raise ValueError('Give every bar a lane index into lane_labels.')
    for lane in np.unique(lanes):  # an overlap in one lane means an infeasible or mislabeled plan
        idx = np.flatnonzero(lanes == lane)
        idx = idx[np.argsort(starts[idx])]
        ends = starts[idx] + durations[idx]
        if np.any(starts[idx][1:] < ends[:-1] - 1e-9):
            raise ValueError(f'Bars overlap in lane {lane_names[lane]}; check the schedule or split lanes.')
    fig, ax = _axes('Schedule')
    for i in range(len(starts)):
        g = 0 if groups is None else int(groups[i])
        ax.barh(lanes[i], durations[i], left=starts[i], height=.6, color=PALETTE[g % len(PALETTE)],
                edgecolor='black' if i in critical else 'white', lw=1.4 if i in critical else .5)
        if lane_labels is not None:
            ax.text(starts[i] + durations[i] / 2, lanes[i], labels[i], ha='center', va='center',
                    fontsize=7, color='white', clip_on=True)
    if groups is not None and group_labels is not None:
        for g, name in enumerate(group_labels):
            ax.barh(np.nan, 0, color=PALETTE[g % len(PALETTE)], label=name)
        ax.legend(frameon=False, ncol=min(len(group_labels), 4), loc='upper center',
                  bbox_to_anchor=(.5, -.15))
    finish = (starts + durations).max()
    ax.axvline(finish, c=GRAY, ls=':', lw=.8)
    ax.set(yticks=range(len(lane_names)), yticklabels=lane_names, xlabel=time_label)
    ax.set_ylim(len(lane_names) - .5, -.5)
    ax.set_title(f'Makespan {finish - starts.min():g}' + (' · black outline: critical' if critical else ''),
                 fontsize=9)
    return fig


# F30: ordered node routes over projected coordinates; reports unvisited nodes.
def route_map(node_xy, routes, *, depot=0, labels=None, demand=None, route_labels=None,
              coordinate_label='Coordinate'):
    xy = _matrix(node_xy, 'node coordinates')
    if xy.shape[1] != 2:
        raise ValueError('node_xy must have two columns.')
    routes = [np.asarray(r, int) for r in routes]
    if any(r.min() < 0 or r.max() >= len(xy) for r in routes if len(r)):
        raise ValueError('Route indices must refer to rows of node_xy.')
    fig, ax = _axes('Routes')
    size = 30 if demand is None else 12 + 80 * np.asarray(demand, float) / max(np.max(demand), 1e-12)
    ax.scatter(*xy.T, s=size, c='white', edgecolors=GRAY, zorder=3)
    for k, r in enumerate(routes):
        color = PALETTE[k % len(PALETTE)]
        for a, b in zip(r[:-1], r[1:]):
            ax.annotate('', xy[b], xy[a], arrowprops=dict(arrowstyle='-|>', color=color, lw=1.2,
                                                         shrinkA=4, shrinkB=4))
        ax.plot([], [], c=color, label=route_labels[k] if route_labels else f'Route {k + 1}')
    ax.scatter(*xy[depot], s=90, marker='s', c='black', zorder=4, label='Depot')
    if labels is not None:
        for (x, y), name in zip(xy, labels):
            ax.annotate(str(name), (x, y), xytext=(3, 3), textcoords='offset points', fontsize=7)
    visits = np.concatenate([r for r in routes if len(r)]) if routes else np.array([], int)
    visits = visits[visits != depot]
    missing = len(set(range(len(xy))) - {depot} - set(visits.tolist()))
    repeated = len(visits) - len(set(visits.tolist()))
    ax.set(xlabel=coordinate_label, ylabel=coordinate_label, aspect='equal')
    ax.legend(frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1, 1))
    ax.set_title(f'{len(routes)} routes · unvisited nodes: {missing} · repeat visits: {repeated}', fontsize=9)
    return fig


# F31: streamlines of the caller's vector field, solved trajectories and equilibria.
def phase_portrait(vector_field, x_range, y_range, *, trajectories=(), equilibria=(), stable=(),
                   labels=('x', 'y'), grid=40, nullclines=True):
    X, Y = np.meshgrid(np.linspace(*x_range, grid), np.linspace(*y_range, grid))
    U, V = (np.asarray(a, float) for a in vector_field(X, Y))
    if U.shape != X.shape or V.shape != X.shape:
        raise ValueError('vector_field(X, Y) must return two arrays shaped like X.')
    fig, ax = _axes('Phase portrait')
    speed = np.hypot(U, V)
    ax.streamplot(X, Y, U, V, color=speed, cmap='Greys', density=1.1, linewidth=.7, arrowsize=.8)
    if nullclines:
        ax.contour(X, Y, U, levels=[0], colors=[SKY], linewidths=1, linestyles='--')
        ax.contour(X, Y, V, levels=[0], colors=[AMBER], linewidths=1, linestyles='--')
        ax.plot([], [], '--', c=SKY, label=f'd{labels[0]}/dt = 0')
        ax.plot([], [], '--', c=AMBER, label=f'd{labels[1]}/dt = 0')
    for k, path in enumerate(trajectories):
        path = _matrix(path, 'trajectory points')
        ax.plot(*path[:, :2].T, c=PALETTE[k % 3], lw=1.6)
        ax.plot(*path[0, :2], 'o', c=PALETTE[k % 3], ms=4)
    for k, point in enumerate(equilibria):
        filled = k in stable
        ax.plot(*point, 'o', ms=8, mec='black', mfc='black' if filled else 'white', zorder=4, clip_on=False)
    if len(equilibria):
        ax.plot([], [], 'o', mec='black', mfc='black', label='Stable equilibrium')
        ax.plot([], [], 'o', mec='black', mfc='white', label='Unstable equilibrium')
    ax.set(xlim=x_range, ylim=y_range, xlabel=labels[0], ylabel=labels[1])
    ax.legend(frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1, 1))
    ax.set_title('Gray: flow (darker is faster) · colored: solved trajectories', fontsize=9)
    return fig


# F32: long-run states per parameter after discarding transients; branches are optional.
def bifurcation(parameter, states, *, parameter_label, state_label, branches=()):
    parameter, states = _vectors(parameter, states)
    fig, ax = _axes('Bifurcation diagram')
    ax.scatter(parameter, states, s=.4, c='black', alpha=.35, lw=0, rasterized=True)
    for p, x, is_stable in branches:
        p, x = _vectors(p, x)
        ax.plot(p, x, c=BLUE if is_stable else ORANGE, ls='-' if is_stable else '--', lw=1.4)
    if branches:
        ax.plot([], [], c=BLUE, label='Stable branch')
        ax.plot([], [], '--', c=ORANGE, label='Unstable branch')
        ax.legend(frameon=False, fontsize=8)
    ax.set(xlabel=parameter_label, ylabel=state_label)
    ax.set_title('Dots: simulated long-run states after the transient', fontsize=9)
    return fig


# F33: ICE curves and their mean (partial dependence) over the observed range.
def pdp_ice(grid, ice, *, feature_label, output_label, centered=False, observed=None,
            max_curves=150, seed=0):
    grid, = _vectors(grid)
    ice = _matrix(ice, 'rows × grid ICE curves')
    if ice.shape[1] != len(grid):
        raise ValueError('Each ICE curve needs one value per grid point.')
    if centered:
        ice = ice - ice[:, :1]
    fig, ax = _axes('Partial dependence with individual conditional expectation')
    shown = np.random.default_rng(seed).permutation(len(ice))[:max_curves]
    ax.plot(grid, ice[shown].T, c=GRAY, lw=.5, alpha=.35)
    ax.plot(grid, ice.mean(0), c=BLUE, lw=2.4, label=f'Partial dependence (mean of {len(ice)})')
    if observed is not None:
        obs, = _vectors(observed)
        ax.plot(obs, np.full(len(obs), ax.get_ylim()[0]), '|', c='black', ms=8, alpha=.4)
    ax.set(xlabel=feature_label, ylabel=('Change in ' if centered else '') + output_label)
    ax.legend(frameon=False)
    ax.set_title('Gray: one curve per row · spread means heterogeneous effects · '
                 'model behaviour, not causation', fontsize=9)
    return fig


# F34: SHAP-style summary for any local attribution matrix (rows × features).
def attribution_beeswarm(attributions, feature_values, labels, *, attribution_label,
                         max_features=12):
    attr = _matrix(attributions, 'attributions')
    vals = _matrix(feature_values, 'feature values')
    labels = _labels(labels, attr.shape[1], 'feature label')
    if vals.shape != attr.shape:
        raise ValueError('feature_values must match attributions.')
    order = np.argsort(np.abs(attr).mean(0))[::-1][:max_features][::-1]
    fig, ax = _axes('Attribution summary', )
    fig.set_size_inches(7, max(3, .35 * len(order) + 1.2))
    for row, j in enumerate(order):
        a = attr[:, j]
        rank = _average_rank(vals[:, j])  # color by within-feature rank; ties share a color
        bins = np.round((a - a.min()) / ((np.ptp(a) or 1) / 60)).astype(int)
        offset = np.zeros(len(a))
        for b in np.unique(bins):  # stack points that share an x-bin, alternating up and down
            idx = np.flatnonzero(bins == b)
            k = np.arange(len(idx))
            offset[idx] = (k + 1) // 2 * np.where(k % 2, 1, -1)
        scale = .38 / max(np.abs(offset).max(), 1)
        ax.scatter(a, row + offset * scale, c=rank, cmap=DIVERGING, s=6, lw=0, vmin=0, vmax=1)
    ax.axvline(0, c=GRAY, lw=.8)
    ax.set(yticks=range(len(order)), yticklabels=[labels[j] for j in order], xlabel=attribution_label)
    bar = fig.colorbar(plt.cm.ScalarMappable(Normalize(0, 1), DIVERGING), ax=ax, ticks=[0, 1],
                       aspect=30, pad=.01)
    bar.ax.set_yticklabels(['Low', 'High'])
    bar.set_label('Feature value (rank)', fontsize=8)
    ax.set_title('Sorted by mean |attribution|; explains the model, not the world', fontsize=9)
    return fig


def _average_rank(values):
    """Ranks scaled to [0, 1]; tied values share their average rank."""
    unique, inverse, counts = np.unique(values, return_inverse=True, return_counts=True)
    first = np.r_[0, np.cumsum(counts)[:-1]]
    return (first + (counts - 1) / 2)[inverse] / max(len(values) - 1, 1)


def _roc_pr(y, score):
    order = np.argsort(-score, kind='mergesort')
    y, score = y[order], score[order]
    last = np.r_[np.flatnonzero(np.diff(score)), len(score) - 1]  # one point per distinct score
    tp = np.cumsum(y)[last]
    fp = last + 1 - tp
    tpr = np.r_[0, tp / y.sum()]
    fpr = np.r_[0, fp / (len(y) - y.sum())]
    precision = tp / (tp + fp)
    return fpr, tpr, precision, score[last]


# F35: ROC, precision–recall and the confusion matrix at one stated threshold.
def classifier_diagnostics(y_true, score, *, threshold, class_labels=('Negative', 'Positive')):
    y, score = _vectors(y_true, score)
    if not set(np.unique(y)) <= {0, 1} or len(np.unique(y)) < 2:
        raise ValueError('y_true must contain both classes coded 0 and 1.')
    fpr, tpr, precision, cuts = _roc_pr(y, score)
    recall = tpr[1:]
    auc = np.trapezoid(tpr, fpr) if hasattr(np, 'trapezoid') else np.trapz(tpr, fpr)
    ap = np.sum(np.diff(np.r_[0, recall]) * precision)
    pred = score >= threshold
    cm = np.array([[np.sum(~pred & (y == 0)), np.sum(pred & (y == 0))],
                   [np.sum(~pred & (y == 1)), np.sum(pred & (y == 1))]])
    fig, axes = plt.subplots(1, 3, figsize=(7.6, 2.8), layout='constrained')
    fig.suptitle(f'Classifier diagnostics · n={len(y)}, positives={int(y.sum())}', fontsize=12)
    hits = np.flatnonzero(cuts >= threshold)  # the operating point of score >= threshold
    at = hits[-1] if len(hits) else None
    axes[0].plot(fpr, tpr, c=BLUE, lw=1.6)
    axes[0].plot([0, 1], [0, 1], ':', c=GRAY)
    axes[0].plot(0 if at is None else fpr[at + 1], 0 if at is None else tpr[at + 1], 'o', c=ORANGE)
    axes[0].set(xlabel='False positive rate', ylabel='True positive rate', title=f'(a) ROC, AUC={auc:.3f}',
                aspect='equal', xlim=(0, 1), ylim=(0, 1.01))
    axes[1].step(np.r_[0, recall], np.r_[precision[0], precision], where='pre', c=BLUE, lw=1.6)  # area = AP
    axes[1].axhline(y.mean(), ls=':', c=GRAY)
    if at is not None:
        axes[1].plot(recall[at], precision[at], 'o', c=ORANGE)
    axes[1].set(xlabel='Recall', ylabel='Precision', title=f'(b) PR, AP={ap:.3f}', xlim=(0, 1), ylim=(0, 1.01))
    axes[2].imshow(cm / cm.sum(1, keepdims=True), cmap='Blues', vmin=0, vmax=1)
    for (i, j), count in np.ndenumerate(cm):
        share = count / cm[i].sum()
        axes[2].text(j, i, f'{count}\n{share:.0%}', ha='center', va='center', fontsize=8,
                     color='white' if share > .6 else 'black')
    axes[2].set(xticks=[0, 1], yticks=[0, 1], xticklabels=class_labels, yticklabels=class_labels,
                xlabel='Predicted', ylabel='Actual', title=f'(c) Threshold {threshold:g}')
    return fig


# F36: standard deviation, correlation and centered RMS error against one reference.
def taylor_diagram(reference, predictions, labels):
    ref, = _vectors(reference)
    preds = _matrix(predictions, 'models × observations predictions')
    labels = _labels(labels, preds.shape[0], 'model label')
    if preds.shape[1] != len(ref) or ref.std() == 0:
        raise ValueError('Predictions must align with a non-constant reference.')
    if np.any(preds.std(1) == 0):
        raise ValueError('A constant model has no correlation; report it, e.g. a climatology baseline, '
                         'in a table instead.')
    sd = preds.std(1) / ref.std()
    r = np.array([np.corrcoef(ref, p)[0, 1] for p in preds])
    fig = plt.figure(figsize=(6, 4.6), layout='constrained')
    fig.suptitle('Taylor diagram · normalized by the reference', fontsize=12)
    ax = fig.add_subplot(projection='polar')
    span = np.pi if np.any(r < 0) else np.pi / 2
    ax.set_thetamin(0)
    ax.set_thetamax(np.degrees(span))
    rmax = max(1.5, sd.max() * 1.15)
    theta, rad = np.meshgrid(np.linspace(0, span, 200), np.linspace(0, rmax, 200))
    rms = np.sqrt(rad ** 2 + 1 - 2 * rad * np.cos(theta))
    lines = ax.contour(theta, rad, rms, levels=np.arange(.25, 2.01, .25), colors=GRAY,
                       linewidths=.6, linestyles=':')
    ax.clabel(lines, fmt='%.2g', fontsize=7)
    ax.plot(np.linspace(0, span, 100), np.ones(100), c='black', lw=.7, ls='--')
    ax.plot(0, 1, '*', ms=12, c='black', label='Reference', clip_on=False)
    ax.grid(color='#E3E3E3', lw=.6)
    for k, (s, c, name) in enumerate(zip(sd, r, labels)):
        ax.plot(np.arccos(c), s, 'o', ms=7, c=PALETTE[k % len(PALETTE)],
                label=f'{name}: r={c:.2f}, σ={s:.2f}')
    ticks = np.array([-.99, -.9, -.6, -.3, 0, .3, .6, .8, .9, .95, .99])
    ticks = ticks[np.arccos(ticks) <= span + 1e-9]
    ax.set_thetagrids(np.degrees(np.arccos(ticks)), [f'{t:g}' for t in ticks], fontsize=7)
    ax.set_rlim(0, rmax)
    ax.annotate('Normalized standard deviation', (0, rmax / 2), xytext=(0, -24), textcoords='offset points',
                ha='center', va='top', fontsize=8, annotation_clip=False)
    ax.text(np.radians(np.degrees(span) * .55), rmax * 1.12, 'Correlation', fontsize=8,
            ha='center', rotation=-40 if span < 3 else 0)
    ax.legend(frameon=False, fontsize=7, loc='upper left', bbox_to_anchor=(1.02, 1))
    return fig


# F37: stacked composition through time; shares=True shows percentages of the total.
def composition_area(time, values, labels, *, unit, shares=False, baseline='zero'):
    time, = _vectors(time)
    values = _matrix(values, 'components × time values')
    labels = _labels(labels, values.shape[0], 'component label')
    if values.shape[1] != len(time) or np.any(values < 0):
        raise ValueError('Supply nonnegative components with one value per time.')
    if shares:
        total = values.sum(0)
        if np.any(total <= 0):
            raise ValueError('Shares need a positive total at every time.')
        values = 100 * values / total
    fig, ax = _axes('Composition over time' + (' · share of total' if shares else ''))
    colors = [PALETTE[k % len(PALETTE)] for k in range(len(values))]
    ax.stackplot(time, values, colors=colors, alpha=.85, lw=.4, edgecolor='white', baseline=baseline)
    if baseline == 'zero':  # label each layer directly at its right end when it is thick enough
        top = np.cumsum(values[:, -1])
        for k, name in enumerate(labels):
            if values[k, -1] > .04 * top[-1]:
                ax.annotate(name, (time[-1], top[k] - values[k, -1] / 2), xytext=(4, 0),
                            textcoords='offset points', va='center', fontsize=8, color=colors[k])
    else:
        ax.legend(labels, frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1, 1))
        ax.set_yticks([])
    ax.set(xlim=(time[0], time[-1]), ylabel='%' if shares else unit)
    return fig


# F38: daily values on a week × weekday grid per year; missing days stay blank.
def calendar_heatmap(dates, values, *, value_label, cmap='viridis'):
    days = np.asarray(dates, dtype='datetime64[D]')
    values, = _vectors(values)
    if days.ndim != 1 or len(days) != len(values) or len(np.unique(days)) != len(days):
        raise ValueError('Supply one value per distinct date.')
    years = days.astype('datetime64[Y]').astype(int) + 1970
    norm = Normalize(values.min(), values.max())
    fig, axes = plt.subplots(len(np.unique(years)), 1, figsize=(7.5, 1.35 * len(np.unique(years)) + .7),
                             layout='constrained', squeeze=False)
    fig.suptitle('Calendar heatmap', fontsize=12)
    for ax, year in zip(axes[:, 0], np.unique(years)):
        jan1 = np.datetime64(f'{year}-01-01')
        offset = (jan1.astype(int) + 3) % 7  # Monday = 0; 1970-01-01 was a Thursday
        cells = np.full((7, 54), np.nan)
        pick = years == year
        doy = (days[pick] - jan1).astype(int)
        cells[(doy + offset) % 7, (doy + offset) // 7] = values[pick]
        image = ax.imshow(np.ma.masked_invalid(cells), cmap=cmap, norm=norm, aspect='equal')
        starts = [(np.datetime64(f'{year}-{m:02d}-01') - jan1).astype(int) for m in range(1, 13)]
        ax.set_xticks([(s + offset) // 7 for s in starts],
                      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                      fontsize=7)
        ax.set_yticks([0, 2, 4, 6], ['Mon', 'Wed', 'Fri', 'Sun'], fontsize=7)
        ax.set_ylabel(str(year), fontsize=9)
        ax.tick_params(length=0)
        ax.spines[:].set_visible(False)
    bar = fig.colorbar(image, ax=axes[:, 0], shrink=.8, aspect=25, pad=.01)
    bar.set_label(value_label, fontsize=8)
    return fig


# F39: comprehensive evaluation: raw scores, weights, the method's overall score and,
# optionally, rank probabilities under weight perturbation (experiment_kits.rank_stability).
def evaluation_matrix(scores, alternatives, criteria, *, weights, overall, overall_label,
                      benefit=None, value_format='{:.3g}', rank_probability=None):
    scores = _matrix(scores, 'alternatives × criteria scores')
    rows = _labels(alternatives, scores.shape[0], 'alternative')
    cols = _labels(criteria, scores.shape[1], 'criterion')
    weights, = _vectors(weights)
    overall, = _vectors(overall)
    if len(weights) != len(cols) or len(overall) != len(rows):
        raise ValueError('Supply one weight per criterion and one overall score per alternative.')
    benefit = np.ones(len(cols), bool) if benefit is None else np.asarray(benefit, bool)
    if len(benefit) != len(cols):
        raise ValueError('Supply one benefit flag per criterion (False for cost-type).')
    span = np.ptp(scores, 0)
    good = np.where(span > 0, (scores - scores.min(0)) / np.where(span > 0, span, 1), .5)
    good = np.where(benefit, good, 1 - good)  # display only: 1 is the best value of a criterion
    order = np.argsort(-overall)
    ranks = rank_probability is not None
    fig = plt.figure(figsize=(8.4 if ranks else 7, .38 * len(rows) + 2), layout='constrained')
    fig.suptitle('Evaluation matrix · color: within-criterion desirability', fontsize=12)
    axes = fig.subplot_mosaic([['w', '.', '.'], ['m', 'o', 'r']] if ranks else [['w', '.'], ['m', 'o']],
                              width_ratios=[len(cols), 1.8, 2.2][:3 if ranks else 2],
                              height_ratios=[1, max(len(rows) / 2.5, 1.5)])
    axes['w'].bar(range(len(cols)), weights, color=GRAY, width=.6)
    axes['w'].set(xlim=(-.5, len(cols) - .5), xticks=[], ylabel='Weight')
    axes['m'].imshow(good[order], cmap='Blues', vmin=0, vmax=1, aspect='auto')
    for (i, j), v in np.ndenumerate(scores[order]):
        axes['m'].text(j, i, value_format.format(v), ha='center', va='center', fontsize=7,
                       color='white' if good[order][i, j] > .65 else 'black')
    axes['m'].set(xticks=range(len(cols)), yticks=range(len(rows)),
                  xticklabels=[c + ('' if b else ' ↓') for c, b in zip(cols, benefit)],
                  yticklabels=[f'{k + 1}. {rows[i]}' for k, i in enumerate(order)])
    axes['m'].tick_params(axis='x', labelrotation=30)
    axes['o'].barh(range(len(rows)), overall[order], color=BLUE, height=.6)
    axes['o'].set(ylim=(len(rows) - .5, -.5), yticks=[], xlabel=overall_label)
    if ranks:
        prob = _matrix(rank_probability, 'alternatives × ranks probabilities')[order]
        if prob.shape != (len(rows), len(rows)) or not np.allclose(prob.sum(1), 1, atol=1e-6):
            raise ValueError('rank_probability needs one row per alternative summing to 1.')
        shades = plt.cm.Blues_r(np.linspace(0, .85, len(rows)))
        left = np.zeros(len(rows))
        for k in range(len(rows)):
            axes['r'].barh(range(len(rows)), prob[:, k], left=left, color=shades[k], height=.6,
                           label=f'Rank {k + 1}' if len(rows) <= 6 or k in (0, len(rows) // 2, len(rows) - 1) else None)
            left += prob[:, k]
        axes['r'].set(xlim=(0, 1), ylim=(len(rows) - .5, -.5), yticks=[], xlabel='Rank probability')
        axes['r'].legend(frameon=False, fontsize=7, loc='upper center', bbox_to_anchor=(.5, -.28),
                         ncol=3, columnspacing=.8, handlelength=1.2)
    return fig


def _ternary_xy(fractions):
    return np.c_[fractions[:, 1] + fractions[:, 2] / 2, fractions[:, 2] * np.sqrt(3) / 2]


# F40: three-part compositions that sum to one, e.g. an energy or land-use mix.
def ternary(fractions, axis_labels, *, groups=None, group_labels=None, values=None,
            value_label=None, path=False):
    fractions = _matrix(fractions, 'rows × 3 fractions')
    if fractions.shape[1] != 3 or np.any(fractions < 0) or not np.allclose(fractions.sum(1), 1, atol=1e-6):
        raise ValueError('Each row needs three nonnegative parts summing to 1; normalize and disclose first.')
    fig, ax = _axes('Ternary composition')
    corners = np.array([[0, 0], [1, 0], [.5, np.sqrt(3) / 2]])
    ax.add_patch(Polygon(corners, closed=True, fill=False, ec='black', lw=.8))
    for t in np.arange(.2, 1, .2):  # grid lines of constant share for each part
        for k in range(3):
            a, b = np.zeros(3), np.zeros(3)
            a[k] = b[k] = t
            a[(k + 1) % 3], b[(k + 2) % 3] = 1 - t, 1 - t
            ax.plot(*_ternary_xy(np.array([a, b])).T, c='#DDDDDD', lw=.6, zorder=0)
            ax.annotate(f'{t:.1f}', _ternary_xy(a[None])[0], fontsize=6, color=GRAY,
                        ha='center', va='center', xytext=(0, -6) if k == 0 else (6, 0) if k == 1 else (-6, 0),
                        textcoords='offset points')
    for corner, name, ha, va in zip(corners, axis_labels, ['right', 'left', 'center'],
                                    ['top', 'top', 'bottom']):
        ax.annotate(name, corner, xytext=(0, 6 if va == 'bottom' else -6), textcoords='offset points',
                    ha=ha, va=va, fontsize=9)
    for (x, y), name, angle in zip([(.5, -.1), (.88, .51), (.12, .51)], axis_labels, [0, -60, 60]):
        ax.text(x, y, f'{name} share', rotation=angle, ha='center', va='center', fontsize=7, color=GRAY)
    xy = _ternary_xy(fractions)
    if path:
        ax.plot(*xy.T, c=GRAY, lw=.8, zorder=1)
    if values is not None:
        shown = ax.scatter(*xy.T, c=_vectors(values)[0], cmap='viridis', s=28, zorder=2)
        fig.colorbar(shown, ax=ax, shrink=.7).set_label(value_label or 'Value', fontsize=8)
    elif groups is not None:
        groups = np.asarray(groups, int)
        for g in np.unique(groups):
            name = group_labels[g] if group_labels is not None else f'Group {g}'
            ax.scatter(*xy[groups == g].T, s=28, c=PALETTE[g % len(PALETTE)], label=name, zorder=2)
        ax.legend(frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(.9, 1))
    else:
        ax.scatter(*xy.T, s=28, c=BLUE, zorder=2)
    ax.set(xlim=(-.08, 1.08), ylim=(-.13, .95), aspect='equal')
    ax.axis('off')
    ax.set_title('Each point is one composition; corners are 100% of one part', fontsize=9)
    return fig


# F41: rank uncertainty, e.g. rank_stability's median rank and 5–95% rank interval.
def rank_caterpillar(median_rank, lower, upper, labels, *, interval_label, base_rank=None):
    median_rank, = _vectors(median_rank)
    lower, upper = _interval(lower, upper)
    labels = _labels(labels, len(median_rank), 'item label')
    if len(lower) != len(median_rank):
        raise ValueError('Supply one rank interval per item.')
    order = np.lexsort((upper, median_rank))[::-1]  # best (rank 1) ends at the top
    fig, ax = _axes('Rank uncertainty')
    fig.set_size_inches(7, max(3, .3 * len(order) + 1.3))
    rows = np.arange(len(order))
    ax.hlines(rows, lower[order], upper[order], color=BLUE, lw=2.2, alpha=.45)
    ax.plot(median_rank[order], rows, 'o', c=BLUE, ms=6, label='Median rank')
    if base_rank is not None:
        base, = _vectors(base_rank)
        ax.plot(base[order], rows, 'D', mfc='none', mec='black', ms=8, label='Rank at the base weights')
    ax.set(yticks=rows, yticklabels=[labels[i] for i in order], xlabel='Rank (1 = best)')
    ax.set_xlim(.5, max(upper.max(), len(order)) + .5)
    ax.legend(frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1, 1))
    ax.set_title(f'Bars: {interval_label}', fontsize=9)
    return fig


# F42: backtest error by horizon (e.g. rolling_origin errors), optional interval coverage.
def backtest_errors(errors, labels, *, metric='mae', coverage=None, nominal=None,
                    horizon_label='Forecast horizon', error_label='forecast error'):
    labels = _labels(labels, len(errors), 'model label')
    if metric not in {'mae', 'rmse'}:
        raise ValueError("metric is 'mae' or 'rmse'.")
    if coverage is not None and nominal is None:
        raise ValueError('State the nominal coverage of the intervals, e.g. nominal=0.9.')
    panels = 2 if coverage is not None else 1
    fig, axes = plt.subplots(1, panels, figsize=(7.4 if panels == 2 else 7, 3.4), layout='constrained',
                             squeeze=False)
    fig.suptitle('Rolling-origin backtest', fontsize=12)
    ax = axes[0, 0]
    for k, (err, name) in enumerate(zip(errors, labels)):
        err = _matrix(err, 'origins × horizons errors')
        h = np.arange(1, err.shape[1] + 1)
        size = np.abs(err) if metric == 'mae' else err ** 2
        center = size.mean(0) if metric == 'mae' else np.sqrt(size.mean(0))
        color = PALETTE[k % len(PALETTE)]
        if metric == 'mae':  # spread of the per-origin absolute errors
            q1, q3 = np.percentile(size, [25, 75], axis=0)
            ax.fill_between(h, q1, q3, color=color, alpha=.18, lw=0)
        ax.plot(h, center, '-o', c=color, ms=4, label=f'{name} ({err.shape[0]} origins)')
    ax.set(xlabel=horizon_label, ylabel=f'{metric.upper()} of {error_label}')  # user text kept as given
    ax.set_title('(a) Error by horizon\nline: ' + metric.upper() +
                 (' · band: middle 50% of per-origin |errors|' if metric == 'mae' else ''), fontsize=9)
    ax.legend(frameon=False, fontsize=8)
    if coverage is not None:
        ax = axes[0, 1]
        for k, (cov, name) in enumerate(zip(coverage, labels)):
            if cov is None:  # models without intervals keep their color slot
                continue
            cov, = _vectors(cov)
            ax.plot(np.arange(1, len(cov) + 1), cov, '-o', c=PALETTE[k % len(PALETTE)], ms=4, label=name)
        ax.axhline(nominal, c='black', ls='--', lw=.8)
        ax.legend(frameon=False, fontsize=8, loc='lower left')
        ax.set(xlabel=horizon_label, ylabel='Empirical coverage', ylim=(0, 1.02))
        ax.set_title(f'(b) Interval coverage\nnominal {nominal:.0%} (dashed)', fontsize=9)
    return fig


# F43: one-at-a-time response curves (oat_sweep grid and output) on a common x-scale.
def spider_plot(grid, output, labels, *, base_input, base_output, output_label, scale='percent'):
    grid, output = _matrix(grid, 'inputs × points grid'), _matrix(output, 'inputs × points output')
    labels = _labels(labels, grid.shape[0], 'input label')
    base_input, = _vectors(base_input)
    if output.shape != grid.shape or len(base_input) != len(grid):
        raise ValueError('grid and output must match, with one baseline per input.')
    if scale == 'percent':
        if np.any(base_input == 0):
            raise ValueError("A zero baseline has no percent change; use scale='range'.")
        x = 100 * (grid - base_input[:, None]) / np.abs(base_input[:, None])
        x_label = 'Change in input from baseline (%)'
    elif scale == 'range':  # the farther interval end maps to ±1; both sides share one scale
        span = np.maximum(base_input - grid.min(1), grid.max(1) - base_input)
        x = (grid - base_input[:, None]) / np.where(span > 0, span, 1)[:, None]
        x_label = 'Input change, scaled so the farther interval end is ±1'
    else:
        raise ValueError("scale is 'percent' or 'range'.")
    fig, ax = _axes('Spider plot · one input varied at a time')
    for k, name in enumerate(labels):
        ax.plot(x[k], output[k], c=PALETTE[k % len(PALETTE)], lw=1.6, label=name)
    ax.axhline(base_output, c=GRAY, lw=.8, ls=':')
    ax.axvline(0, c=GRAY, lw=.8, ls=':')
    ax.plot(0, base_output, 'o', c='black', ms=5, zorder=4)
    ax.set(xlabel=x_label, ylabel=output_label)
    ax.legend(frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1, 1))
    ax.set_title('Steeper lines are more influential; curvature shows non-linearity', fontsize=9)
    return fig


# F44: Dolan–Moré performance profile over many instances; lower cost is better.
def performance_profile(costs, solver_labels, *, tau_max=None, log_x=True, cost_label='cost'):
    costs = np.asarray(costs, dtype=float)
    if costs.ndim != 2 or 0 in costs.shape or np.isnan(costs).any() or np.any(costs <= 0):
        raise ValueError('Supply positive instances × solvers costs; use np.inf for failed runs.')
    labels = _labels(solver_labels, costs.shape[1], 'solver label')
    best = costs.min(1)
    if not np.isfinite(best).all():
        raise ValueError('Every instance needs at least one solver that succeeded.')
    ratio = costs / best[:, None]
    finite = ratio[np.isfinite(ratio)]
    top = tau_max or max(finite.max() * 1.1, 1.1)
    fig, ax = _axes(f'Performance profile · {costs.shape[0]} instances')
    taus = np.unique(np.r_[1, np.sort(finite), top])
    for k, name in enumerate(labels):
        share = [(ratio[:, k] <= t).mean() for t in taus]
        ax.step(taus, share, where='post', c=PALETTE[k % len(PALETTE)], lw=1.6,
                label=f'{name}: best on {np.mean(ratio[:, k] == 1):.0%}, failed {np.mean(~np.isfinite(costs[:, k])):.0%}')
    if log_x:
        ax.set_xscale('log')
    ax.set(xlim=(1, top), ylim=(0, 1.02), xlabel=f'τ: {cost_label} within a factor of the best',
           ylabel='Share of instances')
    ax.legend(frameon=False, fontsize=8, loc='lower right')
    ax.set_title('Left edge: how often each is best · right side: robustness', fontsize=9)
    return fig


def _spread(y, gap):
    """Label positions at least gap apart; only labels that would overlap move.

    Adjacent clusters merge while they are closer than gap; each cluster is laid
    out evenly around the mean of its data values, so isolated labels stay put.
    """
    y = np.asarray(y, float)
    order = np.argsort(y, kind='stable')
    data = y[order]
    clusters = [[i] for i in range(len(data))]
    merged = True
    while merged:
        merged = False
        for k in range(len(clusters) - 1):
            a, b = clusters[k], clusters[k + 1]
            top = data[a].mean() + (len(a) - 1) * gap / 2
            bottom = data[b].mean() - (len(b) - 1) * gap / 2
            if bottom - top < gap:
                clusters[k:k + 2] = [a + b]
                merged = True
                break
    out = np.empty(len(data))
    for c in clusters:
        out[c] = data[c].mean() + (np.arange(len(c)) - (len(c) - 1) / 2) * gap
    result = np.empty_like(out)
    result[order] = out
    return result


# F45: two states per item (before/after, scenario A/B); up and down get different colors.
def slope_chart(start, end, labels, *, start_label, end_label, value_label, highlight=()):
    start, end = _vectors(start, end)
    labels = _labels(labels, len(start), 'item label')
    fig, ax = _axes('Change between two states')
    fig.set_size_inches(6, 4.6)
    gap = .035 * (max(start.max(), end.max()) - min(start.min(), end.min()) or 1)
    left, right = _spread(start, gap), _spread(end, gap)
    for i in range(len(start)):
        up = end[i] >= start[i]
        color = (BLUE if up else ORANGE) if not highlight or i in highlight else '#C8C8C8'
        ax.plot([0, 1], [start[i], end[i]], '-o', c=color, lw=1.8 if i in highlight else 1.2, ms=4)
        ax.text(-.04, left[i], f'{labels[i]}  {start[i]:.3g}', ha='right', va='center', fontsize=8, color=color)
        ax.text(1.04, right[i], f'{end[i]:.3g}  {labels[i]}', ha='left', va='center', fontsize=8, color=color)
    ax.set(xlim=(-.6, 1.6), xticks=[0, 1], xticklabels=[start_label, end_label], ylabel=value_label)
    ax.spines['bottom'].set_visible(False)
    ax.tick_params(axis='x', length=0)
    ax.set_title('Blue: increase · vermillion: decrease', fontsize=9)
    return fig


# F46: network as an ordered adjacency matrix; ordering reveals blocks that node-link hides.
def adjacency_matrix(weights, labels, *, order='cluster', value_label='Weight', directed=False, log=False):
    W = _matrix(weights, 'adjacency')
    labels = _labels(labels, W.shape[0], 'node label')
    if W.shape[0] != W.shape[1] or np.any(W < 0):
        raise ValueError('Supply a square, nonnegative adjacency matrix.')
    positive = W[W > 0]
    if log and not len(positive):
        raise ValueError('A log color scale needs at least one positive weight.')
    if order == 'cluster' and len(W) < 3:  # too few nodes to cluster; keep the input order
        idx = np.arange(len(W))
    elif order == 'cluster':  # average linkage on Jaccard distances between neighbourhoods (SciPy)
        from scipy.cluster.hierarchy import leaves_list, linkage
        from scipy.spatial.distance import pdist
        linked = (W > 0) | (W.T > 0) | np.eye(len(W), dtype=bool)
        idx = leaves_list(linkage(pdist(linked, 'jaccard'), method='average'))
    elif order == 'degree':
        idx = np.argsort(-(W.sum(0) + W.sum(1)), kind='stable')
    elif order is None:
        idx = np.arange(len(W))
    else:
        raise ValueError("order is 'cluster', 'degree' or None.")
    fig, ax = _axes(f'Adjacency matrix · {len(W)} nodes, ordered by {order or "input"}')
    fig.set_size_inches(6.4, 5.6)
    norm = LogNorm(positive.min(), positive.max()) if log else \
        Normalize(0, positive.max() if len(positive) else 1)
    ax.set_facecolor('white')
    shown = ax.imshow(np.ma.masked_equal(W[np.ix_(idx, idx)], 0), cmap=TINTED_BLUES, norm=norm)
    ticks = range(len(W)) if len(W) <= 40 else []
    ax.set(xticks=ticks, yticks=ticks, xlabel='Target' if directed else 'Node',
           ylabel='Source' if directed else 'Node')
    if len(W) <= 40:
        ax.set_xticklabels([labels[i] for i in idx], rotation=90, fontsize=7)
        ax.set_yticklabels([labels[i] for i in idx], fontsize=7)
    ax.spines[:].set_visible(True)
    fig.colorbar(shown, ax=ax, shrink=.8).set_label(value_label + (' (log scale)' if log else ''), fontsize=8)
    ax.set_title('White cells: no edge', fontsize=9)
    return fig
