---
number: 68
status: "**Done (plan 19 iter 4).** 0 core patches; branch `editor-review-5-action-bar`."
provenance: "plan 19, iter 4"
source: docs/07-decision-log.md
---

# The editor action bar lives in the webview toolbar

**Editor action bar lives in the in-webview toolbar; tiny pure `nextPendingDocId` helper**

E-B built: when the open document has pending changes, the calm "Saved" status on the right of the in-webview formatting toolbar becomes a review cluster - an amber "N changes here" count, **Approve all in this doc** (`approveAll(docId)`), and **Next document** (shown only when another changed doc exists). Contrib-only, no editor-chrome core patch. "Next document with changes" is backed by a pure, unit-tested `nextPendingDocId(pending, currentDocId)` (in `livingDocsModel.ts`; 6 tests incl. round-robin cycling) that the editor calls with `getAllPending()`; the editor gained `IEditorService` to `openEditor` the next doc. Verified live: the action bar renders on a doc with pending, hides "Next document" correctly when it is the only changed doc, and **Approve all in this doc** applies + clears the change. **Finding (pre-existing, not iter 4):** a chat edit that quotes ONE item of a bulleted list fuzzy-matches the whole list block, so approving replaces the entire list with the single edited line - the other items are lost. The edit/block granularity (plan 18, decision 63) needs list-item-level matching or a no-drop guard; logged for a future iteration.
