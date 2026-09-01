---
number: 61
status: "**Settled (plan 18 iter 1).** To build."
provenance: "plan 18, D-B"
source: docs/07-decision-log.md
---

# No working set means the active document only

**No working set → chat edits only the active doc (backwards compatible)**

The plan-17 single-doc chat must not regress. Fan-out triggers *only* when a working set is explicitly present; with no set, `_chatRespond` behaves exactly as today against the active doc. No surprise multi-doc edits.
