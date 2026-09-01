---
number: 121
status: "**Done (plan 27 iter 1).** 0 core patches; branch `27-streaming`."
provenance: "plan 27, iter 1 - decision D27-A"
source: docs/07-decision-log.md
---

# Streaming over fetch against the localhost proxy

**The renderer streams the model reply over a `fetch` + `ReadableStream` reader against the localhost proxy, and the proxy passes Anthropic SSE through UNBUFFERED (`stream: true`), normalising the OpenRouter test backend to the SAME Anthropic `content_block_delta` event shape**

Settled to the plan's recommended transport (unattended run). The request service does not expose a readable stream cleanly, so the streaming call uses the DOM `fetch` (already used across the workbench/contrib browser layer) with `response.body.getReader()`; the credential still never reaches the renderer (decision 14) - the proxy holds it exactly as on the buffered path. Proxy change (`scripts/lwd-anthropic-proxy.js`): a `stream: true` body switches to an unbuffered path - Anthropic bytes are piped straight through (`Readable.fromWeb(upstream.body).pipe(res)` with SSE headers), and the OpenRouter branch reads OpenAI-style `data:` chunks and re-emits each as an Anthropic `content_block_delta` (`text_delta`) event terminated by `message_stop`, so the renderer parses ONE format regardless of backend (mapping kept tiny: `choices[0].delta.content` -> text_delta; `[DONE]` -> message_stop; everything else ignored). Every existing (non-streaming) caller is byte-identical - the buffered path is untouched and only reached when `stream` is absent. Mid-stream cancellation is honoured end to end: when the renderer aborts the fetch the proxy's `res` `close` fires, the node stream is destroyed and the upstream socket to Anthropic/OpenRouter closes (no orphaned in-flight call). The SSE line parser is a pure `parseSseChunk` in `common/livingDocSse.ts` (buffer -> `{ deltas, done, remainder }`), so split-across-chunk events, the `[DONE]` sentinel and malformed lines are handled and unit-tested without any transport. **Tier: our-surface** (proxy script + `common/` parser; 0 core patches). Live-verified at the HTTP level: a real streamed response arrives incrementally (deltas ~300ms apart, ending in `message_stop`) and a mid-stream abort closes the upstream socket after exactly the bytes already sent.
