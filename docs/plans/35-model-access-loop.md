# Plan 35 - Model access for beta: OpenAI OAuth in, Anthropic usage out, OpenRouter capped

> **For agentic workers:** implement with `superpowers:subagent-driven-development`; small, live-verified, stacked PRs off `main`.
> Context of record: [18-beta-plan.md](../18-beta-plan.md) §2.1 (the decided stance, the accepted risk, the $1/user/day cap); the existing proxy architecture in [10-model-integration.md](../10-model-integration.md); the spend event in [15-metrics-and-instrumentation.md](../15-metrics-and-instrumentation.md) §3.1.

**Goal:** A beta user signs in with their own ChatGPT subscription and every model call in Abstract draws on it; users without one fall back to a founder-funded OpenRouter tier on a good model, capped at ~US$1/user/day with graceful pause-and-resume; the Anthropic usage path is stripped. Nothing else about the agentic features changes.

**Decided stance being implemented (do not re-litigate):** BYO-subscription via the Codex-style OpenAI OAuth token is the primary path; the founder has formally accepted the ToS grey-zone risk (doc 18 §2.1); Anthropic subscription OAuth is prohibited by their terms and the Console-billed path burns unfunded API credit, so both go; paste-your-own-API-key is rejected.

## Architecture notes

- The localhost proxy (doc 10) remains the shape: credentials live server-side in the proxy process, never in the renderer, no CSP changes. The work is swapping what the proxy authenticates against and adding an account/limits layer, not re-architecting.
- The engine speaks the Anthropic protocol internally (Agent Host). The proxy therefore needs a **translation layer** for OpenAI-protocol backends: Anthropic-style request in → OpenAI chat/responses call out → Anthropic-style stream back. The OpenRouter backend already exercises a version of this seam - locate it first and extend, don't duplicate (verify how `living-docs-model`'s OpenRouter test backend maps requests before designing the translator).
- Tool-calling semantics differ between model families; the review-engine contract (proposals with kind/confidence/rationale) is the invariant to protect. Golden-transcript tests: the same fixture prompt must produce schema-valid proposals through both backends.

## Global constraints

- Secrets: OAuth tokens and the founder's OpenRouter key are stored via the plan-29 credential story (or the OS keychain seam it established) - never in settings JSON, never in the repo.
- Plain words in every user-facing string (P5): "Sign in with ChatGPT", "today's included usage", never "OAuth token" or "rate limit".
- All failure modes route through the D15 machinery: a run that loses its backend pauses safely with proposals kept; it never dies or half-applies.
- Ledger discipline: our-surface only expected; any core patch logged in [03-merge-tax-ledger.md](03-merge-tax-ledger.md).
- Tabs; nls strings; Australian English; no em dashes. `typecheck-client` + `valid-layers-check` clean per PR.

## Iteration plan

### Iteration 1 - Strip Anthropic, harden the seam

- Remove the Anthropic Console-OAuth backend from the proxy and every UI reference to it; the provider abstraction that remains should make backends pluggable (openai-oauth | openrouter) behind one interface.
- Keep the no-model heuristic fallback intact (doc 10) - the app must stay demoable with zero backends configured.
- Gate: grep-clean of Anthropic auth surfaces; app runs with no backend (heuristic mode) and with OpenRouter; golden-transcript test passes on OpenRouter.

### Iteration 2 - Sign in with ChatGPT (the Codex-token flow)

- Implement the OAuth device/browser flow in the proxy: sign-in initiated from Settings (and later onboarding), token + refresh stored via the credential seam, silent refresh, clean sign-out.
- The translation layer: Anthropic-protocol requests from the engine are served by the user's subscription-backed OpenAI calls, streaming preserved (plan 27's SSE passthrough is the pattern).
- Honest failure states: token expired → plain-words re-auth prompt; the provider refusing → pause via D15 + "Sign in again or switch to the included model".
- Gate: live E2E - sign in with a real ChatGPT account, run the core loop (chat → proposal → approve) end to end on subscription usage; golden-transcript parity with iteration 1.

### Iteration 3 - The capped OpenRouter fallback

- Model choice: a capable mid-tier model, named in one config constant with the rationale logged - not the cheapest available (P0; doc 18 §2.1).
- Per-user daily budget: default US$1/day, config-constant; spend metered per request in the proxy; at cap, in-flight work finishes its current document, the run pauses via D15, and the composer shows the plain-words message ("You've used today's included usage - picks up tomorrow, or sign in with ChatGPT for unlimited"). Day rollover resumes automatically.
- Emit `model_spend` (provider, cost, running daily total, cap_hit?) per doc 15 §3.1 - to the local audit/log now, wired to PostHog by plan 36.
- Gate: unit tests on the meter (accumulation, cap trip, rollover reset); live E2E with the cap set artificially low - hit it mid-run, verify the pause, the message, kept proposals, and next-day resume (clock injection, not waiting).

### Iteration 4 - Provider picker + survey capture

- First-run/Settings provider step: "Sign in with ChatGPT" primary, "Use the included model" secondary; current provider + session usage visible in Settings per D19 (the ring/usage UI from plans 30/32 reused, not duplicated - P2).
- The onboarding survey fields (daily-driver model, owned subscriptions, what you make weekly) captured at this step and stored for `model_configured` (doc 18 §2.4).
- Gate: fresh-profile E2E - first run reaches a working model through either door in under a minute; survey answers land in the local event log; screenshots to `35-verify/`.

## Acceptance criteria

- [ ] Anthropic usage path fully removed; heuristic no-model fallback intact. _(iter 1)_
- [ ] A real ChatGPT subscription drives the full core loop, streaming included. _(iter 2)_
- [ ] Fallback runs on a named good model with an enforced, tested $1/day cap that pauses gracefully and resumes; `model_spend` emitted. _(iter 3)_
- [ ] Provider picker + survey in first-run and Settings; usage glanceable per D19. _(iter 4)_
- [ ] Golden-transcript proposal parity across both backends; all failure modes pause-not-die.

## Verify approach

Live web E2E per iteration (chrome-devtools MCP) with screenshots to `docs/plans/35-verify/`; the cap trip and rollover proven with injected clock/budget; a fresh-profile first-run recording for iteration 4. No fabricated screenshots; blocked verifications reported as blocked.
