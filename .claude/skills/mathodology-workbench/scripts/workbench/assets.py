"""Are the figure files themselves usable? A plot that "looks fine" to a model is not evidence;
the bytes that landed in figures/ are. Headers and sizes are read directly, nothing is rendered."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import struct

from .latex import Paper
from .report import Issue
from .workspace import Workspace

INCLUDE = re.compile(r'\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}')
LENGTH = {'cm': 1 / 2.54, 'mm': 1 / 25.4, 'in': 1.0, 'pt': 1 / 72.27, 'bp': 1 / 72}
# Text width assumed when the geometry cannot be read: A4 with 2.5 cm margins.
DEFAULT_TEXTWIDTH_IN = 16 / 2.54
MIN_DPI = 150


@dataclass
class Image:
    kind: str
    ok: bool
    problem: str = ''
    width_px: int | None = None
    height_px: int | None = None


def _png(head: bytes) -> Image:
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        return Image('png', False, 'not a PNG file (bad signature)')
    w, h = struct.unpack('>II', head[16:24])
    return Image('png', w > 0 and h > 0, '' if w and h else 'PNG has zero size', w, h)


def _jpeg(path: Path) -> Image:
    data = path.read_bytes()[:1 << 20]
    if data[:2] != b'\xff\xd8':
        return Image('jpeg', False, 'not a JPEG file (bad signature)')
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return Image('jpeg', True, '', w, h)
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    return Image('jpeg', False, 'JPEG has no frame header (truncated?)')


def _pdf(path: Path, size: int) -> Image:
    with path.open('rb') as handle:
        head = handle.read(1024)
        handle.seek(max(0, size - 2048))
        tail = handle.read()
    if b'%PDF-' not in head:
        return Image('pdf', False, 'not a PDF file (no %PDF header)')
    if b'%%EOF' not in tail:
        return Image('pdf', False, 'PDF is truncated (no %%EOF); the script may have crashed while saving')
    return Image('pdf', True)


def inspect(path: Path) -> Image:
    suffix = path.suffix.lower()
    try:
        size = path.stat().st_size
        if size == 0:
            return Image(suffix.lstrip('.'), False, 'file is empty')
        if suffix == '.png':
            with path.open('rb') as handle:
                return _png(handle.read(32))
        if suffix in ('.jpg', '.jpeg'):
            return _jpeg(path)
        if suffix == '.pdf':
            return _pdf(path, size)
        head = path.read_bytes()[:4096]
        if suffix == '.svg':
            return Image('svg', b'<svg' in head or b'<?xml' in head, '' if b'<svg' in head or b'<?xml' in head else 'not an SVG file')
        if suffix == '.eps':
            return Image('eps', head.startswith(b'%!PS') or head[:4] == b'\xc5\xd0\xd3\xc6', '' if head.startswith(b'%!PS') or head[:4] == b'\xc5\xd0\xd3\xc6' else 'not an EPS file')
    except (OSError, struct.error) as exc:
        return Image(suffix.lstrip('.'), False, f'cannot read: {exc}')
    return Image(suffix.lstrip('.'), True)


def textwidth_in(paper: Paper) -> float:
    """Text width from a simple geometry setting; the A4 default otherwise."""
    text = '\n'.join(l.text for l in paper.lines[:400])
    m = re.search(r'\\usepackage\s*\[([^\]]*)\]\s*\{geometry\}', text) or re.search(r'\\geometry\s*\{([^}]*)\}', text)
    if not m:
        return DEFAULT_TEXTWIDTH_IN
    opts = dict(re.findall(r'(\w+)\s*=\s*([\d.]+\s*(?:cm|mm|in|pt|bp))', m.group(1)))

    def inches(v):
        n, unit = re.match(r'([\d.]+)\s*(\w+)', v).groups()
        return float(n) * LENGTH[unit]
    if 'textwidth' in opts:
        return inches(opts['textwidth'])
    paper_w = 8.5 if 'letterpaper' in m.group(1) else 21 / 2.54
    left = inches(opts.get('left', opts.get('hmargin', opts.get('margin', '2.5cm'))))
    right = inches(opts.get('right', opts.get('hmargin', opts.get('margin', '2.5cm'))))
    return max(paper_w - left - right, 1.0)


def print_width_in(options: str | None, textwidth: float) -> float | None:
    if not options:
        return None
    m = re.search(r'(?<![a-z])width\s*=\s*([\d.]*)\s*\\(?:textwidth|linewidth|columnwidth|hsize)', options)
    if m:
        return (float(m.group(1)) if m.group(1) else 1.0) * textwidth
    m = re.search(r'(?<![a-z])width\s*=\s*([\d.]+)\s*(cm|mm|in|pt|bp)', options)
    if m:
        return float(m.group(1)) * LENGTH[m.group(2)]
    return None


def check(ws: Workspace, paper: Paper, resolve) -> list[Issue]:
    """`resolve(name)` maps an \\includegraphics argument to a file, as the LaTeX checks do."""
    issues: list[Issue] = []
    checked: set[Path] = set()
    textwidth = textwidth_in(paper) if paper.kind == 'tex' else DEFAULT_TEXTWIDTH_IN
    if paper.kind == 'tex':
        for line in paper.lines:
            for m in INCLUDE.finditer(line.text):
                path = resolve(m.group(2).strip())
                if not path:
                    continue  # reported as a missing figure by the LaTeX checks
                image = inspect(path)
                checked.add(path)
                if not image.ok:
                    issues.append(Issue('error', 'figures', 'figures.corrupt', f'{ws.rel(path)}: {image.problem}', line.file, line.line,
                                        'rerun the script that draws it'))
                    continue
                width = print_width_in(m.group(1), textwidth)
                if image.width_px and width:
                    dpi = image.width_px / width
                    if dpi < MIN_DPI:
                        issues.append(Issue('warning', 'figures', 'figures.low-resolution',
                                            f'{ws.rel(path)} is {image.width_px} px wide but printed {width * 2.54:.1f} cm wide ({dpi:.0f} dpi)',
                                            line.file, line.line, f'export at {MIN_DPI}+ dpi (savefig(dpi=300)) or as PDF'))
    for path in ws.files('figures', ('.png', '.jpg', '.jpeg', '.pdf', '.svg', '.eps')):
        path = path.resolve()
        if path in checked:
            continue
        image = inspect(path)
        if not image.ok:
            issues.append(Issue('warning', 'figures', 'figures.corrupt', f'{ws.rel(path)}: {image.problem}', ws.rel(path)))
    return issues
