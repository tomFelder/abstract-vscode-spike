# Plan 42 slice L1 - adversarial validation (issue #197)

**Verdict: PASS** (with one advisory, one pre-existing-test note for the orchestrator).

**Branch:** `light-path/l1-editor-first` @ `c9715ccc24c` - **Base:** `main` @ `3bbe7ddd1c4` - **Date:** 2026-07-20 - **Validator session:** `lp-l1v`

I assumed the slice was broken and tried to refute it: re-ran every check, independently drove the live app from the worktree with fresh empty seed profiles, and attacked the edge cases. The core AC holds up.

## 1. Checks (re-run independently in the worktree)

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean (exit 0, no errors) |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "livingDocs"` | **141 passing, 0 failing** (includes the new demo-card case; the plan's own grep does NOT reach the LivingDocsService suite - see below) |
| `./scripts/test.sh --grep "cold-start routing"` | 5 passing, 0 failing (new startupRouting.test.ts) |

### Adjudication of the "pre-existing" failing test

Ran `./scripts/test.sh --grep "fan-out with the model down"` on BOTH the branch and a clean `main` (@ `3bbe7ddd1c4`, clean src working tree):

- **Branch:** 1 failing - `AssertionError: the turn names the model as unreachable`.
- **Clean main:** 1 failing - identical assertion.

**Verdict: genuinely pre-existing.** The branch does not introduce it. The failing test lives in `suite('LivingDocsService')` in `livingDocsService.test.ts:1461`.

**Two things the orchestrator must know:**
1. The plan's stated 0-failures gate (`--grep "livingDocs"`, section 5 / loop) is **case-sensitive and silently skips the `LivingDocsService` suite** (capital L). So both the implementer's "livingDocs = 0 failures" and mine are true but do NOT cover this failing test. The plan's constraint "the livingDocs test suite is at 0 failures on main - it stays at 0" is therefore **violated on main today** by a pre-existing defect that the plan's own command cannot see. This is not L1's fault and does not block L1's merge, but the orchestrator should file/track it - the run's definition-of-done ("livingDocs suite still at 0 failures on main") cannot be honestly met until it's fixed.

## 2. Acceptance criteria (live, fresh empty seed profiles, TMPDIR=/tmp)

| AC | Result | Interactions / decisions | Evidence |
| --- | --- | --- | --- |
| Fresh profile + folder -> editor with a doc open + focused | **PASS.** Cold-opened straight into the `LivingDocEditor` (WYSIWYG webview render) with "00 - Overview" open + focused; review rail read "No changes waiting". Typed `ZQVALID` and it landed in the doc body ("...origin record ZQVALID"). | **0 interactions to arrive, 0 forced decisions**; 1 click to place cursor + type = well within <=2. **TTFK ~instant, well under 10s.** | `v-a-folder-cold-open.png`, `v-a2-typed-in-doc.png` |
| No-folder open -> blank untitled Markdown, cursor placed, "Open a folder" affordance | **PASS with advisory.** Lands in a blank untitled **Markdown** doc, `native-edit-context` focused, Ln 1 Col 1. The "Open a folder" affordance is NOT on the untitled surface itself - it is one click away on Home ("Open a folder to begin" + a prominent "Open folder..." button). See advisory #1. | 0 forced decisions | `v-b-nofolder-untitled.png`, `v-b2-home-openfolder.png` |
| Walkthrough demoted + dismissible + persists | **PASS.** Home shows the "See a 90-second demo" card (open + dismiss `x`). Dismiss removes it; `livingDocs.demoCardDismissed=true` persists PROFILE-scoped; relaunch from that profile keeps it hidden. | - | `v-c-home-demo-card.png`, `v-c2-after-dismiss.png`, `v-e-dismiss-persisted.png` |
| Walkthrough still reachable after dismissal | **PASS.** The card opens the full 7-step "Welcome to Abstract" walkthrough. Independently, the `livingDocs.open.onboarding` command ("Onboarding", category "Abstract", `f1:true`) reaches it from the palette unconditionally, so a dismissed card never hides the walkthrough. | - | `v-g-walkthrough-opened.png` |
| "See It Work" still runs the demo + review rail shows the proposal | **PASS.** Generated the Demo Report; review rail read "1 change needs approval across 1 document" with the "Note to the board" inline red/green diff + "Approve & apply". The aha path is unharmed; the agent-edit trust grammar is intact. | - | `v-h-see-it-work.png` |
| Review rail reflects the OPEN doc on a fresh folder open (mount quirk retired) | **PASS.** On folder cold open and on a second launch of the same profile, the rail reads "No changes waiting", not demo content. The rail mounts correctly WITHOUT onboarding having completed. | - | `v-a-folder-cold-open.png`, `v-d-restored-profile.png` |

## 3. Edge cases attacked

- **Folder with NO markdown files** (only a `.txt`): opens a blank untitled Markdown doc, focused, no wizard, no dead-end. `v-i-empty-folder.png`. **PASS** - matches `decideStartupRoute` (folder + empty docs -> NewUntitledDocument).
- **Restored / second launch of a used profile:** landed in the editor with a doc open, rail "No changes waiting" - the restored-profile review-rail mount quirk is gone; the rail mounts without onboarding completion. `v-d-restored-profile.png`. **PASS.**
- **Deep-link / restored editors win over startup routing:** verified by code. `_openStartupDocument` runs only in the `editors.length === 0` branch AND re-checks `editors.length !== 0` after the async `listDocuments()` fact-gathering before opening, so a restored editor / deep-link that arrives mid-flight wins and the routing bails (`livingDocs.contribution.ts:555,574`). No clobbering. **PASS.**
- **Old `livingDocs.modelAccessSeen` key removed cleanly:** no residual references in `src/`; the key is absent from persisted `state.vscdb`; no crash/weirdness on a used profile. The removed `IStorageService`/`IInstantiationService` from `StudioStartupContribution` are still imported+used by other contributions in the file, so no dead imports. **PASS.**
- **Demo-card dismissed doesn't hide the walkthrough:** the palette "Onboarding" command is unconditional. **PASS.**
- **Markdown file that fails to load:** L1 only selects a resource URI; content-load failure is handled by the editor's own error state (stock fork behaviour), not a new L1 risk. Not separately reproduced.
- **No double-open / flicker:** folder cold open came up directly in the editor; no Home/Welcome flash observed before the editor.

## 4. Constraints

- **Zero core patches:** all `src/` changes are inside `src/vs/workbench/contrib/livingDocs/` (contribution, screenEditor, screenRender, new common/startupRouting.ts, 2 test files). Confirmed via `git diff main...HEAD --stat`. **PASS.**
- **Trust grammar untouched:** no change to diff/approve/provenance/review-rail-for-proposals. "See It Work" verified live end-to-end. **PASS.**
- **Strings localized:** all four new demo-card strings use `localize(...)`. **PASS.**
- **Tabs:** new file is tab-indented (31 tab lines, 0 space-indent lines). **PASS.**
- **Disposables:** the one-shot editor-change listener uses a registered `DisposableStore`. **PASS.**
- **No co-author lines** in `git log main..HEAD --format=%B`. **PASS.**

## Defects

1. **[advisory] No-folder landing surface has no on-surface "Open a folder" affordance.** The AC says the no-folder open lands "in a blank untitled document **with a visible 'Open a folder' affordance**". What the user actually sees on the untitled doc is a blank page + a left nav rail of icons (Home / Editor / Templates / Knowledge / Agents), none labelled "Open a folder". The affordance is genuinely present and prominent, but only after one click on the Home nav item ("Open a folder to begin" + "Open folder..." button). **Reproduce:** launch with no folder arg on a fresh profile; observe the untitled doc; the affordance is not on it. **Suspected cause:** the implementer reused the existing always-present Home front door instead of surfacing an affordance on the untitled doc itself. **Why advisory, not blocking:** the primary AC (blank editable doc, no wizard, cursor placed) is met, and the affordance is one obvious click away on an always-visible nav item. A stricter reading of the AC would want a cue on the doc surface itself (e.g. an editor placeholder/watermark linking to Open Folder). Orchestrator's call whether to tighten in a fix round or accept.

## AC measurements

- Folder cold open: **0 interactions to arrive, 0 forced decisions, 1 click to first keystroke** (<=2). TTFK effectively instant, well under the 10s target.
- Baseline (from `00-baseline/baseline.md`): 1 forced screen + 1 forced decision + 3 clicks = 5 steps behind a 7-step walkthrough. L1 removes the forced screen and the forced decision entirely.

## Cleanup

All seven of my Code OSS instances killed (including one stray `Abstract` process, PID 5196, that survived a kill and was holding a handle in its rundir - killed explicitly). All `/tmp/lp-l1v-*` seed profiles + folder copies removed. All my `/tmp/code-oss-dev/20260720-10*` rundirs removed. Playwright session `lp-l1v` closed. Did not touch any other agent's instances/profiles.
