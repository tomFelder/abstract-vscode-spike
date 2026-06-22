/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

// Localhost-only proxy that lets the Living Documents web build (served by @vscode/test-web at
// http://localhost:8080) reach the Claude Developer Platform without ever embedding a credential
// in the renderer. On each /v1/messages request it fetches a FRESH OAuth access token via
// `ant auth print-credentials --access-token` (which refreshes the token if needed), caches it for
// a short TTL, and forwards the request to api.anthropic.com with the OAuth headers. The developer
// authenticates once with `ant auth login`; the token lives only in ~/.config/anthropic and is
// never written here, logged, or sent to the browser.
//
// Run it with ./scripts/lwd-anthropic-proxy.sh (Node 24). Nothing is committed except this script.

'use strict';

const http = require('http');
const { execFile } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.LWD_PROXY_PORT || 8090);
const UPSTREAM = 'https://api.anthropic.com/v1/messages';
// Tokens are short-lived; print-credentials refreshes on demand. A small cache avoids spawning
// `ant` on every keystroke-driven call without ever holding a stale token for long.
const TOKEN_TTL_MS = 60 * 1000;
// Bound the request body so a runaway client cannot exhaust memory; model calls here are tiny.
const MAX_BODY_BYTES = 1 * 1024 * 1024;

/** @type {{ token: string; fetchedAt: number } | undefined} */
let cachedToken;

/** Resolve a fresh OAuth access token, refreshing via `ant` when the cache is cold or stale. */
function getAccessToken() {
	const now = Date.now();
	if (cachedToken && (now - cachedToken.fetchedAt) < TOKEN_TTL_MS) {
		return Promise.resolve(cachedToken.token);
	}
	return new Promise((resolve, reject) => {
		// A set ANTHROPIC_API_KEY (even empty) silently shadows the OAuth profile, so strip it from
		// the child environment. print-credentials --access-token prints the bare token and refreshes.
		const env = Object.assign({}, process.env);
		delete env.ANTHROPIC_API_KEY;
		execFile('ant', ['auth', 'print-credentials', '--access-token'], { env, timeout: 20000 }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`ant auth print-credentials failed: ${stderr ? String(stderr).trim() : err.message}`));
				return;
			}
			const token = String(stdout).trim();
			if (!token) {
				reject(new Error('ant auth print-credentials returned an empty token (is `ant auth login` done?)'));
				return;
			}
			cachedToken = { token, fetchedAt: Date.now() };
			resolve(token);
		});
	});
}

/** Standard permissive CORS for a localhost-only dev proxy (the page origin is http://localhost:8080). */
function setCors(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'content-type, anthropic-version, anthropic-beta');
	res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(body);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', chunk => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error('request body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

async function forwardMessages(req, res) {
	const body = await readBody(req);
	const token = await getAccessToken();
	// OAuth tokens go on Authorization: Bearer (NOT x-api-key) and /v1/messages requires the
	// oauth beta header; anthropic-version is always required.
	const upstream = await fetch(UPSTREAM, {
		method: 'POST',
		headers: {
			'authorization': `Bearer ${token}`,
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'oauth-2025-04-20',
			'content-type': 'application/json',
		},
		body,
	});
	const text = await upstream.text();
	setCors(res);
	res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
	res.end(text);
}

const server = http.createServer((req, res) => {
	const url = req.url || '';
	if (req.method === 'OPTIONS') {
		setCors(res);
		res.writeHead(204);
		res.end();
		return;
	}
	if (req.method === 'GET' && url.startsWith('/healthz')) {
		setCors(res);
		sendJson(res, 200, { ok: true });
		return;
	}
	if (req.method === 'POST' && url.startsWith('/v1/messages')) {
		forwardMessages(req, res).catch(err => {
			// Surface a clean error to the renderer; never echo the token or message body.
			console.error('[lwd-proxy] request failed:', err && err.message ? err.message : err);
			setCors(res);
			sendJson(res, 502, { type: 'error', error: { type: 'proxy_error', message: String(err && err.message ? err.message : err) } });
		});
		return;
	}
	setCors(res);
	sendJson(res, 404, { type: 'error', error: { type: 'not_found', message: 'unknown route' } });
});

server.listen(PORT, HOST, () => {
	console.log(`[lwd-proxy] listening on http://${HOST}:${PORT} -> ${UPSTREAM}`);
	console.log('[lwd-proxy] token source: ant auth print-credentials --access-token (run `ant auth login` first)');
});
