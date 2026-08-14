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
import { AMBER, GREEN, PAPER, RED } from '../../common/abstractTokens.js';

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

	// A service whose /healthz is driven by a MUTABLE `brokerUp` flag the test toggles (not a positional
	// sequence), so the down->up recovery is deterministic regardless of how the constructor's startup probe
	// and the status probe interleave against a shared counter. `reprobeMs` is short so the down-recovery
	// interval fires promptly. Returns the flag setter + a health-probe counter + a change counter.
	function createFlagService(reprobeMs: number): { service: LivingDocsService; setBrokerUp: (up: boolean) => void; healthCalls: () => number; changes: () => number; lastReadiness: () => string | undefined } {
		let healthCalls = 0;
		let brokerUp = false;
		const requestService = {
			request: async (options: { url?: string }) => {
				const url = options.url ?? '';
				let payload: object = {};
				if (url.includes('/healthz')) {
					healthCalls++;
					if (!brokerUp) { throw new Error('ECONNREFUSED'); }
					payload = { ok: true, backend: 'openrouter', reason: 'ready', meters: true, signedIn: false, dailyBudgetUsd: 1, dailyTotalUsd: 0 };
				} else if (url.includes('/models')) {
					payload = MODELS_BODY;
				}
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(payload))) };
			},
		} as unknown as IRequestService;
		const fileService = { onDidFilesChange: Event.None, onDidChangeFileSystemProviderRegistrations: Event.None, onDidChangeFileSystemProviderCapabilities: Event.None } as unknown as IFileService;
		const editorService = { openEditor: async () => undefined, onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		const configurationService = { getValue: (key?: string) => (key === 'livingDocs.modelProxyUrl' ? 'http://127.0.0.1:9' : true) } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const workspaceService = { getWorkspace: () => ({ folders: [] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;
		const clipboardService = { writeText: async () => undefined } as unknown as IClipboardService;
		const commandService = { executeCommand: async () => undefined } as unknown as ICommandService;
		const storage = store.add(new InMemoryStorageService());
		const service = new LivingDocsService(fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService, new NullAnalyticsService(), storage, commandService, clipboardService, { isVisible: () => false } as unknown as IWorkbenchLayoutService);
		service.setBrokerDownReprobeMsForTest(reprobeMs);
		store.add(service);
		let changes = 0;
		// Track the settled readiness the same way the rail consumer does: onDidChange (the real-transition signal)
		// drives a read of the cached status. This gives the tests a synchronous view of the settled state without
		// a test-only accessor on the service. The initial seed is captured by the first getModelProviderStatus.
		let lastReadiness: string | undefined;
		store.add(service.onDidChange(() => { changes++; void service.getModelProviderStatus().then(s => { lastReadiness = s.readiness; }); }));
		return { service, setBrokerUp: (up: boolean) => { brokerUp = up; }, healthCalls: () => healthCalls, changes: () => changes, lastReadiness: () => lastReadiness };
	}

	// Poll until `predicate` holds or `budgetMs` elapses, yielding to the event loop so the interval's async
	// probe can settle. Returns true if the predicate held in time; a timeout returns false (a failed test).
	async function waitFor(predicate: () => boolean, budgetMs = 2000): Promise<boolean> {
		const deadline = Date.now() + budgetMs;
		while (Date.now() < deadline) {
			if (predicate()) { return true; }
			await new Promise(r => setTimeout(r, 5));
		}
		return predicate();
	}

	// A service whose /healthz answers a fixed body, so a test can assert how a specific wire shape maps to the
	// IModelProviderStatus the composer + Model Access read. Used to pin the signed-in-but-cannot-serve mapping.
	function createServiceWithHealth(healthBody: object): LivingDocsService {
		const requestService = {
			request: async (options: { url?: string }) => {
				const url = options.url ?? '';
				const payload: object = url.includes('/healthz') ? healthBody : (url.includes('/models') ? MODELS_BODY : {});
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(payload))) };
			},
		} as unknown as IRequestService;
		const fileService = { onDidFilesChange: Event.None, onDidChangeFileSystemProviderRegistrations: Event.None, onDidChangeFileSystemProviderCapabilities: Event.None } as unknown as IFileService;
		const editorService = { openEditor: async () => undefined, onDidActiveEditorChange: Event.None, activeEditor: undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
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
		return service;
	}

	// The signed-in-but-cannot-serve state (plan 51 WP-D; #120/#259): the broker's /healthz reports a valid,
	// serving OpenRouter door (ok:true, backend:openrouter) WHILE a ChatGPT bundle is on disk (signedIn:true) -
	// the ChatGPT door is signed in but not the one answering. The composer + Model Access key off exactly these
	// three fields to say so honestly, so the mapping is pinned here: provider must be `included` (the door that
	// answered), signedIn must stay true, and readiness ready - never a provider:'chatgpt' that would falsely
	// claim ChatGPT is serving.
	test('signed in to ChatGPT but the included door serves -> provider:included + signedIn:true (the composer fallback truth)', async () => {
		const service = createServiceWithHealth({ ok: true, backend: 'openrouter', reason: 'ready', meters: true, signedIn: true, dailyBudgetUsd: 1, dailyTotalUsd: 0.2 });
		const status = await service.getModelProviderStatus();
		assert.deepStrictEqual(
			{ provider: status.provider, signedIn: status.signedIn, readiness: status.readiness },
			{ provider: 'included', signedIn: true, readiness: 'ready' },
		);
	});

	// The contrast case: when ChatGPT actually IS the serving door, provider is `chatgpt` and the composer stays
	// silent (no fallback line), so the two states never blur.
	test('ChatGPT actually serving -> provider:chatgpt + signedIn:true (no fallback line)', async () => {
		const service = createServiceWithHealth({ ok: true, backend: 'openai-oauth', reason: 'ready', meters: false, signedIn: true, dailyBudgetUsd: 1 });
		const status = await service.getModelProviderStatus();
		assert.deepStrictEqual(
			{ provider: status.provider, signedIn: status.signedIn },
			{ provider: 'chatgpt', signedIn: true },
		);
	});

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
			readyDot: GREEN.base,
			pausedDot: AMBER.base,
			downDot: RED.base,
			unconfiguredDot: RED.base,
			unknownDot: PAPER.frameBorder,
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

	// --- D1: down->up recovery within a session (issue #236, VALIDATION ROUND 1 D1) ---
	// The flicker fix serves `broker-down` from the settled cache without re-probing while idle, so a broker that
	// recovers mid-session never returned the control to green. These pin the low-frequency background re-probe:
	// it runs only while DOWN and watched, transitions up exactly once, does not probe on the UP path, and stops
	// on disposal (no orphan timer). A short reprobe interval + a mutable broker flag make it deterministic.

	test('down + watched -> the background probe fires on the interval and transitions up EXACTLY once (D1)', async () => {
		const { service, setBrokerUp, healthCalls, changes, lastReadiness } = createFlagService(5);
		// Seed the settled DOWN state (broker unreachable): getModelProviderStatus awaits the first probe.
		const seeded = await service.getModelProviderStatus();
		// Register a mounted consumer's interest: with the status down, this arms the re-probe interval.
		const watch = service.watchProviderStatus();
		const probesAtWatch = healthCalls();
		const changesAtWatch = changes();
		// The broker recovers. The idle interval must re-probe (no getModelProviderStatus caller drives it),
		// pick up the recovery, settle to ready, and fire onDidChange exactly once for the real down->up flip.
		setBrokerUp(true);
		const recovered = await waitFor(() => lastReadiness() === 'ready');
		// After recovery, the reconcile cancels the interval, so no further probes accrue: let time pass and
		// confirm the probe count stabilises (the timer stopped) and the status held ready with one change.
		await new Promise(r => setTimeout(r, 40));
		const probesAfterSettle = healthCalls();
		await new Promise(r => setTimeout(r, 40));
		watch.dispose();
		assert.deepStrictEqual({
			seededDown: seeded.readiness === 'broker-down',
			recovered,
			reprobedWhileDown: healthCalls() > probesAtWatch,
			finalReadiness: lastReadiness(),
			changesForRecovery: changes() - changesAtWatch,
			timerStoppedAfterRecovery: healthCalls() === probesAfterSettle,
		}, {
			seededDown: true,
			recovered: true,
			reprobedWhileDown: true,
			finalReadiness: 'ready',
			changesForRecovery: 1,
			timerStoppedAfterRecovery: true,
		});
	});

	test('up + watched -> NO interval probing (the flicker fix UP path is preserved) (D1)', async () => {
		const { service, setBrokerUp, healthCalls } = createFlagService(5);
		setBrokerUp(true);
		const seeded = await service.getModelProviderStatus();
		const watch = service.watchProviderStatus();
		const probesAtWatch = healthCalls();
		// The status is ready, so watching must NOT arm the interval: after several interval periods elapse,
		// zero additional probes have fired. This is exactly the settled-cache behaviour that killed the flicker.
		await new Promise(r => setTimeout(r, 60));
		const added = healthCalls() - probesAtWatch;
		watch.dispose();
		assert.deepStrictEqual({ ready: seeded.readiness, intervalProbes: added }, { ready: 'ready', intervalProbes: 0 });
	});

	test('disposing the watcher stops the down-recovery interval (no orphan timer) (D1)', async () => {
		const { service, healthCalls } = createFlagService(5);
		// Down + watched arms the interval; it re-probes (broker stays down) so the count climbs.
		await service.getModelProviderStatus();
		const watch = service.watchProviderStatus();
		await waitFor(() => healthCalls() > 1);
		// Unwatch: the interval must stop. After disposal, let several periods pass; the probe count is frozen.
		watch.dispose();
		const frozenAt = healthCalls();
		await new Promise(r => setTimeout(r, 60));
		assert.deepStrictEqual({ stoppedAfterDispose: healthCalls() === frozenAt }, { stoppedAfterDispose: true });
	});
});
