---
number: 23
status: "**Done (v2 iter 3, PR #15).** 0 core patches (additive-contribution). Pure helpers `buildFileTree`/`buildOutline`/`searchTreeRail` in `common/treeRail.ts` (TDD); `ILivingDocSummary` gained `sources`. Verified live: all 4 tabs + folder tree + doc-open."
provenance: "v2"
source: docs/07-decision-log.md
---

# The tree-rail is one tabbed ViewPane

**The tree-rail is ONE `TreeRailView` (a single sidebar `ViewPane`) with internal Files/Context/Outline/Search tabs**, not four VS Code view-containers

VS Code's model is one-activity-icon-per-sidebar-container; the comp's rail is a single panel with internal tabs. A single DOM-rendered ViewPane (like DocumentsView) matches the comp's tabbed rail without fighting the container model. Folded the separate Documents + Context containers into it; deleted `documentsView.ts` + `contextPanelView.ts`
