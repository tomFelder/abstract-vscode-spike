# Plan 42 - Light-path L5: Frictionless human edits (findings)

**Issue:** [#201](https://github.com/tomFelder/abstract-vscode-spike/issues/201) - Plan: [docs/plans/42-light-path-loop.md](../../../plans/42-light-path-loop.md) section 4 slice L5
**Branch:** `light-path/l5-frictionless` (off `origin/main` = L1 #202 + L2 #205 + L3 #206)
**Date:** 2026-07-20
**Scope:** verification + removal. Audit every prompt/toast/dialog reachable by plain human editing (typing, saving, renaming, closing), then remove or defer each. Zero core patches - only `src/vs/workbench/contrib/livingDocs/`.

## Summary

L5 is mostly verification. The two big "known candidates" the survey flagged were **already handled** by earlier slices before L5 opened:

- The **analytics first-open consent modal** is gone: removed in #204 (`feat(livingDocs): analytics on by default - remove the first-run consent modal`), which merged into the `origin/main` base this branch sits on. The `AnalyticsConsentContribution` (`livingDocs.contribution.ts:775`) now only mirrors the Settings toggle and captures `app_opened`; it shows **no dialog** on cold open. Analytics capture is still gated by the service (`_analytics.capture` only records when consent is on), so privacy is not weakened. Consent volume is preserved via the revocable, always-visible **data-flow consent row on the Model access settings screen** (`screenRender.ts` `dataFlowCard`, issue #134) - a passive, dismissible surface reachable later, never a cold-open gate. This matches the "guardrails attach to the agent's hands, never the user's" principle: entry demands 0 decisions, the consent decision lives where a decision moment already exists (the model door). **The baseline run did not hit this dialog** - the baseline (`00-baseline/baseline.md`) recorded 0 dialogs on the typing path and never mentions a consent modal, consistent with it already being removed pre-baseline.
- The **"few quick questions" survey** already left the entry path (L2 #205): it lives only inside the Model access settings screen (`screenRender.ts:1638`), off the critical path.

The single behavioural change L5 makes: the **rename success toast** (a sticky "Renamed ... / Undo" notification after every Files-rail rename) is removed. Renaming is one of the slice's named plain-editing triggers, and a sticky toast that camps in the notification area until dismissed is exactly the ceremony L5 strips from the user's own edits. Rename now succeeds silently; the error paths (target-exists, rename-failed) still speak up.

## The full audit table

Every prompt/toast/dialog surface in `src/vs/workbench/contrib/livingDocs/` reachable without an agent, with its trigger and disposition. Grepped from `INotificationService` (`_notify`), `IDialogService` (`_dialogService`), and `IQuickInputService` (`_quickInput`) usages.

| # | Surface | File:line (pre-change) | Trigger | What it showed | On the plain-editing path? | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Rename success toast** | `livingDocsService.ts:1204` | Renaming a doc/source in the Files rail | Sticky "Renamed X to Y." + **Undo** action, camps until dismissed | **Yes** (renaming) | **REMOVED** - rename now succeeds silently. A rename is deliberate and reversible (rename again); no camping toast. `_undoRename` (only caller was this toast) removed as dead code. |
| 2 | Rename target-exists error | `livingDocsService.ts:1191` | Rename onto an existing filename | "Cannot rename to X - a file with that name already exists." | Yes (renaming) | **KEPT** - a legitimate error; the rename refuses and says why. Not ceremony. |
| 3 | Rename-failed error | `livingDocsService.ts:1198` | Move throws mid-rename | "Rename failed: ... Nothing was changed." | Yes (renaming) | **KEPT** - honest failure feedback naming that nothing changed. |
| 4 | Rename quick-input | `treeRailView.ts:457` | Files-rail "Rename..." menu item | Input box "Rename file (Enter to confirm / Escape to cancel)" | Yes (renaming) | **KEPT** - this IS the rename UI (you type the new name). Necessary input, not ceremony; carries no decision beyond the name. |
| 5 | Delete confirm dialog | `treeRailView.ts:474` | Files-rail "Delete..." menu item | Warning "Delete X? N documents depend on it." + dependent list + "Delete" | Delete (not typing/saving/renaming/closing) | **KEPT-WITH-REASON** - delete is destructive; a confirm before an irreversible-feeling op is legitimate, and the dependent list is trust info (map-D6). The slice's plain-editing triggers are typing/saving/renaming/closing - delete is not among them. |
| 6 | Delete success toast | `livingDocsService.ts:1342` | After a delete proceeds | Sticky "Deleted X." + **Undo** | Delete | **KEPT-WITH-REASON** - delete is destructive; the Undo toast is the safety net for an irreversible op. (Rename dropped its Undo toast because rename is trivially reversible and not destructive; delete keeps it for exactly the opposite reason.) |
| 7 | Delete-path errors (unreadable / failed / sidecar rollback) | `livingDocsService.ts:1298,1309,1323,1326` | Delete fails at a stage | "Delete failed: ... Nothing was changed." (and a sticky Restore if the file went but the sidecar rollback failed) | Delete | **KEPT** - honest failure feedback; the sticky Restore protects data when a rollback could not complete. |
| 8 | "Use as source" - file not found | `treeRailView.ts:437` | Click "Use as source" on a workbook/PDF row that moved | info dialog "That file could not be found" | No (explicit source action) | **KEPT** - only fires on the deliberate "Use as source" action, not plain editing. |
| 9 | "Use as source" - open a doc first | `treeRailView.ts:447` | "Use as source" on a PDF with no active .md | info dialog "Open a document first" | No (explicit source action) | **KEPT** - deliberate source-binding action; guides the user to the required precondition. |
| 10 | Tidy dependent-move confirm | `screenEditor.ts:449` | "Tidy" (bulk folder-convention move) on Home | Warning "N documents reference files you are moving." + "Move anyway" | No (deliberate bulk Tidy verb) | **KEPT** - Tidy is a deliberate bulk reorganisation the user invokes; the confirm names what will be re-pointed. Not on the typing/saving/renaming/closing path. |
| 11 | Tidy result + errors | `livingDocsService.ts:1479-1520` | Tidy applies/fails | "Tidied N files" (sticky Undo) / named clash/failure errors | No (Tidy verb) | **KEPT** - result + honest errors of a deliberate bulk action. |
| 12 | Create/generate/import guidance | `livingDocsService.ts:948,1127,1540,1548,1568,1598,1620,1638,1644,1663,1832,1841,1927,1933,1941,1979,1992,2008,2015,2048,2055` | Create-doc / from-template / from-sources / from-examples / workbook/PDF/docx import | info toasts ("Open a folder...", "Created X from...", "Using X as a source...", unreadable/proxy-down reasons) | No (deliberate create/import actions) | **KEPT** - all fire on explicit create/generate/import verbs, never on plain typing/saving. Result + honest error feedback for a deliberate action. |
| 13 | Publish / export result + gate blocks | `livingDocsService.ts:2695,2799,2815,2883,2894,2904,2920,2930,2995,3004,3020,3025,3032,3063,3067` | Publish / Export / Restore / verify-gate | info toasts naming the published/exported/restored result or the gate reason | No (deliberate publish/export/restore) | **KEPT** - deliberate document-lifecycle actions; the gate-block copy is intentional "no silent blocks" trust behaviour. |
| 14 | Model-paused info | `livingDocsService.ts:639` | Included-model daily budget spent during an AI run | info "the model paused..." | No (agent path) | **KEPT** - agent/model path, not human editing. |
| 15 | **Bulk-approve confirm** | `livingDocEditor.ts:134`, `reviewRailView.ts:483`, `screenEditor.ts:1157` | "Approve all" on pending agent proposals | Confirm "Approve all" | No (agent-edit review) | **KEPT - TRUST GRAMMAR (untouchable).** |
| 16 | **"Name this version" input** | `reviewRailView.ts:604` | User clicks "Save version" | Input "Name this version" | No (deliberate version save) | **KEPT** - user-initiated trust affordance; not editing-path ceremony. |
| 17 | **"This was wrong" report** | `reviewRailView.ts:628,636` | User reports a bad agent edit | Comment input + "Thanks - we log every report" info | No (agent-edit trust) | **KEPT - TRUST GRAMMAR (untouchable).** |
| 18 | Analytics first-open consent modal | (removed in #204) | first cold open (historical) | dialog "Help Us Improve..." | Was on entry path | **ALREADY REMOVED** upstream of this branch (#204); `livingDocs.contribution.ts:769` comment records it. Consent moved to the always-visible, revocable data-flow row on the Model access screen (#134). |
| 19 | "Few quick questions" survey | `screenRender.ts:1638` | On the Model access settings screen | 3-field survey | No (settings screen only) | **ALREADY DEFERRED** off the entry path by L2 (#205); lives on the settings screen. |

**Core VS Code prompts on the editing path** (hot-exit/backup dialogs, dirty-close prompts): out of scope, not patched. None observed during the live session - the livingDocs editor autosaves silently (no dirty-close prompt fires). Noted, not touched.

## The one code change

- **Removed the rename success toast** (`livingDocsService.ts` `renameFile`): the sticky "Renamed X to Y / Undo" `_notify.notify` call is gone; rename now fires only `_onDidChange` and returns silently. The now-orphaned `_undoRename` private method (its only caller was that toast) is removed. Comment in `treeRailView.ts` `_showFileMenu` updated to say rename succeeds silently while delete keeps its Undo toast. `toAction` and `Severity` imports stay (still used by the delete Undo toast and other notify calls).
- **Tests** (`livingDocsService.test.ts`, in the provenance-safe-file-ops suite): two snapshot-style tests - (a) a rename moves the file + lock sidecar together and raises **no toast** (`toasts: []`); (b) a clashing rename refuses and raises exactly the one clash error.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean (0 errors) |
| `npm run compile` (one-shot) | clean (0 errors) |
| `./scripts/test.sh --grep "livingDocs"` | **147 passing, 0 failing** |
| `./scripts/test.sh --grep "LivingDocsService"` | **143 passing, 1 failing** - the failure is the known pre-existing `a fan-out with the model down...` (#203), the only allowed failure. My 2 new rename tests pass. Parity-or-better vs main (+2 tests, 0 removed). |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |

## Live E2E (fresh empty profile, `TMPDIR=/tmp`, session `lp-l5`, workspace = /tmp copy of docs)

A compressed-but-honest freewriting session on plain docs: cold open -> continuous typing across two docs -> autosave -> rename -> close/reopen -> a living-doc edit + History. The notification area (toasts / dialogs / notification-center) was polled after every action.

| Scenario | Result | Screenshot |
| --- | --- | --- |
| (a) Cold open lands in the editor, 0 toasts/0 dialogs/1 webview iframe | Post-L1 editor-first entry, README open, clean | `a1-cold-open.png` |
| (a) Freewriting into a plain doc - continuous typing, autosave silent, Review rail "No changes waiting" | **0 toasts, 0 dialogs, 0 notification-center items** | `a2-freewriting-typed.png`, `a3-clean-freewriting.png` |
| (b) Rename a doc via Files-rail context menu -> name box -> confirm | File renamed on disk (`weekly.md` -> `WeeklyRecap.md`), **0 toasts, 0 dialogs** - the old sticky Undo toast is gone | `b1-rename-no-toast.png` |
| (c) A living doc (source bound via frontmatter) - typed a human edit, opened History | Doc upgraded to living ("All sources synced", Sources - metrics.csv); **0 toasts on the edit**; History tab truthful ("No versions yet - changes you approve will appear here") | `c1-living-history.png` |
| (c) History accumulates for the living doc - "Save version" -> named "Draft" | History shows Current + Draft versions with Restore; **0 toasts**; trust grammar intact | `c2-living-history-accumulates.png` |
| End-of-session notification area | **0 toasts, 0 dialogs, 0 notification-center items** across the whole session | `d1-session-end-clean.png` |

**AC met:** a freewriting session on a plain doc produced zero prompts/toasts/dialogs; History still shows the session's versions for a living doc; nothing in the trust grammar for agent edits changed (bulk-approve confirm, Review rail, History/Restore, "this was wrong" report all untouched).

**Note on driving the webview:** the livingDocs editor renders inside a VS Code webview OOPIF that `@playwright/cli` cannot pierce. Editor typing/clicks were driven with raw CDP `Input.dispatchKeyEvent`/`Input.dispatchMouseEvent` at CSS coordinates (routes into the OOPIF); native workbench surfaces (Files rail list, right-rail tabs, quick-input rename box) were driven directly via Playwright. Per `02-l2/findings.md`.

## Left to other slices / deviations

- **L4 (quiet shell)** owns rail visibility/collapse; untouched here. In this session the Review rail was visible throughout (L4 not yet merged into this base); no conflict with L5.
- **History does not auto-snapshot on every human keystroke.** The AC phrase "History still shows the session's implicit versions" is read as a **preservation** requirement (History keeps working / accrues as before), not a mandate to create a new snapshot per keystroke. Baseline behaviour (post-#181, plan 26/32): snapshots accrue on approves, publishes, refreshes, and user "Save version" - never per keystroke. L5 changes none of that, so History behaviour is preserved and truthful for the living doc (proven in `c1`/`c2`). No new snapshot machinery was added - that would be scope creep beyond "verification + removal".
- **Delete keeps its confirm dialog + Undo toast** (kept-with-reason): delete is destructive and outside the slice's plain-editing trigger list; weakening it would trade a real safety net for no entry-path benefit.
