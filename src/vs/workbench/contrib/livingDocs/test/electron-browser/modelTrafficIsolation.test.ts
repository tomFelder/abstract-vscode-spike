/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
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

// Ticket #375. The defect these pin is not a wrong answer, it is a green run that was not evidence.
//
// The streaming model call used to reach past the injected request service for the global `fetch`. That is
// invisible until you run the suite on a machine with the app up, because the app starts a signed-in broker
// on exactly the port the service falls back to. Then the "unit" suite is answered by a live model: the
// assertion diff shows real prose where a canned fixture belongs, and it reproduces on some machines and not
// on others. Routing every model call through IRequestService makes the double the ONLY possible answer.
//
// Two tests, because the guarantee has two halves and the first version of this file let each half excuse
// the other:
//
//   1. WHERE the ladder aims. Asserted on the streamed model call itself, at the literal default URL. The
//      first version asked only whether SOME request had gone to that host, which a `/healthz` probe answers
//      while the model call is out of a window of its own - so it passed with the defect present.
//   2. That a REAL listener sitting there is never reached. The first version bound 127.0.0.1 while the
//      service was aimed at `localhost`, which on this platform resolves to ::1 - so the trap held an
//      address the traffic never used, and reported "nothing reached me" while a live model answered the
//      run. The trap and the service now agree on one literal address, and the trap PROVES it is reachable
//      at that address before the run, so "nothing reached it" can never be an artefact of nothing being
//      able to.
//
// They live in `test/electron-browser` because a real TCP listener is something the browser test runner
// (rightly) has no way to give them.
suite('livingDocs - model traffic cannot leave IRequestService (#375)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	// The broker's default port, and so the port the service falls back to when nothing is configured. Written
	// out rather than imported so that changing the service's default has to be a deliberate change here too.
	const BROKER_PORT = 8090;
	// A LITERAL address, never a name. `localhost` is a resolver question with two answers, and a live broker
	// on the wildcard address holds the one the trap does not - which is how the previous trap came to be
	// blind on exactly the machines this ticket is about.
	const HOST = '127.0.0.1';
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

	interface ITrap {
		/** The literal URL the trap is listening on, and the URL the service under test is aimed at. */
		readonly url: string;
		/** Plain words for what was bound, so a run says which port it actually guarded. */
		readonly where: string;
		/** Requests that reached the listener. Any entry at all is the defect. */
		readonly hits: string[];
		close(): Promise<void>;
	}

	// Put a real listener where the model ladder will be aimed, and record anything that arrives. It answers
	// with obviously-not-a-fixture prose, so a leak fails loudly on content as well as on the hit count.
	//
	// The broker's default port is preferred, because that is the port a running app occupies and so the exact
	// shape of the original failure. Two things can take it away: the port may be unbindable, or - the case
	// that made the old trap useless - the bind may succeed while something else still answers at that
	// address. Both are settled the same way, by ASKING: the trap fetches itself and requires the hit. Only a
	// trap that has just proven it can be reached is allowed to certify that nothing reached it. When the
	// default port cannot pass that test, an ephemeral one is bound instead and must pass it, so the guard is
	// live in every environment rather than going quietly vacuous on the machines that need it most.
	async function trapModelPort(): Promise<ITrap> {
		const hits: string[] = [];
		// Loaded lazily: `http` is a slow module, so the repo only allows it as a type import or behind a
		// dynamic import, and this is the one test in the living-docs area that needs a real socket.
		const { createServer } = await import('http');
		const server = createServer((req, res) => {
			hits.push(`${req.method} ${req.url}`);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ content: [{ type: 'text', text: 'LIVE BROKER PROSE - the suite reached a real listener' }] }));
		});
		const listen = (port: number) => new Promise<boolean>(resolve => {
			const onError = () => resolve(false);
			server.once('error', onError);
			server.listen(port, HOST, () => { server.removeListener('error', onError); resolve(true); });
		});
		const stop = () => new Promise<void>(resolve => server.close(() => resolve()));
		const boundPort = () => (server.address() as { port: number }).port;
		// The positive control. A trap nobody can reach proves nothing by seeing nothing.
		const answersAt = async (url: string) => {
			const before = hits.length;
			try { await (await fetch(`${url}/trap-self-test`)).text(); } catch { /* nothing answered, or not us */ }
			return hits.length > before;
		};

		let url = `http://${HOST}:${BROKER_PORT}`;
		let where = `the broker's own default port ${BROKER_PORT}`;
		if (!await listen(BROKER_PORT) || !await answersAt(url)) {
			// The port is held, or is held by somebody who answers there. Take one that is unambiguously ours.
			await stop();
			assert.ok(await listen(0), 'the trap needs a listening socket - no port could be bound at all');
			url = `http://${HOST}:${boundPort()}`;
			where = `an ephemeral port (${BROKER_PORT} was not the trap's to hold)`;
			assert.ok(await answersAt(url), `the trap at ${url} cannot be reached, so proving nothing reaches it would prove nothing`);
		}
		hits.length = 0;
		return { url, where, hits, close: stop };
	}

	// The broker's SSE rendering of one canned reply, so the streaming path is answered the way the real
	// broker answers it rather than being pushed into its buffered fallback.
	function asSse(reply: string): string {
		const text = JSON.stringify({ reply, edits: [] });
		return [
			{ type: 'content_block_delta', delta: { type: 'text_delta', text } },
			{ type: 'message_stop' },
		].map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
	}

	// `proxyUrl` undefined leaves `livingDocs.modelProxyUrl` unset, so the service falls back to its real
	// default - which is what the first test is about.
	function createService(proxyUrl?: string): { service: LivingDocsService; requests: { url: string; body: string }[] } {
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
		const configurationService = { getValue: (key?: string) => (key === 'livingDocs.modelProxyUrl' ? proxyUrl : true) } as unknown as IConfigurationService;
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

	/** The streamed model calls that crossed the request service, in the order they were made. */
	function streamedModelCalls(requests: { url: string; body: string }[]): string[] {
		return requests.filter(r => r.url.includes('/v1/messages') && r.body.includes('"stream":true')).map(r => r.url);
	}

	test('the streamed model call crosses IRequestService, aimed - with nothing configured - at the broker default port', async () => {
		const { service, requests } = createService();
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

		// The claim is about the MODEL CALL, not about the host in general. "Some request went to :8090" is
		// answered by a `/healthz` probe while the model call goes out of a window of its own, which is exactly
		// how this test used to pass with the defect present.
		assert.deepStrictEqual(
			streamedModelCalls(requests),
			[`http://localhost:${BROKER_PORT}/v1/messages`],
			`the streamed model call must cross the request service, aimed at the broker's own default port - saw ${JSON.stringify(requests.map(r => r.url))}`,
		);
	});

	test('a live listener where the model ladder aims is never reached: the chat ladder is answered by the double', async () => {
		const trap = await trapModelPort();
		try {
			// Aimed at the trap by LITERAL address, so there is no resolver between the two and no second
			// address for traffic to escape down. Where the unconfigured default points is the test above.
			const { service, requests } = createService(trap.url);
			await service.loadDocument(WEEKLY);

			await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

			const reply = service.getChatMessages(WEEKLY).at(-1);
			assert.deepStrictEqual({
				// The reply is the canned fixture, verbatim. No live model produces this sentence.
				content: reply?.content,
				via: reply?.via,
				// Nothing arrived at the listener - which has just proven it can be arrived at.
				reachedTheListener: trap.hits,
				// And the ladder really was aimed at it, or the line above would be measuring an empty room.
				aimedAtTheListener: streamedModelCalls(requests),
			}, {
				content: FIXTURE_REPLY,
				via: 'model',
				reachedTheListener: [],
				aimedAtTheListener: [`${trap.url}/v1/messages`],
			}, `the trap was listening on ${trap.where}`);
		} finally {
			await trap.close();
		}
	});
});
