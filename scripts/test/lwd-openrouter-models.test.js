/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// The curated OpenRouter catalogue + "the picked model is actually served" (plan 53). Runs with `node --test`
// (no workbench build). Two layers, mirroring lwd-catalogue-fallback.test.js:
//
//   1) UNIT - lwd-openrouter-models.listModels(): only `validated:true` entries are offered, candidates appear
//      only behind LWD_OPENROUTER_INCLUDE_UNVALIDATED, the ~/.abstract/models.json `openrouter` slice overlays
//      the built-ins, a malformed slice degrades honestly to the built-ins, and there is ALWAYS exactly one
//      default so a call can always resolve onto something.
//
//   2) E2E - the REAL broker against a stub OpenRouter, with a fake $HOME. Proves the defect this work fixes:
//      the door used to build its upstream body with a hardcoded `OPENROUTER_MODEL` and DISCARD the caller's
//      `model`, so the composer's picker was decorative on the included door - every turn ran on gpt-4.1-mini
//      whatever the user selected. The regression guard is assertion 2: the stub records the model it was
//      asked for, and it must equal the id the client picked.
//
// Every fake $HOME lives under a temp dir and is removed on teardown. No test touches the real key or bundle.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const BROKER_SCRIPT = require.resolve('../lwd-model-broker.js');
const MODELS_MODULE = require.resolve('../lwd-openrouter-models.js');

// --- helpers ---------------------------------------------------------------------------------------------

/** A fake HOME under a fresh temp dir; caller removes it. */
function mkHome() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-openrouter-test-'));
}

/** Write ~/.abstract/models.json into a fake HOME. */
function writeModelsConfig(home, config) {
	const dir = path.join(home, '.abstract');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, 'models.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Evaluate listModels() in a CHILD process so each case gets a clean module registry and env. The module
 * reads HOME and the env flags at call time, but a child keeps the cases hermetic from one another.
 * @param {{ home?: string, includeUnvalidated?: boolean }} cfg
 */
function listModelsIn(cfg) {
	const env = Object.assign({}, process.env, {
		HOME: cfg.home || mkHome(),
		OPENROUTER_MODEL: '', // never force a single id in these cases
		LWD_OPENROUTER_INCLUDE_UNVALIDATED: cfg.includeUnvalidated ? '1' : '',
	});
	const out = execFileSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(MODELS_MODULE)}).listModels()))`], { env, encoding: 'utf8' });
	return JSON.parse(out);
}

/** Listen on an ephemeral port and resolve it. */
function listen(server) {
	return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/**
 * A stub OpenRouter chat-completions upstream that records the WHOLE body of each call it is asked to
 * serve (so a case can assert the model, the cap, or anything else that was forwarded), and answers in
 * whichever shape the call asked for - a JSON completion, or the OpenAI-style SSE the broker translates
 * into Anthropic events. It echoes the model it was given, so a resolved id can be traced end to end.
 * @param {object[]} sent collects each parsed request body, in order.
 */
function stubOpenRouter(sent) {
	return http.createServer((req, res) => {
		let body = '';
		req.on('data', c => { body += c.toString(); });
		req.on('end', () => {
			let parsed;
			try { parsed = JSON.parse(body); } catch { parsed = {}; }
			sent.push(parsed);
			if (parsed.stream === true) {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(`data: ${JSON.stringify({ id: 'or-msg', model: parsed.model, choices: [{ delta: { content: 'ok' } }] })}\n\n`);
				res.write('data: [DONE]\n\n');
				res.end();
				return;
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({
				id: 'or-msg',
				model: parsed.model,
				choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
				usage: { total_tokens: 10, cost: 0.0001 },
			}));
		});
	});
}

// The port band this suite owns. `LWD_PROXY_PORT` is fixed at spawn, so a collision is fatal to the child
// rather than something Node can retry around - which makes an overlapping band a flake generator. The
// other broker suites sit at 8300 and above (lwd-backend-selection, lwd-catalogue-fallback,
// lwd-responses-parity), so this one stays strictly below them, and still retries on a fresh port when it
// loses the race to something outside the repo.
const PORT_BAND_START = 8150;
const PORT_BAND_SIZE = 90;
const PORT_ATTEMPTS = 5;

/** Spawn the real broker forced onto the openrouter door, and wait until it is listening. */
function startBroker(cfg) {
	const env = Object.assign({}, process.env, {
		HOME: cfg.home,
		LWD_PROXY_HOST: '127.0.0.1',
		LWD_PROXY_PORT: String(cfg.port),
		OPENROUTER_URL: cfg.openrouterUrl,
		OPENROUTER_API_KEY: 'test-key',
		OPENROUTER_MODEL: '', // exercise the curated list, not the single-id override
		LWD_BACKEND: 'openrouter',
		LWD_ENTITLEMENT_PROBE: '0',
		LWD_OPENROUTER_INCLUDE_UNVALIDATED: cfg.includeUnvalidated ? '1' : '',
	});
	const child = spawn(process.execPath, [BROKER_SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	let out = '';
	child.stdout.on('data', c => { out += c.toString(); });
	child.stderr.on('data', c => { out += c.toString(); });
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`broker did not listen in time; output:\n${out}`)), 5000);
		const settle = (fn, arg) => { clearInterval(iv); clearTimeout(timer); fn(arg); };
		const iv = setInterval(() => {
			if (/listening on/.test(out)) { settle(resolve, undefined); }
			// Fail FAST on a taken port so the caller can retry on another one instead of waiting out the
			// timeout and reporting it as "the broker is broken".
			else if (/EADDRINUSE/.test(out)) { settle(reject, new Error(`EADDRINUSE on port ${cfg.port}`)); }
		}, 25);
	});
	return { child, ready };
}

/**
 * Start the broker on a port from this suite's band, retrying on a collision. Returns the live child and
 * the port it won, so a case never has to reason about ports at all.
 */
async function startBrokerOnFreePort(cfg) {
	let lastError;
	for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
		const port = PORT_BAND_START + Math.floor(Math.random() * PORT_BAND_SIZE);
		const { child, ready } = startBroker(Object.assign({}, cfg, { port }));
		try {
			await ready;
			return { child, port };
		} catch (e) {
			child.kill();
			lastError = e;
			if (!/EADDRINUSE/.test(String(e && e.message))) { throw e; }
		}
	}
	throw lastError;
}

async function postMessage(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return res.json();
}

/** POST a streaming /v1/messages call and return every parsed SSE `data:` payload, in order. */
async function postStream(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(Object.assign({ stream: true }, body)),
	});
	const text = await res.text();
	const events = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) { continue; }
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === '[DONE]') { continue; }
		try { events.push(JSON.parse(payload)); } catch { /* not a JSON event */ }
	}
	return events;
}

// --- 1) unit: the curated allowlist ----------------------------------------------------------------------

test('only validated models are offered; candidates need the explicit flag', () => {
	const home = mkHome();
	try {
		const validatedOnly = listModelsIn({ home });
		assert.deepEqual(
			validatedOnly.map(m => ({ id: m.id, default: m.default, validated: m.validated })),
			[
				// Sonnet 5 is the included planner AND rewrite author (founder ruling 9.3, doc 30 section 9).
				{ id: 'anthropic/claude-sonnet-5', default: true, validated: true },
				// gpt-4.1-mini stays offered but no longer answers a call that named no model: its own catalogue
				// notes blame it for #303 (doc 30 section 2.2 demotes it).
				{ id: 'openai/gpt-4.1-mini', default: false, validated: true },
			],
			'the built-in list offers exactly the validated entries, with one default',
		);

		const withCandidates = listModelsIn({ home, includeUnvalidated: true });
		assert.ok(withCandidates.length > validatedOnly.length, 'candidates appear behind the flag');
		assert.equal(withCandidates.filter(m => m.default).length, 1, 'still exactly one default');
		assert.ok(withCandidates.some(m => m.id === 'openai/gpt-4.1-mini'), 'validated entries stay offered');
		assert.ok(withCandidates.some(m => m.id === 'google/gemini-2.5-pro' && m.validated === false), 'a candidate reports itself unvalidated');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('the models.json openrouter slice overlays the built-ins, and a bad slice degrades honestly', () => {
	const home = mkHome();
	try {
		// A valid overlay replaces the curated list wholesale - adding an id there IS validating it - and an
		// operator-named default wins. This is what lets a newly-released model ship with zero broker edits.
		writeModelsConfig(home, {
			openrouter: {
				models: [{ id: 'vendor/new-model', label: 'New' }, { id: 'vendor/other', label: 'Other' }],
				default: 'vendor/other',
			},
		});
		assert.deepEqual(
			listModelsIn({ home }),
			// Overlay entries are validated by construction - naming an id here IS the act of validating it.
			[{ id: 'vendor/new-model', label: 'New', default: false, validated: true }, { id: 'vendor/other', label: 'Other', default: true, validated: true }],
			'overlay replaces the list and honours the named default',
		);

		const builtInIds = ['anthropic/claude-sonnet-5', 'openai/gpt-4.1-mini'];

		// A malformed slice must never empty the picker - it falls back to the built-ins.
		writeModelsConfig(home, { openrouter: { models: 'not-an-array' } });
		assert.deepEqual(listModelsIn({ home }).map(m => m.id), builtInIds, 'bad slice -> built-ins');

		// A file with no openrouter slice at all is the silent common case (the openai-oauth door owns its own).
		writeModelsConfig(home, { 'openai-oauth': { models: [{ id: 'gpt-x', label: 'X' }] } });
		assert.deepEqual(listModelsIn({ home }).map(m => m.id), builtInIds, 'no slice -> built-ins');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// --- 2) E2E: the requested model is the model served ------------------------------------------------------

test('the openrouter door serves the model the caller picked (regression: it used to discard it)', async (t) => {
	const sent = [];
	const upstream = stubOpenRouter(sent);
	const upstreamPort = await listen(upstream);
	const home = mkHome();
	const { child, port } = await startBrokerOnFreePort({
		home,
		openrouterUrl: `http://127.0.0.1:${upstreamPort}/chat`,
		includeUnvalidated: true, // need >1 entry to prove a non-default pick is honoured
	});
	t.after(() => {
		child.kill();
		upstream.close();
		fs.rmSync(home, { recursive: true, force: true });
	});

	const catalogue = await (await fetch(`http://127.0.0.1:${port}/models`)).json();
	const openrouter = catalogue.models.filter(m => m.backend === 'openrouter');
	assert.ok(openrouter.length > 1, 'the door exposes the curated list, not a single hardcoded model');
	assert.equal(openrouter.filter(m => m.default).length, 1, 'exactly one default in the served catalogue');

	// THE REGRESSION GUARD: pick a non-default curated model; the stub must be asked for exactly that id.
	const picked = openrouter.find(m => !m.default).id;
	await postMessage(port, { model: picked, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(sent.at(-1).model, picked, 'upstream was asked for the picked model');

	// A stale/unknown persisted id still lands on the curated default rather than 500ing or forwarding junk.
	const fallback = openrouter.find(m => m.default).id;
	await postMessage(port, { model: 'vendor/not-a-real-model', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(sent.at(-1).model, fallback, 'an unknown id falls back to the curated default');

	// An absent model does the same - the historical no-model call path is unchanged.
	await postMessage(port, { max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(sent.at(-1).model, fallback, 'an absent model falls back to the curated default');
});

// --- 3) the resolved id is echoed back, and the output cap is per-call (plan 55, B1) ----------------------

// The broker's own default cap (scripts/lwd-model-broker.js, DEFAULT_MAX_TOKENS). Pinned here because it is
// a wire contract: the client now sends a per-purpose cap, and this is what a caller who names none gets.
// It was 1024, low enough to truncate any real reply into a half-finished body the renderer cannot parse.
const BROKER_DEFAULT_MAX_TOKENS = 4096;

test('an unknown/absent model resolves via the catalogue and the RESOLVED id comes back, buffered and streamed', async (t) => {
	const sent = [];
	const upstream = stubOpenRouter(sent);
	const upstreamPort = await listen(upstream);
	const home = mkHome();
	const { child, port } = await startBrokerOnFreePort({
		home,
		openrouterUrl: `http://127.0.0.1:${upstreamPort}/chat`,
	});
	t.after(() => {
		child.kill();
		upstream.close();
		fs.rmSync(home, { recursive: true, force: true });
	});

	const catalogue = await (await fetch(`http://127.0.0.1:${port}/models`)).json();
	const fallback = catalogue.models.filter(m => m.backend === 'openrouter').find(m => m.default).id;

	// Buffered: the reply must NAME the model that actually answered. After resolveRequestedModel swaps a
	// stale pick for the catalogue default, "which model was asked for" and "which model answered" are
	// different questions, and only the second one is honest to show.
	const buffered = await postMessage(port, { model: 'vendor/not-a-real-model', messages: [{ role: 'user', content: 'hi' }] });
	assert.deepEqual(
		{ replyModel: buffered.model, upstreamModel: sent.at(-1).model, upstreamCap: sent.at(-1).max_tokens },
		{ replyModel: fallback, upstreamModel: fallback, upstreamCap: BROKER_DEFAULT_MAX_TOKENS },
		'the buffered reply echoes the resolved id, upstream ran on it, and the capless call got the raised default',
	);

	// A caller-named cap is forwarded verbatim - the default is a floor, never a ceiling imposed on callers.
	await postMessage(port, { max_tokens: 12000, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(sent.at(-1).max_tokens, 12000, 'a per-call cap is forwarded untouched');

	// Streamed: the same resolution, announced in the opening message_start. A stream previously carried no
	// model at all, so a caller could not tell which model answered it.
	const events = await postStream(port, { model: 'vendor/not-a-real-model', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	const start = events.find(e => e.type === 'message_start');
	assert.deepEqual(
		{ announced: start && start.message.model, upstreamModel: sent.at(-1).model, streamed: sent.at(-1).stream },
		{ announced: fallback, upstreamModel: fallback, streamed: true },
		'the stream announces the resolved id and ran upstream on it',
	);
});
