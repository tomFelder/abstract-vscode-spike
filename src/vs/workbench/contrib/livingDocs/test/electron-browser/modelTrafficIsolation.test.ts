/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { NullAnalyticsService } from '../../common/analytics.js';
import { ensureNoNetworkInTestSuite } from '../common/networkSentinel.js';

// Ticket #375. What is pinned here is not a wrong answer, it is a green run that was not evidence.
//
// The streaming model call used to reach past the injected request service for the global `fetch`. That is
// invisible until you run the suite on a machine with the app up, because the app starts a signed-in broker
// on exactly the port the service falls back to. Then the "unit" suite is answered by a live model: the
// assertion diff shows real prose where a canned fixture belongs, and it reproduces on some machines and not
// on others.
//
// The guard has two layers, and they are not equal.
//
// The LOAD-BEARING layer is the network sentinel (../common/networkSentinel.ts), installed across every
// living-docs suite that builds the service. It stands in front of the global network primitives themselves,
// records every attempt at the call - synchronously, so an un-awaited leak is as visible as an awaited one -
// and refuses it, so no living-docs test can emit a billed model call whatever address it aims at. That is
// what makes "structurally incapable" literally true rather than "watched for the shapes we thought of".
//
// The SECOND layer is the port trap in the second suite below: a real listener where the ladder aims, in a
// suite that deliberately leaves the process free to use the network, so that the claim is corroborated by
// something other than the mechanism enforcing it. Its limits are written out where it is built; it is
// corroboration, and the sentinel is the guarantee.
//
// They live in `test/electron-browser` because a real TCP listener is something the browser test runner
// (rightly) has no way to give them.

// The broker's default port, and so the port the service falls back to when nothing is configured. Written
// out rather than imported so that changing the service's default has to be a deliberate change here too.
const BROKER_PORT = 8090;
const LOOPBACK_V4 = '127.0.0.1';
const LOOPBACK_V6 = '::1';
// A closed port. The harness aims here unless a test asks otherwise, so a test that simply forgets gets a
// lock rather than the live broker.
const DEAD_PROXY = `http://${LOOPBACK_V4}:9`;
// The opt-in for leaving `livingDocs.modelProxyUrl` unset, so the service falls back to its own shipped
// default. A marker rather than `undefined`, so asking for it has to be deliberate and reads as such - and
// so a caller who passes nothing cannot get it by accident.
const SHIPPED_DEFAULT = Symbol('the service\'s own default proxy url');

const WEEKLY = URI.file('/ws/weekly.md');
const WEEKLY_MD = [
	'---',
	'title: Weekly Operating Summary',
	'---',
	'',
	'## Commentary',
	'',
	'Growth remained steady this week.',
].join('\n') + '\n';

// The one answer a passing run is allowed to produce. Anything else - most of all fluent prose about the
// document - means something other than the double answered.
const FIXTURE_REPLY = 'This reply came from the injected request service, not from a model.';

// The broker's SSE rendering of one canned reply, so the streaming path is answered the way the real broker
// answers it rather than being pushed into its buffered fallback.
function asSse(reply: string): string {
	const text = JSON.stringify({ reply, edits: [] });
	return [
		{ type: 'content_block_delta', delta: { type: 'text_delta', text } },
		{ type: 'message_stop' },
	].map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

interface IHarness {
	readonly service: LivingDocsService;
	readonly requests: { url: string; body: string }[];
}

/** The streamed model calls that crossed the request service, in the order they were made. */
function streamedModelCalls(requests: { url: string; body: string }[]): string[] {
	return requests.filter(r => r.url.includes('/v1/messages') && r.body.includes('"stream":true')).map(r => r.url);
}

// `proxyUrl` defaults to a dead port on purpose: the ONE test that wants the service's own shipped default
// says so, and nothing else can wander into the live broker by omission.
function makeService(store: Pick<ReturnType<typeof ensureNoDisposablesAreLeakedInTestSuite>, 'add'>, proxyUrl: string | typeof SHIPPED_DEFAULT = DEAD_PROXY): IHarness {
	const files = new Map<string, string>([[WEEKLY.toString(), WEEKLY_MD]]);
	const requests: { url: string; body: string }[] = [];
	const fileService = {
		onDidChangeFileSystemProviderRegistrations: Event.None,
		readFile: async (resource: URI) => {
			const content = files.get(resource.toString());
			if (content === undefined) { throw new Error(`not found: ${resource.toString()}`); }
			return { value: VSBuffer.fromString(content) };
		},
		writeFile: async (resource: URI, buffer: VSBuffer) => { files.set(resource.toString(), buffer.toString()); },
		exists: async (resource: URI) => files.has(resource.toString()),
		resolve: async () => ({ children: [] }),
		createWatcher: () => {
			const emitter = new Emitter<unknown>();
			return { onDidChange: emitter.event, dispose: () => emitter.dispose() };
		},
	} as unknown as IFileService;
	// Every call the service makes lands here, and nowhere else. `/v1/messages` is answered as SSE when the
	// body asked to stream, exactly as the broker would, so the streaming path is exercised for real.
	const requestService = {
		request: async (options: { url?: string; data?: string }) => {
			const url = options.url ?? '';
			requests.push({ url, body: options.data ?? '' });
			if (url.includes('/v1/messages')) {
				const body = (options.data ?? '').includes('"stream":true')
					? asSse(FIXTURE_REPLY)
					: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ reply: FIXTURE_REPLY, edits: [] }) }], stop_reason: 'end_turn' });
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(body)) };
			}
			return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ ok: true }))) };
		},
	} as unknown as IRequestService;
	const editorService = { openEditor: async () => undefined, findEditors: () => [], onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
	const viewsService = { openView: async () => null } as unknown as IViewsService;
	const configured = proxyUrl === SHIPPED_DEFAULT ? undefined : proxyUrl;
	const configurationService = { getValue: (key?: string) => (key === 'livingDocs.modelProxyUrl' ? configured : true) } as unknown as IConfigurationService;
	const notificationService = { info: () => undefined, error: () => undefined, notify: () => ({ close: () => undefined }) } as unknown as INotificationService;
	const workspaceService = { getWorkspace: () => ({ folders: [{ uri: URI.file('/ws'), name: 'ws' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
	const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
	const hostService = { openWindow: async () => undefined } as unknown as IHostService;
	const clipboardService = { writeText: async () => undefined } as unknown as IClipboardService;
	const commandService = { executeCommand: async () => undefined } as unknown as ICommandService;
	const service = new LivingDocsService(fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService, new NullAnalyticsService(), store.add(new InMemoryStorageService()), commandService, clipboardService, { isVisible: () => false } as unknown as IWorkbenchLayoutService);
	store.add(service);
	return { service, requests };
}

suite('livingDocs - model traffic cannot leave IRequestService (#375)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const network = ensureNoNetworkInTestSuite();

	test('the whole chat ladder runs without touching a single global network primitive', async () => {
		// The structural claim, stated on its own rather than inferred from a listener seeing nothing. Every
		// primitive is stood in front of and records at the call, so this holds for any host, either loopback
		// family, and a leak the caller never awaited - the three ways a port trap can be looking elsewhere.
		const { service } = makeService(store);
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

		assert.deepStrictEqual(
			[...network.attempts],
			[],
			`the chat ladder reached for the network directly; guarded primitives: ${[...network.guarded].join(', ')}`,
		);
		assert.ok(network.guarded.includes('fetch'), 'the sentinel must at minimum be standing in front of fetch');
		assert.strictEqual(service.getChatMessages(WEEKLY).at(-1)?.content, FIXTURE_REPLY, 'and the double answered');
	});

	test('the streamed model call crosses IRequestService, aimed - with nothing configured - at the broker default port', async () => {
		// Where the ladder aims when a developer has configured nothing, which is what makes a running broker
		// on 8090 the hazard it is. Safe to point at the live port precisely because the sentinel makes the
		// call impossible to complete: this test cannot itself emit the billed call it is describing.
		const { service, requests } = makeService(store, SHIPPED_DEFAULT);
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

		// The claim is about the MODEL CALL, not about the host in general. "Some request went to :8090" is
		// answered by a `/healthz` probe while the model call goes out of a window of its own.
		assert.deepStrictEqual(
			streamedModelCalls(requests),
			[`http://localhost:${BROKER_PORT}/v1/messages`],
			`the streamed model call must cross the request service, aimed at the broker's own default port - saw ${JSON.stringify(requests.map(r => r.url))}`,
		);
	});
});

// Deliberately NOT sentinel-guarded: this suite leaves the process free to use the network, so that the
// listener below is genuinely load-bearing and can fail for the reason it exists. It is the corroborating
// layer; the sentinel above is the guarantee.
suite('livingDocs - a live listener on the broker default port is never reached (#375)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface ITrap {
		/** The literal URL the service under test is aimed at - one the trap has proven it answers on. */
		readonly url: string;
		/** Plain words for what was actually guarded, for the failure message. */
		readonly guarded: string;
		/** Everything that arrived, any path, any family. */
		readonly hits: string[];
		/** The subset that is model traffic - the only thing this suite is entitled to attribute to itself. */
		modelHits(): string[];
		/** Let anything already in flight land before the hits are read. */
		drain(): Promise<void>;
		close(): Promise<void>;
	}

	// Put a real listener where the model ladder will be aimed, and record what arrives.
	//
	// Three things this has to get right, each of which it got wrong before:
	//
	//   Both loopback families. `localhost` resolves to ::1 first here and a live broker holds the wildcard
	//   address, so a trap on 127.0.0.1 alone holds the one family the traffic never uses - it reported
	//   "nothing reached me" while a live model answered the run.
	//
	//   Its own reachability. A trap nobody can reach proves nothing by seeing nothing, so it fetches itself
	//   on every family it bound and requires the hit before it is allowed to certify anything.
	//
	//   Whose traffic it is. While it holds the broker's port it is answering for the whole machine, so a
	//   concurrently-running app's health checks land here too. Only MODEL traffic is attributed to this
	//   suite; health checks are answered the way the broker would answer them, so the running app is not
	//   told its model went away for the few milliseconds this takes.
	//
	// What it still cannot do: when neither loopback family of 8090 can be held - the port squatted, or a
	// platform where a wildcard bind blocks a specific one - it guards an ephemeral port instead, and a leak
	// that hardcodes 8090 rather than reading the configured URL would go unseen HERE. That leak is caught by
	// the sentinel in every other living-docs suite, which is the reason the sentinel is the load-bearing
	// layer and this is not.
	async function trapModelPort(): Promise<ITrap> {
		const hits: string[] = [];
		// Loaded lazily: `http` is a slow module, so the repo only allows it as a type import or behind a
		// dynamic import, and this is the one test in the living-docs area that needs a real socket.
		const { createServer } = await import('http');
		const open: { close(cb: () => void): void }[] = [];

		const listen = (host: string, port: number) => new Promise<number | undefined>(resolve => {
			const server = createServer((req, res) => {
				hits.push(`${req.method} ${req.url}`);
				res.writeHead(200, { 'content-type': 'application/json' });
				// A health check is answered the way the broker answers it: for the moment this trap holds the
				// port it speaks for the machine, and an app running alongside should not be told its model
				// vanished. Model traffic gets prose no fixture would ever contain.
				res.end((req.url ?? '').includes('/healthz')
					? JSON.stringify({ ok: true })
					: JSON.stringify({ content: [{ type: 'text', text: 'LIVE BROKER PROSE - the suite reached a real listener' }] }));
			});
			const onError = () => resolve(undefined);
			server.once('error', onError);
			server.listen(port, host, () => {
				server.removeListener('error', onError);
				open.push(server);
				resolve((server.address() as { port: number }).port);
			});
		});
		const closeAll = async () => {
			while (open.length) {
				const server = open.pop()!;
				await new Promise<void>(resolve => server.close(() => resolve()));
			}
		};
		const answersAt = async (url: string) => {
			const before = hits.length;
			try { await (await fetch(`${url}/trap-self-test`)).text(); } catch { /* nothing answered, or not us */ }
			return hits.length > before;
		};

		const tryPort = async (wanted: number) => {
			const port = await listen(LOOPBACK_V4, wanted);
			if (port === undefined) { return undefined; }
			const url = `http://${LOOPBACK_V4}:${port}`;
			if (!await answersAt(url)) { return undefined; }
			// The second family is a bonus, not a requirement: it is what catches a leak that went out by name.
			let v6 = await listen(LOOPBACK_V6, port) !== undefined;
			if (v6) { v6 = await answersAt(`http://[${LOOPBACK_V6}]:${port}`); }
			return { port, url, v6 };
		};

		let bound = await tryPort(BROKER_PORT);
		if (!bound) {
			await closeAll();
			bound = await tryPort(0);
		}
		assert.ok(bound, 'the trap needs a listening socket it has proven it answers on - none could be had');
		hits.length = 0;

		const families = bound.v6 ? `both loopback families` : `${LOOPBACK_V4} only (${LOOPBACK_V6} was not the trap's to hold)`;
		const guarded = bound.port === BROKER_PORT
			? `the broker's own default port ${BROKER_PORT}, ${families}`
			: `an ephemeral port ${bound.port}, ${families} - port ${BROKER_PORT} was not the trap's to hold`;

		return {
			url: bound.url,
			guarded,
			hits,
			modelHits: () => hits.filter(h => h.includes('/v1/messages')),
			// A leak the caller never awaited leaves the process and lands a moment later; reading the hits the
			// instant the turn resolves is how such a leak reads as green. Give it time to arrive.
			drain: async () => { for (let i = 0; i < 40; i++) { await timeout(5); } },
			close: closeAll,
		};
	}

	test('a live listener where the model ladder aims receives nothing, on every family it holds', async function (this: Mocha.Context) {
		const trap = await trapModelPort();
		// Say out loud - in this test's own line in the reporter, on a GREEN run - which port and which
		// families were actually guarded. A guard whose scope is only legible when it fails is a guard that
		// can quietly narrow: the reader of a passing run has to be able to see that it fell off 8090.
		this.test!.title = `${this.test!.title} [guarded: ${trap.guarded}]`;
		try {
			// Aimed at the trap by LITERAL address, so there is no resolver between the two.
			const { service, requests } = makeService(store, trap.url);
			await service.loadDocument(WEEKLY);

			await service.sendChatMessage(WEEKLY, 'Tighten the commentary');
			await trap.drain();

			const reply = service.getChatMessages(WEEKLY).at(-1);
			assert.deepStrictEqual({
				content: reply?.content,
				via: reply?.via,
				// Nothing arrived - at a listener that has just proven it can be arrived at, on every family it
				// holds. Only model traffic is attributed here; a stranger's health check is not this suite's.
				reachedTheListener: trap.modelHits(),
				// And the ladder really was aimed at it, or the line above would be measuring an empty room.
				aimedAtTheListener: streamedModelCalls(requests),
			}, {
				content: FIXTURE_REPLY,
				via: 'model',
				reachedTheListener: [],
				aimedAtTheListener: [`${trap.url}/v1/messages`],
			}, `the trap was guarding ${trap.guarded}; everything it saw: ${JSON.stringify(trap.hits)}`);
		} finally {
			await trap.close();
		}
	});
});
