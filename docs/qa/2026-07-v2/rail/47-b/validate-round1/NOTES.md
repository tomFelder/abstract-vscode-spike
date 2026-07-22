# Rail 47-b - validator round 1 (#236)

Adversarial validation of the composer model selector (plan 47 pin 14, criteria P14.1-P14.6 + PV.3). Fresh eyes, refute-not-confirm. All checks re-run independently; the live evidence was captured with a fresh Playwright session against the real broker, not the implementer's numbers.

## Environment

Worktree `abstract-v2-rail`, branch `v2/rail-b`, head `eecfe207b90`. Node 24.15.0. `npm run transpile-client`; `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082` (bare URL). Broker `scripts/lwd-model-broker.sh` on `127.0.0.1:8090`, backend `openrouter` (model `openai/gpt-4.1-mini`), real `~/.config/lwd-openrouter.key` present. Driven headless via Playwright 1.56 (chromium-1217 chrome-for-testing), viewport 1440x900, DPR 2.

## Static checks (broker DOWN, hermetic - per the implementer's env note)

- `typecheck-client`: clean (exit 0).
- `valid-layers-check`: clean (exit 0).
- `check-seams.sh`: OK - all shell seams intact, ZERO core seams.
- `test.sh --grep livingDoc`: **345 passing, 0 failing** with the broker down. Accounting: 340 baseline + 5 new (`modelSelector.test.ts`); the `--grep "model selector"` sub-run confirms exactly 5. (The implementer's "340+1+5=346" breakdown is arithmetically off by one; the 47-a test was already in the 340 baseline. Total 345 is correct, 0 failures.)

Diff audit: the broker `/models` route change is purely additive (adds a `tier` field; older renderers read id/label/default unchanged). `common/livingDocs.ts` adds `ModelTier` + a `tier` field additively. The service change is a settled-status cache firing `onDidChange` only on a real change. No credentials/API keys/hardcoded broker URLs reach the renderer (grep of the full diff: only NOTES.md config + the existing credential-free `_proxyUrl()` proxied `/healthz` + `/models` reads). Decision-14 routing intact. The 5 new tests cover: honest colour/words mapping, settled-cache reuse (0 added probes), no spurious onDidChange churn, WORKSPACE persistence under `livingDocs.v2.model`, stale-id->default. (Note: tier *grouping* itself is DOM-only and not unit-tested - only that the catalogue carries `tier`.)

## Live evidence (broker UP) - reproduced independently

**P14.1 row order** (measured x, left->right): `+ Skill` x1077 w53 - `@` x1134 w30 - spacer DIV x1168 w71 - `Included model` control x1243 w129 - send `↑` x1376 **w28 h28 radius 8px** accent oklch(0.55 0.13 255). Order exact, spacer present. (01-composer.png)

**P14.2 control**: text `Included model▾`; font `11px ui-monospace, "JetBrains Mono", monospace` (mono, 11px); color `rgb(134,139,149)` = **#868B95**; border `0px none`; background transparent (no border/bg at rest). Health dot 6x6, `rgb(44,129,89)` = **#2C8159**, radius 999px. Hover reveal: bg -> `rgb(246,247,249)` (#F6F7F9), color -> `rgb(82,87,95)` (#52575F). (01-composer.png)

**P14.3 popover**: heading `INCLUDED` (uppercase, mono); one row `Included model`, check `visible` (current checked), per-row dot `rgb(44,129,89)` green. (02-popover.png) Single-model caveat (see adjudication below).

**P14.3 real call (the strongest proof)**: typed a doc-grounded question, clicked send. Network trace shows a **POST /v1/messages**; broker logged `/v1/messages backend=openrouter requested="openai/gpt-4.1-mini" resolved=openai/gpt-4.1-mini`; reply was genuinely doc-grounded ("The document defines the primary colour as blue with the hex code #1E5BFF" - matches the doc), not the heuristic fallback. Decision-14 upheld (call via broker, no renderer credential). (03-real-call.png)

**P14.3 single-model adjudication**: live openrouter serves exactly ONE included model, so `/models` returns one `tier:"included"` entry and the popover renders one `Included` group with one row. The two-group (included vs own-key) structure is therefore NOT observable live. It is proven by: (a) the broker `/models` route emitting `tier` per model (`own-key` for the openai-oauth backend), verified by reading `modelsForBackend`; (b) the renderer's tier-grouping loop in `_openModelPopover` (reviewRailView.ts), which iterates `included` then `own-key` groups and renders only non-empty ones. Verdict: **P14.3 as written is satisfiable** - the grouping code is present and correct; only the second group cannot be exercised live with a single-model backend. This is an environment limitation, not a code gap.

**P14.4 persistence**: not live-observable (single model). Proven by unit test: persists under `livingDocs.v2.model` at WORKSPACE scope (matches spec 43 s3.5 line 106), stale/unknown id resolves to default, unknown id never persisted. Storage key + scope read directly in the diff.

## THE FLICKER TEST (P14.5 / #211-4) - reproduced numerically, both directions

- **Broker UP**: 6 laps Editor->Home->Editor, **72 dot samples** at ~60ms across the crossing windows. `unique = ["rgb(44,129,89)"]` - green on EVERY sample. `badFlashes (red/grey) = 0`. The #211-4 flash is gone.
- **Broker DOWN** (killed, waited 35s past the 30s TTL): 6 laps, **72 samples**. `unique = ["rgb(181,81,75)"]` - red (#B5514B) on EVERY sample. `greenUpFlashesWhileDown = 0`. The down state stays honestly down. Control read "Model unavailable"; the honest first-use model-access gate rendered on a send attempt (no fabricated reply). (04-broker-down.png)

## DEFECT D1 - no down->up recovery within a session (recovery-TTL requirement fails)

The recovery half of validation item 3 FAILS. Reproduced in a single held session:
1. broker UP -> dot green;
2. kill broker, cross past the 30s TTL -> dot correctly red (honest down);
3. restart broker (confirmed `/healthz` `ok:true reason:ready`);
4. the control NEVER recovers to green - measured across: 65s pure idle; 35s idle + 2 surface crossings; a further 5 crossings over 38s; and even a **real chat send** - all stayed red. Network capture during the recovery window: **0 /healthz probes fired**.

Root cause: the flicker fix made `getModelProviderStatus()` return the settled `broker-down` cache instantly and refresh in the background ONLY when the cache is stale (>=30s since the last probe). But the only thing that calls `getModelProviderStatus()` is `_refreshSignedIn()`, and `_refreshSignedIn()` is invoked ONLY on the service's `onDidChange` (reviewRailView.ts:246) - NOT on `onDidActiveEditorChange` (:251, which calls `_render()` only) and NOT on any periodic timer (the service has no status poll). Because a settled cache fires `onDidChange` only on a REAL change, and no unrelated `onDidChange` happens during idle/crossings/a chat send, `getModelProviderStatus()` is never called again, so the recovered broker is never rediscovered and the composer is stuck red for the rest of the session. Additionally, each stale re-probe resets `_providerStatusAt`, so a broker that recovers between two sub-30s reads keeps the cache "fresh-broker-down" and further defers rediscovery.

Impact: P14.5's own checkbox wording (honest down-state, honest chat failure, no flicker) is technically met - it does not mention recovery - so this does not fail the P14.5 checkbox. But it is a real product regression the flicker fix introduced: before this PR every read re-probed. Filed as D1 for a round-2 fix (e.g. a low-frequency status poll that fires `onDidChange` on a real change, or calling `_refreshSignedIn` on `onDidActiveEditorChange`).

## P14.6 / #120

Out of scope, not failed on. The PR comment carries the #120 state line and links it; the selector honestly shows whatever backend is active now (openrouter `signedIn:true`) and never fabricates the ChatGPT door's state. Confirmed.

## Regression (47-a)

The three-tab rail (Chat/Review/History), line addresses, and the chat send path all render and function; the quiet shell is intact (the composer only speaks its honest model state). No regressions observed.
