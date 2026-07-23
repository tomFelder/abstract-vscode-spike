# PR #250 external-edit floor - Validation Round 1 (REFUTE)

Branch `beta-gate/external-edit-floor`, HEAD `17187f5caa8`. Packaged app `/Users/tommy/Sites/VSCode-darwin-arm64/Abstract.app` (bundle contains `external-overwrite-kept`). Sample `/tmp/ee-sample`.

## Verdict: FAIL

| Criterion | Verdict | Measurement |
| --- | --- | --- |
| F1 | PASS | md-edit → notice "\"Board Note.md\" was changed outside Abstract. Reload to take the version on disk, or keep the version you have open." + [Reload from disk][Keep my version]. Lock-alone edit (harmless `__probe` field, md sha unchanged d7d884f) → same notice, no crash, title intact. |
| F2 | **FAIL** | Live-typing silent save clobbers the external edit while the notice is up. Board Note: external add sha 3127aa6 → typed via ProseMirror → sha cc9385b, "F2-retry external" GONE, typed text landed. Weekly Summary reproduced identically (sha b86859b → 125f2d6, "Sneaky external line" lost) with the reload/keep notice ON SCREEN unanswered. |
| F3 | **FAIL** | After "Keep my version", the next persist (silent save) wrote the editor version (KEEPWRITE on disk, sha c288b70) but appended NO audit entry - `Board Note.lock.json` audit[] = 0 entries. No `external-overwrite-kept`; History cannot render "Kept your version". |
| F4 | PARTIAL | Reload from disk: HOLDS - editor shows external content (RELOAD-MARKER-VISIBLE, MARKER-SHOWN in ProseMirror). Discard-warning branch: UNVERIFIED - no unit test for the `unsavedLine` copy, and `hasUnsaved` keys off `this._pending` (agent-proposed queue) not live-typed prose, so plain typing does not populate it. |
| F5 | PASS | (a) 5 typing batches over ~7.5s on Board Note, no external edit → no notice (self-write suppression holds). (b) dropped `Newly Dropped.md` into folder → no notice on open doc. (c) X1: real proposal via Ask AI (broker POST /v1/messages ok) → Approve changes → disk write (sha d7d884f, "Momentum is strong" on disk), lock audit `approved/model`. Full quit → cold relaunch → text + audit survive (sha unchanged d7d884f). New guard does NOT block a clean approve. |
| F6 | PASS | livingDoc 366/0 (incl. 4 new), LivingDocs 8/0, bind-link format 83/0 (8090 free). typecheck-client 0, valid-layers-check 0, check-seams OK. Diff = exactly 5 files (historyRender.ts, livingDocsService.ts, livingDocLedger.ts, livingDocsModel.ts, livingDocsService.test.ts), 0 core. |

## Root cause of F2/F3 failures

Live ProseMirror typing persists via `saveRawText(resource, text, { silent: true })` (`livingDocEditor.ts:236`). `saveRawText` (`livingDocsService.ts:3535`) writes straight to disk via `this._files.writeFile` at line 3551:
- never calls `_persist`, so the `_diskUnchanged` guard and the `keepMine`→`external-overwrite-kept` audit are both bypassed;
- rebuilds a fresh `IDocState` (line 3539) that drops the `keepMine` flag set by "Keep my version", then overwrites `_docs.set(id, state)` (line 3555);
- calls `_captureDiskState` AFTER the write (line 3561), re-baselining so no later watcher event detects the clobber.

The external-edit guard was added only to `_persist` (approve/refresh path), not to `saveRawText` (the primary live-editing write path). Result: a user typing in an open doc silently clobbers an external edit - the exact last-write-wins data loss #133 claims to floor - even with the reload/keep notice visible.
