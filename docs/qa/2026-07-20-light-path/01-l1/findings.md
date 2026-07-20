# Plan 42 slice L1 - Editor-first cold start (findings)

**Issue:** #197 - Branch: `light-path/l1-editor-first` (off `main` @ `3bbe7ddd1c4`)
**Date:** 2026-07-20

L1 re-routes the cold start so the app opens *in the editor with a document focused* instead of on the Welcome walkthrough, and demotes the walkthrough to a dismissible "See a 90-second demo" entry point on Home. The agent-edit trust grammar (diff / approve / provenance / review rail for proposals) is untouched; zero core patches (all changes inside `src/vs/workbench/contrib/livingDocs/`).

## What changed (file by file)

- **`common/startupRouting.ts` (new).** The pure, unit-tested cold-start routing decision. `decideStartupRoute({ hasFolder, lastActiveFile, folderDocuments })` returns either `OpenDocument(resource)` or `NewUntitledDocument(hasFolder)`. Precedence per the slice text: most-recently-opened doc (only when it is still one of the folder's Markdown docs, so a stale history entry never wins) -> the folder's first document (stable-sorted) -> a new untitled Markdown doc. No DOM / service / clock, so the routing contract is proven without driving the workbench (mirrors the `common/onboarding.ts` pattern).

- **`browser/livingDocs.contribution.ts` (`StudioStartupContribution`).** Replaced the onboarding/home screen routing with editor-first routing. The contribution now gathers facts from workbench services (`IWorkspaceContextService.getWorkbenchState()`, `IHistoryService.getLastActiveFile(Schemas.file)`, `ILivingDocsService.listDocuments()`), calls `decideStartupRoute`, and opens the chosen document - or an untitled Markdown editor (`openEditor({ resource: undefined, languageId: 'markdown', options: { pinned: true } })`) when there is nothing to open. Still runs ONLY in the `editors.length === 0` branch, and re-checks that guard before each open, so VS Code's native per-workspace editor restore and any deep-link always win. Removed the now-unused `MODEL_ACCESS_SEEN_KEY` / `_openStartupScreen` / injected `IInstantiationService` + `IStorageService` from this contribution (those services are still used by other contributions in the file). Injections added: `IWorkspaceContextService`, `IHistoryService`, `ILivingDocsService`.

- **`browser/screenRender.ts` (`renderResumeBanner`).** The banner region now renders one of two mutually-exclusive shapes: the existing "Continue your walkthrough" resume banner when a walkthrough is in progress, else a dismissible **"See a 90-second demo"** card (a primary "See a 90-Second Demo" button wired to `openOnboarding` + a `x` dismiss wired to `dismissDemoCard`). Once dismissed (`demoCardDismissed`), the card stays hidden. Added `demoCardDismissed?: boolean` to `IScreenState`.

- **`browser/screenEditor.ts`.** Added the `DEMO_CARD_DISMISSED_KEY` (profile-scoped) storage key; the Home state read now hydrates `demoCardDismissed` from it; a new `dismissDemoCard` message handler persists the flag and re-renders; `demoCardDismissed` added to `IScreenEditorState`. `openOnboarding` (shared by the resume banner and the demo card) unchanged - it still opens the onboarding screen, and "See It Work" still runs the whole demo.

- **Tests:** `test/browser/startupRouting.test.ts` (new, 5 cases - MRU wins / stale-MRU falls back / first-doc / empty-folder-untitled / no-folder-untitled, snapshot-style). Extended `test/browser/screenRender.test.ts` with a case asserting the dismissible demo card appears on fresh Home, is wired to open + dismiss, hides once dismissed, and yields to the resume banner mid-walkthrough.

## The rail-mount coupling (L1 point 4)

Investigated the baseline's "review rail driven by the demo, stays expanded on the user's own doc". It is NOT an onboarding-completion dependency in `RailVisibilityContribution` (that keys off the active editor being a `LivingDocEditorInput`, which slice L4 owns for collapse-by-default). The coupling was a *consequence of the forced walkthrough entry*: cold start ran the demo, which wrote proposals into the workspace-wide `getAllPending()` set, so those demo proposals showed on any doc. Removing the forced walkthrough entry kills the coupling at its root - a fresh profile no longer auto-generates the demo, so the rail reflects only the open doc's real pending work. Verified live: on the folder cold open the review rail reads **"No changes waiting"** (see `a-folder-cold-open.png`), not demo proposals. No change to `RailVisibilityContribution` was needed or made (L4 not touched).

## Verification transcript

- `npm run typecheck-client`: clean (exit 0, no errors).
- `./scripts/test.sh --grep "cold-start routing"`: **5 passing, 0 failing**.
- `./scripts/test.sh --grep "screenRender"`: **59 passing, 0 failing** (includes the new demo-card case).
- `./scripts/test.sh --grep "livingDocs"`: **140 passing, 0 failing**.
- `npm run valid-layers-check`: clean.
- `./scripts/check-seams.sh`: OK - all shell seams intact.
- Pre-existing unrelated failure: `LivingDocsService > "a fan-out with the model down names EVERY failed doc..."` fails identically with my changes stashed (verified on the clean tree). It is a model-proxy networking simulation test in `livingDocsService.test.ts`, untouched by this slice.

## Live E2E (launch skill, fresh empty seed profiles, TMPDIR=/tmp, sessions lp-l1 / lp-l1b)

| Scenario | Result | Interactions / forced decisions | Screenshot |
| --- | --- | --- | --- |
| (a) fresh profile + copy of a markdown folder | Cold-opened directly into the editor with **"00 - Overview"** open + focused; review rail reads **"No changes waiting"** | **0 forced decisions**; 0 interactions to arrive, 1 click to place cursor and type (<=2) | `a-folder-cold-open.png` |
| (b) no-folder open | Blank **untitled Markdown** doc, cursor blinking in `native-edit-context` (focused, editable); "Open a folder" one click away via the always-present Home nav item | 0 forced decisions | `b-nofolder-untitled.png`, `b2-nofolder-home-openfolder.png` |
| (c) walkthrough reachable + dismissible | Home shows the **"See a 90-second demo"** card with a "See a 90-Second Demo" button and a dismiss control; the button opens the "Two Wows, Ten Minutes" walkthrough | - | `c-home-demo-card.png`, `c2-walkthrough-opened.png` |
| (d) "See It Work" still works | Generated the Demo Report and the review rail showed **"1 change needs approval"** with the "Note to the board" inline red/green diff + "Approve & apply" | - | `d-see-it-work-demo.png` |

Baseline was 3 clicks + **1 forced decision** (See It Work vs Model Access) behind a 7-step walkthrough. L1 result: **0 forced decisions**, editor-first on arrival.

Cleanup: both Code OSS instances killed, temp profiles + workspace copies removed.

## Deliberately NOT done (other slices)

- **L4 (quiet shell / rail collapse-by-default):** the review rail still auto-reveals on the editor surface via `RailVisibilityContribution` (unchanged). L1 only removed the *demo-content* coupling, not the reveal-on-crossing behaviour.
- **L2 (model access inline at first AI use):** untouched. The onboarding screen still offers "Model Access & a Few Questions"; no change to where the model decision lives.
- **L3 (markdown-first vocabulary):** the no-folder untitled doc is plain Markdown with no living-doc artefacts, which is aligned with L3, but the entry-path *copy/vocabulary* audit is L3's job and was not done here.

## Deviations from the slice text

None. "Most recently opened doc" uses `IHistoryService.getLastActiveFile` as the plan suggested, gated to the folder's Markdown docs; the no-folder "Open a folder" affordance reuses the existing always-present Home front door rather than adding a new toolbar button (surgical diff, no restyle).
