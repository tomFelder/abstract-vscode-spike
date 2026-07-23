# External-edit floor - Round 2 adversarial validation (PR #250)

Branch `beta-gate/external-edit-floor` HEAD `2aac6ebf5cc`. Packaged `Abstract.app` rebuilt from this branch (bundle carries `unsavedRaw`, `external-overwrite-kept`, `diskLockText`, "changed outside Abstract"; built 21:16 today). Driven over CDP (port 9235) with real Input.dispatchMouseEvent mousedown/mouseup; live ProseMirror typing via Input.insertText into the focused editor.

## Verdicts

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| F1 (re-tested via F2) | PASS | External md-edit -> plain-words notice "\"Board Note.md\" was changed outside Abstract. Reload to take the version on disk, or keep the version you have open." + [Reload from disk][Keep my version]. `F2-v1-notice-clip.png`. |
| F2 | PASS | Silent-save typing NO LONGER clobbers. Two docs, two timings - disk sha frozen through the debounce, external line preserved, typed prose kept in editor. |
| F3 | **FAIL** | Keep my version + live typing writes the editor version over the external edit but does NOT persist `external-overwrite-kept` to `.lock.json` atomically (disk audit = 0 immediately after; History shows nothing). The entry only reaches disk on a LATER unrelated `_persist` (e.g. a bound-source reconcile). Once flushed it is exactly one, well-formed, and survives; re-trigger on a new external edit works. But between the Keep and that later persist - including a quit/reload in that window - the audit is not on disk, violating "the next persist appends... History renders". |
| F4 | **FAIL (live)** / passes unit | Reload-from-disk works (editor shows external content, unsaved prose discarded). But the "Reloading will discard..." warning does NOT appear in live conditions: the OS watcher always raises the no-discard notice first, and `noticeUp` dedup suppresses the later blocked-save prompt that carries the discard line. 3/3 live race attempts: notice always the watcher preamble, `hasDiscard=false`. The unit test passes only because `writeExternalNoWatcher` bypasses the watcher. |
| F5 | PASS | (a) 5 typing batches, no external edit: disk advances each batch (saves land, guard transparent), 0 notices. (b) new `.md` dropped in folder: 0 notices on open doc. (c) guard transparent to clean writes + clean cold-reopen (0 spurious notice, content survives); `_persist` approve guard uses the same `_diskUnchanged` proven true for clean state (full proposal->approve->cold-reopen chain was confirmed in round-1; only the guard changed since). |
| F6 | PASS | livingDoc 369/0, LivingDocs 8/0, bind-link format 83/0 (8090 free at suite time); typecheck-client clean; valid-layers-check clean; check-seams OK; diff = 5 files all under contrib/livingDocs (0 core). |

## F2 measurements (PASS)

Variant 1 (Board Note, type immediately):
- Baseline sha `13d9f858`; external append `EXT-A1B2C3` -> sha `af8179a5`; notice up (watcher).
- Typed `TYPED-WHILE-NOTICE-XYZ789` while notice up.
- Over 5s debounce window: disk sha frozen `af8179a5`, mtime frozen 21:24:51. `EXT-A1B2C3` present on disk (1), typed text NOT on disk (0) but STILL in editor. Dedup: 1 toast.

Variant 2 (Weekly Summary, type-wait-type):
- external `EXT-W9K8L7` -> sha `93c1d275`. Typed `V2TYPE-FIRST-AAA`, waited 4s, typed `V2TYPE-SECOND-BBB`, waited 4s.
- Disk sha frozen `93c1d275` throughout; `EXT-W9K8L7` present; neither typed burst on disk; both in editor. Dedup: 1 toast.

## F3 defect detail (FAIL)

Clean-room (fresh app, pristine sample): open Board Note, external `EXT-CLEAN-M5N2` -> sha `6bad10fc`, notice up. Clicked VERIFIED "Keep my version" at (1367,865) (Reload was at (1245,865)). Keep left editor unchanged (no reload; editor did NOT contain EXT-CLEAN). Typed ` KEEP-CLEAN-W4`, waited 6s+3s.
- Disk after: sha `0d5fe005`, `KEEP-CLEAN-W4` present (editor version written), `EXT-CLEAN-M5N2` GONE (external knowingly overwritten - correct for Keep).
- `Board Note.lock.json` audit: **0 entries** - no `external-overwrite-kept`.
- Code: `saveRawText` (livingDocsService.ts:3588) pushes the entry to `state.lock.audit`, writes the `.md` (3591), then calls `_bootstrapLock` (3598) - which returns early at 2927 for an already-bootstrapped doc (no missing binding/context), so `_lockStore.write` never runs. `saveRawText` has no direct lock write. The entry lives only in memory (`getLock` reads memory - which is why the unit test's `getLock(...).audit` assertion passes), never on disk. History reads the persisted lock, so it renders nothing after a live Keep.
- The `_persist` path DOES write the lock (approve/refresh), so the "next persist appends audit" unit test passes there - but the LIVE typing path (`saveRawText`) is the one a user hits, and it does not persist the audit with the write.
- Flush nuance (measured): touching a bound source (metrics.csv) forced a Board Note reconcile -> `_persist` -> the in-memory entry DID reach disk (`['external-overwrite-kept']`, count 1, correct newText), and re-trigger on a fresh external edit worked. So the entry is not permanently lost - but it is not persisted atomically with the live Keep save. A quit or editor reload in the window between the Keep and the next source-driven persist loses it, and History renders nothing until then.

## F4 defect detail (FAIL live / unit-only pass)

- Reload-from-disk sub-claim HOLDS: after a blocked save + Reload, editor showed `EXT-F4-DISCARD-P2Q8` and the typed `F4-UNSAVED-TYPING-R7` was discarded.
- Discard warning: 3/3 live attempts (external edit then immediate type). Every time the visible notice was the watcher preamble ("was changed outside Abstract"), `hasDiscard=false`. The OS watcher fires within ~1s of the shell append and raises the notice with `unsavedRaw=false` (no typing yet); `noticeUp` dedup then blocks the typing's blocked-save prompt from adding the discard line. So a user who has typed unsaved prose and reloads is NOT warned it will be discarded - the exact protection F4 claims. The unit test `writeExternalNoWatcher` sidesteps the watcher so the blocked save is first to prompt - a path the live app cannot reach.

## F6 measurements (PASS)

- `npm run transpile-client` fresh. `./scripts/test.sh --grep "livingDoc"` -> 369 passing/0. `--grep "LivingDocs"` -> 8/0. `--grep "bind-link format"` -> 83/0.
- `npm run typecheck-client` clean. `npm run valid-layers-check` clean. `./scripts/check-seams.sh` OK.
- `git diff --name-only origin/main...HEAD`: historyRender.ts, livingDocsService.ts, livingDocLedger.ts, livingDocsModel.ts, livingDocsService.test.ts - all under `src/vs/workbench/contrib/livingDocs/`. 0 core. (Note: the round-2 comment says "the two livingDocs files"; the diff actually touches 5 files, all contrib.)
