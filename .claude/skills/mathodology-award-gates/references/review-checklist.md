# Review checklist

Distilled from the earlier role definitions. Use the items relevant to the claims under review; none is a mandatory gate.

## Paper vs code

- Every method described in the paper matches the delivered code, including preprocessing, exclusions and any deviation from the model specification; record deviations with the affected numbers.
- Every data-conditioning step on a fit or calibration channel (row drops, masks, clipping, winsorization, domain exclusions) is disclosed with counts.
- Any information criterion (AIC/BIC/AICc) is computed from the same log-likelihood used in estimation, counting all channels and penalties in k.
- Reported numbers can be regenerated from the delivered code or a documented manual calculation.

## Claims and baselines

- Every comparative or marginal claim ("X more than", "up to Y additional", "monotone in W", "at zero cost") names its baseline and matches the producing script's printed value. Watch for totals quoted as increments and 1-D monotonicity claims contradicted by a multi-variable optimizer's own output.
- A benefit or cost forced by construction (rescaling, normalization, projection, hard cap) is labeled "by construction" together with the cost that is paid; no mechanically inevitable result is presented as a discovered free lunch.
- An analytic or closed-form result states its regime of validity, and that regime is the one the recommendation actually operates in; a result derived for another regime is a side result, not support.
- Model structure is chosen on model-agnostic grounds (information criteria on the fitted likelihood, parsimony, out-of-sample skill, interpretability), never on knowledge of a synthetic generating process.

## Robustness and uncertainty

- Headline numbers (binding constraints, recommended settings, thresholds) survive the plausible range of the parameters that control them, including the least well-recovered ones; a constraint met within its Monte-Carlo error of the threshold is reported as such.
- Recovery quality is reported for every estimated parameter, and the worst-recovered one is acknowledged.
- Compared policies or scenarios consume the same pre-drawn random inputs (common random numbers), and this is asserted rather than assumed.
- Probabilistic constraints are reported as realized simulation probabilities with Monte-Carlo standard error, not as deterministic threshold checks.
- Simulation variability, parameter uncertainty and predictive uncertainty are distinguished; no error bars are invented for a single run.

## Scope and requirements

- Every phenomenon the prompt names explicitly is either modeled (with the requirement it covers) or descoped with a stated justification; nothing is silently folded into a coarser proxy.
- Every prompt clause maps to exactly one requirement; deliverables and format constraints match the contest rules.

## Consistency and citations

- The recommended decision and all its numeric settings are identical in the summary sheet, every in-text recommendation, any memo, and the conclusion.
- No citation prints page, volume or edition details that were not confirmed at the publisher or primary repository; a verification URL must resolve to the primary cited work, not a related item.

## Figures, tables and the rendered PDF

- Chart quality is judged on the rendered or compiled PDF (or a contact sheet built from it), not on source images: no overlapping labels, clipped axes, duplicate captions, unreadable text, legends sitting on data, orphaned figures or incoherent table wrapping.
- Model structure, main comparisons, sensitivity, robustness or uncertainty, tradeoffs and the recommendation are each inspectable through a figure or table; no full page reprints a table already shown.
- For synthetic data, latent truth appears in figures only as a reference marker whose caption states it was not used in estimation.

## Package

- Compliance items (page count, page-1 summary, no identifying PDF metadata, AI-use section, file size) are asserted against the rendered PDF with the command and observed value.
- No secrets, caches, scratch files or unrelated artifacts; an outside reader can submit and reproduce the package.
