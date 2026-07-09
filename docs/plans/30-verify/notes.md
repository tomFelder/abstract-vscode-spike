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

`test/browser/perfScale.test.ts` - 8 tests, all passing:

1. `makeScaleFixture` generates the asserted shape (50 docs over 4 shared CSVs).
2. 50-doc full refresh: each shared CSV read exactly once per pass; timing recorded.
3. One changed CSV re-derives only its dependents (changed-source value lands; unchanged-source doc untouched).
4. A shared CSV bound by many docs is read once per pass.
5. Source fetches bounded to ≤ 4 in flight (deferred-fetch peak assertion).
6. Per-host cooldown suppresses an identical fetch within 30 s and admits it after (fake clock).
7. Model calls bounded to ≤ 2 in flight across a fan-out: six concurrent Strategy-grader checks against a mocked healthy proxy whose `/v1/messages` defers on a gate; the observed peak is asserted to be exactly 2, and all six drain.
8. A rejecting source fetch fails only its document; the others still derive (failure isolation).

Regression guard: the full pre-existing `livingDocsService.test.ts` (91 assertions) and `agentOrchestrator.test.ts` (12) were re-run against the concurrent/incremental path with **zero assertion regressions** (the only failing lines in the ad-hoc esbuild runner are its own cross-test disposable-tracker bleed, identical on the pre-plan-30 baseline; the real mocha suite isolates the tracker per test).

## Gates

- `typecheck-client` - clean (only the pre-existing, unrelated `src/vs/platform/agentHost/**` errors remain).
- `valid-layers-check` - clean.
- `scripts/check-seams.sh` - OK, all shell seams intact.
- **0 core patches** - every change is inside `contrib/livingDocs/`.

## Live verification

The refresh-derivation path this unit changes is deterministic and does NOT require the model backend (source-file edit → refresh → figures reconcile).
See `README.md` in this folder for the live-run status and any blockers.

---

# Plan 30 - tracks 3 + 4 (fan-out context budgeting + editor webview test seams)

Scope of this unit: **track 3** (fan-out context budgeting, D30-B) and **track 4** (the P2-3 webview test-seam debt for the document editor).
These build on tracks 1 + 2 (merged via PR #110); they do not redo the incremental refresh / concurrency work.

All numbers below are **asserted** by the test suites (deterministic counts), not estimated.
Fan-out timing is not a meaningful metric here: the batching is a token-budget decision made before any model call, and the mocked model resolves instantly, so there is no wall-time to record - the plan gates track 3 on batching COUNTS and UI truthfulness, which is what the tests assert.

## Track 3 - what the budgeting changes (measured / asserted)

| Behaviour | Before (plan 18, decision 62) | After (track 3, D30-B) |
|---|---|---|
| Working set larger than the context budget | sent in ONE call - silent overflow / truncation on a 50-doc folder | packed into ordered BATCHES that each fit `budget - promptOverhead`; a 2-doc set over a 2000-token budget is asserted to send **2 batches, 2 model calls** |
| Per-batch keyed edits | n/a (single call) | merged with each document in **exactly one batch** - asserted **1 proposal per doc, no double-count** across batches |
| A document larger than the whole budget | truncated inside the single call | set aside as **oversize** - asserted **never sent** (the fitting docs still change), surfaced as an amber "too large for this run" tile + a `too large for this run` chat step + an `N too large` bottom-bar bucket |
| Token estimate | none | `chars/4`, asserted (4 chars → 1 token; 5 → 2; rounds up; empty → 0) |
| Budget | none | `livingDocs.fanoutContextBudget` (default 24000, min 2000) - user-overridable |

The run screen surfaces the batches truthfully: a `Batch K of M` chip in the command strip while a run spans more than one batch, and the swarm tiles read `oversize` for documents too large (excluded from the live working overlay so they never spin).

## Track 3 tests (all asserted; pure + service)

`test/browser/fanoutBudget.test.ts` - 6 pure tests: chars/4 estimate; fits-in-one-batch; ordered split at the boundary with every doc packed exactly once; oversize set aside (never packed); overhead floor keeps a usable budget; empty set.
`test/browser/livingDocsModel.test.ts` - 1 added test: `summariseProjectRun` flags an oversize document as its own bucket (priority over changed/no-change), plus the 4 pre-existing summary tests updated for the new `oversizeDocs` field.
`test/browser/livingDocsService.test.ts` - 2 added tests: an over-budget working set is sent in 2 batches with the per-batch edits merged to the right docs one-each (+ `Batch 1/2` and `Batch 2/2` steps + a 2-batch `IFanoutProgress`); a document larger than the whole budget is flagged oversize, never sent, and the others still change. (The single-doc / no-working-set path is covered by the pre-existing, unmodified D-B test, which still passes against the batched path.)
`test/browser/screenRender.test.ts` - 3 added tests asserting the track-3 UI from the PURE render (no model, no web build needed): a multi-batch run shows the `Batch 2 of 3` chip in the command strip; a single-batch run and a not-yet-started batch (index 0) show NO chip; an oversize document renders the amber `too large for this run` tile + the `1 too large` bottom-bar bucket and never renders as a spinning sub-agent.

## Track 4 - the editor webview test seam (P2-3)

The document editor's mount-once-then-message lifecycle is now a pure reducer (`common/editorWebviewProtocol.ts`); `livingDocEditor.ts` is a thin effect-runner.
No behaviour change - the reducer's effects are the same messages the old inline code posted.

`test/browser/editorWebviewProtocol.test.ts` - 9 pure tests covering exactly the plan's named cases: first-render setHtml-once; a render before ready is HELD and flushed on ready with NO pmReset; a model-driven body change resets the surface while a chrome-only render does not; the user's own typing (`recordPmBody`) suppresses the spurious reset; a null-body render clears the tracked body; a focus request before ready is held + flushed (focus-after-navigate) and after ready is immediate; ready flushes the held render BEFORE the held focus; an empty ready is a no-op.

**Deviation (logged, decision 138):** `screenEditor.ts` was not given a reducer - it uses whole-screen `setHtml` per render (no mount-once message protocol) and routes messages straight to the service, so it has no timing-sensitive lifecycle to extract. The meaningful P2-3 seam is the `livingDocEditor` mount-once path, where the silent-regression risk lives.

## Gates

- `typecheck-client` - clean (only the pre-existing, unrelated `src/vs/platform/agentHost/**` errors remain).
- `valid-layers-check` - clean.
- `scripts/check-seams.sh` - OK.
- **0 core patches** - every change is inside `contrib/livingDocs/`.

## Live verification (tracks 3 + 4)

The batching + merge + oversize path is proven by the deterministic harness (no model backend needed for the packing decision).
A live in-app multi-batch run on the scale sample (the batch chip + the amber oversize tile) needs BOTH the full web build and a reachable model backend to produce real proposals; in this sandbox the web build is blocked by the pruned node_modules and the model backend is unreachable (no credits), so the live model run was not captured.
See `README.md` for the blocker detail. No evidence was fabricated.
