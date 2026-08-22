/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Prompt-cache forwarding across both doors (plan 55 WP-B4; architecture of record
// docs/30-editing-architecture.md section 2.6).
//
// WHAT THESE CASES HOLD. Caching is three separate mechanisms and the broker's job is to carry each one
// faithfully rather than to have an opinion about it, so each gets its own case pinning the BYTES that leave
// for upstream:
//
//   1. `cache_control` breakpoints (OpenRouter). Passed through exactly as the client marked them - never
//      stripped, never invented. The subtle half is the NEGATIVE: a message with no breakpoint must still go
//      out as the plain string it always was, because turning every message into a typed-parts array would
//      change the wire for every caller that does not cache and quietly break the parity suite's contract.
//   2. A per-conversation `session_id` (OpenRouter). Without it a mid-loop provider failover drops the warm
//      prefix and the next step pays full prefill with nothing to show for it.
//   3. A per-conversation `prompt_cache_key` (Codex). This door caches server-side - the recorded fixture
//      (fixtures/codex-responses-stream.sse:2,38) shows the field echoed back with a 24h retention - so the
//      key IS the mechanism. Two turns of one conversation must derive the same key and two conversations
//      must never collide, which is what the stability case asserts directly.
//
// Plus the accounting: cache reads are metered as their OWN number rather than folded into input tokens, and
// - the case that matters most for not regressing anyone - a usage payload with NO cache fields writes the
// same `model_spend` record it always did, not a record full of zeroes claiming a measured miss.
//
// Every case spawns the REAL broker against a fake $HOME and stub upstreams; nothing here touches the
// founder's bundle, the real ~/.abstract, or the network. Port band 9500-9589, clear of every other broker
// suite (lwd-openrouter-models at 8150+, lwd-backend-selection / lwd-catalogue-fallback across 8300-8990,
// lwd-responses-parity at 9100+, lwd-model-pinning at 9300+) - LWD_PROXY_PORT is fixed at spawn, so an
// overlapping band is a flake generator rather than something Node retries around.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { mintJwt } = require('./lwd-device-auth-stub.js');
const { OPENROUTER_MODELS } = require('../lwd-openrouter-models.js');

const BROKER_SCRIPT = require.resolve('../lwd-model-broker.js');

// Read from the real catalogues rather than typed as literals, so a future promotion moves the tests with it.
const INCLUDED_ID = OPENROUTER_MODELS.find(m => m.validated === true && m.default === true).id;
const OAUTH_ID = 'gpt-5.6-terra';

// --- harness ---------------------------------------------------------------------------------------------

/** A fake HOME under a fresh temp dir; caller removes it. */
function mkHome() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-cache-test-'));
}

/** Write a valid-looking openai-oauth bundle so the ChatGPT door is signed in and servable. */
function writeBundle(home) {
	const bundle = {
		access_token: mintJwt({ scope: 'openid profile email', exp: Math.floor(Date.now() / 1000) + 3600 }),
		refresh_token: 'stub-refresh-token',
		id_token: mintJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_stub_123', email: 'founder@example.com' }, email: 'founder@example.com' }),
		account_id: 'acct_stub_123',
		email: 'founder@example.com',
		expires_at: Date.now() + 3600 * 1000,
		granted_scopes: 'openid profile email offline_access',
	};
	const dir = path.join(home, '.abstract');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, 'openai-oauth.json'), JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
}

/** Every `model_spend` record written under a fake HOME, newest last. */
function spendRecords(home) {
	let raw;
	try { raw = fs.readFileSync(path.join(home, '.abstract', 'model-spend.log'), 'utf8'); }
	catch { return []; }
	return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

/**
 * Start an HTTP stub that records every request body it saw and answers via `handler`.
 * @param {(req: import('http').IncomingMessage, res: import('http').ServerResponse, body: string) => void} handler
 */
function startUpstream(handler) {
	const sent = [];
	return new Promise(resolve => {
		const server = http.createServer((req, res) => {
			let data = '';
			req.on('data', c => { data += c; });
			req.on('end', () => {
				let parsed; try { parsed = JSON.parse(data); } catch { parsed = { unparseable: data }; }
				sent.push(parsed);
				handler(req, res, data);
			});
		});
		server.listen(0, '127.0.0.1', () => resolve({ server, sent, base: `http://127.0.0.1:${server.address().port}` }));
	});
}

/** Spawn the real broker against a fake HOME + stub upstreams and wait until it is listening. */
function startBroker(cfg) {
	const env = Object.assign({}, process.env, {
		HOME: cfg.home,
		LWD_PROXY_HOST: '127.0.0.1',
		LWD_PROXY_PORT: String(cfg.port),
		LWD_OPENAI_RESPONSES_URL: cfg.responsesUrl,
		OPENROUTER_URL: cfg.openrouterUrl,
		OPENROUTER_API_KEY: 'sk-or-test',
		// The startup entitlement probe would call the Responses upstream once per catalogue model and inflate
		// every recorded body asserted below; it has its own suite (lwd-catalogue-fallback).
		LWD_ENTITLEMENT_PROBE: '0',
	});
	delete env.LWD_BACKEND;
	delete env.OPENROUTER_MODEL;
	const child = spawn(process.execPath, [BROKER_SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	let out = '';
	child.stdout.on('data', c => { out += c.toString(); });
	child.stderr.on('data', c => { out += c.toString(); });
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`broker did not listen in time; output:\n${out}`)), 5000);
		const iv = setInterval(() => {
			if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(timer); resolve(); }
		}, 25);
	});
	return { child, ready, getOutput: () => out };
}

function killBroker(child) {
	return new Promise(resolve => {
		child.once('exit', () => resolve());
		child.kill('SIGKILL');
	});
}

let nextPort = 9500 + Math.floor(Math.random() * 60);
const takePort = () => nextPort++;

/** Run one case with a broker + both stub upstreams up, and tear everything down afterwards. */
async function withBroker(cfg, run) {
	const home = mkHome();
	if (cfg.signedIn) { writeBundle(home); }
	const responses = await startUpstream(cfg.responses || ((req, res) => serveResponsesStream(res, OAUTH_ID)));
	const openrouter = await startUpstream(cfg.openrouter || ((req, res) => serveOpenrouterJson(res, INCLUDED_ID)));
	const port = takePort();
	const broker = startBroker({ home, port, responsesUrl: responses.base, openrouterUrl: openrouter.base });
	try {
		await broker.ready;
		await run({ port, home, responses, openrouter, broker });
	} finally {
		await killBroker(broker.child);
		responses.server.close();
		openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
}

async function postMessage(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const text = await res.text();
	let json; try { json = JSON.parse(text); } catch { json = undefined; }
	return { status: res.status, text, json };
}

async function getJson(port, routePath) {
	const res = await fetch(`http://127.0.0.1:${port}${routePath}`);
	return { status: res.status, json: await res.json() };
}

// --- upstream behaviours ---------------------------------------------------------------------------------

/** The OpenAI Responses wire shape: an SSE stream of typed events ending in `response.completed`. */
function serveResponsesStream(res, model, usage) {
	const body = `served-by-openai-oauth on ${model}`;
	const message = { id: 'msg_stub', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: body }] };
	const completed = { id: 'resp_stub', model, status: 'completed', output: [message] };
	if (usage) { completed.usage = usage; }
	const events = [
		{ type: 'response.created', response: { id: 'resp_stub', model, status: 'in_progress' } },
		{ type: 'response.output_text.delta', content_index: 0, delta: body },
		{ type: 'response.completed', response: completed },
	];
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
}

/** A minimal OpenRouter chat-completion success body, with a caller-chosen `usage` payload. */
function serveOpenrouterJson(res, model, usage) {
	res.writeHead(200, { 'content-type': 'application/json' });
	res.end(JSON.stringify({
		id: 'or_stub', model,
		choices: [{ message: { content: `served-by-openrouter on ${model}` }, finish_reason: 'stop' }],
		usage: usage || { total_tokens: 10, cost: 0.0002 },
	}));
}

// --- 1. cache_control passthrough (OpenRouter) -------------------------------------------------------------

test('openrouter door: `cache_control` breakpoints reach upstream exactly as sent, and an unmarked message stays the plain string it always was', async () => {
	await withBroker({}, async ({ port, openrouter }) => {
		// The shape the client sends since WP-B4: the STATIC system prompt alone in `system`, carrying the
		// turn's ONE breakpoint at the end of the stable prefix, with everything volatile in the user turn.
		await postMessage(port, {
			model: INCLUDED_ID,
			max_tokens: 64,
			system: [{ type: 'text', text: 'Stable system prompt.', cache_control: { type: 'ephemeral' } }],
			messages: [
				{ role: 'user', content: [{ type: 'text', text: 'volatile turn one' }] },
				{ role: 'assistant', content: 'answer one' },
				// A second breakpoint deeper in the transcript, to prove per-BLOCK placement survives rather
				// than the marker being hoisted, normalised or collapsed onto the system message.
				{ role: 'user', content: [{ type: 'text', text: 'stable-ish head' }, { type: 'text', text: 'tail', cache_control: { type: 'ephemeral' } }] },
			],
		});

		assert.deepStrictEqual(openrouter.sent[0].messages, [
			// Marked -> typed parts, marker copied through untouched.
			{ role: 'system', content: [{ type: 'text', text: 'Stable system prompt.', cache_control: { type: 'ephemeral' } }] },
			// Unmarked -> the bare string, byte-identical to what this door has always sent.
			{ role: 'user', content: 'volatile turn one' },
			{ role: 'assistant', content: 'answer one' },
			// Mixed -> parts, with the breakpoint on exactly the block the client marked and nothing added to
			// the block it did not.
			{ role: 'user', content: [{ type: 'text', text: 'stable-ish head' }, { type: 'text', text: 'tail', cache_control: { type: 'ephemeral' } }] },
		]);
	});
});

test('openrouter door: a request with no breakpoints and no session is byte-for-byte the request it was before caching existed', async () => {
	await withBroker({}, async ({ port, openrouter }) => {
		await postMessage(port, {
			model: INCLUDED_ID, max_tokens: 64, system: 'Be terse.',
			messages: [{ role: 'user', content: 'hello' }],
		});

		const sent = openrouter.sent[0];
		assert.deepStrictEqual({
			messages: sent.messages,
			// The two fields WP-B4 can add, both absent: nothing is invented for a caller that asked for nothing.
			sessionId: sent.session_id,
			hasCacheControl: JSON.stringify(sent).includes('cache_control'),
		}, {
			messages: [{ role: 'system', content: 'Be terse.' }, { role: 'user', content: 'hello' }],
			sessionId: undefined,
			hasCacheControl: false,
		});
	});
});

// --- 2. sticky sessions (OpenRouter) -----------------------------------------------------------------------

test('openrouter door: the per-conversation session id is forwarded verbatim; an unusable one is dropped, never repaired', async () => {
	await withBroker({}, async ({ port, openrouter }) => {
		const prompt = { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] };
		await postMessage(port, Object.assign({ session_id: 'conv-alpha' }, prompt));
		await postMessage(port, Object.assign({ session_id: '   ' }, prompt));
		await postMessage(port, Object.assign({ session_id: 'x'.repeat(201) }, prompt));
		await postMessage(port, Object.assign({ session_id: 42 }, prompt));
		await postMessage(port, prompt);

		assert.deepStrictEqual(openrouter.sent.map(b => b.session_id), [
			'conv-alpha',
			// Blank, over-long and non-string ids are DROPPED. A wrong session id is worse than none: it would
			// steer two unrelated conversations onto one sticky provider and one warm prefix.
			undefined, undefined, undefined, undefined,
		]);
	});
});

// --- 3. a stable prompt_cache_key (Codex) ------------------------------------------------------------------

test('codex door: `prompt_cache_key` is stable across the turns of one conversation, distinct across conversations, and absent when the caller named none', async () => {
	await withBroker({ signedIn: true }, async ({ port, responses }) => {
		const turn = (sessionId, text) => Object.assign(
			{ model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: text }] },
			sessionId ? { session_id: sessionId } : {},
		);
		await postMessage(port, turn('conv-alpha', 'turn one'));
		await postMessage(port, turn('conv-alpha', 'turn two'));
		await postMessage(port, turn('conv-beta', 'turn one'));
		await postMessage(port, turn(undefined, 'no conversation'));

		const keys = responses.sent.map(b => b.prompt_cache_key);
		assert.deepStrictEqual({
			stableWithinConversation: keys[0] === keys[1],
			distinctAcrossConversations: keys[0] !== keys[2],
			// DERIVED, not passed through: whatever the client's conversation identifier grows into (a path, a
			// title), only a fixed-length opaque token ever reaches OpenAI.
			derivedNotEchoed: keys[0] !== 'conv-alpha' && /^[0-9a-f]{32}$/.test(keys[0]),
			absentWithoutConversation: keys[3],
		}, {
			stableWithinConversation: true,
			distinctAcrossConversations: true,
			derivedNotEchoed: true,
			absentWithoutConversation: undefined,
		});
	});
});

test('codex door: an ARRAY-shaped system prompt still becomes `instructions` (before WP-B4 a client that marked a breakpoint lost its whole system prompt)', async () => {
	await withBroker({ signedIn: true }, async ({ port, responses }) => {
		await postMessage(port, {
			model: OAUTH_ID, max_tokens: 64,
			system: [{ type: 'text', text: 'Stable system prompt.', cache_control: { type: 'ephemeral' } }],
			messages: [{ role: 'user', content: 'hello' }],
		});

		const sent = responses.sent[0];
		assert.deepStrictEqual({
			instructions: sent.instructions,
			// The Responses API has no `cache_control`; this door caches by KEY, so the marker simply does not
			// survive the flattening - and must not be smuggled through as an unknown field either.
			hasCacheControl: JSON.stringify(sent).includes('cache_control'),
		}, {
			instructions: 'Stable system prompt.',
			hasCacheControl: false,
		});
	});
});

// --- 4. cache accounting into the spend meter --------------------------------------------------------------

test('openrouter door: cached reads are metered as their OWN number, alongside the write count and OpenRouter\'s cache discount', async () => {
	const usage = {
		total_tokens: 1200, prompt_tokens: 1100, completion_tokens: 100, cost: 0.0031,
		prompt_tokens_details: { cached_tokens: 900 },
		cache_discount: 0.0018,
	};
	await withBroker({ openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID, usage) }, async ({ port, home }) => {
		await postMessage(port, { model: INCLUDED_ID, max_tokens: 64, session_id: 'conv-alpha', messages: [{ role: 'user', content: 'hi' }] });

		const record = spendRecords(home)[0];
		assert.deepStrictEqual({
			cost: record.cost,
			cacheRead: record.cache_read_tokens,
			cacheWrite: record.cache_write_tokens,
			cacheDiscount: record.cache_discount,
		}, {
			// The authoritative `usage.cost` is untouched by any of this - caching changes what a call costs
			// upstream, never how the broker reads the number upstream reported.
			cost: 0.0031,
			cacheRead: 900,
			// Reported as 0 rather than omitted: the payload DID carry cache accounting, and "nothing was
			// written this call" is a measured answer.
			cacheWrite: 0,
			cacheDiscount: 0.0018,
		});
	});
});

test('openrouter door: the Anthropic cache fields OpenRouter relays are read too (cache_read_input_tokens / cache_creation_input_tokens)', async () => {
	const usage = { total_tokens: 1200, cost: 0.004, cache_read_input_tokens: 750, cache_creation_input_tokens: 320 };
	await withBroker({ openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID, usage) }, async ({ port, home }) => {
		await postMessage(port, { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });

		const record = spendRecords(home)[0];
		assert.deepStrictEqual(
			{ cacheRead: record.cache_read_tokens, cacheWrite: record.cache_write_tokens, cacheDiscount: record.cache_discount },
			{ cacheRead: 750, cacheWrite: 320, cacheDiscount: 0 },
		);
	});
});

test('a usage payload with NO cache fields meters exactly as it always did - no zeroed cache fields claiming a miss nobody measured', async () => {
	await withBroker({}, async ({ port, home }) => {
		await postMessage(port, { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });

		const record = spendRecords(home)[0];
		assert.deepStrictEqual({
			cost: record.cost,
			costEstimated: record.cost_estimated,
			// Absent KEYS, not zero values: a model without cache accounting must not read as one that measured
			// a miss, or the spend log stops being able to answer "is caching on for this model at all".
			cacheKeys: Object.keys(record).filter(k => k.startsWith('cache_')),
		}, {
			cost: 0.0002,
			costEstimated: false,
			cacheKeys: [],
		});
	});
});

test('the subscription door writes no spend record, so its cache accounting lands on /healthz instead', async () => {
	const usage = { input_tokens: 1000, output_tokens: 20, total_tokens: 1020, input_tokens_details: { cached_tokens: 640, cache_write_tokens: 128 } };
	await withBroker({ signedIn: true, responses: (req, res) => serveResponsesStream(res, OAUTH_ID, usage) }, async ({ port, home }) => {
		await postMessage(port, { model: OAUTH_ID, max_tokens: 64, session_id: 'conv-alpha', messages: [{ role: 'user', content: 'hi' }] });
		const health = await getJson(port, '/healthz');

		assert.deepStrictEqual({
			// A user's own ChatGPT quota is not the founder's budget, so nothing is charged and nothing is logged.
			spendRecords: spendRecords(home).length,
			cache: health.json.cache,
		}, {
			spendRecords: 0,
			cache: {
				'openai-oauth': { readTokens: 640, writeTokens: 128, discountUsd: 0 },
				openrouter: { readTokens: 0, writeTokens: 0, discountUsd: 0 },
			},
		});
	});
});
