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
import { modelDoorWords, modelHealthDotColour, modelStateWords } from '../../browser/reviewRailView.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { AMBER, GREEN, PAPER, RED } from '../../common/abstractTokens.js';
import { ensureNoNetworkInTestSuite } from '../common/networkSentinel.js';

// Plan 47 bundle 47-b (issue #236): the composer model selector. These pin the two behaviours the loop's
// validator cares about but a live broker can only demonstrate flakily: the honest health-state settling that
// kills the "Model unavailable" flash on surface crossings (#211-4 / P14.5), and the per-workspace persistence
// of the model choice under the `livingDocs.v2.model` key (P14.4). Deterministic, no live broker, no DOM.
suite('livingDocs model selector (plan 47 47-b, issue #236)', () => {
	// Ticket #375: no test in this suite may reach the network directly. Every attempt at a global network
	// primitive is recorded at the call and refused, so the only route out is IRequestService - injected,
	// and doubled below.
	ensureNoNetworkInTestSuite();
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
	function createServiceWithHealth(healthBody: object, modelsBody: object = MODELS_BODY): LivingDocsService {
		const requestService = {
			request: async (options: { url?: string }) => {
				const url = options.url ?? '';
				const payload: object = url.includes('/healthz') ? healthBody : (url.includes('/models') ? modelsBody : {});
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

	// Plan 55 WP-B3 (founder ruling 9.1): the broker now routes by MODEL id, so each row's `door` is literally
	// where that call goes and whose credits pay for it - which is what the picker labels every row with. The
	// mapping has to survive an older broker too (the field is additive), so the fallbacks are pinned alongside:
	// an absent `door` is derived from the tier (exact today - a door serves exactly one tier), and an absent
	// `available` stays true so an older broker's rows do not all grey out.
	test('the /models catalogue carries a door and its live availability per row, with honest fallbacks for an older broker', async () => {
		const service = createServiceWithHealth(
			{ ok: true, backend: 'openrouter', reason: 'ready', meters: true, signedIn: false, dailyBudgetUsd: 1 },
			{
				backend: 'openrouter', models: [
					{ id: 'included-a', label: 'Included A', default: true, tier: 'included', door: 'openrouter', available: true },
					// A signed-out OAuth door: the row is honestly unavailable rather than looking selectable.
					{ id: 'own-a', label: 'Own A', default: false, tier: 'own-key', door: 'openai-oauth', available: false },
					// An older broker: `backend` is `door`'s alias, and no `available` field at all.
					{ id: 'legacy-alias', label: 'Legacy Alias', default: false, tier: 'own-key', backend: 'openai-oauth' },
					// An older broker still: neither field, so the tier decides the door.
					{ id: 'legacy-bare', label: 'Legacy Bare', default: false, tier: 'included' },
				]
			},
		);
		const catalogue = await service.getModelCatalogue();
		assert.deepStrictEqual(catalogue.models.map(m => ({ id: m.id, door: m.door, available: m.available })), [
			{ id: 'included-a', door: 'openrouter', available: true },
			{ id: 'own-a', door: 'openai-oauth', available: false },
			{ id: 'legacy-alias', door: 'openai-oauth', available: true },
			{ id: 'legacy-bare', door: 'openrouter', available: true },
		]);
	});

	// The words on every row (founder ruling 9.1). Short by design: they sit beside the model's own name.
	test('every model row names its provider - the user own account vs the included tier', () => {
		assert.deepStrictEqual(
			{ ownAccount: modelDoorWords('openai-oauth'), included: modelDoorWords('openrouter') },
			{ ownAccount: 'Your account', included: 'Included' },
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

	// Plan 55 WP-B3: the catalogue now merges BOTH doors and the broker routes by model id, so a pick on a
	// signed-out door no longer quietly falls back - it fails with a typed `door_unavailable`. That makes an
	// unavailable id as dead as a stale one, and this is the case that would otherwise bite hardest: a
	// signed-out user whose catalogue happens to list a ChatGPT model first would have every single send fail
	// before they had chosen anything. The stored pick still wins whenever its own door is up.
	test('an unavailable model is stepped over like a stale one - a signed-out door never becomes the default pick', async () => {
		const modelsBody = {
			backend: 'openrouter', models: [
				// First in the list AND flagged default, but its door is signed out.
				{ id: 'own-first', label: 'Own First', default: true, tier: 'own-key', door: 'openai-oauth', available: false },
				{ id: 'included-a', label: 'Included A', default: true, tier: 'included', door: 'openrouter', available: true },
				{ id: 'included-b', label: 'Included B', default: false, tier: 'included', door: 'openrouter', available: true },
			]
		};
		const health = { ok: true, backend: 'openrouter', reason: 'ready', meters: true, signedIn: false, dailyBudgetUsd: 1 };
		const fresh = createServiceWithHealth(health, modelsBody);
		const unpicked = await fresh.getSelectedModelId();

		// A deliberate pick on an AVAILABLE model is honoured verbatim, not second-guessed.
		const picked = createServiceWithHealth(health, modelsBody);
		await picked.setSelectedModelId('included-b');
		const afterPick = await picked.getSelectedModelId();

		// A pick left over from when that door WAS signed in steps aside rather than failing every send.
		const stale = createServiceWithHealth(health, modelsBody);
		await stale.setSelectedModelId('own-first');
		const afterSignOut = await stale.getSelectedModelId();

		assert.deepStrictEqual({ unpicked, afterPick, afterSignOut }, {
			unpicked: 'included-a',
			afterPick: 'included-b',
			afterSignOut: 'included-a',
		});
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
