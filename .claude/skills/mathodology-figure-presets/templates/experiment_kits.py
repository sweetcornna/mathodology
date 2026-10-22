"""Reusable computational experiments whose outputs feed the figure templates.

Each kit calls the caller's model, solver or predictor and returns arrays, not
conclusions: nothing here invents data, intervals or significance. Pass seeds
and record them with the results. Requires numpy; sobol_indices with dists and
profile_objective also need scipy. See references/experiments.md for designs.
"""
import time

import numpy as np

__all__ = ['oat_sweep', 'morris_screening', 'sobol_indices', 'monte_carlo', 'bootstrap_interval',
           'rolling_origin', 'naive_forecast', 'seasonal_naive', 'repeated_runs', 'paired_variants',
           'paired_summary', 'scenario_matrix', 'perturbation_curve', 'ice_curves',
           'permutation_importance', 'profile_objective', 'rank_stability', 'synthetic_recovery',
           'refinement_study', 'ahp_weights', 'interval_coverage', 'summarize', 'booktabs_table',
           'markdown_table']


def _bounds(bounds):
    bounds = np.asarray(bounds, dtype=float)
    if bounds.ndim != 2 or bounds.shape[1] != 2 or not np.isfinite(bounds).all() \
            or np.any(bounds[:, 0] >= bounds[:, 1]):
        raise ValueError('Supply bounds as finite (low, high) pairs with low < high.')
    return bounds


def _goal(goal):
    if goal not in {'min', 'max'}:
        raise ValueError("goal must be 'min' or 'max'.")
    return goal


def _scalar(value, what='model'):
    value = float(np.asarray(value).squeeze())
    if not np.isfinite(value):
        raise ValueError(f'{what} returned a non-finite value; fix the run instead of dropping it silently.')
    return value


# E01 -> F21: vary one input at a time between its bounds, others at the baseline.
def oat_sweep(model, base, bounds, *, n_points=11):
    base = np.asarray(base, dtype=float)
    bounds = _bounds(bounds)
    if len(base) != len(bounds) or np.any(base < bounds[:, 0]) or np.any(base > bounds[:, 1]):
        raise ValueError('The baseline must lie inside the bounds, one value per input.')
    grid = np.linspace(bounds[:, 0], bounds[:, 1], n_points).T
    output = np.empty_like(grid)
    for i, row in enumerate(grid):
        for k, value in enumerate(row):
            x = base.copy()
            x[i] = value
            output[i, k] = _scalar(model(x))
    return {'base_output': _scalar(model(base)), 'grid': grid, 'output': output,
            'low': output[:, 0], 'high': output[:, -1]}


# E02 -> F22: Morris trajectories on a p-level grid; effects per unit of normalized range.
def morris_screening(model, bounds, *, r=20, levels=4, seed=0, n_boot=0):
    bounds = _bounds(bounds)
    if levels < 2 or levels % 2:
        raise ValueError('Use an even number of levels, typically 4 or 6.')
    if r < 2:
        raise ValueError('Use at least two trajectories (typically 10–50) so sigma is defined.')
    p = len(bounds)
    rng = np.random.default_rng(seed)
    delta = levels / (2 * (levels - 1))
    starts = np.arange(levels // 2) / (levels - 1)
    scale = lambda u: bounds[:, 0] + u * (bounds[:, 1] - bounds[:, 0])
    effects = np.empty((r, p))
    for t in range(r):
        signs = rng.choice([-1, 1], p)
        x = rng.choice(starts, p) + (signs < 0) * delta
        y = _scalar(model(scale(x)))
        for j in rng.permutation(p):
            x = x.copy()
            x[j] += signs[j] * delta
            y_new = _scalar(model(scale(x)))
            effects[t, j] = (y_new - y) / (signs[j] * delta)
            y = y_new
    result = {'mu': effects.mean(0), 'mu_star': np.abs(effects).mean(0),
              'sigma': effects.std(0, ddof=1), 'effects': effects, 'evaluations': r * (p + 1)}
    if n_boot:
        boot = np.array([np.abs(effects[rng.integers(0, r, r)]).mean(0) for _ in range(n_boot)])
        result['mu_star_lower'], result['mu_star_upper'] = np.percentile(boot, [2.5, 97.5], axis=0)
    return result


# E03 -> F16: Saltelli (2010) first-order and Jansen total-order indices, seeded throughout.
def sobol_indices(model, bounds=None, *, dists=None, n=4096, seed=0, n_boot=500, vectorized=False):
    """Inputs are independent: uniform on bounds, or scipy.stats frozen dists (via ppf).

    Costs n × (inputs + 2) model runs. Bootstrap intervals resample the same runs
    with the same seed, so repeated calls give identical numbers.
    """
    rng = np.random.default_rng(seed)
    if dists is None:
        bounds = _bounds(bounds)
        to_inputs = lambda u: bounds[:, 0] + u * (bounds[:, 1] - bounds[:, 0])
        p = len(bounds)
    else:
        to_inputs = lambda u: np.column_stack([d.ppf(u[:, i]) for i, d in enumerate(dists)])
        p = len(dists)
    run = (lambda X: np.asarray(model(X.T), dtype=float).ravel()) if vectorized else \
        (lambda X: np.array([_scalar(model(x)) for x in X]))
    u = rng.random((n, 2 * p))
    A, B = to_inputs(u[:, :p]), to_inputs(u[:, p:])
    f_A, f_B = run(A), run(B)
    f_AB = np.empty((p, n))
    for i in range(p):
        AB = A.copy()
        AB[:, i] = B[:, i]
        f_AB[i] = run(AB)

    def estimate(idx):
        a, b, ab = f_A[idx], f_B[idx], f_AB[:, idx]
        var = np.var(np.r_[a, b])
        return np.mean(b * (ab - a), axis=1) / var, .5 * np.mean((a - ab) ** 2, axis=1) / var

    first, total = estimate(np.arange(n))
    out = {'first_order': first, 'total_order': total, 'evaluations': n * (p + 2)}
    if n_boot:
        boot = [estimate(rng.integers(0, n, n)) for _ in range(n_boot)]
        for k, name in enumerate(['first_order', 'total_order']):
            out[f'{name}_lower'], out[f'{name}_upper'] = np.percentile([b[k] for b in boot], [2.5, 97.5], axis=0)
    return out


# E04 -> F25/F26: propagate stated input distributions through the model.
def monte_carlo(model, sample_inputs, *, n=10000, seed=0, quantiles=(.05, .5, .95), vectorized=False):
    rng = np.random.default_rng(seed)
    inputs = np.asarray(sample_inputs(rng, n), dtype=float)
    if inputs.shape[0] != n:
        raise ValueError('sample_inputs(rng, n) must return n rows of inputs.')
    if vectorized:
        outputs = np.asarray(model(inputs), dtype=float).ravel()
    else:
        outputs = np.array([_scalar(model(x)) for x in inputs])
    if not np.isfinite(outputs).all():
        raise ValueError('Some runs failed; report and fix them instead of dropping them.')
    running = np.cumsum(outputs) / np.arange(1, n + 1)
    return {'inputs': inputs, 'outputs': outputs, 'mean': outputs.mean(),
            'mc_standard_error': outputs.std(ddof=1) / np.sqrt(n),
            'quantiles': dict(zip(quantiles, np.quantile(outputs, quantiles))), 'running_mean': running}


# E05: percentile bootstrap; block_length >= 2 resamples moving blocks for dependent data.
def bootstrap_interval(statistic, data, *, n_boot=2000, level=.95, seed=0, block_length=None):
    data = np.asarray(data)
    n = len(data)
    if n < 2:
        raise ValueError('Bootstrap needs at least two sampling units.')
    if block_length not in (None, 1) and (int(block_length) != block_length or not 2 <= block_length <= n // 2):
        raise ValueError('block_length must be an integer from 2 to n/2; longer blocks barely resample.')
    block_length = None if block_length is None else int(block_length)
    rng = np.random.default_rng(seed)
    replicates = np.empty(n_boot)
    for b in range(n_boot):
        if block_length and block_length > 1:
            first = rng.integers(0, n - block_length + 1, int(np.ceil(n / block_length)))
            idx = (first[:, None] + np.arange(block_length)).ravel()[:n]
        else:
            idx = rng.integers(0, n, n)
        replicates[b] = _scalar(statistic(data[idx]), 'statistic')
    alpha = (1 - level) / 2
    lower, upper = np.quantile(replicates, [alpha, 1 - alpha])
    return {'estimate': _scalar(statistic(data), 'statistic'), 'lower': lower, 'upper': upper,
            'level': level, 'replicates': replicates,
            'method': 'moving-block percentile' if block_length and block_length > 1 else 'percentile'}


# E06 -> F02/F17: rolling-origin evaluation; each fit sees y and X only up to its origin.
def rolling_origin(fit_predict, y, *, initial, horizon, step=1, X=None, future_X_known=False):
    """fit_predict(y_past, X_past, X_future, horizon) returns `horizon` forecasts.

    X_future is the realised covariates after the origin, so it is passed only
    when future_X_known=True: calendar effects, planned prices or controls fixed
    in advance. Otherwise X_future is None and the forecaster must forecast X
    itself; passing realised covariates would leak the future into the score.
    """
    y = np.asarray(y, dtype=float)
    if initial < 2 or initial + horizon > len(y):
        raise ValueError('Need initial >= 2 and initial + horizon <= len(y).')
    origins = np.arange(initial, len(y) - horizon + 1, step)
    forecasts = np.empty((len(origins), horizon))
    for k, t in enumerate(origins):
        past_X = None if X is None else X[:t]
        future_X = X[t:t + horizon] if X is not None and future_X_known else None
        forecasts[k] = np.asarray(fit_predict(y[:t], past_X, future_X, horizon), dtype=float)
    actual = np.array([y[t:t + horizon] for t in origins])
    errors = forecasts - actual
    return {'origins': origins, 'forecasts': forecasts, 'actual': actual, 'errors': errors,
            'mae_by_horizon': np.abs(errors).mean(0), 'rmse_by_horizon': np.sqrt((errors ** 2).mean(0))}


def naive_forecast(y_past, X_past, X_future, horizon):
    """Baseline for rolling_origin: repeat the last observation."""
    return np.full(horizon, y_past[-1])


def seasonal_naive(period):
    """Baseline for rolling_origin: repeat the last full season."""
    def fit_predict(y_past, X_past, X_future, horizon):
        if len(y_past) < period:
            raise ValueError('The training window is shorter than one season.')
        return np.resize(y_past[-period:], horizon)
    return fit_predict


# E07 -> F23: independent seeded runs of a stochastic solver, with wall time.
def repeated_runs(solve, seeds, *, goal='min', target=None):
    _goal(goal)
    histories, finals, times = [], [], []
    for seed in seeds:
        start = time.perf_counter()
        history, _ = solve(seed)
        times.append(time.perf_counter() - start)
        history = np.asarray(history, dtype=float)
        best = (np.minimum if goal == 'min' else np.maximum).accumulate(history)
        histories.append(best)
        finals.append(best[-1])
    length = max(len(h) for h in histories)
    # Runs that stop early keep their final best value for the remaining steps.
    padded = np.array([np.r_[h, np.full(length - len(h), h[-1])] for h in histories])
    finals = np.array(finals)
    q1, median, q3 = np.percentile(finals, [25, 50, 75])
    summary = {'runs': len(finals), 'best': finals.min() if goal == 'min' else finals.max(),
               'worst': finals.max() if goal == 'min' else finals.min(), 'median': median,
               'q1': q1, 'q3': q3, 'mean': finals.mean(), 'sd': finals.std(ddof=1) if len(finals) > 1 else 0.,
               'median_seconds': float(np.median(times))}
    if target is not None:
        summary['success_rate'] = float(np.mean(finals <= target if goal == 'min' else finals >= target))
    return {'histories': padded, 'final': finals, 'seconds': np.array(times), 'summary': summary}


# E08 -> F19: every variant on the same seeds, so differences are paired.
def paired_variants(evaluate, variants, seeds):
    return np.array([[_scalar(evaluate(v, s), 'evaluate') for s in seeds] for v in variants])


def paired_summary(loss_by_run, *, n_boot=2000, seed=0, level=.95):
    """Per variant against row zero: mean paired difference, a bootstrap interval and wins."""
    loss = np.asarray(loss_by_run, dtype=float)
    rng = np.random.default_rng(seed)
    rows = []
    for row in loss[1:]:
        d = row - loss[0]
        boot = np.array([d[rng.integers(0, len(d), len(d))].mean() for _ in range(n_boot)])
        low, high = np.quantile(boot, [(1 - level) / 2, (1 + level) / 2])
        rows.append({'mean_difference': d.mean(), 'lower': low, 'upper': high,
                     'worse_runs': int(np.sum(d > 0)), 'better_runs': int(np.sum(d < 0)), 'runs': len(d)})
    return rows


# E09 -> F20: decision × scenario losses and regret against each scenario's best decision.
def scenario_matrix(evaluate, decisions, scenarios, *, goal='min'):
    _goal(goal)
    loss = np.array([[_scalar(evaluate(d, s), 'evaluate') for s in scenarios] for d in decisions])
    best = loss.min(0) if goal == 'min' else loss.max(0)
    regret = loss - best if goal == 'min' else best - loss
    return {'loss': loss, 'regret': regret, 'max_regret': regret.max(1)}


# E10 -> F23 (best_so_far=False): metric under increasing perturbation, repeated over seeds.
def perturbation_curve(evaluate, levels, seeds):
    return np.array([[_scalar(evaluate(level, s), 'evaluate') for level in levels] for s in seeds])


# E11 -> F33: ICE curves on a grid inside the observed range of one feature.
def ice_curves(predict, X, feature, *, grid=None, n_grid=25, max_rows=500, seed=0):
    X = np.asarray(X, dtype=float)
    rows = np.random.default_rng(seed).permutation(len(X))[:max_rows]
    sample = X[rows]
    observed = X[:, feature]
    if grid is None:
        grid = np.unique(np.quantile(observed, np.linspace(.025, .975, n_grid)))
    ice = np.empty((len(sample), len(grid)))
    for k, value in enumerate(grid):
        changed = sample.copy()
        changed[:, feature] = value
        ice[:, k] = np.asarray(predict(changed), dtype=float).ravel()
    return {'grid': np.asarray(grid, float), 'ice': ice, 'observed': observed}


# E12 -> F06/F19: loss increase when one feature is permuted, on held-out data.
# p025/p975 are the spread across permutation repeats, not a confidence interval.
def permutation_importance(predict, X, y, loss, *, n_repeats=20, seed=0):
    X = np.asarray(X, dtype=float)
    rng = np.random.default_rng(seed)
    base = _scalar(loss(y, predict(X)), 'loss')
    increase = np.empty((X.shape[1], n_repeats))
    for j in range(X.shape[1]):
        for k in range(n_repeats):
            shuffled = X.copy()
            shuffled[:, j] = rng.permutation(shuffled[:, j])
            increase[j, k] = _scalar(loss(y, predict(shuffled)), 'loss') - base
    return {'base_loss': base, 'increase': increase, 'mean': increase.mean(1),
            'p025': np.percentile(increase, 2.5, axis=1), 'p975': np.percentile(increase, 97.5, axis=1)}


# E13: profile one parameter by re-optimizing the others at each fixed value.
def profile_objective(objective, theta_hat, index, grid, *, bounds=None):
    from scipy.optimize import minimize
    theta = np.asarray(theta_hat, dtype=float)
    free = [i for i in range(len(theta)) if i != index]
    if not free:  # one parameter: the profile is the objective itself
        values = [objective(np.array([v], float)) for v in grid]
        return {'grid': np.asarray(grid, float), 'profile': np.array(values, float),
                'others': np.empty((len(values), 0)), 'success': np.ones(len(values), bool),
                'minimum': float(objective(theta))}
    free_bounds = None if bounds is None else [bounds[i] for i in free]
    values, solutions, success = [], [], []
    start = theta[free]
    for v in grid:
        def partial(z, v=v):
            full = theta.copy()
            full[index], full[free] = v, z
            return objective(full)
        result = minimize(partial, start, bounds=free_bounds)
        start = result.x  # continue from the neighbour's optimum
        values.append(result.fun)
        solutions.append(result.x)
        success.append(result.success)
    return {'grid': np.asarray(grid, float), 'profile': np.array(values), 'others': np.array(solutions),
            'success': np.array(success), 'minimum': float(objective(theta))}


# E14 -> F39: how often each alternative takes each rank when the weights are perturbed.
def rank_stability(overall_score, weights, *, n=2000, concentration=200, seed=0):
    """overall_score(weights) returns one score per alternative, higher is better.

    Weights are drawn from a Dirichlet centred on the given weights; a larger
    concentration means smaller perturbations. State the value used, and keep
    concentration × smallest weight above 1 or that weight piles up near zero.
    Tied scores share their ranks' probability equally.
    """
    weights = np.asarray(weights, dtype=float)
    if np.any(weights <= 0) or not np.isclose(weights.sum(), 1):
        raise ValueError('Supply positive weights that sum to 1.')
    rng = np.random.default_rng(seed)

    def mid_ranks(score):  # 1 is best; tied alternatives share the mean of their positions
        score = np.asarray(score, dtype=float)
        first = np.array([np.sum(score > v) for v in score])
        tied = np.array([np.sum(score == v) for v in score])
        return first, tied, first + (tied + 1) / 2

    base = np.asarray(overall_score(weights), dtype=float)
    counts = np.zeros((len(base), len(base)))
    draws = rng.dirichlet(concentration * weights, n)
    ranks = np.empty((n, len(base)))
    for d, w in enumerate(draws):
        first, tied, ranks[d] = mid_ranks(overall_score(w))
        for i in range(len(base)):  # split tied positions evenly instead of by index
            counts[i, first[i]:first[i] + tied[i]] += 1 / tied[i]
    # inverted_cdf keeps the bounds at ranks that actually occurred in the draws
    low, median, high = np.percentile(ranks, [5, 50, 95], axis=0, method='inverted_cdf')
    return {'base_rank': mid_ranks(base)[2], 'rank_probability': counts / n,
            'weights': draws, 'top_share': counts[:, 0] / n, 'ranks': ranks,
            'median_rank': median, 'rank_lower': low, 'rank_upper': high}  # 5–95% rank interval


# E15: recover known parameters from data simulated with them, at rising noise levels.
def synthetic_recovery(simulate, fit, theta_true, noise_levels, seeds):
    """simulate(theta, noise, rng) -> data; fit(data) -> estimated theta.

    Returns estimates (levels × seeds × parameters) and relative errors; plot the
    errors with convergence_band(best_so_far=False, x=noise_levels).
    """
    theta_true = np.asarray(theta_true, dtype=float)
    estimates = np.empty((len(noise_levels), len(seeds), len(theta_true)))
    for i, noise in enumerate(noise_levels):
        for j, seed in enumerate(seeds):
            data = simulate(theta_true, noise, np.random.default_rng(seed))
            estimates[i, j] = np.asarray(fit(data), dtype=float)
    scale = np.where(theta_true != 0, np.abs(theta_true), 1)  # absolute error for zero parameters
    error = (estimates - theta_true) / scale
    return {'estimates': estimates, 'relative_error': error,
            'median_abs_error': np.median(np.abs(error), axis=1)}


# E16: step-size or grid refinement; observed order of convergence from a log-log fit.
def refinement_study(solve, steps, *, reference=None):
    """solve(h) returns the quantity of interest for step size h.

    With a reference (exact) solution, 'error' is the distance to it. Without
    one, steps must shrink by a constant ratio r; 'successive_difference' is
    |q(h) − q(rh)|, which equals (1 − r^p) times the error of step h, and
    'error_estimate' divides that factor out (Richardson) with the observed order p.
    """
    steps = np.asarray(steps, dtype=float)
    if len(steps) < 3 or np.any(np.diff(steps) >= 0) or np.any(steps <= 0):
        raise ValueError('Use at least three strictly decreasing positive step sizes.')
    values = [np.asarray(solve(h), dtype=float) for h in steps]
    if reference is not None:
        error = np.array([np.max(np.abs(v - reference)) for v in values])
        keep = error > 0
        order = np.polyfit(np.log(steps[keep]), np.log(error[keep]), 1)[0] if keep.sum() >= 2 else np.nan
        return {'steps': steps, 'error': error, 'observed_order': order, 'values': values}
    ratio = steps[1:] / steps[:-1]
    if not np.allclose(ratio, ratio[0]):
        raise ValueError('Without a reference, use a constant refinement ratio such as halving.')
    difference = np.array([np.max(np.abs(a - b)) for a, b in zip(values[:-1], values[1:])])
    keep = difference > 0
    order = np.polyfit(np.log(steps[:-1][keep]), np.log(difference[keep]), 1)[0] if keep.sum() >= 2 else np.nan
    estimate = difference / (1 - ratio[0] ** order) if np.isfinite(order) and order > 0 else np.full_like(difference, np.nan)
    return {'steps': steps[:-1], 'successive_difference': difference, 'error_estimate': estimate,
            'observed_order': order, 'ratio': ratio[0], 'values': values}


# E17: AHP weights from a pairwise comparison matrix, with Saaty's consistency ratio.
_RANDOM_INDEX = [0, 0, .58, .90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49, 1.51, 1.48, 1.56, 1.57, 1.59]


def ahp_weights(pairwise):
    A = np.asarray(pairwise, dtype=float)
    n = len(A)
    if A.ndim != 2 or A.shape != (n, n) or np.any(A <= 0) or not np.allclose(A * A.T, 1, rtol=1e-3):
        raise ValueError('Supply a positive reciprocal matrix: a_ij · a_ji = 1.')
    if n > len(_RANDOM_INDEX):
        raise ValueError('Saaty random indices are tabulated here up to 15 criteria.')
    values, vectors = np.linalg.eig(A)
    k = np.argmax(values.real)
    w = np.abs(vectors[:, k].real)
    lam = values[k].real
    ci = (lam - n) / (n - 1) if n > 2 else 0.
    cr = ci / _RANDOM_INDEX[n - 1] if n > 2 else 0.
    return {'weights': w / w.sum(), 'lambda_max': lam, 'consistency_index': ci,
            'consistency_ratio': cr, 'acceptable': cr < .1}  # CR < 0.1 is Saaty's convention


# E18: share of observations inside their predictive intervals, per column (e.g. horizon).
def interval_coverage(actual, lower, upper):
    actual, lower, upper = (np.asarray(a, dtype=float) for a in (actual, lower, upper))
    if not all(np.isfinite(a).all() for a in (actual, lower, upper)):
        raise ValueError('Drop or impute missing values first and report how many; they are not misses.')
    if not actual.shape == lower.shape == upper.shape or np.any(lower > upper):
        raise ValueError('actual, lower and upper must share a shape, with lower ≤ upper.')
    inside = (actual >= lower) & (actual <= upper)
    return {'coverage': inside.mean(0), 'mean_width': (upper - lower).mean(0), 'n': len(actual)}


def summarize(values, *, style='mean_sd', digits=3):
    """One table cell: 'mean ± sd' (style='mean_sd') or 'median [q1, q3]' (style='median_iqr')."""
    values = np.asarray(values, dtype=float)
    f = lambda v: f'{v:.{digits}g}'
    if style == 'mean_sd':
        return f'{f(values.mean())} ± {f(values.std(ddof=1))}'
    if style == 'median_iqr':
        q1, m, q3 = np.percentile(values, [25, 50, 75])
        return f'{f(m)} [{f(q1)}, {f(q3)}]'
    raise ValueError("style is 'mean_sd' or 'median_iqr'.")


_TEX = {'\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_',
        '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}', '^': r'\textasciicircum{}', '±': r'$\pm$'}


def _tex(cell, raw=False):
    return str(cell) if raw else ''.join(_TEX.get(ch, ch) for ch in str(cell))


def booktabs_table(rows, columns, *, caption, label, align=None, notes=None, bold_rows=(), raw_columns=()):
    """A LaTeX three-line table (needs \\usepackage{booktabs}).

    Text is escaped for LaTeX; columns listed in raw_columns (header and cells)
    pass through unchanged, for cells that already hold LaTeX such as $\\beta$.
    """
    if any(len(r) != len(columns) for r in rows):
        raise ValueError('Every row needs one cell per column.')
    align = align or 'l' + 'c' * (len(columns) - 1)
    cell = lambda c, j: _tex(c, j in raw_columns)
    body = [' & '.join((r'\textbf{%s}' % cell(c, j)) if i in bold_rows else cell(c, j)
                       for j, c in enumerate(row)) + r' \\' for i, row in enumerate(rows)]
    header = ' & '.join(cell(c, j) for j, c in enumerate(columns)) + r' \\'
    lines = [r'\begin{table}[htbp]', r'\centering', rf'\caption{{{caption}}}', rf'\label{{{label}}}',
             rf'\begin{{tabular}}{{{align}}}', r'\toprule', header,
             r'\midrule', *body, r'\bottomrule', r'\end{tabular}']
    if notes:
        lines.append(rf'\par\smallskip\footnotesize {_tex(notes)}')
    return '\n'.join([*lines, r'\end{table}'])


def markdown_table(rows, columns):
    """The same table as Markdown for Word or Markdown pipelines."""
    out = ['| ' + ' | '.join(map(str, columns)) + ' |', '|' + '---|' * len(columns)]
    return '\n'.join(out + ['| ' + ' | '.join(map(str, r)) + ' |' for r in rows])
