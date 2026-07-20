# Plan 42 slice L4 - Quiet shell on entry (issue #200) - FIX-ROUND

**Outcome: both blocking defects fixed and re-verified (static + live).** **Branch:** `light-path/l4-quiet-shell` - **Base:** `origin/main` (rebased; L1 #202, L2 #205, L3 #206) - **Date:** 2026-07-20 - **Worktree:** `/Users/tommy/Sites/abstract-lp-l4`

The prescribed fixes were implemented exactly, nothing more. The pure `decideReviewRailOpenOnEntry` is UNCHANGED (the defect was in the recording layer, not the decision). The trust grammar is untouched: a pending review still force-opens the rail over a stored `collapsed`.

## What changed

### Defect 1 - auto-expand mis-recorded as a manual choice (fixed)

Every reveal driven by `ILivingDocsService.focusPanel()` (the slim AI-door affordance, an AI invocation, the L2 held-prompt, a proposal arriving) is now classified as a PEEK, so it records no manual choice.

- `livingDocsService.ts` `focusPanel()` already fired `onDidRequestPanel` synchronously just before the async `openView()` un-hides the aux bar. The proposal-arrival reveal (`_runImpactPass`) previously called `openView(REVIEW_RAIL_VIEW_ID, false)` DIRECTLY (bypassing that event); it now routes through `focusPanel('review')` so it fires `onDidRequestPanel` too (behaviourally identical reveal, plus it selects the Review tab). This makes `onDidRequestPanel` the single, complete signal for "a peek is about to un-hide the rail".
- `RailVisibilityContribution` now listens to `onDidRequestPanel` and calls `_beginPeek()`: it sets the existing `_programmaticReviewToggle` guard and releases it on one deferred tick (via a `MutableDisposable`), because `openView`'s visibility change lands on a later microtask, not synchronously. So the peek's `onDidChangePartVisibility` is swallowed and no manual choice is written.

### Defect 2 - no UI path to collapse the rail in the calm shell (fixed)

- `reviewRailView.ts` renders a calm collapse control (a slim `codicon-chevron-right` button, `.ldp-collapse`) pinned to the right of the Chat/Review/History tab strip, styled to match the rail's muted tab language (grey, hover to darken, focus ring). Tooltip via `this.hoverService.setupDelayedHover` ("Collapse"), `aria-label` localized. Clicking it calls the new `ILivingDocsService.collapseReviewRail()`.
- `collapseReviewRail()` fires the new `onDidRequestCollapseReviewRail` event. `RailVisibilityContribution` listens and `_collapseReviewRailAsChoice()`: hides the aux-bar part programmatically (guarded) AND records `collapsed` as the manual choice. Storage ownership stays in the contribution (no cross-component storage-key access).

### Recording rule extracted + unit-tested

`common/railVisibility.ts` gains a pure `recordedChoiceForRailGesture(gesture)` (with a `RailGesture` enum: `Peek` | `CollapseControl`) that single-sources the classification: a peek records `undefined` (nothing); the collapse control records `collapsed`. The contribution's collapse handler uses it. A 7th quiet-shell unit test asserts this rule.

## Gesture -> recording table (after the fix)

| User gesture | Rail effect | Recorded choice |
| --- | --- | --- |
| Slim edge AI-door affordance (while collapsed) | opens Chat (peek) | **nothing** |
| AI invocation / chat send / L2 held-prompt (`focusPanel`) | reveals rail (peek) | **nothing** |
| Proposal arrives (`focusPanel('review')`) | reveals rail (peek) | **nothing** |
| Calm collapse control (rail header chevron) | collapses rail | **`collapsed`** |

After the fix, NO UI gesture records `open`. This is intentional and correct per the symmetric rule: precedence still honours a stored `collapsed`, and the has-something-to-say default (chat history / pending review) covers every "the rail opens on its own" case, so an `open` recorder is not needed. Any residual native hide/show gesture still records through `_onPartVisibilityChange` as a safety net.

## Static checks (Node 24, in the worktree)

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean |
| `./scripts/test.sh --grep "quiet-shell"` | 7 passing (6 unchanged + 1 new recording-rule test) |
| `./scripts/test.sh --grep "livingDocs"` | 147 passing, 0 failing |
| `./scripts/test.sh --grep "LivingDocsService"` | 141 passing, 1 failing - ONLY the pre-existing `a fan-out with the model down...` (#203, fixed on main by #207); allowed |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |

## Live E2E (fresh EMPTY seed profile, `TMPDIR=/tmp`, session `lp-l4f`, app-owned 8090 broker with `LWD_BACKEND=openrouter`)

Webview/DOM driven via raw CDP mouse events. All screenshots under `docs/qa/2026-07-20-light-path/04-l4/fix-round/`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| cold open on a plain doc | **PASS** - aux width 0 (`display:none`), sidebar 252px, slim affordance present | `f-a-cold-open-quiet.png` |
| (defect 1 regression) click edge affordance -> chat opens; profile DB has NO `reviewRailManualChoice` key at all (peek recorded nothing) | **PASS** - aux 282, Chat active, affordance removed, collapse control present; DB read confirmed no `reviewRailManualChoice` | `f-b-affordance-opened-chat.png` |
| (defect 1 regression) RELAUNCH same profile | **PASS** - rail COLLAPSED again (aux 0, `display:none`, affordance back). Before the fix this came up expanded. | `f-c-relaunch-still-quiet.png` |
| (defect 2) new collapse control while rail open | **PASS** - control renders in the tab strip (chevron, matching tab language); clicking it collapses the rail (aux 0) and writes `livingDocs.reviewRailManualChoice=collapsed` (DB read confirmed) | `f-d-rail-open-collapse-control.png`, `f-e-collapsed-via-control.png` |
| (defect 2) RELAUNCH after collapse-control | **PASS** - stays collapsed on the plain doc (aux 0) | `f-f-relaunch-collapsed-persists.png` |
| (honours stored choice) cross Home->Editor with stored `collapsed`, no pending | **PASS** - stays collapsed (aux 0) | (inline) |
| (trust grammar) live send -> pending proposal (Review badge 1); cross Home->Editor with stored `collapsed` | **PASS** - rail FORCE-OPENS (aux 374, `display:block`, Review1 badge), overriding the stored collapse | `f-g-trust-grammar-force-open.png` |
| (no regression) one-click affordance opens chat with composer ready | **PASS** - composer textarea present + focusable, "Ask about this document..." placeholder | `f-d` (composer visible) |

## Constraints honoured

- Zero core patches; all changes in `src/vs/workbench/contrib/livingDocs/`. The collapse control's CSS lives in the rail's own inline stylesheet (the tab strip is styled there, not in `studio.css`), so `studio.css` was NOT touched this round.
- Trust grammar untouched: pending-review force-open still overrides a stored `collapsed` (live-verified above + unit-tested).
- Tabs; `nls.localize` double-quoted strings ("Collapse"); `IHoverService` for the tooltip; disposables registered (the collapse listener/hover live in `_renderDisposables`; the peek guard in a `MutableDisposable`); no co-author lines.

## Cleanup

All launched Code OSS instances killed, playwright session `lp-l4f` closed, the app-owned 8090 broker died with the app, temp runDir + seed + folder removed.
