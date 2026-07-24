# verify-actuation findings - 2026-07-24

Four contested claims settled with hard disk + live evidence. Model flow worked cold (broker auto-started). Chat rail input is a plain TEXTAREA (fill works, not Monaco). The in-doc editor + Doc Properties render in a `vscode-webview://` iframe (f3 refs); a11y-ref clicks DO actuate them.

## Claim 1 - review-rail approve/reject may not apply
- **Per-card "Approve & apply" (Review rail): REFUTED.** Clicked it; Board Note body changed on disk AND lock audit[] gained an "approved" entry. Same engine as chat.
- **"Approve all in this doc" (in-doc editor bar, `data-approve-all-doc` -> `approveAllDoc`): CONFIRMED no-op (sev-2).** Reproducible: click -> no modal (`modal-dialog-visible` stays false), audit count unchanged, changes stay pending ("N changes waiting"). Per-card in-doc "Approve changes" works (audit +1). Root cause (source): `approveAllDoc` calls `_confirmBulkApprove(getPendingForDoc(this._resource), () => approveAll(this._resource.toString()))`; the editor's `this._resource` is stale/mismatched vs the pending changes' docId, so `getPendingForDoc` returns [] (confirm skipped) and `approveAll` also matches nothing -> silent no-op. Corroborated by the stale audit `docTitle` (see below).
- **Review-rail bulk "Approve all" (`getAllPending`): works but gated by a NATIVE confirm dialog** (see Claim 2).

## Claim 2 - bulk-approve confirm dialog
- **CONFIRMED it exists and fires.** With 2 meaning changes pending, review-rail "Approve all" set `modal-dialog-visible` on the workbench and BLOCKED the renderer; no apply until confirmed. Dialog is a **native Electron message box** - NOT in the CDP renderer DOM, NOT a separate CDP target, unreachable by playwright click/Enter/Escape. Dismissed it via macOS `System Events keystroke return` (default button) -> both changes then applied to disk (audit 1->3). `bulkApproveConfirm` (livingDocsModel.ts) builds "Approve N changes including M meaning changes? A version snapshot is taken first, so you can restore." Could not screenshot the dialog text (native, off-renderer) - this is exactly why prior agents "could not capture it". Not a regression; it's an automation-visibility limit, but note it is a native dialog (inconsistent with the app's custom-styled chrome).

## Claim 3 - 1g policy dial
- **Actuation REFUTED - dial fully works.** Doc Properties -> Agent Policy: clicking "Never change this doc" / "Apply automatically" / "Ask me first" via a11y-ref each wrote the frontmatter `policy:` on disk (`never`, `auto-apply`, absent=ask-first) and moved the UI checkmark. Persists.
- **Enforcement CONFIRMED as a defect (INCOMPLETE).** With `policy: never` on disk, a chat request to edit the doc STILL produced a proposed edit (should be refused/left alone). Source confirms: `getDocPolicy(resource)` has exactly ONE caller (livingDocEditor.ts:561) that reads it only to render the dial's selected state; nothing in the propose/apply pipeline (livingDocsService.ts) reads it to gate applies. The dial is persisted but never read as a policy gate.

## Claim 4 - 1e Stop control
- **REFUTED - present and functional on desktop.** During streaming the chat-rail send button becomes a red `■` square, title "Stop", bg #b4332f (reviewRailView.ts:1207-1213), visible ~2.4s while the local model streamed. Clicking it cancelled the turn (a muted "stopped" turn appeared, button reverted to `↑`). Esc also cancels (line 1226). Prior "no Stop on desktop" was likely a too-brief streaming window with the fast local model.

## Cross-cutting bug found
- **Stale audit docTitle:** every lock audit[] entry for Board Note edits recorded `docTitle: "Appendix — Design Tokens"` (the doc open at launch, before Board Note was selected). The proposal/approve pipeline keys off a stale doc identity - the same root cause as the "Approve all in this doc" no-op.
