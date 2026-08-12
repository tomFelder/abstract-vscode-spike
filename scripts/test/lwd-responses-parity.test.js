/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Golden-transcript parity for the Anthropic -> Codex Responses mapping (plan 51 §3 box 6).
//
// WHY THIS SUITE EXISTS. The pre-#120 parity test asserted against a mock somebody invented, and every
// automated box in the plan 51 wave passed while NO real call could ever have succeeded: the stub honoured a
// request shape the real Codex backend rejects outright. The 12 Aug founder smoke put a real subscription on
// the wire and found four separate 400s -
//   - no `store` field         -> {"detail":"Store must be set to false"}
//   - `stream:false`           -> {"detail":"Stream must be set to true"}
//   - any `max_output_tokens`  -> {"detail":"Unsupported parameter: max_output_tokens"}
//   - model `gpt-5.6-sol`      -> {"detail":"The 'gpt-5.6-sol' model is not supported when using Codex ..."}
// So the fixtures here are RECORDED, not invented: `fixtures/codex-responses-stream.sse` is the byte stream a
// real `gpt-5.6-terra` call returned (identifiers scrubbed, structure untouched) and
// `fixtures/codex-responses-model-refused.json` is the real refusal body. A stub upstream replays them, so
// this suite fails the moment the broker drifts back to a shape the real backend would reject.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const BROKER_SCRIPT = path.join(__dirname, '..', 'lwd-model-broker.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const REAL_STREAM = fs.readFileSync(path.join(FIXTURES, 'codex-responses-stream.sse'), 'utf8');
const REAL_REFUSAL = fs.readFileSync(path.join(FIXTURES, 'codex-responses-model-refused.json'), 'utf8');
const PROMPT = { max_tokens: 64, messages: [{ role: 'user', content: 'Reply with exactly: ABSTRACT SMOKE OK' }] };

/** A fake HOME holding a valid-looking bundle, so the broker selects the openai-oauth door. */
function mkHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lwd-parity-home-'));
	fs.mkdirSync(path.join(home, '.abstract'), { recursive: true });
	const exp = Math.floor((Date.now() + 3600_000) / 1000);
	const jwt = ['e30', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'sig'].join('.');
	fs.writeFileSync(path.join(home, '.abstract', 'openai-oauth.json'), JSON.stringify({
		access_token: jwt, refresh_token: 'r', id_token: 'i', account_id: 'acct-parity',
		expires_at: Date.now() + 3600_000, granted_scopes: 'openid profile email',
	}), { mode: 0o600 });
	return home;
}

/** Replay the recorded transcript (or the recorded refusal) and capture what the broker actually sent. */
async function startUpstream(behaviour) {
	const sent = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', c => { body += c; });
		req.on('end', () => {
			let parsed; try { parsed = JSON.parse(body); } catch { parsed = { unparseable: body }; }
			sent.push(parsed);
			behaviour(parsed, res);
		});
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return { server, sent, base: `http://127.0.0.1:${server.address().port}/responses` };
}

function replayRecorded(_req, res) {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.end(REAL_STREAM);
}

function startBroker(cfg) {
	const env = Object.assign({}, process.env, {
		HOME: cfg.home,
		LWD_PROXY_HOST: '127.0.0.1',
		LWD_PROXY_PORT: String(cfg.port),
		LWD_OPENAI_RESPONSES_URL: cfg.responsesUrl,
		OPENROUTER_URL: 'http://127.0.0.1:1/none',
		LWD_ENTITLEMENT_PROBE: cfg.entitlementProbe ? '1' : '0',
	});
	delete env.LWD_BACKEND;
	delete env.OPENROUTER_API_KEY;
	delete env.OPENROUTER_API_KEY_FILE;
	const child = spawn(process.execPath, [BROKER_SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	let out = '';
	child.stdout.on('data', c => { out += c.toString(); });
	child.stderr.on('data', c => { out += c.toString(); });
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`broker did not start: ${out}`)), 10_000);
		const tick = setInterval(() => {
			if (/listening on/.test(out)) { clearInterval(tick); clearTimeout(timer); resolve(); }
		}, 25);
	});
	return { child, ready, log: () => out };
}

function killBroker(child) {
	return new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });
}

function post(port, body, { stream = false } = {}) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body);
		const req = http.request({
			host: '127.0.0.1', port, path: '/v1/messages', method: 'POST',
			headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
		}, res => {
			let text = '';
			res.on('data', c => { text += c; });
			res.on('end', () => {
				let json; try { json = stream ? undefined : JSON.parse(text); } catch { json = undefined; }
				resolve({ status: res.statusCode, text, json });
			});
		});
		req.on('error', reject);
		req.end(payload);
	});
}

async function withBroker(cfg, run) {
	const home = mkHome();
	const upstream = await startUpstream(cfg.behaviour);
	const port = 8700 + Math.floor(Math.random() * 200);
	const broker = startBroker({ home, port, responsesUrl: upstream.base, entitlementProbe: cfg.entitlementProbe });
	try {
		await broker.ready;
		return await run({ port, upstream, broker });
	} finally {
		await killBroker(broker.child);
		upstream.server.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
}

test('the request the broker sends is the shape the REAL backend accepts (store:false, stream:true, no max_output_tokens)', async () => {
	await withBroker({ behaviour: replayRecorded }, async ({ port, upstream }) => {
		await post(port, Object.assign({ model: 'gpt-5.6-terra' }, PROMPT));
		const sent = upstream.sent[0];
		assert.deepStrictEqual({
			store: sent.store,
			stream: sent.stream,
			hasMaxOutputTokens: Object.prototype.hasOwnProperty.call(sent, 'max_output_tokens'),
			model: sent.model,
			input: sent.input,
		}, {
			// Each of these was a separate 400 from the real backend before the founder smoke fixed it.
			store: false,
			stream: true,
			hasMaxOutputTokens: false,
			model: 'gpt-5.6-terra',
			input: [{ role: 'user', content: [{ type: 'input_text', text: 'Reply with exactly: ABSTRACT SMOKE OK' }] }],
		});
	});
});

test('a system prompt maps to `instructions`, and an assistant turn keeps its output_text part type', async () => {
	await withBroker({ behaviour: replayRecorded }, async ({ port, upstream }) => {
		await post(port, {
			model: 'gpt-5.6-terra', max_tokens: 64, system: 'Be terse.',
			messages: [
				{ role: 'user', content: 'first' },
				{ role: 'assistant', content: 'second' },
				{ role: 'user', content: 'third' },
			],
		});
		const sent = upstream.sent[0];
		assert.deepStrictEqual({ instructions: sent.instructions, input: sent.input }, {
			instructions: 'Be terse.',
			input: [
				{ role: 'user', content: [{ type: 'input_text', text: 'first' }] },
				{ role: 'assistant', content: [{ type: 'output_text', text: 'second' }] },
				{ role: 'user', content: [{ type: 'input_text', text: 'third' }] },
			],
		});
	});
});

test('the RECORDED transcript buffers into one Anthropic message (no output_text convenience field upstream)', async () => {
	await withBroker({ behaviour: replayRecorded }, async ({ port }) => {
		const res = await post(port, Object.assign({ model: 'gpt-5.6-terra' }, PROMPT));
		assert.deepStrictEqual({
			status: res.status,
			type: res.json.type,
			role: res.json.role,
			model: res.json.model,
			stop_reason: res.json.stop_reason,
			content: res.json.content,
		}, {
			status: 200,
			type: 'message',
			role: 'assistant',
			model: 'gpt-5.6-terra',
			stop_reason: 'end_turn',
			// Assembled from the recorded output_text deltas - the real `response.completed` carries NO
			// top-level `output_text`, which is exactly why the delta path has to be the one that works.
			content: [{ type: 'text', text: 'ABSTRACT SMOKE OK' }],
		});
	});
});

test('the RECORDED transcript streams as Anthropic content_block_delta events and ends with message_stop', async () => {
	await withBroker({ behaviour: replayRecorded }, async ({ port }) => {
		const res = await post(port, Object.assign({ model: 'gpt-5.6-terra', stream: true }, PROMPT), { stream: true });
		const events = res.text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5).trim()));
		assert.deepStrictEqual({
			status: res.status,
			deltas: events.filter(e => e.type === 'content_block_delta').map(e => e.delta.text),
			last: events[events.length - 1].type,
		}, {
			status: 200,
			deltas: ['AB', 'STRACT', ' SM', 'OKE', ' OK'],
			last: 'message_stop',
		});
	});
});

test('the RECORDED model refusal reaches the client in plain words and demotes the model in the catalogue', async () => {
	const refuseSol = (parsed, res) => {
		if (parsed.model === 'gpt-5.6-sol') {
			res.writeHead(400, { 'content-type': 'application/json' });
			res.end(REAL_REFUSAL);
			return;
		}
		replayRecorded(parsed, res);
	};
	await withBroker({ behaviour: refuseSol }, async ({ port }) => {
		// Asking for the refused model directly: the client gets upstream's own words, never "openai http 400".
		const refused = await post(port, Object.assign({ model: 'gpt-5.6-sol' }, PROMPT));
		// Having learnt the refusal, the catalogue stops offering it and the next default-resolved call serves.
		const models = await new Promise(resolve => {
			http.get({ host: '127.0.0.1', port, path: '/models' }, res => {
				let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve(JSON.parse(t)));
			});
		});
		const sol = models.models.find(m => m.id === 'gpt-5.6-sol');
		const served = await post(port, Object.assign({}, PROMPT));
		assert.deepStrictEqual({
			refusedStatus: refused.status,
			refusedMessage: refused.json.error.message,
			solEntitled: sol.entitled,
			solAvailable: sol.available,
			solIsDefault: sol.default,
			defaultId: models.models.find(m => m.backend === 'openai-oauth' && m.default).id,
			servedText: served.json.content[0].text,
		}, {
			refusedStatus: 502,
			refusedMessage: "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.",
			solEntitled: false,
			solAvailable: false,
			solIsDefault: false,
			defaultId: 'gpt-5.6-terra',
			servedText: 'ABSTRACT SMOKE OK',
		});
	});
});

test('the startup entitlement probe records only DEFINITIVE verdicts - an unreachable probe never demotes a model', async () => {
	// Sol is definitively refused; terra is accepted; luna 500s (inconclusive - our own failure, not a verdict).
	const mixed = (parsed, res) => {
		if (parsed.model === 'gpt-5.6-sol') {
			res.writeHead(400, { 'content-type': 'application/json' });
			res.end(REAL_REFUSAL);
		} else if (parsed.model === 'gpt-5.6-luna') {
			res.writeHead(500, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: { message: 'upstream is down' } }));
		} else {
			replayRecorded(parsed, res);
		}
	};
	await withBroker({ behaviour: mixed, entitlementProbe: true }, async ({ port, broker }) => {
		// The probe is fired, not awaited, so give it a moment to settle before reading the catalogue.
		const deadline = Date.now() + 8000;
		let models;
		while (Date.now() < deadline) {
			models = await new Promise(resolve => {
				http.get({ host: '127.0.0.1', port, path: '/models' }, res => {
					let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve(JSON.parse(t)));
				});
			});
			if (models.models.some(m => m.entitled === false)) { break; }
			await new Promise(r => setTimeout(r, 100));
		}
		const byId = id => models.models.find(m => m.id === id);
		assert.deepStrictEqual({
			sol: byId('gpt-5.6-sol').entitled,
			terra: byId('gpt-5.6-terra').entitled,
			luna: byId('gpt-5.6-luna').entitled,
			lunaStillAvailable: byId('gpt-5.6-luna').available,
			logNamesTheRefusal: /refused: gpt-5\.6-sol/.test(broker.log()),
		}, {
			sol: false,
			terra: true,
			// A 5xx tells us nothing about entitlement, so luna stays unverified AND stays offered.
			luna: null,
			lunaStillAvailable: true,
			logNamesTheRefusal: true,
		});
	});
});
