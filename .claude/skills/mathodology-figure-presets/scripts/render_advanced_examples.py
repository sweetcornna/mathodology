#!/usr/bin/env python3
"""Render synthetic previews of templates F21–F46 and check the experiment kits.

Runs only this skill's own templates/advanced_templates.py and
templates/experiment_kits.py on clearly labeled synthetic inputs. Requires
numpy, matplotlib and scipy (for the F46 cluster ordering and profile kit). Use --output DIRECTORY,
--dpi N, --only F21,F30 or --self-test. Values here are never contest evidence.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys
import tempfile

TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'
LABEL = 'Synthetic demonstration · not contest evidence'


def dependencies():
    global np, plt, T, K, matplotlib
    try:
        import numpy as np
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise SystemExit('Install dependencies in an isolated environment: '
                         'python3 -m pip install numpy matplotlib scipy') from exc
    plt.rcParams.update({'figure.max_open_warning': 0, 'font.size': 9, 'axes.titlesize': 10, 'axes.labelsize': 9,
                         'legend.fontsize': 8, 'font.family': 'DejaVu Sans',
                         'axes.spines.top': False, 'axes.spines.right': False,
                         'pdf.fonttype': 42, 'svg.fonttype': 'none', 'axes.titlelocation': 'left'})
    sys.path.insert(0, str(TEMPLATES))
    import advanced_templates as T
    import experiment_kits as K


def ishigami(x, a=7., b=.1):
    """Standard sensitivity test function; the fourth input is a deliberate dummy."""
    return np.sin(x[0]) + a * np.sin(x[1]) ** 2 + b * x[2] ** 4 * np.sin(x[0])


NAMES = ['x1', 'x2', 'x3', 'x4 (dummy)']


def bounds():
    return [(-np.pi, np.pi)] * 3 + [(-1., 1.)]


def order_cost(x, base=(10000, 50, 4)):
    """Annual ordering + holding cost when the order size m·Q0 was fixed from baseline estimates."""
    demand, setup, holding, m = x
    q = m * np.sqrt(2 * base[0] * base[1] / base[2])
    return demand / q * setup + q / 2 * holding


COST_NAMES = ['Annual demand D', 'Order cost S', 'Holding cost H', 'Order size m (× EOQ)']
COST_BOUNDS = [(8000, 12000), (30, 70), (2, 6), (.6, 1.6)]


def rastrigin(x):
    return 10 * len(x) + np.sum(x ** 2 - 10 * np.cos(2 * np.pi * x))


def random_search(seed, steps=300, dim=8):
    rng = np.random.default_rng(seed)
    return [rastrigin(rng.uniform(-5.12, 5.12, dim)) for _ in range(steps)], None


def annealing(seed, steps=300, dim=8):
    rng = np.random.default_rng(seed)
    x = rng.uniform(-5.12, 5.12, dim)
    fx, history = rastrigin(x), []
    for k in range(steps):
        y = np.clip(x + rng.normal(0, .35, dim), -5.12, 5.12)
        fy = rastrigin(y)
        if fy < fx or rng.random() < np.exp((fx - fy) / (8 * .98 ** k)):
            x, fx = y, fy
        history.append(fx)
    return history, x


def one_plus_one(seed, steps=300, dim=8):
    rng = np.random.default_rng(seed)
    x, sigma = rng.uniform(-5.12, 5.12, dim), 1.
    fx, history = rastrigin(x), []
    for _ in range(steps):
        y = x + sigma * rng.normal(size=dim)
        fy = rastrigin(y)
        if fy <= fx:
            x, fx, sigma = y, fy, sigma * 1.5
        else:
            sigma *= 1.5 ** -.25  # one-fifth success rule
        history.append(fx)
    return history, x


def project_days(rng, n, crash=False):
    """Three sequential tasks with triangular durations (days); crashing shortens task B."""
    b = rng.triangular(6, 9, 15, n) * (.8 if crash else 1)
    return np.c_[rng.triangular(5, 7, 12, n), b, rng.triangular(4, 6, 11, n)]


def figures(seed):
    rng = np.random.default_rng(seed)
    out = {}

    sweep = K.oat_sweep(order_cost, [10000, 50, 4, 1.], COST_BOUNDS, n_points=21)
    out['f21-tornado'] = T.tornado(sweep['low'], sweep['high'], COST_NAMES, base=sweep['base_output'],
                                   output_label='Annual cost (currency units)', input_ranges=COST_BOUNDS,
                                   sweep_min=sweep['output'].min(1), sweep_max=sweep['output'].max(1))

    morris = K.morris_screening(ishigami, bounds(), r=40, seed=seed, n_boot=400)
    out['f22-morris'] = T.morris_plot(morris['mu_star'], morris['sigma'], NAMES,
                                           mu_star_lower=morris['mu_star_lower'],
                                           mu_star_upper=morris['mu_star_upper'])

    seeds = range(seed, seed + 20)
    runs = [K.repeated_runs(solver, seeds)['histories'] for solver in (random_search, annealing, one_plus_one)]
    out['f23-convergence'] = T.convergence_band(runs, ['Random search', 'Simulated annealing', '(1+1)-ES'],
                                                value_label='Rastrigin value (8-D)', log_y=True)

    score = np.cumsum(rng.normal(0, 1, (8, 5)), axis=1) + rng.normal(0, 2, (8, 1))
    ranks = (-score).argsort(0).argsort(0) + 1
    out['f24-bump'] = T.bump_chart(ranks, [f'Region {c}' for c in 'ABCDEFGH'],
                                   ['2021', '2022', '2023', '2024', '2025'], highlight=(0, 3))

    base = K.monte_carlo(lambda x: x.sum(), lambda r, n: project_days(r, n), n=4000, seed=seed)
    crash = K.monte_carlo(lambda x: x.sum(), lambda r, n: project_days(r, n, True), n=4000, seed=seed)
    out['f25-quantile-dots'] = T.quantile_dotplot(base['outputs'], value_label='Completion time (days)',
                                                  threshold=30)
    out['f26-exceedance'] = T.exceedance_curve([base['outputs'], crash['outputs']],
                                               ['Current plan', 'Crash task B by 20%'],
                                               value_label='Completion time (days)', threshold=30)

    t = np.linspace(0, 20, 60)
    caps, rates = rng.uniform(60, 100, 6), rng.uniform(.4, .9, 6)
    mean = caps[:, None] / (1 + np.exp(-rates[:, None] * (t - 10)))
    out['f27-small-multiples'] = T.small_multiples(
        t, mean + rng.normal(0, 3, mean.shape), [f'Region {c}' for c in 'ABCDEF'],
        value_label='Adopters (thousands)', lower=mean - 5.88, upper=mean + 5.88,
        interval_label='known-model 95% band (σ = 3)')

    parts = np.array([6.2, 17.5, -13.8, -9.1, .4])
    out['f28-waterfall'] = T.waterfall(parts, ['Population', 'Output per capita', 'Energy intensity',
                                               'Carbon intensity', 'Residual'],
                                       start=100, start_label='2015', end_label='2025',
                                       unit='Emissions index', end=100 + parts.sum())

    ops = [(0, 0, 0, 3), (0, 1, 3, 2), (0, 2, 5, 2), (1, 1, 0, 3), (1, 0, 3, 4), (1, 2, 7, 1),
           (2, 2, 0, 4), (2, 0, 7, 2), (2, 1, 9, 3)]  # (job, machine, start, duration)
    jobs, machines, starts, durations = map(np.array, zip(*ops))
    out['f29-gantt'] = T.gantt(starts, durations, [f'J{j + 1}' for j in jobs], lanes=machines,
                               lane_labels=['Machine 1', 'Machine 2', 'Machine 3'], groups=jobs,
                               group_labels=['Job 1', 'Job 2', 'Job 3'], critical=(0, 4, 7, 8),
                               time_label='Time (h)')

    xy = np.r_[[[0, 0]], rng.uniform(-10, 10, (16, 2))]
    demand = np.r_[0, rng.integers(1, 6, 16)]
    routes, route, load = [], [0], 0
    for j in np.argsort(np.arctan2(xy[1:, 1], xy[1:, 0])) + 1:  # sweep heuristic, capacity 15
        if load + demand[j] > 15:
            routes.append(route + [0])
            route, load = [0], 0
        route.append(j)
        load += demand[j]
    routes.append(route + [0])
    out['f30-routes'] = T.route_map(xy, routes, demand=demand, coordinate_label='Distance (km)')

    field = lambda x, y: (x * (1 - x / 3) - x * y, -y + x * y)

    def solve(start, h=.02, steps=900):
        path = [np.array(start, float)]
        for _ in range(steps):  # classical Runge–Kutta on the known field
            p = path[-1]
            f = lambda q: np.array(field(*q))
            k1 = f(p); k2 = f(p + h / 2 * k1); k3 = f(p + h / 2 * k2); k4 = f(p + h * k3)
            path.append(p + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4))
        return np.array(path)
    out['f31-phase'] = T.phase_portrait(field, (-.05, 3.2), (-.05, 2.2),
                                        trajectories=[solve((.3, 1.8)), solve((2.8, .2))],
                                        equilibria=[(0, 0), (3, 0), (1, 2 / 3)], stable=(2,),
                                        labels=('Prey', 'Predator'))

    r_values = np.linspace(2.5, 4, 600)
    x = np.full(len(r_values), .5)
    for _ in range(500):
        x = r_values * x * (1 - x)
    keep_r, keep_x = [], []
    for _ in range(120):
        x = r_values * x * (1 - x)
        keep_r.append(r_values.copy())
        keep_x.append(x.copy())
    r1, r2 = np.linspace(2.5, 3, 50), np.linspace(3, 4, 100)
    out['f32-bifurcation'] = T.bifurcation(np.concatenate(keep_r), np.concatenate(keep_x),
                                           parameter_label='Growth rate r', state_label='Long-run state x',
                                           branches=[(r1, 1 - 1 / r1, True), (r2, 1 - 1 / r2, False)])

    X = rng.uniform(-2, 2, (400, 3))
    predict = lambda Z: np.sin(Z[:, 0]) + Z[:, 0] * Z[:, 1] + .3 * Z[:, 2]
    ice = K.ice_curves(predict, X, 0, max_rows=120, seed=seed)
    out['f33-pdp-ice'] = T.pdp_ice(ice['grid'], ice['ice'], feature_label='x1', output_label='Known response',
                                   observed=ice['observed'][:120])

    weights = np.array([2.5, -1.8, 1.2, .6, -.3, 0.])
    F = rng.normal(0, 1, (300, 6)) * [1, 1.5, .8, 1, 2, 1]
    attributions = weights * (F - F.mean(0))  # exact Shapley values of a linear model, independent inputs
    out['f34-beeswarm'] = T.attribution_beeswarm(attributions, F, [f'Feature {k + 1}' for k in range(6)],
                                                 attribution_label='Contribution to output')

    y = (rng.random(600) < .3).astype(int)
    scores = 1 / (1 + np.exp(-(rng.normal(0, 1, 600) + 1.6 * y - .8)))
    out['f35-classifier'] = T.classifier_diagnostics(y, scores, threshold=.5,
                                                     class_labels=('No event', 'Event'))

    t = np.linspace(0, 6 * np.pi, 300)
    ref = np.sin(t)
    models = np.array([.9 * np.sin(t + .15) + rng.normal(0, .15, t.size),
                       1.25 * np.sin(t) + rng.normal(0, .35, t.size),
                       .6 * np.sin(t - .5) + rng.normal(0, .1, t.size),
                       np.sin(t + .9) + rng.normal(0, .25, t.size)])
    out['f36-taylor'] = T.taylor_diagram(ref, models, ['Model A', 'Model B', 'Model C', 'Model D'])

    years = np.arange(2000, 2031)
    logistic = lambda mid, rate: 1 / (1 + np.exp(-rate * (years - mid)))
    renew = 2 + 55 * logistic(2022, .25)
    gas = 18 + 12 * logistic(2010, .3) - 6 * logistic(2026, .4)
    coal = 100 - renew - gas
    mix = np.array([coal, gas, renew])
    out['f37-composition'] = T.composition_area(years, mix * 1.02 ** (years - 2000),
                                                ['Coal', 'Gas', 'Renewables'], unit='Generation (TWh)')

    days = np.arange(np.datetime64('2024-01-01'), np.datetime64('2026-01-01'))
    doy = (days - days.astype('datetime64[Y]')).astype(int)
    weekday = (days.astype(int) + 3) % 7
    load = 50 + 12 * np.cos(2 * np.pi * (doy - 200) / 365) - 9 * (weekday >= 5) + rng.normal(0, 3, days.size)
    kept = rng.random(days.size) > .03
    out['f38-calendar'] = T.calendar_heatmap(days[kept], load[kept], value_label='Daily load (MWh)')

    raw = rng.uniform(1, 10, (6, 5))
    benefit = np.array([True, True, False, True, False])
    norm = np.where(benefit, raw / raw.max(0), raw.min(0) / raw)
    p = norm / norm.sum(0)
    entropy = -(p * np.log(p)).sum(0) / np.log(len(raw))
    w = (1 - entropy) / (1 - entropy).sum()  # entropy weights on the synthetic matrix

    def topsis(weights):
        v = norm / np.sqrt((norm ** 2).sum(0)) * weights
        far = np.sqrt(((v - v.min(0)) ** 2).sum(1))
        return far / (np.sqrt(((v - v.max(0)) ** 2).sum(1)) + far)
    stability = K.rank_stability(topsis, w, n=1000, concentration=60, seed=seed)
    out['f39-evaluation'] = T.evaluation_matrix(raw, [f'Site {c}' for c in 'ABCDEF'],
                                                ['Capacity', 'Access', 'Cost', 'Demand', 'Risk'],
                                                weights=w, overall=topsis(w),
                                                overall_label='TOPSIS closeness', benefit=benefit,
                                                rank_probability=stability['rank_probability'])

    shares = (mix / mix.sum(0)).T
    other = np.c_[shares[:, 0] * .7 + .1, shares[:, 1] * .8, shares[:, 2] * .9 + .05]
    trajectories = np.r_[shares[::5], other[::5] / other[::5].sum(1, keepdims=True)]
    out['f40-ternary'] = T.ternary(trajectories, ['Coal', 'Gas', 'Renewables'],
                                   groups=np.repeat([0, 1], len(shares[::5])),
                                   group_labels=['Region North', 'Region South'])
    out['f41-rank-caterpillar'] = T.rank_caterpillar(
        stability['median_rank'], stability['rank_lower'], stability['rank_upper'],
        [f'Site {c}' for c in 'ABCDEF'], base_rank=stability['base_rank'],
        interval_label='5–95% range of ranks over 1000 Dirichlet weight draws')

    t = np.arange(150)
    series = 20 + .05 * t + 4 * np.sin(2 * np.pi * t / 12) + rng.normal(0, 1, t.size)
    design = lambda u: np.c_[np.ones_like(u), u, np.sin(2 * np.pi * u / 12), np.cos(2 * np.pi * u / 12)]

    def harmonic(y_past, X_past, X_future, h, spread=False):  # least squares fitted on the past only
        u = np.arange(len(y_past), dtype=float)
        beta, *_ = np.linalg.lstsq(design(u), y_past, rcond=None)
        mean = design(np.arange(len(y_past), len(y_past) + h, dtype=float)) @ beta
        return (mean, np.std(y_past - design(u) @ beta, ddof=4)) if spread else mean
    models = {'Naive': K.naive_forecast, 'Seasonal naive': K.seasonal_naive(12), 'Trend + harmonics': harmonic}
    runs = {name: K.rolling_origin(f, series, initial=60, horizon=12, step=3) for name, f in models.items()}
    fits = [harmonic(series[:o], None, None, 12, spread=True) for o in runs['Naive']['origins']]
    lower = np.array([m - 1.645 * sd for m, sd in fits])
    upper = np.array([m + 1.645 * sd for m, sd in fits])
    cover = K.interval_coverage(runs['Naive']['actual'], lower, upper)['coverage']
    out['f42-backtest'] = T.backtest_errors([r['errors'] for r in runs.values()], list(runs),
                                            coverage=[None, None, cover], nominal=.9,
                                            horizon_label='Horizon (months)')

    out['f43-spider'] = T.spider_plot(sweep['grid'], sweep['output'], COST_NAMES,
                                      base_input=[10000, 50, 4, 1.], base_output=sweep['base_output'],
                                      output_label='Annual cost (currency units)', scale='range')

    difficulty = rng.lognormal(0, 1, 40)
    times = difficulty[:, None] * rng.lognormal([0, .3, .6], [.6, .2, .9], (40, 3))
    times[times > 12] = np.inf  # runs over a 12 s limit count as failures
    out['f44-performance-profile'] = T.performance_profile(times, ['Solver A', 'Solver B', 'Solver C'],
                                                           cost_label='solve time')

    before = rng.uniform(40, 80, 8)
    after = before + rng.normal(4, 6, 8)
    out['f45-slope'] = T.slope_chart(before, after, [f'Region {c}' for c in 'ABCDEFGH'],
                                     start_label='Before policy', end_label='After policy',
                                     value_label='Indicator (points)')

    block = np.repeat([0, 1, 2], 8)
    chance = np.where(block[:, None] == block[None, :], .6, .05)
    upper_edges = np.triu(rng.random((24, 24)) < chance, 1) * rng.uniform(1, 5, (24, 24))
    shuffle = rng.permutation(24)
    W = (upper_edges + upper_edges.T)[np.ix_(shuffle, shuffle)]
    out['f46-adjacency'] = T.adjacency_matrix(W, [f'N{k + 1}' for k in range(24)], value_label='Edge weight')
    for fig in out.values():
        fig.supxlabel(LABEL, fontsize=8, color='#7A7A7A')
    return out


def render(output, seed, dpi=300, only=None):
    output.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, fig in figures(seed).items():
        if only and name.split('-')[0].upper() not in only:
            plt.close(fig)
            continue
        for suffix in ('png', 'pdf'):
            path = output / f'{name}.{suffix}'
            fig.savefig(path, dpi=dpi, bbox_inches='tight')
            paths.append(path)
        plt.close(fig)
    return paths


def self_test():
    # Known Sobol indices of Ishigami (a=7, b=0.1): S1 ≈ .314, .442, 0; ST ≈ .558, .442, .244.
    sobol = K.sobol_indices(lambda x: ishigami(x), bounds()[:3], n=2 ** 13, seed=1, n_boot=0)
    assert np.allclose(sobol['first_order'], [.314, .442, 0], atol=.04), sobol['first_order']
    assert np.allclose(sobol['total_order'], [.558, .442, .244], atol=.04), sobol['total_order']
    morris = K.morris_screening(ishigami, bounds(), r=30, seed=2)
    assert morris['mu_star'][3] == 0 and morris['mu_star'][:3].min() > 0
    sweep = K.oat_sweep(ishigami, [0., 0., 0., 0.], bounds())
    assert np.isclose(sweep['high'][2], sweep['base_output'])  # OAT misses x3, which acts only with x1
    data = np.random.default_rng(3).normal(5, 1, 400)
    boot = K.bootstrap_interval(np.mean, data, seed=4)
    assert boot['lower'] < 5 < boot['upper'] or abs(boot['estimate'] - 5) < .2
    series = np.arange(30.)
    roll = K.rolling_origin(K.naive_forecast, series, initial=10, horizon=3)
    assert np.allclose(roll['errors'], -np.arange(1, 4))
    loss = np.array([[1., 2., 3.], [2., 2., 5.]])
    summary = K.paired_summary(loss, n_boot=200)[0]
    assert summary['worse_runs'] == 2 and np.isclose(summary['mean_difference'], 1)
    profile = K.profile_objective(lambda th: (th[0] - 1) ** 2 + (th[1] + th[0]) ** 2, [1, -1], 0,
                                  np.linspace(0, 2, 5))
    assert profile['success'].all() and np.allclose(profile['profile'], (np.linspace(0, 2, 5) - 1) ** 2, atol=1e-6)
    table = K.booktabs_table([['A_1', '0.5 ± 0.1', r'$\beta$'], ['Cost ($)', '{x}', '1']],
                             ['Method', 'Loss', r'$\gamma$'], caption='c', label='t', raw_columns=(2,))
    assert r'A\_1' in table and r'$\pm$' in table and r'Cost (\$)' in table and r'\{x\}' in table
    assert r'$\beta$' in table and r'$\gamma$' in table and r'\toprule' in table
    y = np.arange(40.)  # a forecaster that reads realised covariates must not see them by default
    cheat = lambda yp, Xp, Xf, h: (Xf - 1) if Xf is not None else np.full(h, yp[-1])
    assert np.all(K.rolling_origin(cheat, y, initial=10, horizon=3, X=y + 1)['mae_by_horizon'] > 0)
    assert np.allclose(K.rolling_origin(cheat, y, initial=10, horizon=3, X=y + 1,
                                        future_X_known=True)['mae_by_horizon'], 0)
    first = K.sobol_indices(ishigami, bounds()[:3], n=512, seed=5, n_boot=50)
    again = K.sobol_indices(ishigami, bounds()[:3], n=512, seed=5, n_boot=50)
    assert np.array_equal(first['total_order_lower'], again['total_order_lower'])
    tie = K.rank_stability(lambda w: np.array([1., 1., 0.]), np.array([.5, .5]), n=20)
    assert np.allclose(tie['rank_probability'][:2, :2], .5) and tie['rank_probability'][2, 2] == 1
    fig = T.tornado([5, 5, 6], [5, 5, 6], ['flat', 'hidden', 'small'], base=5, output_label='y',
                    sweep_min=[5, 2, 5], sweep_max=[5, 5, 6])
    assert [t.get_text() for t in fig.axes[0].get_yticklabels()][-1] == 'hidden'
    draws = np.random.default_rng(6).normal(25, 3, 4000)
    for threshold in (26.3, 22.0, 31.7):
        ax = T.quantile_dotplot(draws, value_label='x', threshold=threshold).axes[0]
        for dot in ax.patches:
            beyond = dot.get_facecolor()[:3] != matplotlib.colors.to_rgb(T.BLUE)
            assert beyond == (dot.center[0] > threshold), (threshold, dot.center)
    yb = (np.random.default_rng(7).random(300) < .2).astype(int)
    fig = T.classifier_diagnostics(yb, np.random.default_rng(8).random(300) + .3 * yb, threshold=.6)
    x, y_step = fig.axes[1].lines[0].get_data()
    ap = float(''.join(fig.axes[1].get_title(loc=loc) for loc in ('left', 'center', 'right')).split('AP=')[1])
    assert abs(np.sum(np.diff(x) * y_step[1:]) - ap) < 1e-3  # drawn area equals AP
    lines = T.exceedance_curve([draws, draws + 1], ['a', 'b'], value_label='x', threshold=27).axes[0].lines
    assert [line.get_color() for line in lines[:2]] == T.PALETTE[:2]
    ahp = K.ahp_weights([[1, 2, 4], [1 / 2, 1, 2], [1 / 4, 1 / 2, 1]])
    assert np.allclose(ahp['weights'], [4 / 7, 2 / 7, 1 / 7]) and abs(ahp['consistency_ratio']) < 1e-9
    assert not K.ahp_weights([[1, 9, 1 / 9], [1 / 9, 1, 9], [9, 1 / 9, 1]])['acceptable']

    def euler(h):  # y' = y on [0, 1] has global error O(h)
        y = 1.
        for _ in range(round(1 / h)):
            y += h * y
        return y
    study = K.refinement_study(euler, [.1, .05, .025, .0125], reference=np.e)
    assert abs(study['observed_order'] - 1) < .1
    blind = K.refinement_study(euler, [.1, .05, .025, .0125])  # no reference: Richardson estimate
    assert abs(blind['observed_order'] - 1) < .1 and 'error' not in blind
    assert abs(blind['error_estimate'][0] / (np.e - 1.1 ** 10) - 1) < .1
    line = lambda theta, noise, r: (np.linspace(0, 1, 50), theta[0] + theta[1] * np.linspace(0, 1, 50)
                                    + r.normal(0, noise, 50) if noise else theta[0] + theta[1] * np.linspace(0, 1, 50))
    recovered = K.synthetic_recovery(line, lambda d: np.polyfit(d[0], d[1], 1)[::-1], [2., -3.], [0, .5], range(5))
    assert np.allclose(recovered['relative_error'][0], 0, atol=1e-9) and recovered['median_abs_error'][1].max() > 0
    assert np.isclose(K.bootstrap_interval(np.mean, np.arange(30.), block_length=3.0, n_boot=50)['lower'],
                      K.bootstrap_interval(np.mean, np.arange(30.), block_length=3, n_boot=50)['lower'])
    swap = K.rank_stability(lambda w: w, np.array([.55, .45]), n=500, concentration=20)
    assert np.isin(np.r_[swap['rank_lower'], swap['rank_upper'], swap['median_rank']], [1, 2]).all()
    assert np.allclose(tie['base_rank'], [1.5, 1.5, 3])
    labels_y = T._spread([10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 95], 3.5)
    assert labels_y[-1] == 95 and np.all(np.diff(np.sort(labels_y)) >= 3.5 - 1e-9)
    assert max(1 - c for c in T.TINTED_BLUES(0.)[:3]) > .1  # weakest edge is not white
    T.adjacency_matrix([[0.]], ['solo'])
    T.adjacency_matrix(np.array([[0, .2, 40], [.2, 0, 0], [40, 0, 0]]), ['a', 'b', 'c'], log=True)
    label = T.backtest_errors([np.ones((3, 2))], ['a'], error_label='load error (MWh)').axes[0].get_ylabel()
    assert label == 'MAE of load error (MWh)'
    cover = K.interval_coverage([[1, 2], [3, 9]], [[0, 0], [0, 0]], [[2, 2], [4, 4]])
    assert np.allclose(cover['coverage'], [1, .5])
    assert np.allclose(tie['median_rank'][:2], 1.5)
    profile_fig = T.performance_profile([[1., 2.], [3., np.inf]], ['a', 'b'])
    assert profile_fig.axes[0].lines[0].get_ydata()[-1] == 1
    binary = np.r_[np.zeros(150), np.ones(150)]
    colors = T._average_rank(binary)
    assert np.unique(colors[:150]).size == 1 and np.unique(colors[150:]).size == 1
    for call in [lambda: T.waterfall([1, 2], ['a', 'b'], start=0, start_label='s', end_label='e',
                                     unit='u', end=4),
                 lambda: T.gantt([0, 1], [2, 2], ['a', 'b'], lanes=[0, 0], lane_labels=['M']),
                 lambda: T.ternary([[.5, .5, .5]], ['a', 'b', 'c']),
                 lambda: T.classifier_diagnostics([1, 1], [.2, .3], threshold=.5),
                 lambda: T.taylor_diagram([1., 2, 3], [[1., 1, 1]], ['flat']),
                 lambda: K.bootstrap_interval(np.mean, np.arange(10.), block_length=10),
                 lambda: K.interval_coverage([1, np.nan], [0, 0], [2, 2]),
                 lambda: K.refinement_study(euler, [.1, .05, .01]),
                 lambda: K.repeated_runs(lambda s: ([1.], None), [0], goal='minimize'),
                 lambda: K.morris_screening(ishigami, bounds(), r=1),
                 lambda: T.performance_profile([[0., 1.]], ['a', 'b']),
                 lambda: T.backtest_errors([np.ones((3, 2))], ['a'], coverage=[[.9, .8]]),
                 lambda: T.spider_plot([[0., 1.]], [[1., 2.]], ['a'], base_input=[0.], base_output=1,
                                       output_label='y'),
                 lambda: K.ahp_weights([[1, 2], [2, 1]])]:
        try:
            call()
        except ValueError:
            continue
        raise AssertionError('An invalid input was accepted.')
    plt.close('all')
    with tempfile.TemporaryDirectory() as tmp:
        paths = render(Path(tmp), 20261022, dpi=72)
        assert len(paths) == 52 and all(p.stat().st_size > 0 for p in paths)
    print('advanced templates and experiment kits: self-test passed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('work/figure-examples-advanced'))
    parser.add_argument('--seed', type=int, default=20261022)
    parser.add_argument('--dpi', type=int, default=300)
    parser.add_argument('--only', type=lambda s: {x.strip().upper() for x in s.split(',')})
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    dependencies()
    if args.self_test:
        self_test()
    else:
        for path in render(args.output, args.seed, args.dpi, args.only):
            print(path)


if __name__ == '__main__':
    main()
