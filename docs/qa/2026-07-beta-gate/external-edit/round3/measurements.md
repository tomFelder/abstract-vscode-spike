# PR #250 - Validation Round 3 (FINAL) measurements

Branch `beta-gate/external-edit-floor`, HEAD `e5f5b751f64`. Packaged `Abstract.app` rebuilt from this branch (built 22:01, 23 Jul), bundle carries `keep-audit lock write failed` + `external-overwrite-kept` + `Reloading will discard`. Driven live over CDP (port 9236) against the real ProseMirror editor in the webview OOPIF, real mousedown/up on notice actions, `Input.insertText` for live typing. Isolated sample `/tmp/ee3-sample`, isolated udd/ext dirs.

## Verdict: PASS

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| F1 | PASS | External md-edit -> plain-words notice `"Board Note.md" was changed outside Abstract. Reload to take the version on disk, or keep the version you have open.` + [Reload from disk][Keep my version]. |
| F2 | PASS | Team Notes: external edit (sha `b6123a2b`, marker `EE3-F2-EXTERNAL-UNANSWERED-Q5`), notice up UNANSWERED, typed 35 chars, waited full 8s debounce. Disk sha FROZEN `b6123a2b`, external marker present (1), typed marker NOT on disk (0). Keep-path rework did not regress the guard. |
| F3 | PASS (defect 1 cured) | Board Note: external edit -> notice -> Keep my version (real click 1366,865) -> typed `KEEP-TYPED-Z9` -> 4s. IMMEDIATELY read disk: `.lock.json` audit = 1 `external-overwrite-kept` (atomic with .md), typed on disk, external gone. Quit -> relaunch -> History renders "Kept your version" (Board Note / h-numbers, heuristic). New external edit re-triggers notice (keepMine one-shot cleared). |
| F4 | PASS (defect 2 cured) | Weekly Summary: external edit -> FIRST notice, 1 live, NO discard line (watcher-first). THEN typed `F4-TYPED-NOW` -> notice REFRESHED to `...changed on disk since you opened it. ... Reloading will discard the changes you have here that are not yet saved.`, still exactly 1 live. More typing -> still 1 notice, no stack/flicker. Reload from disk (1244,865) -> editor shows external content, typed prose discarded, notice gone. |
| F5 | PASS | 5 clean typing/save batches (no external edit) -> 0 notices, saves land (disk advances). Open/close a doc -> 0 stuck notices, 0 relevant console/leak errors. App quits clean (no orphaned process - dispose closes handles). |
| F6 | PASS | livingDoc 370/0, LivingDocs 8/0, bind-link 83/0 (8090 free, fresh transpile). typecheck-client exit 0, valid-layers-check exit 0, check-seams OK. Diff vs origin/main = 5 files, all under contrib/livingDocs, 0 core. |

## F3 audit entry quoted (on-disk `Board Note.lock.json`, read immediately after the live Keep save, before any other action)

```json
{"time": "2026-07-23T12:11:56.497Z", "docTitle": "Board Note", "blockId": "h-numbers", "action": "external-overwrite-kept", "oldText": "", "newText": "kept the version open in Abstract over an edit made to \"Board Note.md\" outside it", "via": "heuristic"}
```

Exactly one such entry; `diskAuditCount === 1`.

## F4 live notice text (refreshed after typing)

```
"Weekly Summary.md" changed on disk since you opened it. Reload to take the version on disk, or keep the version you have open. Reloading will discard the changes you have here that are not yet saved.
```

## Screenshots

- `F3-notice.png` - watcher notice on Board Note before Keep
- `F3-history-kept-your-version.png` - History after quit/relaunch, "Kept your version" entry
- `F4-first-notice-no-discard.png` - first notice (watcher), no discard line
- `F4-notice-with-discard-line.png` - refreshed notice with discard line + typed prose in editor
