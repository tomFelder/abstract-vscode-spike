---
number: 88
status: "**Done (plan 25 iter 1).** 0 added core patches (5 total unchanged); branch `redesign-25-1-nav-width`. Active chip / bottom-pinned account+settings / the Editor→Templates divider are 25.2+ scope."
provenance: "plan 25, iter 1, D25-A"
source: docs/07-decision-log.md
---

# The labelled nav needs no new core patch

**The labeled 76px icon-nav needs NO new core patch — the width seam was already paid in v2 iter 9**

Plan 25 flagged the labeled 76px nav as "the one item expected to need a core patch." Live audit found the required core touch **already exists**: `ActivitybarPart.ACTIVITYBAR_WIDTH = 76` (`activitybarPart.ts:52`, landed v2 iter 9), and the per-item label is the existing `styleOverrides` `studio.css` rule (`::after { content: attr(aria-label) }`). So iter 1 re-pinned the Part-B/C1 tokens **CSS-only** (added `.style-override-studio .part.activitybar` panel bg `#F6F7F9` + `width:60px` items + `::before{font-size:18px}` 18px glyph; label already 10px/500) and added the Editor nav entry as an **additive contribution** — **0 new core patches**. Verified live at 1440x900 on `:8080`: bar 76px, panel bg, items 60px, glyph 18px, label 10px, order Home·Editor·Templates·Knowledge·Agents; design-match ~93% on the iter-1 slice (bar-width + labels + order). One prerequisite was a **settings** change: the served brief root (`living-docs-sample/brief`) had no `.vscode/settings.json`, so `modernUI`/`activityBar.location` were off and the nav was hidden — added a mirror of the parent sample settings so the shell renders (sample content, not core).
