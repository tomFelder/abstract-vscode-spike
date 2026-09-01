---
number: 122
status: "**Done (plan 27 iter 2).** 0 core patches; branch `27-streaming`."
provenance: "plan 27, iter 2 - decision D27-B"
source: docs/07-decision-log.md
---

# Cancel keeps the prose, discards the proposal

**On user cancel the prose streamed so far is kept as a muted "stopped" assistant turn and any proposal JSON is discarded; proposals are only ever committed from the COMPLETE response, never from a partial**

Settled to the plan's recommendation (unattended run). `_callModelStream(system, user, onDelta, token)` accumulates and emits each `content_block_delta` text and resolves with the FULL text, which flows through the existing `parseChatResponse` / `parseMultiChatResponse` unchanged (the proposal contract is untouched - a partial stream is never parsed into an edit). On `CancellationToken` cancellation the fetch is aborted (`AbortController`) and a distinguishable `CancellationError` is thrown; `sendChatMessage` catches it and pushes an assistant turn carrying the salvaged prose with `stopped: true` (a new optional `IChatMessage.stopped` flag), queuing nothing, and clears the busy flag + disposes the per-document `CancellationTokenSource` in its `finally`. `cancelChat(resource)` on `ILivingDocsService` cancels that source. The stream is the first rung of a fallback ladder that preserves the decision-58 retry: a NON-cancel stream failure falls back once to the buffered `_callModel` (which keeps its own single silent retry), then to the honest heuristic fallback turn - a cancel is never retried or masked as an error. The rail's live rendering of deltas + the Stop affordance are iteration 3 (out of this work unit); for iter 2 the deltas are traced and the salvage buffer proven by a service test. **Tier: our-surface** (service + `common/` interface; 0 core patches). Verified: 5 pure `parseSseChunk` tests (accumulation, split-across-chunk, `[DONE]`, malformed/keep-alive, partial-trailing-line) + a service test that cancelling an in-flight reply leaves no pending changes, clears busy, and records a `stopped` turn; the existing 77 service tests stay green (chat exercises the stream->buffered fallback ladder hermetically).
