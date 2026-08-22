/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The broker's tool-event wire contract (plan 55 B2), recorded here because this is the file every client
// adapter reaches for first and the contract is invisible from the parser below, which only reads text:
//
//   - Text keeps content block index 0 and streams as BARE `content_block_delta` / `text_delta` events with
//     no surrounding `content_block_start` / `content_block_stop`, exactly as it did before tools existed.
//   - A tool call is `content_block_start` (a `tool_use` block, indexes numbered from 1) -> one or more
//     `content_block_delta` / `input_json_delta` fragments -> `content_block_stop`.
//   - A turn that carried at least one tool call closes with `message_delta` naming
//     `stop_reason: "tool_use"`. A turn that carried NO tool call emits NO `message_delta` at all, and the
//     `message_delta` never carries `usage`. So a text-only stream is byte-for-byte what it always was,
//     which is what the broker's parity suite pins (`scripts/lwd-model-broker.js:592-640`).
//   - A malformed tool call still closes its block, then emits a typed `error` event
//     (`{ type: "error", error: { type: "invalid_tool_arguments", message } }`) right after that block's
//     `content_block_stop`, which is how the adapter attributes it to a call. A broken upstream body emits
//     `error` with `upstream_stream_error` followed by `message_stop` (issue #346).
//
// The state machine that consumes the assembled turns is `common/livingDocsAgentLoop.ts`; its
// `IAgentModelResponse` is the shape an adapter over this parser has to produce.

/**
 * The result of parsing one network buffer of Anthropic-shaped Server-Sent Events (plan 27). The
 * proxy normalises BOTH backends to the same event vocabulary (`content_block_delta` with a
 * `text_delta`, terminated by `message_stop` or the SSE `[DONE]` sentinel), so the renderer parses a
 * single format regardless of backend.
 */
export interface ISseParseResult {
	/** The `text_delta` texts extracted from every COMPLETE event in this buffer, in order. */
	readonly deltas: readonly string[];
	/** True once a terminal event (`message_stop` or `[DONE]`) has been seen - the caller stops reading. */
	readonly done: boolean;
	/**
	 * True once a `message_delta` carrying `stop_reason: "pause"` has been seen. The proxy emits this when
	 * the day's included usage is spent (plan 35 iter 3): the caller keeps the streamed prose (the plain-words
	 * cap message) but pauses the run via D15 rather than parsing proposals from it.
	 */
	readonly paused: boolean;
	/** The trailing bytes AFTER the last newline (a partially-received line) to prepend to the next chunk. */
	readonly remainder: string;
}

/**
 * Pure, streaming-safe parser for one buffer of SSE text. SSE events arrive split arbitrarily across
 * network chunks, so the caller keeps a rolling buffer: `buffer = remainder + nextChunk`, calls
 * `parseSseChunk(buffer)`, emits the returned `deltas`, and carries `remainder` forward. Only lines
 * terminated by a newline are consumed here; an unterminated trailing line is returned as `remainder`
 * so an event split mid-line is never mis-parsed. Malformed `data:` payloads and non-`data:` lines
 * (`event:` headers, `:` keep-alive comments, blank separators) are ignored, never thrown.
 */
export function parseSseChunk(buffer: string): ISseParseResult {
	const deltas: string[] = [];
	let done = false;
	let paused = false;

	const lastNewline = buffer.lastIndexOf('\n');
	if (lastNewline < 0) {
		// No complete line yet - hold the whole buffer for the next chunk.
		return { deltas, done, paused, remainder: buffer };
	}
	const complete = buffer.slice(0, lastNewline);
	const remainder = buffer.slice(lastNewline + 1);

	for (const rawLine of complete.split('\n')) {
		const line = rawLine.trim();
		if (!line.startsWith('data:')) {
			// event: headers, `:` keep-alive comments and blank separators carry no text.
			continue;
		}
		const payload = line.slice('data:'.length).trim();
		if (!payload) { continue; }
		if (payload === '[DONE]') {
			done = true;
			continue;
		}
		let event: { type?: string; delta?: { type?: string; text?: string; stop_reason?: string } };
		try {
			event = JSON.parse(payload);
		} catch {
			// A partial or malformed JSON payload on a completed line - skip it, never throw.
			continue;
		}
		if (event.type === 'message_stop') {
			done = true;
			continue;
		}
		// The proxy signals a spent daily budget with a `message_delta` carrying stop_reason "pause"
		// (plan 35 iter 3); the caller keeps the streamed cap prose but pauses the run rather than parsing it.
		if (event.type === 'message_delta' && event.delta && event.delta.stop_reason === 'pause') {
			paused = true;
			continue;
		}
		if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
			deltas.push(event.delta.text);
		}
	}

	return { deltas, done, paused, remainder };
}
