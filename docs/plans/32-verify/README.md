# Plan 32 (first half - iterations 1 + 2) - live verification status

## Boundary of this unit

Plan 32 has four iterations.
This is the **first-half unit: iterations 1 and 2**.
The second-half unit picks up at **iteration 3** (the Agents-screen detail drawer with the read-only canvas strip, inline policy/trigger editors, the full run log, create/duplicate/pause, and the cross-project skill run) and **iteration 4** (making the before-export and on-publish lifecycle gates visible).
The boundary is drawn on the plan's own iteration structure: iterations 1-2 are the propagation + persistence engine (mostly non-UI, deterministically verifiable); iterations 3-4 are the Agents-screen and lifecycle-gate surfaces that need the live web build + design-match scoring.

## What this unit changed

### Iteration 1 - event propagation, end to end

The reverse-edge graph walk (`AgentOrchestrator.propagate`) already covered **both** edge kinds (value bindings and influence/context), proven by the pre-existing orchestrator tests.
The gap this unit closed is **policy routing on the event path**: before, an `event`-kind agent was a no-op in the service host (`_runAgent` returned `{ applied: 0, queued: 0 }` for `event`), so a live source edit only flagged docs dirty and waited for the next heartbeat.
Now the event agent re-derives the dirtied co-dependents through the same verify-gate + per-edge policy as every other trigger, so an `auto-figures` agent applies figures immediately on a source change and a `draft-only` agent queues drafts - the "living" ripple without a manual Refresh.
The event agent drains the dirty bit for each doc it processed so the heartbeat does not double-process it.

### Iteration 2 - scheduled runs that leave a trace

- **Run persistence (D32-A, decision 150):** `IAgentRun` gains `via` (trigger kind), `docsTouched`, `failed`/`error`, and a `skippedReason`; runs persist to `agents.json` (the file's shape becomes `{ agents, runs }`, a legacy bare array reads as `{ agents, runs: [] }`), capped at the last 50 with oldest-eviction, reloaded on `ensureLoaded`.
- **Overlap guard (spec 09 §3):** a scheduled/event trigger for an agent whose previous run is still in flight records a `skippedReason: 'still-running'` run instead of stacking; a manual "Run now" is always honoured.
- **Cron catch-up / web reality:** the scheduler already records nothing across a closed-app cron boundary (timers only run while the app is open); the on-open freshness pass flags what is stale. No copy in this unit implies background work happened while the app was closed.
- **Home failure line:** when the latest run of any agent failed, Home shows one quiet amber attention line ("Weekly refresh failed on Monday - view details") linking to the Agents screen, built solely from `getLatestAgentFailure` - absent when nothing failed (truthful automation, no fabricated activity).

The full iteration-2/3 run-log UI (relative time, via, outcome counts, the failure line, the "N queued" link into the review surface) is the plan's iteration-3 detail drawer and is deliberately left to the second-half unit; the last-run canvas banner that already ships continues to render the most recent run.

## Deterministic verification (done + MEASURED)

All numbers below are measured by re-running the suites; none are invented.

- **`agentOrchestrator.test.ts`** - the pre-existing 12 tests plus **7 new** (plan 32 iter 2): run persisted with trigger + outcome counts; 50-cap oldest-eviction newest-first; reload-on-`ensureLoaded`; overlap-skip records `still-running` and does not stack; a manual run is always honoured; a throwing runner records `failed`/`error` and `getLatestFailure` surfaces it; the failure clears once the agent runs cleanly again. The subsequent **validator-round fix adds 3 more** (see "Validator-round fixes" below): a dirty key added mid-run survives the run-end clear; `clearDirtyKeys` drops the entry entirely once its last key clears; a manual run overlapping a scheduled run keeps the ref-counted still-running marker up so a second scheduled trigger still skips. **10 new** orchestrator tests for the unit in total (22 in the suite, all passing).
- **`livingDocsService.test.ts`** - the pre-existing service suite plus **2 new** (plan 32 iter 1): a source event under `auto-figures` applies the figure immediately + audits it + drains the dirty bit and queues nothing; a source event under `draft-only` queues a draft and leaves the doc untouched.
- **`screenRender.test.ts`** - the pre-existing render suite plus **2 new** (plan 32 iter 2): Home surfaces the failure line with the agent + day and a `goAgents` link when a run failed; Home shows NO failure line when nothing failed.

The propagation + refresh-derivation path is deterministic and does **not** need the model backend (source-file edit -> event agent -> figures reconcile / drafts queue), so the whole iteration-1 contract is verifiable without model credits.

### How the suites were run

The full client web build (gulp/mocha browser toolchain) is blocked in this sandbox by generally pruned `node_modules` (see below), so - exactly as plan 30's units did - the three `*.test.ts` suites were executed with an **esbuild-bundled Node runner** (a small mocha-shim: `suite`/`test`/`setup`/`teardown`, the tests bundled with `experimentalDecorators`, DOM globals stubbed).
Result on re-run after the validator-round fix: the orchestrator suite reports **22 passed, 0 failed** and the service suite reports **95 passed, 0 real failures**.
The only reported failures are the **6 `[teardown]` disposable-leak-tracker complaints on unmodified service tests** - the **known ad-hoc-runner artefact** documented in plan 30's verify notes (the shared leak tracker bleeds across tests in this bundled runner; the real mocha suite isolates the tracker per test; the orchestrator suite reports 0 such throws after the fix). Every actual test body, including all **14 new tests for this unit** (11 for iterations 1-2, plus the 3 validator-round fix tests), is in the pass set.

## Validator-round fixes

A validator PASSed this unit on every acceptance criterion but raised three findings; all three are fixed here (code fixes, not doc-softening).

1. **Dirty-bit drop on concurrent source events (finding 1).**
   The source watcher fires `void onSourceChanged(path)` with no debounce/await, so a second source event can interleave during the first event-run's awaited reconcile.
   Before, the first run's `clearDirty(uri)` deleted the doc's ENTIRE dirty entry, dropping a bit the interleaved event had just added (the overlap guard skips the second event-run), so the second change was missed until a later edit.
   The fix: the service's `_runAgent` now snapshots each doc's dirty keys BEFORE its awaited `_runFiguresByPolicy`, and the run clears only those snapshotted keys via the new `AgentOrchestrator.clearDirtyKeys(uri, snapshot)`.
   Any key added after the snapshot survives for the heartbeat to drain; the entry is removed only when no keys remain.
   Test added: a dirty key added mid-run survives the run-end clear (plus one that the entry drops entirely when its last key clears).

2. **Overlap guard unreliable when a manual run overlaps a scheduled run (finding 2).**
   `_inFlight` was a `Set<string>` keyed by agentId; a manual run bypasses the guard but still marked the agent in-flight, and whichever concurrent run finished first cleared the marker in `finally` - so a scheduled trigger in that window could stack, contradicting "runs never stack".
   The fix: `_inFlight` is now a `Map<string, number>` ref-count; the marker clears only when the LAST in-flight run for the agent finishes.
   Test added: a manual run overlapping a scheduled run keeps the marker up, so a second scheduled trigger during the window still records a still-running skip (and a fresh scheduled run proceeds once the last in-flight run drains).

3. **Test/doc counts corrected (finding 3).**
   The iteration-1-2 diff added **7** new `agentOrchestrator` tests (not 8), so the unit added **11** new tests (not 12).
   This README (the counts above), decision-log row 150, and the totals here were corrected, then re-counted after this round's 3 fix tests: **14 new tests for the unit** (10 orchestrator + 2 service + 2 render), the orchestrator suite now 22 tests.

## Live in-app web run: BLOCKED (honest)

A live web run on `:8080` (the plan's "Verify approach": shortened heartbeat + a real disk source edit) could NOT be captured in this sandbox.

- `npm run compile-client` (gulp) does not produce `out/vs`: it is blocked by the same **generally pruned sandbox node_modules** documented for plans 26/30/31 (decisions 131-134). In this worktree the build fails even earlier than the plan-30 chain - gulp itself will not start: `Cannot find package 'gulp-merge-json' imported from build/lib/gulp/facade.ts`. Behind that sit the previously documented extension-media failures (`dompurify`, then `@vscode/markdown-it-katex`, then nested `css-language-features/server` deps), none of which are used by `contrib/livingDocs/` at all. No `out/vs` is emitted.
- Port `:8080` was already occupied by an unrelated `@vscode/test-web` server serving the **MAIN checkout's** build - the wrong branch and folder for this unit. Per the evidence-integrity rule, that server was **NOT** screenshotted as evidence of this branch's code.

**No screenshots were fabricated.**
A validator re-running with a complete `node_modules` can build the web bundle, seed a two-doc-plus-shared-CSV sample, register an `auto-figures` event agent, edit the CSV in another editor, and watch the Review rail queue the meaning change while figures auto-apply and the Home NEEDS-YOU count updates without a manual Refresh - and can set a heartbeat agent's `everyHours` low, tick it, and see the run recorded in `agents.json` and (on a deliberately failed run) the Home attention line appear.
The deterministic derivation path this unit changes reconciles figures with no model backend.

## Decisions logged

`docs/07-decision-log.md` rows **150** (D32-A, run persistence) and **151** (D32-B, read-only canvas + the Home failure line).
