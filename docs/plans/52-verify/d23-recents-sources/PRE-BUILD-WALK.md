# WP-D2/D3 pre-build walk - 13 Aug 2026

Walked the real desktop app on `main` at `8a80d41a7f3` before writing anything, per `docs/plans/RUN-cursor-parity-remainder.md` §4. **Both slices are genuinely unbuilt.** D1 (dissolve the "Reports" wrapper) did land in #292 - the tree root is now the real folder hierarchy - but two synthetic groups still sit on top of it.

## D2 - Recents is still inside the tree

`pre-01-tree-carries-recent-and-sources.png`. After opening three documents the Files tab reads:

```
Recent            3      <- synthetic group, duplicates rows that appear again below
  Team Notes
  Board Note              LWD
  Appendix — Design…
brief             3      <- the real folder
  Appendix — Design…
  Executive Summary
  Project Brief — Nor…
Board Note          LWD
Market research
Team Notes
Weekly Operatin…    LWD
Wrap Rule Fixture
Sources           1      <- synthetic group
  metrics.csv     synced
```

Every Recent row is a second copy of a row already in the tree, so at three recents the pane shows nine document rows for six documents. The model already caps it - `RECENT_GROUP_CAP = 5` in `common/treeRail.ts`, shown only at two or more - so D2 is about **where it lives**, not about the cap.

## D3 - Sources is still in the Files tree, and the Context tab is per-document

`pre-02-context-tab-is-per-document.png`. The Context tab tracks the **active document** (`treeRailView.ts` line ~159: *"Context/Outline track the active document"*), and on a document with no bindings it shows only "Connect a data source to keep figures in this document up to date" with `+ Add source` and `+ Add context`. There is no workspace-level view of the folder's sources anywhere in it.

What the Files tree's Sources group carries today, and what D3 must not lose:
- **Freshness states** on the row (`metrics.csv  synced`), from `sourceFreshness`/`sourceRailDot`.
- **The collapsed `Assets` bucket** - `ASSETS_FOLDER_ID = 'folder:Sources/Assets'` buckets un-bound image/screenshot sources behind one collapsed node so ~200 screenshots never flood the pane (issue #171).
- **Row actions** - right-clicking a source row gives `Rename…`, `Add to Chat`, `Delete…` (the lighter provenance-safe menu, not the document menu).
