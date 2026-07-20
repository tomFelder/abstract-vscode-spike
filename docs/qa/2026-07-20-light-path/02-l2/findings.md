# Plan 42 slice L2 - Model access moves to first AI use (issue #198)

**Branch:** `light-path/l2-model-access` - **Build:** off `main` @ `3bbe7ddd1c4` - **Date:** 2026-07-20

L2 removes the model/account decision from the entry path and defers it to the first AI use: the first agent send with no backend configured holds the typed prompt and renders the sign-in vs included-model choice inline in the chat rail; picking a door replays the original request. The "few quick questions" survey stays only on the Model access settings screen.

## What changed (all inside `src/vs/workbench/contrib/livingDocs/`)

- **`common/modelAccessGate.ts` (new)** - a DOM-free, service-free state machine: `needsModelChoice(status)` (gates ONLY on `provider === 'none'`, i.e. `unconfigured`/`broker-down`) and `ModelAccessGate` (holds at-most-one pending prompt per document, fires `onDidChangePending`, pops it once for replay).
- **`common/livingDocs.ts`** - `IPendingModelPrompt` type + five new `ILivingDocsService` members (`getPendingModelPrompt`, `dismissModelChoice`, `chooseIncludedModelAndReplay`, `startSignInForChat`, `completeSignInAndReplay`).
- **`browser/livingDocsService.ts`** - owns one `ModelAccessGate` (forwarded onto `onDidChange`). In `sendChatMessage`, a genuine user send (no `displayText`) that hits `needsModelChoice` holds the prompt + reveals the chat rail instead of answering. The door-pick methods reuse the existing sign-in/included flow, then replay the held prompt via `_deliverChatReply` (the user turn is already in history, so the prompt stays visible). `_invalidateModelProbe()` forces a fresh `/healthz` so a door just chosen is reflected immediately.
- **`browser/reviewRailView.ts`** - `_renderInlineModelChoice` draws the choice card above the composer (replacing the persistent sign-in hint while up), with a pending sign-in state (external open + spinner + poll) that replays on `signed-in`.
- **`test/browser/modelAccessGate.test.ts` (new)** - snapshot-style unit tests for the classifier + hold/replay contract.

## How the typed prompt survives the sign-in round trip

The prompt is held in-memory in `ModelAccessGate` keyed by resource. Clicking "Sign in with ChatGPT" starts the loopback flow and opens the authorize URL externally; the rail polls `pollChatGptSignIn()` **in-process** (the workbench never reloads for the OAuth loopback), so the held prompt is still in memory when the round-trip lands `signed-in`. `completeSignInAndReplay` then pops it and re-delivers verbatim. For the included path, `chooseIncludedModelAndReplay` signs out any ChatGPT session (so the broker serves the included tier) and replays immediately. The user turn was pushed to the transcript at send time, so it stays visible throughout.

## How the unconfigured state was produced (no keychain deletion)

The main-process broker supervisor **adopts an already-healthy broker on port 8090 and never spawns**. I pre-started my own broker with a controlled env, so the app adopted it:

- **Unconfigured:** `HOME=/tmp/lp-l2-emptyhome LWD_BACKEND=openrouter OPENROUTER_API_KEY= OPENROUTER_API_KEY_FILE=/tmp/lp-l2-nokey.key node scripts/lwd-model-broker.js` -> `/healthz` = `{ok:false, reason:'unconfigured', signedIn:false}`. The empty `HOME` means the broker's `~/.abstract/openai-oauth.json` lookup misses, so `signedIn:false` **without touching the user's real token file or keychain**. Maps to `provider:'none', readiness:'unconfigured'` -> `needsModelChoice=true`.
- **Configured included:** same, but `OPENROUTER_API_KEY_FILE=~/.config/lwd-openrouter.key` -> `{ok:true, reason:'ready', backend:'openrouter', signedIn:false}` -> `provider:'included', readiness:'ready'`. A live `POST /v1/messages` returned `PONG`. See `broker-evidence.txt`.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean |
| `./scripts/test.sh --grep "livingDocs"` | 143 passing, 0 failing (incl. 3 new gate tests) |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| Zero core patches | confirmed - diff is entirely within `contrib/livingDocs/` |

### Live E2E (fresh profile, `TMPDIR=/tmp`, session `lp-l2`, adopted unconfigured broker)

| # | Scenario | Outcome | Screenshot |
| --- | --- | --- | --- |
| A | Cold start shows no model gate on the path to typing | Entry path shows no forced model decision; the model door is a peer button (walkthrough is L1's territory, not merged) | `a-cold-start-no-model-gate.png` |
| B | Send with no backend -> inline choice, prompt preserved | Rail shows "Choose how to run your request" with both doors; the typed prompt ("Tighten the note to the board...") stays visible in the transcript | `b-inline-choice-prompt-preserved.png` |
| C | Choose included model -> original request answers live | Broker switched to configured-included; clicking "Use the included model" replayed the held prompt -> live `/v1/messages` (broker log), a real streamed proposal + inline red/green diff + Approve/Reject; composer flipped to the included-tier hint. Trust grammar intact | `c-included-model-answers-live.png` |
| D | Settings screen still offers both doors + survey | Model access screen shows Sign in with ChatGPT + Use the included model + usage ring + the "A few quick questions" survey | `d-settings-both-doors-and-survey.png` |

**Note on driving the webview:** the entire livingDocs surface (Home, editor, Files rail, review rail) renders inside a VS Code webview OOPIF that `@playwright/cli` over the main CDP cannot pierce (a11y snapshot stops at the iframe wrapper; direct target attach returns "not supported"). I drove it with raw CDP `Input.dispatchMouseEvent` to the top-level page at measured device-pixel coordinates, which routes into the webview. This is the reliable path in this environment absent the chrome-devtools MCP.

## Deliberately out of scope (other slices)

- The Welcome walkthrough gate / editor-first cold start is **L1**; it still gates entry on this pre-L1 build. L2 only ensures no OTHER entry-path surface forces the model decision and that the survey left the critical path. Scenarios B/C were exercised via the walkthrough's demo doc because that was the only way to reach an open doc + chat rail before L1 lands; the inline-choice code path is identical for any genuine user send.
- Quiet-shell rail collapse is **L4**; markdown-first vocabulary is **L3**. Untouched.
