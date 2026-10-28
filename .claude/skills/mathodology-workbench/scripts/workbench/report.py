"""Issues found by the checks, and the status report that collects them."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import time

SEVERITIES = ('error', 'warning', 'info')
STAGES = ('brief', 'experiment', 'results', 'figures', 'paper')


@dataclass
class Issue:
    severity: str  # error | warning | info
    stage: str  # one of STAGES
    code: str  # stable short id, e.g. numbers.near-miss
    message: str
    file: str | None = None
    line: int | None = None
    hint: str | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}

    def render(self) -> str:
        where = f'{self.file}:{self.line}' if self.file and self.line else (self.file or '')
        text = f'[{self.severity}] {where + ": " if where else ""}{self.message}'
        return text + (f' ({self.hint})' if self.hint else '')


def rank(issues: list[Issue]) -> list[Issue]:
    order = {s: i for i, s in enumerate(SEVERITIES)}
    return sorted(issues, key=lambda x: (order.get(x.severity, 9), STAGES.index(x.stage) if x.stage in STAGES else 9,
                                         x.file or '', x.line or 0))


def stage_state(present: bool, issues: list[Issue]) -> str:
    if any(i.severity == 'error' for i in issues):
        return 'error'
    if any(i.severity == 'warning' for i in issues):
        return 'warning'
    return 'ok' if present else 'missing'


def build(root: str, stages: dict[str, dict], issues: list[Issue]) -> dict:
    issues = rank(issues)
    counts = {s: sum(1 for i in issues if i.severity == s) for s in SEVERITIES}
    return {
        'schema': 'mathodology.report/1',
        'root': root,
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'counts': counts,
        'stages': [{'id': s, **stages.get(s, {'state': 'missing', 'summary': ''})} for s in STAGES],
        'issues': [i.to_dict() for i in issues],
    }


def render(report: dict, limit: int | None = None, min_severity: str = 'info') -> str:
    keep = SEVERITIES[:SEVERITIES.index(min_severity) + 1]
    marks = {'ok': 'ok', 'warning': 'warn', 'error': 'FAIL', 'missing': '--'}
    lines = [f"Mathodology workspace: {report['root']}"]
    for stage in report['stages']:
        lines.append(f"  {marks.get(stage['state'], stage['state']):>4}  {stage['id']:<10} {stage.get('summary', '')}")
    c = report['counts']
    lines.append(f"  {c['error']} error(s), {c['warning']} warning(s), {c['info']} note(s)")
    shown = [i for i in report['issues'] if i['severity'] in keep]
    for item in shown[:limit] if limit else shown:
        lines.append('  - ' + Issue(**item).render())
    if limit and len(shown) > limit:
        lines.append(f'  ... {len(shown) - limit} more; run `mtd.py status` for the full list')
    return '\n'.join(lines)
