/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Golden-transcript parity for the Anthropic -> Codex Responses mapping (plan 51 section 3 box 6).
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
//
// TOOL PASSTHROUGH (plan 55 B2). The suite now also pins a complete tool round trip on BOTH doors: an
// Anthropic-shape request with `tools` goes out, each door's own dialect is asserted on the wire, a scripted
// upstream answers with a tool call, the client is asserted to receive Anthropic `tool_use` events, and the
// `tool_result` it sends back is asserted on the wire again. Malformed arguments and a mid-stream abort are
// part of that contract, not an afterthought - both must end as a structured error or a well-formed degraded
// event, never a crash or a truncated stream.
//
// HONESTY NOTE ON THE TOOL FIXTURES. Unlike the text transcript above, the tool-call fixtures are NOT recorded
// from a live subscription (the founder's Codex account has never been driven with tools, and no OpenRouter
// key is available to this suite). They are written against each provider's documented event vocabulary,
// wrapped in the SAME envelope the recorded transcript uses, so the structure around them is real even where
// the function-call items are constructed. They must be re-recorded at the next founder smoke - tracked as an
// issue on the PR that added them - exactly because inventing a mock is the failure mode this suite exists to
// prevent.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const BROKER_SCRIPT = path.join(__dirname, '..', 'lwd-model-broker.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const readFixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const REAL_STREAM = readFixture('codex-responses-stream.sse');
const REAL_REFUSAL = readFixture('codex-responses-model-refused.json');
const CODEX_TOOL_STREAM = readFixture('codex-responses-tool-call-stream.sse');
const CODEX_TOOL_MALFORMED = readFixture('codex-responses-tool-args-malformed.sse');
const OR_TOOL_CALL = readFixture('openrouter-tool-call.json');
const OR_TOOL_STREAM = readFixture('openrouter-tool-call-stream.sse');
const OR_TOOL_MALFORMED = readFixture('openrouter-tool-args-malformed.json');
const OR_TOOL_MALFORMED_STREAM = readFixture('openrouter-tool-args-malformed-stream.sse');
const PROMPT = { max_tokens: 64, messages: [{ role: 'user', content: 'Reply with exactly: ABSTRACT SMOKE OK' }] };

// The one tool definition every tool case drives, in the Anthropic shape the client speaks.
const READ_DOCUMENT_TOOL = {
	name: 'read_document',
	description: 'Read one document',
	input_schema: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] },
};

// The port band this suite owns. `LWD_PROXY_PORT` is fixed at spawn, so a collision kills the child rather
// than being something Node retries around - an overlapping band is a flake generator. Every other broker
// suite sits between 8150 and 8990 (lwd-openrouter-models at 8150+, lwd-backend-selection and
// lwd-catalogue-fallback across 8300-8990), so this one moves clear of all of them and still retries on a
// fresh port when it loses the race to something outside the repo.
const PORT_BAND_START = 9100;
const PORT_BAND_SIZE = 90;
const PORT_ATTEMPTS = 5;

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

/**
 * Replay a scripted transcript and capture what the broker actually sent. ONE stub serves both doors - the
 * broker is told a different URL per door but the handler only ever sees "a POST with a JSON body", which is
 * what makes a per-door assertion on `sent` an assertion about translation and nothing else.
 */
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
	const base = `http://127.0.0.1:${server.address().port}`;
	return { server, sent, base: `${base}/responses`, chatBase: `${base}/chat/completions` };
}

function replayRecorded(_req, res) {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.end(REAL_STREAM);
}

/** Replay a scripted SSE body verbatim. */
const replaySse = body => (_req, res) => {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.end(body);
};

/** Replay a scripted JSON body verbatim (the openrouter door's buffered path). */
const replayJson = body => (_req, res) => {
	res.writeHead(200, { 'content-type': 'application/json' });
	res.end(body);
};

/** Answer a streaming request one way and a buffered request the other, from the same stub. */
const byStream = (streamBehaviour, bufferedBehaviour) => (parsed, res) =>
	(parsed.stream ? streamBehaviour : bufferedBehaviour)(parsed, res);

/**
 * Write the first `bytes` of a transcript and then KILL the socket, which is what a real mid-stream abort
 * looks like to the broker: a body stream that errors instead of ending.
 */
const abortAfter = (body, bytes) => (_req, res) => {
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	res.write(body.slice(0, bytes));
	setTimeout(() => res.socket.destroy(), 20);
};

function startBroker(cfg) {
	const openrouter = cfg.door === 'openrouter';
	const env = Object.assign({}, process.env, {
		HOME: cfg.home,
		LWD_PROXY_HOST: '127.0.0.1',
		LWD_PROXY_PORT: String(cfg.port),
		// Whichever door is NOT under test points at a dead address, so a mis-routed call fails loudly rather
		// than quietly answering from the wrong upstream.
		LWD_OPENAI_RESPONSES_URL: openrouter ? 'http://127.0.0.1:1/none' : cfg.responsesUrl,
		OPENROUTER_URL: openrouter ? cfg.chatUrl : 'http://127.0.0.1:1/none',
		LWD_ENTITLEMENT_PROBE: cfg.entitlementProbe ? '1' : '0',
	});
	if (openrouter) {
		env.LWD_BACKEND = 'openrouter';
		env.OPENROUTER_API_KEY = 'test-key';
		env.OPENROUTER_MODEL = ''; // exercise the curated list, not a single-id override
	} else {
		delete env.LWD_BACKEND;
		delete env.OPENROUTER_API_KEY;
		delete env.OPENROUTER_API_KEY_FILE;
	}
	const child = spawn(process.execPath, [BROKER_SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	let out = '';
	child.stdout.on('data', c => { out += c.toString(); });
	child.stderr.on('data', c => { out += c.toString(); });
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`broker did not start: ${out}`)), 10_000);
		const settle = (fn, arg) => { clearInterval(tick); clearTimeout(timer); fn(arg); };
		const tick = setInterval(() => {
			if (/listening on/.test(out)) { settle(resolve, undefined); }
			// Fail FAST on a taken port so the caller can retry on another one rather than waiting out the
			// timeout and reporting a collision as "the broker is broken".
			else if (/EADDRINUSE/.test(out)) { settle(reject, new Error(`EADDRINUSE on port ${cfg.port}`)); }
		}, 25);
	});
	return { child, ready, log: () => out };
}

/** Start the broker on a port from this suite's band, retrying on a collision. Returns the live child + port. */
async function startBrokerOnFreePort(cfg) {
	let lastError;
	for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
		const port = PORT_BAND_START + Math.floor(Math.random() * PORT_BAND_SIZE);
		const broker = startBroker(Object.assign({}, cfg, { port }));
		try {
			await broker.ready;
			return { broker, port };
		} catch (e) {
			broker.child.kill('SIGKILL');
			lastError = e;
			if (!/EADDRINUSE/.test(String(e && e.message))) { throw e; }
		}
	}
	throw lastError;
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

/** Parse an SSE response body into its `data:` payloads, in order. */
function sseEvents(text) {
	return text.split('\n')
		.map(l => l.trim())
		.filter(l => l.startsWith('data:'))
		.map(l => l.slice(5).trim())
		.filter(p => p && p !== '[DONE]')
		.map(p => JSON.parse(p));
}

/**
 * One event per line, projected to just what a reader has to act on: the type, the block index it applies to,
 * and its payload. Assertions read as the wire transcript they are, so a drift shows as a diff of the actual
 * event sequence rather than a pile of independent booleans.
 */
function eventShapes(text) {
	return sseEvents(text).map(e => {
		if (e.type === 'content_block_delta') { return [e.type, e.index, e.delta.type, e.delta.text ?? e.delta.partial_json]; }
		if (e.type === 'content_block_start') { return [e.type, e.index, e.content_block.type, e.content_block.id, e.content_block.name]; }
		if (e.type === 'content_block_stop') { return [e.type, e.index]; }
		if (e.type === 'message_start') { return [e.type, e.message.model]; }
		if (e.type === 'message_delta') { return [e.type, e.delta.stop_reason]; }
		if (e.type === 'error') { return [e.type, e.error.type]; }
		return [e.type];
	});
}

async function withBroker(cfg, run) {
	const home = mkHome();
	const upstream = await startUpstream(cfg.behaviour);
	const { broker, port } = await startBrokerOnFreePort({
		home, door: cfg.door, responsesUrl: upstream.base, chatUrl: upstream.chatBase, entitlementProbe: cfg.entitlementProbe,
	});
	try {
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
			refusedMessage: 'The \'gpt-5.6-sol\' model is not supported when using Codex with a ChatGPT account.',
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

// --- tool passthrough, both doors (plan 55 B2) -----------------------------------------------------------
// Every case below spawns the REAL broker against a scripted upstream. There is deliberately no fake door
// inside the broker: the translation under test is exactly the code a live call runs.

/** The Anthropic event sequence a tool-calling stream must produce - IDENTICAL on both doors bar the ids. */
const toolStreamShapes = (model, callId) => [
	['message_start', model],
	// Text keeps content block index 0 and its bare deltas, exactly as a text-only stream always did.
	['content_block_delta', 0, 'text_delta', 'Read'],
	['content_block_delta', 0, 'text_delta', 'ing pricing.'],
	// The tool call is its own numbered block, opened and closed around raw JSON fragments.
	['content_block_start', 1, 'tool_use', callId, 'read_document'],
	['content_block_delta', 1, 'input_json_delta', '{"docId"'],
	['content_block_delta', 1, 'input_json_delta', ':"pricing"}'],
	['content_block_stop', 1],
	// Only a stream that carried a tool call emits this; a text-only stream still goes straight to message_stop.
	['message_delta', 'tool_use'],
	['message_stop'],
];

/** The Anthropic event sequence a MALFORMED tool call must produce: degraded, named, and cleanly ended. */
const malformedStreamShapes = (model, callId) => [
	['message_start', model],
	['content_block_start', 1, 'tool_use', callId, 'read_document'],
	['content_block_delta', 1, 'input_json_delta', '{"docId": '],
	['content_block_stop', 1],
	['error', 'invalid_tool_arguments'],
	['message_delta', 'tool_use'],
	['message_stop'],
];

/** A transcript truncated to its first `n` SSE events - what the client got before upstream died. */
const firstEvents = (body, n) => body.split('\n\n').slice(0, n).join('\n\n') + '\n\n';

/** The second turn of a round trip: the client answers the call and asks again. */
const toolResultTurn = (callId, assistantContent) => [
	{ role: 'user', content: 'What does pricing say?' },
	{ role: 'assistant', content: assistantContent },
	{
		role: 'user', content: [
			// Array-form result content, an is_error result, and trailing user text - all three in one turn,
			// because that is what a real loop step looks like and all three translate differently.
			{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: 'Pricing is $9.' }] },
			{ type: 'tool_result', tool_use_id: 'call_second', content: 'disk full', is_error: true },
			{ type: 'text', text: 'and now?' },
		],
	},
];

test('openrouter door: a whole tool round trip - tools out as OpenAI function tools, tool_use back, tool_result out as a role:"tool" message', async () => {
	await withBroker({ door: 'openrouter', behaviour: replayJson(OR_TOOL_CALL) }, async ({ port, upstream }) => {
		const first = await post(port, {
			max_tokens: 64,
			tools: [READ_DOCUMENT_TOOL],
			tool_choice: { type: 'auto', disable_parallel_tool_use: true },
			messages: [{ role: 'user', content: 'What does pricing say?' }],
		});
		await post(port, { max_tokens: 64, tools: [READ_DOCUMENT_TOOL], messages: toolResultTurn('call_or_TOOLCALL0001', first.json.content) });
		assert.deepStrictEqual({
			sentTools: upstream.sent[0].tools,
			sentToolChoice: upstream.sent[0].tool_choice,
			sentParallel: upstream.sent[0].parallel_tool_calls,
			stopReason: first.json.stop_reason,
			content: first.json.content,
			secondMessages: upstream.sent[1].messages,
		}, {
			// OpenAI's chat dialect wraps each tool in a `function` envelope and calls the schema `parameters`.
			sentTools: [{
				type: 'function',
				function: {
					name: 'read_document',
					description: 'Read one document',
					parameters: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] },
				},
			}],
			sentToolChoice: 'auto',
			// Anthropic says "no parallel tools" with a flag ON tool_choice; OpenAI with a sibling parameter.
			sentParallel: false,
			stopReason: 'tool_use',
			content: [
				{ type: 'text', text: 'Reading pricing.' },
				{ type: 'tool_use', id: 'call_or_TOOLCALL0001', name: 'read_document', input: { docId: 'pricing' } },
			],
			secondMessages: [
				{ role: 'user', content: 'What does pricing say?' },
				// The assistant's tool_use becomes an OpenAI tool_calls array with the input re-serialised.
				{
					role: 'assistant', content: 'Reading pricing.',
					tool_calls: [{ id: 'call_or_TOOLCALL0001', type: 'function', function: { name: 'read_document', arguments: '{"docId":"pricing"}' } }],
				},
				// Each tool_result becomes its OWN message keyed by call id - never part of the user turn -
				// and an is_error result keeps its failure visible, which no OpenAI field can carry.
				{ role: 'tool', tool_call_id: 'call_or_TOOLCALL0001', content: 'Pricing is $9.' },
				{ role: 'tool', tool_call_id: 'call_second', content: 'Error: disk full' },
				{ role: 'user', content: 'and now?' },
			],
		});
	});
});

test('openrouter door: a streamed tool call arrives as Anthropic content_block_start / input_json_delta / content_block_stop with stop_reason tool_use', async () => {
	await withBroker({ door: 'openrouter', behaviour: replaySse(OR_TOOL_STREAM) }, async ({ port }) => {
		const res = await post(port, {
			stream: true, max_tokens: 64, tools: [READ_DOCUMENT_TOOL],
			messages: [{ role: 'user', content: 'What does pricing say?' }],
		}, { stream: true });
		assert.deepStrictEqual(eventShapes(res.text), toolStreamShapes('openai/gpt-4.1-mini', 'call_or_TOOLCALL0001'));
	});
});

test('openrouter door: malformed tool arguments are a structured error buffered, and a named degraded event streamed - never a crash or a truncated stream', async () => {
	await withBroker({ door: 'openrouter', behaviour: byStream(replaySse(OR_TOOL_MALFORMED_STREAM), replayJson(OR_TOOL_MALFORMED)) }, async ({ port }) => {
		const buffered = await post(port, { max_tokens: 64, tools: [READ_DOCUMENT_TOOL], messages: [{ role: 'user', content: 'go' }] });
		const streamed = await post(port, { stream: true, max_tokens: 64, tools: [READ_DOCUMENT_TOOL], messages: [{ role: 'user', content: 'go' }] }, { stream: true });
		assert.deepStrictEqual({
			bufferedStatus: buffered.status,
			bufferedMessage: buffered.json.error.message,
			streamedShapes: eventShapes(streamed.text),
		}, {
			// Buffered, nothing has been sent yet, so the honest answer is a structured error - never a
			// tool_use block with `input: {}`, which the client would happily run with invented arguments.
			bufferedStatus: 502,
			bufferedMessage: 'the model returned malformed arguments for tool read_document: {"docId": ',
			streamedShapes: malformedStreamShapes('openai/gpt-4.1-mini', 'call_or_MALFORMED01'),
		});
	});
});

test('openrouter door: an upstream abort mid-stream ends the client stream cleanly, naming the truncation', async () => {
	await withBroker({ door: 'openrouter', behaviour: abortAfter(firstEvents(OR_TOOL_STREAM, 3), 10_000) }, async ({ port }) => {
		const res = await post(port, {
			stream: true, max_tokens: 64, tools: [READ_DOCUMENT_TOOL],
			messages: [{ role: 'user', content: 'What does pricing say?' }],
		}, { stream: true });
		assert.deepStrictEqual(eventShapes(res.text), [
			['message_start', 'openai/gpt-4.1-mini'],
			['content_block_delta', 0, 'text_delta', 'Read'],
			['content_block_delta', 0, 'text_delta', 'ing pricing.'],
			// The prose that DID arrive is kept; the client is told the rest never will, and the stream still
			// terminates - it used to drop the socket mid-event with no message_stop at all.
			['error', 'upstream_stream_error'],
			['message_stop'],
		]);
	});
});

test('codex door: a whole tool round trip - flat Responses function tools out, tool_use back, tool_result out as a function_call_output item', async () => {
	await withBroker({ behaviour: replaySse(CODEX_TOOL_STREAM) }, async ({ port, upstream }) => {
		const first = await post(port, {
			model: 'gpt-5.6-terra', max_tokens: 64,
			tools: [READ_DOCUMENT_TOOL],
			tool_choice: { type: 'tool', name: 'read_document' },
			messages: [{ role: 'user', content: 'What does pricing say?' }],
		});
		await post(port, {
			model: 'gpt-5.6-terra', max_tokens: 64, tools: [READ_DOCUMENT_TOOL],
			messages: toolResultTurn('call_TOOLCALL0000000000000000', first.json.content),
		});
		assert.deepStrictEqual({
			sentTools: upstream.sent[0].tools,
			sentToolChoice: upstream.sent[0].tool_choice,
			stopReason: first.json.stop_reason,
			content: first.json.content,
			secondInput: upstream.sent[1].input,
		}, {
			// The Responses dialect is FLAT: no `function` envelope, and strict mode stays off because the
			// client's schemas are not written to strict's all-required / additionalProperties:false contract.
			sentTools: [{
				type: 'function',
				name: 'read_document',
				description: 'Read one document',
				parameters: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] },
				strict: false,
			}],
			sentToolChoice: { type: 'function', name: 'read_document' },
			stopReason: 'tool_use',
			// Assembled from the item stream: the terminal `response.completed` carries an EMPTY output array,
			// so the streamed function_call item is the only place the call ever exists.
			content: [
				{ type: 'text', text: 'Reading pricing.' },
				{ type: 'tool_use', id: 'call_TOOLCALL0000000000000000', name: 'read_document', input: { docId: 'pricing' } },
			],
			secondInput: [
				{ role: 'user', content: [{ type: 'input_text', text: 'What does pricing say?' }] },
				{ role: 'assistant', content: [{ type: 'output_text', text: 'Reading pricing.' }] },
				// Both the call and its output are TOP-LEVEL items here, never message content.
				{ type: 'function_call', call_id: 'call_TOOLCALL0000000000000000', name: 'read_document', arguments: '{"docId":"pricing"}' },
				{ type: 'function_call_output', call_id: 'call_TOOLCALL0000000000000000', output: 'Pricing is $9.' },
				{ type: 'function_call_output', call_id: 'call_second', output: 'Error: disk full' },
				{ role: 'user', content: [{ type: 'input_text', text: 'and now?' }] },
			],
		});
	});
});

test('codex door: a streamed tool call arrives as the SAME Anthropic events the openrouter door emits', async () => {
	await withBroker({ behaviour: replaySse(CODEX_TOOL_STREAM) }, async ({ port }) => {
		const res = await post(port, {
			model: 'gpt-5.6-terra', stream: true, max_tokens: 64, tools: [READ_DOCUMENT_TOOL],
			messages: [{ role: 'user', content: 'What does pricing say?' }],
		}, { stream: true });
		assert.deepStrictEqual(eventShapes(res.text), toolStreamShapes('gpt-5.6-terra', 'call_TOOLCALL0000000000000000'));
	});
});

test('codex door: malformed tool arguments are a structured error buffered, and a named degraded event streamed', async () => {
	await withBroker({ behaviour: replaySse(CODEX_TOOL_MALFORMED) }, async ({ port }) => {
		const buffered = await post(port, { model: 'gpt-5.6-terra', max_tokens: 64, tools: [READ_DOCUMENT_TOOL], messages: [{ role: 'user', content: 'go' }] });
		const streamed = await post(port, { model: 'gpt-5.6-terra', stream: true, max_tokens: 64, tools: [READ_DOCUMENT_TOOL], messages: [{ role: 'user', content: 'go' }] }, { stream: true });
		assert.deepStrictEqual({
			bufferedStatus: buffered.status,
			bufferedMessage: buffered.json.error.message,
			streamedShapes: eventShapes(streamed.text),
		}, {
			bufferedStatus: 502,
			bufferedMessage: 'the model returned malformed arguments for tool read_document: {"docId": ',
			streamedShapes: malformedStreamShapes('gpt-5.6-terra', 'call_MALFORMED000000000000000'),
		});
	});
});

test('codex door: an upstream abort mid-stream ends the client stream cleanly, naming the truncation', async () => {
	await withBroker({ behaviour: abortAfter(firstEvents(CODEX_TOOL_STREAM, 5), 20_000) }, async ({ port }) => {
		const res = await post(port, {
			model: 'gpt-5.6-terra', stream: true, max_tokens: 64, tools: [READ_DOCUMENT_TOOL],
			messages: [{ role: 'user', content: 'What does pricing say?' }],
		}, { stream: true });
		assert.deepStrictEqual(eventShapes(res.text), [
			['message_start', 'gpt-5.6-terra'],
			['content_block_delta', 0, 'text_delta', 'Read'],
			['content_block_delta', 0, 'text_delta', 'ing pricing.'],
			['error', 'upstream_stream_error'],
			['message_stop'],
		]);
	});
});

test('codex door: the opening message_start names the model the stream is ACTUALLY served by, not the one asked for', async () => {
	// The openrouter door's message_start is pinned in lwd-openrouter-models; this door's never was, so a
	// regression there was invisible. A stale persisted id resolves to the catalogue default, and the stream
	// has to say so - "which model was asked for" and "which model answered" are different questions.
	await withBroker({ behaviour: replayRecorded }, async ({ port }) => {
		const res = await post(port, Object.assign({ model: 'gpt-5.6-was-retired', stream: true }, PROMPT), { stream: true });
		const start = sseEvents(res.text).find(e => e.type === 'message_start');
		assert.deepStrictEqual({ model: start.message.model, role: start.message.role, type: start.message.type }, {
			// The catalogue default for this door (lwd-openai-oauth's `default: true` entry), NOT the retired id
			// the caller asked for - which is exactly the substitution a stream had no way to disclose before.
			model: 'gpt-5.6-sol', role: 'assistant', type: 'message',
		});
	});
});
