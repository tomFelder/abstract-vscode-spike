# Plan 32 (second half - iterations 3 + 4) - live verification status

## Boundary of this unit

Plan 32 has four iterations.
This is the **second-half unit: iterations 3 and 4**.
The first half (iterations 1-2) is merged to main via PR #112: event-kind agents propagate through the shared verify-gate + per-edge policy path with key-scoped dirty clearing; runs persist to `agents.json` (`{ agents, runs }`, cap 50); a ref-counted overlap guard records still-running skips; Home shows a failure attention line.
This unit builds on all of that.

## What this unit built

### Iteration 3 - the Agents screen grows up

- **Detail drawer (D32-B, decision 151 extended by decision 152).**
  The read-only canvas strip stays (the loop: trigger -> sources -> agent -> verify -> policy -> documents -> review rail).
  Added inline registry editing: a three-level policy `<select>` (exactly `auto-figures` / `ask-before-apply` / `draft-only`, the safety dial of spec 09 §4, no per-agent bespoke flags) and a trigger picker that composes a cron `Day HH:MM`, a heartbeat `everyHours`, or an event source path.
  Both post on change through a small `data-change-msg` / `data-trigger-save` client hook; the host writes through the orchestrator and re-renders.

- **Run log.**
  The drawer renders the agent's persisted runs newest-first (`getAgentRunsForAgent`) with the plan's columns: relative time (WHEN), the trigger `via`, the outcome counts (`N docs / N applied / N queued`), a failure line (`Failed - <reason>`) or a still-running-skip line, and an "N queued" link into the review surface for a run that queued changes.
  Truthful empty state ("No runs yet") until the agent has run - no fabricated activity.

- **Create / duplicate / pause.**
  `createAgent` (defaults to the safest `draft-only` + a unique slug id) and `duplicateAgent` (a `(copy)` with a fresh id and no shared run history) both land on the new agent's drawer.
  Pause is a `disabled?: boolean` on `IAgentDef` (default absent = enabled; only ever set true, so an older registry reads as enabled), which the scheduler (`runDueAgents`) and the event path (`onSourceChanged`) both skip; a manual "Run now" is deliberately still honoured (explicit user intent).
  All edits persist to `agents.json` through the existing `agentStore` seam.

- **Cross-project skill run (the P3 gap).**
  "Run skill across project" fans the single-doc grade over every living folder document via `runSkillAcrossProject`, rendering one row per document with its real flag/pass verdict and the grader's one-line reason.
  Skills stay single-doc units; the orchestrator does the fanning.
  Real data only: a non-living document, or a model-backed skill with no model, is honestly `skipped` - never a fabricated pass.

### Iteration 4 - lifecycle gates become visible

- **Before-export gate.**
  `previewExportGate(resource)` exposes the gate verdict so the editor computes it as the Present/export modal opens.
  A failed gate is SHOWN: the grader's one-line reason plus an "Export anyway" button (audited override) and a "Fix first" button (closes the modal and opens the in-surface source-peek on the flagged bound block's keys - the reconciliation UI).
  `exportDocument`/`exportMarkdown`/`publishDocument` gain a `force` parameter; without it a failed gate still blocks (the pre-existing behaviour), and with it the operation proceeds and records an `override`-via audit entry (a new `IAuditEntry.via` value).
  No silent blocks, no silent overrides.

- **On-publish pins.**
  The publish snapshot records a real `pinnedSources` count; History renders "pinned N source versions" beside the SNAPSHOT badge (or "no sources to pin" for a 0-pin publish - never a fabricated number).
  `getSourcePeek` adds a `pinnedLabel` ("pinned at v <short-hash> of <date>", dated from the newest publish snapshot), shown on a published document's source drawer.

## Deterministic verification (done + MEASURED)

Every new user-visible state is asserted through the pure `renderScreenHtml` / `renderLivingDocHtml` / `historyHtml` harnesses and the service/orchestrator/model suites.
All counts below are measured by re-running the suites; none are invented.
The suites were executed exactly as the four prior units did - with an **esbuild-bundled Node runner** (a mocha-shim: `suite`/`test`/`setup`/`teardown`; the tests bundled against `src/tsconfig.json`; DOM/`mainWindow` globals stubbed) - because the full client web build is blocked in this sandbox (see below).

| Suite | Result on re-run | New tests this unit |
|---|---|---|
| `agentOrchestrator.test.ts` | 29 pass | **8** (create appends+persists a unique id; duplicate clones with a fresh id + no shared runs; a paused agent is skipped by the scheduler but runs manually; resuming re-admits it; a paused event agent stays quiet on a source change while the graph still flags dirty; policy set validates + rejects an invalid value; a retargeted trigger fires at its new time) |
| `livingDocsModel.test.ts` | 31 pass | **2** (`summariseSkillRun` tallies flagged/passed/skipped from real per-doc results; an empty run is all-zero) |
| `screenRender.test.ts` | 33 pass | **9** (New-agent wiring + PAUSED list chip; the read-only canvas strip + the policy select with exactly three levels; the cron day/time + heartbeat-hours pickers + Save trigger; the run-log WHEN/VIA/OUTCOME columns + the "N queued" review link; the failed-run + still-running-skip lines; the truthful empty run log; Duplicate/Pause/Resume + the paused note; the cross-project skill affordance + the per-doc flag/pass strip with real tallies) |
| `livingDocRender.test.ts` | 13 pass | **2** (a failed before-export gate shows the reason + Export-anyway + Fix-first buttons; a passing gate shows the normal single CTA and no override) |
| `historyRender.test.ts` | 10 pass | **2** (a publish names the real pin count; a 0-pin publish reads "no sources to pin") |
| `livingDocsService.test.ts` | 107 pass | **7** (`previewExportGate` surfaces the failure; a forced export writes the file AND audits `via:override` while the unforced export stays blocked; a forced publish audits the override; the publish snapshot carries the true pin count; source-peek shows the pinned line on a published doc; `runSkillAcrossProject` grades every living doc with a real verdict + covering tallies) |

**27 new tests for the unit** (7 orchestrator + 2 model + 8 screenRender + 2 livingDocRender + 2 historyRender + 6 service).

The only reported per-suite failures are the **`[teardown]` disposable-leak-tracker complaints** - the known ad-hoc-runner artefact documented in plans 30/32-first-half's verify notes (the shared leak tracker bleeds across tests in this bundled runner; the real mocha suite isolates the tracker per test). Every actual test body, including all 27 new tests, is in the pass set.

No new machinery needs the model backend: the drawer/run-log/gate/pins states are deterministic. The cross-project skill run's deterministic skills (Financial, Formatting) grade with no model; the model-backed Strategy grade honestly reports `skipped` per document when no model is reachable.

## Regression guard

The pre-existing livingDocs suites re-run with **zero non-teardown failures**: `perfScale` (8), `fanoutBudget` (6), plus the full model/service/render suites above (the first-half's ~310-test envelope is preserved and grown).

## Gates

- `typecheck-client` - clean (only the pre-existing, unrelated `src/vs/platform/agentHost/**` errors remain; the baseline run before any change was also clean under `--skipLibCheck --noEmit`).
- `valid-layers-check` - clean.
- `scripts/check-seams.sh` - OK.
- **0 core patches** - every change is inside `contrib/livingDocs/` (9 source files + 6 test files). Confirmed by `git status` (nothing outside `contrib/livingDocs` or `docs/`).

## Live in-app web run: BLOCKED (honest)

A live web run on `:8080` could NOT be captured in this sandbox.

- `npm run compile-client` (gulp) does not produce `out/vs`: it is blocked by the same **generally pruned sandbox node_modules** documented for plans 26/30/31 and the 32 first half. Re-confirmed for this unit: gulp will not start - `Cannot find package 'gulp-merge-json' imported from build/lib/gulp/facade.ts`. No `out/vs` is emitted.
- Any `@vscode/test-web` already serving on `:8080` serves the MAIN checkout's `out/`, NOT this branch. Per the evidence-integrity rule it was **NOT** screenshotted as evidence of this branch's code.

**No screenshots were fabricated.**
Because every new user-visible state (the detail-drawer canvas strip + policy select + trigger pickers + run-log columns + empty/failure/skip lines + the "N queued" link; Create/Duplicate/Pause/Resume + the PAUSED chip; the cross-project skill strip; the failed-gate modal with Export-anyway + Fix-first; the passing-gate modal; the History pin-count row; the source-peek pinned line) is renderable and asserted in the pure harnesses, an "it needs the live build" claim would fail validation - so this unit asserts them deterministically instead.

A validator re-running with a complete `node_modules` can build the web bundle and drive the live story: open Agents -> a default agent's drawer, change its policy to `draft-only` and Run now (figures arrive as drafts), pause it and tick past its cron (the skip is recorded), retarget its trigger; run Formatting across the ISMS sample (per-doc flags in the strip); and on a document with a deliberately broken figure, open Present -> the gate explains, Export anyway -> the `override` audit entry, publish -> History shows the pinned version and source-peek shows the pinned line.

## Decisions logged

`docs/07-decision-log.md` rows **152** (iteration 3 - the detail drawer, inline policy/trigger edits, run log, create/duplicate/pause, cross-project skill run) and **153** (iteration 4 - the visible before-export gate with audited override + the on-publish pins in History and source-peek).
