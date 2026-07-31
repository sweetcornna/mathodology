#!/usr/bin/env python3
"""lint_run.py -- validate Mathodology award-run structured blocks + judge aggregation.

Validates the four canonical run blocks (handoff / gate / scorecard /
decision_memo) whether they arrive as a bare ``.yaml`` file or as fenced
```yaml``` blocks inside a ``.md`` file, and aggregates Phase-7 judge
scorecards per the judge-panel rule.

Subcommands:
    handoff   <file...> [--agent <name>]
                                   validate handoff blocks; --agent also
                                   requires that role's extra keys (e.g.
                                   mathodology-coder -> collision_gate_result)
    gate      <file...>            validate critic-gate blocks
    scorecard <file...>            validate judge scorecard blocks
    memo      <file...>            validate decision_memo blocks
    aggregate <scorecard...> --target <tier>
                                   run the judge-panel rule; print PASS/FAIL,
                                   min-seat total, weakest criterion, conflicts
    --self-test                    run embedded good/bad fixtures
                                   (honoured only as the first argument)

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
# tier model
# --------------------------------------------------------------------------
# Documented OPEN enum: known values are validated; unknown values are warned
# about (not rejected) so contest-specific tiers do not hard-fail the linter.
KNOWN_TIER_RANK = {
    "unranked": 0,
    "successful_participant": 0,
    "honorable": 1,
    "honorable_mention": 1,
    "national_third": 1,
    "国三": 1,
    "meritorious": 2,
    "national_second": 2,
    "国二": 2,
    "guoer": 2,
    "finalist": 3,
    "国一边缘": 3,
    "outstanding": 4,
    "national_first": 4,
    "国一": 4,
    "guoyi": 4,
}

# target tier -> thresholds
THRESHOLDS = {
    "outstanding": {"total": 85, "floor": 70},
    "finalist": {"total": 80, "floor": 65},
    "meritorious": {"total": 75, "floor": 60},
}
TARGET_RANK = {"outstanding": 4, "finalist": 3, "meritorious": 2}

# accepted --target aliases -> canonical target key. Contest-local labels
# (一等奖 for a variant contest's top tier, 国一边缘 for the documented
# finalist-equivalent) resolve to their threshold row so a lead can pass the
# label the variant docs use.
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
    "一等奖": "outstanding",  # variant-contest top tier (e.g. MathorCup 一等奖)
    "二等奖": "meritorious",  # variant-contest second tier
    "国一边缘": "finalist",   # documented finalist-equivalent label
}

# Every spelling accepted anywhere (KNOWN_TIER_RANK plus every --target alias)
# must rank: a judge who writes ``implied_tier: o`` mirrors an accepted target
# spelling and must not sink the panel as an unknown tier.
TIER_RANK_UNION = dict(KNOWN_TIER_RANK)
for _alias, _canon in TARGET_ALIASES.items():
    TIER_RANK_UNION.setdefault(_alias, TARGET_RANK[_canon])

# weighted_total band -> tier rank (documented mapping: >=85 outstanding,
# 80-84.9 finalist, 75-79.9 meritorious, <75 below award tiers). Used only to
# WARN when a scorecard's holistic implied_tier departs from its own total
# without a tier_justification.
def _band_rank_for_total(total):
    if total >= 85:
        return 4
    if total >= 80:
        return 3
    if total >= 75:
        return 2
    return 1


# role-specific handoff keys enforced by ``handoff --agent <name>``; the prose
# contract lives in the corresponding .claude/agents/<name>.md brief.
AGENT_EXTRA_KEYS = {
    "mathodology-problem-analyst": ["scope_ledger"],
    "mathodology-modeler": ["innovation_ledger"],
    "mathodology-evidence-researcher": [
        "search_backend", "queries_run", "missing_evidence", "citations_to_verify",
    ],
    "mathodology-coder": ["collision_gate_result"],
    "mathodology-paper-editor": ["ledger_closeout"],
}

# Every specialist name ``--agent`` accepts. A typo'd --agent must fail loudly:
# AGENT_EXTRA_KEYS.get(<typo>, []) would otherwise enforce nothing while
# reporting PASS, silently disabling the role-key gate.
KNOWN_AGENTS = set(AGENT_EXTRA_KEYS) | {
    "mathodology-lead",
    "mathodology-critic",
    "mathodology-award-judge",
    "mathodology-submission-packager",
}

KNOWN_WRAPPERS = {"handoff", "gate", "scorecard", "decision_memo"}


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _path_in_work(path):
    """True only if ``path`` stays inside the work/ sandbox once normalized.

    A raw ``startswith('work/')`` test is bypassable with ``work/../secret``;
    normalize first and reject absolute paths and any '..' escape.
    """
    if not isinstance(path, str) or not path:
        return False
    if os.path.isabs(path):
        return False
    norm = os.path.normpath(path)
    if norm == "work" or norm.startswith("work" + os.sep):
        return True
    return False


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


def validate_handoff(body, agent=None):
    errors, warnings = [], []
    if not isinstance(body, dict):
        return ["handoff block is not a mapping"], warnings
    _require_keys(body, [
        "phase", "agent", "loop", "status", "artifacts", "decisions",
        "assumptions", "evidence", "commands", "weaknesses", "questions",
        "critic_focus",
    ], errors)
    # --agent <name>: also require that role's extra keys (the shared schema
    # cannot see them, so e.g. a coder handoff without collision_gate_result
    # would otherwise lint clean and the figure-gate evidence would be lost).
    if agent:
        for k in AGENT_EXTRA_KEYS.get(agent, []):
            if k not in body:
                errors.append(f"missing role-specific key for {agent}: {k}")
        declared = body.get("agent")
        if isinstance(declared, str) and declared.strip() and declared.strip() != agent:
            errors.append(f"handoff agent {declared!r} does not match --agent {agent!r}")
        if agent == "mathodology-evidence-researcher":
            backend = body.get("search_backend")
            queries = body.get("queries_run")
            missing = body.get("missing_evidence")
            citations = body.get("citations_to_verify")
            if backend not in {"combined", "search-mcp", "builtin", "none"}:
                errors.append(
                    "search_backend must be combined|search-mcp|builtin|none "
                    f"(got {backend!r})"
                )
            _require_list(body, "queries_run", errors)
            _require_list(body, "missing_evidence", errors)
            _require_list(body, "citations_to_verify", errors)
            query_backends = set()
            if isinstance(queries, list):
                for i, query in enumerate(queries):
                    if not isinstance(query, dict):
                        errors.append(f"queries_run[{i}] must be a mapping")
                        continue
                    query_text = query.get("query")
                    if not isinstance(query_text, str) or not query_text.strip():
                        errors.append(f"queries_run[{i}] query must be a non-empty string")
                    for key in ("accepted", "rejected"):
                        if not isinstance(query.get(key), list):
                            errors.append(f"queries_run[{i}] {key} must be a list")
                    query_backend = query.get("backend")
                    if query_backend not in {"search-mcp", "builtin"}:
                        errors.append(
                            f"queries_run[{i}] backend must be search-mcp|builtin "
                            f"(got {query_backend!r})"
                        )
                    else:
                        query_backends.add(query_backend)
            if isinstance(citations, list):
                for i, citation in enumerate(citations):
                    if not isinstance(citation, dict):
                        errors.append(f"citations_to_verify[{i}] must be a mapping")
                        continue
                    for key in ("id", "claim", "source", "url"):
                        value = citation.get(key)
                        if not isinstance(value, str) or not value.strip():
                            errors.append(
                                f"citations_to_verify[{i}] {key} must be a non-empty string"
                            )
                    if not isinstance(citation.get("verified"), bool):
                        errors.append(
                            f"citations_to_verify[{i}] verified must be a boolean"
                        )
            if backend == "combined" and query_backends != {"search-mcp", "builtin"}:
                errors.append("combined search_backend requires queries from both backends")
            if backend in {"search-mcp", "builtin"}:
                if query_backends != {backend}:
                    errors.append(
                        f"{backend} search_backend requires only {backend} queries"
                    )
                if not isinstance(missing, list) or not any(
                    isinstance(reason, str) and reason.strip() for reason in missing
                ):
                    errors.append(
                        f"{backend} search_backend requires a non-empty "
                        "missing_evidence degradation reason"
                    )
            if backend == "none":
                if body.get("status") != "blocked":
                    errors.append("none search_backend requires status: blocked")
                if isinstance(queries, list) and queries:
                    errors.append("none search_backend requires queries_run to be empty")
                if not isinstance(missing, list) or not any(
                    isinstance(reason, str) and reason.strip() for reason in missing
                ):
                    errors.append(
                        "none search_backend requires a non-empty missing_evidence reason"
                    )
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
        elif not _path_in_work(path):
            errors.append(
                f"artifacts[{i}] path must stay inside the work/ sandbox "
                f"(got {path!r}; absolute paths and '..' escapes are rejected)"
            )
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
        if not iss.get("id"):
            warnings.append(
                f"issues[{i}] has no stable 'id' (G<phase>-<n>); without one the "
                "lead cannot match findings across loops to detect non-improvement"
            )
        for want in ("required_fix", "owner"):
            if want not in iss:
                warnings.append(f"issues[{i}] has no '{want}'")
    return errors, warnings


def validate_scorecard(body):
    errors, warnings = [], []
    if not isinstance(body, dict):
        return ["scorecard block is not a mapping"], warnings
    # target_tier is deliberately NOT required: judge seats are blind to the
    # target (the lead supplies --target only at aggregation). It is still
    # accepted when present for backward compatibility.
    _require_keys(body, ["contest", "seat", "round", "criteria",
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
        elif not (0 <= w <= 1):
            errors.append(f"criteria[{i}] weight must be within 0-1 (got {w})")
        else:
            wsum += w
        if not _is_number(s):
            errors.append(f"criteria[{i}] score must be a number")
        elif not (0 <= s <= 100):
            errors.append(f"criteria[{i}] score must be within 0-100 (got {s})")
        if _is_number(w) and _is_number(s):
            computed += w * s
    # 0.015 tolerance: a natural equal three-way split (0.33 * 3 = 0.99) must
    # pass; a genuinely wrong sum (0.8, 1.1) still fails.
    if crit and abs(wsum - 1.0) > 0.015:
        errors.append(f"criteria weights must sum to 1.0 +/-0.015 (got {round(wsum, 4)})")
    it = body.get("implied_tier")
    if isinstance(it, str) and it.strip().lower() not in TIER_RANK_UNION:
        warnings.append(f"implied_tier '{it}' is not a known tier (open enum, not rejected)")
    if _is_number(body.get("weighted_total")) and crit and abs(wsum - 1.0) <= 0.015:
        if abs(body["weighted_total"] - computed) > 1.5:
            warnings.append(
                f"weighted_total {body['weighted_total']} differs from weight*score sum "
                f"{round(computed, 1)} by >1.5"
            )
    # holistic-override guard: implied_tier may depart from the band its own
    # weighted_total implies (>=85 outstanding, 80-84.9 finalist, 75-79.9
    # meritorious, <75 below) only with an explicit tier_justification.
    it_rank = None
    if isinstance(it, str):
        it_rank = TIER_RANK_UNION.get(it.strip().lower())
    if (it_rank is not None and _is_number(body.get("weighted_total"))
            and it_rank != _band_rank_for_total(float(body["weighted_total"]))
            and not body.get("tier_justification")):
        warnings.append(
            f"implied_tier '{it}' departs from the band implied by "
            f"weighted_total {body['weighted_total']} without a tier_justification"
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
def validate_files(kind, paths, agent=None):
    """Return exit code (0 ok, 1 failure) and print per-file PASS/FAIL lines."""
    wrapper_key, validator = VALIDATORS[kind]
    if kind == "handoff" and agent:
        base = validator
        validator = lambda body: base(body, agent=agent)  # noqa: E731
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
# judge-panel aggregation
# --------------------------------------------------------------------------
def _tier_rank(tier):
    if isinstance(tier, str):
        return TIER_RANK_UNION.get(tier.strip().lower())
    return None


def aggregate(paths, target):
    """Implement the judge-panel rule. Return (passed, report_lines)."""
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

    # panel completeness: this is a three-seat blind panel; a lone judge or a
    # duplicated seat is not a panel and must not be able to PASS the gate.
    seat_labels = [s[0] for s in seats]
    seat_set = set(seat_labels)
    if seat_set != {"A", "B", "C"} or len(seat_labels) != 3:
        return False, lines + [
            "",
            f"aggregate: incomplete or duplicate panel: seats present = "
            f"{sorted(seat_labels)} (need exactly one each of A, B, C)",
            "RESULT: FAIL",
        ]

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

    # panel pass/fail conditions
    reasons = []
    # (a) every seat implied_tier >= target. An unrankable tier is its own
    # failure ("cannot be ranked"), not mislabelled as "below target".
    below_tier = [(s[0], s[2]) for s in seats if s[3] is not None and s[3] < need_rank]
    unranked = [(s[0], s[2]) for s in seats if s[3] is None]
    cond_a = not below_tier and not unranked
    if not cond_a:
        for label, implied in below_tier:
            reasons.append(f"Seat {label} implied tier '{implied}' is below target {canon}")
        for label, implied in unranked:
            reasons.append(
                f"Seat {label} implied_tier '{implied}' cannot be ranked (unknown tier; "
                f"use outstanding|finalist|meritorious or a documented alias)"
            )
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

ESCAPE_HANDOFF = """
handoff:
  phase: 4
  agent: mathodology-coder
  loop: 0
  status: complete
  artifacts:
    - {path: work/../secrets.env, role: leak}
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

NEG_WEIGHT_SCORECARD = """
scorecard:
  contest: MCM
  target_tier: outstanding
  seat: A
  round: 1
  criteria:
    - {name: originality, weight: -0.5, score: 90}
    - {name: correctness, weight: 1.5, score: 80}
  weighted_total: 75.0
  implied_tier: meritorious
  fix_one_thing: x
  ranked_gaps: []
  do_not_regress: []
"""

# No target_tier (judges are blind to the target) and an equal three-way
# split: 0.33 * 3 = 0.99 must clear the 0.015 weight tolerance.
BLIND_EQUAL_WEIGHTS_SCORECARD = """
scorecard:
  contest: MCM
  seat: B
  round: 1
  criteria:
    - {name: summary, weight: 0.33, score: 86}
    - {name: modeling, weight: 0.33, score: 88}
    - {name: results, weight: 0.34, score: 87}
  weighted_total: 87.0
  implied_tier: outstanding
  fix_one_thing: x
  ranked_gaps: []
  do_not_regress: []
"""

CODER_HANDOFF_WITH_GATE_KEY = """
handoff:
  phase: 4
  agent: mathodology-coder
  loop: 0
  status: complete
  artifacts:
    - {path: work/run-1/outputs/figures/sens.pdf, role: sensitivity}
  decisions: []
  assumptions: []
  evidence: []
  commands: ["python3 run_all.py"]
  weaknesses: []
  questions: []
  critic_focus: []
  collision_gate_result: {status: pass, command: python3 run_all.py}
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
    check("handoff-bad(work/..-escape)", False,
          _write(tmp, "h_escape.yaml", ESCAPE_HANDOFF), "handoff")
    check("gate-good", True, _write(tmp, "g_good.md", _wrap_md(GOOD_GATE)), "gate")
    check("gate-bad(missing-verdict+bad-severity)", False,
          _write(tmp, "g_bad.yaml", BAD_GATE), "gate")
    check("scorecard-good", True, _write(tmp, "s_good.yaml", GOOD_SCORECARD), "scorecard")
    check("scorecard-bad(seatD+weights0.8+score130)", False,
          _write(tmp, "s_bad.md", _wrap_md(BAD_SCORECARD)), "scorecard")
    check("scorecard-bad(negative-weight)", False,
          _write(tmp, "s_neg.yaml", NEG_WEIGHT_SCORECARD), "scorecard")
    check("memo-good", True, _write(tmp, "m_good.yaml", GOOD_MEMO), "memo")
    check("memo-bad(missing-options)", False,
          _write(tmp, "m_bad.yaml", BAD_MEMO), "memo")
    check("scorecard-blind-equal-weights(no-target_tier, 0.33x3)", True,
          _write(tmp, "s_blind.yaml", BLIND_EQUAL_WEIGHTS_SCORECARD), "scorecard")

    # --agent role-key enforcement: the same coder handoff passes plain lint,
    # fails under --agent without collision_gate_result, passes with it.
    coder_plain = _write(tmp, "h_coder_plain.yaml", GOOD_HANDOFF)
    coder_keyed = _write(tmp, "h_coder_keyed.yaml", CODER_HANDOFF_WITH_GATE_KEY)
    if validate_files("handoff", [coder_plain], agent="mathodology-coder") != 0:
        print("PASS self-test[handoff--agent-missing-key] -> rejected as expected")
    else:
        ok = False
        print("FAIL self-test[handoff--agent-missing-key] should have FAILED "
              "(no collision_gate_result)")
    if validate_files("handoff", [coder_keyed], agent="mathodology-coder") == 0:
        print("PASS self-test[handoff--agent-with-key] -> valid as expected")
    else:
        ok = False
        print("FAIL self-test[handoff--agent-with-key] should have PASSED")
    # Evidence-researcher role contract: combined and every explicit degradation
    # mode have distinct, mechanically enforced provenance requirements.
    def evidence_handoff(backend, query_backends, missing, status="complete"):
        body = dict(yaml.safe_load(GOOD_HANDOFF)["handoff"])
        body.update({
            "agent": "mathodology-evidence-researcher",
            "status": status,
            "search_backend": backend,
            "queries_run": [
                {
                    "query": f"query-{i}", "backend": query_backend,
                    "accepted": [], "rejected": [],
                }
                for i, query_backend in enumerate(query_backends)
            ],
            "missing_evidence": missing,
            "citations_to_verify": [],
        })
        return body

    evidence_cases = [
        ("combined-valid", evidence_handoff(
            "combined", ["search-mcp", "builtin"], []), True),
        ("search-mcp-valid", evidence_handoff(
            "search-mcp", ["search-mcp"], ["builtin unavailable"]), True),
        ("builtin-valid", evidence_handoff(
            "builtin", ["builtin"], ["search MCP unavailable"]), True),
        ("none-valid", evidence_handoff(
            "none", [], ["both discovery channels unavailable"], "blocked"), True),
        ("combined-missing-backend", evidence_handoff(
            "combined", ["search-mcp"], []), False),
        ("combined-empty-query", {
            **evidence_handoff("combined", ["search-mcp", "builtin"], []),
            "queries_run": [
                {"backend": "search-mcp", "accepted": [], "rejected": []},
                {"query": "web query", "backend": "builtin",
                 "accepted": [], "rejected": []},
            ],
        }, False),
        ("single-source-missing-reason", evidence_handoff(
            "builtin", ["builtin"], []), False),
        ("single-source-blank-reason", evidence_handoff(
            "builtin", ["builtin"], [""]), False),
        ("single-source-wrong-query", evidence_handoff(
            "search-mcp", ["builtin"], ["builtin should be unavailable"]), False),
        ("none-not-blocked", evidence_handoff(
            "none", [], ["both unavailable"]), False),
        ("citation-valid", {
            **evidence_handoff("combined", ["search-mcp", "builtin"], []),
            "citations_to_verify": [{
                "id": "C1", "claim": "claim", "source": "publisher",
                "url": "https://example.com/paper", "verified": False,
            }],
        }, True),
        ("citation-not-mapping", {
            **evidence_handoff("combined", ["search-mcp", "builtin"], []),
            "citations_to_verify": ["C1"],
        }, False),
        ("citation-missing-url", {
            **evidence_handoff("combined", ["search-mcp", "builtin"], []),
            "citations_to_verify": [{
                "id": "C1", "claim": "claim", "source": "publisher",
                "verified": False,
            }],
        }, False),
        ("citation-string-boolean", {
            **evidence_handoff("combined", ["search-mcp", "builtin"], []),
            "citations_to_verify": [{
                "id": "C1", "claim": "claim", "source": "publisher",
                "url": "https://example.com/paper", "verified": "false",
            }],
        }, False),
    ]
    for label, body, expect_pass in evidence_cases:
        evidence_errors, _ = validate_handoff(
            body, agent="mathodology-evidence-researcher"
        )
        got_pass = not evidence_errors
        if got_pass == expect_pass:
            print(f"PASS self-test[evidence-{label}]")
        else:
            ok = False
            print(
                f"FAIL self-test[evidence-{label}] errors={evidence_errors}, "
                f"expected {'pass' if expect_pass else 'fail'}"
            )

    # a typo'd --agent must be rejected at the CLI, not silently enforce nothing
    if main(["handoff", "--agent", "mathodology-codr", coder_plain]) != 0:
        print("PASS self-test[handoff--agent-typo] -> unknown agent rejected")
    else:
        ok = False
        print("FAIL self-test[handoff--agent-typo] typo'd --agent silently accepted")

    # gate issues without a stable id must WARN (not fail)
    g_errors, g_warnings = validate_gate(yaml.safe_load(GOOD_GATE)["gate"])
    if not g_errors and any("'id'" in w or "stable" in w for w in g_warnings):
        print("PASS self-test[gate-issue-id-warn] -> warned, not rejected")
    else:
        ok = False
        print(f"FAIL self-test[gate-issue-id-warn] errors={g_errors} warnings={g_warnings}")

    # band-mismatch without tier_justification must WARN; with it, no warn
    mism = yaml.safe_load(GOOD_SCORECARD)["scorecard"]
    mism["implied_tier"] = "meritorious"  # holistic override below the 88-total band
    s_errors, s_warnings = validate_scorecard(mism)
    if not s_errors and any("tier_justification" in w for w in s_warnings):
        print("PASS self-test[scorecard-band-mismatch-warn]")
    else:
        ok = False
        print(f"FAIL self-test[scorecard-band-mismatch-warn] errors={s_errors} "
              f"warnings={s_warnings}")
    mism["tier_justification"] = "correctness flaw caps the tier despite the total"
    s_errors, s_warnings = validate_scorecard(mism)
    if not s_errors and not any("tier_justification" in w for w in s_warnings):
        print("PASS self-test[scorecard-band-mismatch-justified]")
    else:
        ok = False
        print(f"FAIL self-test[scorecard-band-mismatch-justified] errors={s_errors} "
              f"warnings={s_warnings}")

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

    print("--- aggregate: Chinese-tier passing panel (expect PASS) ---")
    # implied_tier written as 国一 must rank as outstanding, not 'unknown-tier'.
    cn_paths = [
        _write(tmp, "cnA.yaml", _panel("A", 88, "国一",
               [("originality", 0.4, 88), ("correctness", 0.3, 90), ("writing", 0.3, 86)])),
        _write(tmp, "cnB.yaml", _panel("B", 86, "国一",
               [("originality", 0.4, 84), ("correctness", 0.3, 88), ("writing", 0.3, 87)])),
        _write(tmp, "cnC.yaml", _panel("C", 90, "国一",
               [("originality", 0.4, 90), ("correctness", 0.3, 92), ("writing", 0.3, 88)])),
    ]
    passed, rep = aggregate(cn_paths, "国一")
    print("\n".join(rep))
    if passed:
        print("PASS self-test[aggregate-cn-tier]")
    else:
        ok = False
        print("FAIL self-test[aggregate-cn-tier] should have PASSED with 国一 labels")

    print("--- aggregate: alias tiers ('o' seats, target 国一边缘) ---")
    # 'o' mirrors an accepted --target spelling and must rank as outstanding;
    # 国一边缘 must resolve to the finalist threshold row (80/65).
    alias_paths = [
        _write(tmp, "alA.yaml", _panel("A", 82, "o",
               [("summary", 0.4, 82), ("modeling", 0.3, 83), ("results", 0.3, 81)])),
        _write(tmp, "alB.yaml", _panel("B", 83, "o",
               [("summary", 0.4, 83), ("modeling", 0.3, 84), ("results", 0.3, 82)])),
        _write(tmp, "alC.yaml", _panel("C", 81, "o",
               [("summary", 0.4, 81), ("modeling", 0.3, 82), ("results", 0.3, 80)])),
    ]
    passed, rep = aggregate(alias_paths, "国一边缘")
    print("\n".join(rep))
    if passed:
        print("PASS self-test[aggregate-alias-tiers]")
    else:
        ok = False
        print("FAIL self-test[aggregate-alias-tiers] 'o' seats vs 国一边缘 should PASS")

    print("--- aggregate: unrankable implied_tier (expect FAIL, clear reason) ---")
    unk_paths = [
        _write(tmp, "ukA.yaml", _panel("A", 88, "outstanding_winner",
               [("summary", 0.4, 88), ("modeling", 0.3, 90), ("results", 0.3, 86)])),
        _write(tmp, "ukB.yaml", _panel("B", 86, "outstanding",
               [("summary", 0.4, 84), ("modeling", 0.3, 88), ("results", 0.3, 87)])),
        _write(tmp, "ukC.yaml", _panel("C", 90, "outstanding",
               [("summary", 0.4, 90), ("modeling", 0.3, 92), ("results", 0.3, 88)])),
    ]
    passed, rep = aggregate(unk_paths, "outstanding")
    print("\n".join(rep))
    if not passed and any("cannot be ranked" in line for line in rep):
        print("PASS self-test[aggregate-unrankable-tier]")
    else:
        ok = False
        print("FAIL self-test[aggregate-unrankable-tier] should FAIL with 'cannot be ranked'")

    print("--- aggregate: incomplete panel (single seat, expect FAIL) ---")
    passed, rep = aggregate([pass_paths[0]], "outstanding")
    print("\n".join(rep))
    if not passed and any("incomplete or duplicate panel" in line for line in rep):
        print("PASS self-test[aggregate-incomplete]")
    else:
        ok = False
        print("FAIL self-test[aggregate-incomplete] should have FAILED on a lone seat")

    print("--- aggregate: duplicate-seat panel (A,A,B expect FAIL) ---")
    dup_paths = [
        _write(tmp, "dA1.yaml", _panel("A", 88, "outstanding",
               [("originality", 0.4, 88), ("correctness", 0.3, 90), ("writing", 0.3, 86)])),
        _write(tmp, "dA2.yaml", _panel("A", 88, "outstanding",
               [("originality", 0.4, 88), ("correctness", 0.3, 90), ("writing", 0.3, 86)])),
        _write(tmp, "dB.yaml", _panel("B", 86, "outstanding",
               [("originality", 0.4, 84), ("correctness", 0.3, 88), ("writing", 0.3, 87)])),
    ]
    passed, rep = aggregate(dup_paths, "outstanding")
    print("\n".join(rep))
    if not passed and any("incomplete or duplicate panel" in line for line in rep):
        print("PASS self-test[aggregate-duplicate]")
    else:
        ok = False
        print("FAIL self-test[aggregate-duplicate] should have FAILED on duplicate seats")

    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    print("lint_run self-test:", "OK" if ok else "FAILED")
    return 0 if ok else 1


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # Only honoured as the first argument: `lint_run.py scorecard --self-test
    # file.yaml` must validate the file, not silently run the self-test.
    if argv and argv[0] == "--self-test":
        return _self_test()

    parser = argparse.ArgumentParser(description="Validate Mathodology run blocks.")
    sub = parser.add_subparsers(dest="cmd")
    for name in ("handoff", "gate", "scorecard", "memo"):
        p = sub.add_parser(name, help=f"validate {name} block(s)")
        p.add_argument("files", nargs="+")
        if name == "handoff":
            p.add_argument(
                "--agent",
                help="also require this agent's role-specific handoff keys "
                     "(e.g. mathodology-coder -> collision_gate_result)",
            )
    agg = sub.add_parser("aggregate", help="run the judge-panel rule")
    agg.add_argument("files", nargs="+")
    agg.add_argument("--target", required=True, help="target tier (e.g. outstanding)")

    args = parser.parse_args(argv)
    agent = getattr(args, "agent", None)
    if agent and agent not in KNOWN_AGENTS:
        print(
            f"FAIL --agent: unknown agent {agent!r} "
            f"(known: {', '.join(sorted(KNOWN_AGENTS))})"
        )
        return 1
    if args.cmd in VALIDATORS:
        return validate_files(args.cmd, args.files, agent=agent)
    if args.cmd == "aggregate":
        passed, report = aggregate(args.files, args.target)
        print("\n".join(report))
        return 0 if passed else 1
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
