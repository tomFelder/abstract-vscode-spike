# Wire Claude into Living Documents via Anthropic OAuth (clean session)

> **Status: DONE — implemented on `living-docs-model`, PR #11 (off `living-docs-design-match`).**
> Localhost OAuth proxy + `_hasModel`/`_modelImpact`/`_gradeStrategy` wired; no-model fallback intact;
> 45 unit tests green; all acceptance criteria verified live (screenshots in `docs/model-verify/`).
> Live model proof used the proxy's optional OpenRouter test backend because the Anthropic Console
> org had no credits — the production OAuth path authenticates and only stops at the billing balance.
> See decision-log entry 14 and [`../10-model-integration.md`](../10-model-integration.md).

Goal: make the agentic features in the Living Documents spike **model-backed** by calling Claude,
authenticated with the developer's **OAuth login** (no static API key in the repo). This unblocks the
real versions of: Review-impact meaning rewrites, the Chat agent, and the Strategy skill grader. Today
those run on an honest no-model fallback (heuristic suggestions / "NO MODEL" states).

> **Read this first — the auth reality.** OAuth login (`ant auth login`) authenticates to the Claude
> **Developer Platform** and **bills API usage on the Anthropic Console account** — it is *not* the
> claude.ai Pro/Max subscription (that flow is first-party only and not available to custom apps). The
> developer has accepted this. Confirm the Console org has API credits/billing before spinning cycles.

## How the OAuth auth works (accurate, from the Anthropic CLI docs)

- **Install the CLI:** `brew install --cask anthropics/tap/ant` then `xattr -d com.apple.quarantine "$(brew --prefix)/bin/ant"`. (`ant` ships as a Homebrew **cask**, not a formula — `brew install anthropics/tap/ant` without `--cask` fails to resolve it.)
- **Log in (interactive, the developer runs this):** `ant auth login` opens a browser, signs in, and
  stores a short-lived **auto-refreshing** token as a profile under `~/.config/anthropic/`
  (`configs/<profile>.json` + `credentials/<profile>.json`). `ant auth status` shows which credential
  won; `ant auth logout` clears it.
- **OAuth tokens are NOT API keys.** On raw HTTP they go on `Authorization: Bearer <token>` (**not**
  `x-api-key`) **plus** the header `anthropic-beta: oauth-2025-04-20` — `/v1/messages` rejects the
  request without that beta header. The `anthropic-version: 2023-06-01` header is also required.
- **Get a fresh token for a script/proxy:** `ant auth print-credentials --access-token` prints the bare
  token and **refreshes it if needed**. Tokens are short-lived and are **not** auto-refreshed when you
  cache them in an env var — so the proxy should call `print-credentials` per request (or cache with a
  short TTL, e.g. 60s), not read a stale `ANTHROPIC_AUTH_TOKEN` once at boot.
- **The #1 trap:** a set `ANTHROPIC_API_KEY` (even empty) silently overrides the OAuth profile, and
  setting **both** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` makes the API reject the request.
  Ensure `ANTHROPIC_API_KEY` is unset in the proxy's environment. (`ant auth status` confirms.)
- Refresh tokens eventually hard-expire — if calls start 401ing after working, re-run `ant auth login`.

## Architecture — credential stays server-side (do NOT call the API from the browser)

The app is a VS Code web fork served by `@vscode/test-web` at `http://localhost:8080`; `livingDocsService`
runs in the **browser/renderer**. An OAuth token (or any credential) must never be embedded in the
renderer. So:

1. **Stand up a tiny local proxy** (a dependency-free Node script using global `fetch`, Node 24) that:
   - on each request, gets a fresh token via `execFile('ant', ['auth','print-credentials','--access-token'])`
     (cache ~60s);
   - forwards `POST /v1/messages` to `https://api.anthropic.com/v1/messages` with
     `Authorization: Bearer <token>`, `anthropic-version: 2023-06-01`, `anthropic-beta: oauth-2025-04-20`,
     `content-type: application/json`;
   - returns the JSON response. Localhost-bind only; log nothing sensitive.
2. **Make the workbench reach it without tripping CSP/CORS.** The renderer's `connect-src` CSP and CORS
   will likely block a direct cross-origin fetch to a different port. **Brainstorm + spike the routing
   first** (use `superpowers:brainstorming`); the most robust options, in order:
   - **Same-origin route** — expose the proxy under the page origin (e.g. add a `/lwd/anthropic` handler
     to `scripts/code-web.js`'s server, or front both with one local server). No CORS, no CSP change.
   - **Standalone proxy + allow it** — run on its own port and add its origin to the webview/product CSP
     `connect-src` and set permissive CORS on the proxy. More moving parts.
   - Check whether the existing `api`-source path (`livingDocsService` already fetches HTTP `api:` sources
     via `IRequestService`) actually works **live** in the web build — if it does, the same path may carry
     the model call and you can skip a separate transport.
3. **Call it from the service.** In `livingDocsService.ts`, the model hooks already exist and fall back
   gracefully:
   - `_hasModel()` — return `true` when the proxy/model is reachable (probe once, cache).
   - `_proposeImpact` → `_modelImpact(diff, contextFiles, oldText)` — currently throws/falls back to
     `_heuristicImpact`. Implement it to POST to the proxy and return `{newText, kind, confidence,
     rationale, via:'model'}`.
   - `_gradeStrategy(state, changes)` — implement the model-backed claims-vs-decision-stack check the
     Skills "Strategy" agent surfaces (it currently returns the honest `needs-model` state).
   Keep the no-model fallback intact (it's tested) so the app still works with the proxy down.

## Model request shape (defaults)

- Model: **`claude-opus-4-8`** (Anthropic's current Opus; the exact ID string — do not add a date suffix).
- **Adaptive thinking:** `thinking: {type: "adaptive"}`. Do **not** send `temperature`/`top_p`/`top_k`
  or `budget_tokens` — Opus 4.8 rejects them (400).
- Optionally `output_config: {effort: "low"}` for the small, latency-sensitive rewrite/grader calls.
- `max_tokens` ~1024 for these short calls (no streaming needed at that size).
- Body: `{model, max_tokens, thinking:{type:"adaptive"}, system, messages}`. Parse `response.content`
  (narrow to `type:"text"`). Handle `stop_reason: "refusal"` (return the no-model fallback rather than
  crash). Use the SDK if you prefer (`@anthropic-ai/sdk`, `new Anthropic({authToken, defaultHeaders:{
  "anthropic-beta":"oauth-2025-04-20"}})`) — but raw `fetch` keeps the proxy dependency-free.

Reference curl (the canonical OAuth call):

```
curl https://api.anthropic.com/v1/messages \
  -H "Authorization: Bearer $(ant auth print-credentials --access-token)" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "content-type: application/json" \
  -d '{"model":"claude-opus-4-8","max_tokens":1024,"thinking":{"type":"adaptive"},"messages":[{"role":"user","content":"Reply with the single word: ready."}]}'
```

Run that first to confirm login + billing work before touching app code.

## Setup / repo conventions

- Repo `/Users/tommy/Sites/abstract-vscode-spike`. Branch off the merged base (`living-docs-design-match`)
  — e.g. `living-docs-model`. Commit incrementally; PR embeds before/after screenshots.
- Node 24: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`. `npm run watch` (bg) for
  incremental compile to `out/`; `npm run typecheck-client`; tests via
  `./scripts/test.sh --grep "LivingDoc|AgentOrchestrator"`. Run the app: `./scripts/code-web.sh ./living-docs-sample`
  -> :8080, drive with the chrome-devtools MCP (don't pkill its Chrome). Full design-audit context +
  the model hooks are in `docs/design-audit/log.md` and `docs/plans/09-v1-functionality-handoff.md`.
- **Hygiene (husky blocks):** tabs; **no non-ASCII in source** (`\uXXXX` in TS, HTML entities in webview
  HTML); no `in` operator; no `querySelector` in workbench code; single quotes except nls; no raw
  `setInterval`/`setTimeout`; DI non-service ctor args before `@IService`. **Never commit a token or key**
  — the OAuth credential lives only in the developer's `~/.config/anthropic/` profile and is fetched at
  runtime via `ant`. Add any scratch proxy/log files to `.gitignore` or delete them.
  End commits with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Acceptance / verification (live)

1. `ant auth login` done; the reference curl returns `ready`.
2. Proxy up; the workbench reaches it (no CSP/CORS error in the console).
3. **Review impact, model-backed:** change `living-docs-sample/market-research.md`, open the Weekly doc,
   Context panel -> **Review impact**. The queued Commentary change is now a *real* rewrite (tone/claim
   aware), not "...revisit whether this still holds." Approve applies it; Reject reverts. (This is the
   single best end-to-end proof — the approve/reject plumbing already works.)
4. **Strategy skill:** the Skills tab's Strategy agent shows a real PASS/flag against the Knowledge
   decision stack instead of `NO MODEL`.
5. Proxy down -> the app still works on the honest fallback (no crashes); `_hasModel()` returns false.
6. Typecheck clean; existing tests green; restore the sample workspace to pristine after manual testing.

## Paste into the fresh session

```
Wire Claude into the Living Documents spike using my Anthropic OAuth login (ant auth login), following docs/plans/10-anthropic-oauth-handoff.md. First brainstorm the proxy/CSP routing with me, then: stand up a localhost-only proxy that fetches a fresh OAuth token via `ant auth print-credentials --access-token` and forwards /v1/messages to api.anthropic.com with Authorization: Bearer + anthropic-beta: oauth-2025-04-20; make the workbench reach it without tripping CSP; implement livingDocsService _hasModel / _modelImpact / _gradeStrategy to call it (model claude-opus-4-8, thinking adaptive), keeping the no-model fallback intact. Verify live that Context -> Review impact now produces a real model rewrite and approve/reject still works. Never commit any token. Branch living-docs-model off living-docs-design-match; commit on a PR with screenshots.
```
