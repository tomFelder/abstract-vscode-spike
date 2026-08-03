/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// "Sign in with ChatGPT" - the OpenAI OAuth (Codex-token) helper for the model proxy (plan 51 WP-A;
// doc 18 section 2.1). It implements the Codex CLI's DEVICE-AUTHORIZATION flow against auth.openai.com
// and stores the resulting token bundle server-side so the user's own ChatGPT subscription pays for their
// model calls. This module is PURE PLUMBING - no HTTP server, no proxy wiring; scripts/lwd-model-broker.js
// owns the routes and calls into here. The credential lives ONLY in this process (decision 14): it is
// written to a 0600 file under ~/.abstract and is never returned to, or reachable by, the renderer.
//
// WHY the device flow (plan 51, root issue #120). OpenAI moved the subscription models behind the Codex
// device-authorization flow; the old loopback-redirect PKCE flow this module used to run can no longer
// complete against the current upstream. The wire format is the bespoke OpenAI shape documented in
// docs/plans/51-verify/upstream-notes.md (read live from github.com/openai/codex at implementation time,
// pinned commit bb5054f), NOT textbook RFC 8628: a JSON `usercode` request, a JSON `token` poll whose
// 403/404 means "still pending", and a server-minted authorization_code + PKCE pair we then exchange at
// /oauth/token. We present an RFC-8628-shaped contract to the broker (userCode / verificationUri /
// expiresIn / interval + a pending/signed-in/expired/error status), and map the real semantics onto it.
//
// Credential-storage choice (logged per plan 29): the OAuth bundle is {access_token, refresh_token,
// id_token, account_id, expires_at, granted_scopes} - structured and self-mutating on every silent
// refresh - so it gets its OWN 0600 file (~/.abstract/openai-oauth.json) rather than overloading the flat
// secrets.json map. The renderer never sees any of it.
//
// The founder E2E (a real ChatGPT sign-in) is DEFERRED and requires the founder at the machine - it is
// never faked here. Every state branch is exercised against a local stub device-auth server
// (scripts/test/lwd-device-auth-stub.js) by pointing LWD_OPENAI_AUTH_BASE at it.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- constants (the public Codex CLI client + OpenAI's device-auth/OAuth/API endpoints) -----------------
// These are the same public values the official Codex CLI uses for its "Sign in with ChatGPT" device flow
// (upstream-notes §1-§2, §8). CLIENT_ID is a PUBLIC OAuth client (PKCE, no secret), so shipping the id is
// expected and safe. The auth base is overridable via env so the whole flow runs against the local stub in
// tests; the real sign-in needs the founder and is deferred (see the header).
const CLIENT_ID = process.env.LWD_OPENAI_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
// The issuer. Every device-auth + token URL is built from it (upstream-notes §2). LWD_OPENAI_AUTH_BASE is
// the single override the broker points at scripts/test/lwd-device-auth-stub.js for automated validation.
const AUTH_BASE = (process.env.LWD_OPENAI_AUTH_BASE || 'https://auth.openai.com').replace(/\/+$/, '');
// The bespoke device-auth endpoints live under {issuer}/api/accounts (upstream-notes §3).
const DEVICEAUTH_USERCODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICEAUTH_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
// The redirect_uri the token exchange must echo for the DEVICE flow (upstream-notes §6) - not the loopback.
const DEVICEAUTH_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
// The ordinary OAuth token endpoint used for BOTH the code exchange (form-encoded) and refresh (JSON).
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
// The URL the human opens and types the user code into (upstream-notes §3b). No code-embedded variant.
const VERIFICATION_URL = `${AUTH_BASE}/codex/device`;
// The scopes bound to the session server-side; recorded in the bundle for the contract's granted-scopes.
const SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke';

// The Codex Responses backend the subscription token is entitled to call. Overridable so a mock upstream
// can stand in for it in the parity/forward tests.
const RESPONSES_URL = process.env.LWD_OPENAI_RESPONSES_URL || 'https://chatgpt.com/backend-api/codex/responses';
// The Codex model the subscription path serves by default (upstream-notes §10). Overridable. The current
// ChatGPT-sign-in Codex default is gpt-5.6-sol (OpenAI's "Power" preset at medium reasoning) - read live
// from OpenAI's Codex docs on 3 Aug 2026, NOT training data (the gpt-5-codex name is several generations
// stale). WP-D turns this into a ~/.abstract/models.json overlay so the next rename never needs a broker edit.
const OPENAI_MODEL = process.env.LWD_OPENAI_MODEL || 'gpt-5.6-sol';

// The models the "Sign in with ChatGPT" subscription can drive through the Codex Responses backend
// (upstream-notes §10). STATIC capability list, not a live enumeration: the Codex OAuth bundle carries no
// model-listing entitlement. These are the real current OpenAI Codex tiers (their slugs ARE gpt-5.6-{sol,
// terra,luna}; "Sol / Terra / Luna" are OpenAI's own tier names, matching the fork's label convention from
// issue #179). `default` MUST resolve to OPENAI_MODEL so an absent/invalid selection lands unchanged.
const OPENAI_MODELS = [
	{ id: OPENAI_MODEL, label: 'Sol', default: true },
	{ id: 'gpt-5.6-terra', label: 'Terra', default: false },
	{ id: 'gpt-5.6-luna', label: 'Luna', default: false },
];

// The device flow's 15-minute window (upstream-notes §3c/§4): the poll loop deadline and the expiresIn we
// report to the UI. The interval floor keeps us politer than a 0/absent upstream interval would.
const DEVICE_EXPIRES_IN_SEC = 15 * 60;
const MIN_INTERVAL_SEC = 5;
// slow_down back-off increment (RFC 8628 §3.5 convention; upstream-notes §4).
const SLOW_DOWN_BUMP_SEC = 5;
// Refresh a little BEFORE expiry so an in-flight call never races the boundary (upstream-notes §9: Codex
// uses a 5-minute pre-expiry window).
const REFRESH_SKEW_MS = 5 * 60 * 1000;
// Fallback bundle lifetime when the access token is opaque (no JWT `exp` to read). Conservative: the real
// Codex access token JWT always carries an exp, so this only guards a malformed/stub-opaque token.
const FALLBACK_EXPIRY_MS = 60 * 60 * 1000;

/**
 * The models the signed-in subscription can drive (issue #179). STATIC today (see OPENAI_MODELS): the Codex
 * OAuth token cannot enumerate models live, so this returns the known Codex family. Async + Promise-returning
 * deliberately, so a future live query (or WP-D's models.json overlay) drops in here without changing the
 * broker's call site. Returns a fresh array copy so a caller can never mutate the module's list.
 */
async function listModels() {
	return OPENAI_MODELS.map(m => ({ id: m.id, label: m.label, default: m.default }));
}

// The token bundle lives in its own 0600 file (see the header for why it is NOT in secrets.json). HOME is
// read via env so tests can fake it (never the founder's real ~/.abstract).
function storeDir() {
	const home = process.env.HOME || os.homedir();
	return path.join(home, '.abstract');
}
function storePath() {
	return path.join(storeDir(), 'openai-oauth.json');
}

// --- PKCE + token store ---------------------------------------------------------------------------------

function base64url(buf) {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Make one PKCE verifier/challenge pair (S256) per RFC 7636. Used only for the browser-redirect fallback;
 * the device flow's PKCE pair is minted server-side and returned on the successful poll (upstream-notes §3c). */
function makePkce() {
	const verifier = base64url(crypto.randomBytes(32));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	const state = base64url(crypto.randomBytes(16));
	return { verifier, challenge, state };
}

function readStore() {
	// A corrupt or missing bundle reads as signed-out, never a crash (acceptance floor).
	try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return null; }
}

/** Persist the token bundle with owner-only perms (0600), creating ~/.abstract at 0700. Never the workspace. */
function writeStore(bundle) {
	const dir = storeDir();
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(storePath(), JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
	try { fs.chmodSync(storePath(), 0o600); } catch { /* best effort on platforms without chmod */ }
}

function clearStore() {
	try { fs.rmSync(storePath(), { force: true }); } catch { /* already gone */ }
}

/** True once a token bundle is on disk - gates the proxy's /healthz for the openai-oauth backend. */
function isSignedIn() {
	const s = readStore();
	return !!(s && typeof s.access_token === 'string' && s.access_token.length > 0);
}

// --- JWT claims -> account id + expiry -------------------------------------------------------------------
// The id_token/access_token are JWTs. We only READ the payload (never verify the signature here - the token
// came straight from the token endpoint over TLS in this same process); a malformed token just yields no
// value. The account claim (upstream-notes §9) names the billing account the Responses backend needs.

/** Decode a JWT payload without verifying the signature. Returns {} on any malformed input. */
function decodeJwtPayload(jwt) {
	try {
		const parts = String(jwt || '').split('.');
		if (parts.length < 2) { return {}; }
		return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
	} catch {
		return {};
	}
}

function accountIdFromIdToken(idToken) {
	const payload = decodeJwtPayload(idToken);
	const authClaim = payload['https://api.openai.com/auth'] || {};
	return String(authClaim.chatgpt_account_id || authClaim.account_id || '');
}

function emailFromIdToken(idToken) {
	const payload = decodeJwtPayload(idToken);
	const authClaim = payload['https://api.openai.com/auth'] || {};
	const profile = payload['https://api.openai.com/profile'] || {};
	return String(payload.email || authClaim.email || profile.email || '');
}

/** Absolute expiry (ms) read from a token JWT's `exp` claim (upstream-notes §9), or a conservative fallback. */
function expiryFromToken(accessToken) {
	const payload = decodeJwtPayload(accessToken);
	if (typeof payload.exp === 'number' && payload.exp > 0) { return payload.exp * 1000; }
	return Date.now() + FALLBACK_EXPIRY_MS;
}

// --- token endpoint calls -------------------------------------------------------------------------------

/** Shape one token bundle from a code-exchange / refresh response, stamping absolute expiry + claims. */
function toBundle(json, previous) {
	const prev = previous || readStore() || {};
	const idToken = json.id_token || prev.id_token || '';
	const accessToken = json.access_token || '';
	return {
		access_token: accessToken,
		refresh_token: json.refresh_token || prev.refresh_token || '',
		id_token: idToken,
		account_id: accountIdFromIdToken(idToken) || prev.account_id || '',
		email: emailFromIdToken(idToken) || prev.email || '',
		expires_at: expiryFromToken(accessToken),
		granted_scopes: prev.granted_scopes || SCOPE,
	};
}

/**
 * Exchange the server-minted authorization code (+ its server-minted PKCE verifier) for a token bundle and
 * persist it (upstream-notes §6). Form-encoded, redirect_uri = {issuer}/deviceauth/callback. Throws with a
 * plain-words message (and attaches upstream status/body) on any failure so the caller can surface it.
 */
async function exchangeCode(code, verifier) {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: CLIENT_ID,
		code,
		redirect_uri: DEVICEAUTH_REDIRECT_URI,
		code_verifier: verifier,
	});
	const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }
	if (!res.ok || !json || !json.access_token) {
		const err = new Error((json && (json.error_description || json.error)) || `token exchange http ${res.status}`);
		err.upstreamStatus = res.status;
		err.upstreamBody = text.slice(0, 500);
		throw err;
	}
	const bundle = toBundle(json);
	writeStore(bundle);
	return bundle;
}

/**
 * Silent refresh (upstream-notes §7): swap the stored refresh_token for a fresh access_token and persist.
 * The refresh request is JSON (not form-encoded) and carries no scope. On success returns the new bundle;
 * on failure throws so the caller surfaces the plain-words re-auth pause (only a real sign-in recovers).
 */
async function refresh() {
	const current = readStore();
	if (!current || !current.refresh_token) { throw new Error('not signed in'); }
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: current.refresh_token }),
	});
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }
	if (!res.ok || !json || !json.access_token) {
		const err = new Error((json && (json.error_description || json.error)) || `token refresh http ${res.status}`);
		err.upstreamStatus = res.status;
		err.upstreamBody = text.slice(0, 500);
		throw err;
	}
	// A refresh response may omit a new refresh_token/id_token - toBundle keeps the existing ones.
	const bundle = toBundle(json, current);
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

// --- the interactive device sign-in flow ----------------------------------------------------------------
// One pending sign-in at a time. `start()` POSTs the usercode request, returns the user code + verification
// URL, and kicks off a background poll loop that drives the pending state to signed-in / expired / error.
// The broker's /auth/openai/start returns the code for the founder to type at {issuer}/codex/device;
// /auth/openai/status reports the live state. Re-calling start() while a flow is pending returns the SAME
// code until it expires (frozen contract: idempotent while pending).

/**
 * @typedef {Object} PendingFlow
 * @property {'pending'|'signed-in'|'expired'|'error'} state
 * @property {string} userCode
 * @property {string} verificationUri
 * @property {string=} verificationUriComplete
 * @property {number} expiresIn - seconds, as reported to the UI at start
 * @property {number} interval - seconds, current poll interval (may grow on slow_down)
 * @property {string} deviceAuthId
 * @property {number} deadline - epoch ms when the flow expires
 * @property {string=} reason
 * @property {number=} upstreamStatus
 * @property {string=} upstreamBody
 * @property {boolean} cancelled
 */

/** @type {PendingFlow|null} */
let pending = null;

/** Sleep helper for the poll loop (injectable via the exported clock for tests). */
let sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms));

/** POST the usercode request (upstream-notes §3a). Returns { deviceAuthId, userCode, interval }. */
async function requestUserCode() {
	const res = await fetch(DEVICEAUTH_USERCODE_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ client_id: CLIENT_ID }),
	});
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }
	if (!res.ok || !json) {
		const err = new Error(res.status === 404
			? 'device sign-in is not available on this server'
			: `could not start sign-in (upstream ${res.status})`);
		err.upstreamStatus = res.status;
		err.upstreamBody = text.slice(0, 500);
		throw err;
	}
	const userCode = String(json.user_code || json.usercode || '');
	const deviceAuthId = String(json.device_auth_id || '');
	// interval may arrive as a string; floor to MIN_INTERVAL_SEC (upstream-notes §4).
	const rawInterval = Number.parseInt(String(json.interval), 10);
	const interval = Number.isFinite(rawInterval) && rawInterval > 0 ? Math.max(rawInterval, MIN_INTERVAL_SEC) : MIN_INTERVAL_SEC;
	if (!userCode || !deviceAuthId) {
		const err = new Error('the sign-in server did not return a device code');
		err.upstreamBody = text.slice(0, 500);
		throw err;
	}
	return { deviceAuthId, userCode, interval, verificationUriComplete: json.verification_uri_complete ? String(json.verification_uri_complete) : undefined };
}

/**
 * One poll of the device-token endpoint (upstream-notes §3c/§5). Returns a discriminated result:
 *  - { kind: 'approved', authorizationCode, codeVerifier }
 *  - { kind: 'pending' }                          (HTTP 403/404, or JSON authorization_pending)
 *  - { kind: 'slow_down' }                        (JSON slow_down)
 *  - { kind: 'expired' }                          (JSON expired_token)
 *  - { kind: 'error', reason, upstreamStatus?, upstreamBody? }
 */
async function pollOnce(deviceAuthId, userCode) {
	let res;
	try {
		res = await fetch(DEVICEAUTH_TOKEN_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
		});
	} catch (e) {
		return { kind: 'error', reason: `could not reach the sign-in server: ${e && e.message ? e.message : e}` };
	}
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = undefined; }

	// Success: server returns the authorization code + its minted PKCE pair.
	if (res.ok) {
		if (json && json.authorization_code && json.code_verifier) {
			return { kind: 'approved', authorizationCode: String(json.authorization_code), codeVerifier: String(json.code_verifier) };
		}
		// A 200 may also carry a textbook RFC error field (stub + fallback path, upstream-notes §5).
		const rfc = json && json.error;
		if (rfc === 'authorization_pending') { return { kind: 'pending' }; }
		if (rfc === 'slow_down') { return { kind: 'slow_down' }; }
		if (rfc === 'expired_token') { return { kind: 'expired' }; }
		if (rfc === 'access_denied') { return { kind: 'error', reason: 'sign-in was denied' }; }
		return { kind: 'error', reason: 'the sign-in server returned an unexpected response', upstreamStatus: res.status, upstreamBody: text.slice(0, 500) };
	}

	// 403/404 = still pending (upstream-notes §3c). This is the real upstream's "keep polling" signal.
	if (res.status === 403 || res.status === 404) { return { kind: 'pending' }; }

	// Any other status is a hard failure.
	return {
		kind: 'error',
		reason: (json && (json.error_description || json.error)) || `sign-in failed (upstream ${res.status})`,
		upstreamStatus: res.status,
		upstreamBody: text.slice(0, 500),
	};
}

/**
 * The background poll loop. Runs until approval, expiry, error, or cancellation, mutating `flow.state` in
 * place so /auth/openai/status reports it live. Never throws to the caller - a failure becomes state 'error'.
 * @param {PendingFlow} flow
 */
async function runPollLoop(flow) {
	while (!flow.cancelled && Date.now() < flow.deadline) {
		const remaining = flow.deadline - Date.now();
		const waitMs = Math.min(flow.interval * 1000, remaining);
		await sleepImpl(waitMs);
		if (flow.cancelled || flow !== pending) { return; }
		if (Date.now() >= flow.deadline) { break; }

		const result = await pollOnce(flow.deviceAuthId, flow.userCode);
		if (flow.cancelled || flow !== pending) { return; }

		if (result.kind === 'approved') {
			try {
				await exchangeCode(result.authorizationCode, result.codeVerifier);
				flow.state = 'signed-in';
			} catch (e) {
				flow.state = 'error';
				flow.reason = e && e.message ? e.message : 'sign-in could not be completed';
				flow.upstreamStatus = e && e.upstreamStatus;
				flow.upstreamBody = e && e.upstreamBody;
			}
			return;
		}
		if (result.kind === 'slow_down') { flow.interval += SLOW_DOWN_BUMP_SEC; continue; }
		if (result.kind === 'pending') { continue; }
		if (result.kind === 'expired') { flow.state = 'expired'; flow.reason = 'the sign-in code expired before it was approved'; return; }
		// error
		flow.state = 'error';
		flow.reason = result.reason;
		flow.upstreamStatus = result.upstreamStatus;
		flow.upstreamBody = result.upstreamBody;
		return;
	}
	// Fell out of the loop on the deadline.
	if (!flow.cancelled && flow === pending && flow.state === 'pending') {
		flow.state = 'expired';
		flow.reason = 'the sign-in code expired before it was approved';
	}
}

/**
 * Begin a device sign-in. Idempotent while pending: a second call returns the SAME code until it expires
 * (frozen contract). Returns the frozen /auth/openai/start success shape. Throws on a start failure (the
 * broker maps it to the ok:false response); the thrown error carries upstreamStatus/upstreamBody when known.
 * @returns {Promise<{ userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval: number; }>}
 */
async function start() {
	// Idempotent while a flow is genuinely still pending (not yet resolved/expired).
	if (pending && pending.state === 'pending' && !pending.cancelled && Date.now() < pending.deadline) {
		return {
			userCode: pending.userCode,
			verificationUri: pending.verificationUri,
			verificationUriComplete: pending.verificationUriComplete,
			expiresIn: Math.max(0, Math.round((pending.deadline - Date.now()) / 1000)),
			interval: pending.interval,
		};
	}
	stopPending();
	const { deviceAuthId, userCode, interval, verificationUriComplete } = await requestUserCode();
	const flow = /** @type {PendingFlow} */({
		state: 'pending',
		userCode,
		verificationUri: VERIFICATION_URL,
		verificationUriComplete,
		expiresIn: DEVICE_EXPIRES_IN_SEC,
		interval,
		deviceAuthId,
		deadline: Date.now() + DEVICE_EXPIRES_IN_SEC * 1000,
		cancelled: false,
	});
	pending = flow;
	// Fire-and-forget: the loop mutates flow.state which /status reads. Never rejects.
	runPollLoop(flow).catch(e => {
		flow.state = 'error';
		flow.reason = e && e.message ? e.message : 'sign-in failed';
	});
	return {
		userCode: flow.userCode,
		verificationUri: flow.verificationUri,
		verificationUriComplete: flow.verificationUriComplete,
		expiresIn: flow.expiresIn,
		interval: flow.interval,
	};
}

/**
 * The current sign-in state for the frozen /auth/openai/status contract. A stored bundle wins (signed-in);
 * otherwise the pending flow's live state; otherwise signed-out. Never invents a state.
 * @returns {{ state: 'signed-out'|'pending'|'signed-in'|'expired'|'error'; reason?: string; email?: string; upstreamStatus?: number; upstreamBody?: string; }}
 */
function status() {
	if (isSignedIn()) {
		const s = readStore() || {};
		return { state: 'signed-in', email: s.email || undefined };
	}
	if (pending) {
		if (pending.state === 'signed-in') { return { state: 'signed-in' }; }
		const out = { state: pending.state };
		if (pending.reason) { out.reason = pending.reason; }
		if (typeof pending.upstreamStatus === 'number') { out.upstreamStatus = pending.upstreamStatus; }
		if (pending.upstreamBody) { out.upstreamBody = pending.upstreamBody; }
		return out;
	}
	return { state: 'signed-out' };
}

/** Tear down the pending flow (called on completion, failure, sign-out, or a fresh start). */
function stopPending() {
	if (pending) { pending.cancelled = true; }
	pending = null;
}

/** Clean sign-out: forget the token bundle and drop any in-flight flow. */
function signOut() {
	stopPending();
	clearStore();
}

/** Inject a sleep implementation (tests fast-forward the poll loop without real timers). Restores on null. */
function _setSleepForTest(fn) {
	sleepImpl = fn || (ms => new Promise(resolve => setTimeout(resolve, ms)));
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
	// interactive device flow
	start,
	status,
	signOut,
	stopPending,
	// exposed for the parity/stub harness + tests
	makePkce,
	exchangeCode,
	pollOnce,
	requestUserCode,
	accountIdFromIdToken,
	emailFromIdToken,
	expiryFromToken,
	get STORE_PATH() { return storePath(); },
	_setSleepForTest,
};
