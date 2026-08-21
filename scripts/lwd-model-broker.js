/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Localhost-only model broker for the Living Documents web build (served by @vscode/test-web at
// http://localhost:8080). The engine speaks the Messages protocol internally; this broker
// authenticates against a pluggable backend and translates the request/response so no credential ever
// reaches the renderer (decision 14: the credential lives only in this process). No CSP/CORS changes are
// needed - the sources build sets no connect-src CSP and this broker owns the CORS policy (localhost-bind
// only). If no backend is configured (or it errors) the renderer degrades to its built-in heuristic path,
// so the app stays demoable with ZERO backends.
//
// The app supervises this broker itself (issue #169): the Electron main process spawns it on startup,
// health-checks /healthz, restarts it on crash with backoff, and kills it on shutdown - so no terminal
// step is ever required. Running the script by hand still works; the supervisor adopts an already-healthy
// broker on 8090 rather than double-spawning.
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
// The app starts it automatically; to run it by hand use ./scripts/lwd-model-broker.sh (Node 24).
// Nothing is committed except this script.

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { SpendMeter } = require('./lwd-spend-meter.js');
const openaiOAuth = require('./lwd-openai-oauth.js');
const openrouterModels = require('./lwd-openrouter-models.js');
const { renderDocx } = require('./lwd-docx.js');

// Bind dual-stack (issue #121): the packaged desktop app's default proxy URL is http://localhost:8090, and on
// macOS Node/Electron resolves `localhost` to ::1 (IPv6) first. A prior IPv4-only bind ('127.0.0.1') meant the
// app targeted ::1 and never connected - the broker saw zero requests and the UI showed "Model unavailable"
// even with a healthy broker (this also silently broke the in-app docx import/export routes, which share the
// base URL). Binding '::' accepts BOTH ::1 and IPv4-mapped 127.0.0.1 connections on a dual-stack host, so
// `localhost` connects no matter which family it resolves to. On a host with IPv6 disabled `listen('::')`
// throws (EAFNOSUPPORT/EADDRNOTAVAIL); we fall back to '127.0.0.1' and log which mode is active (see the
// listen call below). Override the preferred bind with LWD_PROXY_HOST if ever needed.
const PREFERRED_HOST = process.env.LWD_PROXY_HOST || '::';
const FALLBACK_HOST = '127.0.0.1';
const PORT = Number(process.env.LWD_PROXY_PORT || 8090);
// The host actually bound, resolved at listen time (dual-stack '::' or the IPv4 fallback). Truthful log lines
// and self-reports read this rather than a fixed constant. Defaults to the preferred host until listen resolves.
let boundHost = PREFERRED_HOST;

// Backend selection is PER REQUEST (plan 51 WP-C, fixing #120's root cause). Historically the backend was
// fixed at spawn via LWD_BACKEND (default `openrouter`) and never switched, so a mid-session ChatGPT sign-in
// changed /auth/openai/status to signed-in while /v1/messages kept routing to openrouter. Now selectBackend()
// runs on every request: in dynamic mode (the default) it prefers `openai-oauth` whenever the OAuth bundle can
// serve (valid, or expired-but-refreshable - the forward refreshes transparently), else `openrouter`. Deleting
// the bundle falls back on the very next request; signing in switches serving on the very next request. No
// broker restart, ever. Selection is at REQUEST START only: a forward that then fails upstream returns the
// honest error - we NEVER silently retry a failed request on the other backend mid-flight (that would hide a
// real fault and double-bill). LWD_BACKEND demotes to an explicit dev override: unset = dynamic; set = forced
// to exactly that backend (and /healthz says so).
const BACKEND_OVERRIDE = process.env.LWD_BACKEND ? process.env.LWD_BACKEND.toLowerCase() : null;
const BACKEND_MODE = BACKEND_OVERRIDE ? 'forced' : 'dynamic';

const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
// OpenRouter's live model index, used ONLY by the /models/openrouter/catalogue discovery route to tell the
// operator which curated ids upstream actually serves right now. Never consulted on the serving path.
const OPENROUTER_MODELS_URL = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';
// The id a call lands on when it carries no model, or one this door does not offer. The door now serves a
// CURATED LIST (lwd-openrouter-models.js) rather than a single hardcoded model, so this is the list's default
// rather than a constant; OPENROUTER_MODEL still forces one id for a dev/one-off run.
function openRouterDefaultModel() {
	return openrouterModels.defaultModelId();
}

// The output cap used when a caller names none. The client sends a PER-PURPOSE `max_tokens` (a chat reply,
// a fan-out batch and a one-sentence grade want wildly different ceilings), so this value is only the floor
// for a hand-run curl or an older client. It was 1024, which silently truncated any real reply - a truncation
// machine, in doc 30 section 2.6's words - and truncation on this door surfaces as `stop_reason: max_tokens`
// with a half-finished JSON body the renderer then fails to parse. Raised so the default errs towards a
// complete answer; a caller that wants a tighter cap still says so and is honoured verbatim.
const DEFAULT_MAX_TOKENS = 4096;

// Bound the request body so a runaway client cannot exhaust memory; model calls here are tiny.
const MAX_BODY_BYTES = 1 * 1024 * 1024;
// The source-extraction routes carry a base64-encoded workbook/PDF, which is larger than a model
// call; a beta user's weekly pack is well under this (doc 22 section 4). Kept separate so raising it never
// widens the model-call surface.
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

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
// The meter's clock is the wall clock in production. For automated proof of the day-boundary RESET without
// racing a real midnight or mutating Date.now (which breaks unrelated timers), an OPTIONAL test seam adds a
// millisecond offset read from a file: point LWD_SPEND_CLOCK_FILE at a file whose contents are an integer ms
// offset, and the test advances the clock by writing a full-day offset to it. Unset (the default, and every
// real launch) it is a plain wall clock with zero overhead. The file is read best-effort on each tick; a
// missing/garbage file contributes a zero offset, so the seam can never make the meter misbehave in the wild.
const SPEND_CLOCK_FILE = process.env.LWD_SPEND_CLOCK_FILE || '';
function spendClockNow() {
	if (!SPEND_CLOCK_FILE) { return Date.now(); }
	let offset = 0;
	try { const n = Number.parseInt(fs.readFileSync(SPEND_CLOCK_FILE, 'utf8').trim(), 10); if (Number.isFinite(n)) { offset = n; } }
	catch { /* no file yet / unreadable -> zero offset, plain wall clock */ }
	return Date.now() + offset;
}
const spendMeter = new SpendMeter({ dailyBudgetUsd: DAILY_BUDGET_USD, clock: { now: spendClockNow } });

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

// The app origins allowed to call this localhost-only broker. The web build is served by @vscode/test-web on
// http://localhost:8080; the desktop build's renderer + webviews run under vscode-file://vscode-app (and the
// webview iframes under vscode-webview://). We reflect the request's Origin when it is one of these (a scoped
// allow, not a blanket '*'), plus a couple of extra localhost ports operators use, and fall back to '*' only
// when there is NO Origin header at all (a same-process/tool call, never a browser). This keeps a real app
// origin echoed back - which a browser requires to READ the response - without opening the broker to any web
// page. Extra origins can be added via LWD_ALLOWED_ORIGINS (comma-separated) for a non-default web port.
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:8080', 'http://127.0.0.1:8080', 'vscode-file://vscode-app'];
const EXTRA_ALLOWED_ORIGINS = (process.env.LWD_ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);
// The desktop webview origin is vscode-webview://<guid> - a per-webview opaque guid we cannot enumerate, so
// match the scheme rather than a fixed value. Same trust boundary (the app's own webviews), still not the web.
function isAllowedOrigin(origin) {
	if (!origin) { return false; }
	if (ALLOWED_ORIGINS.has(origin)) { return true; }
	return origin.startsWith('vscode-webview://');
}

/**
 * CORS for a localhost-only dev proxy, scoped to the app's own origins (plan 51 WP-D). Reflects the request's
 * Origin when it is an allowed app origin (the web build's localhost:8080, the desktop app's vscode-file /
 * vscode-webview) so a browser can READ the response; a request with no Origin (a same-process/tool call) gets
 * '*'. An unrecognised browser Origin is NOT echoed - the broker never becomes callable from an arbitrary web
 * page. Passing `req` is what lets this be scoped; the OPTIONS preflight and every route response run through it.
 * @param {import('http').IncomingMessage} [req]
 */
function setCors(res, req) {
	const origin = req && req.headers ? req.headers.origin : undefined;
	res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin(origin) ? origin : '*');
	res.setHeader('Vary', 'Origin');
	res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'content-type, anthropic-version, anthropic-beta');
	res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(body);
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', chunk => {
			size += chunk.length;
			if (size > maxBytes) {
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
// eslint-disable-next-line local/code-no-unexternalized-strings -- a Node script has no nls; this user-facing string is intentionally double-quoted for its apostrophes.
const CAP_MESSAGE = "You've used today's included usage - picks up tomorrow, or sign in with ChatGPT for unlimited.";
function capReached() {
	return {
		status: 200,
		contentType: 'application/json',
		text: JSON.stringify({
			id: 'lwd-cap',
			type: 'message',
			role: 'assistant',
			model: openRouterDefaultModel(),
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

// The opening `message_start` event, naming the model this stream is ACTUALLY served by. The buffered path
// has always echoed the resolved id in its `model` field; a stream had no equivalent, so a caller could not
// tell which model answered - and after resolveRequestedModel swaps a stale or absent pick for the catalogue
// default, "which model answered" is a different question from "which model was asked for". The renderer's
// SSE parser ignores event types it does not know (livingDocSse.ts), so this is additive on the wire.
function sseMessageStart(id, model) {
	return sseEvent('message_start', {
		type: 'message_start',
		message: { id, type: 'message', role: 'assistant', model, content: [] },
	});
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
// eslint-disable-next-line local/code-no-unexternalized-strings -- a Node script has no nls; this user-facing string is intentionally double-quoted for its apostrophes.
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
	// The key file, either explicit (OPENROUTER_API_KEY_FILE) or the default location. The default used to live
	// only in lwd-model-broker.sh; keeping it here too means the app-supervised broker (spawned as `node ...`
	// directly, without the shell wrapper) finds the same key, so the included model works out of the box (#169).
	const file = process.env.OPENROUTER_API_KEY_FILE || path.join(os.homedir(), '.config', 'lwd-openrouter.key');
	try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
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
	// Serve the model the caller resolved onto (forwardMessages stamps `req.model` after validating it against
	// this door's curated list). Before plan 53 this door hardcoded a single id and DISCARDED req.model, so the
	// composer's picker was decorative on the included door - every turn ran on gpt-4.1-mini whatever it said.
	const orModel = req.model || openRouterDefaultModel();
	const orBody = JSON.stringify({ model: orModel, max_tokens: req.max_tokens || DEFAULT_MAX_TOKENS, messages: toOpenRouterMessages(req), usage: { include: true } });
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
		// Log the FULL upstream status + body to broker stdout for diagnosability (#120's ask); the client only
		// ever gets the honest short error shape (no token, no raw upstream body). Never a silent fallback.
		console.error(`[lwd-proxy] openrouter forward failed: upstream ${upstream.status}; body: ${orText}`);
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
		model: orJson.model || orModel,
		stop_reason: stopReason,
		content: [{ type: 'text', text: String(text) }],
	};
	return { status: 200, contentType: 'application/json', text: JSON.stringify(anthropic), usage: orJson.usage };
}

async function openRouterForwardStream(req, res) {
	const key = openRouterKey();
	if (!key) {
		setCors(res, req);
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: 'OPENROUTER_API_KEY (or OPENROUTER_API_KEY_FILE) is not set' } }));
		return { usage: undefined };
	}
	// Same as the buffered path: the caller's resolved model is load-bearing here, not advisory.
	const orModel = req.model || openRouterDefaultModel();
	const orBody = JSON.stringify({ model: orModel, max_tokens: req.max_tokens || DEFAULT_MAX_TOKENS, messages: toOpenRouterMessages(req), stream: true, usage: { include: true } });
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
		console.error(`[lwd-proxy] openrouter stream forward failed: upstream ${upstream.status}; body: ${text}`);
		setCors(res, req);
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }));
		return { usage: undefined };
	}
	writeSseHead(res);
	res.write(sseMessageStart('or-msg', orModel));
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
	try {
		// The header shape lives with the bundle it authenticates (lwd-openai-oauth.authHeaders) so the
		// entitlement probe and the serve paths can never drift apart; this wrapper only adds the typed failure.
		return await openaiOAuth.authHeaders();
	} catch (e) {
		throw new OpenAiAuthError(e && e.message ? e.message : 'not signed in');
	}
}

// Translate an Anthropic Messages request to an OpenAI Responses request. The system prompt maps to
// `instructions`; the conversation maps to `input` with typed text parts (an assistant turn uses
// `output_text`, everything else `input_text`), reusing the shared toOpenRouterMessages flattening.
//
// The three constants below are NOT stylistic - the Codex Responses backend rejects a request missing any of
// them, each with its own 400. Established at the wire during the 12 Aug founder smoke (plan 51 section 5), which is
// where the stub-validated shape and the real shape were first compared:
//   - no `store`             -> {"detail":"Store must be set to false"}
//   - `stream:false`         -> {"detail":"Stream must be set to true"}
//   - any `max_output_tokens`-> {"detail":"Unsupported parameter: max_output_tokens"}
// So this endpoint is stream-only: the buffered caller assembles the completion from the stream (see
// openAiForward) rather than asking upstream for a whole body it will never serve. The Anthropic request's
// `max_tokens` has NO representation here - upstream refuses to be told - so a caller's cap is honoured by
// the renderer's own handling, not by upstream truncation. The `stream` parameter is kept in the signature
// because callers still read it, but it can only ever be true on the wire.
function toResponsesRequest(req, _stream) {
	const flattened = toOpenRouterMessages(req);
	const instructionsParts = flattened.filter(m => m.role === 'system').map(m => m.content);
	const input = flattened.filter(m => m.role !== 'system').map(m => ({
		role: m.role,
		content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
	}));
	const body = {
		// The resolved model id (issue #179): forwardMessages stamps `req.model` after validating it against the
		// subscription's list, so the user's pick is load-bearing here. Falls back to the backend default model
		// when the request carried none (a direct hand-run call), never an undefined model.
		model: (typeof req.model === 'string' && req.model) ? req.model : openaiOAuth.OPENAI_MODEL,
		input,
		store: false,
		stream: true,
	};
	if (instructionsParts.length) { body.instructions = instructionsParts.join('\n\n'); }
	return body;
}

// Read a Codex Responses SSE body, handing each text delta to `onDelta` and resolving the terminal
// `response.completed` payload (or undefined if the stream ended without one). Shared by both forward paths
// so the event vocabulary - `response.output_text.delta`, `response.completed` - is parsed in exactly one
// place; the real event sequence it is written against is pinned in scripts/test/fixtures/.
async function readResponsesStream(webStream, onDelta) {
	const nodeStream = Readable.fromWeb(webStream);
	let buf = '';
	let completed;
	for await (const chunk of nodeStream) {
		buf += chunk.toString('utf8');
		let nl;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line.startsWith('data:')) { continue; }
			const payload = line.slice(5).trim();
			if (payload === '[DONE]') { return completed; }
			let j;
			try { j = JSON.parse(payload); } catch { continue; } // keep-alive comment or partial chunk
			if (j.type === 'response.output_text.delta' && typeof j.delta === 'string' && j.delta.length) {
				onDelta(j.delta);
			} else if (j.type === 'response.completed') {
				completed = j.response || j;
				return completed;
			}
		}
	}
	return completed;
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
	const sent = toResponsesRequest(req, false);
	// Upstream is stream-only (see toResponsesRequest), so even this buffered caller opens an SSE stream and
	// assembles the completion itself. The client still receives one whole Anthropic message.
	const upstream = await fetch(openaiOAuth.RESPONSES_URL, {
		method: 'POST',
		headers: Object.assign({}, headers, { 'accept': 'text/event-stream' }),
		body: JSON.stringify(sent),
	});
	// A 401 means the access token was rejected despite the pre-flight refresh (revoked mid-life): surface the
	// plain-words re-auth pause rather than a proxy error, so the run pauses cleanly and prompts a sign-in.
	if (upstream.status === 401 || upstream.status === 403) { return reauthReached(); }
	if (!upstream.ok || !upstream.body) {
		const rawText = await upstream.text().catch(() => '');
		// Log the full upstream status + body to broker stdout (#120's diagnosability ask); the client receives
		// only the honest short error shape. This is the chosen door's own failure - NOT a trigger to retry the
		// request on openrouter (a mid-request cross-backend retry would mask a real fault and is deliberately
		// never done here; the fallback is a next-request selection concern, not an in-flight one).
		console.error(`[lwd-proxy] openai-oauth forward failed: upstream ${upstream.status}; body: ${rawText}`);
		return proxyError(upstreamRefusal(sent.model, upstream.status, rawText));
	}
	let text = '';
	const completed = await readResponsesStream(upstream.body, delta => { text += delta; });
	const json = completed || {};
	const anthropic = {
		id: json.id || 'oa-msg',
		type: 'message',
		role: 'assistant',
		model: json.model || sent.model,
		stop_reason: responsesStopReason(json),
		content: [{ type: 'text', text: String(text || textFromResponses(json)) }],
	};
	// meters:false, so no usage is returned to the meter (a subscription call is not the founder's budget).
	return { status: 200, contentType: 'application/json', text: JSON.stringify(anthropic), usage: undefined };
}

/**
 * Turn an upstream refusal into the plain-words message the client sees, and - when upstream definitively
 * refused the MODEL rather than the request - record that verdict so the catalogue stops offering it (the
 * self-healing rule in lwd-openai-oauth's entitlement block). Returns the message to surface.
 */
function upstreamRefusal(model, status, rawBody) {
	let detail = '';
	try { const j = JSON.parse(rawBody); detail = (j && (j.detail || (j.error && j.error.message))) || ''; } catch { /* no JSON body */ }
	if (detail && /\bis not supported\b/i.test(detail) && detail.includes(model)) {
		openaiOAuth.markUnentitled(model, detail);
		console.error(`[lwd-proxy] ${model} is not available to this subscription; removed from the catalogue: ${detail}`);
	}
	return detail || `openai http ${status}`;
}

async function openAiForwardStream(req, res) {
	let headers;
	try { headers = await openAiAuthHeaders(); }
	catch (e) { if (e instanceof OpenAiAuthError) { writeReauthStream(res); return { usage: undefined }; } throw e; }
	const sent = toResponsesRequest(req, true);
	const upstream = await fetch(openaiOAuth.RESPONSES_URL, {
		method: 'POST',
		headers: Object.assign({}, headers, { 'accept': 'text/event-stream' }),
		body: JSON.stringify(sent),
	});
	if (upstream.status === 401 || upstream.status === 403) { writeReauthStream(res); return { usage: undefined }; }
	if (!upstream.ok || !upstream.body) {
		const text = await upstream.text().catch(() => '');
		console.error(`[lwd-proxy] openai-oauth stream forward failed: upstream ${upstream.status}; body: ${text}`);
		const message = upstreamRefusal(sent.model, upstream.status, text);
		setCors(res, req);
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }));
		return { usage: undefined };
	}
	writeSseHead(res);
	res.write(sseMessageStart('oa-msg', sent.model));
	const endStream = () => { if (!res.writableEnded) { res.write(sseEvent('message_stop', { type: 'message_stop' })); res.end(); } };
	res.on('close', () => { /* the shared reader stops when the client hangs up */ });
	// Translate each upstream text delta into the Anthropic-shaped content_block_delta the renderer's SSE
	// parser reads; the shared reader owns the event vocabulary and the terminal `response.completed`.
	await readResponsesStream(upstream.body, delta => {
		if (!res.writableEnded) {
			res.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } }));
		}
	}).catch(() => undefined);
	endStream();
	return { usage: undefined };
}

// --- OpenRouter catalogue discovery (plan 53) ------------------------------------------------------------
// Fetch OpenRouter's live model index and report which CURATED ids it actually serves. Answers the one
// question the allowlist cannot answer on its own - "is this slug still real?" - so promoting a candidate to
// `validated: true` is grounded in the upstream list rather than in someone's memory of a model name.
// Best effort by construction: an upstream failure returns `live: null` with the reason, and every curated id
// reports `upstream: 'unknown'` rather than being called dead. Never used to gate serving.
async function openRouterCatalogue() {
	const curated = openrouterModels.OPENROUTER_MODELS.map(m => ({
		id: m.id,
		label: m.label,
		validated: m.validated === true,
		validatedOn: m.validatedOn,
		notes: m.notes,
	}));
	const offered = new Set(openrouterModels.listModels().map(m => m.id));
	let live = null;
	let liveError;
	const key = openRouterKey();
	try {
		const headers = key ? { authorization: `Bearer ${key}` } : {};
		const upstream = await fetch(OPENROUTER_MODELS_URL, { headers });
		if (!upstream.ok) { throw new Error(`openrouter http ${upstream.status}`); }
		const json = await upstream.json();
		if (json && Array.isArray(json.data)) { live = new Set(json.data.map(m => m && m.id).filter(Boolean)); }
		else { throw new Error('unexpected /models shape'); }
	} catch (e) {
		liveError = e && e.message ? e.message : String(e);
	}
	return {
		configPath: openrouterModels.MODELS_CONFIG_PATH,
		includeUnvalidated: openrouterModels.includeUnvalidated(),
		liveModelCount: live ? live.size : null,
		liveError,
		models: curated.map(m => Object.assign({}, m, {
			// What the picker does with it right now, and whether upstream still has the slug.
			offered: offered.has(m.id),
			upstream: live ? (live.has(m.id) ? 'available' : 'missing') : 'unknown',
		})),
	};
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

/**
 * Choose the backend for THIS moment (plan 51 WP-C). Forced mode honours LWD_BACKEND exactly (dev override).
 * Dynamic mode (the default) prefers `openai-oauth` whenever the OAuth bundle can serve - valid, or expired but
 * refreshable, decided by lwd-openai-oauth.canServe() from the bundle alone (no network) - otherwise falls back
 * to `openrouter`. Pure and synchronous, so every request re-decides from live state: a mid-session sign-in or a
 * bundle deletion takes effect on the next call with no restart. This is the fix for #120 (backend no longer
 * fixed at spawn). Selection happens once per request, at the start; a chosen backend that then fails upstream
 * surfaces its honest error - there is deliberately NO mid-request cross-backend retry here.
 */
function selectBackend() {
	if (BACKEND_MODE === 'forced') {
		return backends[BACKEND_OVERRIDE] || backends.openrouter;
	}
	return openaiOAuth.canServe() ? backends['openai-oauth'] : backends.openrouter;
}

// --- model listing (issue #179) -----------------------------------------------------------------------
// The models the ACTIVE backend can drive, shaped as { id, label, default, tier } for the composer's picker.
// Every backend exposes exactly one `default:true` entry - the model a request lands on when it sends no
// `model` or a stale/unknown one (never a 500 on a persisted id). `tier` (issue #236, plan 47 pin 14) groups
// the picker's popover: `included` = the founder-funded fallback the user did not pay for; `own-key` = a model
// the user's own subscription drives. The openrouter backend serves ONE included model, so its list is a single
// `included` entry; the openai-oauth backend returns the subscription's `own-key` catalogue (static today - the
// Codex OAuth token cannot enumerate models live - behind lwd-openai-oauth.listModels(), which is the seam a
// future live query slots into). This returns ONE backend's catalogue; mergedModels() (below) stitches both
// backends' lists together for /models so the composer selector sees every door at once and can name which is
// serving. A backend that is not configured still returns its catalogue (its entries carry `available:false`
// in the merge) so the picker renders consistently rather than emptying. `tier` is additive: an older renderer
// that ignores it still reads id/label/default unchanged.
async function modelsForBackend(backend) {
	if (backend.name === 'openai-oauth') {
		try {
			const models = await openaiOAuth.listModels();
			if (Array.isArray(models) && models.length) { return models.map(m => ({ ...m, tier: 'own-key' })); }
		} catch { /* fall through to a safe single-entry default below */ }
		// A listModels failure must never empty the picker: fall back to the one known default model.
		return [{ id: openaiOAuth.OPENAI_MODEL, label: 'ChatGPT model', default: true, tier: 'own-key' }];
	}
	// openrouter: the CURATED allowlist (lwd-openrouter-models.js), product-labelled, never the raw upstream id.
	// Was a single hardcoded entry before plan 53; now every validated model the founder has proven for this task.
	return openrouterModels.listModels().map(m => ({ ...m, tier: 'included' }));
}

// The merged /models catalogue (plan 51 WP-C): BOTH backends' models in one list, each entry carrying its
// `backend` and a truthful `available` flag, so the composer selector can render every door and name which is
// serving right now. `available` is the door's real health: openai-oauth entries are available only when the
// bundle can serve (signed in, valid-or-refreshable via canServe()); openrouter entries are available only when
// a key is present AND the daily included cap is not already spent - a budget-paused door is NOT available, so
// /models names the pause the same way /healthz does (plan 51 WP-D: the cap pause must name itself in BOTH).
// `serving` marks the entries on the door selectBackend() would use for this next request, so the UI can
// highlight the live door without re-deriving the selection logic. This is purely ADDITIVE over the prior
// single-backend shape: id/label/default/tier are unchanged, so an older renderer keeps working; the response
// still carries a top-level `backend` naming the serving door for backward compatibility.
async function mergedModels() {
	const serving = selectBackend();
	// The metered fallback is unavailable while its daily cap is spent, mirroring /healthz's `budget-paused`
	// reason - so the picker's included row honestly greys out for the rest of the day, not just when key-less.
	const openrouterAvailable = backends.openrouter.isConfigured() && !spendMeter.isOverBudget();
	const oauthAvailable = backends['openai-oauth'].isConfigured() && openaiOAuth.canServe();
	const availabilityFor = name => (name === 'openai-oauth' ? oauthAvailable : openrouterAvailable);
	const out = [];
	for (const name of ['openai-oauth', 'openrouter']) {
		const list = await modelsForBackend(backends[name]);
		for (const m of list) {
			// A model this subscription is known to be refused is NOT available, however healthy its door is
			// (plan 51 founder smoke: gpt-5.6-sol exists in the docs but no ChatGPT account may call it). An
			// unverified model (`entitled: null`) stays available - we only ever demote on a proven refusal.
			const available = availabilityFor(name) && m.entitled !== false;
			out.push({ ...m, backend: name, available, serving: serving.name === name });
		}
	}
	return out;
}

// The default model id for a backend's list (the entry flagged default, else the first). Used to resolve an
// absent/invalid `model` on /v1/messages so a stale persisted id can never 500 - it just lands on the default.
function defaultModelId(models) {
	// Never resolve onto a model upstream is known to refuse - that would turn an absent/stale pick into a
	// guaranteed 400 (plan 51 founder smoke). Prefer the flagged default, then any callable entry, then anything.
	const callable = m => m && m.entitled !== false;
	const flagged = models.find(m => m && m.default && callable(m));
	const firstCallable = models.find(callable);
	return (flagged && flagged.id) || (firstCallable && firstCallable.id) || (models[0] && models[0].id) || '';
}

// Resolve the caller's requested model against the active backend's list: keep it when it is a known id,
// otherwise fall back to the backend default (absent OR unknown/stale). Returns the id to actually use. The
// resolved id is LOAD-BEARING on both doors: openai-oauth stamps it into the Responses request, and since
// plan 53 openrouter forwards it too (it previously discarded it and served one hardcoded model, which made
// the composer's picker decorative on the included door - the root cause of "the model I picked is ignored").
function resolveRequestedModel(requested, models) {
	const fallback = defaultModelId(models);
	if (typeof requested !== 'string' || !requested) { return fallback; }
	// A known-refused id is treated exactly like a stale one: fall back rather than forward a request upstream
	// has already told us it will reject (plan 51 founder smoke).
	const match = models.find(m => m && m.id === requested);
	return (match && match.entitled !== false) ? requested : fallback;
}

// Cap a caller-supplied value before it is echoed into the broker log. `parsed.model` is attacker-controllable
// (a client can POST a 10KB model string); a real model id is short, so anything longer is truncated with an
// ellipsis to keep the log line bounded. Harmless on a machine-local broker, but log hygiene regardless.
const LOG_VALUE_MAX = 80;
function forLog(value) {
	const s = String(value);
	return s.length > LOG_VALUE_MAX ? `${s.slice(0, LOG_VALUE_MAX)}…(${s.length})` : s;
}

// Meter one metered (openrouter) call: charge the resolved cost, emit a `model_spend` audit record, and
// return whether the day's included usage is now spent. Not called for a non-metering backend (a user's
// own subscription is not the founder's budget). Cost uses real API numbers where present, an honest
// estimate otherwise (see openRouterCost).
function meterCall(backend, usage, model) {
	if (!backend.meters) { return; }
	const { costUsd, estimated } = openRouterCost(usage);
	const outcome = spendMeter.charge(costUsd);
	auditModelSpend({
		event: 'model_spend',
		ts: new Date().toISOString(),
		provider: backend.name,
		model: model || openRouterDefaultModel(),
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
		setCors(res, req);
		sendJson(res, 400, { type: 'error', error: { type: 'proxy_error', message: 'invalid request body' } });
		return;
	}
	// Pick the door for THIS request (plan 51 WP-C): dynamic mode prefers a servable ChatGPT bundle, else the
	// included fallback; forced mode honours LWD_BACKEND. Chosen once, here, at request start - a forward that
	// then fails upstream returns its honest error, never a silent retry on the other door (see selectBackend).
	const backend = selectBackend();
	const streaming = parsed.stream === true;
	// Resolve the caller's optional `model` against the active backend's list (issue #179): an absent, unknown,
	// or stale-persisted id falls back to the backend default rather than 500ing. The resolved id is stamped
	// onto the parsed request so the backend forwarders use it, and logged so the E2E can prove which model a
	// call actually ran on. Load-bearing on BOTH doors since plan 53: openai-oauth makes it the Responses
	// request's `model`, and openrouter forwards it upstream instead of discarding it for a hardcoded id.
	const requestedModel = typeof parsed.model === 'string' ? parsed.model : undefined;
	const models = await modelsForBackend(backend);
	const resolvedModel = resolveRequestedModel(requestedModel, models);
	parsed.model = resolvedModel;
	console.log(`[lwd-proxy] /v1/messages backend=${backend.name} requested=${requestedModel === undefined ? 'null' : JSON.stringify(forLog(requestedModel))} resolved=${resolvedModel}`);
	// Budget gate (metered backends only): if the day's included usage is already spent, do NOT call the
	// model - return the plain-words cap message so the renderer pauses the run via D15 and keeps proposals.
	if (backend.meters && spendMeter.isOverBudget()) {
		if (streaming) { writeCapStream(res); }
		else {
			const capped = capReached();
			setCors(res, req);
			res.writeHead(capped.status, { 'content-type': capped.contentType });
			res.end(capped.text);
		}
		return;
	}
	if (streaming) {
		const { usage } = await backend.forwardStream(parsed, res);
		meterCall(backend, usage, resolvedModel);
		return;
	}
	const result = await backend.forward(body, parsed);
	// Only meter a successful model call (a proxy/backend error did not spend the founder's budget).
	if (result.status === 200) { meterCall(backend, result.usage, resolvedModel); }
	setCors(res, req);
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
		setCors(res, req);
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
	setCors(res, req);
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
// CORS is set on EVERY response here (plan 51 WP-D): this route previously called sendJson directly without
// setCors, so the actual POST response carried no Access-Control-Allow-Origin and the browser blocked the
// renderer from reading it ("No 'Access-Control-Allow-Origin'", WP-B validator finding) - the OPTIONS preflight
// passed but the real response did not, so the event never landed. Now the scoped-origin header is present on
// the 200, the 400, and the dispatcher's 502, so the renderer's analytics.capture() completes end to end.
async function postEvent(req, res) {
	setCors(res, req);
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

// Conversion runs where file access + Node libs live, never in the renderer (doc 22 section 3). The docx export
// (issue #130) is a pure text->bytes transform: the renderer POSTs the already-resolved export Markdown (bind
// values inlined as plain text) plus a map of image src -> data URI, and this returns the .docx bytes for the
// renderer to write beside the document. Sibling conversions (docx IMPORT via mammoth, xlsx/PDF sources) live
// alongside this in the proxy, so all format conversion is one layer. The body cap is raised because inlined
// images make the payload larger than the default JSON routes.
const DOCX_MAX_BODY_BYTES = 24 * 1024 * 1024;
async function exportDocx(req, res) {
	setCors(res, req);
	const body = await readBody(req, DOCX_MAX_BODY_BYTES);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || typeof parsed.markdown !== 'string') {
		sendJson(res, 400, { error: { type: 'export_error', message: 'markdown is required' } });
		return;
	}
	const bytes = renderDocx({ title: parsed.title, subtitle: parsed.subtitle, markdown: parsed.markdown, images: parsed.images });
	res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-length': bytes.length });
	res.end(bytes);
}

// --- source extraction: xlsx -> CSV, PDF -> context text (issue #131, doc 22 section 4) ----------------------
// Extraction runs HERE, in the node/proxy layer where file access + the heavy libraries live, never in
// the renderer (P6 portability + the guardrail that a limitation is named, never a silent misread). The
// renderer POSTs the file's bytes (base64) and receives clean CSV text / extracted context text back; it
// then writes the plain-text results into the project folder itself. The engine is a pure module
// (lwd-source-extract.js) with its own `node --test` suite; SheetJS + pdf-parse are lazily required so a
// proxy without those dev deps still starts and serves the model routes (the source routes then 501).
let _extractEngine;
function sourceExtractEngine() {
	if (_extractEngine === undefined) {
		try { _extractEngine = require('./lwd-source-extract.js'); }
		catch (e) { _extractEngine = null; console.error('[lwd-proxy] source-extract engine unavailable:', e && e.message ? e.message : e); }
	}
	return _extractEngine;
}
function optionalLib(name) {
	try { return require(name); } catch { return null; }
}

// POST /sources/xlsx: body { dataBase64, dayFirst? } -> { sheets: [{ name, fileName, csv, rows, cols,
// warnings }] }. Each sheet is a clean comma-delimited, number/date-normalised CSV the renderer writes to
// data/<workbook>/<sheet>.csv. A merged-header/pivot sheet carries a NAMED warning, never a silent misread.
async function extractXlsx(req, res) {
	setCors(res, req);
	const engine = sourceExtractEngine();
	const xlsx = optionalLib('xlsx');
	if (!engine || !xlsx) {
		sendJson(res, 501, { error: { type: 'source_error', message: 'spreadsheet extraction is not available in this build' } });
		return;
	}
	const body = await readBody(req, MAX_SOURCE_BYTES);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || typeof parsed.dataBase64 !== 'string') {
		sendJson(res, 400, { error: { type: 'source_error', message: 'dataBase64 is required' } });
		return;
	}
	try {
		const buffer = Buffer.from(parsed.dataBase64, 'base64');
		const { sheets } = engine.extractWorkbook(buffer, xlsx, { dayFirst: !!parsed.dayFirst });
		const shaped = sheets.map(s => ({ name: s.name, fileName: engine.sheetFileName(s.name), csv: s.csv, rows: s.rows, cols: s.cols, warnings: s.warnings }));
		sendJson(res, 200, { sheets: shaped });
	} catch (e) {
		sendJson(res, 502, { error: { type: 'source_error', message: String(e && e.message ? e.message : e) } });
	}
}

// POST /sources/pdf: body { dataBase64 } -> { readable, text, pages, reason }. A text PDF returns its
// extracted text (read-only CONTEXT, never value bindings); a scanned/image-only or password-protected PDF
// returns readable:false with a plain-words reason, never empty context masquerading as a read.
async function extractPdfRoute(req, res) {
	setCors(res, req);
	const engine = sourceExtractEngine();
	const pdfParse = optionalLib('pdf-parse');
	if (!engine || !pdfParse || !pdfParse.PDFParse) {
		sendJson(res, 501, { error: { type: 'source_error', message: 'PDF extraction is not available in this build' } });
		return;
	}
	const body = await readBody(req, MAX_SOURCE_BYTES);
	let parsed;
	try { parsed = JSON.parse(body); } catch { parsed = undefined; }
	if (!parsed || typeof parsed.dataBase64 !== 'string') {
		sendJson(res, 400, { error: { type: 'source_error', message: 'dataBase64 is required' } });
		return;
	}
	try {
		const buffer = Buffer.from(parsed.dataBase64, 'base64');
		const result = await engine.extractPdf(buffer, pdfParse.PDFParse);
		sendJson(res, 200, result);
	} catch (e) {
		sendJson(res, 502, { error: { type: 'source_error', message: String(e && e.message ? e.message : e) } });
	}
}

// Opt-in access log (issue #121): only /v1/messages logs a line by default, so a connectivity problem (the
// app resolving `localhost` to an address the broker was not bound on) was invisible - a /healthz probe that
// never arrived left no trace, making "zero requests" ambiguous between "app never called" and "call never
// logged". Set LWD_PROXY_ACCESS_LOG=1 to log every incoming request (method + path + remote address) so the
// diagnostic is truthful. Kept off by default so the 30s health poll does not spam the app log in normal use.
const ACCESS_LOG = process.env.LWD_PROXY_ACCESS_LOG === '1';
const server = http.createServer((req, res) => {
	const url = req.url || '';
	if (ACCESS_LOG) {
		console.log(`[lwd-proxy] ${req.method} ${url} from ${req.socket.remoteAddress}`);
	}
	if (req.method === 'OPTIONS') {
		setCors(res, req);
		res.writeHead(204);
		res.end();
		return;
	}
	if (req.method === 'GET' && url.startsWith('/healthz')) {
		setCors(res, req);
		// `ok` is true only when the active backend is actually configured, so the renderer's probe stays honest
		// and falls back to the heuristic path when no backend is wired. The extra fields feed the Settings
		// provider + usage display (plan 35 iter 4): which door is active, and - for the metered fallback - how
		// much of today's included usage is spent. A subscription backend (openai-oauth) is NOT metered, so it
		// reports no daily figure; today's spend comes from the same authoritative SpendMeter the cap uses.
		// Backend is now chosen per request (plan 51 WP-C); healthz reports the door that WOULD serve the next
		// request, decided by the same selectBackend() the request path uses - so the probe never disagrees with
		// what a real call does. `backendMode` names whether that choice is dynamic (the default) or forced by
		// LWD_BACKEND, so a dev override is visible rather than silent.
		const backend = selectBackend();
		const configured = backend.isConfigured();
		// A single honest `reason` the renderer can key its status copy off without re-deriving the logic here
		// (issue #170): the broker is the only place that knows the true state. `unconfigured` = the backend has
		// no credential wired (renderer stays on the heuristic path); `budget-paused` = the metered fallback has
		// spent today's included cap (calls pause, never 500); `ready` = a configured backend that can serve now.
		let reason = 'unconfigured';
		if (configured) {
			reason = (backend.meters && spendMeter.isOverBudget()) ? 'budget-paused' : 'ready';
		}
		sendJson(res, 200, {
			ok: configured,
			backend: backend.name,
			backendMode: BACKEND_MODE,
			reason,
			meters: backend.meters,
			signedIn: openaiOAuth.isSignedIn(),
			dailyBudgetUsd: DAILY_BUDGET_USD,
			dailyTotalUsd: backend.meters ? Number(spendMeter.dailyTotalUsd().toFixed(6)) : undefined,
		});
		return;
	}
	// GET /models (issue #179; tier added #236; merged both backends in plan 51 WP-C): every model BOTH doors
	// can drive, for the composer's picker. Shape: { backend, backendMode, models: [{ id, label, default, tier,
	// backend, available, serving }] }. `backend` at top-level names the door serving the next request (kept for
	// backward compatibility with the single-backend shape). Per-entry `backend` tags each model's door,
	// `available` is that door's real health (oauth: signed-in + servable; openrouter: key present), and
	// `serving` marks the door selectBackend() would use now - so the selector can render every door and name
	// which is live without re-deriving selection. Purely additive: id/label/default/tier are unchanged.
	// GET /models/openrouter/catalogue - the VALIDATION helper for the curated OpenRouter allowlist (plan 53).
	// Intersects lwd-openrouter-models.js with OpenRouter's live /api/v1/models and reports, per curated id,
	// whether upstream still serves it. This is how a candidate's slug gets confirmed before it is promoted to
	// `validated: true` - guessing slugs from memory is exactly how a picker ends up offering ids that 400.
	// Diagnostic only: it is NEVER consulted on the serving path, so an upstream outage here cannot break chat.
	// Registered BEFORE the /models prefix route below, which would otherwise swallow it.
	if (req.method === 'GET' && url.startsWith('/models/openrouter/catalogue')) {
		setCors(res, req);
		openRouterCatalogue()
			.then(payload => sendJson(res, 200, payload))
			.catch(err => sendJson(res, 502, { error: { type: 'catalogue_error', message: String(err && err.message ? err.message : err) } }));
		return;
	}
	if (req.method === 'GET' && url.startsWith('/models')) {
		setCors(res, req);
		const serving = selectBackend();
		mergedModels()
			.then(models => sendJson(res, 200, { backend: serving.name, backendMode: BACKEND_MODE, models }))
			.catch(err => sendJson(res, 502, { error: { type: 'models_error', message: String(err && err.message ? err.message : err) } }));
		return;
	}
	// --- "Sign in with ChatGPT" device-authorization routes (plan 51 WP-A; frozen contract on issue #283) ---
	// GET /auth/openai/start -> begins the Codex device flow and returns the frozen success shape
	//   { ok, userCode, verificationUri, verificationUriComplete?, expiresIn, interval }. Idempotent while a
	//   flow is pending (same code until it expires). On failure: { ok:false, reason, upstreamStatus?,
	//   upstreamBody? } with an appropriate HTTP status.
	// GET /auth/openai/status -> { ok:true, state: signed-out|pending|signed-in|expired|error, reason?, email? }.
	// POST /auth/openai/signout -> forgets the token bundle. The renderer only ever sees the code + a status
	//   string; the token itself never leaves this process (decision 14).
	if (req.method === 'GET' && url.startsWith('/auth/openai/start')) {
		setCors(res, req);
		openaiOAuth.start()
			.then(started => sendJson(res, 200, { ok: true, ...started }))
			.catch(e => {
				// Log the full body to broker stdout for diagnosability (issue #120's ask); the UI gets a
				// plain-words reason plus the upstream status/body snippet when known.
				console.error('[lwd-proxy] /auth/openai/start failed:', e && e.message ? e.message : e, e && e.upstreamStatus ? `(upstream ${e.upstreamStatus}: ${e.upstreamBody || ''})` : '');
				const payload = { ok: false, reason: String(e && e.message ? e.message : e) };
				if (e && typeof e.upstreamStatus === 'number') { payload.upstreamStatus = e.upstreamStatus; }
				if (e && e.upstreamBody) { payload.upstreamBody = String(e.upstreamBody); }
				sendJson(res, e && e.upstreamStatus ? 502 : 500, payload);
			});
		return;
	}
	if (req.method === 'GET' && url.startsWith('/auth/openai/status')) {
		setCors(res, req);
		sendJson(res, 200, { ok: true, ...openaiOAuth.status() });
		return;
	}
	if (req.method === 'POST' && url.startsWith('/auth/openai/signout')) {
		setCors(res, req);
		openaiOAuth.signOut();
		sendJson(res, 200, { ok: true, state: 'signed-out' });
		return;
	}
	if (req.method === 'POST' && url.startsWith('/v1/messages')) {
		forwardMessages(req, res).catch(err => {
			// Surface a clean error to the renderer; never echo the token or message body.
			console.error('[lwd-proxy] request failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { type: 'error', error: { type: 'proxy_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/mcp/resolve')) {
		resolveMcp(req, res).catch(err => {
			console.error('[lwd-proxy] mcp resolve failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'mcp_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/proxy/fetch')) {
		proxyFetch(req, res).catch(err => {
			console.error('[lwd-proxy] proxy fetch failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'proxy_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/import/docx')) {
		importDocx(req, res).catch(err => {
			console.error('[lwd-proxy] docx import failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'import_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/event')) {
		postEvent(req, res).catch(err => {
			console.error('[lwd-proxy] event log failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'event_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/export/docx')) {
		exportDocx(req, res).catch(err => {
			console.error('[lwd-proxy] docx export failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'export_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/sources/xlsx')) {
		extractXlsx(req, res).catch(err => {
			console.error('[lwd-proxy] xlsx extraction failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'source_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	if (req.method === 'POST' && url.startsWith('/sources/pdf')) {
		extractPdfRoute(req, res).catch(err => {
			console.error('[lwd-proxy] pdf extraction failed:', err && err.message ? err.message : err);
			setCors(res, req);
			sendJson(res, 502, { error: { type: 'source_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	setCors(res, req);
	sendJson(res, 404, { type: 'error', error: { type: 'not_found', message: 'unknown route' } });
});

// CLI: `node scripts/lwd-model-broker.js set-secret <name> <value>` stores a broker-side secret (D29-C)
// and exits without starting the server, so a credential is written only to ~/.abstract/secrets.json (0600).
if (process.argv[2] === 'set-secret') {
	const name = process.argv[3];
	const value = process.argv.slice(4).join(' ');
	if (!name || !value) {
		console.error('usage: node scripts/lwd-model-broker.js set-secret <name> <value>');
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

// A label for the bound host in log lines: '::' (dual-stack) reaches the app via `localhost`, so show that
// rather than a bare '::' that reads like a malformed URL. The IPv4 fallback shows its real address.
function hostLabel(host) {
	return host === '::' ? 'localhost (dual-stack ::)' : host;
}

// Start listening dual-stack ('::' accepts both ::1 and IPv4-mapped 127.0.0.1); on a host with IPv6 disabled
// the bind throws EAFNOSUPPORT/EADDRNOTAVAIL, so fall back to IPv4-only '127.0.0.1' and carry on. The `once`
// error handler is removed before the retry so it never leaks, and any later listen error still surfaces.
function startListening() {
	const onListenError = (err) => {
		const code = err && err.code;
		if ((code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL') && boundHost !== FALLBACK_HOST) {
			console.log(`[lwd-proxy] dual-stack bind on '${PREFERRED_HOST}' failed (${code}) - falling back to IPv4 ${FALLBACK_HOST}`);
			boundHost = FALLBACK_HOST;
			server.listen(PORT, FALLBACK_HOST, onListening);
			return;
		}
		console.error(`[lwd-proxy] failed to bind ${hostLabel(boundHost)}:${PORT}:`, err && err.message ? err.message : err);
		process.exit(1);
	};
	const onListening = () => {
		server.removeListener('error', onListenError);
		reportListening();
	};
	server.on('error', onListenError);
	server.listen(PORT, boundHost, onListening);
}

function reportListening() {
	// Backend is chosen per request now (plan 51 WP-C); report the mode and the door that would serve right now.
	const backend = selectBackend();
	const modeLabel = BACKEND_MODE === 'forced' ? `forced=${BACKEND_OVERRIDE}` : 'dynamic';
	console.log(`[lwd-proxy] listening on ${hostLabel(boundHost)}:${PORT} (backend selection ${modeLabel}, serving ${backend.name} now)`);
	console.log(`[lwd-proxy] fallback door: OPENROUTER_API_KEY / OPENROUTER_API_KEY_FILE; daily included usage cap US$${DAILY_BUDGET_USD}/user`);
	if (!backends.openrouter.isConfigured()) { console.log('[lwd-proxy] no OpenRouter key configured - the fallback runs on the built-in heuristic path'); }
	console.log(`[lwd-proxy] subscription door: "Sign in with ChatGPT"; model ${openaiOAuth.OPENAI_MODEL}; token store ${openaiOAuth.STORE_PATH} (0600)`);
	if (!openaiOAuth.isSignedIn()) { console.log('[lwd-proxy] not signed in - open Abstract Settings and choose "Sign in with ChatGPT" to serve on your own subscription'); }
	refreshEntitlementsInBackground();
}

// Establish at the wire which catalogue models this subscription may actually call, so the picker never
// offers a model upstream will refuse (plan 51 founder smoke; the entitlement block in lwd-openai-oauth).
// Deliberately NOT awaited: the cold-start floor plan 51 section 3 box 1 proved (~0.5s spawn -> healthy) must not
// regress behind network probes, and /healthz is already answering while this settles. Verdicts are cached
// for 24h, so a normal start does no upstream work at all.
function refreshEntitlementsInBackground() {
	// Off-switch for harnesses that count upstream hits for a SERVE (a startup probe would pollute the count)
	// and for any operator who would rather spend no subscription calls on catalogue truth.
	if (process.env.LWD_ENTITLEMENT_PROBE === '0' || process.env.LWD_ENTITLEMENT_PROBE === 'false') { return; }
	if (!openaiOAuth.canServe() || !openaiOAuth.entitlementStale()) { return; }
	openaiOAuth.refreshEntitlements().then(verdicts => {
		if (!verdicts) { return; }
		const refused = Object.keys(verdicts).filter(id => verdicts[id].entitled === false);
		const allowed = Object.keys(verdicts).filter(id => verdicts[id].entitled === true);
		console.log(`[lwd-proxy] subscription entitlement checked: ${allowed.length ? allowed.join(', ') : 'none'} available${refused.length ? `; refused: ${refused.join(', ')}` : ''}`);
	}).catch(e => {
		// An entitlement probe that cannot run leaves every verdict unverified - the picker keeps its
		// catalogue and nothing is demoted on our own failure.
		console.error(`[lwd-proxy] entitlement probe skipped: ${(e && e.message) || e}`);
	});
}

startListening();
