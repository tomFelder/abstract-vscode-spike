---
number: 35
status: "**Done (v4 iter 2, PR #17).** 0 core patches (own `livingDocRender.ts`: CSS `.srcdrawer` + rewritten `renderSourcePeekLayout`; removed `.peekwrap`/`.srcpane`/`.synccircle`). TDD: render test re-spec'd to the drawer + a synced-chip test (7 passing). Verified live + all six gates re-checked green with the drawer open. Source-peek 55→96. _Residuals (demo-data, not defects): meta omits the comp's mock \"changed 2m ago\"; synced chip shows the real applied count (\"✓ 0 synced\" when already up to date) vs the comp's mock \"3\"._"
provenance: "v4"
source: docs/07-decision-log.md
---

# Source-peek becomes a bottom drawer

**Source-peek is a bottom in-surface drawer, not a left split pane**

The revised "Workbench v2" comp re-hosts source-peek: instead of a left pane that squeezes the document side-by-side (with a floating "Sync across" circle on the divider), the source slides up as a full-width bottom drawer overlay (52% height, drag-handle, 46px header) and the document stays full-width centred. The comment in the comp is explicit: *"in-surface overlay — never splits the editor."* This reinforces G1/G5 (the editor is one quiet writing surface; source is traced to on demand, not parked beside the prose). The sync action becomes the drawer header's primary "Sync to report" button (no divider circle)
