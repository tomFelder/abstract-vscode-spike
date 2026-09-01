/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Per-request model pinning, the merged catalogue, the advisory `purpose` field, and the UTF-8 chunk-boundary
// fix (plan 55 WP-B3; architecture of record docs/30-editing-architecture.md section 2.2).
//
// WHAT CHANGED AND WHY THESE CASES EXIST. Until now the broker chose the DOOR first (selectBackend()) and only
// then resolved the model against that door's list. Two consequences, both of which doc 30 section 2.2 names:
// a turn could not plan on the ChatGPT door and apply on the included door, because one request could only ever
// touch one door; and while a ChatGPT bundle was signed in the included-tier picker was silently decorative -
// every pick resolved to a gpt-5.6 id because the included ids were "unknown" on the selected door. The model
// id now implies the door, so both go away. The dangerous half of that change is the failure mode: if a pinned
// model's door is DOWN, serving the request on the other door would answer in a different model's voice on a
// different budget without saying so. That is the F1/#120 bug class, so it must be a loud typed error, and
// these cases are what hold that line.
//
// Every case spawns the REAL broker against a fake $HOME and stub upstreams; nothing here touches the founder's
// bundle, the real ~/.abstract, or the network. Port band 9300-9389, clear of every other broker suite
// (lwd-openrouter-models at 8150+, lwd-backend-selection / lwd-catalogue-fallback across 8300-8990,
// lwd-responses-parity at 9100+) - LWD_PROXY_PORT is fixed at spawn, so an overlapping band is a flake
// generator rather than something Node retries around.

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

// The two ids these cases pin, read from the real catalogues rather than typed as literals so a future
// promotion moves the tests with it. INCLUDED_ID is on the OpenRouter door; OAUTH_ID is on the ChatGPT door.
const INCLUDED_ID = OPENROUTER_MODELS.find(m => m.validated === true && m.default === true).id;
const INCLUDED_OTHER_ID = OPENROUTER_MODELS.find(m => m.validated === true && m.default !== true).id;
const OAUTH_ID = 'gpt-5.6-terra';

// --- harness ---------------------------------------------------------------------------------------------

/** A fake HOME under a fresh temp dir; caller removes it. */
function mkHome() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-pinning-test-'));
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

/** Write (or rewrite) the shared ~/.abstract/models.json in a fake HOME. */
function writeModelsConfig(home, config) {
	const dir = path.join(home, '.abstract');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
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
	const seen = [];
	return new Promise(resolve => {
		const server = http.createServer((req, res) => {
			let data = '';
			req.on('data', c => { data += c; });
			req.on('end', () => {
				let parsed; try { parsed = JSON.parse(data); } catch { parsed = { unparseable: data }; }
				seen.push(parsed);
				handler(req, res, data);
			});
		});
		server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
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
		OPENROUTER_API_KEY: cfg.openrouterKey === undefined ? 'sk-or-test' : cfg.openrouterKey,
		// The startup entitlement probe would call the Responses upstream once per catalogue model and inflate
		// every hit count asserted below; it has its own suite (lwd-catalogue-fallback).
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

let nextPort = 9300 + Math.floor(Math.random() * 60);
const takePort = () => nextPort++;

/** Run one case with a broker + both stub upstreams up, and tear everything down afterwards. */
async function withBroker(cfg, run) {
	const home = cfg.home || mkHome();
	if (cfg.signedIn) { writeBundle(home); }
	const responses = await startUpstream(cfg.responses);
	const openrouter = await startUpstream(cfg.openrouter);
	const port = takePort();
	const broker = startBroker({ home, port, responsesUrl: responses.base, openrouterUrl: openrouter.base, openrouterKey: cfg.openrouterKey });
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

async function getJson(port, routePath) {
	const res = await fetch(`http://127.0.0.1:${port}${routePath}`);
	return { status: res.status, json: await res.json() };
}

async function postMessage(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const text = await res.text();
	let json; try { json = JSON.parse(text); } catch { json = undefined; }
	return { status: res.status, text, json };
}

/** POST a streaming request and return the raw SSE text. */
async function postStream(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }),
	});
	return { status: res.status, text: await res.text() };
}

/** The concatenated `text_delta` text out of an Anthropic-shaped SSE body. */
function streamedText(sse) {
	let out = '';
	for (const line of sse.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) { continue; }
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === '[DONE]') { continue; }
		let event; try { event = JSON.parse(payload); } catch { continue; }
		if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') { out += event.delta.text; }
	}
	return out;
}

/** The first `data:` payload carried by a named SSE event type. */
function sseEventPayload(sse, eventType) {
	const blocks = sse.split('\n\n');
	for (const block of blocks) {
		if (!block.includes(`event: ${eventType}`)) { continue; }
		const dataLine = block.split('\n').find(l => l.trim().startsWith('data:'));
		if (!dataLine) { continue; }
		try { return JSON.parse(dataLine.trim().slice(5).trim()); } catch { return undefined; }
	}
	return undefined;
}

// --- upstream behaviours ---------------------------------------------------------------------------------

/** The OpenAI Responses wire shape: an SSE stream of typed events ending in `response.completed`. */
function serveResponsesStream(res, model, text) {
	const body = text === undefined ? `served-by-openai-oauth on ${model}` : text;
	const message = { id: 'msg_stub', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: body }] };
	const events = [
		{ type: 'response.created', response: { id: 'resp_stub', model, status: 'in_progress' } },
		{ type: 'response.output_text.delta', content_index: 0, delta: body },
		{ type: 'response.completed', response: { id: 'resp_stub', model, status: 'completed', output: [message] } },
	];
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
}

/** A minimal OpenRouter chat-completion success body. */
function serveOpenrouterJson(res, model, text) {
	res.writeHead(200, { 'content-type': 'application/json' });
	res.end(JSON.stringify({
		id: 'or_stub', model,
		choices: [{ message: { content: text === undefined ? `served-by-openrouter on ${model}` : text }, finish_reason: 'stop' }],
		usage: { total_tokens: 10, cost: 0.0002 },
	}));
}

/**
 * Write an SSE body in TWO TCP writes, splitting at a byte offset that lands INSIDE a multi-byte UTF-8
 * character - the reproduction for issue #348. `setNoDelay` plus a real gap between the writes is what stops
 * the kernel coalescing them back into one packet, which would make the test pass whatever the reader does.
 */
function serveSplit(res, body, splitByteIndex) {
	if (res.socket) { res.socket.setNoDelay(true); }
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	const buf = Buffer.from(body, 'utf8');
	res.write(buf.subarray(0, splitByteIndex));
	setTimeout(() => res.end(buf.subarray(splitByteIndex)), 30);
}

// The text the split cases carry. Written as escapes so this file stays pure ASCII on disk while the BYTES on
// the wire are two-, three- and four-byte UTF-8 sequences: e-acute (2), a coffee cup (3), CJK (3), an emoji
// outside the BMP (4). Every width matters - StringDecoder has to hold back a different number of bytes for
// each, and a two-byte-only fixture would not prove the three- and four-byte cases.
const SPLIT_TEXT = 'caf\u00e9 \u2615 \u65e5\u672c\u8a9e \u{1f680}';

/** The byte offset one byte INTO the first occurrence of `needle` within `body`. */
function midCharacterOffset(body, needle) {
	const at = Buffer.from(body, 'utf8').indexOf(Buffer.from(needle, 'utf8'));
	assert.ok(at >= 0, `fixture must contain ${needle}`);
	return at + 1;
}

// =========================================================================================================
// 1) The model id implies the door
// =========================================================================================================

test('the MODEL decides the door: an included id is served by openrouter even while the selected backend is openai-oauth, and vice versa', async () => {
	let responsesHits = 0;
	let openrouterHits = 0;
	await withBroker({
		signedIn: true, // so selectBackend() would choose openai-oauth for every request
		responses: (req, res, _body) => { responsesHits++; serveResponsesStream(res, OAUTH_ID); },
		openrouter: (req, res, _body) => { openrouterHits++; serveOpenrouterJson(res, INCLUDED_ID); },
	}, async ({ port, responses, openrouter }) => {
		// (a) The included-tier pick. Before WP-B3 this resolved to a gpt-5.6 id on the OAuth door, which is
		// exactly what made the included picker decorative while signed in (doc 30 section 2.2).
		const includedPick = await postMessage(port, { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] });
		// (b) The OAuth pick, from the same signed-in broker, proving the other direction still routes home.
		const oauthPick = await postMessage(port, { model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] });
		// (c) No model at all: availability picks the door, exactly as before (selectBackend still owns this).
		const noPick = await postMessage(port, { max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] });

		assert.deepStrictEqual({
			includedText: includedPick.json.content[0].text,
			includedModelUpstream: openrouter.seen[0].model,
			oauthText: oauthPick.json.content[0].text,
			oauthModelUpstream: responses.seen[0].model,
			noPickText: noPick.json.content[0].text,
			responsesHits,
			openrouterHits,
		}, {
			includedText: `served-by-openrouter on ${INCLUDED_ID}`,
			includedModelUpstream: INCLUDED_ID,
			oauthText: `served-by-openai-oauth on ${OAUTH_ID}`,
			oauthModelUpstream: OAUTH_ID,
			noPickText: `served-by-openai-oauth on ${OAUTH_ID}`,
			responsesHits: 2, // (b) and (c)
			openrouterHits: 1, // (a)
		});
	});
});

// =========================================================================================================
// 2) Collisions: OAuth wins, the models.json override wins over that
// =========================================================================================================

test('an id offered by BOTH doors resolves once - to the OAuth door by default, to whichever door models.json names', async () => {
	const home = mkHome();
	// The overlay puts an OAuth id on the OpenRouter door too, manufacturing the collision. (An overlay
	// replaces the curated list wholesale, so the included door now offers exactly this one id.)
	writeModelsConfig(home, { openrouter: { models: [{ id: OAUTH_ID, label: 'Collision' }] } });
	await withBroker({
		home, signedIn: true,
		responses: (req, res) => serveResponsesStream(res, OAUTH_ID),
		openrouter: (req, res) => serveOpenrouterJson(res, OAUTH_ID),
	}, async ({ port }) => {
		const doorsFor = models => models.filter(m => m.id === OAUTH_ID).map(m => m.door);

		const preferred = await getJson(port, '/models');
		const beforeOverride = await postMessage(port, { model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });

		// The escape hatch: hand this one id to the included door. Config is read fresh per merge, no restart.
		writeModelsConfig(home, { openrouter: { models: [{ id: OAUTH_ID, label: 'Collision' }] }, doors: { [OAUTH_ID]: 'openrouter' } });
		const overridden = await getJson(port, '/models');
		const afterOverride = await postMessage(port, { model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });

		assert.deepStrictEqual({
			preferredDoors: doorsFor(preferred.json.models),
			preferredServed: beforeOverride.json.content[0].text,
			overriddenDoors: doorsFor(overridden.json.models),
			overriddenServed: afterOverride.json.content[0].text,
		}, {
			// ONE entry, not two: a duplicate row is a picker asking the user to choose between identical
			// labels. The OAuth door wins by default because that call spends the user's own ChatGPT credits
			// rather than the founder's budget (founder ruling 9.1).
			preferredDoors: ['openai-oauth'],
			preferredServed: `served-by-openai-oauth on ${OAUTH_ID}`,
			overriddenDoors: ['openrouter'],
			overriddenServed: `served-by-openrouter on ${OAUTH_ID}`,
		});
	});
});

// =========================================================================================================
// 3) A pinned model on a down door fails LOUDLY - never a silent hop to the other door
// =========================================================================================================

test('pinned model + signed-out OAuth door -> typed door_unavailable, and the openrouter upstream is never touched', async () => {
	let openrouterHits = 0;
	await withBroker({
		signedIn: false, // the OAuth door is signed out; openrouter is healthy and would happily answer
		responses: (req, res) => serveResponsesStream(res, OAUTH_ID),
		openrouter: (req, res) => { openrouterHits++; serveOpenrouterJson(res, INCLUDED_ID); },
	}, async ({ port }) => {
		const buffered = await postMessage(port, { model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		const streamed = await postStream(port, { model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		const streamedError = sseEventPayload(streamed.text, 'error');

		assert.deepStrictEqual({
			status: buffered.status,
			error: buffered.json.error,
			// The streamed form carries the SAME typed verdict, plus the plain-words prose in the paused-run
			// shape the cap and re-auth messages already use - so a person reads an honest sentence and the run
			// pauses with its changes intact, rather than a stream that ends having said nothing.
			streamedErrorType: streamedError.error.type,
			streamedErrorDoor: streamedError.error.door,
			streamedProse: streamedText(streamed.text),
			streamedPaused: /"stop_reason":"pause"/.test(streamed.text),
			openrouterHits,
		}, {
			status: 503,
			error: {
				type: 'door_unavailable',
				model: OAUTH_ID,
				door: 'openai-oauth',
				message: `${OAUTH_ID} runs on your OpenAI account, which isn't signed in right now. Sign in again, or pick an included model.`,
			},
			streamedErrorType: 'door_unavailable',
			streamedErrorDoor: 'openai-oauth',
			streamedProse: `${OAUTH_ID} runs on your OpenAI account, which isn't signed in right now. Sign in again, or pick an included model.`,
			streamedPaused: true,
			// THE POINT OF THE WHOLE CASE: zero. A substitution here would answer in another model's voice on
			// another budget without saying so, which is the F1/#120 bug class.
			openrouterHits: 0,
		});
	});
});

test('pinned included model + key-less openrouter door -> typed door_unavailable, and the Responses upstream is never touched', async () => {
	let responsesHits = 0;
	await withBroker({
		signedIn: true, // the OAuth door is up and would happily answer
		openrouterKey: '', // ... but the pinned model lives on the included door, which has no key
		responses: (req, res) => { responsesHits++; serveResponsesStream(res, OAUTH_ID); },
		openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID),
	}, async ({ port }) => {
		const buffered = await postMessage(port, { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		assert.deepStrictEqual({
			status: buffered.status,
			error: buffered.json.error,
			responsesHits,
		}, {
			status: 503,
			error: {
				type: 'door_unavailable',
				model: INCLUDED_ID,
				door: 'openrouter',
				message: `${INCLUDED_ID} runs on the included tier, which isn't set up right now. Pick a model from your OpenAI account instead.`,
			},
			responsesHits: 0,
		});
	});
});

test('a stale id no door offers is NOT a pin: it still lands on the available door default, as it always has', async () => {
	await withBroker({
		signedIn: false,
		responses: (req, res) => serveResponsesStream(res, OAUTH_ID),
		openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID),
	}, async ({ port, openrouter }) => {
		const stale = await postMessage(port, { model: 'vendor/retired-last-year', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		assert.deepStrictEqual({
			status: stale.status,
			servedModelUpstream: openrouter.seen[0].model,
			text: stale.json.content[0].text,
		}, {
			status: 200,
			servedModelUpstream: INCLUDED_ID,
			text: `served-by-openrouter on ${INCLUDED_ID}`,
		});
	});
});

// =========================================================================================================
// 4) The advisory `purpose` field
// =========================================================================================================

test('`purpose` is stamped into the model_spend audit, never forwarded upstream, and an unknown value is dropped', async () => {
	await withBroker({
		signedIn: false, // the metered door serves, which is the door that writes spend records
		responses: (req, res) => serveResponsesStream(res, OAUTH_ID),
		openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID),
	}, async ({ port, home, openrouter }) => {
		await postMessage(port, { model: INCLUDED_ID, purpose: 'apply', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		await postMessage(port, { model: INCLUDED_OTHER_ID, purpose: 'plan', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		await postMessage(port, { model: INCLUDED_ID, purpose: 'sabotage', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		await postMessage(port, { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });

		assert.deepStrictEqual({
			stamped: spendRecords(home).map(r => ({ model: r.model, purpose: r.purpose })),
			// Neither door's upstream body may carry it: `purpose` is ours, and OpenAI/OpenRouter would reject
			// an unknown top-level field (the 12 Aug founder smoke found four separate 400s of exactly that kind).
			upstreamSawPurpose: openrouter.seen.some(b => 'purpose' in b),
		}, {
			stamped: [
				{ model: INCLUDED_ID, purpose: 'apply' },
				{ model: INCLUDED_OTHER_ID, purpose: 'plan' },
				// An unknown lane is dropped rather than echoed, so a typo can never reach an audit record;
				// an absent one is simply absent, never guessed.
				{ model: INCLUDED_ID, purpose: undefined },
				{ model: INCLUDED_ID, purpose: undefined },
			],
			upstreamSawPurpose: false,
		});
	});
});

// =========================================================================================================
// 5) Issue #348: a multi-byte character split across a TCP chunk boundary
// =========================================================================================================

test('openrouter door: a multi-byte character split across two TCP chunks streams through intact (issue #348)', async () => {
	const body = `data: ${JSON.stringify({ choices: [{ delta: { content: SPLIT_TEXT } }] })}\n\ndata: [DONE]\n\n`;
	await withBroker({
		signedIn: false,
		responses: (req, res) => serveResponsesStream(res, OAUTH_ID),
		openrouter: (req, res) => serveSplit(res, body, midCharacterOffset(body, '\u{1f680}')),
	}, async ({ port }) => {
		const streamed = await postStream(port, { model: INCLUDED_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		assert.deepStrictEqual({ text: streamedText(streamed.text), replacementChars: (streamedText(streamed.text).match(/\uFFFD/g) || []).length },
			{ text: SPLIT_TEXT, replacementChars: 0 });
	});
});

test('openai-oauth door: a multi-byte character split across two TCP chunks streams through intact (issue #348)', async () => {
	const delta = { type: 'response.output_text.delta', content_index: 0, delta: SPLIT_TEXT };
	const completed = { type: 'response.completed', response: { id: 'resp_stub', model: OAUTH_ID, status: 'completed', output: [] } };
	const body = `event: ${delta.type}\ndata: ${JSON.stringify(delta)}\n\nevent: ${completed.type}\ndata: ${JSON.stringify(completed)}\n\n`;
	await withBroker({
		signedIn: true,
		responses: (req, res) => serveSplit(res, body, midCharacterOffset(body, '\u65e5')),
		openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID),
	}, async ({ port }) => {
		const streamed = await postStream(port, { model: OAUTH_ID, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
		assert.deepStrictEqual({ text: streamedText(streamed.text), replacementChars: (streamedText(streamed.text).match(/\uFFFD/g) || []).length },
			{ text: SPLIT_TEXT, replacementChars: 0 });
	});
});

// =========================================================================================================
// 6) /models publishes the door + validated fields the picker labels its rows from
// =========================================================================================================

test('/models carries a door and a validated verdict per entry, alongside the unchanged id/label/default/tier', async () => {
	await withBroker({
		signedIn: false,
		responses: (req, res) => serveResponsesStream(res, OAUTH_ID),
		openrouter: (req, res) => serveOpenrouterJson(res, INCLUDED_ID),
	}, async ({ port }) => {
		const { json } = await getJson(port, '/models');
		const pick = id => {
			const m = json.models.find(e => e.id === id);
			return { door: m.door, backend: m.backend, tier: m.tier, validated: m.validated, available: m.available };
		};
		assert.deepStrictEqual({ included: pick(INCLUDED_ID), oauth: pick(OAUTH_ID) }, {
			// `backend` is retained as `door`'s backward-compatible alias, so an older renderer keeps working.
			included: { door: 'openrouter', backend: 'openrouter', tier: 'included', validated: true, available: true },
			// Signed out: the OAuth rows are honestly unavailable, and unprobed entitlement is NOT a validation.
			oauth: { door: 'openai-oauth', backend: 'openai-oauth', tier: 'own-key', validated: false, available: false },
		});
	});
});
