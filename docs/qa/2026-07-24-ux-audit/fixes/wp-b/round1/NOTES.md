# WP-B fix round 1 - #253 editor-bar "Approve all in this doc" (live desktop evidence)

Branch `wp-b-doc-identity`. Verified on the desktop Electron build with the app-started broker
(OpenRouter, gpt-4.1-mini), against a throwaway copy of `living-docs-sample` at `/tmp/wpb-ws`.

## The bug (from the audit, reproduced by the validator)

The editor action bar's "Approve all in this doc" was a silent no-op: it called
`approveAll(this._resource.toString())`, but that identity can drift from the `docId` the pending
proposals were queued under (the chat rail queues proposals against the group's active-editor
resource). The filter came back empty, `bulkApproveConfirm([])` returned `needed:false`, so no
confirm dialog, no apply, and zero `proposal_resolved` events fired.

## The fix

Mirror the working review-rail path - route the confirm gate AND the apply through the proposals'
OWN docId, resolved once at click time, so the confirmed set and the applied set are provably the
same set. Files (lane-1 fork-owned only):

- `livingDocsService.ts`: `getPendingForDoc` now also matches on `isEqual` (URI-form / path-casing
  / fragment tolerance), and a new `pendingDocIdFor(resource)` returns the canonical docId the
  pending changes are keyed under.
- `livingDocEditor.ts`: the `approveAllDoc` handler resolves `getPendingForDoc` + `pendingDocIdFor`
  and passes that single docId to `approveAll`; `_resourceForPending()` falls back to the group's
  active-editor resource so a drifted `_resource` cannot strand the changes.
- Regression test in `livingDocsService.test.ts` (suite "livingDocs Service") pins the editor-bar
  path end to end after a tab switch.

## Live repro walked (exactly the audit sequence)

1. Opened tab **Appendix - Design Tokens**, then switched to **Board Note** (fresh doc-tab open).
   `01-board-note-active-after-tab-switch.png`
2. Chat -> instruction producing **2 model-generated proposals** on Board Note (Note to the board +
   Asks). `02-two-model-proposals-generated.png`
3. Editor bar showed **"2 changes here" + "Approve all in this doc"**.
   `03-editor-bar-approve-all-present-with-2-changes.png`
4. Clicked the editor-bar button. The **decision-132 native confirm dialog fired** (buttons
   "Cancel" / "Approve all") - previously it never appeared. Clicked "Approve all".
5. Changes **applied to disk**, the reviewbar cleared, `proposal_resolved` events fired.
   `04-applied-after-editor-bar-approve-all.png`

## Disk proof

- `board-note-after-apply.md` - the `.md` on disk now reads:
  - "Momentum is accelerating; we are ahead of plan with positive developments this week."
  - "We request one additional recruiter to support the next hiring cohort."
- `board-note-approved-audit.json` - the lock's `approved` audit entries (`via: model`), written by
  the bulk approve.

## Other paths

- Per-card "Approve changes" (`approve(id)`) and the review-rail "Approve all"
  (`getPendingForDoc(URI.parse(docId))` + `approveAll(docId)`) are code-unchanged; `getPendingForDoc`
  became a strict superset (matches the same plus URI-form variants), so those paths cannot regress.
  Both buttons were present and reachable throughout the walk.

## Test / typecheck

- `npm run typecheck-client`: 0 errors.
- `scripts/test.sh --grep 'livingDocs Service'`: 175 passing (incl. the new #253 regression test).

## Note on driving the native confirm

The bulk-approve confirm is a native macOS sheet, invisible to CDP. It was dismissed via
`osascript ... click button "Approve all" of sheet 1` once the app was activated; plain keystrokes
did not reach it in this session (Accessibility trust). The sheet's presence + button labels are
themselves proof the confirm now fires (it did not before the fix).
