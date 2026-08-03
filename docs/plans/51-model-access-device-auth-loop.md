# Plan 51 - Model access: device auth + one honest serving door

**Status:** authored 3 Aug 2026, ready to run first (it gates the founder using the app daily). **Decisions:** 176. **Root issue:** #120. **Protocol:** decision 174 (Fable orchestrator + Opus implementers + Opus adversarial validators, exchange on open PRs). **Run prompt:** §7 below.

## 1. What this wave is

The founder cannot use the product because the model door doesn't open. Three verified facts from the 3 Aug triage:

1. OpenAI has moved the subscription models to a **new model set reached via the Codex device-authorization flow**; our broker still implements the loopback-redirect OAuth flow in `scripts/lwd-openai-oauth.js`, so sign-in cannot succeed against the current upstream.
2. Even when sign-in succeeded historically, calls failed - the broker fixes its backend at spawn via `LWD_BACKEND` (default `openrouter`) and never switches after sign-in. This is #120's documented root cause; `scripts/lwd-model-broker.js` (~572) carries the "#120 note" comment at the exact spot.
3. Failures are dishonest: `livingDocsService.startChatGptSignIn` (~4701) swallows every error into `undefined`, so the UI can only say "Could not start sign-in - is the model connected?" (`screenEditor.ts` ~1085) whatever actually happened.

The wave ends when the founder signs in with his ChatGPT subscription on his own machine, a real chat round-trips on a new-set model, and killing the OAuth path degrades honestly to the OpenRouter fallback. UX bar (founder-set): early beta - plain is fine, **works and never lies** is mandatory.

## 2. Work packages

| WP | What | Owner lane |
|---|---|---|
| **A - Device-auth core** | Rebuild the auth core of `scripts/lwd-openai-oauth.js` to the RFC 8628 device-authorization flow: `/auth/openai/start` returns `{ userCode, verificationUri, verificationUriComplete?, expiresIn, interval }`; the broker polls the token endpoint honouring `interval`/`slow_down`/`authorization_pending`/`expired_token`; bundle (access + refresh + expiry) stored 0600 at `~/.abstract/openai-oauth.json`, refresh handled transparently; `/auth/openai/status` reports `pending / signed-in / expired / error` truthfully. | broker |
| **B - The sign-in door** | Model Access screen + the chat-rail door render the device code and verification link (link opens the browser; code is copyable in one click), live-poll the status, and flip to signed-in. Every failure names its real state - **broker not running** / **broker unreachable** / **upstream rejected (status + short body)** - replacing the silent-`undefined` catch and the "is the model connected?" string. | UI |
| **C - Per-request backend selection (#120)** | `/v1/messages` chooses the backend per request: `openai-oauth` when the bundle is valid and unexpired, else `openrouter`. `/models` merges both catalogues with per-backend health; the composer selector reflects it. `LWD_BACKEND` demotes to an explicit dev override. Failed upstream forwards log status + body to broker stdout (issue #120's diagnosability ask). | broker |
| **D - Catalogue + fallback proof** | Model ids become data, not code: live-list models where the token allows; otherwise a config file (`~/.abstract/models.json`) merged over the built-in defaults, so a new model id never needs a broker edit. OpenRouter fallback proven end-to-end with the founder key (`~/.config/lwd-openrouter.key`), the $1/day cap path exercised, broker auto-start verified on a cold desktop launch. | broker + UI |

**WP-A step 0 is a research task, not a coding task.** The device-auth endpoints, client id, scopes, poll semantics and the new set's model ids MUST be read from the current Codex CLI source (github.com/openai/codex) and OpenAI's current docs at implementation time - never from model training data, which predates this flow. Findings land in `docs/plans/51-verify/upstream-notes.md` (endpoints, ids, evidence links) before any broker code changes, and the validator independently checks the notes against the same sources.

## 3. Acceptance floor (the checklist the PRs carry)

- [ ] Cold desktop launch, zero env vars: the broker auto-starts (adopt-or-spawn supervisor) and clicking "Sign in with ChatGPT" shows a device code + verification link within 5 seconds.
- [ ] The founder completes sign-in on his real ChatGPT subscription; status flips without an app restart; the first chat round-trips on a new-set model. (Founder-in-the-loop - see §5.)
- [ ] With a valid bundle, `/v1/messages` serves via `openai-oauth`; with the bundle removed or expired, the SAME chat round-trips via OpenRouter with the founder key, and the composer selector names which door served.
- [ ] Broker down (respawn blocked): sign-in and chat both say the local model helper isn't running - the string "is the model connected?" no longer exists in the tree.
- [ ] Upstream rejection (forced 4xx via stub): the UI shows status + plain-words reason; broker stdout carries the full body.
- [ ] Golden-transcript parity test updated for the Anthropic→Responses mapping against a **recorded real transcript** of the new API shape (the old test used a mock invented pre-#120; record the real shape during the founder smoke and pin it).
- [ ] Every state above screenshot-documented on the PR (sign-in pending, signed-in, fallback-serving, broker-down, upstream-error).

## 4. Sequencing

**Lane 1 (broker, owns `scripts/`):** A → C → D-broker. **Lane 2 (UI, owns the livingDocs contrib):** B, then D-UI. B can start against a stubbed `/auth/openai/start` contract the orchestrator freezes on the PR before lanes split. 2-3 PRs expected (broker core, UI door, catalogue+fallback), each referencing the wave umbrella issue. Core-patch budget: **0** (broker + contrib are fork-owned; the auto-start supervisor already exists in `src/vs/platform/livingDocsBroker/`).

## 5. Founder-in-the-loop (this run is NOT fully unattended)

Automated validation uses a **local stub device-auth server** (same route shapes, instant approval) so implementers and validators can walk every state machine branch without a real OpenAI account. The real-subscription proof cannot be automated: when the stub-validated PRs are merged, the orchestrator push-notifies the founder with two one-liners:

1. OpenRouter key drop-in: `mkdir -p ~/.config && printf '%s' '<key>' > ~/.config/lwd-openrouter.key && chmod 600 ~/.config/lwd-openrouter.key`
2. Launch, sign in with ChatGPT (device code), send one chat.

The wave closes only after the founder smoke round-trips and its transcript is pinned (§3 box 6). If the founder is away, the wave parks at "stub-proven, founder smoke pending" with every box except 2 and 6 ticked.

## 6. Verification traps

All of plan 50 §4 applies (TMPDIR=/tmp, node 24 PATH, `npm run compile` before launch, launch skill isolated profiles, webview CDP targets, ≤3 desktop instances). Wave-specific: the broker **self-respawns ~2s after kill** - broker-down probes must block respawn (rename the script, not just kill) or move fast; do NOT touch the founder's real `~/.abstract/openai-oauth.json` - stub bundles live in the test profile's fake HOME; `transpile-client` before `scripts/test.sh`; commit `--no-verify` (husky stages-on-fail gotcha).

## 7. RUN (paste into a fresh session)

Execute **plan 51** (`docs/plans/51-model-access-device-auth-loop.md`) until its §3 acceptance floor is ticked or honestly parked, as one continuous run with a single founder-in-the-loop pause (§5). You are the Fable orchestrator: you plan, dispatch, adjudicate, and never implement. Implementers and adversarial validators are separate Opus sub-agents (`model: "opus"`); a validator never sees its implementer's conversation.

Step 0: create the wave umbrella issue (title "Model access: device auth + one honest serving door (plan 51)", body = §3 checklist), read plan 50 §4's traps, then freeze the `/auth/openai/start` response contract as a comment on the umbrella so both lanes build against it. Per WP: open a draft PR carrying its slice of the §3 checklist → dispatch an Opus implementer (worktree, brief = this plan + the WP row + upstream-notes) → implementer pushes with screenshots → dispatch an independent Opus adversarial validator that rebuilds, launches the desktop app against the stub, walks every state branch (pending, approved, expired, slow_down, broker-down, upstream-4xx, fallback), and is the ONLY party that ticks boxes, with screenshots as evidence. The exchange lives on the PR: implementer and validator post findings and rebuttals as PR comments, not in private. Max 3 fix rounds, then park with notes on the umbrella. Squash-merge on PASS.

WP-A's step-0 upstream research is mandatory and evidence-linked (§2); a validator that cannot trace an endpoint or model id in the notes to a live source fails the round. After the last merge, pause and push-notify the founder with §5's two one-liners; when the founder smoke lands, pin the real transcript, tick the last boxes, post the closing summary (every PR, every state screenshot, what's parked) on the umbrella, and close #120 with a link to the per-request-selection PR. Iteration budget 12. No AskUserQuestion except the §5 pause.
