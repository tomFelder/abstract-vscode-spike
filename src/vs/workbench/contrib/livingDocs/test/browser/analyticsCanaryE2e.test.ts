/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { AnalyticsEventName, AnalyticsProps, IAnalyticsService, lintEventProps } from '../../common/analytics.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';

// Plan 36 iter 2 - THE END-TO-END CANARY. A fixture Living Document carries a confidential canary string in
// its body and its bound source value. We drive the real emitting paths (chat -> proposal -> approve/reject,
// sync, export, publish) through the real LivingDocsService and assert that NO captured analytics payload
// contains the canary, and that every captured payload passes the property-linter. This is the executable
// form of the privacy invariant: content cannot leave the machine as analytics even when it flows through the
// live service, not just the linter in isolation.
suite('analytics canary E2E (plan 36 iter 2: content never leaves via the live service)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	// The canary appears in the document prose, a heading, and the bound figure value.
	const CANARY = 'ACME-Q3-CONFIDENTIAL-CANARY-49800-Jane-Doe';

	const FOLDER = URI.file('/ws');
	const DOC = URI.file('/ws/report.md');
	const CSV = URI.file('/ws/metrics.csv');
	const DOC_MD = [
		'---',
		'living: true',
		'sources:',
		'  - metrics.csv',
		'---',
		'# Weekly Report',
		'',
		`Commentary: ${CANARY} drove the quarter, up sharply.`,
		'',
		`Revenue reached [${CANARY}](bind:metrics.mrr) this period.`,
		'',
	].join('\n');
	const CSV_TEXT = `mrr\n${CANARY}\n`;

	// A recording analytics service that keeps every captured event + props, and enforces the linter on the
	// way in exactly as the real service does (so a leak that the real service would drop is still recorded as
	// a linter finding here, not silently accepted). Implements the real IAnalyticsService (no `any` fake).
	class RecordingAnalytics implements IAnalyticsService {
		declare readonly _serviceBrand: undefined;
		readonly hasChosen = true;
		readonly isEnabled = true;
		readonly events: { event: string; props: AnalyticsProps }[] = [];
		readonly lintFindings: string[] = [];
		setConsent(): void { /* always on for this test */ }
		capture(event: AnalyticsEventName, props: AnalyticsProps = {}): void {
			for (const e of lintEventProps(event, props)) { this.lintFindings.push(`${event}.${e.key}: ${e.reason}`); }
			this.events.push({ event, props });
		}
		identify(): void { /* not exercised here */ }
	}

	function makeService(analytics: RecordingAnalytics) {
		const files = new Map<string, string>([[DOC.toString(), DOC_MD], [CSV.toString(), CSV_TEXT]]);
		const fileService = {
			onDidChangeFileSystemProviderRegistrations: Event.None,
			readFile: async (r: URI) => {
				const c = files.get(r.toString());
				if (c === undefined) { throw new Error(`not found: ${r}`); }
				return { value: VSBuffer.fromString(c) };
			},
			writeFile: async (r: URI, b: VSBuffer) => { files.set(r.toString(), b.toString()); },
			resolve: async (r: URI) => {
				const prefix = r.toString().replace(/\/+$/, '') + '/';
				const children: { resource: URI; isDirectory: boolean }[] = [];
				for (const key of files.keys()) {
					if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
						children.push({ resource: URI.parse(key), isDirectory: false });
					}
				}
				return { children };
			},
		} as unknown as IFileService;
		const editorService = { openEditor: async () => undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		const configurationService = { getValue: () => true, onDidChangeConfiguration: Event.None } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		// A model proxy that is "healthy" and returns a chat reply proposing an edit whose new text ALSO carries
		// the canary - the worst case: even a proposal built from confidential prose must not leak into analytics.
		const modelReply = JSON.stringify({ reply: '', edits: [{ heading: 'Weekly Report', oldText: `Commentary: ${CANARY} drove the quarter, up sharply.`, newText: `Commentary: ${CANARY} held steady this quarter.`, rationale: 'tone' }], inserts: [] });
		const requestService = {
			request: async (options: { url?: string }) => {
				const url = options.url ?? '';
				let payload: object = { ok: true };
				if (url.includes('/v1/messages')) { payload = { content: [{ type: 'text', text: modelReply }] }; }
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(payload))) };
			},
		} as unknown as IRequestService;
		const workspaceService = { getWorkspace: () => ({ folders: [{ uri: FOLDER, name: 'ws' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;
		const commandService = { executeCommand: async () => undefined } as unknown as ICommandService;
		const service = new LivingDocsService(
			fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(),
			requestService, workspaceService, fileDialogService, hostService, analytics, store.add(new InMemoryStorageService()), commandService);
		store.add(service);
		return service;
	}

	test('driving the live emitters over a canary document leaks nothing into any analytics payload', async () => {
		const analytics = new RecordingAnalytics();
		const service = makeService(analytics);
		await service.loadDocument(DOC);

		// Drive the paths that emit: a chat proposal (proposal_created), sync (source_synced), export/publish
		// (export_or_publish), a skill (skill_invoked), and resolve the proposal (proposal_resolved) + restore.
		await service.sendChatMessage(DOC, 'Please refine the commentary.');
		const pending = service.getPendingForDoc(DOC);
		await service.syncFromSources(DOC);
		// The HTML/Markdown export renderers depend on a real DOM (dompurify), unavailable in this offline
		// harness; their export_or_publish emit fires only when the render succeeds, so wrap them and let the
		// DOM-independent emitters (publish, skill, peek, resolve) carry the canary assertion regardless.
		try { await service.exportDocument(DOC); } catch { /* render needs a real DOM */ }
		try { await service.exportMarkdown(DOC); } catch { /* render needs a real DOM */ }
		await service.publishDocument(DOC);
		await service.runSkillCheck(DOC, 'formatting');
		service.notePeek('click-through');
		if (pending.length) {
			await service.approve(pending[0].id);
		}

		// The whole recorded stream, serialised. The canary must not appear anywhere in it.
		const serialised = JSON.stringify(analytics.events);
		const containsCanary = serialised.includes(CANARY) || serialised.toLowerCase().includes('confidential');
		assert.deepStrictEqual(
			{ containsCanary, lintFindings: analytics.lintFindings, capturedSomething: analytics.events.length > 0 },
			{ containsCanary: false, lintFindings: [], capturedSomething: true },
			`analytics stream: ${serialised}`);
	});
});
