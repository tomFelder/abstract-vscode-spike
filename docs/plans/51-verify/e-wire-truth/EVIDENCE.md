# Plan 51 founder smoke - the wire truth (12 Aug 2026)

The umbrella's remaining boxes (2, 6, 7) all depended on one thing nobody had done: putting a real ChatGPT subscription on the wire. Doing it found that the openai-oauth door **could never have served**, and why the wave's automated validation could not have caught it.

## 1. What the real backend actually rejects

Four separate 400s from `https://chatgpt.com/backend-api/codex/responses`, each isolated by hand against the live endpoint with the founder's own bundle before anything was changed:

| Broker sent | Upstream answered |
|---|---|
| no `store` field | `{"detail":"Store must be set to false"}` |
| `stream:false` (the buffered path) | `{"detail":"Stream must be set to true"}` |
| `max_output_tokens: <n>` (always sent) | `{"detail":"Unsupported parameter: max_output_tokens"}` |
| `model: "gpt-5.6-sol"` (**the default**) | `{"detail":"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}` |

Strip all four and the same request succeeds first try:

```
model=gpt-5.6-terra -> HTTP 200, content-type: text/event-stream
  deltas: "AB" "STRACT" " SM" "OKE" " OK"  ->  "ABSTRACT SMOKE OK"
  response.completed: status=completed, usage 14 in / 9 out
```

`gpt-5.6-luna` behaves identically. `gpt-5.6-sol` is refused for **any** ChatGPT-account Codex token - it is not a plan-tier quirk of this account.

## 2. Why every automated box passed anyway

`upstream-notes.md` §135 flagged the risk itself: *"model ids remain the softest claim ... the evidence is OpenAI's live Codex docs, not a wire probe."* The docs name Sol the default; the wire refuses it.

The deeper issue is the same shape one level down. The stub the implementers and validators built honoured a **request shape somebody invented pre-#120** - buffered JSON, `max_output_tokens`, no `store`. Both sides of the contract were ours, so both agreed, and every state branch went green while no real call could have succeeded. A stub is only worth the recording it is built from.

## 3. The fix

- **Request shape.** `store:false`, `stream:true`, no `max_output_tokens`. The endpoint is stream-only, so the buffered path opens an SSE stream and assembles the completion itself; one shared reader now owns the event vocabulary for both paths.
- **Entitlement.** The catalogue said which ids *exist* and claimed that meant this account could *call* them. Entitlement is now established at the wire and cached per account for 24h: probed in the background at startup (the ~0.5s cold-start floor is untouched), only ever demoting a model on a **definitive** upstream refusal, and self-healing when a live serve hits one. A refused model is never the resolved default and never reported `available`.
- **Plain words.** A refusal now reaches the client as upstream's own sentence, not `openai http 400`.

## 4. Evidence in this folder

| File | What it shows |
|---|---|
| `01-workbench-coldstart.png` | The settled workbench after a cold launch; the broker auto-started behind it. |
| `02-answer-served-by-subscription.png` | A real question answered **through the product**, served by the subscription door on `gpt-5.6-terra`, with its citation. |
| `03-model-access-signed-in.png` | Model access in the real window: "Serving you now - Your ChatGPT subscription", "Signed in to ChatGPT". |
| `models-live.json` | The live merged catalogue: `gpt-5.6-sol` carries `entitled:false`, `available:false` and upstream's reason; `terra` is the default. |
| `desktop-broker-log.txt` | The supervisor spawning the broker (spawn -> healthy ~0.5s), the entitlement verdict line, and the served requests naming their resolved model. |

The recorded transcript itself is pinned as a test fixture, not a document: `scripts/test/fixtures/codex-responses-stream.sse` (a real `gpt-5.6-terra` call, identifiers scrubbed, structure untouched) and `codex-responses-model-refused.json` (the real refusal body). `scripts/test/lwd-responses-parity.test.js` replays both, so the suite fails the moment the broker drifts back to a shape the real backend would reject - **plan 51 §3 box 6**.

## 5. Reproduction

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"   # node 24
export TMPDIR=/tmp
node --test scripts/test/*.test.js                          # 41/41, incl. the parity suite
./.agents/skills/launch-abstract/scripts/launch.sh -- /tmp/lwd-smoke-ws
curl -s http://127.0.0.1:8090/models | python3 -m json.tool  # sol: entitled false, available false
```

## 6. Residual

- **The device sign-in flow itself was not re-walked.** The founder's bundle is valid and authenticates, so signing out to re-walk the flow would have put a working session at risk for evidence the WP-B validator already captured against the stub. Box 2's *chat* half is proven here on the real subscription; the sign-in-flip half stands on WP-B/WP-C's evidence.
- **Real-window screenshots of the failure states** (broker-down, upstream-error, sign-in pending) are still the stub-window ones from WP-B. They need destructive setup on the founder's machine and are worth batching into the next wave's desktop pass.
- **A door that authenticates but cannot serve** still selects itself. Entitlement now demotes a *model*; the umbrella's earlier note about demoting a *door* after N consecutive upstream failures remains open, and is the same class of bug one level up.
