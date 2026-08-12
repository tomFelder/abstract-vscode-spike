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

// --- catalogue-as-data: the ~/.abstract/models.json overlay (plan 51 WP-D) ------------------------------
// Model ids are DATA, not code (plan 51 WP-D): a config file at ~/.abstract/models.json overlays the built-in
// gpt-5.6 defaults so the next OpenAI rename (as the 5.4->5.6 migration showed they do) never needs a broker
// edit. There is NO live-list path for the ChatGPT-sign-in door: the Codex OAuth token carries no
// model-listing entitlement (upstream-notes §10 - the Responses backend exposes no models route the token is
// scoped for), so the overlay is the intended fix path, not a wire enumeration. Where a token ever DID permit
// a live listing, that query would slot in ahead of the overlay inside listModels(); today it does not exist,
// so the static list + overlay is the whole story and this comment is the honest record of why.
//
// Documented config shape (also in docs/plans/51-verify/upstream-notes.md §catalogue):
//   {
//     "openai-oauth": {
//       "default": "gpt-5.6-terra",                       // optional: which id is the default (must be in the list)
//       "models": [                                         // optional: the full replacement/extension list
//         { "id": "gpt-5.6-sol",   "label": "Sol" },
//         { "id": "gpt-5.7-nova",  "label": "Nova" }        // a NEW id ships with zero broker edits
//       ]
//     }
//   }
// Merge semantics (deliberately simple + predictable):
//   - `models` REPLACES the built-in list when present and non-empty (so an operator can drop a retired id),
//     else the built-ins stand. Each entry needs a string `id`; a missing/blank label falls back to the id.
//   - `default` names the default id; if it names an id that IS in the effective list, that entry becomes the
//     sole default, else the effective list's own default (or its first entry) is kept - never zero defaults.
//   - A bogus file (unparseable, wrong-typed, or empty) degrades HONESTLY: it logs once and the built-ins
//     stand. It NEVER crashes and NEVER empties the picker.
function modelsConfigPath() {
	return path.join(storeDir(), 'models.json');
}

// Log a bogus-config warning at most once per distinct message, so a persistently malformed file does not spam
// the broker log on every /models poll (listModels runs per merged-catalogue request).
let _lastConfigWarning = '';
function warnBadModelsConfig(message) {
	if (message === _lastConfigWarning) { return; }
	_lastConfigWarning = message;
	// eslint-disable-next-line no-console
	console.error(`[lwd-oauth] ${message}; using the built-in model catalogue`);
}

/**
 * Read + validate the openai-oauth slice of ~/.abstract/models.json. Returns the operator overlay, or null
 * when there is no (valid) config. Never throws: a missing file is silent; a malformed one logs once and
 * yields null so the caller keeps the built-in defaults.
 * @returns {{ models?: {id: string; label: string}[]; default?: string } | null}
 */
function readModelsConfig() {
	let raw;
	try { raw = fs.readFileSync(modelsConfigPath(), 'utf8'); }
	catch { return null; } // no file -> silently use the built-ins (the common, non-error case)
	let parsed;
	try { parsed = JSON.parse(raw); }
	catch { warnBadModelsConfig('models.json is not valid JSON'); return null; }
	if (!parsed || typeof parsed !== 'object') { warnBadModelsConfig('models.json is not a JSON object'); return null; }
	const slice = parsed['openai-oauth'];
	if (slice === undefined) { return null; } // a config with no openai-oauth slice -> built-ins, no warning
	if (!slice || typeof slice !== 'object') { warnBadModelsConfig('models.json "openai-oauth" is not an object'); return null; }
	const out = {};
	if (slice.models !== undefined) {
		if (!Array.isArray(slice.models)) { warnBadModelsConfig('models.json "openai-oauth.models" is not an array'); return null; }
		const models = [];
		for (const m of slice.models) {
			if (!m || typeof m.id !== 'string' || !m.id) { continue; } // skip a malformed entry, keep the rest
			models.push({ id: m.id, label: (typeof m.label === 'string' && m.label) ? m.label : m.id });
		}
		// An array that parsed but yielded no usable entry is treated as "no override" so the picker never empties.
		if (models.length) { out.models = models; }
		else { warnBadModelsConfig('models.json "openai-oauth.models" had no usable entries'); }
	}
	if (typeof slice.default === 'string' && slice.default) { out.default = slice.default; }
	return (out.models || out.default) ? out : null;
}

// --- entitlement: what THIS subscription may actually call (plan 51 founder smoke, 12 Aug 2026) ---------
// The catalogue above answers "which ids exist"; it cannot answer "which ids may this account call". The
// 12 Aug founder smoke proved the gap is real and load-bearing: OpenAI's Codex docs name `gpt-5.6-sol` the
// default, but the Codex Responses backend rejects it outright for a ChatGPT-account token -
//   HTTP 400 {"detail":"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}
// - while `gpt-5.6-terra` and `gpt-5.6-luna` serve normally. A catalogue that advertises sol as available is
// a catalogue that lies, which the wave's UX bar forbids. So entitlement is established at the WIRE and
// cached, never inferred from docs.
//
// Three rules keep this honest:
//   1. Only a DEFINITIVE upstream rejection marks a model unentitled. A network failure, a 5xx, or a
//      not-signed-in state leaves the verdict `null` (= unverified) - we never downgrade a model because our
//      own probe could not reach upstream.
//   2. The probe aborts the moment upstream accepts the stream, so proving entitlement costs an input token
//      and never a completion.
//   3. A live serve that hits the same rejection calls markUnentitled(), so the catalogue self-heals against
//      drift between probe refreshes without waiting for the TTL.
const ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000;

function entitlementPath() {
	return path.join(storeDir(), 'models-entitlement.json');
}

/** The whole on-disk entitlement cache, or an empty object. Never throws. */
function readEntitlementCache() {
	try {
		const parsed = JSON.parse(fs.readFileSync(entitlementPath(), 'utf8'));
		return (parsed && typeof parsed === 'object') ? parsed : {};
	} catch { return {}; }
}

/** The cache slice for the signed-in account (entitlement is per-account, so switching accounts re-probes). */
function entitlementSlice() {
	let accountId = '';
	try { accountId = (readStore() || {}).account_id || ''; } catch { /* signed out -> the anonymous slice */ }
	const cache = readEntitlementCache();
	const slice = cache[accountId || 'anonymous'];
	return (slice && typeof slice === 'object' && slice.models && typeof slice.models === 'object') ? slice : null;
}

function writeEntitlementSlice(models) {
	let accountId = '';
	try { accountId = (readStore() || {}).account_id || ''; } catch { /* keep the anonymous slice */ }
	const cache = readEntitlementCache();
	cache[accountId || 'anonymous'] = { checkedAt: Date.now(), models };
	try {
		fs.mkdirSync(storeDir(), { recursive: true });
		fs.writeFileSync(entitlementPath(), JSON.stringify(cache, null, 2), { mode: 0o600 });
	} catch { /* a cache we cannot persist is a cache we re-probe next start - never fatal */ }
}

/**
 * The subscription bearer + Codex headers. Lives here because this module owns the bundle and the refresh;
 * the broker's openAiAuthHeaders() delegates so the header shape exists exactly once.
 */
async function authHeaders() {
	const bundle = await validBundle();
	const headers = {
		'authorization': `Bearer ${bundle.access_token}`,
		'content-type': 'application/json',
		'originator': 'codex_cli_rs',
		'OpenAI-Beta': 'responses=v1',
	};
	if (bundle.account_id) { headers['chatgpt-account-id'] = bundle.account_id; }
	return headers;
}

/**
 * Ask upstream whether this account may call `modelId`, at the wire. Resolves `{ entitled, reason }` where
 * `entitled` is true (upstream opened the stream), false (upstream definitively refused the model), or null
 * (we could not tell - never cached as a refusal).
 */
async function probeModelEntitlement(modelId) {
	let headers;
	try { headers = await authHeaders(); }
	catch { return { entitled: null, reason: 'not signed in' }; }
	const controller = new AbortController();
	let res;
	try {
		res = await fetch(RESPONSES_URL, {
			method: 'POST',
			headers: Object.assign({}, headers, { 'accept': 'text/event-stream' }),
			// The minimum request this backend accepts (founder smoke): `store:false` and `stream:true` are
			// mandatory and `max_output_tokens` is refused outright - see toResponsesRequest in the broker.
			body: JSON.stringify({
				model: modelId,
				input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
				store: false,
				stream: true,
			}),
			signal: controller.signal,
		});
	} catch (e) {
		return { entitled: null, reason: `probe could not reach upstream: ${(e && e.message) || e}` };
	}
	if (res.ok) {
		// Upstream accepted: entitlement is proven. Abort before the model generates a completion (rule 2).
		try { controller.abort(); } catch { /* the stream is already ours to drop */ }
		return { entitled: true };
	}
	const body = await res.text().catch(() => '');
	let detail = '';
	try { const j = JSON.parse(body); detail = (j && (j.detail || (j.error && j.error.message))) || ''; } catch { /* keep the raw body */ }
	// A 4xx naming the model is a real refusal; anything else (5xx, auth, gateway) is inconclusive (rule 1).
	const definitive = res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403;
	return definitive
		? { entitled: false, reason: detail || `upstream ${res.status}` }
		: { entitled: null, reason: detail || `upstream ${res.status}` };
}

/**
 * Probe every id in the effective catalogue and cache the verdicts. Fired (not awaited) at broker start so
 * the picker tells the truth without blocking the cold-start floor plan 51 §3 box 1 proved (~0.5s to healthy).
 */
async function refreshEntitlements() {
	if (!canServe()) { return null; }
	const models = await listModels({ entitlement: false });
	const verdicts = {};
	for (const m of models) {
		const { entitled, reason } = await probeModelEntitlement(m.id);
		// Only record a decided verdict; an inconclusive probe leaves the id unverified rather than guessing.
		if (entitled === true) { verdicts[m.id] = { entitled: true }; }
		else if (entitled === false) { verdicts[m.id] = { entitled: false, reason }; }
	}
	if (Object.keys(verdicts).length) { writeEntitlementSlice(verdicts); }
	return verdicts;
}

/**
 * Record a definitive upstream refusal seen during a real serve, so the catalogue self-heals immediately
 * rather than waiting for the next probe refresh (rule 3).
 */
function markUnentitled(modelId, reason) {
	if (typeof modelId !== 'string' || !modelId) { return; }
	const slice = entitlementSlice();
	const models = Object.assign({}, slice ? slice.models : {});
	models[modelId] = { entitled: false, reason: reason || 'upstream refused this model' };
	writeEntitlementSlice(models);
}

/** True when the cached verdicts are missing or older than the TTL, i.e. a refresh is due. */
function entitlementStale() {
	const slice = entitlementSlice();
	return !slice || typeof slice.checkedAt !== 'number' || (Date.now() - slice.checkedAt) > ENTITLEMENT_TTL_MS;
}

/**
 * The models the signed-in subscription can drive (issue #179), as DATA (plan 51 WP-D). Starts from the
 * built-in gpt-5.6 Codex family (OPENAI_MODELS) and overlays ~/.abstract/models.json when present + valid, so
 * a new/renamed id never needs a broker edit. There is no live-list query for this door (see the overlay
 * comment above / upstream-notes §10); this method stays async + Promise-returning so a future live source
 * drops in here without changing the broker's call site. Returns fresh objects so a caller can never mutate
 * the module's list.
 *
 * Each entry carries its wire-established `entitled` verdict (true / false / null = unverified) from the
 * entitlement cache above. Exactly one entry carries `default:true`, and the default is only ever placed on a
 * model this account is NOT known to be refused - a default the subscription cannot call is the exact lie the
 * 12 Aug founder smoke caught.
 * @param {{ entitlement?: boolean }} [opts] - pass `{ entitlement: false }` to read the raw catalogue without
 * folding verdicts in (used by refreshEntitlements, which is the thing that produces them).
 */
async function listModels(opts) {
	const config = readModelsConfig();
	const base = (config && config.models)
		? config.models.map(m => ({ id: m.id, label: m.label, default: false }))
		: OPENAI_MODELS.map(m => ({ id: m.id, label: m.label, default: m.default }));
	if (opts && opts.entitlement === false) {
		return base.map(m => ({ id: m.id, label: m.label, default: m.default === true }));
	}
	const cached = entitlementSlice();
	const verdicts = cached ? cached.models : {};
	const withEntitlement = base.map(m => {
		const v = verdicts[m.id];
		const entitled = (v && typeof v.entitled === 'boolean') ? v.entitled : null;
		const entry = { id: m.id, label: m.label, default: m.default === true, entitled };
		if (entitled === false && v.reason) { entry.reason = v.reason; }
		return entry;
	});
	// Resolve the single default: an operator-named default that IS in the effective list wins; otherwise keep
	// the list's own default (from the built-ins) or fall back to its first entry - never leave zero defaults.
	// A refused model is skipped at every step, so the default lands on something callable whenever one exists.
	const callable = m => m.entitled !== false;
	const named = config && config.default && withEntitlement.some(m => m.id === config.default && callable(m))
		? config.default
		: undefined;
	let defaulted = false;
	const withDefault = withEntitlement.map(m => {
		const isDefault = named ? m.id === named : (m.default === true && callable(m) && !defaulted);
		if (isDefault) { defaulted = true; }
		return Object.assign({}, m, { default: isDefault });
	});
	if (!defaulted) {
		// The declared default is refused (or there was none): promote the first callable entry instead. If
		// every entry is refused there is nothing honest to promote, so the list goes out with no default and
		// the caller's own fallback decides - it must not silently pick a model upstream will reject.
		const first = withDefault.find(callable);
		if (first) { first.default = true; }
	}
	return withDefault;
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

/**
 * Whether the openai-oauth backend can serve THIS request, decided from the on-disk bundle alone (no network).
 * This is the single source of truth for the broker's per-request backend selection (plan 51 WP-C, #120): the
 * broker prefers openai-oauth whenever this returns true, else falls back to openrouter. "Can serve" means a
 * bundle exists AND is either unexpired OR refreshable (it carries a refresh_token) - an expired-but-refreshable
 * bundle still counts, because the forward path's validBundle() will transparently refresh it before the call.
 * A bundle that is expired with no refresh_token is NOT servable and demotes to the fallback. Selection stays
 * synchronous and side-effect-free (the actual refresh happens later, inside the forward); this only reads the
 * bundle the module already owns, so bundle parsing lives in exactly one place.
 * @returns {boolean}
 */
function canServe() {
	return bundleHealth().canServe;
}

/**
 * Structured availability of the openai-oauth door, for /healthz + the /models merge. Reports the truthful
 * state from the bundle without ever making a network call. `state` is a plain-words summary the UI can key
 * off; `canServe` is the boolean the broker's selection uses.
 * @returns {{ signedIn: boolean; canServe: boolean; expired: boolean; refreshable: boolean; state: 'signed-out'|'valid'|'expired-refreshable'|'expired-stuck'; email?: string; }}
 */
function bundleHealth() {
	const s = readStore();
	const hasAccess = !!(s && typeof s.access_token === 'string' && s.access_token.length > 0);
	if (!hasAccess) {
		return { signedIn: false, canServe: false, expired: false, refreshable: false, state: 'signed-out' };
	}
	const refreshable = typeof s.refresh_token === 'string' && s.refresh_token.length > 0;
	// Treat "within the refresh skew of expiry" as expired for selection: the forward would refresh it anyway,
	// and a bundle that close to the boundary is not safely servable without one. A bundle with no numeric
	// expiry (opaque token) is treated as unexpired - only a real, past `exp` demotes it.
	const expired = typeof s.expires_at === 'number' && s.expires_at - REFRESH_SKEW_MS <= Date.now();
	const canServeNow = !expired || refreshable;
	let state;
	if (!expired) { state = 'valid'; }
	else if (refreshable) { state = 'expired-refreshable'; }
	else { state = 'expired-stuck'; }
	return { signedIn: true, canServe: canServeNow, expired, refreshable, state, email: (s && s.email) || undefined };
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
	// the subscription's model catalogue for the picker (issue #179; overlaid by models.json, plan 51 WP-D)
	listModels,
	readModelsConfig,
	// entitlement: which catalogue ids THIS account may actually call, established at the wire
	authHeaders,
	probeModelEntitlement,
	refreshEntitlements,
	markUnentitled,
	entitlementStale,
	get ENTITLEMENT_PATH() { return entitlementPath(); },
	// lifecycle
	isSignedIn,
	canServe,
	bundleHealth,
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
	get MODELS_CONFIG_PATH() { return modelsConfigPath(); },
	_setSleepForTest,
};
