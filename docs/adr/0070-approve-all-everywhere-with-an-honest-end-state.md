---
number: 70
status: "**Done (plan 19 iter 5).** 0 core patches; branch `editor-review-7-approve-everywhere`."
provenance: "plan 19, iter 5"
source: docs/07-decision-log.md
---

# Approve all everywhere with an honest end state

**Approve-all-everywhere + the full cycle + an honest "all reviewed" end state**

The editor action bar now closes the loop. Four calm states on the toolbar's right: (1) this doc has changes → count + "Approve all in this doc" + "Next document" + a quiet "Approve everywhere" (when other docs also have changes, → `approveAllPending()`); (2) this doc is clear but the workspace is not → "✓ This document is clear" + "Next document" + "Approve everywhere" (keep cycling); (3) zero pending after a review → "✓ All changes reviewed" (the end state); (4) zero pending and no review happened → the neutral "Saved". The end state is gated on a per-editor `reviewWasActive` flag (set once any render saw pending) so it never fires on a doc that never had changes. Verified live: fan-out → Project Brief clear shows state (2); "Approve everywhere" cleared the Appendix → state (3) "All changes reviewed", rail empty, dots cleared.
