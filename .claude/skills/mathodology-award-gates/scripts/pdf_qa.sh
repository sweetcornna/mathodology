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

# Byte-wise collation so the ASCII ranges below behave identically on BSD and
# GNU tooling regardless of the caller's locale. CJK is matched explicitly
# (has_cjk) rather than through locale-dependent character classes.
export LC_ALL=C

# Anonymity scanning. An anonymity gate must bias toward flagging: a false
# positive costs a human a second look, a false negative leaks identity to the
# judges. Hard identity markers (email, team/control number) are checked on
# every metadata field; a personal-name residue is checked on the author/tool
# fields, exempting known rendering-toolchain tokens.
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+'
IDNUM_RE='[0-9]{5,}'   # team / control number (tool versions use dotted digits)
# Rendering toolchain / connective words that are NOT an identity.
SAFE_TOKENS='matplotlib latex tex pdftex xetex luatex tectonic pandoc ghostscript word microsoft libreoffice openoffice chromium chrome skia quartz wkhtmltopdf weasyprint cairo reportlab dvips groff prince princexml adobe acrobat distiller indesign apple preview mozilla firefox safari typst pdfkit itext fpdf pdflib hyperref beamer google docs renderer office writer'
STOPWORDS='via and for with the personal edition pro professional version using generated document creator producer library'

# Page-1 body-text identity shapes. A control number is REQUIRED on an MCM
# summary sheet, so digit runs are deliberately not flagged in body text --
# only affiliation/author shapes and emails are.
AFFIL_RE='(University|College|Institute|Academy) of [A-Z][a-z]+|[A-Z][a-z]+ (University|College)|School of [A-Z][a-z]+'
AUTHORLINE_RE='^[[:space:]]*(Author|Authors|Submitted by|Prepared by)[[:space:]]*:'
# Chinese identity labels (matched as literal UTF-8 byte sequences under LC_ALL=C).
CN_ID_LABELS='姓名 学校 学院 指导教师 参赛队员 参赛学校 联系电话 队员'

die() { echo "pdf_qa: $*" >&2; exit 2; }

# True when the value contains a CJK ideograph. Prefers python3 (exact code
# point ranges); falls back to matching the UTF-8 lead/continuation byte shape
# of the CJK blocks, which is all that is available in a pure-POSIX shell.
has_cjk() {  # <value>
    if command -v python3 >/dev/null 2>&1; then
        printf '%s' "$1" | PYTHONUTF8=1 python3 -c 'import sys, re
data = sys.stdin.buffer.read().decode("utf-8", "replace")
sys.exit(0 if re.search(r"[㐀-䶿一-鿿豈-﫿]", data) else 1)' 2>/dev/null
    else
        printf '%s' "$1" | grep -q $'[\xe3-\xe9][\x80-\xbf][\x80-\xbf]'
    fi
}

# Strip dotted version numbers (e.g. 'Distiller 21.0.20155') so a tool version
# is never mistaken for a team/control number by IDNUM_RE.
strip_versions() {  # <value>
    printf '%s' "$1" | sed -E 's/[0-9]+(\.[0-9]+)+//g'
}

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

# Echo whitespace-normalised caption prefixes found in the text on stdin, one
# per line. Three capture shapes:
#   1. colon style, anywhere on a line (a cross-reference almost never ends in
#      a colon, so this is safe to match mid-sentence);
#   2. period style, LINE-ANCHORED only -- 'as shown in Figure 1.' at the end
#      of a sentence would otherwise collide with its own caption;
#   3. Chinese captions (图 N / 表 N), line-anchored for the same reason.
# Normalising whitespace makes 'Figure  1:' and 'Figure 1:' compare equal.
extract_caption_prefixes() {
    local text; text="$(cat)"
    {
        printf '%s\n' "$text" | grep -oE '(Figure|Table|Fig\.)[[:space:]]*[0-9]+:'
        printf '%s\n' "$text" | grep -oE '^[[:space:]]*(Figure|Table|Fig\.)[[:space:]]*[0-9]+\.'
        printf '%s\n' "$text" | grep -oE '^[[:space:]]*(图|表)[[:space:]]*[0-9]+'
    } 2>/dev/null | sed 's/[[:space:]]//g' | grep -v '^$' || true
}

check_duplicate_captions() {  # <pdf>
    local pdf="$1" prefixes dups
    prefixes="$(pdftotext "$pdf" - 2>/dev/null | extract_caption_prefixes || true)"
    if [ -z "$prefixes" ]; then
        echo "  PASS captions: no 'Figure N' / 'Table N' / '图 N' / '表 N' prefixes found"
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
    local pdf="$1" info fail=0 f val res bg lbl page1
    info="$(pdfinfo "$pdf" 2>/dev/null || true)"

    # 1) hard identity markers (email, team/control number) in ANY field
    for f in Title Author Subject Keywords Creator Producer; do
        val="$(printf '%s\n' "$info" | sed -n "s/^${f}:[[:space:]]*//p")"
        [ -n "$val" ] || continue
        if printf '%s' "$val" | grep -qE "$EMAIL_RE"; then
            echo "  FAIL anonymity: $f metadata contains an email address: '$val'"
            fail=1
        fi
        if strip_versions "$val" | grep -qE "$IDNUM_RE"; then
            echo "  FAIL anonymity: $f metadata contains a team/control-number-like digit run: '$val'"
            fail=1
        fi
    done

    # 2) Author must carry no non-tool identity text at all. A Chinese personal
    # name has no ASCII residue at all, so it must be checked separately --
    # this is the expected leak shape on a CUMCM submission.
    val="$(printf '%s\n' "$info" | sed -n 's/^Author:[[:space:]]*//p')"
    if [ -n "$val" ]; then
        res="$(identity_residual "$val" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
        if [ -n "$res" ]; then
            echo "  FAIL anonymity: Author metadata looks like an identity (non-tool text: '$res'): '$val'"
            fail=1
        fi
        if has_cjk "$val"; then
            echo "  FAIL anonymity: Author metadata contains CJK text (personal name?): '$val'"
            fail=1
        fi
    fi

    # 3) Creator/Producer: a personal-name bigram (e.g. 'Jane Doe') or CJK text
    for f in Creator Producer; do
        val="$(printf '%s\n' "$info" | sed -n "s/^${f}:[[:space:]]*//p")"
        [ -n "$val" ] || continue
        bg="$(name_bigram_identity "$val" | head -n1)"
        if [ -n "$bg" ]; then
            echo "  FAIL anonymity: $f metadata contains a personal name ('$bg'): '$val'"
            fail=1
        fi
        if has_cjk "$val"; then
            echo "  FAIL anonymity: $f metadata contains CJK text (personal name?): '$val'"
            fail=1
        fi
    done

    # 4) CJK in the descriptive fields is legitimate (a Chinese paper title) but
    # is where an institution name hides -- surface it for review, do not fail.
    for f in Title Subject Keywords; do
        val="$(printf '%s\n' "$info" | sed -n "s/^${f}:[[:space:]]*//p")"
        [ -n "$val" ] || continue
        if has_cjk "$val"; then
            echo "  WARN anonymity: $f metadata has CJK text -- confirm it names no school or person: '$val'"
        fi
    done

    # 5) Page-1 body text. The title page / summary sheet is where identity
    # actually leaks. A control number is REQUIRED there by MCM rules, so digit
    # runs are deliberately not flagged -- only emails, affiliation shapes,
    # author lines, and Chinese identity labels.
    page1="$(pdftotext -f 1 -l 1 "$pdf" - 2>/dev/null || true)"
    if [ -n "$page1" ]; then
        if printf '%s\n' "$page1" | grep -qE "$EMAIL_RE"; then
            echo "  FAIL anonymity: page 1 body text contains an email address:"
            printf '%s\n' "$page1" | grep -oE "$EMAIL_RE" | head -n3 | sed 's/^/          /'
            fail=1
        fi
        if printf '%s\n' "$page1" | grep -qE "$AFFIL_RE"; then
            echo "  FAIL anonymity: page 1 body text names an institution:"
            printf '%s\n' "$page1" | grep -oE "$AFFIL_RE" | head -n3 | sed 's/^/          /'
            fail=1
        fi
        if printf '%s\n' "$page1" | grep -qE "$AUTHORLINE_RE"; then
            echo "  FAIL anonymity: page 1 body text has an author/attribution line:"
            printf '%s\n' "$page1" | grep -E "$AUTHORLINE_RE" | head -n3 | sed 's/^/          /'
            fail=1
        fi
        for lbl in $CN_ID_LABELS; do
            if printf '%s\n' "$page1" | grep -q "$lbl"; then
                echo "  FAIL anonymity: page 1 body text contains the identity label '$lbl'"
                fail=1
            fi
        done
    fi

    if [ "$fail" -eq 0 ]; then
        echo "  PASS anonymity: no identifying metadata and no page-1 identity leak"
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

# Text- and CLI-level checks that need no rendered PDF. These cover the shapes
# a fixture cannot exercise: CJK captions and labels would need a CJK font
# installed to survive matplotlib rendering, and argument validation never
# reaches the QA stage at all.
self_test_patterns() {  # -> 0 ok, 1 failed
    local ok=1 out rc

    # has_cjk
    if has_cjk "张三"; then echo "PASS has_cjk detects a Chinese name"; else
        echo "FAIL has_cjk missed '张三'"; ok=0; fi
    if has_cjk "Jane Doe"; then echo "FAIL has_cjk flagged ASCII text"; ok=0; else
        echo "PASS has_cjk ignores ASCII text"; fi

    # strip_versions keeps a dotted tool version from reading as a control number
    if strip_versions "Acrobat Distiller 21.0.20155" | grep -qE "$IDNUM_RE"; then
        echo "FAIL dotted tool version still looks like a control number"; ok=0
    else
        echo "PASS dotted tool version is not a control number"
    fi
    if strip_versions "Team 2501234" | grep -qE "$IDNUM_RE"; then
        echo "PASS a real control number survives version stripping"
    else
        echo "FAIL control number lost to version stripping"; ok=0
    fi

    # Chinese duplicate captions
    out="$(printf '%s\n' "图 1 收敛曲线" "正文" "图1 另一张图" | extract_caption_prefixes | sort | uniq -d)"
    if [ -n "$out" ]; then echo "PASS duplicate Chinese caption prefix caught"; else
        echo "FAIL duplicate Chinese caption prefix missed"; ok=0; fi

    # Period-style duplicate captions
    out="$(printf '%s\n' "Figure 1. First" "body" "Figure 1. Second" | extract_caption_prefixes | sort | uniq -d)"
    if [ -n "$out" ]; then echo "PASS duplicate period-style caption prefix caught"; else
        echo "FAIL duplicate period-style caption prefix missed"; ok=0; fi

    # A mid-sentence cross-reference must NOT collide with its own caption
    out="$(printf '%s\n' "Figure 1. First" "as shown in Figure 1." | extract_caption_prefixes | sort | uniq -d)"
    if [ -n "$out" ]; then
        echo "FAIL mid-sentence cross-reference falsely read as a duplicate caption"; ok=0
    else
        echo "PASS mid-sentence cross-reference is not a duplicate caption"
    fi

    # argument validation (must exit 2, not silently disable a gate)
    for bad in "--max-pages abc" "--max-pages 0"; do
        # shellcheck disable=SC2086
        out="$("$0" /nonexistent.pdf $bad 2>&1)" && rc=0 || rc=$?
        if [ "$rc" -eq 2 ]; then echo "PASS '$bad' rejected"; else
            echo "FAIL '$bad' not rejected (rc=$rc): $out"; ok=0; fi
    done
    out="$("$0" /nonexistent.pdf --max-pages 2>&1)" && rc=0 || rc=$?
    if [ "$rc" -eq 2 ] && [ -n "$out" ]; then
        echo "PASS dangling --max-pages rejected with a message"
    else
        echo "FAIL dangling --max-pages not reported (rc=$rc): '$out'"; ok=0
    fi
    out="$("$0" a.pdf b.pdf 2>&1)" && rc=0 || rc=$?
    if [ "$rc" -eq 2 ]; then echo "PASS second positional PDF rejected"; else
        echo "FAIL second positional PDF silently dropped (rc=$rc)"; ok=0; fi

    return $((1 - ok))
}

self_test() {
    require_poppler
    local pattern_rc=0
    echo "--- pattern & argument checks (no PDF needed) ---"
    self_test_patterns || pattern_rc=1
    if ! command -v python3 >/dev/null 2>&1 || ! python3 -c "import matplotlib" >/dev/null 2>&1; then
        echo "pdf_qa self-test: PDF fixtures SKIPPED (python3 + matplotlib required to synthesise test PDFs)."
        echo "  Install with: python3 -m pip install matplotlib"
        if [ "$pattern_rc" -eq 0 ]; then
            echo "pdf_qa self-test: OK (patterns only)"; return 0
        fi
        echo "pdf_qa self-test: FAILED (pattern checks)"; return 1
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

# cjk_leak.pdf: a Chinese personal name in Author -- the expected CUMCM leak
# shape, invisible to ASCII-only checks. Metadata needs no CJK font, so this
# fixture works even where matplotlib cannot render CJK glyphs.
with PdfPages(f"{tmp}/cjk_leak.pdf") as pdf:
    fig = plt.figure(figsize=(6, 4))
    fig.text(0.1, 0.5, "Body text so the page is not blank. " * 6)
    pdf.savefig(fig); plt.close(fig)
    d = pdf.infodict()
    d["Author"] = "张三"  # 张三

# body_leak.pdf: clean metadata, but an email in the page-1 body text -- the
# classic title-page leak that a metadata-only gate misses.
with PdfPages(f"{tmp}/body_leak.pdf") as pdf:
    fig = plt.figure(figsize=(6, 4))
    fig.text(0.1, 0.7, "Contact: jane.doe@example.edu")
    fig.text(0.1, 0.5, "Body text so the page is not blank. " * 6)
    pdf.savefig(fig); plt.close(fig)

# versioned.pdf: clean, but with a dotted tool version in Producer that an
# unstripped digit-run check would falsely flag as a control number.
with PdfPages(f"{tmp}/versioned.pdf") as pdf:
    fig = plt.figure(figsize=(6, 4))
    fig.text(0.1, 0.9, "Figure 1: content page")
    fig.text(0.1, 0.5, "Body text so the page is not blank. " * 6)
    pdf.savefig(fig); plt.close(fig)
    d = pdf.infodict()
    d["Producer"] = "Acrobat Distiller 21.0.20155"

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

    echo "--- cjk_leak.pdf --anonymous (expect Chinese author name caught) ---"
    if run_qa "$tmp/cjk_leak.pdf" "" 1; then
        echo "FAIL cjk_leak.pdf should have failed anonymity (CJK author name)"; ok=0
    else
        echo "PASS cjk_leak.pdf failed as expected (CJK author name caught)"
    fi

    echo "--- body_leak.pdf --anonymous (expect page-1 email caught) ---"
    if run_qa "$tmp/body_leak.pdf" "" 1; then
        echo "FAIL body_leak.pdf should have failed anonymity (page-1 email)"; ok=0
    else
        echo "PASS body_leak.pdf failed as expected (page-1 email caught)"
    fi

    echo "--- versioned.pdf --anonymous (expect dotted tool version tolerated) ---"
    if run_qa "$tmp/versioned.pdf" "" 1; then
        echo "PASS versioned.pdf passed (dotted tool version not misread as control number)"
    else
        echo "FAIL versioned.pdf should have passed anonymity"; ok=0
    fi

    echo "--- blank.pdf (expect all-blank page caught) ---"
    if run_qa "$tmp/blank.pdf" "" 0; then
        echo "FAIL blank.pdf should have failed on a blank page"; ok=0
    else
        echo "PASS all-blank page caught"
    fi

    rm -rf "$tmp"
    if [ "$ok" -eq 1 ] && [ "$pattern_rc" -eq 0 ]; then
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
            --max-pages)
                # A silently-dropped or non-numeric cap would disable the
                # page gate while still reporting PASS, so reject it loudly.
                [ "$#" -ge 2 ] || die "--max-pages requires a value"
                max="$2"
                case "$max" in
                    ''|*[!0-9]*) die "--max-pages must be a positive integer (got '$max')" ;;
                esac
                [ "$max" -gt 0 ] || die "--max-pages must be a positive integer (got '$max')"
                shift 2
                ;;
            --anonymous) anon=1; shift ;;
            -*) die "unknown option: $1" ;;
            *)
                [ -z "$pdf" ] || die "one PDF per invocation (already given '$pdf', then '$1')"
                pdf="$1"; shift
                ;;
        esac
    done
    [ -n "$pdf" ] || die "no PDF path given"
    run_qa "$pdf" "$max" "$anon"
    exit "$?"
}

main "$@"
