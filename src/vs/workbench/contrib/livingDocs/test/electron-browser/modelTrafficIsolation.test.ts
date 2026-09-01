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
// assertion diff shows real prose where a canned fixture belongs, and it reproduces on some machines and
// not on others. Routing every model call through IRequestService makes the double the ONLY possible answer.
//
// So the second test does the thing the failure did: it puts a REAL listener where the model ladder aims and
// proves nothing arrives. The first test is what gives that its teeth, by pinning where the ladder aims when
// nothing is configured - the broker's own default port.
//
// They live in `test/electron-browser` because a real TCP listener is something the browser test runner
// (rightly) has no way to give them.
suite('livingDocs - model traffic cannot leave IRequestService (#375)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	// The broker's default port, and so the port the service falls back to when nothing is configured. Written
	// out rather than imported so that changing the service's default has to be a deliberate change here too.
	const BROKER_PORT = 8090;
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
		/** The port actually bound - the broker's default when it was free. */
		readonly port: number;
		/** Requests that reached the listener. Any entry at all is the defect. */
		readonly hits: string[];
		close(): Promise<void>;
	}

	// Put a real listener where the model ladder will aim and record anything that arrives. It answers with
	// obviously-not-a-fixture prose, so a leak fails loudly on content as well as on the hit count.
	//
	// The broker's default port is preferred, because that is the port a running app occupies and so the exact
	// shape of the original failure. When it is ALREADY taken - the developer has the app up, which is that
	// scenario itself - binding it is not on offer, so an ephemeral port is bound instead and the service is
	// aimed there. The guarantee proven is identical, and it is proven on every machine rather than quietly
	// going vacuous on the ones that need it most.
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
			server.listen(port, '127.0.0.1', () => { server.removeListener('error', onError); resolve(true); });
		});
		if (!await listen(BROKER_PORT)) {
			assert.ok(await listen(0), 'the trap needs a listening socket - no ephemeral port could be bound');
		}
		return {
			port: (server.address() as { port: number }).port,
			hits,
			close: () => new Promise<void>(resolve => server.close(() => resolve())),
		};
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
	// default - which is the whole point of the first test below.
	function createService(proxyUrl?: string): { service: LivingDocsService; urls: string[] } {
		const files = new Map<string, string>([[WEEKLY.toString(), WEEKLY_MD]]);
		const urls: string[] = [];
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
				urls.push(url);
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
		return { service, urls };
	}

	test('with nothing configured the model ladder aims at the broker default port - which is what a running app occupies', async () => {
		const { service, urls } = createService();
		await service.loadDocument(WEEKLY);

		await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

		assert.ok(
			urls.some(u => u.startsWith(`http://localhost:${BROKER_PORT}/`)),
			`the unconfigured default must be the broker's own port, or the trap below guards nothing - saw ${JSON.stringify(urls)}`,
		);
	});

	test('a live listener where the model ladder aims is never reached: the chat ladder is answered by the double', async () => {
		const trap = await trapModelPort();
		try {
			// When the trap owns the broker's default port, leave the service unconfigured so it aims there by
			// itself; otherwise point it at the ephemeral port the trap did get.
			const { service, urls } = createService(trap.port === BROKER_PORT ? undefined : `http://127.0.0.1:${trap.port}`);
			await service.loadDocument(WEEKLY);

			await service.sendChatMessage(WEEKLY, 'Tighten the commentary');

			const reply = service.getChatMessages(WEEKLY).at(-1);
			assert.deepStrictEqual({
				// The reply is the canned fixture, verbatim. No live model produces this sentence.
				content: reply?.content,
				via: reply?.via,
				// Nothing arrived at the listener.
				reachedTheListener: trap.hits,
				// And the ladder really was aimed at it - otherwise the line above proves nothing.
				aimedAtTheListener: urls.some(u => u.includes(`:${trap.port}/v1/messages`)),
			}, {
				content: FIXTURE_REPLY,
				via: 'model',
				reachedTheListener: [],
				aimedAtTheListener: true,
			});
		} finally {
			await trap.close();
		}
	});
});
