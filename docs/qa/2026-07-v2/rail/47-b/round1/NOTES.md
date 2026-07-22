# Rail 47-b - implementer round 1 (#236)

The composer model selector (plan 47 pin 14, criteria P14.1-P14.6 + PV.3). Live-verified with the broker UP and DOWN; the #211-4 flicker fix is proven numerically in both directions.

## Environment

Worktree `abstract-v2-rail`, branch `v2/rail-b`. Node 24.15.0; `npm run transpile-client`; `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082` (bare URL). Model broker `scripts/lwd-model-broker.sh` on `127.0.0.1:8090`, backend `openrouter` (model `openai/gpt-4.1-mini`), reached via the default `livingDocs.modelProxyUrl`. Driven headless via Playwright (viewport 1440x900, DPR 2).

Env note (recorded for the validator): the hermetic model-stub tests in `livingDocsService.test.ts` FAIL if a real broker is listening on 8090 - the streaming chat path's raw `fetch` reaches the live broker instead of the mocked request service, so those tests hit the heuristic fallback and their canned-reply assertions fail (16-18 flaky failures). Kill the broker before running the suite; then the suite is a clean 345/0. This is the plan's documented "hermetic regardless of any real proxy" contract failing only because the proxy is on the exact default port.

## Static checks (all clean, broker killed)

- `typecheck-client`: clean (exit 0).
- `valid-layers-check`: clean (exit 0).
- `check-seams.sh`: OK - all shell seams intact. ZERO core seams touched.
- `test.sh --grep livingDoc`: **345 passing, 0 failing**. Baseline was 340 (main) + 1 (47-a's revealBlockAddress) + **5 new** (modelSelector.test.ts): the readiness->dot/words honest mapping, the settled-status cache reuse (flicker fix), no-spurious-onDidChange churn, WORKSPACE-scope persistence under `livingDocs.v2.model`, and stale-id-resolves-to-default.

## Live numeric evidence (broker UP)

P14.1 row order (measured x, left->right): `+ Skill` x1077 w53 · `@` x1134 w30 · spacer DIV x1168 w71 · `Included model` control x1243 w129 · send `↑` x1376 **w28**. Order exact; spacer present. Send = 28px accent square radius 8. (round1/07-action-row-zoom.png, 01-composer-full.png)

P14.2 control: text "Included model▾"; `fontFamily: ui-monospace, "JetBrains Mono", monospace` (mono); `fontSize: 11px`; `color: rgb(134,139,149)` = **#868B95**; `border: 0px none`; `background: rgba(0,0,0,0)` (no border/bg until hover). Health dot: 6x6, `rgb(44,129,89)` = **#2C8159** (green ready), radius 999px. (07-action-row-zoom.png)

P14.3 popover: group heading `INCLUDED` (mono uppercase); one row `Included model` with `hasCheck: true` (current model checked) and per-row dot `rgb(44,129,89)` (green). (round1/02-popover-open.png)

P14.3 real call: the send routed through the broker - broker log line `/v1/messages backend=openrouter requested="openai/gpt-4.1-mini" resolved=openai/gpt-4.1-mini`, and the chat produced a genuine document-grounded reply ("This document defines specific design tokens...") - not the heuristic fallback. Decision 14 upheld (call through the broker, no credential in the renderer). (round1/04-real-call.png)

## THE FLICKER TEST (P14.5 / #211-4) - numeric, both directions

Broker UP: crossed Editor -> Home -> Editor **6 laps**, sampling the control dot at **12 samples/lap (72 total)** at ~60ms cadence. `badFlashes: 0` - the dot never became red (#b5514b broker-down) or grey (#c6cad2 checking) mid-crossing; it stayed green throughout. BEFORE and AFTER both green. (round1/03-after-crossings.png)

Broker DOWN: killed the broker, waited past the 30s status TTL, then crossed **6 laps x 10 samples (60 total)**. `greenUpFlashesWhileDown: 0` - the down state STAYS down; no transient green up-flash. The control read `label: "Model unavailable"`, `dot: rgb(181,81,75)` = **#B5514B** (removed-ink) the whole time. (round1/05-broker-down.png)

Root cause + fix: `getModelProviderStatus()` previously did a fresh `disableCache` /healthz probe every call. The rail is torn down and rebuilt on a surface crossing, so its instance `_readiness` field starts undefined each mount; the fresh probe raced and the composer briefly showed broker-down before it resolved ready. Fix: the SERVICE now caches the last SETTLED status (`_providerStatus`/`_providerStatusAt`) and returns it INSTANTLY on a repeat read, refreshing behind the scenes on the TTL and firing `onDidChange` ONLY on a real change (`providerStatusEquals`). A remount reads the settled state with no probe on the critical path, so the dot never blinks. The cache is expired on a deliberate door change (sign-in/out, `chooseIncludedModelAndReplay`) so a real transition still reflects immediately.

## Honest failure (P14.5) + P14.6 / #120

Broker DOWN chat send: the honest first-use model-access gate rendered ("Choose how to run your request", typed prompt preserved) - no fabricated reply. The control read "Model unavailable" throughout. (round1/06-honest-failure.png)

P14.6 / #120: OUT of scope, not failed on. The broker's `signedIn:true` on the openrouter backend (the door does not switch mid-session after a ChatGPT sign-in) is the #120 quirk; the selector honestly shows whatever backend is active NOW. Linked in the PR comment.

## Persistence (P14.4)

Live: only one included model exists on the openrouter backend, so a live switch is not observable. The unit test proves it authoritatively: the choice persists under `livingDocs.v2.model` at **WORKSPACE** scope (43 §3.5), a stale/unknown persisted id resolves to the catalogue default (never a dead selection), and an unknown id is never persisted. (modelSelector.test.ts)

## Broker route change (additive)

`scripts/lwd-model-broker.js` `/models` now carries a `tier` field per model (`included` | `own-key`) for the popover grouping. Additive: an older renderer that ignores `tier` still reads id/label/default unchanged; a broker without `tier` coerces to `included` in the renderer. Verified live: `curl /models` -> `{"id":"openai/gpt-4.1-mini","label":"Included model","default":true,"tier":"included"}`.
