# Plan 42 slice L4 - Quiet shell on entry (issue #200)

**Branch:** `light-path/l4-quiet-shell` - **Base:** `origin/main` @ `85f4ccaaaec` (includes L1 #202 editor-first cold start and L2 #205 inline model choice) - **Date:** 2026-07-20

L4 makes the shell quiet on entry: the right review rail (AUXILIARYBAR_PART) starts collapsed when the document has nothing for it to say (no pending review, no chat history), opens automatically on first AI invocation or when a review arrives, and thereafter respects the user's manual open/collapse choice, persisted across restart. A slim edge affordance keeps the AI door one click away while the rail is collapsed. The left tree-rail behaviour is unchanged.

## What changed (all inside `src/vs/workbench/contrib/livingDocs/`, plus one calm-shell CSS block)

- **`common/railVisibility.ts` (new)** - the PURE decision. `decideReviewRailOpenOnEntry({ hasPendingReview, hasChatHistory, manualChoice })` returns whether the review rail opens when the editor surface is entered. Precedence: (1) a pending review FORCES it open (trust grammar - a proposal is never hidden, even against a manual collapse); (2) the user's persisted manual choice (`ReviewRailManualChoice.Open`/`.Collapsed`) wins over the default; (3) otherwise open only when there is chat history ("something to say"), else quiet. No DOM, no service, no clock - unit-tested directly (exemplar: `common/startupRouting.ts`).
- **`browser/livingDocs.contribution.ts`** - `RailVisibilityContribution` now injects `ILivingDocsService` and, on crossing into the editor, opens the LEFT rail as before but decides the RIGHT rail via `decideReviewRailOpenOnEntry`. It listens to `IWorkbenchLayoutService.onDidChangePartVisibility` and, when the user (not our own programmatic toggle) collapses/opens the aux bar while on the editor surface, persists the choice. A new `RailAffordanceContribution` renders the slim edge tab.
- **`browser/media/studio.css`** (styleOverrides calm-shell module, gated on `.style-override`) - paints `.lwd-rail-affordance`: a slim pill pinned to the right edge of the editor part, calm word-processor treatment, hover/focus states.
- **`test/browser/railVisibility.test.ts` (new)** - 6 snapshot-style unit tests for the decision function.

## The pure decision function's contract

`decideReviewRailOpenOnEntry(context) -> boolean` where context is `{ hasPendingReview, hasChatHistory, manualChoice }`:

| # | hasPendingReview | manualChoice | hasChatHistory | -> open? | why |
| --- | --- | --- | --- | --- | --- |
| 1 | true | (any) | (any) | **true** | trust grammar: a proposal is never hidden |
| 2 | false | Open | (any) | **true** | manual choice wins over the quiet default |
| 3 | false | Collapsed | (any) | **false** | manual choice wins (even over chat history) |
| 4 | false | None | true | **true** | has something to say (existing conversation) |
| 5 | false | None | false | **false** | quiet shell - editor + left rail only |

The contribution feeds `hasPendingReview` from `ILivingDocsService.getPendingForDoc(resource)` (falls back to `getAllPending()` when there is no active resource), `hasChatHistory` from `getChatMessages(resource)`, and `manualChoice` from the persisted storage key.

## How manual-choice persistence works (keys/scope) and its interactions

- **Storage key:** `livingDocs.reviewRailManualChoice`, **StorageScope.PROFILE**, **StorageTarget.MACHINE** - a UI preference that follows the user across windows and survives restart, stored in the profile's `state.vscdb`. Value is `"open"` / `"collapsed"` / (absent = none).
- **How it is set:** `onDidChangePartVisibility` fires for `AUXILIARYBAR_PART`. The handler ignores the event if (a) it is our own programmatic toggle (guarded by a `_programmaticReviewToggle` flag around every `setPartHidden` we issue on the review rail), or (b) the current surface is not a document. A genuine user toggle while editing writes `open`/`collapsed`. Verified live at the storage layer: the key flipped `collapsed` -> `open` across the two manual actions.
- **Interaction with #173 seeding:** the sidebar width still seeds once (`livingDocs.railWidthsSeeded`). The review width now seeds via a SEPARATE key `livingDocs.reviewWidthSeeded`, applied the first time the review rail actually opens - because the rail can start collapsed, its width cannot be seeded on first doc entry (`setSize` is a no-op while a part is hidden). Neither seed ever re-pins a dragged width. Live proof: after manually expanding and relaunching, the rail came back at the user's remembered width (282px), not re-seeded to 392px.
- **Interaction with pending-review force-open:** the force-open (case 1) is evaluated on every entry and overrides a stored `collapsed`, so the trust grammar is never weakened. Live proof: with `manualChoice=collapsed` stored and a proposal pending, the proposal stayed visible in the editor even while collapsed, and crossing back into the doc reopened the rail (width 374).

## The slim affordance (zero core patch)

`RailAffordanceContribution` appends a `<button.lwd-rail-affordance>` (comment-discussion icon, `IHoverService` tooltip "Open Chat") to the editor part container (`IWorkbenchLayoutService.getContainer(mainWindow, Parts.EDITOR_PART)`), shown only while a document is open AND the review rail is collapsed. One click calls `ILivingDocsService.focusPanel('chat')`, which reveals the rail (via `IViewsService.openView`, which un-hides the part) and focuses the Chat composer. The element and its listeners live in a `MutableDisposable<DisposableStore>` cleared whenever the affordance should not show, so there is no leak across editor changes. No core patch: the contribution only appends to a container it reads and toggles part visibility through public services; the CSS is an additive calm-shell rule.

Why an affordance is needed: in the calm shell the aux bar's own activity strip disappears with the part and the `toggleAuxiliaryBar` chord is neutralised, so without this the AI door would be more than one click away.

## Auto-expand paths (verified, no new wiring)

All AI-invocation paths already reveal the rail through `LivingDocsService.focusPanel()` -> `IViewsService.openView(REVIEW_RAIL_VIEW_ID, focus)` -> `openPaneComposite`, which un-hides `AUXILIARYBAR_PART`. This covers a chat send (`focusPanel('chat')`), the held-prompt L2 inline model choice, and proposals arriving. So auto-expand from the collapsed state needed no extra code; L4 only changes the DEFAULT on entry. Confirmed live: clicking the affordance and sending a chat both opened the rail from collapsed.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean |
| `./scripts/test.sh --grep "livingDocs"` | 144 passing, 0 failing (parity with main) |
| `./scripts/test.sh --grep "LivingDocsService"` | 141 passing, 1 failing - the KNOWN pre-existing `a fan-out with the model down...` (#203), not introduced here |
| `./scripts/test.sh --grep "quiet-shell"` | 6 passing (the new L4 decision suite) |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| Zero core patches | confirmed - diff is `contrib/livingDocs/` + one additive `.style-override` CSS block |

### Live E2E (fresh EMPTY seed profile, `TMPDIR=/tmp`, session `lp-l4`, plain-doc folder; adopted the healthy shared 8090 broker for real chat sends)

| # | Scenario | Outcome | Screenshot |
| --- | --- | --- | --- |
| a | Cold open on a plain doc | Editor lands on "My Notes" with the LEFT rail only (252px); review rail COLLAPSED (width 0); slim affordance present | `a-cold-open-quiet-shell.png` |
| b | Click the affordance | ONE click opened the review rail on the Chat tab with the composer ready; affordance removed once open | `b-affordance-opens-chat.png` |
| c | Send a chat message | Live proposal via the adopted broker: rail expanded, Review tab badge (1), Approve all/Reject all/Review each, inline red/green diff in the editor - trust grammar intact | `c-send-produces-proposal.png` |
| d | Pending review forces open despite a manual collapse | (d1) With a proposal pending and the rail manually COLLAPSED, the proposal is still fully visible in the editor (inline diff + "1 change here" / "Approve all in this doc") and the affordance shows; (d2) crossing screen->doc reopened the rail (width 374) with the proposal still shown - a proposal is never hidden | `d1-manual-collapse-with-pending.png`, `d2-pending-forces-open-despite-collapse.png` |
| e1 | Manual collapse persists across restart | Manually collapsed, held across a doc switch, key stored `collapsed`; relaunch -> rail stayed COLLAPSED, affordance present | `e1-manual-collapse.png`, `e1-collapse-persists-after-restart.png` |
| e2 | Manual expand persists across restart | Manually opened on the empty Second Doc (no chat), key stored `open`; relaunch -> rail stayed EXPANDED at the remembered width (282px) even on a doc with no pending review ("No changes waiting") | `e2-expand-persists-after-restart.png` |

## Deliberately out of scope / notes for other slices

- **"Relaunch with that pending review" (AC wording):** pending proposals are held in-memory in `LivingDocsService._pending` and are NOT persisted to disk (an unapproved proposal leaves the document unchanged, so on a literal cold relaunch there is nothing to re-derive). The force-open is therefore validated in-session (scenario d): a present pending review forces the rail open on every entry and overrides a stored manual collapse, and while collapsed the proposal remains visible in the editor. Persisting proposals across restart is not L4's remit.
- **L3 (markdown-first) copy/vocabulary and lock-creation paths** were left untouched per the concurrency note; this diff touches only rail visibility/persistence and the affordance.
- The review rail renders inside a webview OOPIF; composer focus lands inside the webview, which is the expected shape for this surface. Driven with raw CDP `Input.dispatchMouseEvent` at device-pixel coordinates, per the L2 findings.
