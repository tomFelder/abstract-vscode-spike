/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Localhost-only model proxy for the Living Documents web build (served by @vscode/test-web at
// http://localhost:8080). The engine speaks the Anthropic Messages protocol internally; this proxy
// authenticates against a pluggable backend and translates the request/response so no credential ever
// reaches the renderer (decision 14: the credential lives only in this process). No CSP/CORS changes are
// needed - the sources build sets no connect-src CSP and this proxy owns the CORS policy (localhost-bind
// only). If no backend is configured (or it errors) the renderer degrades to its built-in heuristic path,
// so the app stays demoable with ZERO backends.
//
// Backends are pluggable behind one interface (see `backends` below):
//   - `openrouter` - founder-funded fallback tier, budget-metered per user/day (plan 35 iter 3).
//   - `openai-oauth` - the "Sign in with ChatGPT" subscription path (plan 35 iter 2). The user signs in with
//     their own ChatGPT subscription (the Codex OAuth token, see scripts/lwd-openai-oauth.js); their model
//     calls draw on that subscription, so this backend is NOT metered against the founder's budget. The
//     /auth/openai/* routes below drive sign-in; the credential lives only in this process (decision 14).
// The Anthropic Console-OAuth backend was removed in plan 35 iter 1 (doc 18 section 2.1): Anthropic
// banned subscription OAuth in third-party tools and the Console-billed path burned unfunded API credit.
//
// Run it with ./scripts/lwd-anthropic-proxy.sh (Node 24). Nothing is committed except this script.

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { SpendMeter } = require('./lwd-spend-meter.js');
const openaiOAuth = require('./lwd-openai-oauth.js');

const HOST = '127.0.0.1';
const PORT = Number(process.env.LWD_PROXY_PORT || 8090);

// Backend selection. `openrouter` is the founder-funded fallback tier (the only backend implemented in
// plan 35 iter 1); `openai-oauth` is reserved for the subscription path (plan 35 iter 2) and reports
// itself as not-configured until then, so the renderer stays on its heuristic fallback rather than 500ing.
const BACKEND = (process.env.LWD_BACKEND || 'openrouter').toLowerCase();

const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
// Default fallback model: a capable mid-tier model, NOT the cheapest available. The beta bar is "more
// reliable than ChatGPT" (doc 18 section 2.1, P0) and a bottom-shelf model (e.g. gpt-4o-mini) poisons the
// one thing the fallback must prove; gpt-4.1-mini is a strong, low-cost mid-tier that keeps the ~$1/day
// cap serving many requests while staying reliable. Override with OPENROUTER_MODEL.
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini';

// Bound the request body so a runaway client cannot exhaust memory; model calls here are tiny.
const MAX_BODY_BYTES = 1 * 1024 * 1024;

// The docx import route (POST /import/docx, issue #129) carries a base64 Word document, which is far larger
// than a model call, so it gets its own generous cap (a base64 payload is ~4/3 of the file). 40 MB of
// base64 covers a ~30 MB docx - well past any beta document - while still bounding memory.
const MAX_IMPORT_BODY_BYTES = 40 * 1024 * 1024;

// --- per-user daily budget meter (plan 35 iter 3) ------------------------------------------------------
// The founder cannot fund API-priced usage for the cohort, so the OpenRouter fallback is capped at a
// small daily budget per user (doc 18 section 2.1). Spend is metered per request HERE, in the proxy,
// because this is where the real usage/cost numbers arrive. The meter is a pure module (lwd-spend-meter.js,
// mirrored by common/spendMeter.ts which carries the unit tests) reading an injectable clock; the proxy
// gives it the wall clock. At the cap it returns a structured overspend so the renderer pauses the run via
// the D15 machinery (never 500s), and it emits a `model_spend` audit record per request (doc 15 section 3.1).
const DAILY_BUDGET_USD = Number(process.env.LWD_DAILY_BUDGET_USD || 1);
const spendMeter = new SpendMeter({ dailyBudgetUsd: DAILY_BUDGET_USD, clock: { now: () => Date.now() } });

// The local audit sink for `model_spend` records. PostHog wiring is plan 36's job (doc 18 section 2.2);
// for now every record appends as one JSON line to ~/.abstract/model-spend.log (0600) so per-user spend is
// tracked from day one - the cap is enforced by data, not hope. Never contains document text or a credential.
const AUDIT_DIR = path.join(os.homedir(), '.abstract');
const SPEND_LOG_PATH = path.join(AUDIT_DIR, 'model-spend.log');
// The general analytics event sink (plan 35 iter 4): non-spend product events (e.g. `model_configured`, the
// onboarding survey) append here as JSON lines, alongside model-spend.log, so plan 36 has ONE local place to
// forward to PostHog. Never contains document text or a credential.
const EVENT_LOG_PATH = path.join(AUDIT_DIR, 'events.log');

/** Append one JSON record to a local audit log (best effort; a log failure never blocks a reply). */
function appendAudit(logPath, record) {
	try {
		fs.mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 });
		fs.appendFileSync(logPath, JSON.stringify(record) + '\n', { mode: 0o600 });
	} catch { /* the audit log is best effort - never fail a reply because logging failed */ }
}

/** Append one `model_spend` record to the local audit log. */
function auditModelSpend(record) {
	appendAudit(SPEND_LOG_PATH, record);
}

/** Standard permissive CORS for a localhost-only dev proxy (the page origin is http://localhost:8080). */
function setCors(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'content-type, anthropic-version, anthropic-beta');
	res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(body);
}

function readBody(req, maxBytes) {
	const cap = maxBytes || MAX_BODY_BYTES;
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', chunk => {
			size += chunk.length;
			if (size > cap) {
				reject(new Error('request body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

function proxyError(message) {
	return { status: 502, contentType: 'application/json', text: JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }) };
}

// The plain-words body the renderer surfaces when the daily included usage is spent (P5: never "rate
// limit" or "budget"). Shaped as a normal Anthropic message so the existing parser reads it as prose; the
// `stop_reason: 'pause'` signals the service to pause the run via D15 and keep proposals reviewable.
const CAP_MESSAGE = "You've used today's included usage - picks up tomorrow, or sign in with ChatGPT for unlimited.";
function capReached() {
	return {
		status: 200,
		contentType: 'application/json',
		text: JSON.stringify({
			id: 'lwd-cap',
			type: 'message',
			role: 'assistant',
			model: OPENROUTER_MODEL,
			stop_reason: 'pause',
			content: [{ type: 'text', text: CAP_MESSAGE }],
		}),
	};
}

// Standard SSE headers for an unbuffered event stream (backends normalise to Anthropic-shaped events).
function writeSseHead(res) {
	setCors(res);
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
}

// Serialise one Anthropic-shaped SSE event the renderer's parser understands.
function sseEvent(event, data) {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Emit the plain-words cap message as a short SSE stream that ends with a paused-run signal + message_stop.
// The renderer reads the text as prose and pauses the run (D15) instead of erroring.
function writeCapStream(res) {
	writeSseHead(res);
	res.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: CAP_MESSAGE } }));
	res.write(sseEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'pause' } }));
	res.write(sseEvent('message_stop', { type: 'message_stop' }));
	res.end();
}

// Emit the plain-words re-auth message as a paused SSE stream (same shape as writeCapStream). The renderer
// reads the prose and pauses the run (D15) rather than erroring or parsing proposals from it.
function writeReauthStream(res) {
	writeSseHead(res);
	res.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REAUTH_MESSAGE } }));
	res.write(sseEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'pause' } }));
	res.write(sseEvent('message_stop', { type: 'message_stop' }));
	res.end();
}

// The plain-words body the renderer surfaces when the subscription sign-in has lapsed and a silent refresh
// could not recover it (plan 35 iter 2; P5: never "OAuth token" or "401"). Shaped like the cap message - a
// normal Anthropic message the parser reads as prose - with `stop_reason: 'pause'` so the run pauses via D15
// and keeps proposals, rather than dying. The user's next step is to sign in again (or switch to the included
// model); this pause is NOT retryable (a retry just refuses again until they re-auth).
const REAUTH_MESSAGE = "Your ChatGPT sign-in needs a refresh - sign in again to keep going, or switch to the included model.";
function reauthReached() {
	return {
		status: 200,
		contentType: 'application/json',
		text: JSON.stringify({
			id: 'lwd-reauth',
			type: 'message',
			role: 'assistant',
			model: openaiOAuth.OPENAI_MODEL,
			stop_reason: 'pause',
			content: [{ type: 'text', text: REAUTH_MESSAGE }],
		}),
	};
}

// --- backend: openrouter ------------------------------------------------------------------------------
// Translates an Anthropic Messages request to OpenRouter's OpenAI-style chat API and the response back into
// the Anthropic Messages shape the service parses. The founder's OpenRouter key comes from env / a key file
// at runtime and is NEVER committed. This is also the seam iter 2's openai-oauth backend extends (same
// request translation, a subscription-backed token instead of the founder key), so the mapping lives once.

function openRouterKey() {
	if (process.env.OPENROUTER_API_KEY) { return process.env.OPENROUTER_API_KEY.trim(); }
	const file = process.env.OPENROUTER_API_KEY_FILE;
	if (file) {
		try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
	}
	return '';
}

// Flatten an Anthropic Messages request into the OpenAI-style `messages` array OpenRouter expects. Shared by
// the buffered and streaming paths so the request shape is translated in exactly one place.
function toOpenRouterMessages(req) {
	const messages = [];
	if (typeof req.system === 'string' && req.system) { messages.push({ role: 'system', content: req.system }); }
	for (const m of req.messages || []) {
		const content = typeof m.content === 'string'
			? m.content
			: (Array.isArray(m.content) ? m.content.map(p => (p && p.text) ? p.text : '').join('') : String(m.content ?? ''));
		const role = m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user');
		messages.push({ role, content });
	}
	return messages;
}

// Best-effort dollar cost for one OpenRouter call. OpenRouter returns real spend when `usage` includes a
// `cost` field (the authoritative number - we use it verbatim); when it does not (a model without cost
// accounting, or a stream that omitted it) we ESTIMATE honestly from token counts at a conservative blended
// rate so the meter never under-counts a call to zero. The estimate is deliberately rough - the cap carries
// headroom and a real `cost` supersedes it whenever the API provides one.
const ESTIMATED_USD_PER_1K_TOKENS = 0.002;
function openRouterCost(usage) {
	if (usage && typeof usage.cost === 'number' && usage.cost >= 0) {
		return { costUsd: usage.cost, estimated: false };
	}
	const totalTokens = usage && typeof usage.total_tokens === 'number'
		? usage.total_tokens
		: ((usage && usage.prompt_tokens) || 0) + ((usage && usage.completion_tokens) || 0);
	return { costUsd: (totalTokens / 1000) * ESTIMATED_USD_PER_1K_TOKENS, estimated: true };
}

async function openRouterForward(body, req) {
	const key = openRouterKey();
	if (!key) { return proxyError('OPENROUTER_API_KEY (or OPENROUTER_API_KEY_FILE) is not set'); }
	const orBody = JSON.stringify({ model: OPENROUTER_MODEL, max_tokens: req.max_tokens || 1024, messages: toOpenRouterMessages(req), usage: { include: true } });
	const upstream = await fetch(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			'authorization': `Bearer ${key}`,
			'content-type': 'application/json',
			'HTTP-Referer': 'http://localhost:8080',
			'X-OpenRouter-Title': 'Living Documents (dev proxy)',
		},
		body: orBody,
	});
	const orText = await upstream.text();
	let orJson;
	try { orJson = JSON.parse(orText); } catch { orJson = undefined; }
	if (!upstream.ok || !orJson || orJson.error) {
		const message = (orJson && orJson.error) ? (orJson.error.message || 'openrouter error') : `openrouter http ${upstream.status}`;
		return proxyError(message);
	}
	const choice = (orJson.choices && orJson.choices[0]) || {};
	const text = (choice.message && choice.message.content) || '';
	const finish = choice.finish_reason || 'stop';
	const stopReason = finish === 'length' ? 'max_tokens' : (finish === 'content_filter' ? 'refusal' : 'end_turn');
	const anthropic = {
		id: orJson.id || 'or-msg',
		type: 'message',
		role: 'assistant',
		model: orJson.model || OPENROUTER_MODEL,
		stop_reason: stopReason,
		content: [{ type: 'text', text: String(text) }],
	};
	return { status: 200, contentType: 'application/json', text: JSON.stringify(anthropic), usage: orJson.usage };
}

async function openRouterForwardStream(req, res) {
	const key = openRouterKey();
	if (!key) {
		setCors(res);
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: 'OPENROUTER_API_KEY (or OPENROUTER_API_KEY_FILE) is not set' } }));
		return { usage: undefined };
	}
	const orBody = JSON.stringify({ model: OPENROUTER_MODEL, max_tokens: req.max_tokens || 1024, messages: toOpenRouterMessages(req), stream: true, usage: { include: true } });
	const upstream = await fetch(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			'authorization': `Bearer ${key}`,
			'content-type': 'application/json',
			'accept': 'text/event-stream',
			'HTTP-Referer': 'http://localhost:8080',
			'X-OpenRouter-Title': 'Living Documents (dev proxy)',
		},
		body: orBody,
	});
	if (!upstream.ok || !upstream.body) {
		const text = await upstream.text().catch(() => '');
		let message = `openrouter http ${upstream.status}`;
		try { const j = JSON.parse(text); if (j && j.error && j.error.message) { message = j.error.message; } } catch { /* keep default */ }
		setCors(res);
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }));
		return { usage: undefined };
	}
	writeSseHead(res);
	const nodeStream = Readable.fromWeb(upstream.body);
	res.on('close', () => nodeStream.destroy());
	// OpenRouter emits a final SSE chunk carrying `usage` (with `usage: {include:true}`) - capture it so the
	// caller can meter the streamed call with real numbers where available.
	const captured = { usage: undefined };
	let buf = '';
	const endStream = () => { if (!res.writableEnded) { res.write(sseEvent('message_stop', { type: 'message_stop' })); res.end(); } };
	return await new Promise(resolve => {
		nodeStream.on('data', chunk => {
			buf += chunk.toString('utf8');
			let nl;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line.startsWith('data:')) { continue; }
				const payload = line.slice(5).trim();
				if (payload === '[DONE]') { endStream(); resolve(captured); return; }
				try {
					const j = JSON.parse(payload);
					if (j.usage) { captured.usage = j.usage; }
					const delta = j.choices && j.choices[0] && j.choices[0].delta;
					const text = delta && delta.content;
					if (typeof text === 'string' && text.length) {
						res.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
					}
				} catch { /* keep-alive comment or malformed chunk -> ignore */ }
			}
		});
		nodeStream.on('end', () => { endStream(); resolve(captured); });
		nodeStream.on('error', () => { if (!res.writableEnded) { res.end(); } resolve(captured); });
	});
}

// --- backend: openai-oauth ("Sign in with ChatGPT") ---------------------------------------------------
// Serves the engine's Anthropic-Messages requests from the user's OWN ChatGPT subscription via the Codex
// OAuth token (scripts/lwd-openai-oauth.js). The request translation is SHARED with openrouter -
// toOpenRouterMessages produces the OpenAI-style role/content messages both need - so the mapping lives once
// (plan 35 note: extend the existing seam, don't duplicate). The upstream here is OpenAI's Responses API,
// which takes `instructions` + an `input` array and returns an `output` array; the translation below is the
// only openai-oauth-specific part. A token near expiry is refreshed silently before the call; a hard auth
// failure (refresh token revoked/expired) becomes the plain-words re-auth pause, NEVER a 500.

/** A distinguishable auth failure so the caller emits the re-auth pause instead of a generic proxy error. */
class OpenAiAuthError extends Error {
	constructor(message) { super(message); this.name = 'OpenAiAuthError'; }
}

/** Get a valid subscription bearer + account id, refreshing silently; throw OpenAiAuthError on a hard fail. */
async function openAiAuthHeaders() {
	let bundle;
	try {
		bundle = await openaiOAuth.validBundle();
	} catch (e) {
		throw new OpenAiAuthError(e && e.message ? e.message : 'not signed in');
	}
	const headers = {
		'authorization': `Bearer ${bundle.access_token}`,
		'content-type': 'application/json',
		'originator': 'codex_cli_rs',
		'OpenAI-Beta': 'responses=v1',
	};
	if (bundle.account_id) { headers['chatgpt-account-id'] = bundle.account_id; }
	return headers;
}

// Translate an Anthropic Messages request to an OpenAI Responses request. The system prompt maps to
// `instructions`; the conversation maps to `input` with typed text parts (an assistant turn uses
// `output_text`, everything else `input_text`), reusing the shared toOpenRouterMessages flattening.
function toResponsesRequest(req, stream) {
	const flattened = toOpenRouterMessages(req);
	const instructionsParts = flattened.filter(m => m.role === 'system').map(m => m.content);
	const input = flattened.filter(m => m.role !== 'system').map(m => ({
		role: m.role,
		content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
	}));
	const body = {
		model: openaiOAuth.OPENAI_MODEL,
		input,
		max_output_tokens: req.max_tokens || 1024,
	};
	if (instructionsParts.length) { body.instructions = instructionsParts.join('\n\n'); }
	if (stream) { body.stream = true; }
	return body;
}

// Pull the assistant text out of a buffered Responses result. Prefer the `output_text` convenience field;
// otherwise walk the `output` array's message items and concatenate their `output_text` parts.
function textFromResponses(json) {
	if (typeof json.output_text === 'string' && json.output_text) { return json.output_text; }
	const out = Array.isArray(json.output) ? json.output : [];
	let text = '';
	for (const item of out) {
		if (item && item.type === 'message' && Array.isArray(item.content)) {
			for (const part of item.content) {
				if (part && (part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') { text += part.text; }
			}
		}
	}
	return text;
}

// Map a Responses stop/status to the Anthropic stop_reason the renderer's parser understands.
function responsesStopReason(json) {
	const status = json.status || (json.response && json.response.status);
	const incompleteReason = (json.incomplete_details && json.incomplete_details.reason)
		|| (json.response && json.response.incomplete_details && json.response.incomplete_details.reason);
	if (incompleteReason === 'max_output_tokens') { return 'max_tokens'; }
	if (status === 'incomplete') { return 'max_tokens'; }
	return 'end_turn';
}

async function openAiForward(_body, req) {
	let headers;
	try { headers = await openAiAuthHeaders(); }
	catch (e) { if (e instanceof OpenAiAuthError) { return reauthReached(); } throw e; }
	const upstream = await fetch(openaiOAuth.RESPONSES_URL, {
		method: 'POST',
		headers,
		body: JSON.stringify(toResponsesRequest(req, false)),
	});
	const rawText = await upstream.text();
	// A 401 means the access token was rejected despite the pre-flight refresh (revoked mid-life): surface the
	// plain-words re-auth pause rather than a proxy error, so the run pauses cleanly and prompts a sign-in.
	if (upstream.status === 401 || upstream.status === 403) { return reauthReached(); }
	let json;
	try { json = JSON.parse(rawText); } catch { json = undefined; }
	if (!upstream.ok || !json || json.error) {
		const message = (json && json.error) ? (json.error.message || 'openai error') : `openai http ${upstream.status}`;
		return proxyError(message);
	}
	const text = textFromResponses(json);
	const anthropic = {
		id: json.id || 'oa-msg',
		type: 'message',
		role: 'assistant',
		model: json.model || openaiOAuth.OPENAI_MODEL,
		stop_reason: responsesStopReason(json),
		content: [{ type: 'text', text: String(text) }],
	};
	// meters:false, so no usage is returned to the meter (a subscription call is not the founder's budget).
	return { status: 200, contentType: 'application/json', text: JSON.stringify(anthropic), usage: undefined };
}

async function openAiForwardStream(req, res) {
	let headers;
	try { headers = await openAiAuthHeaders(); }
	catch (e) { if (e instanceof OpenAiAuthError) { writeReauthStream(res); return { usage: undefined }; } throw e; }
	const upstream = await fetch(openaiOAuth.RESPONSES_URL, {
		method: 'POST',
		headers: Object.assign({}, headers, { 'accept': 'text/event-stream' }),
		body: JSON.stringify(toResponsesRequest(req, true)),
	});
	if (upstream.status === 401 || upstream.status === 403) { writeReauthStream(res); return { usage: undefined }; }
	if (!upstream.ok || !upstream.body) {
		const text = await upstream.text().catch(() => '');
		let message = `openai http ${upstream.status}`;
		try { const j = JSON.parse(text); if (j && j.error && j.error.message) { message = j.error.message; } } catch { /* keep default */ }
		setCors(res);
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }));
		return { usage: undefined };
	}
	writeSseHead(res);
	const nodeStream = Readable.fromWeb(upstream.body);
	res.on('close', () => nodeStream.destroy());
	let buf = '';
	const endStream = () => { if (!res.writableEnded) { res.write(sseEvent('message_stop', { type: 'message_stop' })); res.end(); } };
	return await new Promise(resolve => {
		nodeStream.on('data', chunk => {
			buf += chunk.toString('utf8');
			let nl;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line.startsWith('data:')) { continue; }
				const payload = line.slice(5).trim();
				if (payload === '[DONE]') { endStream(); resolve({ usage: undefined }); return; }
				try {
					const j = JSON.parse(payload);
					// The Responses stream emits typed events; translate the text deltas into the Anthropic-shaped
					// content_block_delta the renderer's SSE parser reads. `response.completed` ends the stream.
					if (j.type === 'response.output_text.delta' && typeof j.delta === 'string' && j.delta.length) {
						res.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: j.delta } }));
					} else if (j.type === 'response.completed') {
						endStream();
						resolve({ usage: undefined });
						return;
					}
				} catch { /* keep-alive comment or malformed chunk -> ignore */ }
			}
		});
		nodeStream.on('end', () => { endStream(); resolve({ usage: undefined }); });
		nodeStream.on('error', () => { if (!res.writableEnded) { res.end(); } resolve({ usage: undefined }); });
	});
}

// --- backend registry ---------------------------------------------------------------------------------
// One interface per backend: `isConfigured()` gates /healthz; `forward` (buffered) and `forwardStream`
// (SSE) do the request/response translation. `meters` marks whether calls draw on the founder-funded
// budget (openrouter) or the user's own subscription (openai-oauth - not metered, it is the user's own plan).
const backends = {
	openrouter: {
		name: 'openrouter',
		meters: true,
		isConfigured: () => !!openRouterKey(),
		forward: openRouterForward,
		forwardStream: openRouterForwardStream,
	},
	// "Sign in with ChatGPT" (plan 35 iter 2). Configured once a subscription token bundle is stored; calls
	// draw on the user's own ChatGPT plan (meters:false) and translate to OpenAI's Responses API above.
	'openai-oauth': {
		name: 'openai-oauth',
		meters: false,
		isConfigured: () => openaiOAuth.isSignedIn(),
		forward: openAiForward,
		forwardStream: openAiForwardStream,
	},
};

function activeBackend() {
	return backends[BACKEND] || backends.openrouter;
}

// Meter one metered (openrouter) call: charge the resolved cost, emit a `model_spend` audit record, and
// return whether the day's included usage is now spent. Not called for a non-metering backend (a user's
// own subscription is not the founder's budget). Cost uses real API numbers where present, an honest
// estimate otherwise (see openRouterCost).
function meterCall(backend, usage) {
	if (!backend.meters) { return; }
	const { costUsd, estimated } = openRouterCost(usage);
	const outcome = spendMeter.charge(costUsd);
	auditModelSpend({
		event: 'model_spend',
		ts: new Date().toISOString(),
		provider: backend.name,
		model: OPENROUTER_MODEL,
		cost: Number(costUsd.toFixed(6)),
		cost_estimated: estimated,
		daily_total: Number(outcome.dailyTotalUsd.toFixed(6)),
		daily_budget: DAILY_BUDGET_USD,
		cap_hit: outcome.capHit,
	});
}

async function forwardMessages(req, res) {
	const body = await readBody(req);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed) {
		setCors(res);
		sendJson(res, 400, { type: 'error', error: { type: 'proxy_error', message: 'invalid request body' } });
		return;
	}
	const backend = activeBackend();
	const streaming = parsed.stream === true;
	// Budget gate (metered backends only): if the day's included usage is already spent, do NOT call the
	// model - return the plain-words cap message so the renderer pauses the run via D15 and keeps proposals.
	if (backend.meters && spendMeter.isOverBudget()) {
		if (streaming) { writeCapStream(res); }
		else {
			const capped = capReached();
			setCors(res);
			res.writeHead(capped.status, { 'content-type': capped.contentType });
			res.end(capped.text);
		}
		return;
	}
	if (streaming) {
		const { usage } = await backend.forwardStream(parsed, res);
		meterCall(backend, usage);
		return;
	}
	const result = await backend.forward(body, parsed);
	// Only meter a successful model call (a proxy/backend error did not spend the founder's budget).
	if (result.status === 200) { meterCall(backend, result.usage); }
	setCors(res);
	res.writeHead(result.status, { 'content-type': result.contentType });
	res.end(result.text);
}

// --- MCP resolution + credentials (plan 29, iter 4) ------------------------------------------------
// The proxy owns the same trust boundary as the model calls (decision 14): it spawns locally configured
// MCP servers and holds API secrets, so a credential never reaches the renderer or the lock. Config lives
// in an `mcp.json` (D29-B) read from LWD_MCP_CONFIG (or ./mcp.json); secrets in ~/.abstract/secrets.json
// (D29-C, 0600), set via the `set-secret` CLI below.

const MCP_CONFIG_PATH = process.env.LWD_MCP_CONFIG || path.join(process.cwd(), 'mcp.json');
const MCP_TIMEOUT_MS = 10 * 1000;
const SECRETS_DIR = path.join(os.homedir(), '.abstract');
const SECRETS_PATH = path.join(SECRETS_DIR, 'secrets.json');

// Read mcp.json fresh on each resolve so editing it (adding a server) is picked up without a restart.
function loadMcpConfig() {
	try { return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8')); } catch { return { servers: {} }; }
}

function readSecrets() {
	try { return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')); } catch { return {}; }
}
function readSecret(name) {
	const s = readSecrets();
	return (s && typeof s[name] === 'string') ? s[name] : '';
}
// Persist a named secret with 0600 perms (owner-only), creating ~/.abstract at 0700. Never the workspace.
function writeSecret(name, value) {
	const secrets = readSecrets();
	secrets[name] = value;
	fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
	fs.writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2) + '\n', { mode: 0o600 });
	try { fs.chmodSync(SECRETS_PATH, 0o600); } catch { /* best effort on platforms without chmod */ }
}

/** @type {Map<string, { child: import('child_process').ChildProcess; buf: string; nextId: number; pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>; ready: Promise<void> | null }>} */
const mcpConns = new Map();

// Spawn one configured MCP server and wire its newline-delimited JSON-RPC stdout back to pending requests.
function spawnMcp(name, def) {
	const child = spawn(def.command, def.args || [], { stdio: ['pipe', 'pipe', 'pipe'], env: Object.assign({}, process.env, def.env || {}) });
	const conn = { child, buf: '', nextId: 1, pending: new Map(), ready: null };
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', chunk => {
		conn.buf += chunk;
		let nl;
		while ((nl = conn.buf.indexOf('\n')) >= 0) {
			const line = conn.buf.slice(0, nl).trim();
			conn.buf = conn.buf.slice(nl + 1);
			if (!line) { continue; }
			let msg;
			try { msg = JSON.parse(line); } catch { continue; }
			if (msg && msg.id !== undefined && conn.pending.has(msg.id)) {
				const p = conn.pending.get(msg.id);
				conn.pending.delete(msg.id);
				if (msg.error) { p.reject(new Error(msg.error.message || 'mcp error')); }
				else { p.resolve(msg.result); }
			}
		}
	});
	child.stderr.on('data', () => { /* server diagnostics are ignored; never surfaced to the renderer */ });
	const fail = (reason) => {
		mcpConns.delete(name);
		for (const p of conn.pending.values()) { p.reject(new Error(reason)); }
		conn.pending.clear();
	};
	child.on('exit', () => fail('mcp server exited'));
	child.on('error', () => fail('mcp server failed to start'));
	return conn;
}

// Send one JSON-RPC request and await its matching response, bounded by MCP_TIMEOUT_MS.
function mcpSend(conn, method, params) {
	const id = conn.nextId++;
	const payload = { jsonrpc: '2.0', id, method };
	if (params !== undefined) { payload.params = params; }
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { conn.pending.delete(id); reject(new Error(`mcp ${method} timed out`)); }, MCP_TIMEOUT_MS);
		conn.pending.set(id, {
			resolve: v => { clearTimeout(timer); resolve(v); },
			reject: e => { clearTimeout(timer); reject(e); },
		});
		try { conn.child.stdin.write(JSON.stringify(payload) + '\n'); }
		catch (e) { clearTimeout(timer); conn.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
	});
}
function mcpNotify(conn, method) {
	try { conn.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); } catch { /* ignore */ }
}

// Get a ready (initialized) connection for a server, spawning + handshaking once and reusing it thereafter.
async function getMcpConn(name) {
	const existing = mcpConns.get(name);
	if (existing) { await existing.ready; return existing; }
	const cfg = loadMcpConfig();
	const def = cfg && cfg.servers && cfg.servers[name];
	if (!def || !def.command) { throw new Error(`no MCP server "${name}" configured in ${MCP_CONFIG_PATH}`); }
	const conn = spawnMcp(name, def);
	mcpConns.set(name, conn);
	conn.ready = (async () => {
		await mcpSend(conn, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lwd-proxy', version: '1.0.0' } });
		mcpNotify(conn, 'notifications/initialized');
	})();
	await conn.ready;
	return conn;
}

// POST /mcp/resolve: { server, tool, args?, field? } -> { value, raw }. Spawns/reuses the configured MCP
// server, calls the tool, and extracts `field` from the tool's JSON text content. Structured errors on any
// failure so the renderer degrades to a flagged stale binding rather than an error toast.
async function resolveMcp(req, res) {
	const body = await readBody(req);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || !parsed.server || !parsed.tool) {
		sendJson(res, 400, { error: { type: 'mcp_error', message: 'server and tool are required' } });
		return;
	}
	try {
		const conn = await getMcpConn(parsed.server);
		const result = await mcpSend(conn, 'tools/call', { name: parsed.tool, arguments: parsed.args || {} });
		const content = (result && Array.isArray(result.content)) ? result.content : [];
		const text = content.filter(c => c && c.type === 'text').map(c => c.text || '').join('');
		let value = text;
		if (parsed.field) {
			try {
				const obj = JSON.parse(text);
				const f = obj[parsed.field];
				value = f === undefined ? '' : (typeof f === 'number' ? f.toLocaleString('en-US') : String(f));
			} catch { value = ''; }
		}
		sendJson(res, 200, { value, raw: text });
	} catch (e) {
		sendJson(res, 502, { error: { type: 'mcp_error', message: String(e && e.message ? e.message : e) } });
	}
}

// POST /proxy/fetch: { url, auth? } -> the upstream JSON, with the named proxy-side secret injected as a
// Bearer header (plan 29, iter 4 API auth). The secret is read here and never returned or logged, so an
// authenticated `api` source resolves without the credential ever reaching the renderer.
async function proxyFetch(req, res) {
	const body = await readBody(req);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || !parsed.url) {
		sendJson(res, 400, { error: { type: 'proxy_error', message: 'url is required' } });
		return;
	}
	try {
		const headers = { 'accept': 'application/json' };
		if (parsed.auth) {
			const secret = readSecret(parsed.auth);
			if (secret) { headers['authorization'] = `Bearer ${secret}`; }
		}
		const upstream = await fetch(parsed.url, { method: 'GET', headers });
		const text = await upstream.text();
		setCors(res);
		res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
		res.end(text);
	} catch (e) {
		sendJson(res, 502, { error: { type: 'proxy_error', message: String(e && e.message ? e.message : e) } });
	}
}

// --- docx -> HTML import (issue #129, doc 22 section 2) --------------------------------------------------
// Conversion runs HERE in the node layer where file access + the pure-JS pipeline (mammoth) live, never in
// the renderer (doc 22 section 2). POST /import/docx { base64 } -> { ok, html, detections } on success, or
// { ok:false, reason } for a file we refuse to mangle (encrypted / not a real .docx / unparseable). The
// renderer turns the HTML into Markdown + assets (common/docxImport.ts) and writes the doc + lock + card.

// Detect the "named and dropped" structures (doc 22 section 2) by reading the raw docx parts, so the
// kept/dropped card names a limitation ONLY when the document actually contained it. Fail-soft: an
// unreadable part just leaves its flag false (never a fabricated caveat).
async function detectDocxFidelity(buffer) {
	const detections = { comments: false, trackedChanges: false, footnotes: false, textboxes: false, headersFooters: false };
	try {
		const JSZip = require('jszip');
		const zip = await JSZip.loadAsync(buffer);
		const read = async (name) => { const f = zip.file(name); return f ? await f.async('string') : ''; };
		const documentXml = await read('word/document.xml');
		detections.trackedChanges = /<w:ins\b/.test(documentXml) || /<w:del\b/.test(documentXml);
		detections.textboxes = /<w:txbxContent\b/.test(documentXml) || /<v:textbox\b/.test(documentXml);
		detections.comments = /<w:commentReference\b/.test(documentXml) || !!zip.file('word/comments.xml');
		detections.footnotes = !!zip.file('word/footnotes.xml') || !!zip.file('word/endnotes.xml')
			|| /<w:footnoteReference\b/.test(documentXml) || /<w:endnoteReference\b/.test(documentXml);
		// A header/footer part counts only when it carries real text, so an empty default header is not a caveat.
		for (const name of Object.keys(zip.files)) {
			if (/^word\/(header|footer)\d*\.xml$/.test(name)) {
				const xml = await read(name);
				if (/<w:t[ >]/.test(xml)) { detections.headersFooters = true; break; }
			}
		}
	} catch (e) {
		// Best effort - a detection failure never blocks the import; the card just omits the caveat.
	}
	return detections;
}

async function importDocx(req, res) {
	const body = await readBody(req, MAX_IMPORT_BODY_BYTES);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || typeof parsed.base64 !== 'string' || !parsed.base64) {
		sendJson(res, 400, { error: { type: 'import_error', message: 'base64 is required' } });
		return;
	}
	let buffer;
	try { buffer = Buffer.from(parsed.base64, 'base64'); } catch { buffer = null; }
	if (!buffer || buffer.length < 4) {
		sendJson(res, 200, { ok: false, reason: 'The file could not be read' });
		return;
	}
	// A real .docx is a ZIP ("PK\x03\x04"). An OLE/CFB container ("\xD0\xCF\x11\xE0") is either a legacy .doc
	// or an ENCRYPTED (password-protected) OOXML package - both are refused honestly, never mangled.
	if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
		sendJson(res, 200, { ok: false, reason: 'The file is password-protected or an older Word format' });
		return;
	}
	if (!(buffer[0] === 0x50 && buffer[1] === 0x4B)) {
		sendJson(res, 200, { ok: false, reason: 'The file is not a valid Word .docx' });
		return;
	}
	let mammoth;
	try { mammoth = require('mammoth'); } catch (e) {
		// A missing importer is a refusal like any other (encrypted / invalid-zip / corrupt above): return it
		// as 200 { ok:false, reason } so the client's asJson (which throws on non-2xx before reading the body)
		// surfaces this specific, actionable reason instead of its generic transport-error fallback.
		sendJson(res, 200, { ok: false, reason: 'The docx importer (mammoth) is not installed on the proxy' });
		return;
	}
	try {
		const result = await mammoth.convertToHtml({ buffer });
		const detections = await detectDocxFidelity(buffer);
		sendJson(res, 200, { ok: true, html: result && result.value ? result.value : '', detections });
	} catch (e) {
		// mammoth throws on a corrupt / unparseable document: refuse honestly, do not pretend a conversion.
		sendJson(res, 200, { ok: false, reason: 'The file could not be read as a Word document' });
	}
}

// POST /event: append one product analytics event (JSON) to the local events log (plan 35 iter 4). Used by
// the onboarding survey to record `model_configured` locally; plan 36 forwards this log to PostHog. The proxy
// stamps a UTC timestamp; the body carries no document text or credential (the renderer only sends survey
// answers + the event name). Best effort - a log failure still returns ok so onboarding never blocks.
async function postEvent(req, res) {
	const body = await readBody(req);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || typeof parsed.event !== 'string' || !parsed.event) {
		sendJson(res, 400, { error: { type: 'event_error', message: 'event is required' } });
		return;
	}
	appendAudit(EVENT_LOG_PATH, Object.assign({ ts: new Date().toISOString() }, parsed));
	sendJson(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
	const url = req.url || '';
	if (req.method === 'OPTIONS') {
		setCors(res);
		res.writeHead(204);
		res.end();
		return;
	}
	if (req.method === 'GET' && url.startsWith('/healthz')) {
		setCors(res);
		// `ok` is true only when the active backend is actually configured, so the renderer's probe stays honest
		// and falls back to the heuristic path when no backend is wired. The extra fields feed the Settings
		// provider + usage display (plan 35 iter 4): which door is active, and - for the metered fallback - how
		// much of today's included usage is spent. A subscription backend (openai-oauth) is NOT metered, so it
		// reports no daily figure; today's spend comes from the same authoritative SpendMeter the cap uses.
		const backend = activeBackend();
		sendJson(res, 200, {
			ok: backend.isConfigured(),
			backend: BACKEND,
			meters: backend.meters,
			signedIn: openaiOAuth.isSignedIn(),
			dailyBudgetUsd: DAILY_BUDGET_USD,
			dailyTotalUsd: backend.meters ? Number(spendMeter.dailyTotalUsd().toFixed(6)) : undefined,
		});
		return;
	}
	// --- "Sign in with ChatGPT" OAuth routes (plan 35 iter 2) ---
	// GET /auth/openai/start -> begins the loopback PKCE flow and returns the authorize URL to open in a
	// browser. GET /auth/openai/status -> polls signed-out | pending | signed-in | error. POST
	// /auth/openai/signout -> forgets the token bundle. The renderer only ever sees the authorize URL and a
	// status string; the token itself never leaves this process (decision 14).
	if (req.method === 'GET' && url.startsWith('/auth/openai/start')) {
		setCors(res);
		try {
			const { authorizeUrl } = openaiOAuth.start();
			sendJson(res, 200, { authorizeUrl });
		} catch (e) {
			sendJson(res, 502, { error: { type: 'auth_error', message: String(e && e.message ? e.message : e) } });
		}
		return;
	}
	if (req.method === 'GET' && url.startsWith('/auth/openai/status')) {
		setCors(res);
		sendJson(res, 200, openaiOAuth.status());
		return;
	}
	if (req.method === 'POST' && url.startsWith('/auth/openai/signout')) {
		setCors(res);
		openaiOAuth.signOut();
		sendJson(res, 200, { status: 'signed-out' });
		return;
	}
	if (req.method === 'POST' && url.startsWith('/v1/messages')) {
		forwardMessages(req, res).catch(err => {
			// Surface a clean error to the renderer; never echo the token or message body.
			console.error('[lwd-proxy] request failed:', err && err.message ? err.message : err);
			setCors(res);
			sendJson(res, 502, { type: 'error', error: { type: 'proxy_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/mcp/resolve')) {
		resolveMcp(req, res).catch(err => {
			console.error('[lwd-proxy] mcp resolve failed:', err && err.message ? err.message : err);
			setCors(res);
			sendJson(res, 502, { error: { type: 'mcp_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/proxy/fetch')) {
		proxyFetch(req, res).catch(err => {
			console.error('[lwd-proxy] proxy fetch failed:', err && err.message ? err.message : err);
			setCors(res);
			sendJson(res, 502, { error: { type: 'proxy_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/import/docx')) {
		importDocx(req, res).catch(err => {
			console.error('[lwd-proxy] docx import failed:', err && err.message ? err.message : err);
			setCors(res);
			sendJson(res, 502, { error: { type: 'import_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/event')) {
		postEvent(req, res).catch(err => {
			console.error('[lwd-proxy] event log failed:', err && err.message ? err.message : err);
			setCors(res);
			sendJson(res, 502, { error: { type: 'event_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	setCors(res);
	sendJson(res, 404, { type: 'error', error: { type: 'not_found', message: 'unknown route' } });
});

// CLI: `node scripts/lwd-anthropic-proxy.js set-secret <name> <value>` stores a proxy-side secret (D29-C)
// and exits without starting the server, so a credential is written only to ~/.abstract/secrets.json (0600).
if (process.argv[2] === 'set-secret') {
	const name = process.argv[3];
	const value = process.argv.slice(4).join(' ');
	if (!name || !value) {
		console.error('usage: node scripts/lwd-anthropic-proxy.js set-secret <name> <value>');
		process.exit(1);
	}
	writeSecret(name, value);
	console.log(`[lwd-proxy] stored secret "${name}" in ${SECRETS_PATH} (0600)`);
	process.exit(0);
}

// Tear down any spawned MCP servers when the proxy exits, so no child process is orphaned.
function killMcpServers() {
	for (const conn of mcpConns.values()) { try { conn.child.kill(); } catch { /* already gone */ } }
	mcpConns.clear();
}
process.on('SIGINT', () => { killMcpServers(); openaiOAuth.stopPending(); process.exit(0); });
process.on('SIGTERM', () => { killMcpServers(); openaiOAuth.stopPending(); process.exit(0); });

server.listen(PORT, HOST, () => {
	const backend = activeBackend();
	console.log(`[lwd-proxy] listening on http://${HOST}:${PORT} (backend ${backend.name}, model ${OPENROUTER_MODEL})`);
	if (backend.name === 'openrouter') {
		console.log(`[lwd-proxy] key source: OPENROUTER_API_KEY / OPENROUTER_API_KEY_FILE; daily included usage cap US$${DAILY_BUDGET_USD}/user`);
		if (!backend.isConfigured()) { console.log('[lwd-proxy] no OpenRouter key configured - the app runs on its built-in heuristic fallback'); }
	} else if (backend.name === 'openai-oauth') {
		console.log(`[lwd-proxy] "Sign in with ChatGPT" backend; model ${openaiOAuth.OPENAI_MODEL}; token store ${openaiOAuth.STORE_PATH} (0600)`);
		if (!backend.isConfigured()) { console.log('[lwd-proxy] not signed in - open Abstract Settings and choose "Sign in with ChatGPT", or run on the included model'); }
	}
});
