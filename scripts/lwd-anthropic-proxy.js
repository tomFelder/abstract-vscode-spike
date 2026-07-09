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
//   - `openai-oauth` - the "Sign in with ChatGPT" subscription path (plan 35 iter 2) - SEAM ONLY here,
//     the OAuth token flow + OpenAI translation land in that iteration.
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

/** Append one `model_spend` record to the local audit log (best effort; a log failure never blocks a reply). */
function auditModelSpend(record) {
	try {
		fs.mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 });
		fs.appendFileSync(SPEND_LOG_PATH, JSON.stringify(record) + '\n', { mode: 0o600 });
	} catch { /* the audit log is best effort - never fail a model reply because logging failed */ }
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

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', chunk => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
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

// --- backend registry ---------------------------------------------------------------------------------
// One interface per backend: `isConfigured()` gates /healthz; `forward` (buffered) and `forwardStream`
// (SSE) do the request/response translation. `meters` marks whether calls draw on the founder-funded
// budget (openrouter) or the user's own subscription (openai-oauth, iter 2 - not metered).
const backends = {
	openrouter: {
		name: 'openrouter',
		meters: true,
		isConfigured: () => !!openRouterKey(),
		forward: openRouterForward,
		forwardStream: openRouterForwardStream,
	},
	// SEAM for plan 35 iter 2 ("Sign in with ChatGPT"). Reports not-configured so /healthz is honest and the
	// renderer stays on its heuristic fallback until the OAuth token flow + OpenAI translation land here.
	'openai-oauth': {
		name: 'openai-oauth',
		meters: false,
		isConfigured: () => false,
		forward: async () => proxyError('the openai-oauth backend is not implemented yet (plan 35 iter 2)'),
		forwardStream: async (_req, res) => {
			setCors(res);
			res.writeHead(502, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: 'the openai-oauth backend is not implemented yet (plan 35 iter 2)' } }));
			return { usage: undefined };
		},
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
		// `ok` is true only when the active backend is actually configured (a key present), so the renderer's
		// probe stays honest and falls back to the heuristic path when no backend is wired.
		sendJson(res, 200, { ok: activeBackend().isConfigured(), backend: BACKEND });
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
process.on('SIGINT', () => { killMcpServers(); process.exit(0); });
process.on('SIGTERM', () => { killMcpServers(); process.exit(0); });

server.listen(PORT, HOST, () => {
	const backend = activeBackend();
	console.log(`[lwd-proxy] listening on http://${HOST}:${PORT} (backend ${backend.name}, model ${OPENROUTER_MODEL})`);
	if (backend.name === 'openrouter') {
		console.log(`[lwd-proxy] key source: OPENROUTER_API_KEY / OPENROUTER_API_KEY_FILE; daily included usage cap US$${DAILY_BUDGET_USD}/user`);
		if (!backend.isConfigured()) { console.log('[lwd-proxy] no OpenRouter key configured - the app runs on its built-in heuristic fallback'); }
	} else if (backend.name === 'openai-oauth') {
		console.log('[lwd-proxy] the openai-oauth ("Sign in with ChatGPT") backend is not implemented yet (plan 35 iter 2) - running heuristic fallback');
	}
});
