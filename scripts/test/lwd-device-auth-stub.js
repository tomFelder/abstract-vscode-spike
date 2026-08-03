/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// A local STUB of OpenAI's Codex device-authorization + token endpoints (plan 51 WP-A). It speaks the exact
// wire shapes documented in docs/plans/51-verify/upstream-notes.md so validators and later waves can walk
// every state branch without a real OpenAI account. Point the broker at it with
//   LWD_OPENAI_AUTH_BASE=http://127.0.0.1:<port>
// and it serves /api/accounts/deviceauth/usercode, /api/accounts/deviceauth/token and /oauth/token.
//
// Modes (choose per-instance via the STUB_MODE env or the `mode` option):
//   'instant'        - the very first poll is approved (default).
//   'approve-after-N'- the first N polls return 403 (pending), then approved. Set STUB_APPROVE_AFTER=N.
//   'slow_down'      - the first poll returns a JSON slow_down (200), then approved.
//   'expired'        - polls always return JSON expired_token (200).
//   'error'          - the usercode request returns a 4xx (simulates upstream rejection). Set STUB_STATUS.
//   'poll-error'     - usercode succeeds but the poll returns a hard 4xx/5xx. Set STUB_STATUS.
//
// The stub mints throwaway JWTs (unsigned; the broker only decodes, never verifies) so the exchanged bundle
// carries a real `exp`, a chatgpt_account_id and an email - enough to exercise expiry + account plumbing.

'use strict';

const http = require('http');
const crypto = require('crypto');

function b64url(objOrBuf) {
	const buf = Buffer.isBuffer(objOrBuf) ? objOrBuf : Buffer.from(JSON.stringify(objOrBuf));
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint an unsigned JWT with the given payload (the broker decodes but never verifies the signature). */
function mintJwt(payload) {
	const header = b64url({ alg: 'none', typ: 'JWT' });
	const body = b64url(payload);
	return `${header}.${body}.`;
}

function readBody(req) {
	return new Promise(resolve => {
		let data = '';
		req.on('data', c => { data += c; });
		req.on('end', () => resolve(data));
	});
}

/**
 * Create (but do not start) the stub server.
 * @param {{ mode?: string; approveAfter?: number; status?: number; expiresInSec?: number; email?: string; accountId?: string; }} [opts]
 */
function createStubServer(opts = {}) {
	const mode = opts.mode || process.env.STUB_MODE || 'instant';
	const approveAfter = opts.approveAfter != null ? opts.approveAfter : Number.parseInt(process.env.STUB_APPROVE_AFTER || '2', 10);
	const errorStatus = opts.status != null ? opts.status : Number.parseInt(process.env.STUB_STATUS || '400', 10);
	const expiresInSec = opts.expiresInSec != null ? opts.expiresInSec : 3600;
	const email = opts.email || 'founder@example.com';
	const accountId = opts.accountId || 'acct_stub_123';

	// Per-device poll counters so 'approve-after-N' and 'slow_down' are deterministic across polls.
	const pollCounts = new Map();

	const server = http.createServer(async (req, res) => {
		const json = (status, obj) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(obj));
		};
		const urlPath = (req.url || '').split('?')[0];

		// 1) usercode request
		if (req.method === 'POST' && urlPath === '/api/accounts/deviceauth/usercode') {
			if (mode === 'error') {
				return json(errorStatus, { error: 'invalid_client', error_description: 'device sign-in rejected by stub' });
			}
			const deviceAuthId = crypto.randomBytes(8).toString('hex');
			pollCounts.set(deviceAuthId, 0);
			return json(200, { device_auth_id: deviceAuthId, user_code: 'WDJB-MJHT', interval: 1 });
		}

		// 2) poll for token
		if (req.method === 'POST' && urlPath === '/api/accounts/deviceauth/token') {
			const body = await readBody(req);
			let parsed;
			try { parsed = JSON.parse(body); } catch { parsed = {}; }
			const id = parsed.device_auth_id || 'unknown';
			const n = (pollCounts.get(id) || 0) + 1;
			pollCounts.set(id, n);

			if (mode === 'poll-error') {
				return json(errorStatus, { error: 'server_error', error_description: 'the sign-in server failed' });
			}
			if (mode === 'expired') {
				// Signal via the textbook JSON error on a 200 (upstream-notes §5 fallback branch).
				return json(200, { error: 'expired_token' });
			}
			if (mode === 'slow_down' && n === 1) {
				return json(200, { error: 'slow_down' });
			}
			if (mode === 'approve-after-N' && n <= approveAfter) {
				// The real upstream signals "keep polling" with a 403.
				res.writeHead(403, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: 'authorization_pending' }));
				return;
			}
			// Approved: mint a server-side PKCE pair + authorization code (the broker uses code_verifier for
			// the exchange, exactly as the real deviceauth/token success response does).
			const codeVerifier = crypto.randomBytes(32).toString('hex');
			const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
			return json(200, {
				authorization_code: 'stub-auth-code-' + crypto.randomBytes(6).toString('hex'),
				code_verifier: codeVerifier,
				code_challenge: codeChallenge,
			});
		}

		// 3) token exchange (authorization_code) AND refresh (refresh_token) share /oauth/token.
		if (req.method === 'POST' && urlPath === '/oauth/token') {
			const body = await readBody(req);
			const isJson = (req.headers['content-type'] || '').includes('application/json');
			const params = isJson ? safeJson(body) : Object.fromEntries(new URLSearchParams(body));
			const grant = params.grant_type;
			const idToken = mintJwt({
				exp: Math.floor(Date.now() / 1000) + expiresInSec,
				email,
				'https://api.openai.com/auth': { chatgpt_account_id: accountId, email },
			});
			// A unique `jti` per mint so a refresh yields a genuinely different access token even when the
			// `exp` second collides (the real endpoint always returns a fresh token on refresh).
			const accessToken = mintJwt({ exp: Math.floor(Date.now() / 1000) + expiresInSec, scope: 'openid profile email', jti: crypto.randomBytes(8).toString('hex') });
			if (grant === 'authorization_code') {
				return json(200, { id_token: idToken, access_token: accessToken, refresh_token: 'stub-refresh-' + crypto.randomBytes(6).toString('hex') });
			}
			if (grant === 'refresh_token') {
				// A refresh may omit the refresh_token (the broker keeps the old one).
				return json(200, { id_token: idToken, access_token: accessToken });
			}
			return json(400, { error: 'unsupported_grant_type' });
		}

		res.writeHead(404, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'not_found', path: urlPath }));
	});

	return server;
}

function safeJson(s) {
	try { return JSON.parse(s); } catch { return {}; }
}

module.exports = { createStubServer, mintJwt };

// Standalone: `node scripts/test/lwd-device-auth-stub.js [port]` (mode via STUB_MODE env).
if (require.main === module) {
	const port = Number.parseInt(process.argv[2] || '', 10) || 0;
	const server = createStubServer();
	server.listen(port, '127.0.0.1', () => {
		const addr = server.address();
		const actual = typeof addr === 'object' && addr ? addr.port : port;
		// eslint-disable-next-line no-console
		console.log(`[device-auth-stub] mode=${process.env.STUB_MODE || 'instant'} listening on http://127.0.0.1:${actual}`);
	});
}
