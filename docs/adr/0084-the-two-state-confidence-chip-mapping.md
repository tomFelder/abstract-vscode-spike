---
number: 84
status: "**Settled + built (plan 24 iter 1).** Branch `redesign-24-1-review-screen`."
provenance: "D24-A · plan 24, iter 1 — confidence mapping"
source: docs/07-decision-log.md
---

# The two-state confidence chip mapping

**A `meaning` change with `confidence < 0.8` maps to `◐ Inferred` (attention, "needs your eyes"); every other change (any `figure`, or a `meaning` change with `confidence >= 0.8`) maps to `● High` (ok/accent).**

The cross-document review cards (C5) show a two-state confidence chip, but the engine only carries a numeric `confidence` (0..1) + a `kind` (`'figure' | 'meaning'`) per `IProposedChange`. Rule chosen (the plan's recommendation, adopted): a **figure** change is a deterministic source substitution (a bound value moved), so it is always `● High`; a **meaning** change is a rewrite of prose, so it reads as `● High` only when confident (`>= 0.8`) and is flagged `◐ Inferred` when the model is less sure (`< 0.8`). Implemented as a pure, TDD'd `reviewConfidence(change)` in `livingDocsModel.ts` (`'high' | 'inferred'`; 1 snapshot test over the boundary: meaning@0.79→inferred, meaning@0.8→high, figure@0.4→high). **Confidence values observed in real pending** (ISMS throwaway, whole-project fan-out via `_chatRespondMulti`): the cheap model (gpt-4o-mini) emitted a uniform **0.85** confidence on every meaning change this loop → all mapped to `● High` (the threshold is exercised by the unit test, not live this run — the model did not produce a sub-0.8 change). The `◐ Inferred` amber-tinted card path is proven by the test + renders correctly when a change crosses the threshold.
