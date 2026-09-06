---
number: 47
status: "**Decided (plan 15 iter 1).** Tier target: **our-surface**. Builds in the later iteration that ports the inline diff (U3); iter 1 lays only the node groundwork."
provenance: "plan 15"
source: docs/07-decision-log.md
---

# Proposals render as ProseMirror decorations

**A pending proposal renders as ProseMirror decorations/widgets, accepted via a real PM transaction**

The inline green/red diff must move from `renderDoc` HTML onto the PM surface. Two ways: (a) PM decorations — word-level inline add/del decorations over the target block + a `Decoration.widget` block card for an `insert`; accept = `view.dispatch` a real replace/insert transaction → `toMarkdown` → `saveRawText`, reject = clear the decoration set; (b) a rendered HTML overlay ported from today. Tom's call: **(a)** — the PM doc stays the single source of truth, so accept/reject apply and persist cleanly; an off-document overlay is fragile to re-merge.
