---
number: 72
status: "**Done (plan 19 iter 7).** 0 core patches; branch `editor-review-floating-bar`; presented for review (not auto-merged)."
provenance: "plan 19, iter 7"
source: docs/07-decision-log.md
---

# Review actions move to a floating review bar

**Review actions move out of the formatting header into a floating review bar; drop the persistent end state**

Tom's feedback on the iter-4/5 action bar: the review cluster should NOT live inside the WYSIWYG formatting toolbar. Reverted `.etoolbar` to pure formatting - its right side always shows the calm "Saved · v14" status again. The review affordance is now its own **floating bar** rendered directly BELOW the formatting toolbar (between `docToolbar` and the body), `position:sticky; top:94px` under the sticky topbar + formatting toolbar, full document width, with a soft elevation shadow and a warm amber tint so it reads as a distinct review affordance rather than more grey chrome. It carries the SAME states/actions/`data-*` attributes as before (this-doc count + "Approve all in this doc" + "Next document" + "Approve everywhere"; and the "This document is clear" cross-doc state) so all webview + editor wiring is unchanged. **The bar is present ONLY when `totalPendingCount > 0`** - in this document or another - so approving the last change simply removes the bar, and that disappearance IS the "done" signal. The persistent **"All changes reviewed"** end state was dropped, and the now-dead `reviewWasActive` plumbing (render input field + `_reviewWasActive` in the editor) removed. Verified live (isolated web context, blue→red fan-out): no-pending → bar absent + "Saved"; doc-with-changes → floating amber bar with count + "Approve all in this doc"; cross-doc → "This document is clear" + "Next document" + "Approve everywhere"; "Next document" advanced the editor and "Approve all in this doc" applied + the bar vanished. `typecheck-client` + `valid-layers-check` clean; **0 core patches** (only `livingDocRender.ts` + `livingDocEditor.ts`).
