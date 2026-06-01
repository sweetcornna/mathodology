"""Tests for sensitivity evidence mining + anonymity scanning."""

from __future__ import annotations

from agent_worker.agents.evidence import (
    anonymity_criteria,
    mine_sensitivity_evidence,
    scan_anonymity_violations,
    sensitivity_criteria,
)
from mm_contracts import PaperDraft, PaperSection


def _draft(sections: list[tuple[str, str]], abstract: str = "abs", title: str = "T") -> PaperDraft:
    return PaperDraft(
        title=title,
        abstract=abstract,
        sections=[PaperSection(title=t, body_markdown=b) for t, b in sections],
        references=["[1] Smith 2020"],
        figure_refs=[],
    )


# --- sensitivity ----------------------------------------------------------


def test_sensitivity_passes_bar_when_three_params_perturbed() -> None:
    body = (
        "Sensitivity Analysis. We perturbed α by ±10% and observed a 4.3% change in objective.\n"
        "We perturbed β by ±20% (objective shifted 7.1%). For γ at ±10%, the result was 1.2%.\n"
        "See [[FIG:tornado_sensitivity]] for the tornado plot and Monte Carlo N=2000."
    )
    p = _draft([("Sensitivity Analysis", body)])
    findings = mine_sensitivity_evidence(p)
    assert findings.has_sensitivity_section
    assert findings.parameter_count_estimate >= 3
    assert findings.perturb_mention_count >= 3
    assert findings.tornado_or_mc_referenced
    assert findings.passes_award_bar()
    assert sensitivity_criteria(findings) == []


def test_sensitivity_misses_when_no_section() -> None:
    p = _draft([("Conclusion", "We did not analyze sensitivity.")])
    findings = mine_sensitivity_evidence(p)
    assert not findings.has_sensitivity_section
    crits = sensitivity_criteria(findings)
    assert any("BLOCKING" in c for c in crits)
    assert any("Sensitivity Analysis" in c for c in crits)


def test_sensitivity_misses_when_fewer_than_3_params() -> None:
    body = "Sensitivity Analysis. We perturbed α by ±10% and saw 2% change. That was it."
    p = _draft([("Sensitivity Analysis", body)])
    findings = mine_sensitivity_evidence(p)
    assert findings.has_sensitivity_section
    assert findings.parameter_count_estimate < 3
    crits = sensitivity_criteria(findings)
    assert any("only ~1 parameter" in c or "only ~2 parameter" in c or "≥3" in c for c in crits)


def test_sensitivity_finds_cn_heading() -> None:
    body = "我们对参数 α 增减 10% 进行扰动，目标变化 4.3%。对 β 增减 20%，变化 7.1%。对 γ 增减 10%，变化 1.5%。"
    p = _draft([("敏感性分析", body)])
    findings = mine_sensitivity_evidence(p)
    assert findings.has_sensitivity_section


def test_sensitivity_section_accepts_robustness_and_validation_titles() -> None:
    """C5: the CUMCM rubric accepts 鲁棒性分析 / 模型验证 / robustness / validation
    in lieu of an explicitly-named sensitivity section. A paper using one of
    these titles must NOT be flagged for a missing sensitivity section."""
    for title in ("鲁棒性分析", "模型验证", "Robustness Analysis", "Model Validation"):
        p = _draft([(title, "We perturbed α by ±10%.")])
        findings = mine_sensitivity_evidence(p)
        assert findings.has_sensitivity_section, f"title {title!r} not detected"


# --- anonymity ------------------------------------------------------------


def test_anonymity_flags_chinese_university_name() -> None:
    p = _draft(
        [("Intro", "Our team from 吉林大学 has worked on this problem.")],
        abstract="Clean abstract.",
    )
    findings = scan_anonymity_violations(p)
    assert findings.has_violations
    assert any("吉林大学" in snip for _, snip in findings.violations)
    crits = anonymity_criteria(findings)
    assert any("DISQUALIFICATION" in c for c in crits)


def test_anonymity_flags_english_university_name_in_abstract() -> None:
    p = _draft([("body", "model.")], abstract="From Jilin University we studied...")
    findings = scan_anonymity_violations(p)
    assert findings.has_violations


def test_anonymity_flags_advisor_in_references() -> None:
    p = PaperDraft(
        title="T",
        abstract="abs",
        sections=[PaperSection(title="x", body_markdown="y")],
        references=["指导教师：张教授. 数学建模指南. 2021."],
        figure_refs=[],
    )
    findings = scan_anonymity_violations(p)
    assert findings.has_violations


def test_anonymity_ignores_gbt7714_publisher_in_references() -> None:
    """D14: GB/T 7714-2015 references legitimately carry publisher cities and
    institution presses (北京: 清华大学出版社). These must NOT trigger a BLOCKING
    anonymity finding — that drove needless Critic revisions that corrupted
    correctly-formatted bibliographies."""
    p = PaperDraft(
        title="T",
        abstract="Clean abstract with predicted error 3.2%.",
        sections=[PaperSection(title="Body", body_markdown="Model with parameter α.")],
        references=[
            "[1] 赵某某. 数学建模[M]. 北京: 清华大学出版社, 2020.",
            "[2] Li M. Optimization. Shanghai: Fudan University Press, 2019.",
        ],
        figure_refs=[],
    )
    findings = scan_anonymity_violations(p)
    assert not findings.has_violations
    assert anonymity_criteria(findings) == []


def test_anonymity_still_flags_advisor_intro_in_references() -> None:
    """D14 must not over-suppress: an author/advisor intro (指导教师:) in the
    references is a genuine identity leak and must still be flagged even
    though publisher cities/universities there are exempted."""
    p = PaperDraft(
        title="T",
        abstract="abs",
        sections=[PaperSection(title="x", body_markdown="y")],
        references=["指导教师：张教授. 数学建模指南. 2021."],
        figure_refs=[],
    )
    findings = scan_anonymity_violations(p)
    assert findings.has_violations
    assert any(label == "references" for label, _ in findings.violations)


def test_anonymity_still_flags_university_in_body_not_references() -> None:
    """A real school name in the body is still caught; only the references
    section is exempted from the university/region patterns."""
    p = PaperDraft(
        title="T",
        abstract="abs",
        sections=[PaperSection(title="Intro", body_markdown="Our team from 清华大学 ...")],
        references=["[1] 赵某某. 数学建模[M]. 北京: 清华大学出版社, 2020."],
        figure_refs=[],
    )
    findings = scan_anonymity_violations(p)
    assert findings.has_violations
    # The hit must come from the body, not the (exempted) references.
    assert all(label != "references" for label, _ in findings.violations)


def test_anonymity_clean_paper_passes() -> None:
    p = _draft(
        [("Body", "Team # 12345 modeled X with parameter α. No school mentioned.")],
        abstract="Clean: predicted error 3.2%, fuel saved 17%.",
    )
    findings = scan_anonymity_violations(p)
    assert not findings.has_violations
    assert anonymity_criteria(findings) == []


def test_anonymity_short_circuits_at_5_violations() -> None:
    body = "吉林大学 清华大学 北京大学 复旦大学 上海交通大学 浙江大学 (extra)"
    p = _draft([("Intro", body)])
    findings = scan_anonymity_violations(p)
    assert len(findings.violations) <= 5
