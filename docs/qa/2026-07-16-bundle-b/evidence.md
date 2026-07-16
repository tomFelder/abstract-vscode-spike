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
