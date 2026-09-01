---
number: 49
status: "**Decided (plan 15 iter 1).** Tier target: **our-surface**. The end state removes `renderDoc()`'s HTML body + `renderBoundParagraph` + the HTML `inlineDiff`; iter 1 starts by getting the node + bundle-as-resource in place."
provenance: "plan 15"
source: docs/07-decision-log.md
---

# ProseMirror is the single render path

**Retire the bespoke `renderDoc` HTML body; ProseMirror is the single render path for all docs (chrome stays)**

The two-surface seam (plain→PM, living→`renderDoc`) is what blocks F7. Two ways forward: (a) replace — PM becomes the body for every `.md`; the `renderDoc` block renderer (gutter markers, bound figures, inline diff, source drawer) collapses into the PM schema + NodeViews + decorations while the calm topbar/toolbar/source-drawer chrome stays; (b) keep both and only bridge chat across. Tom's call: **(a)** — one surface is the whole point; net **delete > add** (U1). Landed incrementally across iterations but converging on a single path.
