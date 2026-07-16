# Bundle B live E2E evidence - 2026-07-16

## (a) Broker auto-spawned by the app (no manual step)
```
$ curl http://127.0.0.1:8090/healthz
{"ok":true,"backend":"openrouter","reason":"ready","meters":true,"signedIn":true,"dailyBudgetUsd":1,"dailyTotalUsd":0.000044}
```
Main-process supervisor log: see c-supervisor-restart.log (spawn -> listening -> healthy).

## (b) Chat reply streams through the auto-spawned broker (OpenRouter key present)
```
$ curl -X POST http://127.0.0.1:8090/v1/messages -d {...one-sentence prompt...}
stop_reason: end_turn
reply: Use clear and concise language.
```

## (d) No stale strings
```
$ grep -rn "lwd-anthropic-proxy" src/   (only the test asserting absence)
src/vs/workbench/contrib/livingDocs/test/browser/fanoutOutcome.test.ts:31:		assert.ok(!/lwd-anthropic-proxy|local proxy|\.sh/.test(outcome.content), 'never references a shell script');
$ grep -rn "Start the local proxy" src/
NONE
```

## (e) No ERR_CONNECTION_REFUSED for 8090 in the live session
renderer console logs containing ERR_CONNECTION_REFUSED: 0

## Unit tests

- All directly-modified tests pass: fanoutOutcome.test.ts (14) and the settings provider-picker / included-tier / signed-in / plain-words screenRender tests (12/12 of the ones this change touches).
- Pre-existing failures NOT caused by this change (verified identical on `main` @60401cabbf4, the branch point): screenRender "onboarding open step intro headline", "home resume banner", "home From sources... row", and "pending sign-in waiting for your browser". These are in unrelated onboarding/home/pending-sign-in surfaces and were already red on main.

## Notes

- typecheck-client: clean. valid-layers-check: clean.
- OpenRouter key present on this machine (~/.config/lwd-openrouter.key), so /healthz reports reason=ready and chat replies stream (case b: reply streams).
- Kill-on-shutdown: the graceful user-quit path (onWillShutdown, Cmd-Q / window close) SIGTERMs the broker via the same idiom ElectronAgentHostStarter uses; a raw `kill -TERM` to the Electron main process (a developer action, not an end-user shutdown) bypasses the JS lifecycle handlers, so a synchronous process 'exit' safety net was added as well.
