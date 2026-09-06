---
number: 29
status: "**Done (v2 iter 9, PR #15). SECOND v2 core patch** (tier: **core-patch**, `ACTIVITYBAR_WIDTH 48 -> 76`) + Studio `studio.css` labels (styleOverrides-CSS). Verified live: 76px rail, labels (Workspace/Home/Templates/Knowledge/Agents), sidebar reflows with no overlap. Completes the **G3** icon-nav residual (tree-rail was decision 23). The core activitybar test asserts against the *constant*, so it stays green."
provenance: "v2"
source: docs/07-decision-log.md
---

# A 76px labelled icon-nav

**The icon-nav is a 76px labeled rail** (the comp), not VS Code's 48px icon-only activity bar

The comp's left nav is 76px with a text label under each icon; at 48px there are no labels and the rail reads as an IDE activity bar. The grid allocates the bar from `ActivitybarPart.ACTIVITYBAR_WIDTH`, so the width needs a core constant; the label is then CSS (`::after { content: attr(aria-label) }`, the container name lives there)
