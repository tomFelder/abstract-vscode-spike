/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// "Sign in with ChatGPT" - the OpenAI OAuth (Codex-token) helper for the model proxy (plan 35 iter 2;
// doc 18 section 2.1). It implements the Codex CLI's Authorization-Code-with-PKCE flow against
// auth.openai.com and stores the resulting token bundle server-side so the user's own ChatGPT
// subscription pays for their model calls. This module is PURE PLUMBING - no HTTP server, no proxy wiring;
// scripts/lwd-model-broker.js owns the routes and calls into here. The credential lives ONLY in this
// process (decision 14): it is written to a 0600 file under ~/.abstract and is never returned to, or
// reachable by, the renderer.
//
// Credential-storage choice (logged per the plan): plan 29's credential seam is `~/.abstract/secrets.json`,
// a flat name -> value map read by the proxy to inject a Bearer header for a named API/MCP source. An OAuth
// bundle is not a single named secret - it is {access_token, refresh_token, id_token, account_id, expiry} that
// this module reads and REWRITES on every silent refresh. Overloading the shared secrets map with that
// structured, self-mutating bundle would couple two unrelated lifecycles. So the OAuth token gets its OWN
// 0600 file (~/.abstract/openai-oauth.json), exactly as the plan permits ("a 0600 file under ~/.abstract like
// the spend log"), reusing the same 0700 dir + 0600 perms discipline. The renderer never sees any of it.
//
// The founder E2E (a real ChatGPT sign-in) is DEFERRED and requires the founder at the machine - it is never
// faked here. The flow is exercised end to end against a mock upstream by pointing the two OAuth endpoints and
// the Responses endpoint at a local test server (see the env overrides below).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// --- constants (the public Codex CLI client + OpenAI's OAuth/API endpoints) -----------------------------
// These are the same public values the official Codex CLI uses for its "Sign in with ChatGPT" flow. The
// client is a PUBLIC OAuth client (PKCE, no secret), so shipping the id is expected and safe. Every endpoint
// is overridable by env so the whole flow can be driven against a local mock upstream in tests (the real
// sign-in needs the founder and is deferred - see the module header).
const CLIENT_ID = process.env.LWD_OPENAI_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = process.env.LWD_OPENAI_AUTHORIZE_URL || 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = process.env.LWD_OPENAI_TOKEN_URL || 'https://auth.openai.com/oauth/token';
// The Codex Responses backend the subscription token is entitled to call. Overridable so a mock upstream can
// stand in for it in tests.
const RESPONSES_URL = process.env.LWD_OPENAI_RESPONSES_URL || 'https://chatgpt.com/backend-api/codex/responses';
// The Codex loopback redirect. The port is fixed (1455) because it must match what the OAuth app has
// registered; overridable only so a test can pick a free port.
const REDIRECT_PORT = Number(process.env.LWD_OPENAI_REDIRECT_PORT || 1455);
const REDIRECT_PATH = '/auth/callback';
const SCOPE = 'openid profile email offline_access';
// The Codex model the subscription path serves by default (a capable frontier model). Overridable.
const OPENAI_MODEL = process.env.LWD_OPENAI_MODEL || 'gpt-5-codex';

// The models the "Sign in with ChatGPT" subscription can drive through the Codex Responses backend (issue
// #179). This is a STATIC capability list, not a live enumeration: the Codex OAuth bundle we hold
// ({access_token, refresh_token, id_token, account_id, expiry}) carries NO model-listing entitlement, and the
// Responses backend (chatgpt.com/backend-api/codex/responses) exposes no models-list route the token is scoped
// for - only the id_token's account claim, which names the billing account, not a model catalogue. So we ship
// the known Codex model family here, product-labelled (the beta's "Sol / Terra / Luna" naming in issue #179),
// mapped to the real upstream model ids the Responses call sends. `listModels()` is the seam a future live
// enumeration slots behind unchanged: when OpenAI ships a models route the OAuth token can call, it queries
// there and falls back to this list on any failure, so the picker is never empty and never 500s.
// The `default` entry MUST resolve to OPENAI_MODEL so an absent/invalid selection lands on the same model the
// backend already used before this endpoint existed (no behaviour change for a client that sends no model).
const OPENAI_MODELS = [
	{ id: OPENAI_MODEL, label: 'Sol', default: true },
	{ id: 'gpt-5', label: 'Terra', default: false },
	{ id: 'gpt-5-mini', label: 'Luna', default: false },
];

/**
 * The models the signed-in subscription can drive (issue #179). STATIC today (see OPENAI_MODELS): the Codex
 * OAuth token cannot enumerate models live, so this returns the known Codex family. Async + Promise-returning
 * deliberately, so a future live query (an OpenAI models route the OAuth token is scoped for) drops in here
 * without changing the broker's call site - it would fetch live and fall back to OPENAI_MODELS on any failure.
 * Returns a fresh array copy so a caller can never mutate the module's list.
 */
async function listModels() {
	return OPENAI_MODELS.map(m => ({ id: m.id, label: m.label, default: m.default }));
}

// The token bundle lives in its own 0600 file (see the header for why it is NOT in secrets.json).
const STORE_DIR = path.join(os.homedir(), '.abstract');
const STORE_PATH = path.join(STORE_DIR, 'openai-oauth.json');

// Refresh a little BEFORE the token actually expires so an in-flight call never races the expiry boundary.
const REFRESH_SKEW_MS = 60 * 1000;

// --- PKCE + token store ---------------------------------------------------------------------------------

function base64url(buf) {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Make one PKCE verifier/challenge pair (S256) and a CSRF state, per RFC 7636. */
function makePkce() {
	const verifier = base64url(crypto.randomBytes(32));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	const state = base64url(crypto.randomBytes(16));
	return { verifier, challenge, state };
}

function readStore() {
	try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch { return null; }
}

/** Persist the token bundle with owner-only perms (0600), creating ~/.abstract at 0700. Never the workspace. */
function writeStore(bundle) {
	fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
	fs.writeFileSync(STORE_PATH, JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
	try { fs.chmodSync(STORE_PATH, 0o600); } catch { /* best effort on platforms without chmod */ }
}

function clearStore() {
	try { fs.rmSync(STORE_PATH, { force: true }); } catch { /* already gone */ }
}

/** True once a token bundle is on disk - gates the proxy's /healthz for the openai-oauth backend. */
function isSignedIn() {
	const s = readStore();
	return !!(s && typeof s.access_token === 'string' && s.access_token.length > 0);
}

// --- JWT id_token -> ChatGPT account id ------------------------------------------------------------------
// The id_token is a JWT whose OpenAI auth claim carries the ChatGPT account id the Responses backend bills.
// We only READ the payload (never verify the signature here - the token came straight from the token
// endpoint over TLS in this same process); a malformed token just yields no account id.
function accountIdFromIdToken(idToken) {
	try {
		const parts = String(idToken || '').split('.');
		if (parts.length < 2) { return ''; }
		const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
		const authClaim = payload['https://api.openai.com/auth'] || {};
		return String(authClaim.chatgpt_account_id || authClaim.account_id || '');
	} catch {
		return '';
	}
}

// --- token endpoint calls -------------------------------------------------------------------------------

/** Shape one token bundle from a raw token-endpoint response, stamping an absolute expiry. */
function toBundle(json) {
	const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;
	return {
		access_token: json.access_token || '',
		refresh_token: json.refresh_token || '',
		id_token: json.id_token || '',
		account_id: accountIdFromIdToken(json.id_token) || (readStore() && readStore().account_id) || '',
		expires_at: Date.now() + expiresInSec * 1000,
	};
}

/** Exchange an authorization code (+ PKCE verifier) for a token bundle and persist it. */
async function exchangeCode(code, verifier, redirectUri) {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: CLIENT_ID,
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier,
	});
	const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }
	if (!res.ok || !json || !json.access_token) {
		throw new Error((json && json.error_description) || (json && json.error) || `token exchange http ${res.status}`);
	}
	const bundle = toBundle(json);
	writeStore(bundle);
	return bundle;
}

/**
 * Silent refresh: swap the stored refresh_token for a fresh access_token and persist. On success returns the
 * new bundle; on failure throws so the caller surfaces the plain-words re-auth pause (the refresh token was
 * revoked or expired - only a real sign-in recovers).
 */
async function refresh() {
	const current = readStore();
	if (!current || !current.refresh_token) { throw new Error('not signed in'); }
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: CLIENT_ID,
		refresh_token: current.refresh_token,
		scope: SCOPE,
	});
	const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }
	if (!res.ok || !json || !json.access_token) {
		throw new Error((json && json.error_description) || (json && json.error) || `token refresh http ${res.status}`);
	}
	// A refresh response may omit a new refresh_token - keep the existing one when it does.
	const bundle = toBundle(json);
	if (!bundle.refresh_token) { bundle.refresh_token = current.refresh_token; }
	if (!bundle.account_id) { bundle.account_id = current.account_id || ''; }
	writeStore(bundle);
	return bundle;
}

/**
 * Return a currently-valid access token bundle, refreshing silently first if the stored one is within the
 * skew of expiry. Throws 'not signed in' when there is no bundle at all (a caller distinguishes that from a
 * refresh failure to phrase the pause message).
 */
async function validBundle() {
	const current = readStore();
	if (!current || !current.access_token) { throw new Error('not signed in'); }
	if (typeof current.expires_at === 'number' && current.expires_at - REFRESH_SKEW_MS <= Date.now()) {
		return await refresh();
	}
	return current;
}

// --- the interactive sign-in flow (loopback PKCE) -------------------------------------------------------
// One pending sign-in at a time. `start()` spins a localhost:1455 listener that captures the OAuth callback,
// exchanges the code, and resolves. The proxy's /auth/openai/start returns the authorize URL for the founder
// to open; /auth/openai/status reports pending | signed-in | error while this listener waits.

/** @type {{ status: 'pending' | 'signed-in' | 'error'; error?: string; server?: import('http').Server }|null} */
let pending = null;

/**
 * Begin a sign-in: build the authorize URL, start the loopback listener, and return the URL for the founder
 * to open in a browser. Idempotent-ish: a second call while one is pending tears the first down first.
 */
function start() {
	stopPending();
	const { verifier, challenge, state } = makePkce();
	const redirectUri = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`;

	// Build the query manually: OpenAI's authorize endpoint requires %20 (not +) for spaces in `scope`, which
	// URLSearchParams would encode as +. Encode each value with encodeURIComponent so spaces become %20.
	const params = {
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: redirectUri,
		scope: SCOPE,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state,
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		originator: 'codex_cli_rs',
	};
	const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
	const authorizeUrl = `${AUTHORIZE_URL}?${query}`;

	const self = { status: /** @type {'pending'} */('pending'), server: undefined };
	pending = self;

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url || '/', redirectUri);
		if (!url.pathname.startsWith(REDIRECT_PATH)) {
			res.writeHead(404); res.end('not found'); return;
		}
		const code = url.searchParams.get('code');
		const returnedState = url.searchParams.get('state');
		if (!code || returnedState !== state) {
			self.status = 'error';
			self.error = 'the sign-in response did not match this request - please try again';
			res.writeHead(400, { 'content-type': 'text/html' });
			res.end('<html><body><h2>Sign-in failed</h2><p>You can close this tab and try again in Abstract.</p></body></html>');
			stopPending();
			return;
		}
		try {
			await exchangeCode(code, verifier, redirectUri);
			self.status = 'signed-in';
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end('<html><body><h2>Signed in to ChatGPT</h2><p>You can close this tab and return to Abstract.</p></body></html>');
		} catch (e) {
			self.status = 'error';
			self.error = e && e.message ? e.message : String(e);
			res.writeHead(500, { 'content-type': 'text/html' });
			res.end('<html><body><h2>Sign-in failed</h2><p>You can close this tab and try again in Abstract.</p></body></html>');
		} finally {
			stopPending();
		}
	});
	self.server = server;
	server.on('error', err => { self.status = 'error'; self.error = err && err.message ? err.message : String(err); });
	server.listen(REDIRECT_PORT, '127.0.0.1');

	return { authorizeUrl, redirectUri };
}

/** The current sign-in status for the proxy's /auth/openai/status poll. */
function status() {
	if (isSignedIn()) { return { status: 'signed-in' }; }
	if (pending) { return { status: pending.status, error: pending.error }; }
	return { status: 'signed-out' };
}

/** Tear down the loopback listener (called on completion, failure, or a fresh start). */
function stopPending() {
	if (pending && pending.server) { try { pending.server.close(); } catch { /* already closed */ } }
	pending = null;
}

/** Clean sign-out: forget the token bundle and drop any in-flight listener. */
function signOut() {
	stopPending();
	clearStore();
}

module.exports = {
	// endpoints / model (read by the proxy backend)
	RESPONSES_URL,
	OPENAI_MODEL,
	// the subscription's model catalogue for the picker (issue #179; static today, live-query seam)
	listModels,
	// lifecycle
	isSignedIn,
	validBundle,
	refresh,
	// interactive flow
	start,
	status,
	signOut,
	stopPending,
	// exposed for the parity/mock harness
	makePkce,
	exchangeCode,
	accountIdFromIdToken,
	STORE_PATH,
};
