# WP-B adversarial validation - evidence log

Validator: independent Opus adversarial validator (did not see the implementer's conversation).
Branch: `51-b-signin-door` merged with `origin/main` (WP-A broker #284 present). Clean merge, no conflicts.
Environment: macOS, node v24.15.0, `npm run compile` clean (0 errors). Real WP-A broker driven against `scripts/test/lwd-device-auth-stub.js` via `LWD_OPENAI_AUTH_BASE`, fake `HOME=/tmp/wpb-home` (real `~/.abstract/openai-oauth.json` never touched, confirmed).

## Tooling limitation (disclosed in full)

The two sign-in doors both render inside VS Code **webview** surfaces (the Model Access screen editor; the chat-rail Chat tab). In this environment, `@playwright/cli` and raw `connectOverCDP` connect to the Electron renderer and can screenshot / evaluate / dispatch input reliably as the FIRST operations on a fresh launch, but **any interaction that loads or evaluates a webview frame permanently wedges the CDP session** (target enumeration and all subsequent screenshot/evaluate calls time out; a fresh reconnect then also hangs because the webview is registered as a CDP target). This was reproduced deterministically across ~15 fresh launches with three independent drivers (playwright CLI daemon, `connectOverCDP` page API, raw `CDPSession` + `Page.captureScreenshot`). Consequence: I could not click "Sign in with ChatGPT" INSIDE the webview and screenshot the resulting pending/code/expired/error DOM in the running renderer.

To compensate, every state was verified LIVE at the two layers that DO work here and that are load-bearing for the checklist:
1. **The real broker driven against the stub** - the exact bytes the UI's `startChatGptSignIn`/`pollChatGptSignIn` consume, for every state branch.
2. **The real compiled render path** (`renderScreenHtml`) via the electron unit-test runner - the exact HTML the webview paints for each state.
Plus a full read of the UI wiring in `livingDocsService.ts`, `screenEditor.ts`, `reviewRailView.ts`, `screenRenderMisc.ts`.

## Live broker <-> stub transcripts (curl against the real broker on :8090)

### Signed-out / pending / signed-in (STUB_MODE=instant)
```
POST /auth/openai/signout -> {"ok":true,"state":"signed-out"}
GET  /auth/openai/start    -> {"ok":true,"userCode":"WDJB-MJHT","verificationUri":"http://127.0.0.1:41999/codex/device","expiresIn":900,"interval":5}
   (note: NO verificationUriComplete - matches "real upstream never supplies it"; door works from userCode + verificationUri alone)
GET  /auth/openai/status   -> pending ... -> {"ok":true,"state":"signed-in","email":"founder@example.com"}
```
Bundle written 0600 to fake HOME: `-rw------- /tmp/wpb-home/.abstract/openai-oauth.json`. Real HOME bundle untouched (mtime 10 Jul).

### Idempotency (hostile probe: sign in twice rapidly)
```
GET /auth/openai/start (x2) -> SAME userCode "WDJB-MJHT" both times
```
Contract's "re-calling returns the SAME pending code" holds -> one device code, no duplicate flow. UI single-poller is enforced by `MutableDisposable` on `_signInPoll` / `_inlineSignInPoll`.

### Upstream rejection (STUB_MODE=error STUB_STATUS=403)
```
GET /auth/openai/start -> {"ok":false,"reason":"could not start sign-in (upstream 403)","upstreamStatus":403,
                           "upstreamBody":"{\"error\":\"invalid_client\",...}"}
broker stdout: [lwd-proxy] /auth/openai/start failed: ... (upstream 403: {"error":"invalid_client",...})
```
Matches the contract failure shape -> UI maps to `kind:'upstream-rejected'` and renders "OpenAI responded with 403 · {body}". Broker logs the full body (issue #120 diagnosability).

### Expired (STUB_MODE=expired)
```
GET /auth/openai/start -> mints code
GET /auth/openai/status -> pending, pending, ... -> {"ok":true,"state":"expired","reason":"the sign-in code expired before it was approved"}
```

### Broker down (supervisor cannot respawn - broker was adopted, not spawned)
```
broker killed; :8090 not listening; curl /auth/openai/start -> connection refused (exit 7)
```
-> UI catch returns `kind:'broker-unreachable'`, "The local model helper isn't running or can't be reached."

### Restart-while-signed-in (state survives via the bundle)
```
sign in -> signed-in; kill broker; restart broker -> status STILL {"state":"signed-in","email":...}
```

## Live app confirmation
- App launches, adopts my broker: code.log `[livingDocsBroker] an existing broker is already healthy on 127.0.0.1:8090; adopting it (not spawning)`.
- Screenshots: `live-01-app-loaded.png`, `live-02-workbench-review-rail.png` (the native chat rail), `live-03-home-webview.png` (fully-rendered Home webview).
- Observed unrelated: broker `/event` POST is blocked by CORS from the renderer (No Access-Control-Allow-Origin). Pre-existing, not WP-B; the auth routes are same-flow but `/event` is analytics only.

## Render-path tests (real compiled renderScreenHtml, electron runner)
`livingDocs screenRender`: **72 passing, 0 failing**, incl. the two WP-B tests:
- "a pending sign-in renders the device code (copyable) + the verification link, and honours the poll interval"
- "every sign-in failure names its real, visually distinct state (broker-down / upstream-rejected / expired)"

## Code checks
- `grep -rn "is the model connected" src/` -> **0 matches**.
- `startChatGptSignIn` returns `IChatGptSignInStart` discriminated union; the silent-`undefined` catch is gone; failures propagate typed (`broker-unreachable` / `upstream-rejected` / `broker-error`). `livingDocsService.ts:4701-4742`.
- `verificationUriComplete` used when present: `openUri = start.verificationUriComplete ?? start.verificationUri` (`screenEditor.ts:1113`); door renders from `verificationUri` alone when absent (`screenRenderMisc.ts:48-76`).
- Poll interval floored + honoured: `Math.max(1000, start.interval*1000)` on both doors (`screenEditor.ts:1116`, `reviewRailView.ts:506`), driven by `disposableTimeout(..., _signInPollMs)`.
- `npm run typecheck-client` clean; `npm run valid-layers-check` clean (0 errors, no livingDocs violations).
