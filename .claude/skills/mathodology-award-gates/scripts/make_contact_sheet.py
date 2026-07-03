#!/usr/bin/env python3
"""make_contact_sheet.py -- build a labeled contact sheet FROM the compiled PDF.

The contact sheet MUST be built from the rendered PDF (via pdftoppm), never
from the source image files: a source-only sheet cannot catch typeset-stage
clipping, scaling, or caption defects. This script rasterises every page of a
compiled PDF and tiles the page images into a single labeled grid PNG for the
chart-quality review.

Prerequisites: poppler-utils (pdftoppm) on PATH, and matplotlib for tiling.

Usage:
    make_contact_sheet.py <file.pdf> -o sheet.png [--dpi 60]
    make_contact_sheet.py --self-test
"""

from __future__ import annotations

import argparse
import glob
import math
import os
import shutil
import subprocess
import sys
import tempfile


def _require_pdftoppm():
    if shutil.which("pdftoppm") is None:
        sys.exit(
            "make_contact_sheet: 'pdftoppm' not found. Install poppler-utils "
            "(macOS: 'brew install poppler'; Debian: 'apt-get install poppler-utils')."
        )


def _render_pages(pdf_path, dpi, out_dir):
    """Rasterise every page of the PDF into out_dir; return sorted PNG paths."""
    prefix = os.path.join(out_dir, "page")
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), pdf_path, prefix],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return sorted(glob.glob(prefix + "-*.png"))


def make_contact_sheet(pdf_path, out_path, dpi=60, cols=None):
    """Render ``pdf_path`` to a single labeled contact sheet at ``out_path``."""
    _require_pdftoppm()
    if not os.path.isfile(pdf_path):
        raise FileNotFoundError(pdf_path)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.image as mpimg
    import matplotlib.pyplot as plt

    tmp_dir = tempfile.mkdtemp(prefix="contact_sheet_")
    try:
        pages = _render_pages(pdf_path, dpi, tmp_dir)
        if not pages:
            raise RuntimeError(f"pdftoppm produced no pages for {pdf_path}")

        n = len(pages)
        if cols is None:
            cols = min(n, max(1, int(math.ceil(math.sqrt(n)))))
        rows = int(math.ceil(n / cols))

        fig, axes = plt.subplots(
            rows, cols, figsize=(cols * 3.2, rows * 4.2), squeeze=False
        )
        for idx in range(rows * cols):
            r, c = divmod(idx, cols)
            ax = axes[r][c]
            ax.set_xticks([])
            ax.set_yticks([])
            if idx < n:
                ax.imshow(mpimg.imread(pages[idx]))
                ax.set_title(f"Page {idx + 1}", fontsize=9)
                for spine in ax.spines.values():
                    spine.set_edgecolor("0.6")
            else:
                ax.axis("off")

        fig.suptitle(
            f"Contact sheet: {os.path.basename(pdf_path)} ({n} page(s), from compiled PDF)",
            fontsize=11,
        )
        fig.tight_layout(rect=(0, 0, 1, 0.97))
        out_dir = os.path.dirname(os.path.abspath(out_path))
        os.makedirs(out_dir, exist_ok=True)
        fig.savefig(out_path, dpi=110)
        plt.close(fig)
        return out_path
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _self_test():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages

    _require_pdftoppm()
    tmp_dir = tempfile.mkdtemp(prefix="contact_sheet_selftest_")
    try:
        pdf_path = os.path.join(tmp_dir, "three_pages.pdf")
        with PdfPages(pdf_path) as pdf:
            for i in (1, 2, 3):
                fig, ax = plt.subplots(figsize=(5, 4))
                ax.plot([0, 1, 2, 3], [i, i + 1, i, i + 2], marker="o")
                ax.set_title(f"Self-test page {i}")
                pdf.savefig(fig)
                plt.close(fig)

        out_path = os.path.join(tmp_dir, "sheet.png")
        result = make_contact_sheet(pdf_path, out_path, dpi=50)

        ok = True
        if not os.path.isfile(result):
            ok = False
            print("FAIL contact sheet was not written")
        elif os.path.getsize(result) <= 0:
            ok = False
            print("FAIL contact sheet is empty")
        else:
            print(f"PASS contact sheet produced ({os.path.getsize(result)} bytes)")
        print("make_contact_sheet self-test:", "OK" if ok else "FAILED")
        return 0 if ok else 1
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--self-test" in argv:
        return _self_test()

    parser = argparse.ArgumentParser(
        description="Build a labeled contact sheet from a compiled PDF."
    )
    parser.add_argument("pdf", help="path to the compiled PDF")
    parser.add_argument("-o", "--output", required=True, help="output PNG path")
    parser.add_argument("--dpi", type=int, default=60, help="render DPI (default 60)")
    parser.add_argument("--cols", type=int, default=None, help="columns in the grid")
    args = parser.parse_args(argv)

    out = make_contact_sheet(args.pdf, args.output, dpi=args.dpi, cols=args.cols)
    print(f"contact sheet written: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
