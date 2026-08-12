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
import { NullAnalyticsService } from '../../common/analytics.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { changePointerRoute } from '../../common/changePointer.js';

// Plan 52 WP-A1 fix 2 (issue #301): the rule that a document's inline-widget report is an OBSERVATION with a
// lifetime, not a fact that is true forever.
//
// The defect these pin: a validator opened a document, had a paragraph edit proposed (the surface mounted a
// widget and reported it), CLOSED the tab, changed the file on disk so the anchor no longer matched, and clicked
// the chat pointer. The recorded report still said "mounted", so the click short-circuited on that memory,
// skipped the Review fallback, and put the reader in front of a document with no change on it and no way onward.
// It self-healed on the second click, which is precisely why it hid.
//
// The rule now: a report lives only while the surface that made it is still watching the content it described.
// It is retired when that surface goes away (the editor pane calls `clearInlineWidgets` as its input is torn
// down) and when the document is reloaded (`loadDocument` retires it, because a load replaces the very content
// the report described). Retiring is one-sided: it can only move a route back to `unknown`, which makes the next
// click ask the live surface instead of trusting a memory.
suite('livingDocs - the inline-widget report has a lifetime (plan 52 WP-A1 fix 2, #301)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const WEEKLY = URI.file('/ws/weekly.md');
	const BOARD = URI.file('/ws/board.md');

	const WEEKLY_MD = [
		'---',
		'title: Weekly Operating Summary',
		'---',
		'',
		'## Commentary',
		'',
		'Growth remained steady this week.',
	].join('\n') + '\n';

	// The same document AFTER an edit made outside Abstract while it was closed - the anchor the proposal was
	// built against is gone, so the surface that reopens it will mount nothing for that change.
	const WEEKLY_MD_REWRITTEN = [
		'---',
		'title: Weekly Operating Summary',
		'---',
		'',
		'## Commentary',
		'',
		'This paragraph was rewritten by something other than Abstract.',
	].join('\n') + '\n';

	function createService(): { service: LivingDocsService; setOnDisk: (resource: URI, text: string) => void } {
		const files = new Map<string, string>([[WEEKLY.toString(), WEEKLY_MD], [BOARD.toString(), WEEKLY_MD]]);
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
		const requestService = {
			request: async () => ({ res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString('{}')) }),
		} as unknown as IRequestService;
		const editorService = { openEditor: async () => undefined, findEditors: () => [], onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		// A dead port for the model proxy, so nothing in this suite can reach a real broker.
		const configurationService = { getValue: (key?: string) => (key === 'livingDocs.modelProxyUrl' ? 'http://127.0.0.1:9' : true) } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined, error: () => undefined, notify: () => ({ close: () => undefined }) } as unknown as INotificationService;
		const workspaceService = { getWorkspace: () => ({ folders: [{ uri: URI.file('/ws'), name: 'ws' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;
		const clipboardService = { writeText: async () => undefined } as unknown as IClipboardService;
		const commandService = { executeCommand: async () => undefined } as unknown as ICommandService;
		const service = new LivingDocsService(fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService, new NullAnalyticsService(), store.add(new InMemoryStorageService()), commandService, clipboardService, { isVisible: () => false } as unknown as IWorkbenchLayoutService);
		store.add(service);
		return { service, setOnDisk: (resource, text) => files.set(resource.toString(), text) };
	}

	/** What a click would read for this change right now: the route, straight off the live report. */
	function route(service: LivingDocsService, resource: URI, changeId: string): string {
		return changePointerRoute(service.getInlineWidgets(resource), changeId);
	}

	test('the exact stranding sequence: a report does not survive the surface that made it', async () => {
		// Walked as the validator walked it, at the service seam. Every step is what the live product does: the
		// editor reports after its decoration pass, `clearInput` retires the report as the tab closes, the file
		// changes underneath, and reopening loads it again.
		const { service, setOnDisk } = createService();
		const seen: string[] = [];

		await service.loadDocument(WEEKLY);
		service.reportInlineWidgets(WEEKLY, ['c1'], ['c1']);
		seen.push(`open+reported: ${route(service, WEEKLY, 'c1')}`);

		// The tab is closed. Nothing is watching this document any more, so nothing may speak for it.
		service.clearInlineWidgets(WEEKLY);
		seen.push(`closed: ${route(service, WEEKLY, 'c1')}`);

		// Something outside Abstract rewrites the paragraph the proposal was anchored to.
		setOnDisk(WEEKLY, WEEKLY_MD_REWRITTEN);

		// The click reopens the document. The load retires anything remembered, so the click waits for the fresh
		// surface rather than acting on a memory - and the fresh surface reports the truth: asked, not mounted.
		await service.loadDocument(WEEKLY);
		seen.push(`reopened: ${route(service, WEEKLY, 'c1')}`);
		service.reportInlineWidgets(WEEKLY, ['c1'], []);
		seen.push(`resurfaced: ${route(service, WEEKLY, 'c1')}`);

		assert.deepStrictEqual(seen, [
			// The widget is really there: the pointer takes the reader to it.
			'open+reported: document',
			// Nobody is looking. Not "there is nothing there" - "nothing has looked", which is what makes the
			// click wait for an answer instead of trusting the one it remembers. This is the whole fix.
			'closed: unknown',
			'reopened: unknown',
			// The truth, observed: Review is the only surface that can show this change, so that is where it goes.
			'resurfaced: review',
		]);
	});

	test('retiring is scoped, announced once, and silent when there is nothing to retire', async () => {
		// Scoped, because one turn can propose across documents and closing one must not blind the rail to the
		// other. Announced, because the transcript's route markers are rendered from the report and have to
		// follow it. Silent on a no-op, because `loadDocument` retires on every load - including the many loads
		// of documents nobody has ever looked at - and each announcement re-renders the rail.
		const { service } = createService();
		const announced: string[] = [];
		store.add(service.onDidReportInlineWidgets(e => announced.push(e.docId)));

		service.reportInlineWidgets(WEEKLY, ['c1'], ['c1']);
		service.reportInlineWidgets(BOARD, ['c2'], ['c2']);
		service.clearInlineWidgets(WEEKLY);
		// Already retired: nothing changes, so nothing is announced.
		service.clearInlineWidgets(WEEKLY);
		// Never reported at all: likewise silent.
		service.clearInlineWidgets(URI.file('/ws/never-opened.md'));
		// A load retires the loaded document's report, and only that one.
		await service.loadDocument(BOARD);

		assert.deepStrictEqual({
			weekly: route(service, WEEKLY, 'c1'),
			board: route(service, BOARD, 'c2'),
			announced,
		}, {
			weekly: 'unknown',
			board: 'unknown',
			announced: [WEEKLY.toString(), BOARD.toString(), WEEKLY.toString(), BOARD.toString()],
		});
	});
});
