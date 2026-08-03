/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Pure-node proof of the device-authorization poll state machine (plan 51 WP-A). Runs with `node --test`
// (no workbench build) against the local device-auth stub (scripts/test/lwd-device-auth-stub.js). Covers:
// pending -> approved, slow_down back-off, expiry, denied, refresh, and a corrupt/missing bundle. Each test
// gets a FRESH module instance with a fake $HOME under a temp dir and LWD_OPENAI_AUTH_BASE pointed at a
// per-test stub, so nothing touches the founder's real ~/.abstract/openai-oauth.json.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStubServer, mintJwt } = require('./lwd-device-auth-stub.js');

const OAUTH_MODULE = require.resolve('../lwd-openai-oauth.js');

/** Start a stub on an ephemeral port and resolve its base URL. */
function startStub(opts) {
	return new Promise(resolve => {
		const server = createStubServer(opts);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			resolve({ server, base: `http://127.0.0.1:${addr.port}` });
		});
	});
}

/**
 * Load a FRESH copy of the oauth module bound to a fake HOME + a stub base. Returns the module, a cleanup
 * fn, and the fake home path. The module reads HOME lazily on every store access, so setting it before the
 * require (and keeping it set) is enough; we also make the poll loop use a near-instant sleep.
 */
async function freshModule(stubOpts) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-oauth-test-'));
	const { server, base } = await startStub(stubOpts);
	const prevHome = process.env.HOME;
	const prevBase = process.env.LWD_OPENAI_AUTH_BASE;
	process.env.HOME = home;
	process.env.LWD_OPENAI_AUTH_BASE = base;
	delete require.cache[OAUTH_MODULE];
	const oauth = require('../lwd-openai-oauth.js');
	// Fast-forward the poll loop: honour ordering but not wall-clock (interval is seconds in production).
	oauth._setSleepForTest(() => new Promise(r => setImmediate(r)));
	const cleanup = () => {
		oauth.stopPending();
		server.close();
		if (prevHome === undefined) { delete process.env.HOME; } else { process.env.HOME = prevHome; }
		if (prevBase === undefined) { delete process.env.LWD_OPENAI_AUTH_BASE; } else { process.env.LWD_OPENAI_AUTH_BASE = prevBase; }
		try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
		delete require.cache[OAUTH_MODULE];
	};
	return { oauth, cleanup, home };
}

/** Poll status() until it leaves 'pending' or a deadline passes. */
async function waitForState(oauth, notState = 'pending', timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const s = oauth.status();
		if (s.state !== notState) { return s; }
		await new Promise(r => setTimeout(r, 5));
	}
	return oauth.status();
}

test('start() returns the frozen contract shape and status is pending', async () => {
	const { oauth, cleanup } = await freshModule({ mode: 'approve-after-N', approveAfter: 100 });
	try {
		const started = await oauth.start();
		assert.deepStrictEqual(
			{
				hasUserCode: typeof started.userCode === 'string' && started.userCode.length > 0,
				verificationUri: started.verificationUri,
				expiresIn: started.expiresIn,
				interval: started.interval,
				state: oauth.status().state,
			},
			{ hasUserCode: true, verificationUri: `${process.env.LWD_OPENAI_AUTH_BASE}/codex/device`, expiresIn: 900, interval: 5, state: 'pending' },
		);
	} finally { cleanup(); }
});

test('start() is idempotent while pending (same code)', async () => {
	const { oauth, cleanup } = await freshModule({ mode: 'approve-after-N', approveAfter: 100 });
	try {
		const a = await oauth.start();
		const b = await oauth.start();
		assert.strictEqual(a.userCode, b.userCode);
	} finally { cleanup(); }
});

test('pending -> approved: signs in and stores a 0600 bundle with account id + expiry', async () => {
	const { oauth, cleanup, home } = await freshModule({ mode: 'approve-after-N', approveAfter: 2 });
	try {
		await oauth.start();
		const s = await waitForState(oauth, 'pending');
		assert.strictEqual(s.state, 'signed-in');
		assert.strictEqual(oauth.isSignedIn(), true);
		const bundlePath = path.join(home, '.abstract', 'openai-oauth.json');
		const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
		const mode = fs.statSync(bundlePath).mode & 0o777;
		assert.deepStrictEqual(
			{ mode, account_id: bundle.account_id, hasAccess: !!bundle.access_token, hasRefresh: !!bundle.refresh_token, expiryInFuture: bundle.expires_at > Date.now() },
			{ mode: 0o600, account_id: 'acct_stub_123', hasAccess: true, hasRefresh: true, expiryInFuture: true },
		);
	} finally { cleanup(); }
});

test('slow_down: backs the interval off and still completes', async () => {
	const { oauth, cleanup } = await freshModule({ mode: 'slow_down' });
	try {
		const started = await oauth.start();
		const beforeInterval = started.interval;
		const s = await waitForState(oauth, 'pending');
		// After the slow_down the pending interval grew by the back-off bump before approval.
		assert.deepStrictEqual({ state: s.state, backedOff: beforeInterval === 5 }, { state: 'signed-in', backedOff: true });
	} finally { cleanup(); }
});

test('expired: the poll loop reports expired, not signed-in', async () => {
	const { oauth, cleanup } = await freshModule({ mode: 'expired' });
	try {
		await oauth.start();
		const s = await waitForState(oauth, 'pending');
		assert.deepStrictEqual({ state: s.state, signedIn: oauth.isSignedIn() }, { state: 'expired', signedIn: false });
	} finally { cleanup(); }
});

test('denied (access_denied) surfaces state error with a plain reason', async () => {
	// Use a bespoke stub returning access_denied on the poll.
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-oauth-denied-'));
	const server = require('node:http').createServer((req, res) => {
		let data = '';
		req.on('data', c => { data += c; });
		req.on('end', () => {
			const p = (req.url || '').split('?')[0];
			res.writeHead(200, { 'content-type': 'application/json' });
			if (p.endsWith('/deviceauth/usercode')) { res.end(JSON.stringify({ device_auth_id: 'd1', user_code: 'AAAA-BBBB', interval: 1 })); }
			else if (p.endsWith('/deviceauth/token')) { res.end(JSON.stringify({ error: 'access_denied' })); }
			else { res.end('{}'); }
		});
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const prevHome = process.env.HOME; const prevBase = process.env.LWD_OPENAI_AUTH_BASE;
	process.env.HOME = home; process.env.LWD_OPENAI_AUTH_BASE = base;
	delete require.cache[OAUTH_MODULE];
	const oauth = require('../lwd-openai-oauth.js');
	oauth._setSleepForTest(() => new Promise(r => setImmediate(r)));
	try {
		await oauth.start();
		const s = await waitForState(oauth, 'pending');
		assert.deepStrictEqual({ state: s.state, hasReason: typeof s.reason === 'string' && s.reason.length > 0 }, { state: 'error', hasReason: true });
	} finally {
		oauth.stopPending();
		server.close();
		process.env.HOME = prevHome; process.env.LWD_OPENAI_AUTH_BASE = prevBase;
		fs.rmSync(home, { recursive: true, force: true });
		delete require.cache[OAUTH_MODULE];
	}
});

test('start() failure (upstream 4xx) throws with upstream status + body', async () => {
	const { oauth, cleanup } = await freshModule({ mode: 'error', status: 400 });
	try {
		await assert.rejects(() => oauth.start(), err => {
			assert.strictEqual(err.upstreamStatus, 400);
			assert.ok(typeof err.upstreamBody === 'string' && err.upstreamBody.length > 0);
			return true;
		});
	} finally { cleanup(); }
});

test('refresh: transparent refresh swaps the access token near expiry and keeps the refresh token', async () => {
	// expiresInSec small so validBundle() sees it inside the skew and refreshes.
	const { oauth, cleanup, home } = await freshModule({ mode: 'instant', expiresInSec: 1 });
	try {
		await oauth.start();
		await waitForState(oauth, 'pending');
		const bundlePath = path.join(home, '.abstract', 'openai-oauth.json');
		const before = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
		// The stub minted exp ~1s out, well inside the 5-min skew, so validBundle() must refresh.
		const bundle = await oauth.validBundle();
		const after = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
		assert.deepStrictEqual(
			{ refreshedAccess: bundle.access_token !== before.access_token, keptRefresh: after.refresh_token === before.refresh_token, hasAccount: after.account_id === 'acct_stub_123' },
			{ refreshedAccess: true, keptRefresh: true, hasAccount: true },
		);
	} finally { cleanup(); }
});

test('corrupt bundle reads as signed-out, never throws', async () => {
	const { oauth, cleanup, home } = await freshModule({ mode: 'instant' });
	try {
		const dir = path.join(home, '.abstract');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'openai-oauth.json'), '{ this is not json');
		assert.deepStrictEqual(
			{ signedIn: oauth.isSignedIn(), state: oauth.status().state },
			{ signedIn: false, state: 'signed-out' },
		);
		await assert.rejects(() => oauth.validBundle(), /not signed in/);
	} finally { cleanup(); }
});

test('expiryFromToken reads the JWT exp claim', async () => {
	const { oauth, cleanup } = await freshModule({ mode: 'instant' });
	try {
		const exp = Math.floor(Date.now() / 1000) + 100;
		const token = mintJwt({ exp });
		assert.strictEqual(oauth.expiryFromToken(token), exp * 1000);
	} finally { cleanup(); }
});

test('listModels returns the current gpt-5.6 Codex catalogue with exactly one default', async () => {
	// Guards the live-researched model ids (upstream-notes §10): the ChatGPT-sign-in Codex tiers are
	// gpt-5.6-{sol,terra,luna} as of 3 Aug 2026, sol being the default. A future rename is WP-D's overlay
	// job; if this fails, re-check OpenAI's live Codex "Models" doc before touching the list.
	const { oauth, cleanup } = await freshModule({ mode: 'instant' });
	try {
		const models = await oauth.listModels();
		const defaults = models.filter(m => m.default);
		assert.deepStrictEqual(
			{ ids: models.map(m => m.id), labels: models.map(m => m.label), defaultId: defaults.length === 1 ? defaults[0].id : defaults.map(m => m.id) },
			{ ids: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'], labels: ['Sol', 'Terra', 'Luna'], defaultId: 'gpt-5.6-sol' },
		);
	} finally { cleanup(); }
});
