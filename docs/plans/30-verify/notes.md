# Plan 30 - performance and scale: verify notes (tracks 1 + 2)

Scope of this unit: **track 1** (incremental, source-scoped derivation + shared-source caching) and **track 2** (a concurrency-limited scheduler with a per-host cooldown, D30-A).
Tracks 3 (fan-out context budgeting, D30-B) and 4's on-disk live run beyond the deterministic path belong to a later unit.

All numbers below are **measured**, not estimated.
They come from the `perfScale.test.ts` timing harness (`makeScaleFixture(50, 4)` - 50 documents fanned across 4 shared CSV sources), run against a mocked file service that counts source reads.
The baseline row was captured by measuring the SAME fixture against the pre-plan-30 serial refresh (`git stash` of the four source files, then the identical mock harness).

## Before / after (50 documents, 4 shared CSVs, `bindsPerDoc = 4`)

| Metric | Before (serial, all-docs, no cache) | After (tracks 1 + 2) |
|---|---|---|
| Full-refresh source reads | **248** | **152** |
| Reads of one shared CSV per refresh pass | **up to 26x** (once per bound doc, per resolve/subtitle/freshness sub-pass) | **exactly 1x** |
| Incremental refresh after ONE of 4 CSVs changes | (n/a - the old path always swept all 50 docs) | **54 reads**, only the changed source's ~13 dependents re-derive |
| Model calls in a fan-out | unbounded burst | **≤ 2 in flight** (model limiter) |
| Concurrent remote source fetches | unbounded | **≤ 4 in flight** (source limiter) |
| Repeat fetch of the same host within 30 s | re-fetched every time | **suppressed by the per-host cooldown** |

Wall-time is recorded to the console per run (`[plan30] 50-doc full refresh: … wall Nms`); with a mocked file service the wall-time is dominated by test harness overhead (single-digit ms) and is informational only.
The **asserted** gates are the deterministic counts above, not the times (per the plan: "Assert on the counts (deterministic), record the times to console").

## What the shared-source cache changes

A CSV bound by 13 of the 50 documents was read ~26 times per refresh under the old serial sweep (each document's resolve + subtitle + freshness sub-passes each re-read every source).
Within one refresh pass it is now read **exactly once** - the pass caches the in-flight read promise, so even the concurrent freshness fan-out awaits a single read rather than racing N identical reads.

## What incremental derivation changes

A project-wide `refreshFromSources()` now runs a cheap freshness hash-check first and re-derives ONLY the documents whose sources actually moved (or that were never synced, or whose visible figures still differ from the resolved lock values - the last preserves the pre-plan-30 "a manual Refresh always reconciles the visible cache" behaviour).
A folder whose sources have not changed and is already synced does no derivation work.
The doc-toolbar Refresh scopes to its one document plus the co-dependents of any source that changed (via the orchestrator's reverse edges).

## Tests (all measured/asserted; run via the contrib unit suite)

`test/browser/perfScale.test.ts` - 7 tests, all passing:

1. `makeScaleFixture` generates the asserted shape (50 docs over 4 shared CSVs).
2. 50-doc full refresh: each shared CSV read exactly once per pass; timing recorded.
3. One changed CSV re-derives only its dependents (changed-source value lands; unchanged-source doc untouched).
4. A shared CSV bound by many docs is read once per pass.
5. Source fetches bounded to ≤ 4 in flight (deferred-fetch peak assertion).
6. Per-host cooldown suppresses an identical fetch within 30 s and admits it after (fake clock).
7. A rejecting source fetch fails only its document; the others still derive (failure isolation).

Regression guard: the full pre-existing `livingDocsService.test.ts` (91 assertions) and `agentOrchestrator.test.ts` (12) were re-run against the concurrent/incremental path with **zero assertion regressions** (the only failing lines in the ad-hoc esbuild runner are its own cross-test disposable-tracker bleed, identical on the pre-plan-30 baseline; the real mocha suite isolates the tracker per test).

## Gates

- `typecheck-client` - clean (only the pre-existing, unrelated `src/vs/platform/agentHost/**` errors remain).
- `valid-layers-check` - clean.
- `scripts/check-seams.sh` - OK, all shell seams intact.
- **0 core patches** - every change is inside `contrib/livingDocs/`.

## Live verification

The refresh-derivation path this unit changes is deterministic and does NOT require the model backend (source-file edit → refresh → figures reconcile).
See `README.md` in this folder for the live-run status and any blockers.
