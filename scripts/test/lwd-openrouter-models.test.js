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

/** A stub OpenRouter chat-completions upstream that records the model each call asked for. */
function stubOpenRouter(seen) {
	return http.createServer((req, res) => {
		let body = '';
		req.on('data', c => { body += c.toString(); });
		req.on('end', () => {
			let parsed;
			try { parsed = JSON.parse(body); } catch { parsed = {}; }
			seen.push(parsed.model);
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
		const iv = setInterval(() => {
			if (/listening on/.test(out)) { clearInterval(iv); clearTimeout(timer); resolve(undefined); }
		}, 25);
	});
	return { child, ready };
}

async function postMessage(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return res.json();
}

// --- 1) unit: the curated allowlist ----------------------------------------------------------------------

test('only validated models are offered; candidates need the explicit flag', () => {
	const home = mkHome();
	try {
		const validatedOnly = listModelsIn({ home });
		assert.deepEqual(
			validatedOnly.map(m => ({ id: m.id, default: m.default })),
			[{ id: 'openai/gpt-4.1-mini', default: true }],
			'the built-in list offers exactly the validated entries, with one default',
		);

		const withCandidates = listModelsIn({ home, includeUnvalidated: true });
		assert.ok(withCandidates.length > validatedOnly.length, 'candidates appear behind the flag');
		assert.equal(withCandidates.filter(m => m.default).length, 1, 'still exactly one default');
		assert.ok(withCandidates.some(m => m.id === 'openai/gpt-4.1-mini'), 'validated entries stay offered');
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
			[{ id: 'vendor/new-model', label: 'New', default: false }, { id: 'vendor/other', label: 'Other', default: true }],
			'overlay replaces the list and honours the named default',
		);

		// A malformed slice must never empty the picker - it falls back to the built-ins.
		writeModelsConfig(home, { openrouter: { models: 'not-an-array' } });
		assert.deepEqual(listModelsIn({ home }).map(m => m.id), ['openai/gpt-4.1-mini'], 'bad slice -> built-ins');

		// A file with no openrouter slice at all is the silent common case (the openai-oauth door owns its own).
		writeModelsConfig(home, { 'openai-oauth': { models: [{ id: 'gpt-x', label: 'X' }] } });
		assert.deepEqual(listModelsIn({ home }).map(m => m.id), ['openai/gpt-4.1-mini'], 'no slice -> built-ins');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// --- 2) E2E: the requested model is the model served ------------------------------------------------------

test('the openrouter door serves the model the caller picked (regression: it used to discard it)', async (t) => {
	const seen = [];
	const upstream = stubOpenRouter(seen);
	const upstreamPort = await listen(upstream);
	const home = mkHome();
	const port = 8100 + Math.floor(Math.random() * 800);
	const { child, ready } = startBroker({
		home,
		port,
		openrouterUrl: `http://127.0.0.1:${upstreamPort}/chat`,
		includeUnvalidated: true, // need >1 entry to prove a non-default pick is honoured
	});
	t.after(() => {
		child.kill();
		upstream.close();
		fs.rmSync(home, { recursive: true, force: true });
	});
	await ready;

	const catalogue = await (await fetch(`http://127.0.0.1:${port}/models`)).json();
	const openrouter = catalogue.models.filter(m => m.backend === 'openrouter');
	assert.ok(openrouter.length > 1, 'the door exposes the curated list, not a single hardcoded model');
	assert.equal(openrouter.filter(m => m.default).length, 1, 'exactly one default in the served catalogue');

	// THE REGRESSION GUARD: pick a non-default curated model; the stub must be asked for exactly that id.
	const picked = openrouter.find(m => !m.default).id;
	await postMessage(port, { model: picked, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(seen.at(-1), picked, 'upstream was asked for the picked model');

	// A stale/unknown persisted id still lands on the curated default rather than 500ing or forwarding junk.
	const fallback = openrouter.find(m => m.default).id;
	await postMessage(port, { model: 'vendor/not-a-real-model', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(seen.at(-1), fallback, 'an unknown id falls back to the curated default');

	// An absent model does the same - the historical no-model call path is unchanged.
	await postMessage(port, { max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(seen.at(-1), fallback, 'an absent model falls back to the curated default');
});
