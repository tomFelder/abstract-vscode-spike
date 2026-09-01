---
number: 62
status: "**Settled (plan 18 iter 1).** To build."
provenance: "plan 18, D-C"
source: docs/07-decision-log.md
---

# Ask the model once for a per-document edit map

**The model is asked ONCE, returning a per-doc edit map**

_Diverges from the plan's "one call per doc" recommendation — Tom's pick._ A single model call is given every working-set doc's body and returns edits keyed by `docId`; the result is fanned into the existing per-`docId` proposal queue. Fewer round-trips and the model sees all docs together (more consistent cross-doc edits). Trade-off accepted: one failure affects the batch and parsing is richer — mitigated by a tolerant parser (cf. decision 58) and revisitable if a doc's edits are unreliable.
