# Rail 47-b - validation round 2, focused (#236)

Focused adversarial re-validation of the D1 fix (down->up recovery within a session) on bundle 47-b, branch `v2/rail-b`, head `7bc6fcd71e4`. Round 1 already ticked all 7 checklist boxes (PASS); D1 was filed as the one defect and fixed in round 2 with a ref-counted, down-only re-probe interval. This round confirms the fix is real and regression-free. Fresh Playwright session against the real broker; the numbers below were reproduced independently, not copied from the implementer.

## Environment

Worktree `abstract-v2-rail`, branch `v2/rail-b`, head `7bc6fcd71e4`. Node 24.15.0. `npm run transpile-client` (clean). App: `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082` (bare URL). Broker `scripts/lwd-model-broker.sh` on `127.0.0.1:8090`, backend `openrouter`, real `~/.config/lwd-openrouter.key` present. Driven headless via Playwright 1.56 (chromium-1217), viewport 1440x900, DPR 2. The rail composer + model dot are reached by opening a document (Editor surface) and clicking `Ask AI` (the Chat rail lives in the auxiliary bar); the dot span is a 6x6 border-radius-999 element whose background is `modelHealthDotColour(readiness)` - green `#2c8159` = rgb(44,129,89), red `#b5514b` = rgb(181,81,75).

## Static checks

- `typecheck-client`: clean (exit 0).
- `valid-layers-check`: clean (exit 0).
- `test.sh --grep livingDoc` (broker DOWN, hermetic): **348 passing, 0 failing**. Accounting: 345 (round-1 baseline) + 3 new D1 tests in `modelSelector.test.ts` = 348. The `--grep D1` sub-run confirms exactly the 3 new model-selector cases pass.

### The 3 new D1 tests, read critically

`modelSelector.test.ts` adds a `createFlagService(reprobeMs)` helper that drives `/healthz` from a MUTABLE `brokerUp` flag (not a positional sequence), a `setBrokerDownReprobeMsForTest` seam to shorten the interval, and a `waitFor` budget poller. The three cases pin the fix's invariants on OBSERVABLE counters (healthz call count, onDidChange count, settled readiness), not internal flags:

1. **down + watched -> probes on the interval and transitions up EXACTLY once** - asserts `reprobedWhileDown`, `finalReadiness: 'ready'`, `changesForRecovery: 1` (exactly one onDidChange for the real down->up flip), and `timerStoppedAfterRecovery` (probe count freezes once green). This is the D1 recovery + the "no churn" guarantee in one deepStrictEqual.
2. **up + watched -> NO interval probing** - `intervalProbes: 0` after several interval periods. Proves the flicker fix's UP path (settled cache, TTL-only refresh) is untouched.
3. **disposing the watcher stops the interval (no orphan timer)** - probe count is frozen after `watch.dispose()`. Proves the ref-count teardown.

The tests would go red if the fix regressed: they read the real probe/change counters, so a broken watcher gate, a churning onDidChange, or a leaked timer each fails a field. Sound, minimal-assertion, deterministic.

## Live evidence (reproduced independently)

**Broker UP -> green.** Composer control reads `Included model` with a green dot rgb(44,129,89). (01-composer-green.png)

**Flicker lap-set (broker up):** 5 Editor<->Home laps, continuous ~50ms sampling of the dot. **201 mounted samples, ALL green (rgb(44,129,89)), 0 non-green flashes.** (On the Home side the rail unmounts and the dot is correctly ABSENT - not a flash.) The #211-4 flicker stays fixed. (02-flicker-laps.png)

**Kill/restart cycle x2 - recovery WITHOUT user action.** After each kill, waited past the 30s cache TTL and crossed surfaces to force the up->down detection; the dot turned red rgb(181,81,75) and the composer footer read the honest words "**Model unavailable · Open Model access**". Then the broker was restarted and the session was polled READ-ONLY (no clicks, no navigation, no typing) until green:

| Cycle | Down (red + honest words) | Recovered to green, no user action |
| --- | --- | --- |
| 1 | yes - "Model unavailable" | **8.89s** |
| 2 | yes - "Model unavailable" | **8.87s** |

Both recoveries ~9s, well under the ~24s (2x interval) expectation, and the ref-count/timer survived the repeated cycle. (03a/03b cycle 1, 04a/04b cycle 2.)

## Quick regression

- **Popover opens:** clicking the model control opens the grouped popover with the `Included` heading and the current model row checked. (05-popover.png)
- **Real send works:** typed a doc-grounded question and pressed Enter; network trace shows a **POST http://localhost:8090/v1/messages**, and the reply carried **`#1E5BFF`** - the real primary-colour hex from the design-tokens document, i.e. a genuine broker-routed model answer, not the heuristic fallback. (06-real-send.png)
- **47-a tabs/badge intact:** the rail shows Chat / Review / History tabs; the three-tab shell and line addresses are unchanged. (07-47a-tabs.png)

## Verdict

**PASS.** D1 is genuinely fixed: down->up recovery returns the composer to green within ~9s with no user action, twice over, without reintroducing the flicker (201/201 green) and without churn or orphan timers (the 3 tests + the read-only recovery both prove it). No regressions in the popover, the real send, or the 47-a shell. 348/0 tests, clean typecheck + layers.
