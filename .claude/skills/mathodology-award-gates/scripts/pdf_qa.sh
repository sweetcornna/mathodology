#!/usr/bin/env bash
#
# pdf_qa.sh -- rendered-PDF QA gate for award-tier contest submissions.
#
# Runs against the COMPILED PDF (never the source markdown/latex/images),
# because typeset-stage defects -- duplicate caption prefixes, identity leaks
# in the document metadata, blank pages, page-count overruns -- only appear
# after rendering.
#
# Prerequisites: poppler-utils (pdfinfo, pdftoppm, pdftotext).
#   macOS : brew install poppler
#   Debian: apt-get install poppler-utils
# The --self-test additionally needs python3 + matplotlib to synthesise PDFs;
# it skips (does not fail) with an actionable message when they are missing.
#
# Usage:
#   pdf_qa.sh <file.pdf> [--max-pages N] [--anonymous]
#   pdf_qa.sh --self-test
#
# Exit status is non-zero on any failed check.

set -euo pipefail

# Known non-personal PDF "Creator"/"Producer" values that are safe under
# anonymity (rendering toolchains, not author names).
SAFE_CREATOR_RE='matplotlib|latex|tex|pdftex|xetex|luatex|tectonic|pandoc|ghostscript|word|libreoffice|openoffice|chromium|chrome|skia|quartz|wkhtmltopdf|weasyprint|cairo|reportlab|dvips|groff|prince'

die() { echo "pdf_qa: $*" >&2; exit 2; }

require_poppler() {
    local missing=()
    for t in pdfinfo pdftoppm pdftotext; do
        command -v "$t" >/dev/null 2>&1 || missing+=("$t")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        die "missing poppler-utils tool(s): ${missing[*]}. Install poppler (macOS: 'brew install poppler'; Debian: 'apt-get install poppler-utils')."
    fi
}

# ---- individual checks: each prints findings and returns 1 on failure ----

check_pages() {  # <pdf> <max_pages_or_empty>
    local pdf="$1" max="$2" pages
    pages="$(pdfinfo "$pdf" 2>/dev/null | awk -F: '/^Pages:/{gsub(/ /,"",$2); print $2}')"
    if [ -z "$pages" ]; then
        echo "  FAIL page-count: pdfinfo could not read '$pdf'"
        return 1
    fi
    echo "  info  pages: $pages"
    if [ -n "$max" ] && [ "$pages" -gt "$max" ]; then
        echo "  FAIL page-count: $pages pages exceeds --max-pages $max"
        return 1
    fi
    echo "  PASS page-count"
    return 0
}

check_duplicate_captions() {  # <pdf>
    local pdf="$1" prefixes dups
    prefixes="$(pdftotext "$pdf" - 2>/dev/null | grep -oE '(Figure|Table) [0-9]+:' || true)"
    if [ -z "$prefixes" ]; then
        echo "  PASS captions: no 'Figure N:' / 'Table N:' prefixes found"
        return 0
    fi
    dups="$(printf '%s\n' "$prefixes" | sort | uniq -d || true)"
    if [ -n "$dups" ]; then
        echo "  FAIL captions: duplicate caption prefix(es) in rendered PDF:"
        printf '%s\n' "$dups" | sed 's/^/          /'
        return 1
    fi
    echo "  PASS captions: no duplicate caption prefixes"
    return 0
}

check_anonymity() {  # <pdf>  (only called under --anonymous)
    local pdf="$1" info author creator fail=0
    info="$(pdfinfo "$pdf" 2>/dev/null || true)"
    author="$(printf '%s\n' "$info" | sed -n 's/^Author:[[:space:]]*//p')"
    creator="$(printf '%s\n' "$info" | sed -n 's/^Creator:[[:space:]]*//p')"
    if [ -n "$author" ]; then
        echo "  FAIL anonymity: Author metadata is set: '$author' (must be empty for anonymous submission)"
        fail=1
    fi
    if [ -n "$creator" ] && ! printf '%s' "$creator" | grep -qiE "$SAFE_CREATOR_RE"; then
        echo "  FAIL anonymity: Creator metadata looks like an identity: '$creator'"
        fail=1
    fi
    if [ "$fail" -eq 0 ]; then
        echo "  PASS anonymity: no identifying Author/Creator metadata"
    fi
    return "$fail"
}

check_blank_pages() {  # <pdf>
    # Heuristic: render every page to a low-res PNG. A near-uniform (blank)
    # page compresses to a tiny PNG. Flag pages far below the median size.
    local pdf="$1" tmp png sizes median floor=1200 flagged=0 n i sz
    tmp="$(mktemp -d)"
    if ! pdftoppm -png -r 30 "$pdf" "$tmp/pg" >/dev/null 2>&1; then
        echo "  FAIL blank-page: pdftoppm could not rasterise '$pdf'"
        rm -rf "$tmp"
        return 1
    fi
    sizes=()
    for png in "$tmp"/pg-*.png; do
        [ -e "$png" ] || continue
        sizes+=("$(wc -c < "$png")")
    done
    n="${#sizes[@]}"
    if [ "$n" -eq 0 ]; then
        echo "  FAIL blank-page: no pages rasterised"
        rm -rf "$tmp"
        return 1
    fi
    median="$(printf '%s\n' "${sizes[@]}" | sort -n | awk '{a[NR]=$1} END{print (NR%2)?a[(NR+1)/2]:int((a[NR/2]+a[NR/2+1])/2)}')"
    i=0
    for png in "$tmp"/pg-*.png; do
        [ -e "$png" ] || continue
        i=$((i + 1))
        sz="${sizes[$((i - 1))]}"
        # blank iff both below an absolute floor AND well under the median
        if [ "$sz" -lt "$floor" ] && [ "$((sz * 100))" -lt "$((median * 20))" ]; then
            echo "  FAIL blank-page: page $i looks blank/near-uniform (${sz}B vs median ${median}B)"
            flagged=1
        fi
    done
    rm -rf "$tmp"
    [ "$flagged" -eq 0 ] && echo "  PASS blank-page: no near-uniform pages (median ${median}B over $n page(s))"
    return "$flagged"
}

run_qa() {  # <pdf> <max> <anonymous 0|1>
    local pdf="$1" max="$2" anon="$3" rc=0
    [ -f "$pdf" ] || die "no such file: $pdf"
    echo "pdf_qa: $pdf"
    check_pages "$pdf" "$max" || rc=1
    check_duplicate_captions "$pdf" || rc=1
    if [ "$anon" -eq 1 ]; then
        check_anonymity "$pdf" || rc=1
    fi
    check_blank_pages "$pdf" || rc=1
    if [ "$rc" -eq 0 ]; then
        echo "pdf_qa: PASS ($pdf)"
    else
        echo "pdf_qa: FAIL ($pdf)"
    fi
    return "$rc"
}

# ------------------------------- self-test -------------------------------
self_test() {
    require_poppler
    if ! command -v python3 >/dev/null 2>&1 || ! python3 -c "import matplotlib" >/dev/null 2>&1; then
        echo "pdf_qa self-test: SKIPPED (python3 + matplotlib required to synthesise test PDFs)."
        echo "  Install with: python3 -m pip install matplotlib"
        return 0
    fi
    local tmp ok=1; tmp="$(mktemp -d)"
    python3 - "$tmp" <<'PY'
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

tmp = sys.argv[1]

# clean.pdf: 2 content pages, distinct caption prefixes, no blank page
with PdfPages(f"{tmp}/clean.pdf") as pdf:
    for i in (1, 2):
        fig = plt.figure(figsize=(6, 4))
        fig.text(0.1, 0.9, f"Figure {i}: distinct caption for page {i}")
        fig.text(0.1, 0.5, "Body text so the page is clearly not blank. " * 6)
        ax = fig.add_axes([0.1, 0.1, 0.8, 0.3]); ax.plot([0, 1, 2], [1, 3, 2])
        pdf.savefig(fig); plt.close(fig)

# dup.pdf: same "Figure 1:" caption prefix planted on two pages
with PdfPages(f"{tmp}/dup.pdf") as pdf:
    for _ in (1, 2):
        fig = plt.figure(figsize=(6, 4))
        fig.text(0.1, 0.9, "Figure 1: a caption prefix that repeats")
        fig.text(0.1, 0.5, "Body text so the page is not blank. " * 6)
        pdf.savefig(fig); plt.close(fig)
print("fixtures-built")
PY

    echo "--- clean.pdf (expect PASS) ---"
    if run_qa "$tmp/clean.pdf" 5 0; then
        echo "PASS clean.pdf passed all checks"
    else
        echo "FAIL clean.pdf should have passed"; ok=0
    fi

    echo "--- dup.pdf (expect duplicate caption caught) ---"
    if run_qa "$tmp/dup.pdf" "" 0; then
        echo "FAIL dup.pdf should have failed on duplicate captions"; ok=0
    else
        echo "PASS dup.pdf failed as expected (duplicate caption caught)"
    fi

    echo "--- clean.pdf --max-pages 1 (expect page-count fail) ---"
    if run_qa "$tmp/clean.pdf" 1 0; then
        echo "FAIL page-count overrun should have failed"; ok=0
    else
        echo "PASS page-count overrun caught"
    fi

    rm -rf "$tmp"
    if [ "$ok" -eq 1 ]; then
        echo "pdf_qa self-test: OK"; return 0
    fi
    echo "pdf_qa self-test: FAILED"; return 1
}

# --------------------------------- main ----------------------------------
main() {
    if [ "$#" -eq 0 ]; then
        echo "usage: pdf_qa.sh <file.pdf> [--max-pages N] [--anonymous]" >&2
        echo "       pdf_qa.sh --self-test" >&2
        exit 2
    fi
    if [ "$1" = "--self-test" ]; then
        self_test
        exit "$?"
    fi
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        echo "usage: pdf_qa.sh <file.pdf> [--max-pages N] [--anonymous]"
        echo "       pdf_qa.sh --self-test"
        exit 0
    fi

    require_poppler
    local pdf="" max="" anon=0
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --max-pages) max="${2:-}"; shift 2 ;;
            --anonymous) anon=1; shift ;;
            -*) die "unknown option: $1" ;;
            *) pdf="$1"; shift ;;
        esac
    done
    [ -n "$pdf" ] || die "no PDF path given"
    run_qa "$pdf" "$max" "$anon"
    exit "$?"
}

main "$@"
