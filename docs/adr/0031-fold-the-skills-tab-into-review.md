---
number: 31
status: "**Done (v3 iter 3, PR #16).** 0 core patches (our own `reviewRailView.ts`). `LivingDocsPanelTab` (common) was already 3-tab; only the rail-local `PanelTab` carried `skills`. Verified live: rail shows exactly Chat/Review/History; opening a doc populates the checks section (Strategy/Financial/Formatting). Right rail 75→85."
provenance: "v3"
source: docs/07-decision-log.md
---

# Fold the Skills tab into Review

**Fold the right-rail "Skills" tab into Review; the tab strip is the comp's exact Chat / Review / History (3 tabs)**

**Reverses decision 27's "keep Skills as a 4th tab" departure.** The goal is *indistinguishable from the comp* (>= 97%); a 4th tab was the most visible right-rail deviation (the comp shows 3). The skill graders are review-type info (document health), so they fold naturally into Review as a "Document agents" section below the pending changes — the feature is fully preserved (Run / Re-run / Apply fix all still wired), only the tab is gone
