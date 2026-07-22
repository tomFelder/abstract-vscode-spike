/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { NullAnalyticsService } from '../../common/analytics.js';
import { modelHealthDotColour, modelStateWords } from '../../browser/reviewRailView.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';

// Plan 47 bundle 47-b (issue #236): the composer model selector. These pin the two behaviours the loop's
// validator cares about but a live broker can only demonstrate flakily: the honest health-state settling that
// kills the "Model unavailable" flash on surface crossings (#211-4 / P14.5), and the per-workspace persistence
// of the model choice under the `livingDocs.v2.model` key (P14.4). Deterministic, no live broker, no DOM.
suite('livingDocs model selector (plan 47 47-b, issue #236)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	// A /models catalogue with two included models so persistence + validation have something to switch between.
	const MODELS_BODY = {
		backend: 'openrouter', models: [
			{ id: 'model-a', label: 'Model A', default: true, tier: 'included' },
			{ id: 'model-b', label: 'Model B', default: false, tier: 'included' },
		]
	};

	// Build a service whose /healthz answers a SCRIPTED sequence of `ok` values (one per call, last repeats) and
	// whose /models returns MODELS_BODY. `healthSeq` lets a test drive broker-up -> broker-down -> broker-up and
	// count how many times the readiness actually changed. A real InMemoryStorageService backs persistence.
	function createService(healthSeq: boolean[]): { service: LivingDocsService; storage: InMemoryStorageService; healthCalls: () => number; changes: () => number } {
		let healthCalls = 0;
		const requestService = {
			request: async (options: { url?: string }) => {
				const url = options.url ?? '';
				let payload: object = {};
				if (url.includes('/healthz')) {
					const ok = healthSeq[Math.min(healthCalls, healthSeq.length - 1)];
					healthCalls++;
					payload = ok ? { ok: true, backend: 'openrouter', reason: 'ready', meters: true, signedIn: false, dailyBudgetUsd: 1, dailyTotalUsd: 0 } : {};
					// A broker-down /healthz is a transport failure, not an ok:false body; model the down case by throwing.
					if (!ok) { throw new Error('ECONNREFUSED'); }
				} else if (url.includes('/models')) {
					payload = MODELS_BODY;
				}
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(payload))) };
			},
		} as unknown as IRequestService;

		const fileService = { onDidFilesChange: Event.None, onDidChangeFileSystemProviderRegistrations: Event.None, onDidChangeFileSystemProviderCapabilities: Event.None } as unknown as IFileService;
		const editorService = { openEditor: async () => undefined, onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		// useModel true; modelProxyUrl points at a dead port so no real broker is ever contacted (the stub answers).
		const configurationService = { getValue: (key?: string) => (key === 'livingDocs.modelProxyUrl' ? 'http://127.0.0.1:9' : true) } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const workspaceService = { getWorkspace: () => ({ folders: [] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;
		const clipboardService = { writeText: async () => undefined } as unknown as IClipboardService;
		const commandService = { executeCommand: async () => undefined } as unknown as ICommandService;
		const storage = store.add(new InMemoryStorageService());
		const service = new LivingDocsService(fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService, new NullAnalyticsService(), storage, commandService, clipboardService, { isVisible: () => false } as unknown as IWorkbenchLayoutService);
		store.add(service);
		let changes = 0;
		store.add(service.onDidChange(() => changes++));
		return { service, storage, healthCalls: () => healthCalls, changes: () => changes };
	}

	test('the readiness -> health-dot colour + plain-words mapping is honest per state (P14.5)', () => {
		assert.deepStrictEqual({
			readyDot: modelHealthDotColour('ready'),
			pausedDot: modelHealthDotColour('budget-paused'),
			downDot: modelHealthDotColour('broker-down'),
			unconfiguredDot: modelHealthDotColour('unconfigured'),
			unknownDot: modelHealthDotColour(undefined),
			pausedWords: modelStateWords('budget-paused'),
			downWords: modelStateWords('broker-down'),
			unconfiguredWords: modelStateWords('unconfigured'),
		}, {
			readyDot: '#2c8159',
			pausedDot: '#c99a2e',
			downDot: '#b5514b',
			unconfiguredDot: '#b5514b',
			unknownDot: '#c6cad2',
			pausedWords: 'Daily limit reached',
			downWords: 'Model unavailable',
			unconfiguredWords: 'Model unavailable',
		});
	});

	test('the settled provider status is cached and reused, so a repeated read does NOT re-probe (P14.5 flicker fix)', async () => {
		const { service, healthCalls } = createService([true]);
		const first = await service.getModelProviderStatus();
		const afterFirst = healthCalls();
		// A burst of reads within the TTL (the surface-crossing remount pattern) must reuse the settled cache:
		// ZERO additional /healthz probes over the burst, and the SAME settled `ready` state every time - never a
		// transient broker-down. (The absolute count also folds in the constructor's startup probe; what matters
		// for the flicker fix is that the burst adds nothing on top of the settled read.)
		const repeats = await Promise.all([service.getModelProviderStatus(), service.getModelProviderStatus(), service.getModelProviderStatus()]);
		assert.deepStrictEqual({
			firstReadiness: first.readiness,
			burstAddedProbes: healthCalls() - afterFirst,
			everyRepeatReady: repeats.every(r => r.readiness === 'ready'),
		}, {
			firstReadiness: 'ready',
			burstAddedProbes: 0,
			everyRepeatReady: true,
		});
	});

	test('a stable broker never fires a spurious onDidChange from repeated status reads (no flicker churn)', async () => {
		const { service, changes } = createService([true]);
		await service.getModelProviderStatus();
		const afterSeed = changes();
		await service.getModelProviderStatus();
		await service.getModelProviderStatus();
		// The first probe may fire once (undefined -> ready is a real change); further reads on a stable broker
		// must not churn onDidChange, because that is exactly what would blink the composer's health dot.
		assert.deepStrictEqual({ changesAfterSeed: afterSeed, changesAfterRepeats: changes(), settledUnchanged: afterSeed === changes() }, { changesAfterSeed: afterSeed, changesAfterRepeats: afterSeed, settledUnchanged: true });
	});

	test('the model choice persists under livingDocs.v2.model at WORKSPACE scope (P14.4)', async () => {
		const { service, storage } = createService([true]);
		// Default before any pick: the catalogue's default model (model-a).
		assert.strictEqual(await service.getSelectedModelId(), 'model-a');
		await service.setSelectedModelId('model-b');
		assert.deepStrictEqual({
			stored: storage.get('livingDocs.v2.model', StorageScope.WORKSPACE),
			notApplication: storage.get('livingDocs.v2.model', StorageScope.APPLICATION),
			selected: await service.getSelectedModelId(),
		}, {
			stored: 'model-b',
			notApplication: undefined,
			selected: 'model-b',
		});
	});

	test('a stale/unknown persisted id resolves to the catalogue default, never a dead selection (P14.4)', async () => {
		const { service, storage } = createService([true]);
		// Persist an id the catalogue does not offer (e.g. left over from a since-swapped backend).
		storage.store('livingDocs.v2.model', 'model-gone', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		assert.strictEqual(await service.getSelectedModelId(), 'model-a');
		// setSelectedModelId ignores an unknown id, so a bad caller can never pin a dead selection.
		await service.setSelectedModelId('model-also-gone');
		assert.strictEqual(storage.get('livingDocs.v2.model', StorageScope.WORKSPACE), 'model-gone');
	});
});
