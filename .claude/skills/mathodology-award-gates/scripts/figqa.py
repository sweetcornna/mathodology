#!/usr/bin/env python3
"""figqa.py -- matplotlib bbox-collision QA gate for award-tier figures.

This is both an importable library and a CLI. It never renders to a contact
sheet and never reads source image files: it inspects a live ``matplotlib``
``Figure`` after it has been drawn and reports where text/annotation/legend
artists collide with data artists (bars, lines, scatter points) or with each
other, plus any text-like artist whose box escapes the figure bounds.

Library API
-----------
    from figqa import collisions, assert_no_overlap
    collisions(fig)        -> list[dict]   # empty means clean
    assert_no_overlap(fig)                 # raises AssertionError listing hits

Wire ``assert_no_overlap(fig)`` into the figure factory (and into ``run_all``)
so a rendering defect fails the run the same way a failed numeric check does.

Design notes (hard-won production pitfalls, do not "simplify" away)
------------------------------------------------------------------
* Line2D: a diagonal line's bounding box covers a huge rectangle, so comparing
  a text box against a *line bbox* false-positives almost everything. Instead we
  sample points along the line's screen-space segments and only flag when a
  sampled point actually lands inside a text box.
* Annotation: ``Annotation.get_window_extent`` returns only the TEXT box, never
  the arrow. We rely on that and additionally exclude ``FancyArrowPatch`` from
  the data-patch set so an annotation arrow can never be treated as a bar.
* Host patch: a value label that sits fully inside its own bar is legitimate.
  Only a text box that *partially* overlaps a patch (crossing into a foreign
  filled region) is a collision. Legends get no such exemption -- a legend over
  bars is always a defect.
* Zero-size / invisible artists are ignored.

Only matplotlib (and its bundled numpy) are required.
"""

from __future__ import annotations

import sys

try:
    import numpy as np
    from matplotlib.collections import Collection  # noqa: F401  (documented surface)
    from matplotlib.legend import Legend  # noqa: F401
    from matplotlib.lines import Line2D  # noqa: F401
    from matplotlib.patches import FancyArrowPatch
    from matplotlib.text import Annotation, Text  # noqa: F401
    from matplotlib.transforms import Bbox, IdentityTransform
except ImportError as exc:  # pragma: no cover - environment-dependent
    print(
        f"figqa: missing prerequisite: {exc}.\n"
        "Install with: python3 -m pip install matplotlib\n"
        "(or run under an environment that has matplotlib, e.g. "
        "'uv run --with matplotlib python3 ...')",
        file=sys.stderr,
    )
    raise SystemExit(2)

# Line2D linestyle values that draw no connecting stroke; only markers show.
_NO_LINESTYLE = ("None", "none", "", " ")

# Pixel tolerances. Kept small so a genuine 1px edge touch is not a "defect"
# while a real overlap (many px^2) always trips.
TOL = 1.0          # generic slack for "fully inside" / figure-bounds tests
MIN_AREA = 2.0     # minimum bbox intersection area (px^2) counted as overlap
INSET = 0.75       # a sampled point must penetrate a text box by this many px


# --------------------------------------------------------------------------
# rendering helpers
# --------------------------------------------------------------------------
def _renderer(fig):
    """Draw the figure and return a usable renderer across backends."""
    fig.canvas.draw()
    getter = getattr(fig.canvas, "get_renderer", None)
    if getter is not None:
        try:
            return getter()
        except Exception:
            pass
    # Headless / non-Agg backend fallback: rasterise once via Agg. The
    # FigureCanvasAgg constructor re-parents fig.canvas as a side effect, which
    # would silently rebind a GUI-backend caller's figure -- restore it.
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    orig_canvas = fig.canvas
    canvas = FigureCanvasAgg(fig)
    canvas.draw()
    renderer = canvas.get_renderer()
    if orig_canvas is not None and orig_canvas is not canvas:
        fig.set_canvas(orig_canvas)
    return renderer


def _win_extent(artist, renderer):
    try:
        return artist.get_window_extent(renderer)
    except Exception:
        try:
            return artist.get_window_extent(renderer=renderer)
        except Exception:
            return None


def _usable(bb):
    return bb is not None and bb.width > 0 and bb.height > 0


def _inter_area(a, b):
    inter = Bbox.intersection(a, b)
    if inter is None:
        return 0.0
    w, h = inter.width, inter.height
    if w <= 0 or h <= 0:
        return 0.0
    return w * h


def _fully_inside(inner, outer, tol=TOL):
    return (
        inner.x0 >= outer.x0 - tol
        and inner.x1 <= outer.x1 + tol
        and inner.y0 >= outer.y0 - tol
        and inner.y1 <= outer.y1 + tol
    )


def _point_in(bb, x, y, inset=INSET):
    return (
        bb.x0 + inset <= x <= bb.x1 - inset
        and bb.y0 + inset <= y <= bb.y1 - inset
    )


def _label(text_artist):
    try:
        s = (text_artist.get_text() or "").strip()
    except Exception:
        s = ""
    s = " ".join(s.split())
    if len(s) > 40:
        s = s[:37] + "..."
    return f'"{s}"' if s else f"<{type(text_artist).__name__}>"


def _describe(artist, index):
    return f"{type(artist).__name__}#{index}"


# --------------------------------------------------------------------------
# sampling data artists into screen-space points (avoids diagonal-bbox trap)
# --------------------------------------------------------------------------
def _line_segments(line):
    """Screen-space polyline segments [(p0, p1), ...] with finite endpoints.

    Used instead of point-sampling: a fixed sample count steps over a label on
    a long segment (e.g. an axhline/axvline crossing a data label), so we test
    each segment against the text box exactly, independent of screen length.
    """
    xy = line.get_xydata()
    if xy is None or len(xy) == 0:
        return []
    disp = line.get_transform().transform(np.asarray(xy, dtype=float))
    disp = disp[np.isfinite(disp).all(axis=1)]
    if len(disp) < 2:
        return []
    return [(disp[i], disp[i + 1]) for i in range(len(disp) - 1)]


def _seg_box_hit(p0, p1, xmin, ymin, xmax, ymax):
    """True if segment p0->p1 intersects the axis-aligned box (Liang-Barsky).

    Density-independent: catches a line crossing a label on any segment length,
    including endpoints that fall inside the box.
    """
    if xmax <= xmin or ymax <= ymin:
        return False
    x0, y0 = float(p0[0]), float(p0[1])
    x1, y1 = float(p1[0]), float(p1[1])
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - xmin), (dx, xmax - x0), (-dy, y0 - ymin), (dy, ymax - y0)):
        if p == 0.0:
            if q < 0.0:
                return False  # parallel to this edge and outside the slab
        else:
            r = q / p
            if p < 0.0:
                if r > t1:
                    return False
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return False
                if r < t1:
                    t1 = r
    return t0 <= t1


def _collection_points(coll):
    try:
        offs = coll.get_offsets()
    except Exception:
        offs = None
    if offs is None or len(offs) == 0:
        return np.empty((0, 2))
    try:
        trans = coll.get_offset_transform()
    except Exception:
        trans = coll.get_transform()
    arr = np.asarray(offs, dtype=float)
    # LineCollections built by vlines/errorbar report a phantom single offset
    # at (0, 0) with an identity offset transform even though no point exists
    # there; mapped to display pixel (0, 0) it would false-positive any text
    # box at the figure's bottom-left corner.
    if len(arr) == 1 and np.allclose(arr, 0.0) and isinstance(trans, IdentityTransform):
        return np.empty((0, 2))
    disp = trans.transform(arr)
    return disp[np.isfinite(disp).all(axis=1)]


def _finite_points(pts):
    if len(pts) == 0:
        return pts
    return pts[np.isfinite(pts).all(axis=1)]


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------
def _mk(kind, ax_index, a, b, area=None):
    d = {"kind": kind, "axes": ax_index, "a": a, "b": b}
    if area is not None:
        d["overlap_px2"] = round(float(area), 1)
    return d


def collisions(fig, tol=TOL, min_area=MIN_AREA, inset=INSET):
    """Return a list of collision dicts for ``fig`` (empty == clean).

    Each dict has ``kind`` (one of ``text-over-patch``, ``legend-over-patch``,
    ``line-through-text``, ``point-under-text``, ``text-over-text``,
    ``clipped-out-of-figure``), the axes index (``-1`` for figure-level text
    such as the suptitle), and the two artists involved. Titles, axis labels,
    figure-level text, and the suptitle participate in the text checks; tick
    labels participate only in the legend-overlap check.
    """
    renderer = _renderer(fig)
    fig_bbox = fig.bbox
    found = []

    def _visible_text(t):
        try:
            return t is not None and t.get_visible() and (t.get_text() or "").strip()
        except Exception:
            return False

    # --- figure-level text (fig.text(...) entries and the suptitle, which
    # lives on fig._suptitle, NOT in fig.texts) ---
    fig_text_items = []
    for t in list(fig.texts) + [getattr(fig, "_suptitle", None)]:
        if not _visible_text(t):
            continue
        bb = _win_extent(t, renderer)
        if _usable(bb):
            fig_text_items.append((_label(t), bb))

    for ai, ax in enumerate(fig.axes):
        if not ax.get_visible():
            continue

        # --- text-like artists: Text + Annotation live in ax.texts; the
        # title and axis labels are separate artists and are exactly where
        # dense contest figures collide (legend over title, suptitle over an
        # axis label), so they join the text set too. ---
        text_items = []
        for t in ax.texts:
            if not t.get_visible():
                continue
            bb = _win_extent(t, renderer)   # Annotation -> text box only
            if _usable(bb):
                text_items.append((t, bb, _label(t)))
        for t in (ax.title, getattr(ax, "_left_title", None),
                  getattr(ax, "_right_title", None),
                  ax.xaxis.label, ax.yaxis.label):
            if not _visible_text(t):
                continue
            bb = _win_extent(t, renderer)
            if _usable(bb):
                text_items.append((t, bb, _label(t)))

        legend = ax.get_legend()
        legend_item = None
        if legend is not None and legend.get_visible():
            lb = _win_extent(legend, renderer)
            if _usable(lb):
                legend_item = (legend, lb)

        # boxes that data artists must not cross
        text_boxes = [(lbl, bb) for (_, bb, lbl) in text_items]
        if legend_item is not None:
            text_boxes.append(("legend", legend_item[1]))

        # --- data artists ---
        patches = [
            p for p in ax.patches
            if p.get_visible() and not isinstance(p, FancyArrowPatch)
        ]
        lines = [ln for ln in ax.lines if ln.get_visible()]
        colls = [c for c in ax.collections if c.get_visible()]

        # 1) text (labels) vs patches -- host patch exempted
        for (_, tb, lbl) in text_items:
            for pi, p in enumerate(patches):
                pb = _win_extent(p, renderer)
                if not _usable(pb):
                    continue
                area = _inter_area(tb, pb)
                if area <= min_area:
                    continue
                if _fully_inside(tb, pb, tol):
                    continue  # value label inside its own bar -> allowed
                found.append(_mk("text-over-patch", ai, lbl, _describe(p, pi), area))

        # 2) legend vs patches -- no host exemption
        if legend_item is not None:
            lb = legend_item[1]
            for pi, p in enumerate(patches):
                pb = _win_extent(p, renderer)
                if not _usable(pb):
                    continue
                area = _inter_area(lb, pb)
                if area > min_area:
                    found.append(_mk("legend-over-patch", ai, "legend",
                                     _describe(p, pi), area))

        # 3) lines vs text boxes -- exact segment-vs-box test (NOT the line bbox,
        #    and NOT fixed-count point sampling which steps over long segments).
        #    A marker-only line (linestyle 'None', e.g. plot(..., 'o')) draws no
        #    connecting stroke, so its vertices are tested as points instead of
        #    testing the phantom segments between them.
        for li, ln in enumerate(lines):
            if str(ln.get_linestyle()) in _NO_LINESTYLE:
                if str(ln.get_marker()) in ("", "None"):
                    continue  # draws nothing at all
                xy = ln.get_xydata()
                if xy is None or len(xy) == 0:
                    continue
                pts = ln.get_transform().transform(np.asarray(xy, dtype=float))
                pts = _finite_points(pts)
                for (lbl, tb) in text_boxes:
                    if any(_point_in(tb, x, y, inset) for x, y in pts):
                        found.append(_mk("point-under-text", ai, lbl,
                                         _describe(ln, li)))
                continue
            segs = _line_segments(ln)
            if not segs:
                continue
            for (lbl, tb) in text_boxes:
                xmin, ymin = tb.x0 + inset, tb.y0 + inset
                xmax, ymax = tb.x1 - inset, tb.y1 - inset
                if any(_seg_box_hit(p0, p1, xmin, ymin, xmax, ymax) for p0, p1 in segs):
                    found.append(_mk("line-through-text", ai, lbl,
                                     _describe(ln, li)))

        # 4) collection points vs text boxes
        for ci, c in enumerate(colls):
            pts = _finite_points(_collection_points(c))
            if len(pts) == 0:
                continue
            for (lbl, tb) in text_boxes:
                if any(_point_in(tb, x, y, inset) for x, y in pts):
                    found.append(_mk("point-under-text", ai, lbl,
                                     _describe(c, ci)))

        # 5) text vs text (legend included; figure-level text such as the
        #    suptitle is checked against this axes' text set here, and against
        #    itself once after the axes loop)
        for i in range(len(text_boxes)):
            for j in range(i + 1, len(text_boxes)):
                area = _inter_area(text_boxes[i][1], text_boxes[j][1])
                if area > min_area:
                    found.append(_mk("text-over-text", ai, text_boxes[i][0],
                                     text_boxes[j][0], area))
        for (flbl, fb) in fig_text_items:
            for (lbl, tb) in text_boxes:
                area = _inter_area(fb, tb)
                if area > min_area:
                    found.append(_mk("text-over-text", ai, flbl, lbl, area))

        # 5b) tick labels vs legend ONLY. Tick labels legitimately sit dense
        #    and close to data, so they stay out of the general text set; a
        #    legend parked on top of them is still always a defect.
        if legend_item is not None:
            lb = legend_item[1]
            for t in ax.get_xticklabels() + ax.get_yticklabels():
                if not _visible_text(t):
                    continue
                bb = _win_extent(t, renderer)
                if not _usable(bb):
                    continue
                area = _inter_area(lb, bb)
                if area > min_area:
                    found.append(_mk("text-over-text", ai, "legend",
                                     _label(t), area))

        # 6) clipped: text-like artist STRADDLING the figure edge (genuinely
        #    cut off). A box fully outside the canvas is an intentional
        #    outside-axes placement that a bbox_inches='tight' save captures, so
        #    it is not flagged; only a partial straddle is a real clip.
        for (lbl, bb) in text_boxes:
            if _fully_inside(bb, fig_bbox, tol):
                continue
            if _inter_area(bb, fig_bbox) <= min_area:
                continue  # fully off-canvas -> intentional outside placement
            found.append(_mk("clipped-out-of-figure", ai, lbl, "figure-bounds"))

    # --- figure-level text vs itself + figure bounds (outside the axes loop
    # so multi-axes figures do not repeat the same pair per axes) ---
    for i in range(len(fig_text_items)):
        for j in range(i + 1, len(fig_text_items)):
            area = _inter_area(fig_text_items[i][1], fig_text_items[j][1])
            if area > min_area:
                found.append(_mk("text-over-text", -1, fig_text_items[i][0],
                                 fig_text_items[j][0], area))
    for (lbl, bb) in fig_text_items:
        if _fully_inside(bb, fig_bbox, tol):
            continue
        if _inter_area(bb, fig_bbox) <= min_area:
            continue
        found.append(_mk("clipped-out-of-figure", -1, lbl, "figure-bounds"))

    return found


def assert_no_overlap(fig, **kwargs):
    """Raise ``AssertionError`` listing collisions; no-op when the figure is clean."""
    hits = collisions(fig, **kwargs)
    if hits:
        lines = []
        for d in hits:
            extra = f" ({d['overlap_px2']}px^2)" if "overlap_px2" in d else ""
            lines.append(f"  - [{d['kind']}] axes#{d['axes']}: {d['a']} X {d['b']}{extra}")
        raise AssertionError(
            "figqa: %d figure collision(s) detected:\n%s" % (len(hits), "\n".join(lines))
        )


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------
def _build_colliding_figure():
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 3))
    ax.bar([0, 1, 2], [3, 5, 4], label="Series A")
    ax.set_ylim(0, 6)  # tight: no headroom
    # legend forced onto the bars
    ax.legend(loc="center")
    # a wide annotation straddling a foreign bar (text box only measured)
    ax.annotate(
        "annotation label",
        xy=(2, 4), xytext=(2, 2),
        ha="center", va="center",
        arrowprops=dict(arrowstyle="->"),
    )
    return fig


def _build_line_through_label_figure():
    """A reference line crossing a data label on ONE long segment.

    Regression for the fixed-sample-count false negative: a vertical guide line
    running the full axes height is a single 2-vertex segment, so point sampling
    stepped over the label; segment-vs-box catches it.
    """
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 6))
    ax.plot([0, 10], [0, 100])
    ax.axvline(5.0)                       # one tall segment, full axes height
    ax.text(5, 20, "crossed label", ha="center", va="center")
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 100)
    return fig


def _build_clean_figure():
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 3))
    heights = [3, 5, 4]
    ax.bar([0, 1, 2], heights, label="Series A")
    ax.set_ylim(0, 11)  # reserved headroom for the legend
    for x, h in enumerate(heights):
        ax.text(x, h / 2.0, str(h), ha="center", va="center")  # inside its own bar
    ax.legend(loc="upper center")  # sits in the reserved headroom
    return fig


def _build_marker_only_figure():
    """Scatter-via-plot('o') with a mid-plot label the phantom segment crossed.

    Regression: linestyle 'None' draws no stroke between vertices, but the
    segment test used to connect them anyway, so any marker chart with a
    centred annotation falsely failed the gate.
    """
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 4))
    ax.plot([0, 10], [0, 100], "o", linestyle="None")  # two corner markers
    ax.text(5, 50, "centered label", ha="center", va="center")
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 100)
    return fig


def _build_marker_under_label_figure():
    """A marker sitting under a label must still be flagged (as a point)."""
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 4))
    ax.plot([5], [50], "o", linestyle="None", markersize=10)
    ax.text(5, 50, "label on marker", ha="center", va="center")
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 100)
    return fig


def _build_legend_over_title_figure():
    """A legend parked on the axes title -- invisible to the old text set."""
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 3))
    ax.plot([0, 1, 2], [1, 3, 2], label="Series A")
    ax.set_title("Axes title under the legend")
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, 0.98))  # on the title
    return fig


def _build_suptitle_over_label_figure():
    """A figure suptitle dropped onto the axes title (suptitle is not in
    fig.texts, so it needs its own collection path).

    The suptitle takes figure coordinates while the axes title renders in axes
    coordinates, so the title is measured after a draw and the suptitle is
    centred exactly on it to guarantee the overlap the test needs.
    """
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 3))
    ax.plot([0, 1, 2], [1, 3, 2])
    ax.set_title("Axes title")
    fig.canvas.draw()
    bb = ax.title.get_window_extent(fig.canvas.get_renderer())
    cx = (bb.x0 + bb.x1) / 2.0 / fig.bbox.width
    cy = (bb.y0 + bb.y1) / 2.0 / fig.bbox.height
    fig.suptitle("Figure suptitle", x=cx, y=cy, va="center")
    return fig


def _self_test():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ok = True

    colliding = _build_colliding_figure()
    hits = collisions(colliding)
    if hits:
        print(f"PASS colliding figure -> {len(hits)} collision(s) detected")
        for d in hits:
            print(f"     {d['kind']}: {d['a']} X {d['b']}")
    else:
        ok = False
        print("FAIL colliding figure -> no collision detected (expected >= 1)")
    try:
        assert_no_overlap(colliding)
        ok = False
        print("FAIL assert_no_overlap did not raise on the colliding figure")
    except AssertionError:
        print("PASS assert_no_overlap raised on the colliding figure")
    plt.close(colliding)

    crossing = _build_line_through_label_figure()
    hits = collisions(crossing)
    if any(d["kind"] == "line-through-text" for d in hits):
        print("PASS reference-line-through-label -> line-through-text detected")
    else:
        ok = False
        print("FAIL reference-line-through-label -> line crossing a label not detected")
    plt.close(crossing)

    marker_only = _build_marker_only_figure()
    hits = collisions(marker_only)
    if any(d["kind"] == "line-through-text" for d in hits):
        ok = False
        print("FAIL marker-only plot -> phantom segment falsely flagged line-through-text")
    else:
        print("PASS marker-only plot -> no phantom line-through-text")
    plt.close(marker_only)

    marker_under = _build_marker_under_label_figure()
    hits = collisions(marker_under)
    if any(d["kind"] == "point-under-text" for d in hits):
        print("PASS marker under a label -> point-under-text detected")
    else:
        ok = False
        print("FAIL marker under a label -> not detected")
    plt.close(marker_under)

    over_title = _build_legend_over_title_figure()
    hits = collisions(over_title)
    if any(d["kind"] == "text-over-text" for d in hits):
        print("PASS legend over the axes title -> text-over-text detected")
    else:
        ok = False
        print("FAIL legend over the axes title -> not detected")
    plt.close(over_title)

    sup = _build_suptitle_over_label_figure()
    hits = collisions(sup)
    if any(d["kind"] == "text-over-text" for d in hits):
        print("PASS suptitle over the axes title -> text-over-text detected")
    else:
        ok = False
        print("FAIL suptitle over the axes title -> not detected")
    plt.close(sup)

    clean = _build_clean_figure()
    hits = collisions(clean)
    if hits:
        ok = False
        print(f"FAIL clean figure -> {len(hits)} unexpected collision(s):")
        for d in hits:
            print(f"     {d['kind']}: {d['a']} X {d['b']}")
    else:
        print("PASS clean figure -> zero collisions")
    try:
        assert_no_overlap(clean)
        print("PASS assert_no_overlap silent on the clean figure")
    except AssertionError as exc:
        ok = False
        print(f"FAIL assert_no_overlap raised on the clean figure:\n{exc}")
    plt.close(clean)

    print("figqa self-test:", "OK" if ok else "FAILED")
    return 0 if ok else 1


def _usage():
    print(
        "usage: figqa.py --self-test\n"
        "\n"
        "figqa is primarily an importable gate:\n"
        "    from figqa import assert_no_overlap\n"
        "    assert_no_overlap(fig)   # raises on any figure collision\n"
    )


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--self-test" in argv:
        return _self_test()
    if "-h" in argv or "--help" in argv:
        _usage()
        return 0
    if not argv:
        # A bare invocation in an `&&`-chained gate script must not read as a
        # passed check, so it is an error, unlike an explicit --help.
        _usage()
        return 2
    print(f"figqa: unknown argument(s): {' '.join(argv)}", file=sys.stderr)
    _usage()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
