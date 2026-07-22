# Rail 47-b - implementer round 2 (#236): D1 down->up recovery fix

Fixes VALIDATION ROUND 1 defect **D1** - no down->up recovery within a session. After the broker recovered, the composer health dot never returned to green: the settled-status cache handed back `broker-down` without re-probing, and its only caller (`_refreshSignedIn`) fired solely on the service's `onDidChange`, which the settled cache suppressed. Before the flicker fix every read re-probed; the fix regressed recovery to unbounded.

## The fix (mechanism)

A low-frequency background re-probe of `/healthz`, armed ONLY while the status is `broker-down` AND at least one consumer is mounted:

- `LivingDocsService.watchProviderStatus(): IDisposable` (new on `ILivingDocsService`) - a mounted consumer (the rail composer) registers interest; the returned disposable unwinds it. Ref-counted (`_providerStatusWatchers`).
- `_reconcileDownReprobe()` arms an `IntervalTimer` (`BROKER_DOWN_REPROBE_MS = 12_000`) iff `watchers > 0 && readiness === 'broker-down'`, and cancels it otherwise. Guarded by `_downReprobeArmed` so a repeat reconcile does NOT reset the interval countdown. Called on every probe settle and on every watch/unwatch.
- The timer's tick calls the existing `_refreshProviderStatus`, which fires `onDidChange` ONLY on a REAL transition (structural `providerStatusEquals`) - so a stable-down broker never churns the UI, and the down->up recovery fires exactly one `onDidChange`. That drives `_refreshSignedIn` -> re-render -> green.
- On recovery, the settle's reconcile sees `readiness !== 'broker-down'` and cancels the timer. On the last unwatch (rail unmount) the ref-count hits 0 and the timer stops - no orphan timer (owned by the register store too).
- `reviewRailView.renderBody` calls `this._register(this._livingDocs.watchProviderStatus())`, so interest is tied to the rail's render lifecycle.

The UP path is untouched: `getModelProviderStatus()` still serves the settled cache instantly and only TTL-refreshes in the background. That is what killed the #211-4 flicker, and it is preserved.

The 12s interval is exposed to unit tests via `setBrokerDownReprobeMsForTest(ms)` (a deterministic-timing seam, NOT on the interface). A DI singleton constructor cannot take a non-service leading parameter, so a field setter is the injection seam; production keeps the 12s default.

## Static + unit (broker DOWN, hermetic)

- `typecheck-client`: clean (exit 0).
- `valid-layers-check`: clean (exit 0).
- `test.sh --grep livingDoc`: **348 passing, 0 failing** with the broker down (was 345; +3 new D1 tests in `modelSelector.test.ts`). The `--grep "model selector"` sub-run confirms 8 (5 prior + 3 new). Stable across 3 repeat runs (no flake).

New tests (deterministic; a mutable broker flag + a short reprobe interval, no live broker):
1. `down + watched -> the background probe fires on the interval and transitions up EXACTLY once` - seeds down, watches, flips the broker up, asserts the idle interval re-probes, settles ready, fires exactly ONE onDidChange for the transition, and the timer then stops (probe count frozen).
2. `up + watched -> NO interval probing` - ready + watched arms nothing; zero interval probes over several periods (the flicker-fix UP path preserved).
3. `disposing the watcher stops the down-recovery interval` - down + watched climbs the probe count; after dispose the count is frozen (no orphan timer).

## Live evidence (real broker on 127.0.0.1:8090, openrouter, real key; web on :8082; Playwright 1.56, headless chromium-1217, 1440x900 DPR2)

Driving path: Home -> click a doc card (nested webview OOPIF) -> "Open Chat" edge affordance mounts the review rail composer. Health dot read from `.living-docs-panel` (6x6, border-radius 999px). Colours: green `rgb(44,129,89)` = #2C8159, red `rgb(181,81,75)` = #B5514B.

**Check 1 - broker up -> green.** Composer health dot green on mount. (01-composer-green.png, 06a-up-green.png)

**Check 2 - kill broker -> plain-words down (honest).** After killing the broker and a surface crossing past the 30s TTL, the dot is red and the composer shows "Model unavailable" + "Open Model access" - honest, no fabricated reply. 10+ samples all red. (06b-down-red.png)

**Check 3 - restart broker -> returns to green automatically.** In ONE held session, with NO user action during the recovery window (the sampler only reads the dot, never crosses surfaces): the dot returned to green **8.0s after the broker became healthy** - within the first ~12s probe interval, comfortably inside the "~2 intervals" (<=24s) target. Purely the background re-probe timer drove it. (06c-recovered-green.png)

Recovery samples (t seconds after broker healthy): red at t=0..7, green at t=8.

**Check 4 - the flicker retest.**
- **Broker UP**: 6 laps crossing Editor(Board Note)<->Editor(Executive Summary) via editor tabs (the active-editor-change remount the flicker fix protects, rail stays mounted), **96 dot samples** at ~55ms. `unique = ["rgb(44,129,89)"]` - green on EVERY sample. `badFlashes = 0`, `nullCount = 0`. The #211-4 flash stays gone. (03-after-crossings.png)
- **Broker DOWN** (killed, waited 35s past TTL): 6 laps, **96 samples**. `unique = ["rgb(181,81,75)"]` - red on EVERY sample. `greenUpFlashes = 0`. The down state stays honestly down across crossings. (05-broker-down-crossings.png)

## Summary

All four live checks clean. Recovery measured at **8.0s** (target <=~24s). Flicker retest: 96/96 green up, 96/96 red down, zero flashes either direction. Unit suite 348 passing, 0 failing, broker down.
