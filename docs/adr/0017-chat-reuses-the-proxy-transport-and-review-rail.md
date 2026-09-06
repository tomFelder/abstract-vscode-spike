---
number: 17
status: "Done (plan 09, PR #13)"
source: docs/07-decision-log.md
---

# Chat reuses the proxy transport and Review rail

**Chat agent built on `livingDocsService._callModel`** (reuse the proxy transport, not a new provider); proposed prose edits route through the existing Review rail (`IProposedChange` -> approve/reject)

One model transport; the agent's edits inherit the proven approve/apply/audit loop for free
