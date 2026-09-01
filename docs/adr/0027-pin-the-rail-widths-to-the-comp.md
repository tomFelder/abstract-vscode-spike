---
number: 27
status: "**Done (v2 iter 7, PR #15).** Tier: **additive-contribution** — `StudioStartupContribution` calls `IWorkbenchLayoutService.setSize` after the rail is revealed + a layout tick (so it isn't overwritten by the size restore). Verified live: right rail 282 -> 374px, sidebar -> 252px (the grid redistributes, so near- not exact-pixel). _Note:_ the extra **Skills** tab (4th, vs the comp's 3) is kept as a deliberate departure — it's a real verification feature (graders) the comp didn't show."
provenance: "v2"
source: docs/07-decision-log.md
---

# Pin the rail widths to the comp

**Pin the tree-rail (264px) and right rail (392px) to the comp's widths on startup**

The comp specs a 264px left rail + 392px right rail; the IDE defaults left them at ~246/282 (cramped right rail). The product is an opinionated single surface, so the shell layout is set, not left at IDE defaults
