/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Per-request backend selection proof (plan 51 WP-C, the fix for #120's root cause). Two layers, both with
// `node --test` (no workbench build):
//
//   1) UNIT - the pure selection predicate. lwd-openai-oauth.canServe()/bundleHealth() decide, from the on-disk
//      bundle alone, whether the openai-oauth door can serve THIS request: valid, or expired-but-refreshable ->
//      yes; expired with no refresh token, missing, or corrupt -> no. This is the single source of truth the
//      broker's selectBackend() keys off, so testing it here proves the decision without spinning a server.
//
//   2) E2E - the real broker process. We spawn scripts/lwd-model-broker.js with a fake $HOME (so it never touches
//      the founder's real ~/.abstract), a stub OpenAI Responses upstream, and a stub OpenRouter upstream, then
//      drive /v1/messages, /models and /healthz over HTTP to prove: a valid bundle serves via openai-oauth; the
//      SAME prompt falls back to openrouter the instant the bundle is removed (next request, no restart); writing
//      the bundle back flips serving to openai-oauth on the very next request; LWD_BACKEND forces a door both
//      ways; an openai-oauth-selected request whose upstream 5xxs returns the honest error and is NEVER silently
//      retried on openrouter; and /models merges both doors with truthful availability.
//
// Every fake $HOME lives under a temp dir and is removed on teardown. No test touches the real bundle.

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
	return fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-select-test-'));
}

/**
 * Write an openai-oauth bundle into a fake HOME's ~/.abstract/openai-oauth.json.
 * @param {string} home
 * @param {{ expiresInSec?: number|null; withRefresh?: boolean }} [opts] expiresInSec=null mints an opaque
 *   (no-exp) access token; withRefresh=false omits the refresh_token.
 */
function writeBundle(home, opts = {}) {
	const expiresInSec = opts.expiresInSec === undefined ? 3600 : opts.expiresInSec;
	const withRefresh = opts.withRefresh !== false;
	const accessPayload = { scope: 'openid profile email' };
	if (typeof expiresInSec === 'number') { accessPayload.exp = Math.floor(Date.now() / 1000) + expiresInSec; }
	const bundle = {
		access_token: mintJwt(accessPayload),
		refresh_token: withRefresh ? 'stub-refresh-token' : '',
		id_token: mintJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_stub_123', email: 'founder@example.com' }, email: 'founder@example.com' }),
		account_id: 'acct_stub_123',
		email: 'founder@example.com',
		expires_at: typeof expiresInSec === 'number' ? Date.now() + expiresInSec * 1000 : Date.now() + 3600 * 1000,
		granted_scopes: 'openid profile email offline_access',
	};
	const dir = path.join(home, '.abstract');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, 'openai-oauth.json'), JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
}

function bundlePath(home) { return path.join(home, '.abstract', 'openai-oauth.json'); }

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

/** Start a one-shot HTTP stub that always answers with the given status + JSON body. Returns { server, base }. */
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
 *
 * The startup entitlement probe is OFF by default here: it calls the Responses upstream once per catalogue
 * model, which would silently inflate every hit count these tests assert on. The entitlement suite turns it
 * back on explicitly with `entitlementProbe: true`, which is the only place its wire behaviour is asserted.
 * @param {{ home: string; port: number; responsesUrl: string; openrouterUrl: string; openrouterKey?: string; backend?: string; entitlementProbe?: boolean }} cfg
 */
function startBroker(cfg) {
	const env = Object.assign({}, process.env, {
		HOME: cfg.home,
		LWD_PROXY_HOST: '127.0.0.1',
		LWD_PROXY_PORT: String(cfg.port),
		LWD_OPENAI_RESPONSES_URL: cfg.responsesUrl,
		OPENROUTER_URL: cfg.openrouterUrl,
		OPENROUTER_API_KEY: cfg.openrouterKey || '',
		LWD_ENTITLEMENT_PROBE: cfg.entitlementProbe ? '1' : '0',
	});
	// LWD_BACKEND must be genuinely unset for dynamic mode - deleting it from the child's env.
	if (cfg.backend) { env.LWD_BACKEND = cfg.backend; } else { delete env.LWD_BACKEND; }
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

/** HTTP GET a JSON route on the broker. */
async function getJson(port, routePath) {
	const res = await fetch(`http://127.0.0.1:${port}${routePath}`);
	return { status: res.status, json: await res.json() };
}

/** POST /v1/messages (non-streaming) and return { status, json }. */
async function postMessage(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }
	return { status: res.status, json };
}

function killBroker(child) {
	return new Promise(resolve => {
		child.once('exit', () => resolve());
		child.kill('SIGKILL');
	});
}

// A minimal OpenAI Responses success in the REAL wire shape: an SSE stream of typed events ending in
// `response.completed`. The buffered JSON body this stub used to return was invented pre-#120 and the 12 Aug
// founder smoke proved the real backend never sends one - it is stream-only, and its terminal payload carries
// no `output_text` convenience field, so the text only exists in the deltas. The byte-for-byte recorded
// transcript lives in scripts/test/fixtures/ and is asserted by lwd-responses-parity.test.js.
function responsesOkStream(model) {
	const text = `served-by-openai-oauth on ${model}`;
	const message = { id: 'msg_stub', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text }] };
	const events = [
		{ type: 'response.created', response: { id: 'resp_stub', model, status: 'in_progress' } },
		{ type: 'response.output_text.delta', content_index: 0, delta: text },
		{ type: 'response.completed', response: { id: 'resp_stub', model, status: 'completed', output: [message] } },
	];
	return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Answer a Responses request the way the real backend does: 200 + an SSE stream. */
function serveResponsesStream(res, model) {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.end(responsesOkStream(model));
}
// A minimal OpenRouter chat-completion success body.
function openrouterOk(model) {
	return { id: 'or_stub', model, choices: [{ message: { content: 'served-by-openrouter' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } };
}

// A prompt the broker accepts. It names NO model on purpose: since plan 55 WP-B3 a named model implies its own
// door (doc 30 section 2.2), so a prompt pinned to `gpt-5.6-sol` would be asking about pinning, not about
// availability-driven selection. A model-less call is exactly the case selectBackend() still owns, which is
// what these cases are about; the pinning rules get their own suite (lwd-model-pinning.test.js).
const PROMPT = { max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] };

// =========================================================================================================
// 1) UNIT: the selection predicate (lwd-openai-oauth.canServe / bundleHealth)
// =========================================================================================================

test('canServe: valid bundle -> serves; expired+refreshable -> serves; expired+stuck / missing / corrupt -> does not', () => {
	const home = mkHome();
	const { oauth, restore } = freshOauth(home);
	try {
		const results = {};

		// missing bundle
		results.missing = { canServe: oauth.canServe(), state: oauth.bundleHealth().state };

		// valid bundle
		writeBundle(home, { expiresInSec: 3600, withRefresh: true });
		results.valid = { canServe: oauth.canServe(), state: oauth.bundleHealth().state };

		// expired but refreshable (exp in the past, refresh_token present)
		writeBundle(home, { expiresInSec: -60, withRefresh: true });
		results.expiredRefreshable = { canServe: oauth.canServe(), state: oauth.bundleHealth().state };

		// expired and stuck (exp in the past, no refresh_token)
		writeBundle(home, { expiresInSec: -60, withRefresh: false });
		results.expiredStuck = { canServe: oauth.canServe(), state: oauth.bundleHealth().state };

		// corrupt bundle reads as signed-out, never throws
		fs.writeFileSync(bundlePath(home), '{ not json');
		results.corrupt = { canServe: oauth.canServe(), state: oauth.bundleHealth().state };

		assert.deepStrictEqual(results, {
			missing: { canServe: false, state: 'signed-out' },
			valid: { canServe: true, state: 'valid' },
			expiredRefreshable: { canServe: true, state: 'expired-refreshable' },
			expiredStuck: { canServe: false, state: 'expired-stuck' },
			corrupt: { canServe: false, state: 'signed-out' },
		});
	} finally {
		restore();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

// =========================================================================================================
// 2) E2E: the real broker picks its door per request
// =========================================================================================================

test('dynamic selection: valid bundle -> openai-oauth; remove bundle -> openrouter; restore -> openai-oauth (no restart)', async () => {
	const home = mkHome();
	const responses = await startUpstream((req, res, _body) => serveResponsesStream(res, 'gpt-5.6-sol'));
	const openrouter = await startUpstream((req, res, _body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(openrouterOk('openai/gpt-4.1-mini'))); });
	const port = 8300 + Math.floor(Math.random() * 500);
	writeBundle(home, { expiresInSec: 3600, withRefresh: true });
	const broker = startBroker({ home, port, responsesUrl: responses.base, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test' });
	try {
		await broker.ready;

		// (a) valid bundle -> served by openai-oauth
		const withBundle = await postMessage(port, PROMPT);
		const healthWithBundle = await getJson(port, '/healthz');

		// (b) remove the bundle -> the SAME prompt falls back to openrouter on the very next request
		fs.rmSync(bundlePath(home), { force: true });
		const noBundle = await postMessage(port, PROMPT);
		const healthNoBundle = await getJson(port, '/healthz');

		// (c) write the bundle back -> serving flips to openai-oauth again on the next request, no restart
		writeBundle(home, { expiresInSec: 3600, withRefresh: true });
		const restored = await postMessage(port, PROMPT);

		assert.deepStrictEqual({
			withBundleText: withBundle.json.content[0].text,
			withBundleHealth: { backend: healthWithBundle.json.backend, mode: healthWithBundle.json.backendMode, signedIn: healthWithBundle.json.signedIn },
			noBundleText: noBundle.json.content[0].text,
			noBundleHealth: { backend: healthNoBundle.json.backend, mode: healthNoBundle.json.backendMode, signedIn: healthNoBundle.json.signedIn },
			restoredText: restored.json.content[0].text,
		}, {
			withBundleText: 'served-by-openai-oauth on gpt-5.6-sol',
			withBundleHealth: { backend: 'openai-oauth', mode: 'dynamic', signedIn: true },
			noBundleText: 'served-by-openrouter',
			noBundleHealth: { backend: 'openrouter', mode: 'dynamic', signedIn: false },
			restoredText: 'served-by-openai-oauth on gpt-5.6-sol',
		});
	} finally {
		await killBroker(broker.child);
		responses.server.close(); openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('forced override (LWD_BACKEND) is honoured both ways and named in /healthz', async () => {
	const home = mkHome();
	const responses = await startUpstream((req, res) => serveResponsesStream(res, 'gpt-5.6-sol'));
	const openrouter = await startUpstream((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(openrouterOk('openai/gpt-4.1-mini'))); });

	// forced=openrouter DESPITE a valid bundle -> serves openrouter.
	const homeA = home;
	writeBundle(homeA, { expiresInSec: 3600, withRefresh: true });
	const portA = 8800 + Math.floor(Math.random() * 200);
	const brokerA = startBroker({ home: homeA, port: portA, responsesUrl: responses.base, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test', backend: 'openrouter' });

	// forced=openai-oauth with NO bundle -> still selects openai-oauth (and, not signed in, degrades honestly).
	const homeB = mkHome();
	const portB = portA + 1;
	const brokerB = startBroker({ home: homeB, port: portB, responsesUrl: responses.base, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test', backend: 'openai-oauth' });
	try {
		await brokerA.ready; await brokerB.ready;
		const forcedOpenrouter = await postMessage(portA, PROMPT);
		const healthA = await getJson(portA, '/healthz');
		const healthB = await getJson(portB, '/healthz');
		assert.deepStrictEqual({
			forcedOpenrouterText: forcedOpenrouter.json.content[0].text,
			healthA: { backend: healthA.json.backend, mode: healthA.json.backendMode },
			healthB: { backend: healthB.json.backend, mode: healthB.json.backendMode },
		}, {
			forcedOpenrouterText: 'served-by-openrouter',
			healthA: { backend: 'openrouter', mode: 'forced' },
			healthB: { backend: 'openai-oauth', mode: 'forced' },
		});
	} finally {
		await killBroker(brokerA.child); await killBroker(brokerB.child);
		responses.server.close(); openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
		fs.rmSync(homeB, { recursive: true, force: true });
	}
});

test('openai-oauth selected but upstream 5xxs -> honest error, NO silent cross-backend retry to openrouter', async () => {
	const home = mkHome();
	let responsesHits = 0;
	let openrouterHits = 0;
	// The Responses upstream always 500s.
	const responses = await startUpstream((req, res) => { responsesHits++; res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'upstream is down' } })); });
	// The OpenRouter upstream would answer 200 - it must NOT be hit for an openai-oauth-selected request.
	const openrouter = await startUpstream((req, res) => { openrouterHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(openrouterOk('openai/gpt-4.1-mini'))); });
	const port = 8600 + Math.floor(Math.random() * 150);
	writeBundle(home, { expiresInSec: 3600, withRefresh: true });
	const broker = startBroker({ home, port, responsesUrl: responses.base, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test' });
	try {
		await broker.ready;
		const result = await postMessage(port, PROMPT);
		assert.deepStrictEqual({
			status: result.status,
			errorType: result.json && result.json.error && result.json.error.type,
			message: result.json && result.json.error && result.json.error.message,
			responsesHits,
			openrouterHits,
			// the full upstream body reached broker stdout for diagnosability (#120)
			loggedBody: /openai-oauth forward failed: upstream 500; body: .*upstream is down/.test(broker.getOutput()),
		}, {
			status: 502,
			errorType: 'proxy_error',
			message: 'upstream is down',
			responsesHits: 1,
			openrouterHits: 0,
			loggedBody: true,
		});
	} finally {
		await killBroker(broker.child);
		responses.server.close(); openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('/models merges both doors with truthful availability + serving flag, in both bundle states', async () => {
	const home = mkHome();
	const responses = await startUpstream((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
	const openrouter = await startUpstream((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
	const port = 8700 + Math.floor(Math.random() * 90);
	writeBundle(home, { expiresInSec: 3600, withRefresh: true });
	const broker = startBroker({ home, port, responsesUrl: responses.base, openrouterUrl: openrouter.base, openrouterKey: 'sk-or-test' });
	const summarise = models => ({
		backends: [...new Set(models.map(m => m.backend))].sort(),
		oauthAvailable: models.filter(m => m.backend === 'openai-oauth').every(m => m.available),
		openrouterAvailable: models.filter(m => m.backend === 'openrouter').every(m => m.available),
		servingBackend: [...new Set(models.filter(m => m.serving).map(m => m.backend))],
		hasSolAndIncluded: models.some(m => m.id === 'gpt-5.6-sol') && models.some(m => m.tier === 'included'),
	});
	try {
		await broker.ready;
		const withBundle = await getJson(port, '/models');
		fs.rmSync(bundlePath(home), { force: true });
		const noBundle = await getJson(port, '/models');
		assert.deepStrictEqual({
			withBundle: { top: withBundle.json.backend, mode: withBundle.json.backendMode, ...summarise(withBundle.json.models) },
			noBundle: { top: noBundle.json.backend, mode: noBundle.json.backendMode, ...summarise(noBundle.json.models) },
		}, {
			withBundle: { top: 'openai-oauth', mode: 'dynamic', backends: ['openai-oauth', 'openrouter'], oauthAvailable: true, openrouterAvailable: true, servingBackend: ['openai-oauth'], hasSolAndIncluded: true },
			noBundle: { top: 'openrouter', mode: 'dynamic', backends: ['openai-oauth', 'openrouter'], oauthAvailable: false, openrouterAvailable: true, servingBackend: ['openrouter'], hasSolAndIncluded: true },
		});
	} finally {
		await killBroker(broker.child);
		responses.server.close(); openrouter.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});
