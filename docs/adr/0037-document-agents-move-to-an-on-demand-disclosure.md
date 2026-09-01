---
number: 37
status: "**Done (v4 iter 4, PR #17).** 0 core patches (own `reviewRailView.ts`): a `_checksExpanded` flag (collapsed by default) + a `checksDisclosureHtml` toggle at the bottom of Review (a flag-count rides the collapsed row); the full `skillsHtml` body renders only when expanded; no agents affordance at all when no living doc is open. Verified live + all six gates green. Right rail 75→95. _Residual: the single collapsed \"Document agents\" row is a justified departure (the comp shows none) to hold v1 functionality._"
provenance: "v4"
source: docs/07-decision-log.md
---

# Document Agents move to an on-demand disclosure

**Resolves #34 — relocate the Document-Agents panel to an on-demand disclosure (Tom's call)**

The "Workbench v2" comp drops the always-on right-rail Document-Agents panel, but Strategy/Financial/Formatting + Apply-fix are wired v1 functionality. Tom chose **relocate, not drop**: keep the capability behind an on-demand affordance so the Review tab matches the comp while v1 holds
