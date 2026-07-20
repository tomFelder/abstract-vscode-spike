# Plan 42 L5 - Frictionless human edits: adversarial validation

**Verdict: PASS** (with 2 advisory notes, 0 blocking defects)

**Issue:** [#201](https://github.com/tomFelder/abstract-vscode-spike/issues/201) - Plan: docs/plans/42-light-path-loop.md section 4 (L5) + section 5 (constraints)
**Branch:** `light-path/l5-frictionless` - HEAD `af33b78e7e8c830b19548290f369b644c70fab23`
**Merge-base with origin/main:** `6d849da673385281bd2d70f2d057c13e8de62e5c`
**Validated:** 2026-07-20, fresh empty seed profile under /tmp, session `lp-l5v`, workspace = /tmp copy of docs, no broker used, other agents' processes untouched.

## Verdict summary

The slice is genuinely done. The single code change (remove the sticky rename success/Undo toast + its dead `_undoRename` helper) is surgical, confined to livingDocs, and does exactly what the audit table claims. The 19-row audit is honest and its dispositions hold. Live E2E confirms zero ceremony on the plain-editing path (typing, saving, renaming, closing) and that error paths still speak up truthfully. Trust grammar and the delete safety net are untouched in the diff. No privacy weakening. No core patches.

## 1. Static checks (re-run independently in the worktree)

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean, 0 errors |
| `./scripts/test.sh --grep "livingDocs"` | **147 passing, 0 failing** |
| `./scripts/test.sh --grep "LivingDocsService"` | **143 passing, 1 failing** - the failure is exactly the allowed pre-existing `a fan-out with the model down...` (stale-asserted on this branch, fixed on main by #207). My independent read of the failure confirms it is unrelated to L5 (it asserts on model-down fan-out messaging, no rename/toast involvement). Both new rename tests pass. |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |

## 2. Constraints (section 5) - all met

- **Diff confined to `src/vs/workbench/contrib/livingDocs/`**: verified - the only src files touched are `livingDocsService.ts` (renameFile + `_undoRename` removal) and `treeRailView.ts` (comment only). Zero files changed outside livingDocs.
- **Zero core patches**: confirmed (check-seams OK, no ledger change).
- **Tabs, no space-indentation** in changed code lines: confirmed.
- **No co-author lines** in either commit: confirmed.
- **No dead code left**: `_undoRename` fully removed - `grep -rn "_undoRename"` returns 0 hits. `toAction` still used (delete Restore/Undo toast, tidy Undo, onboarding). `Severity` still used (6 sites). No orphaned imports.

## 3. Independent audit-table diff (adversarial re-grep)

I re-grepped every `INotificationService`/`IDialogService`/`IQuickInputService`/`IHoverService` surface in `src/vs/workbench/contrib/livingDocs/browser/` and mapped each to the 19-row table.

Every dialog / quick-input surface maps to a row:
- `treeRailView.ts:438/448` -> rows 8/9 (Use as source), `:458` -> row 4 (rename input), `:475` -> row 5 (delete confirm)
- `screenEditor.ts:449` -> row 10 (Tidy confirm), `:1157` -> row 15 (bulk-approve, trust)
- `reviewRailView.ts:483` -> row 15 (bulk-approve), `:604` -> row 16 (Name this version), `:628/636` -> row 17 (this-was-wrong report)
- `livingDocEditor.ts:134` -> row 15 (bulk-approve)

**One surface is NOT its own row in the table (advisory A1):** `reviewRailView.ts:611` - the **"Restore version" confirm dialog** ("Restore X? Replaces the current body. Pending changes will be rejected."). Fired by clicking Restore on a History version. Its correct disposition is **KEEP** (it is a deliberate History/version action, part of the version/trust grammar, destructive-adjacent, and not reachable by plain typing/saving/renaming/closing) - so it does not change the verdict. But the table claims to list "every prompt/toast/dialog surface" and this one is missing. It should be added as a KEEP row for completeness. Not blocking.

All `_notify.*` sites cluster into rows 1-3 (rename), 5-7 (delete), 10-13 (tidy/create/import/publish/export), 14 (model-paused), plus the onboarding hand-off toast at `livingDocsService.ts:3687` (fires on `first-approve-sample` - the agent-edit approve path in the walkthrough, not plain editing) and the fan-out relink info at `:3386` (source/agent path). Both of the latter are agent/onboarding-path, correctly outside the plain-editing trigger set; they are not on the typing/saving/renaming/closing path, so their omission from the editing-surface table is defensible.

**Dispositions judged against the slice text:** the only plain-editing triggers are typing/saving/renaming/closing. Rename (rows 1-4) is the only one that carried ceremony, and row 1 is correctly REMOVED. Delete (rows 5-7) is destructive and correctly outside the trigger set (KEPT). Trust grammar (rows 15-17) is untouchable and untouched. All KEPT rows survive scrutiny.

## 4. Privacy / consent (independently verified)

- **#204 killed the analytics first-open consent modal**: confirmed - `gh pr view 204` shows MERGED 2026-07-20 ("remove the first-run consent modal"), and it is in this branch's merge-base. `AnalyticsConsentContribution` (`livingDocs.contribution.ts:775`) shows **no dialog** on cold open; it only mirrors the Settings toggle and captures `app_opened`.
- **Capture still consent-gated**: confirmed - the contribution's comment and `_adoptSetting` drive `setConsent`, and capture is gated by the service (`isEnabled`/`hasChosen`). Consent defaults on (per #204) and is revocable in Settings + the data-flow row. **L5 makes no analytics change**, so privacy is not weakened by this slice.

## 5. Live E2E (fresh empty profile, session `lp-l5v`, webview driven via raw CDP `Input.dispatch*`)

| AC / edge case | Live result | Evidence |
| --- | --- | --- |
| Cold open lands editor-first | Editor + Files rail, doc open, **0 toasts / 0 dialogs / 0 centre items**, 1 webview iframe | `v1-cold-open.png` |
| Freewriting into a plain doc (continuous typing) | Text landed in the editor; **0 toasts / 0 dialogs / 0 centre items**; Review rail "No changes waiting" (human edits create no proposal) | `v2-freewriting.png` |
| Save (Cmd+S) | **0 toasts / 0 dialogs** | (polled) |
| Rename via Files-rail context menu | File renamed **silently on disk** (`01-architecture.md` -> new name), **0 toasts / 0 dialogs** - the old sticky Undo toast is gone | (disk-verified) |
| Rename onto an existing filename (clash) | **Exactly 1 error toast** ("Cannot rename to ... a file with that name already exists."), **0 dialogs**, source file NOT moved, target NOT clobbered, no crash | `v3-rename-clash-one-error.png` |
| Rename to the same name (no-op) | Silent no-op: **0 toasts / 0 dialogs / 0 errors**, file stays put | (polled) |
| Rapid rename twice in a row | Both silent (**0 toasts each**), no crash, final disk state correct (intermediate name cleanly superseded) | (disk-verified) |
| Delete confirm | Confirm dialog verified in source (`treeRailView.ts:475`, unconditional) and unchanged by the diff; file NOT deleted without confirmation in the live run. Live dialog capture blocked by a CDP harness limitation (menu-item click on the dialog trigger did not land) - relied on source + disk evidence. | (source + disk) |
| End-of-session notification area | **Definitively empty**: no `.notifications-center` container exists in the DOM (VS Code creates it lazily only when a notification arrives), 0 toasts, 0 items | `v5-session-end-clean.png` |
| Living-doc History accumulates silently | No `.lock.json` sidecars in the plain-doc workspace (correct per L3); History/snapshot/Restore code is untouched by the diff and covered by the passing suite (incl. `History rehydrates from the on-disk lock audit`). Implementer's unit test proves rename moves file+lock together with `toasts: []`. | (tests + diff) |
| Trust grammar unchanged | Diff touches only renameFile + `_undoRename` removal + a treeRailView comment; bulk-approve confirm, Review rail, Name-this-version, this-was-wrong report all untouched in code | (diff) |
| Dirty/unsaved close | The livingDocs editor is a webview surface (no Monaco text-editor tab / dirty dot); it autosaves silently, so no core hot-exit dirty-close prompt fires on the editing path. Core behaviour, out of scope - observed, not a defect. | (observed) |

## 6. Advisory notes (non-blocking)

**A1 - audit table is missing one KEEP row (advisory).** The "Restore version" confirm dialog (`reviewRailView.ts:611`) is a dialog surface not listed in the 19-row table, which claims completeness ("every prompt/toast/dialog surface"). Disposition would be KEEP (deliberate version action, not a plain-editing trigger). Recommend adding it as a KEEP row so the audit is exhaustive. Does not affect behaviour.

**A2 - loss of the rename Undo affordance (advisory, anticipated by the prompt).** The implementer removed the sticky "Renamed / Undo" toast and the `_undoRename` helper, so there is no longer a one-click undo for a rename. Judged against the slice: this is acceptable removal of ceremony. The slice text explicitly targets toasts on the editing path, rename is trivially reversible (rename again), and no standard editor-tab Undo covers a filesystem rename anyway (this was a bespoke affordance, not a core capability). The safety net is correctly retained where it matters - delete keeps its Undo toast because delete is destructive. This is the right trade; flagged only for the record.

## 7. Cleanup confirmation

- My Code OSS instance (pid 25777, ports 53281-53284) killed; playwright session `lp-l5v` daemon closed.
- Temp profile `/tmp/code-oss-dev/20260720-150303-25741`, `/tmp/lp-l5v-ws`, and all `/tmp/lp-l5v-*` helper scripts removed.
- The concurrent L4 validator's instance (pid 25792, connected to the broker on 8090) was **not** touched. Broker on 8090 not touched.
- Disk at 30% - no pressure.

**Latest commit SHA:** `af33b78e7e8c830b19548290f369b644c70fab23`
