---
number: 169
status: "**Decided.** Plan 44 owns both seams; ledger carries PENDING rows until they land."
provenance: "plan 43 §6"
source: docs/07-decision-log.md
---

# The elevation model's two-seam budget

**The elevation model ships with a hard core-seam budget of TWO small seams for the whole wave: (1) part backgrounds/margins CSS for the floating panels, (2) the titlebar height constant for the 48px header - each minimal, fail-soft, ledger-logged with a re-pin check and asserted in `check-seams.sh`; `.monaco-editor-background` stays opaque `#FFFFFF`**

Chrome `#EDEFF3` + three floating cards (radius 14, rail/editor shadows, 12px gaps) is the wave's structural move and the mock's own ledger pre-authorises exactly one CSS seam for it; the header height has the `ACTIVITYBAR_WIDTH 48->76` precedent. Budgeting up front keeps the merge-tax discipline honest under an autonomous run - a third seam is a stop-and-escalate, not a judgement call.
