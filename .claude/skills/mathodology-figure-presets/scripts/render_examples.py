#!/usr/bin/env python3
"""Render six original synthetic figure examples; no downloaded code is executed.

Requires numpy and matplotlib. Run with --output DIRECTORY or --self-test.
The seed reproduces inputs; image bytes may vary with fonts/library versions.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import tempfile

BLUE, ORANGE, GREEN, GRAY = '#0072B2', '#D55E00', '#009E73', '#7A7A7A'


def dependencies():
    global np, plt
    try:
        import numpy as np
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise SystemExit('Install dependencies in an isolated environment: '
                         'python3 -m pip install numpy matplotlib') from exc
    plt.rcParams.update({'font.size': 9, 'axes.titlesize': 10,
                         'axes.labelsize': 9, 'legend.fontsize': 8,
                         'font.family': 'DejaVu Sans', 'axes.spines.top': False,
                         'axes.spines.right': False, 'pdf.fonttype': 42,
                         'svg.fonttype': 'none', 'axes.titlelocation': 'left'})


def canvas(title, height=3.6):
    fig = plt.figure(figsize=(7, height), layout='constrained')
    fig.suptitle(title, fontsize=11, fontweight='bold')
    fig.supxlabel('Synthetic demonstration · not contest evidence',
                  fontsize=8, color=GRAY)
    return fig


def mosaic(rng):
    x = np.linspace(0, 12, 48)
    baseline = 8 + .45 * x
    mean = baseline + 1.5 * np.sin(x / 2)
    y = mean + rng.normal(0, .6, x.size)
    fig = canvas('F01 · One question, complementary evidence', 4.3)
    axes = fig.subplot_mosaic([['main', 'error'], ['main', 'resid']],
                              gridspec_kw={'width_ratios': [1.9, 1]})
    ax = axes['main']
    ax.scatter(x, y, s=12, color=GRAY, alpha=.7, label='Synthetic observations')
    ax.plot(x, baseline, '--', color=ORANGE, label='Linear reference')
    ax.plot(x, mean, color=BLUE, label='Known generating mean')
    ax.set(xlabel='Time (arbitrary units)', ylabel='Response (arbitrary units)',
           title='(a) Structure and observations')
    ax.legend(loc='upper left', frameon=False)
    error = [np.mean(abs(y - baseline)), np.mean(abs(y - mean))]
    axes['error'].barh(['Reference', 'Known mean'], error, color=[ORANGE, BLUE])
    axes['error'].set(xlabel='Mean absolute error', title='(b) Descriptive error')
    axes['error'].set_xlim(0, max(error) * 1.25)
    ax = axes['resid']
    ax.axhline(0, color=GRAY, lw=.8)
    ax.scatter(x, y - mean, s=10, color=BLUE)
    ax.set(xlabel='Time', ylabel='Residual', title='(c) Residual structure')
    return fig


def forecast(rng):
    t = np.linspace(0, 16, 121)
    mean = 3 + .5 * t + .8 * np.sin(t / 2)
    sd = .4 + .035 * t
    future = t >= 8
    fig = canvas('F02 · Separate a trajectory from its uncertainty')
    ax = fig.subplots()
    ax.fill_between(t[future], (mean - 1.9599639845 * sd)[future],
                    (mean + 1.9599639845 * sd)[future], color=BLUE, alpha=.14,
                    label='95% pointwise predictive interval')
    ax.fill_between(t[future], (mean - .6744897502 * sd)[future],
                    (mean + .6744897502 * sd)[future], color=BLUE, alpha=.3,
                    label='50% pointwise predictive interval')
    ax.plot(t, mean, color=BLUE, lw=1.6, label='Known generating mean')
    past = ~future
    ax.scatter(t[past][::3], (mean + rng.normal(size=t.size) * sd)[past][::3],
               color=GRAY, s=15, label='Synthetic observations')
    ax.axvline(8, color=GRAY, ls=':', lw=1)
    ax.set(xlabel='Time (arbitrary units)', ylabel='Response (arbitrary units)')
    ax.legend(loc='upper left', frameon=False)
    return fig


def raincloud(rng):
    fig = canvas('F03 · Observations, distributions and summaries')
    ax = fig.subplots()
    samples = [rng.normal(0, .65, 65), rng.normal(.8, .9, 80),
               np.r_[rng.normal(.1, .45, 45), rng.normal(1.5, .45, 35)]]
    for i, (values, color) in enumerate(zip(samples, [BLUE, ORANGE, GREEN])):
        bandwidth = 1.06 * values.std(ddof=1) * len(values) ** (-.2)
        grid = np.linspace(values.min() - bandwidth * 3,
                           values.max() + bandwidth * 3, 240)
        density = np.exp(-.5 * ((grid[:, None] - values) / bandwidth) ** 2).mean(1)
        density /= bandwidth * np.sqrt(2 * np.pi)
        ax.fill_between(grid, i + .13, i + .13 + .4 * density,
                        color=color, alpha=.35, lw=.5)
        ax.scatter(values, i - .12 + rng.uniform(-.05, .05, len(values)),
                   s=10, color=color, alpha=.55, edgecolors='none')
        q1, med, q3 = np.quantile(values, [.25, .5, .75])
        ax.plot([q1, q3], [i, i], color=color, lw=3)
        ax.scatter([med], [i], s=23, color='white', edgecolors=color, zorder=4)
    ax.set(yticks=range(3), yticklabels=['A (n=65)', 'B (n=80)', 'C (n=80)'],
           xlabel='Measured value (arbitrary units)', ylim=(-.4, 2.8))
    ax.text(.02, .98, 'Dots: observations · thick line: IQR · white point: median',
            transform=ax.transAxes, va='top', fontsize=8)
    return fig


def nondominated(values):
    """Both columns minimized; duplicates remain equally non-dominated."""
    return np.array([not np.any(np.all(values <= row, axis=1) &
                                np.any(values < row, axis=1)) for row in values])


def pareto(rng):
    cost = rng.uniform(2, 10, 80)
    loss = 13 / cost + rng.uniform(0, 1.8, cost.size)
    points = np.column_stack([cost, loss])
    front = nondominated(points)
    eligible = np.flatnonzero(cost <= 6)
    selected = eligible[np.argmin(loss[eligible])]
    fig = canvas('F10 · Make the cost of a recommendation visible')
    ax = fig.subplots()
    ax.scatter(cost[~front], loss[~front], color=GRAY, alpha=.3, s=20,
               label='Other evaluated feasible plans')
    ax.scatter(cost[front], loss[front], color=BLUE, s=32,
               label='Non-dominated evaluated plans')
    ax.scatter(cost[selected], loss[selected], color=ORANGE, marker='*', s=140,
               label='Lowest loss with cost ≤ 6', zorder=5)
    ax.axvline(6, color=GRAY, ls=':', label='Illustrative budget: 6')
    ax.set(xlabel='Cost (lower is better)', ylabel='Loss (lower is better)')
    ax.legend(frameon=False, loc='upper right')
    return fig


def sensitivity_indices():
    # f = x1 + 0.7*x2 + 0.8*x1*x2 + 0.2*x3, independent U(-1,1).
    main_variance = np.array([1, .7**2, .2**2]) / 3
    interaction = .8**2 / 9
    total_variance = main_variance.sum() + interaction
    first = main_variance / total_variance
    total = (main_variance + [interaction, interaction, 0]) / total_variance
    return first, total


def sensitivity(rng):
    first, total = sensitivity_indices()
    fig = canvas('F16 · Main effects and interactions')
    ax, note = fig.subplots(1, 2, gridspec_kw={'width_ratios': [3.2, 1.6]})
    y = np.arange(3)
    ax.barh(y + .17, first, height=.28, color=BLUE, label='First-order index')
    ax.barh(y - .17, total, height=.28, color=ORANGE, label='Total-order index')
    ax.set(yticks=y, yticklabels=['x₁', 'x₂', 'x₃'], xlim=(0, 1),
           xlabel='Fraction of output variance')
    ax.invert_yaxis()
    note.axis('off')
    note.text(0, .97, 'Exact analytic indices\n\nIndependent inputs\nx₁, x₂, x₃ ~ U(−1, 1)\n\n'
              'f = x₁ + 0.7x₂\n    + 0.8x₁x₂ + 0.2x₃\n\nNo sampling intervals',
              va='top', fontsize=8)
    note.legend(*ax.get_legend_handles_labels(), loc='lower left', frameon=False)
    return fig


def scenarios(rng):
    values = np.array([[2, 3, 8, 10, 12, 16], [4, 4, 6, 7, 9, 10],
                       [6, 5, 5, 6, np.nan, 8], [7, 7, 7, 8, 8, 8.]])
    feasible = np.ones_like(values, dtype=bool)
    feasible[0, -1] = False
    names = ['Lean', 'Balanced', 'Flexible', 'Reserve']
    complete = np.isfinite(values).all(axis=1) & feasible.all(axis=1)
    candidates = np.flatnonzero(complete)
    selected = candidates[np.argmin(values[candidates].max(axis=1))]
    fig = canvas('F20 · Test a decision across adverse scenarios', 3.9)
    ax = fig.subplots()
    cmap = plt.get_cmap('cividis').copy()
    cmap.set_bad('#e7e7e7')
    masked = np.ma.masked_where(~feasible | ~np.isfinite(values), values)
    im = ax.imshow(masked, cmap=cmap, vmin=0, vmax=16, aspect='auto')
    for row in range(4):
        for col in range(6):
            value = values[row, col]
            label = '×' if not feasible[row, col] else ('—' if np.isnan(value) else f'{value:.0f}')
            color = 'white' if feasible[row, col] and np.isfinite(value) and value < 8 else '#222222'
            ax.text(col, row, label, ha='center', va='center', color=color, fontsize=10)
    ax.set(yticks=range(4), yticklabels=names, xticks=range(6),
           xticklabels=['Low\ndemand', 'Typical', 'Peak', 'Delay', 'Supply\nshock', 'Mixed\nshock'])
    fig.colorbar(im, ax=ax, label='Loss (lower is better)', shrink=.9)
    ax.set_xlabel(f'× Infeasible · — Missing\nMinimax among complete feasible rows: {names[selected]}')
    return fig


BUILDERS = [('f01-mosaic', mosaic), ('f02-forecast', forecast),
            ('f03-raincloud', raincloud), ('f10-pareto', pareto),
            ('f16-sensitivity', sensitivity), ('f20-scenarios', scenarios)]


def render(output, seed=20260907):
    output.mkdir(parents=True, exist_ok=True)
    for index, (name, build) in enumerate(BUILDERS):
        fig = build(np.random.default_rng(seed + index))
        fig.savefig(output / f'{name}.png', dpi=180)
        fig.savefig(output / f'{name}.pdf')
        plt.close(fig)
    return [output / f'{name}.png' for name, _ in BUILDERS]


def self_test():
    # Numerical checks exercise the meanings used in the two decision figures.
    assert nondominated(np.array([[1, 3], [2, 2], [3, 1], [3, 3], [2, 2]])).tolist() == [True, True, True, False, True]
    first, total = sensitivity_indices()
    assert np.all(first <= total) and np.all(total <= 1)
    assert np.isclose(first.sum() + (total[0] - first[0]), 1)
    with tempfile.TemporaryDirectory() as tmp:
        paths = render(Path(tmp))
        assert len(paths) == 6
        for path in paths:
            assert path.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            assert path.with_suffix('.pdf').read_bytes().startswith(b'%PDF-')
    print('PASS: numerical checks and six PNG/PDF example renders')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('work/figure-examples'))
    parser.add_argument('--seed', type=int, default=20260907)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    dependencies()
    if args.self_test:
        self_test()
    else:
        for path in render(args.output, args.seed):
            print(path)


if __name__ == '__main__':
    main()
