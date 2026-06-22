# 10 — Model integration (Anthropic OAuth proxy)

How the Living Documents agentic features became **model-backed**. Implemented on
`living-docs-model` (PR #11); drove by [plans/10-anthropic-oauth-handoff.md](plans/10-anthropic-oauth-handoff.md).
Resolves the long-standing `NO MODEL` / heuristic-only state for Review-impact rewrites and the
Strategy grader, while keeping the no-model fallback fully intact.

## The constraint

`livingDocsService` runs in the **browser/renderer** (the VS Code web build served by
`@vscode/test-web`). A credential must never be embedded there. OAuth login (`ant auth login`)
authenticates to the Claude **Developer Platform** and bills the Anthropic **Console org** — it is
*not* a claude.ai Pro/Max subscription.

## Architecture — credential stays server-side

```
renderer (livingDocsService)            localhost proxy (Node 24)              Anthropic
  _hasModel ─ GET /healthz ─────────────▶ { ok: true }
  _modelImpact   ┐                        per request:
  _gradeStrategy ┴ POST /v1/messages ───▶  ant auth print-credentials ──▶ (fresh OAuth token, 60s cache)
                                           POST api.anthropic.com/v1/messages
                                             Authorization: Bearer <token>
                                             anthropic-version: 2023-06-01
                                             anthropic-beta: oauth-2025-04-20
  ◀──────────── Anthropic Messages JSON ───┘
```

- **`scripts/lwd-anthropic-proxy.js`** (+ `.sh`) — dependency-free, binds `127.0.0.1:8090`. Fetches a
  fresh token per request via `ant auth print-credentials --access-token` (which auto-refreshes),
  caches ~60s. Unsets `ANTHROPIC_API_KEY` in its env so it can't shadow the OAuth profile. `/healthz`
  for probing; permissive CORS (safe because localhost-bind only). Never logs or persists the token.
- **No CSP/CORS changes were needed.** `code-web.sh` serves from **sources**, and in that mode
  `@vscode/test-web` sets no `connect-src` CSP — so the renderer reaches the proxy purely via CORS,
  which the proxy controls. (A standalone proxy was the plan's fallback option; the sources-build
  finding made it the *cleanest* option.)

## Service wiring (`livingDocsService.ts`)

- `_hasModel()` — probes the proxy `/healthz`, caches the result with a short TTL (so starting the
  proxy mid-session is picked up), and fires `onDidChange` when availability flips.
- `_modelImpact(diff, contextFiles, oldText)` — POSTs the proxy and returns
  `{newText, kind, confidence, rationale, via:'model'}`. On a `stop_reason:"refusal"`, transport
  error, or bad JSON it throws, and `_proposeImpact` falls back to `_heuristicImpact`.
- `_gradeStrategy(state, changes)` — model-backed claims-vs-decision-stack check (the `context`
  sources are the decision stack). Returns the honest `{pass:true}` on no-model/error/refusal so the
  verify gate never blocks on the proxy being down. `runSkillCheck()` runs it on demand from the
  Skills rail; the Strategy row reads `NO MODEL` → `READY` → real `PASS`/`FLAG`.
- The unused `ILanguageModelsService` dependency was dropped (no LM provider exists in the web build).

## Request shape

`claude-opus-4-8`, `thinking:{type:"adaptive"}`, `output_config:{effort:"low"}`, `max_tokens` 1024.
No `temperature`/`top_p`/`top_k`/`budget_tokens` (Opus 4.8 rejects them). Responses are parsed by
narrowing `content[]` to `type:"text"`; `stop_reason:"refusal"` is handled, not crashed.

## Config

- `livingDocs.modelProxyUrl` (default `http://localhost:8090`) — the proxy base URL.
- `livingDocs.commentaryModel` — Claude model id (defaults to `claude-opus-4-8`).
- `livingDocs.useModel` — master off-switch (forces the heuristic path).

## OpenRouter test backend (dev only)

The proxy has an optional **test backend** (`LWD_BACKEND=openrouter`) that translates the Anthropic
Messages request to OpenRouter's OpenAI-style chat API and the response back into the Anthropic
Messages shape the service parses. It let the live flow be verified against a cheap model
(`openai/gpt-4o-mini`) while the Anthropic Console org had no credits. Key comes from
`OPENROUTER_API_KEY` / `OPENROUTER_API_KEY_FILE` at runtime, never committed. The default path is
unchanged (Anthropic OAuth). Run it with:

```sh
LWD_BACKEND=openrouter OPENROUTER_API_KEY_FILE=~/.config/lwd-openrouter.key ./scripts/lwd-anthropic-proxy.sh
```

## Verification (live)

All acceptance criteria met — screenshots in [model-verify/](model-verify/):

| # | Criterion | Result |
|---|---|---|
| 1 | `ant` login + `ready` | ✅ via proxy |
| 2 | Workbench reaches proxy, no CSP/CORS | ✅ `/healthz` + `POST /v1/messages` both 200; zero CSP violations |
| 3 | Review impact → real model rewrite; approve applies | ✅ tone-aware meaning change, 90% confidence |
| 4 | Strategy real PASS/FLAG (not `NO MODEL`) | ✅ |
| 5 | Proxy down → app works on the honest fallback | ✅ Strategy back to `NO MODEL`, no crash |

Plus 3 new unit tests (model rewrite, refusal→heuristic, Strategy verdict); `typecheck-client` clean;
45 tests green.

## Known follow-up

The Anthropic Console org (`Inspace`) needs **API credits** for the production OAuth path — it
authenticates correctly and only 400s on the billing balance. Adding credits unblocks it with no
code change (restart the proxy in its default Anthropic mode).
