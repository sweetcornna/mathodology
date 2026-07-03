#!/usr/bin/env python3
"""lint_run.py -- validate Mathodology award-run structured blocks + judge aggregation.

Validates the four canonical run blocks (handoff / gate / scorecard /
decision_memo) whether they arrive as a bare ``.yaml`` file or as fenced
```yaml``` blocks inside a ``.md`` file, and aggregates Phase-7 judge
scorecards per the S3 panel rule.

Subcommands:
    handoff   <file...>            validate handoff blocks
    gate      <file...>            validate critic-gate blocks
    scorecard <file...>            validate judge scorecard blocks
    memo      <file...>            validate decision_memo blocks
    aggregate <scorecard...> --target <tier>
                                   run the S3 judge-panel rule; print PASS/FAIL,
                                   min-seat total, weakest criterion, conflicts
    --self-test                    run embedded good/bad fixtures

Requires PyYAML.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - actionable, not a stack trace
    sys.stderr.write(
        "lint_run: PyYAML is required. Install with: python3 -m pip install pyyaml\n"
    )
    raise SystemExit(2)


# --------------------------------------------------------------------------
# tier model (S3)
# --------------------------------------------------------------------------
# Documented OPEN enum: known values are validated; unknown values are warned
# about (not rejected) so contest-specific tiers do not hard-fail the linter.
KNOWN_TIER_RANK = {
    "unranked": 0,
    "successful_participant": 0,
    "honorable": 1,
    "honorable_mention": 1,
    "national_third": 1,
    "meritorious": 2,
    "national_second": 2,
    "finalist": 3,
    "outstanding": 4,
    "national_first": 4,
}

# target tier -> S3 thresholds
THRESHOLDS = {
    "outstanding": {"total": 85, "floor": 70},
    "finalist": {"total": 80, "floor": 65},
    "meritorious": {"total": 75, "floor": 60},
}
TARGET_RANK = {"outstanding": 4, "finalist": 3, "meritorious": 2}

# accepted --target aliases -> canonical target key
TARGET_ALIASES = {
    "outstanding": "outstanding",
    "national_first": "outstanding",
    "guoyi": "outstanding",
    "o-prize": "outstanding",
    "o": "outstanding",
    "finalist": "finalist",
    "meritorious": "meritorious",
    "national_second": "meritorious",
    "guoer": "meritorious",
    "国一": "outstanding",   # 国一
    "国二": "meritorious",   # 国二
}

KNOWN_WRAPPERS = {"handoff", "gate", "scorecard", "decision_memo"}


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


# --------------------------------------------------------------------------
# yaml extraction (bare .yaml or fenced ```yaml``` inside .md)
# --------------------------------------------------------------------------
_FENCE_RE = re.compile(r"```(?:yaml|yml)\s*\n(.*?)\n```", re.DOTALL)


def load_yaml_docs(path):
    """Return a list of parsed YAML documents from a .yaml or .md file."""
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    docs = []
    if path.lower().endswith((".md", ".markdown")):
        blocks = _FENCE_RE.findall(text)
    else:
        blocks = [text]
    for block in blocks:
        try:
            for doc in yaml.safe_load_all(block):
                if doc is not None:
                    docs.append(doc)
        except yaml.YAMLError as exc:
            docs.append({"__parse_error__": str(exc)})
    return docs


def select_bodies(docs, key):
    """Pull the bodies of the requested block type out of the parsed docs."""
    parse_errors = [d["__parse_error__"] for d in docs
                    if isinstance(d, dict) and "__parse_error__" in d]
    wrapped = [d[key] for d in docs
               if isinstance(d, dict) and isinstance(d.get(key), dict)]
    if wrapped:
        return wrapped, parse_errors
    # fallback: unwrapped bodies (a bare .yaml with the fields but no wrapper),
    # excluding docs that clearly belong to another block type
    unwrapped = [d for d in docs
                 if isinstance(d, dict)
                 and "__parse_error__" not in d
                 and not (set(d.keys()) & KNOWN_WRAPPERS)]
    return unwrapped, parse_errors


# --------------------------------------------------------------------------
# per-type validators -> (errors, warnings)
# --------------------------------------------------------------------------
def _require_keys(body, keys, errors):
    for k in keys:
        if k not in body:
            errors.append(f"missing required key: {k}")


def _require_list(body, key, errors):
    if key in body and not isinstance(body[key], list):
        errors.append(f"key '{key}' must be a list")


def validate_handoff(body):
    errors, warnings = [], []
    if not isinstance(body, dict):
        return ["handoff block is not a mapping"], warnings
    _require_keys(body, [
        "phase", "agent", "loop", "status", "artifacts", "decisions",
        "assumptions", "evidence", "commands", "weaknesses", "questions",
        "critic_focus",
    ], errors)
    if "phase" in body and not _is_int(body["phase"]):
        errors.append("phase must be an integer")
    if "loop" in body and not _is_int(body["loop"]):
        errors.append("loop must be an integer")
    if "agent" in body and not (isinstance(body["agent"], str) and body["agent"].strip()):
        errors.append("agent must be a non-empty string")
    if "status" in body and body["status"] not in {"complete", "partial", "blocked"}:
        errors.append(f"status must be complete|partial|blocked (got {body['status']!r})")
    for k in ("decisions", "assumptions", "evidence", "commands",
              "weaknesses", "questions", "critic_focus", "artifacts"):
        _require_list(body, k, errors)
    for i, art in enumerate(body.get("artifacts", []) or []):
        if not isinstance(art, dict):
            errors.append(f"artifacts[{i}] must be a mapping with path/role")
            continue
        path = art.get("path")
        if not isinstance(path, str) or not path:
            errors.append(f"artifacts[{i}] missing 'path'")
        elif not path.startswith("work/"):
            errors.append(f"artifacts[{i}] path must start with 'work/' (got {path!r})")
        if "role" not in art:
            warnings.append(f"artifacts[{i}] has no 'role'")
    for i, asm in enumerate(body.get("assumptions", []) or []):
        if isinstance(asm, dict):
            for want in ("id", "text"):
                if want not in asm:
                    warnings.append(f"assumptions[{i}] has no '{want}'")
    return errors, warnings


def validate_gate(body):
    errors, warnings = [], []
    if not isinstance(body, dict):
        return ["gate block is not a mapping"], warnings
    _require_keys(body, ["phase", "loop", "verdict", "issues",
                         "evidence_checked", "missing_evidence"], errors)
    if "phase" in body and not _is_int(body["phase"]):
        errors.append("phase must be an integer")
    if "loop" in body and not _is_int(body["loop"]):
        errors.append("loop must be an integer")
    if "verdict" in body and body["verdict"] not in {"pass", "fail"}:
        errors.append(f"verdict must be pass|fail (got {body['verdict']!r})")
    for k in ("issues", "evidence_checked", "missing_evidence"):
        _require_list(body, k, errors)
    for i, iss in enumerate(body.get("issues", []) or []):
        if not isinstance(iss, dict):
            errors.append(f"issues[{i}] must be a mapping")
            continue
        sev = iss.get("severity")
        if sev not in {"blocker", "high", "medium", "low"}:
            errors.append(f"issues[{i}] severity must be blocker|high|medium|low (got {sev!r})")
        if not iss.get("summary"):
            errors.append(f"issues[{i}] missing 'summary'")
        for want in ("required_fix", "owner"):
            if want not in iss:
                warnings.append(f"issues[{i}] has no '{want}'")
    return errors, warnings


def validate_scorecard(body):
    errors, warnings = [], []
    if not isinstance(body, dict):
        return ["scorecard block is not a mapping"], warnings
    _require_keys(body, ["contest", "target_tier", "seat", "round", "criteria",
                         "weighted_total", "implied_tier", "fix_one_thing",
                         "ranked_gaps", "do_not_regress"], errors)
    if "seat" in body and body["seat"] not in {"A", "B", "C"}:
        errors.append(f"seat must be A|B|C (got {body['seat']!r})")
    if "round" in body and not _is_int(body["round"]):
        errors.append("round must be an integer")
    if "weighted_total" in body:
        wt = body["weighted_total"]
        if not _is_number(wt):
            errors.append("weighted_total must be a number")
        elif not (0 <= wt <= 100):
            errors.append(f"weighted_total must be within 0-100 (got {wt})")
    for k in ("ranked_gaps", "do_not_regress"):
        _require_list(body, k, errors)
    crit = body.get("criteria")
    if not isinstance(crit, list) or not crit:
        errors.append("criteria must be a non-empty list")
        crit = []
    wsum = 0.0
    computed = 0.0
    for i, c in enumerate(crit):
        if not isinstance(c, dict):
            errors.append(f"criteria[{i}] must be a mapping with name/weight/score")
            continue
        if not c.get("name"):
            errors.append(f"criteria[{i}] missing 'name'")
        w, s = c.get("weight"), c.get("score")
        if not _is_number(w):
            errors.append(f"criteria[{i}] weight must be a number")
        else:
            wsum += w
        if not _is_number(s):
            errors.append(f"criteria[{i}] score must be a number")
        elif not (0 <= s <= 100):
            errors.append(f"criteria[{i}] score must be within 0-100 (got {s})")
        if _is_number(w) and _is_number(s):
            computed += w * s
    if crit and abs(wsum - 1.0) > 0.01:
        errors.append(f"criteria weights must sum to 1.0 +/-0.01 (got {round(wsum, 4)})")
    it = body.get("implied_tier")
    if isinstance(it, str) and it not in KNOWN_TIER_RANK:
        warnings.append(f"implied_tier '{it}' is not a known tier (open enum, not rejected)")
    if _is_number(body.get("weighted_total")) and crit and abs(wsum - 1.0) <= 0.01:
        if abs(body["weighted_total"] - computed) > 1.5:
            warnings.append(
                f"weighted_total {body['weighted_total']} differs from weight*score sum "
                f"{round(computed, 1)} by >1.5"
            )
    return errors, warnings


def validate_memo(body):
    errors, warnings = [], []
    if not isinstance(body, dict):
        return ["decision_memo block is not a mapping"], warnings
    _require_keys(body, ["phase", "budget_spent", "unresolved", "options"], errors)
    if "phase" in body and not _is_int(body["phase"]):
        errors.append("phase must be an integer")
    bs = body.get("budget_spent")
    if bs is not None:
        if not isinstance(bs, dict):
            errors.append("budget_spent must be a mapping with loops/cap")
        else:
            for want in ("loops", "cap"):
                if want not in bs:
                    errors.append(f"budget_spent missing '{want}'")
    _require_list(body, "unresolved", errors)
    opts = body.get("options")
    if not isinstance(opts, list):
        errors.append("options must be a list")
        opts = []
    if opts and not (2 <= len(opts) <= 3):
        warnings.append(f"options should offer 2-3 choices (got {len(opts)})")
    recommended = 0
    for i, o in enumerate(opts):
        if not isinstance(o, dict):
            errors.append(f"options[{i}] must be a mapping")
            continue
        for want in ("option", "consequence"):
            if want not in o:
                errors.append(f"options[{i}] missing '{want}'")
        if "recommended" in o:
            if not isinstance(o["recommended"], bool):
                errors.append(f"options[{i}] 'recommended' must be a boolean")
            elif o["recommended"]:
                recommended += 1
    if opts and recommended == 0:
        warnings.append("no option is marked recommended: true")
    return errors, warnings


VALIDATORS = {
    "handoff": ("handoff", validate_handoff),
    "gate": ("gate", validate_gate),
    "scorecard": ("scorecard", validate_scorecard),
    "memo": ("decision_memo", validate_memo),
}


# --------------------------------------------------------------------------
# file-level driver for the validate subcommands
# --------------------------------------------------------------------------
def validate_files(kind, paths):
    """Return exit code (0 ok, 1 failure) and print per-file PASS/FAIL lines."""
    wrapper_key, validator = VALIDATORS[kind]
    rc = 0
    for path in paths:
        if not os.path.isfile(path):
            print(f"FAIL {path}: no such file")
            rc = 1
            continue
        docs = load_yaml_docs(path)
        bodies, parse_errors = select_bodies(docs, wrapper_key)
        for pe in parse_errors:
            print(f"FAIL {path}: YAML parse error: {pe}")
            rc = 1
        if not bodies:
            print(f"FAIL {path}: no '{kind}' block found")
            rc = 1
            continue
        for idx, body in enumerate(bodies):
            errors, warnings = validator(body)
            tag = f"{path} [{kind} #{idx + 1}]"
            for w in warnings:
                print(f"WARN {tag}: {w}")
            if errors:
                rc = 1
                print(f"FAIL {tag}:")
                for e in errors:
                    print(f"       - {e}")
            else:
                print(f"PASS {tag}")
    return rc


# --------------------------------------------------------------------------
# S3 aggregation
# --------------------------------------------------------------------------
def _tier_rank(tier):
    if isinstance(tier, str):
        return KNOWN_TIER_RANK.get(tier.strip().lower())
    return None


def aggregate(paths, target):
    """Implement the S3 judge-panel rule. Return (passed, report_lines)."""
    lines = []
    canon = TARGET_ALIASES.get(str(target).strip().lower())
    if canon is None:
        return False, [f"unknown --target tier: {target!r} "
                       f"(known: {', '.join(sorted(set(TARGET_ALIASES)))})"]
    thr = THRESHOLDS[canon]
    need_rank = TARGET_RANK[canon]
    lines.append(f"Target tier: {canon} (total >= {thr['total']}, floor {thr['floor']}, "
                 f"tier rank >= {need_rank})")

    seats = []  # (label, total, implied, rank, criteria list)
    for path in paths:
        if not os.path.isfile(path):
            return False, [f"aggregate: no such file: {path}"]
        docs = load_yaml_docs(path)
        bodies, parse_errors = select_bodies(docs, "scorecard")
        if parse_errors:
            return False, [f"aggregate: YAML parse error in {path}: {parse_errors[0]}"]
        for body in bodies:
            errors, _ = validate_scorecard(body)
            if errors:
                return False, [f"aggregate: invalid scorecard in {path}: {errors[0]}"]
            seats.append((
                body.get("seat", "?"),
                float(body["weighted_total"]),
                body.get("implied_tier"),
                _tier_rank(body.get("implied_tier")),
                body.get("criteria", []),
            ))

    if not seats:
        return False, ["aggregate: no scorecards found"]

    lines.append("")
    lines.append("Per-seat:")
    for label, total, implied, rank, _ in seats:
        rk = "unknown-tier" if rank is None else f"rank {rank}"
        lines.append(f"  Seat {label}: total {total:.1f}, implied '{implied}' ({rk})")

    min_total = min(s[1] for s in seats)
    min_seat = min(seats, key=lambda s: s[1])[0]
    lines.append("")
    lines.append(f"Min-seat total: {min_total:.1f} (Seat {min_seat})")

    # weakest criterion across all seats
    weakest = None  # (score, name, seat)
    per_name = {}   # name -> list of (score, seat)
    for label, _, _, _, crit in seats:
        for c in crit:
            if not (isinstance(c, dict) and _is_number(c.get("score"))):
                continue
            name = c.get("name", "?")
            score = float(c["score"])
            per_name.setdefault(name, []).append((score, label))
            if weakest is None or score < weakest[0]:
                weakest = (score, name, label)
    if weakest is not None:
        lines.append(f"Weakest criterion across seats: '{weakest[1]}' = {weakest[0]:.1f} "
                     f"(Seat {weakest[2]})")

    # conflicts: same criterion differs >20 between seats -> never averaged
    conflicts = []
    for name, entries in per_name.items():
        if len(entries) >= 2:
            hi = max(entries)
            lo = min(entries)
            if hi[0] - lo[0] > 20:
                conflicts.append((name, lo, hi))
    if conflicts:
        lines.append("")
        lines.append("Evidence conflicts (>20 apart, DO NOT average -- adjudicate):")
        for name, lo, hi in conflicts:
            lines.append(f"  '{name}': Seat {lo[1]}={lo[0]:.0f} vs Seat {hi[1]}={hi[0]:.0f} "
                         f"(spread {hi[0] - lo[0]:.0f})")

    # S3 conditions
    reasons = []
    # (a) every seat implied_tier >= target
    below_tier = [(s[0], s[2]) for s in seats if s[3] is None or s[3] < need_rank]
    cond_a = not below_tier
    if not cond_a:
        for label, implied in below_tier:
            reasons.append(f"Seat {label} implied tier '{implied}' is below target {canon}")
    # (b) min total >= threshold
    cond_b = min_total >= thr["total"]
    if not cond_b:
        reasons.append(f"min-seat total {min_total:.1f} < required {thr['total']}")
    # (c) no criterion below floor
    below_floor = []
    for label, _, _, _, crit in seats:
        for c in crit:
            if isinstance(c, dict) and _is_number(c.get("score")) and c["score"] < thr["floor"]:
                below_floor.append((label, c.get("name", "?"), float(c["score"])))
    cond_c = not below_floor
    if not cond_c:
        for label, name, score in below_floor:
            reasons.append(f"Seat {label} criterion '{name}'={score:.0f} < floor {thr['floor']}")
    # conflicts block a clean pass (cannot average over disagreement)
    if conflicts:
        reasons.append("unresolved evidence conflict(s) require human adjudication")

    passed = cond_a and cond_b and cond_c and not conflicts
    lines.append("")
    if passed:
        lines.append("RESULT: PASS -- panel places the work at or above target tier")
    else:
        lines.append("RESULT: FAIL")
        for r in reasons:
            lines.append(f"  - {r}")
    return passed, lines


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------
GOOD_HANDOFF = """
handoff:
  phase: 4
  agent: mathodology-coder
  loop: 0
  status: complete
  artifacts:
    - {path: work/run-1/outputs/figures/sens.pdf, role: sensitivity}
  decisions: []
  assumptions:
    - {id: A7, text: demand is stationary, evidence: assumed, sensitivity_plan: vary +/-20%}
  evidence: []
  commands: ["python3 run_all.py"]
  weaknesses: []
  questions: []
  critic_focus: []
"""

BAD_HANDOFF = """
handoff:
  phase: 4
  agent: mathodology-coder
  loop: 0
  status: complete
  artifacts:
    - {path: outputs/figures/sens.pdf, role: sensitivity}
  decisions: []
  assumptions: []
  evidence: []
  commands: []
  weaknesses: []
  questions: []
  critic_focus: []
"""

GOOD_GATE = """
gate:
  phase: 4
  loop: 0
  verdict: pass
  issues:
    - {severity: high, summary: missing CRN, artifact: work/run-1/x.py, required_fix: share tableau, owner: mathodology-coder}
  evidence_checked: []
  missing_evidence: []
"""

BAD_GATE = """
gate:
  phase: 4
  loop: 0
  issues:
    - {severity: critical, summary: broken}
  evidence_checked: []
  missing_evidence: []
"""

GOOD_SCORECARD = """
scorecard:
  contest: MCM
  target_tier: outstanding
  seat: A
  round: 1
  criteria:
    - {name: originality, weight: 0.4, score: 88}
    - {name: correctness, weight: 0.3, score: 90}
    - {name: writing, weight: 0.3, score: 86}
  weighted_total: 88.0
  implied_tier: outstanding
  fix_one_thing: sharpen the robustness argument
  ranked_gaps: []
  do_not_regress: []
"""

BAD_SCORECARD = """
scorecard:
  contest: MCM
  target_tier: outstanding
  seat: D
  round: 1
  criteria:
    - {name: originality, weight: 0.4, score: 130}
    - {name: correctness, weight: 0.4, score: 90}
  weighted_total: 88.0
  implied_tier: outstanding
  fix_one_thing: x
  ranked_gaps: []
  do_not_regress: []
"""

GOOD_MEMO = """
decision_memo:
  phase: 7
  budget_spent: {loops: 2, cap: 2}
  unresolved: []
  options:
    - {option: ship as-is, consequence: caps at meritorious, recommended: false}
    - {option: one more originality loop, consequence: costs a day, recommended: true}
"""

BAD_MEMO = """
decision_memo:
  phase: 7
  budget_spent: {loops: 2, cap: 2}
  unresolved: []
"""


def _panel(seat, total, tier, crits):
    body = ["scorecard:",
            "  contest: MCM",
            "  target_tier: outstanding",
            f"  seat: {seat}",
            "  round: 1",
            "  criteria:"]
    for name, w, s in crits:
        body.append(f"    - {{name: {name}, weight: {w}, score: {s}}}")
    body += [f"  weighted_total: {total}",
             f"  implied_tier: {tier}",
             "  fix_one_thing: x",
             "  ranked_gaps: []",
             "  do_not_regress: []"]
    return "\n".join(body) + "\n"


def _write(tmp, name, text):
    p = os.path.join(tmp, name)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)
    return p


def _wrap_md(text):
    return "# fixture\n\nSome prose.\n\n```yaml\n" + text.strip() + "\n```\n\ntrailing prose.\n"


def _self_test():
    import tempfile
    tmp = tempfile.mkdtemp(prefix="lint_run_selftest_")
    ok = True

    def check(label, expect_pass, path, kind):
        nonlocal ok
        rc = validate_files(kind, [path])
        good = (rc == 0)
        if good == expect_pass:
            print(f"PASS self-test[{label}] -> {'valid' if good else 'rejected'} as expected")
        else:
            ok = False
            print(f"FAIL self-test[{label}] -> rc={rc}, expected {'pass' if expect_pass else 'fail'}")

    # good fixtures as .yaml, bad fixtures as .md (exercise both extraction paths)
    check("handoff-good", True, _write(tmp, "h_good.yaml", GOOD_HANDOFF), "handoff")
    check("handoff-bad(artifact-outside-work)", False,
          _write(tmp, "h_bad.md", _wrap_md(BAD_HANDOFF)), "handoff")
    check("gate-good", True, _write(tmp, "g_good.md", _wrap_md(GOOD_GATE)), "gate")
    check("gate-bad(missing-verdict+bad-severity)", False,
          _write(tmp, "g_bad.yaml", BAD_GATE), "gate")
    check("scorecard-good", True, _write(tmp, "s_good.yaml", GOOD_SCORECARD), "scorecard")
    check("scorecard-bad(seatD+weights0.8+score130)", False,
          _write(tmp, "s_bad.md", _wrap_md(BAD_SCORECARD)), "scorecard")
    check("memo-good", True, _write(tmp, "m_good.yaml", GOOD_MEMO), "memo")
    check("memo-bad(missing-options)", False,
          _write(tmp, "m_bad.yaml", BAD_MEMO), "memo")

    print("--- aggregate: passing panel (expect PASS) ---")
    pass_paths = [
        _write(tmp, "pA.yaml", _panel("A", 88, "outstanding",
               [("originality", 0.4, 88), ("correctness", 0.3, 90), ("writing", 0.3, 86)])),
        _write(tmp, "pB.yaml", _panel("B", 86, "outstanding",
               [("originality", 0.4, 84), ("correctness", 0.3, 88), ("writing", 0.3, 87)])),
        _write(tmp, "pC.yaml", _panel("C", 90, "outstanding",
               [("originality", 0.4, 90), ("correctness", 0.3, 92), ("writing", 0.3, 88)])),
    ]
    passed, rep = aggregate(pass_paths, "outstanding")
    print("\n".join(rep))
    if passed:
        print("PASS self-test[aggregate-pass]")
    else:
        ok = False
        print("FAIL self-test[aggregate-pass] should have PASSED")

    print("--- aggregate: failing-by-floor panel (expect FAIL) ---")
    # All seats clear the 85 total and the outstanding tier, and the low
    # criterion (68) is only 18 below its peers so there is no >20 conflict:
    # the sole failure is criterion 68 < floor 70.
    floor_paths = [
        _write(tmp, "fA.yaml", _panel("A", 87.3, "outstanding",
               [("originality", 0.34, 86), ("correctness", 0.33, 88), ("robustness", 0.33, 88)])),
        _write(tmp, "fB.yaml", _panel("B", 87.3, "outstanding",
               [("originality", 0.34, 86), ("correctness", 0.33, 88), ("robustness", 0.33, 88)])),
        _write(tmp, "fC.yaml", _panel("C", 89.1, "outstanding",
               [("originality", 0.34, 68), ("correctness", 0.33, 100), ("robustness", 0.33, 100)])),
    ]
    passed, rep = aggregate(floor_paths, "outstanding")
    print("\n".join(rep))
    if not passed:
        print("PASS self-test[aggregate-floor]")
    else:
        ok = False
        print("FAIL self-test[aggregate-floor] should have FAILED")

    print("--- aggregate: conflict panel (expect FAIL, do-not-average) ---")
    conflict_paths = [
        _write(tmp, "cA.yaml", _panel("A", 78, "meritorious",
               [("innovation", 0.5, 85), ("correctness", 0.5, 71)])),
        _write(tmp, "cB.yaml", _panel("B", 78, "meritorious",
               [("innovation", 0.5, 84), ("correctness", 0.5, 72)])),
        _write(tmp, "cC.yaml", _panel("C", 76, "meritorious",
               [("innovation", 0.5, 60), ("correctness", 0.5, 92)])),  # innovation spread 25
    ]
    passed, rep = aggregate(conflict_paths, "meritorious")
    print("\n".join(rep))
    if not passed and any("conflict" in line.lower() for line in rep):
        print("PASS self-test[aggregate-conflict]")
    else:
        ok = False
        print("FAIL self-test[aggregate-conflict] should have FAILED on a conflict")

    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    print("lint_run self-test:", "OK" if ok else "FAILED")
    return 0 if ok else 1


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--self-test" in argv:
        return _self_test()

    parser = argparse.ArgumentParser(description="Validate Mathodology run blocks.")
    sub = parser.add_subparsers(dest="cmd")
    for name in ("handoff", "gate", "scorecard", "memo"):
        p = sub.add_parser(name, help=f"validate {name} block(s)")
        p.add_argument("files", nargs="+")
    agg = sub.add_parser("aggregate", help="run the S3 judge-panel rule")
    agg.add_argument("files", nargs="+")
    agg.add_argument("--target", required=True, help="target tier (e.g. outstanding)")

    args = parser.parse_args(argv)
    if args.cmd in VALIDATORS:
        return validate_files(args.cmd, args.files)
    if args.cmd == "aggregate":
        passed, report = aggregate(args.files, args.target)
        print("\n".join(report))
        return 0 if passed else 1
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
