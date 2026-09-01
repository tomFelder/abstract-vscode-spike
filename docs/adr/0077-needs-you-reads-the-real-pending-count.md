---
number: 77
status: "**Done (plan 22 iter 1).** Branch `redesign-22-1-home-needsyou`, PR to `main`."
provenance: "plan 22, iter 1"
source: docs/07-decision-log.md
---

# Needs You reads the real pending count

**NEEDS YOU + greeting summary read the real per-document pending count already carried on `ILivingDocSummary.pendingCount`; no new store.**

Home's `IScreenState.docs` is `listDocuments()`, and each `ILivingDocSummary` already exposes a truthful `pendingCount` (`livingDocsService._summarize` sets it to `this._pending.filter(c => c.docId === id).length` - the real pending set, keyed by doc URI). So iter 1 reuses that field: the greeting summary line counts docs with `pendingCount > 0` and sums the total ("N documents need your review across this project" / calm "Everything is in sync." when zero); NEEDS YOU renders up to **2** cards for the docs with the highest `pendingCount` (`> 0` only), each with the accent top-border, a 2.4s `lwdPulse` dot, the doc name, an amber `N TO APPROVE` chip (`attention` tokens: bg `#FDFAF2`, ink `#8A6D1A`, border `#E4DCCB`, mono UPPER), and a primary **Review** button wired to the existing `openDoc` message (opens the document + its review rail; the cross-doc review is plan 24). The whole section is omitted when nothing pends. Per-project avatar colour is chosen deterministically from the Part-B avatar palette by hashing the doc title. **No fabricated counts, no invented cards.** Verified live on `living-docs-sample` (Board Note.md, Refresh from sources → real pending) + the in-sync state. `typecheck-client` + `valid-layers-check` clean; **0 core patches**.
