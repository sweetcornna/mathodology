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

# Anonymity scanning. An anonymity gate must bias toward flagging: a false
# positive costs a human a second look, a false negative leaks identity to the
# judges. Hard identity markers (email, team/control number) are checked on
# every metadata field; a personal-name residue is checked on the author/tool
# fields, exempting known rendering-toolchain tokens.
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+'
IDNUM_RE='[0-9]{5,}'   # team / control number (tool versions use dotted digits)
# Rendering toolchain / connective words that are NOT an identity.
SAFE_TOKENS='matplotlib latex tex pdftex xetex luatex tectonic pandoc ghostscript word microsoft libreoffice openoffice chromium chrome skia quartz wkhtmltopdf weasyprint cairo reportlab dvips groff prince princexml adobe acrobat distiller indesign apple preview mozilla firefox safari typst pdfkit itext fpdf pdflib hyperref beamer'
STOPWORDS='via and for with the personal edition pro professional version using generated document creator producer library'

die() { echo "pdf_qa: $*" >&2; exit 2; }

# Echo alphabetic tokens (len>=3) in a value that are neither a known tool nor a
# stopword -- i.e. residual identity text (used for the Author field).
identity_residual() {  # <value>
    printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z' '\n' \
        | awk -v toks="$SAFE_TOKENS $STOPWORDS" \
            'BEGIN{n=split(toks,a," ");for(i=1;i<=n;i++)s[a[i]]=1}
             length>=3 && !($0 in s){print}' || true
}

# Echo any "Capitalised Capitalised" bigram whose BOTH tokens are non-tool words
# -- i.e. a personal name like "Jane Doe" (used for Creator/Producer).
name_bigram_identity() {  # <value>
    printf '%s' "$1" | grep -oE '[A-Z][a-z]+[[:space:]]+[A-Z][a-z]+' 2>/dev/null | while IFS= read -r bg; do
        [ -n "$bg" ] || continue
        w1="${bg%%[[:space:]]*}"; w2="${bg##*[[:space:]]}"
        lw1="$(printf '%s' "$w1" | tr 'A-Z' 'a-z')"; lw2="$(printf '%s' "$w2" | tr 'A-Z' 'a-z')"
        case " $SAFE_TOKENS $STOPWORDS " in *" $lw1 "*) continue ;; esac
        case " $SAFE_TOKENS $STOPWORDS " in *" $lw2 "*) continue ;; esac
        echo "$bg"
    done || true
}

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
    local pdf="$1" info fail=0 f val res bg
    info="$(pdfinfo "$pdf" 2>/dev/null || true)"

    # 1) hard identity markers (email, team/control number) in ANY field
    for f in Title Author Subject Keywords Creator Producer; do
        val="$(printf '%s\n' "$info" | sed -n "s/^${f}:[[:space:]]*//p")"
        [ -n "$val" ] || continue
        if printf '%s' "$val" | grep -qE "$EMAIL_RE"; then
            echo "  FAIL anonymity: $f metadata contains an email address: '$val'"
            fail=1
        fi
        if printf '%s' "$val" | grep -qE "$IDNUM_RE"; then
            echo "  FAIL anonymity: $f metadata contains a team/control-number-like digit run: '$val'"
            fail=1
        fi
    done

    # 2) Author must carry no non-tool identity text at all
    val="$(printf '%s\n' "$info" | sed -n 's/^Author:[[:space:]]*//p')"
    if [ -n "$val" ]; then
        res="$(identity_residual "$val" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
        if [ -n "$res" ]; then
            echo "  FAIL anonymity: Author metadata looks like an identity (non-tool text: '$res'): '$val'"
            fail=1
        fi
    fi

    # 3) Creator/Producer: a personal-name bigram (e.g. 'Jane Doe')
    for f in Creator Producer; do
        val="$(printf '%s\n' "$info" | sed -n "s/^${f}:[[:space:]]*//p")"
        [ -n "$val" ] || continue
        bg="$(name_bigram_identity "$val" | head -n1)"
        if [ -n "$bg" ]; then
            echo "  FAIL anonymity: $f metadata contains a personal name ('$bg'): '$val'"
            fail=1
        fi
    done

    if [ "$fail" -eq 0 ]; then
        echo "  PASS anonymity: no identifying Title/Author/Subject/Keywords/Creator/Producer metadata"
    fi
    return "$fail"
}

check_blank_pages() {  # <pdf>
    # Heuristic: render every page to a low-res PNG. A near-uniform (blank)
    # page compresses to a tiny PNG. Flag pages far below the median size.
    # floor tuned between a truly-blank page (~300B at 30 DPI) and a
    # sparse-but-real text page (~1200B) to avoid flagging real content.
    local pdf="$1" tmp png sizes median floor=800 flagged=0 n i sz
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
        # A page below the absolute floor is essentially content-free at 30 DPI.
        # This catches a lone/all-blank PDF (where every page is at the median),
        # which a purely median-relative test can never flag.
        if [ "$sz" -lt "$floor" ]; then
            echo "  FAIL blank-page: page $i looks blank (${sz}B < floor ${floor}B; median ${median}B)"
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

# anon_clean.pdf: real content, no identifying metadata (matplotlib producer)
with PdfPages(f"{tmp}/anon_clean.pdf") as pdf:
    fig = plt.figure(figsize=(6, 4))
    fig.text(0.1, 0.9, "Figure 1: anonymous content page")
    fig.text(0.1, 0.5, "Body text so the page is not blank. " * 6)
    pdf.savefig(fig); plt.close(fig)

# leak.pdf: identity planted across several metadata fields
with PdfPages(f"{tmp}/leak.pdf") as pdf:
    fig = plt.figure(figsize=(6, 4))
    fig.text(0.1, 0.5, "Body text so the page is not blank. " * 6)
    pdf.savefig(fig); plt.close(fig)
    d = pdf.infodict()
    d["Title"] = "Team 2501234 Solution"     # control/team number
    d["Author"] = "Jane Doe"                  # personal name
    d["Subject"] = "contact john@example.com"  # email
    d["Keywords"] = "team 2412345"            # control number

# blank.pdf: a single, fully-blank page (all-blank case)
with PdfPages(f"{tmp}/blank.pdf") as pdf:
    fig = plt.figure(figsize=(6, 4))
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

    echo "--- anon_clean.pdf --anonymous (expect PASS) ---"
    if run_qa "$tmp/anon_clean.pdf" "" 1; then
        echo "PASS anon_clean.pdf passed anonymity"
    else
        echo "FAIL anon_clean.pdf should have passed anonymity"; ok=0
    fi

    echo "--- leak.pdf --anonymous (expect identity leak caught) ---"
    if run_qa "$tmp/leak.pdf" "" 1; then
        echo "FAIL leak.pdf should have failed anonymity (team number/email/name)"; ok=0
    else
        echo "PASS leak.pdf failed as expected (metadata identity leak caught)"
    fi

    echo "--- blank.pdf (expect all-blank page caught) ---"
    if run_qa "$tmp/blank.pdf" "" 0; then
        echo "FAIL blank.pdf should have failed on a blank page"; ok=0
    else
        echo "PASS all-blank page caught"
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
