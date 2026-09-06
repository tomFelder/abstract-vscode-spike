---
number: 20
status: "**Done (v2 iter 2, PR #15).** Replaced `revealSource`/`openSourceBeside` (both `SIDE_GROUP` opens) with a pure `getSourcePeek` data method; the LivingDocEditor holds source-peek state and renders an in-surface left pane + floating \"Sync across\" circle inside the one webview. **0 core patches.** Verified live: open Source -> in-surface pane (no 2nd group, no blank pane) -> Sync -> close."
provenance: "v2"
source: docs/07-decision-log.md
---

# Source-peek becomes an in-surface panel

**Source-peek + Sync-across become in-surface panels, never editor splits**

The product is one calm surface (Word/Docs/Notion); a second editor group + blank pane reads as an IDE, not a document tool
