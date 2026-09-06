---
number: 89
status: "**Done (plan 25 iter 1).** 0 core patches; branch `redesign-25-1-nav-width`."
provenance: "plan 25, iter 1, D25-B"
source: docs/07-decision-log.md
---

# The Editor nav item's open fallback chain

**The "Editor" nav item opens the active/last Living Document, else the first doc in the folder, else Home**

The comp's nav order is Home · Editor · Templates · Knowledge · Agents; Editor is the document surface (unlike the screen entries). D25-B open logic (`editorNavLauncherView.ts` `openEditorNavTarget`), all reusing the existing open-doc path (the editor resolver turns a `.md` resource into the Living Document editor): (1) if a Living Document is already the active editor, reveal it; (2) else the most-recently-active Living Document from `IHistoryService.getHistory()`; (3) else the first document from `ILivingDocsService.listDocuments()`; (4) if the folder has no documents, open the Home screen (the calm on-ramp — nothing to edit yet). A folder-scoped quick-pick was the plan's alternative; deferred as a later refinement to keep iter 1 dependency-light — recency-then-first always lands the user on real prose when any exists. Verified live: clicking Editor with no doc active opened "Appendix — Design Tokens" (first folder doc) in the ProseMirror editor.
