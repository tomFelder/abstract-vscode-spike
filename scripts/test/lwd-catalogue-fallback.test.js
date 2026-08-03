/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Catalogue-as-data + fallback proof (plan 51 WP-D). Runs with `node --test` (no workbench build). Two layers:
//
//   1) UNIT - the ~/.abstract/models.json overlay in lwd-openai-oauth.listModels(): a valid config merges over
//      the built-in gpt-5.6 defaults (a new id ships with zero broker edits), an operator-named default wins,
//      and a bogus file (bad JSON / wrong types / empty) degrades HONESTLY to the built-ins - never a crash,
//      never an empty picker.
//
//   2) E2E - the REAL broker process against stub upstreams, with a fake $HOME so the founder's real ~/.abstract
//      is never touched. Proves: the OpenRouter cap path (metering accumulates per request, the $1/day cap pauses
//      serving gracefully with an honest client state - never a raw 500 - and names itself in /healthz + /models),
//      the cap RESETS on the day boundary (via an injected clock file, no Date.now hacks), key precedence
//      (OPENROUTER_API_KEY over the key file), the unconfigured door reporting honestly, the models.json overlay
//      flowing through /models, and the renderer->broker POST /event CORS fix (scoped origin echoed, event lands).
//
// Every fake $HOME lives under a temp dir and is removed on teardown. No test touches the real bundle or key.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { mintJwt } = require('./lwd-device-auth-stub.js');

const OAUTH_MODULE = require.resolve('../lwd-openai-oauth.js');
const BROKER_SCRIPT = require.resolve('../lwd-model-broker.js');

// --- helpers ---------------------------------------------------------------------------------------------

/** A fake HOME under a fresh temp dir; caller removes it. */
function mkHome() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-catalogue-test-'));
}

/** Write ~/.abstract/models.json into a fake HOME. */
function writeModelsConfig(home, config) {
	const dir = path.join(home, '.abstract');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, 'models.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Write a valid openai-oauth bundle so the door can serve (used by the "signed in" states). */
function writeBundle(home) {
	const bundle = {
		access_token: mintJwt({ exp: Math.floor(Date.now() / 1000) + 3600, scope: 'openid profile email' }),
		refresh_token: 'stub-refresh-token',
		id_token: mintJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_stub', email: 'founder@example.com' }, email: 'founder@example.com' }),
		account_id: 'acct_stub',
		email: 'founder@example.com',
		expires_at: Date.now() + 3600 * 1000,
		granted_scopes: 'openid profile email offline_access',
	};
	const dir = path.join(home, '.abstract');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, 'openai-oauth.json'), JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
}

/** Load a FRESH oauth module bound to a fake HOME. */
function freshOauth(home) {
	const prevHome = process.env.HOME;
	process.env.HOME = home;
	delete require.cache[OAUTH_MODULE];
	const oauth = require('../lwd-openai-oauth.js');
	const restore = () => {
		if (prevHome === undefined) { delete process.env.HOME; } else { process.env.HOME = prevHome; }
		delete require.cache[OAUTH_MODULE];
	};
	return { oauth, restore };
}

/** Start a one-shot HTTP stub. `handler(req, res, body)`. Returns { server, base }. */
function startUpstream(handler) {
	return new Promise(resolve => {
		const server = http.createServer((req, res) => {
			let data = '';
			req.on('data', c => { data += c; });
			req.on('end', () => handler(req, res, data));
		});
		server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
	});
}

/**
 * Spawn the real broker against a fake HOME + stub upstreams and wait until it is listening.
 * @param {{ home: string; port: number; openrouterUrl?: string; openrouterKey?: string; openrouterKeyFile?: string;
 *   dailyBudgetUsd?: number; clockFile?: string; env?: Record<string,string> }} cfg
 */
function startBroker(cfg) {
	const env = Object.assign({}, process.env, {
		HOME: cfg.home,
		LWD_PROXY_HOST: '127.0.0.1',
		LWD_PROXY_PORT: String(cfg.port),
		OPENROUTER_URL: cfg.openrouterUrl || 'http://127.0.0.1:1/none',
	}, cfg.env || {});
	// A metered-fallback test needs NO oauth bundle so openrouter is the serving door; unset LWD_BACKEND for dynamic.
	delete env.LWD_BACKEND;
	if (cfg.openrouterKey !== undefined) { env.OPENROUTER_API_KEY = cfg.openrouterKey; } else { delete env.OPENROUTER_API_KEY; }
	if (cfg.openrouterKeyFile !== undefined) { env.OPENROUTER_API_KEY_FILE = cfg.openrouterKeyFile; } else { delete env.OPENROUTER_API_KEY_FILE; }
	if (cfg.dailyBudgetUsd !== undefined) { env.LWD_DAILY_BUDGET_USD = String(cfg.dailyBudgetUsd); }
	if (cfg.clockFile !== undefined) { env.LWD_SPEND_CLOCK_FILE = cfg.clockFile; }
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
	return { status: res.status, json };
}

function killBroker(child) {
	return new Promise(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); });
}

// An OpenRouter chat-completion success body that carries a real `cost` so the meter charges a known amount.
function openrouterOk(costUsd) {
	return { id: 'or_stub', model: 'openai/gpt-4.1-mini', choices: [{ message: { content: 'served-by-openrouter' }, finish_reason: 'stop' }], usage: { total_tokens: 10, cost: costUsd } };
}

const PROMPT = { max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] };

// =========================================================================================================
// 1) UNIT: the ~/.abstract/models.json overlay
// =========================================================================================================

test('models.json overlay: absent -> built-ins; a replacement list + named default merges; a NEW id needs no broker edit', async () => {
	const home = mkHome();
	const { oauth, restore } = freshOauth(home);
	try {
		const results = {};

		// (a) No config file -> the built-in gpt-5.6 Codex family, exactly one default (gpt-5.6-sol).
		const builtin = await oauth.listModels();
		results.builtin = { ids: builtin.map(m => m.id), default: builtin.find(m => m.default)?.id, defaults: builtin.filter(m => m.default).length };

		// (b) A replacement list with a NEW id and an operator-named default - no broker edit needed for the new id.
		writeModelsConfig(home, {
			'openai-oauth': {
				default: 'gpt-5.7-nova',
				models: [
					{ id: 'gpt-5.6-sol', label: 'Sol' },
					{ id: 'gpt-5.7-nova', label: 'Nova' },
				],
			},
		});
		const overlaid = await oauth.listModels();
		results.overlaid = { ids: overlaid.map(m => m.id), labels: overlaid.map(m => m.label), default: overlaid.find(m => m.default)?.id, defaults: overlaid.filter(m => m.default).length };

		// (c) An operator default that is NOT in the list is ignored; the list's own first entry keeps the default.
		writeModelsConfig(home, { 'openai-oauth': { default: 'gpt-does-not-exist', models: [{ id: 'gpt-5.6-terra', label: 'Terra' }] } });
		const badDefault = await oauth.listModels();
		results.badDefault = { ids: badDefault.map(m => m.id), default: badDefault.find(m => m.default)?.id, defaults: badDefault.filter(m => m.default).length };

		assert.deepStrictEqual(results, {
			builtin: { ids: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'], default: 'gpt-5.6-sol', defaults: 1 },
			overlaid: { ids: ['gpt-5.6-sol', 'gpt-5.7-nova'], labels: ['Sol', 'Nova'], default: 'gpt-5.7-nova', defaults: 1 },
			badDefault: { ids: ['gpt-5.6-terra'], default: 'gpt-5.6-terra', defaults: 1 },
		});
	} finally {
		restore();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('models.json overlay: a bogus file degrades honestly to the built-ins (never a crash, never an empty picker)', async () => {
	const home = mkHome();
	const { oauth, restore } = freshOauth(home);
	const builtinIds = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
	try {
		const cases = {};

		writeModelsConfig(home, '{ not valid json');
		cases.badJson = (await oauth.listModels()).map(m => m.id);

		writeModelsConfig(home, { 'openai-oauth': { models: 'not-an-array' } });
		cases.wrongType = (await oauth.listModels()).map(m => m.id);

		writeModelsConfig(home, { 'openai-oauth': { models: [] } });
		cases.emptyList = (await oauth.listModels()).map(m => m.id);

		writeModelsConfig(home, { 'openai-oauth': { models: [{ label: 'no id here' }, { id: '' }] } });
		cases.noUsableEntries = (await oauth.listModels()).map(m => m.id);

		writeModelsConfig(home, { somethingElse: true });
		cases.noSlice = (await oauth.listModels()).map(m => m.id);

		assert.deepStrictEqual(cases, {
			badJson: builtinIds,
			wrongType: builtinIds,
			emptyList: builtinIds,
			noUsableEntries: builtinIds,
			noSlice: builtinIds,
		});
	} finally {
		restore();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// =========================================================================================================
// 2) E2E: the OpenRouter cap path (accumulate -> pause -> name itself -> reset on the day boundary)
// =========================================================================================================

test('cap path: metering accumulates, the $1/day cap pauses gracefully (200 pause, never 500), names itself in /healthz + /models, and resets on the day boundary', async () => {
	const home = mkHome();
	// Each call costs $0.60; the 2nd tips over the $1/day cap. A real `cost` in usage is charged verbatim.
	const openrouter = await startUpstream((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(openrouterOk(0.60))); });
	const clockFile = path.join(home, 'clock-offset');
	const port = 8940 + Math.floor(Math.random() * 50);
	const broker = startBroker({ home, port, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test', dailyBudgetUsd: 1, clockFile });
	try {
		await broker.ready;

		// call 1: served, $0.60 charged - under the cap.
		const first = await postMessage(port, PROMPT);
		const healthAfterFirst = await getJson(port, '/healthz');

		// call 2: served, running total $1.20 >= $1 cap -> the NEXT call is paused.
		const second = await postMessage(port, PROMPT);

		// call 3: over budget -> the honest pause message (HTTP 200, stop_reason 'pause'), never a raw 500.
		const third = await postMessage(port, PROMPT);
		const healthPaused = await getJson(port, '/healthz');
		const modelsPaused = await getJson(port, '/models');

		// Advance the clock a full day: the cap resets and serving resumes on the very next call.
		fs.writeFileSync(clockFile, String(25 * 60 * 60 * 1000));
		const afterReset = await postMessage(port, PROMPT);
		const healthAfterReset = await getJson(port, '/healthz');

		assert.deepStrictEqual({
			firstServed: first.json.content[0].text,
			firstStatus: first.status,
			healthAfterFirst: { reason: healthAfterFirst.json.reason, dailyTotal: healthAfterFirst.json.dailyTotalUsd },
			secondServed: second.json.content[0].text,
			thirdStatus: third.status,
			thirdPaused: third.json.stop_reason,
			thirdText: third.json.content[0].text,
			healthPausedReason: healthPaused.json.reason,
			healthPausedOk: healthPaused.json.ok,
			// The paused door names itself in /models: the included entry is not available while budget-paused.
			includedAvailableWhilePaused: modelsPaused.json.models.filter(m => m.tier === 'included').every(m => m.available),
			afterResetServed: afterReset.json.content[0].text,
			afterResetStatus: afterReset.status,
			healthAfterResetReason: healthAfterReset.json.reason,
		}, {
			firstServed: 'served-by-openrouter',
			firstStatus: 200,
			healthAfterFirst: { reason: 'ready', dailyTotal: 0.6 },
			secondServed: 'served-by-openrouter',
			thirdStatus: 200,
			thirdPaused: 'pause',
			thirdText: "You've used today's included usage - picks up tomorrow, or sign in with ChatGPT for unlimited.",
			healthPausedReason: 'budget-paused',
			healthPausedOk: true,
			includedAvailableWhilePaused: false,
			afterResetServed: 'served-by-openrouter',
			afterResetStatus: 200,
			healthAfterResetReason: 'ready',
		});
	} finally {
		await killBroker(broker.child);
		openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// =========================================================================================================
// 3) E2E: key precedence + the unconfigured door's honesty
// =========================================================================================================

test('key precedence: OPENROUTER_API_KEY wins over the key file; the file is used when the env var is absent', async () => {
	const home = mkHome();
	// The stub echoes back the Authorization header it received so we can prove WHICH key was used.
	const openrouter = await startUpstream((req, res) => {
		const auth = req.headers['authorization'] || '';
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ id: 'or', model: 'm', choices: [{ message: { content: auth }, finish_reason: 'stop' }], usage: { total_tokens: 1 } }));
	});
	const keyFile = path.join(home, 'lwd-openrouter.key');
	fs.writeFileSync(keyFile, 'sk-from-file\n', { mode: 0o600 });

	// (a) env var set AND file present -> env wins.
	const portA = 8500 + Math.floor(Math.random() * 90);
	const brokerA = startBroker({ home, port: portA, openrouterUrl: openrouter.base, openrouterKey: 'sk-from-env', openrouterKeyFile: keyFile });
	// (b) env var ABSENT, file present -> the file key is used.
	const portB = portA + 1;
	const brokerB = startBroker({ home, port: portB, openrouterUrl: openrouter.base, openrouterKeyFile: keyFile });
	try {
		await brokerA.ready; await brokerB.ready;
		const usedEnv = await postMessage(portA, PROMPT);
		const usedFile = await postMessage(portB, PROMPT);
		assert.deepStrictEqual({
			env: usedEnv.json.content[0].text,
			file: usedFile.json.content[0].text,
		}, {
			env: 'Bearer sk-from-env',
			file: 'Bearer sk-from-file',
		});
	} finally {
		await killBroker(brokerA.child); await killBroker(brokerB.child);
		openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('unconfigured door: no key + no bundle -> /healthz + /models report honestly, no fabricated availability', async () => {
	const home = mkHome();
	const openrouter = await startUpstream((req, res) => { res.writeHead(200, {}); res.end('{}'); });
	const port = 8760 + Math.floor(Math.random() * 90);
	// No OPENROUTER_API_KEY, no key file, no bundle: the included door is unconfigured and the ChatGPT door is signed out.
	const broker = startBroker({ home, port, openrouterUrl: openrouter.base });
	try {
		await broker.ready;
		const health = await getJson(port, '/healthz');
		const models = await getJson(port, '/models');
		assert.deepStrictEqual({
			ok: health.json.ok,
			reason: health.json.reason,
			backend: health.json.backend,
			signedIn: health.json.signedIn,
			anyModelAvailable: models.json.models.some(m => m.available),
		}, {
			ok: false,
			reason: 'unconfigured',
			backend: 'openrouter',
			signedIn: false,
			anyModelAvailable: false,
		});
	} finally {
		await killBroker(broker.child);
		openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// =========================================================================================================
// 4) E2E: the models.json overlay flows through the broker's /models
// =========================================================================================================

test('/models reflects the ~/.abstract/models.json overlay (a renamed/new id appears with no broker edit)', async () => {
	const home = mkHome();
	writeBundle(home); // signed in so the openai-oauth catalogue is the own-key list
	writeModelsConfig(home, { 'openai-oauth': { default: 'gpt-5.7-nova', models: [{ id: 'gpt-5.7-nova', label: 'Nova' }, { id: 'gpt-5.6-luna', label: 'Luna' }] } });
	const openrouter = await startUpstream((req, res) => { res.writeHead(200, {}); res.end('{}'); });
	const port = 8820 + Math.floor(Math.random() * 90);
	const broker = startBroker({ home, port, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test' });
	try {
		await broker.ready;
		const models = await getJson(port, '/models');
		const ownKey = models.json.models.filter(m => m.backend === 'openai-oauth');
		assert.deepStrictEqual({
			ownKeyIds: ownKey.map(m => m.id),
			ownKeyDefault: ownKey.find(m => m.default)?.id,
			novaPresent: ownKey.some(m => m.id === 'gpt-5.7-nova' && m.label === 'Nova'),
		}, {
			ownKeyIds: ['gpt-5.7-nova', 'gpt-5.6-luna'],
			ownKeyDefault: 'gpt-5.7-nova',
			novaPresent: true,
		});
	} finally {
		await killBroker(broker.child);
		openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// =========================================================================================================
// 5) E2E: the renderer->broker POST /event CORS fix (scoped origin echoed; the event lands)
// =========================================================================================================

test('POST /event: an allowed app Origin is echoed (scoped, not blanket) and the event is written to events.log', async () => {
	const home = mkHome();
	const openrouter = await startUpstream((req, res) => { res.writeHead(200, {}); res.end('{}'); });
	const port = 8880 + Math.floor(Math.random() * 90);
	const broker = startBroker({ home, port, openrouterUrl: openrouter.base });
	const appOrigin = 'vscode-file://vscode-app';
	const webOrigin = 'http://localhost:8080';
	const evilOrigin = 'https://evil.example.com';
	try {
		await broker.ready;

		// The real POST from an allowed desktop origin: the response echoes THAT origin (not '*'), so the browser
		// can read it, and the body is written to ~/.abstract/events.log.
		const post = await fetch(`http://127.0.0.1:${port}/event`, {
			method: 'POST', headers: { 'content-type': 'application/json', 'origin': appOrigin }, body: JSON.stringify({ event: 'model_configured', provider: 'included' }),
		});
		const postAllowOrigin = post.headers.get('access-control-allow-origin');
		const postBody = await post.json();

		// The OPTIONS preflight from the web origin is allowed too, echoing that origin.
		const preflight = await fetch(`http://127.0.0.1:${port}/event`, { method: 'OPTIONS', headers: { 'origin': webOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
		const preflightAllowOrigin = preflight.headers.get('access-control-allow-origin');

		// An unrecognised web origin is NOT echoed (scoped, not blanket): it falls back to '*', which - because it
		// is not the requester's origin - a browser will not treat as an allow for a would-be credentialed read.
		const evil = await fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': evilOrigin }, body: JSON.stringify({ event: 'x' }) });
		const evilAllowOrigin = evil.headers.get('access-control-allow-origin');

		const eventsLog = fs.readFileSync(path.join(home, '.abstract', 'events.log'), 'utf8');
		const parsedEvent = JSON.parse(eventsLog.trim().split('\n')[0]);

		assert.deepStrictEqual({
			postStatus: post.status,
			postAllowOrigin,
			postOk: postBody.ok,
			preflightStatus: preflight.status,
			preflightAllowOrigin,
			evilAllowOrigin,
			landedEvent: parsedEvent.event,
			landedProvider: parsedEvent.provider,
			landedHasTs: typeof parsedEvent.ts === 'string',
		}, {
			postStatus: 200,
			postAllowOrigin: appOrigin,
			postOk: true,
			preflightStatus: 204,
			preflightAllowOrigin: webOrigin,
			evilAllowOrigin: '*',
			landedEvent: 'model_configured',
			landedProvider: 'included',
			landedHasTs: true,
		});
	} finally {
		await killBroker(broker.child);
		openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});
