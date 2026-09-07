# Adaptable modeling workflow

Use [the shared submission prompt](../.claude/workflows/mathodology-award-submission.md)
in Codex or Claude Code. It is a starting brief, not a compulsory sequence.
[Contest emphasis](../.claude/workflows/mathodology-contest-variants.md) adapts the
work to the actual outputs and rules without hardcoding old limits.

## Work from questions

| Question | Useful work |
|---|---|
| What decision must the answer support? | Read the problem, data and current rules; clarify only consequential missing details. |
| What is the simplest useful model? | Define variables, units, mechanisms, objectives and constraints; justify added complexity. |
| What could change the conclusion? | Compare a fair baseline, check residuals/feasibility and test important assumptions. |
| How can the reader inspect the evidence? | Select purposeful figures, explain results and uncertainty, and provide traceable calculations. |

Move between these questions as evidence changes. Keep concise assumptions and
decisions in ordinary prose when useful; no fixed files or schemas are required.
Choose independent specialist help for bounded questions when supported by the
host. Share relevant context and image2 availability, and coordinate file ownership.

## Figure prompts

Use [figure presets](../.claude/skills/mathodology-figure-presets/SKILL.md).
Start from the intended question and available data, then adapt a recipe and
caption. The library includes licensed references and synthetic previews; neither
is evidence for the current contest problem. Use actual units and uncertainty.

Ask once at first figure design whether image2 is available through a tool,
configured interface or manual use. Do not repeat an existing answer. Continue
analysis and numerical plots while awaiting a reply. Use the actual model/tool
when available, or provide a manual prompt. Do not invent an image2 integration,
request keys in chat or label a generic image tool as image2. Illustrations and
layout concepts may use image2; numerical layers must remain data-driven.

When image2 is absent, pending or manual-only, run the [chart code templates](../.claude/skills/mathodology-figure-presets/templates/README.md) against actual task data and export PNG/PDF. Adapt the code as needed and deliver rendered images, not just instructions.

## Review and deliver

Use [review questions](../.claude/skills/mathodology-award-gates/SKILL.md) to examine
claims, not to predict prize tiers. Check the code against the described model,
important conclusions against their evidence, and dense figures at paper size.
Inspect actual compiled pages; an optional PDF overview can help find layout
problems. Correct material errors and disclose uncertainty.

Deliver the requested paper, figures, code or calculation notes, verified
references and reproduction instructions. Follow the actual contest's anonymity,
page and AI-use requirements. Do not add artifacts solely to satisfy a generic
workflow. Existing useful work can be resumed without rebuilding a phase history.
