# Plan 42 slice L4 - Quiet shell on entry (issue #200) - VALIDATOR findings

**Verdict: FAIL (one blocking defect).** **Branch:** `light-path/l4-quiet-shell` @ `f07d66ef92e` - **Base:** `origin/main` (rebased; includes L1 #202, L2 #205, L3 #206) - **Date:** 2026-07-20 - **Worktree:** `/Users/tommy/Sites/abstract-lp-l4`

The pure decision function, the storage/persistence machinery, the slim affordance, the force-open of pending reviews, and the trust grammar are all correct and live-verified. But the affordance/AI-open path is NOT guarded by `_programmaticReviewToggle`, so opening the rail through the AI door records a persistent manual `open` choice - and because the calm shell has no user-facing way to collapse the rail, a single click on the AI door permanently defeats the quiet shell for every future entry and restart. That contradicts AC clause 1 ("cold open on a plain doc shows editor + left rail only") after first AI use. Blocking.

## Static checks (all re-run independently, Node 24, in the worktree)

| Check | Result |
| --- | --- |
| one-shot `npm run compile` | 0 errors |
| `npm run typecheck-client` | clean |
| `./scripts/test.sh --grep "quiet-shell"` | 6 passing (the new L4 decision suite) |
| `./scripts/test.sh --grep "livingDocs"` | 147 passing, 0 failing |
| `./scripts/test.sh --grep "LivingDocsService"` | 141 passing, 1 failing - ONLY the pre-existing `a fan-out with the model down...` (#203); allowed |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |

## Scope adjudication - `styleOverrides/browser/media/studio.css`

**Not a core patch. Not blocking. Additive, fork-owned.** `git log --follow --diff-filter=A` on the file shows it was first ADDED by Tom on 20 Jun 2026 in commit `8c8327525a1` ("livingDocs: branded header, chrome removal, tabbed right panel (Item C)"). It is a fork-created gated module, not upstream VS Code code, and it is already recorded in `docs/plans/03-merge-tax-ledger.md` row **C** ("Hide residual IDE chrome ... styleOverrides-CSS ... New gated module; no core patch"). The L4 diff only appends a `.style-override .part.editor > .lwd-rail-affordance` block (gated on the fork's own `.style-override` class), so it stays within the fork-owned CSS tier. No merge-tax ledger entry required.

## AC, live (fresh EMPTY seed profile `/tmp/lp-l4v-seed`, folder `/tmp/lp-l4v-folder`, `TMPDIR=/tmp`, session `lp-l4v`, app-owned 8090 broker)

| AC clause | Live result |
| --- | --- |
| cold open on a plain doc shows editor + left rail only | **PASS** - aux bar width 0 (`display:none`), sidebar 252px, `.lwd-rail-affordance` present (v-a-cold-open.png) |
| invoking chat expands the rail with the composer focused | **PASS (focus not cross-OOPIF-verifiable)** - one affordance click -> aux width 374, Chat tab active, affordance removed; composer focus could not be read across the webview OOPIF boundary but the composer is visibly ready (v-b) |
| pending reviews force it open | **PASS** - with a proposal pending, crossing Home->doc re-opened the rail (aux 374, Review badge 1); the proposal is never hidden (v-c/v-d) |
| manual collapse/expand persists across restart | **PASS at the storage layer** - `livingDocs.reviewRailManualChoice` = `collapsed`/`open` survives a restart clone; expand came back at the remembered ~282px, NOT re-seeded to 392px (v-e1, v-e2) |

## Live-vs-inspection

| Behaviour | How established |
| --- | --- |
| quiet shell on cold entry | LIVE (v-a) + inspection (aux width 0) |
| affordance one-click opens Chat | LIVE (v-b) |
| live broker proposal + trust grammar (badge, inline diff, Approve) | LIVE (v-c, v-c2) - Approve applied the edit and the doc saved |
| pending review force-open on entry | LIVE via surface crossing (v-d); the "relaunch with pending review" leg is inspection-only (proposals are in-memory, not persisted - see note) |
| manual collapse persists | STORAGE-seeded + LIVE restart (v-e1) - a genuine UI collapse was NOT reproducible (no collapse control exists; see defect 2) |
| manual expand persists at remembered width | LIVE (v-e2) - 282px, #173 machinery intact |
| pure resize does not record a choice | LIVE - stored `open` unchanged across a sash drag (v-h) |
| surface crossing does not record a choice | LIVE - stored `open` unchanged across 4x rapid Home<->Editor (v-i); `_programmaticReviewToggle` guard holds for the `_sync()` toggles |
| left rail unaffected | LIVE - Workspace Files rail opens every entry, 252px |
| decision precedence (5 rows) | UNIT-tested (railVisibility.test.ts, 6/6) |

## Defects

### 1. BLOCKING - the AI-door open path records a persistent manual `open`, permanently defeating the quiet shell

**Observation.** After a single click on the slim affordance, `state.vscdb` holds `livingDocs.reviewRailManualChoice = open` (read directly from the profile `state.vscdb`). On any later cold entry, `_reviewRailManualChoice()` returns `Open`, so `decideReviewRailOpenOnEntry` returns true (precedence case 2, manual choice) even for a plain doc with no pending review and no chat history - so the rail is expanded, not quiet.

**Repro.** Fresh profile -> cold open (quiet, correct) -> click the affordance once -> the rail opens AND `reviewRailManualChoice=open` is written -> restart (or open any other plain doc): the rail now comes up expanded. AC clause 1 ("cold open on a plain doc shows editor + left rail only") is broken for the entire rest of the profile's life.

**Suspected cause.** `RailVisibilityContribution._onPartVisibilityChange` (`livingDocs.contribution.ts:670`) records a manual choice for ANY non-programmatic `AUXILIARYBAR_PART` visibility change while on a doc surface. But the AI-open paths - the affordance's `ILivingDocsService.focusPanel('chat')`, a chat send, the L2 held-prompt, and a proposal arriving - all reveal the rail via `focusPanel` -> `IViewsService.openView(REVIEW_RAIL_VIEW_ID)` (`livingDocsService.ts` `focusPanel`), which un-hides the part WITHOUT setting `_programmaticReviewToggle`. So an *automatic* expand is mis-recorded as a *deliberate user* "open". The plan text is explicit that auto-expand and the manual choice are distinct ("It expands automatically on first AI invocation ... and **thereafter** respects the user's manual choice"); recording the auto-expand as the choice conflates the two.

**Fix direction (prescribed).** Wrap the auto-expand reveal in the same `_programmaticReviewToggle` guard used by `_setReviewRailHidden`, OR only persist a manual choice when the toggle originates from a genuine user gesture (not from `focusPanel`/`openView`). The affordance click should be a lightweight *peek*, not a permanent decision. After the fix: click the affordance -> rail opens -> restart a plain doc -> rail is quiet again (unless the user made a real manual toggle or a review is pending). Add a decision/integration test for "affordance/AI open does not record a manual choice".

### 2. BLOCKING (interacts with #1) - no user-facing way to collapse the review rail in the calm shell

**Observation.** Once the rail is open, there is no discoverable UI path back to the quiet shell: the review rail header has no close/collapse/hide control, the tab strip has no context menu, and `toggleAuxiliaryBar` (Cmd+Alt+B) is in `NEUTRALISED_IDE_CHORDS` (`livingDocs.contribution.ts:232-243`). The stock "Hide Secondary Side Bar" action exists in the DOM but is not laid out (0x0 rect).

**Repro.** Open the rail (affordance or AI). Try to collapse it via any visible control or the usual chord - none work. The validator had to seed `collapsed` into storage to exercise the persistence path at all.

**Consequence.** The AC promises "manual collapse ... persists across restart", but a user can never *produce* a manual collapse through the UI. Combined with defect 1 (open is recorded and sticky), the quiet shell is a strictly one-way door: reachable only until first AI use, never restorable. This defeats the slice's core promise.

**Fix direction.** Provide a calm, discoverable collapse affordance on the open review rail (e.g. a small chevron/close in the rail header) whose toggle IS recorded as a manual `collapsed`. This is the natural counterpart to the open-affordance and closes the loop the AC assumes.

### 3. ADVISORY - "relaunch with a pending review" is validated in-session only

Pending proposals live in `LivingDocsService._pending` in memory and are not persisted, so a literal cold relaunch has nothing to re-derive (the implementer notes this). Force-open was therefore validated in-session (a present pending review forces the rail open on every entry and overrides a stored collapse; while collapsed the proposal stays visible in the editor). This matches the slice remit; flagging that the AC's "relaunch" wording is not literally exercisable for pending reviews.

### 4. ADVISORY - transient "Model unavailable" hint flash

During a surface crossing, a momentary "Model unavailable - Open Model access" hint flashed on the composer even though the broker `/healthz` was `ok:true`; it self-cleared. Looks like a probe-timing blip, not L4's concern. Worth a glance from whoever owns the model-status probe (L2 territory).

## Constraints

- Trust grammar: **untouched** - inline diff, MEANING CHANGE chip, Approve/Reject, Review badge all live-verified; L4 only changes the DEFAULT on entry and never weakens force-open.
- Strings: `localize("livingDocs.openAiRail", "Open Chat")` - localized, title-case.
- Tabs: consistent (no space-indented new TS lines).
- Disposables: both contributions register their `onDidChangePartVisibility`/`onDidActiveEditorChange` listeners in the constructor via `this._register` (singletons); the affordance element/listeners live in a `MutableDisposable<DisposableStore>` cleared on hide - no leak.
- No co-author lines in the commit.
- #173 width machinery: intact - sidebar seeds once (264) on its own key, review width seeds once (392) on a separate key the first time the rail opens, neither re-pins a dragged width (verified live: 282px survived).

## Cleanup

All 5 launched Code OSS instances killed, playwright session `lp-l4v` closed, no strays from this repo, no broker started by the validator (8090 was app-owned and died with the app), all runDirs + temp scripts/db copies removed. `/tmp/lp-l4v-folder` and `/tmp/lp-l4v-seed` preserved.

## Latest commit SHA on the branch

`f07d66ef92ef793b16bf3f588ff4c803ce8a7fec`
