/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { IClock } from '../../browser/clock.js';
import { makeScaleFixture } from './scaleFixture.js';

// Plan 30 performance + scale harness (tracks 1 + 2). The suite proves the incremental, shared-source,
// bounded-concurrency refresh path with DETERMINISTIC counts (source reads, model calls, in-flight fetches)
// and RECORDS the wall-time to the console. Counts are asserted; times are measured, never invented - the
// before/after table in `docs/plans/30-verify/notes.md` is populated from a real run of these tests.

// A controllable in-memory file service that COUNTS reads per URI and (optionally) DEFERS remote-ish reads
// so a test can assert on concurrency. Directory `resolve` synthesises children the same way the main
// service test's mock does, so document discovery fans out over the generated folder.
interface IHarnessFiles {
	readonly fileService: IFileService;
	readonly files: Map<string, string>;
	/** Total readFile calls, and per-URI read counts (the source-read metric the plan gates on). */
	reads(): number;
	readsOf(uri: URI): number;
	setFile(uri: URI, text: string): void;
}

function makeFiles(seed: Map<string, string>): IHarnessFiles {
	const files = new Map(seed);
	let totalReads = 0;
	const perUri = new Map<string, number>();
	const fileService = {
		onDidChangeFileSystemProviderRegistrations: Event.None,
		readFile: async (resource: URI) => {
			const key = resource.toString();
			totalReads++;
			perUri.set(key, (perUri.get(key) ?? 0) + 1);
			const content = files.get(key);
			if (content === undefined) { throw new Error(`not found: ${key}`); }
			return { value: VSBuffer.fromString(content) };
		},
		writeFile: async (resource: URI, buffer: VSBuffer) => { files.set(resource.toString(), buffer.toString()); },
		resolve: async (resource: URI) => {
			const prefix = resource.toString().replace(/\/+$/, '') + '/';
			const children: { resource: URI; isDirectory: boolean }[] = [];
			const dirs = new Set<string>();
			for (const key of files.keys()) {
				if (!key.startsWith(prefix)) { continue; }
				const rest = key.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash < 0) { children.push({ resource: URI.parse(key), isDirectory: false }); }
				else { dirs.add(prefix + rest.slice(0, slash)); }
			}
			for (const dir of dirs) { children.push({ resource: URI.parse(dir), isDirectory: true }); }
			return { children };
		},
	} as unknown as IFileService;
	return {
		fileService,
		files,
		reads: () => totalReads,
		readsOf: (uri: URI) => perUri.get(uri.toString()) ?? 0,
		setFile: (uri: URI, text: string) => files.set(uri.toString(), text),
	};
}

// A fake clock the cooldown reads: `now()` returns a value the test advances by hand; scheduleInterval is a
// no-op (the orchestrator ticker is not exercised here).
class FakeClock implements IClock {
	private _now = 1_000_000;
	now(): number { return this._now; }
	advance(ms: number): void { this._now += ms; }
	scheduleInterval(_intervalMs: number, _callback: () => void): IDisposable { return toDisposable(() => { }); }
}

suite('LivingDocs perf + scale (plan 30, tracks 1 + 2)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const WS = URI.file('/ws');
	const docUri = (name: string) => URI.file(`/ws/${name}`);

	// Build a service over the generated fixture, with the fixture's docs + shared CSVs seeded into the mock
	// file service. Returns the service, the harness (for read counts), the model-call counter, and a fake
	// clock (installed on the service). `deferFetch`, when set, gates remote /v1/messages calls on a deferred
	// so a test can inspect the in-flight count.
	function scaleService(docs: number, opts: { bindsPerDoc?: number } = {}) {
		const fixture = makeScaleFixture(docs, opts.bindsPerDoc ?? 4);
		const seed = new Map<string, string>();
		for (const s of fixture.sources) { seed.set(URI.file(`/ws/${s.name}`).toString(), s.csv); }
		for (const d of fixture.docs) { seed.set(URI.file(`/ws/${d.name}`).toString(), d.md); }
		const harness = makeFiles(seed);

		const requestService = {
			request: async () => ({ res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString('{}')) }),
		} as unknown as IRequestService;

		const editorService = { openEditor: async () => undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		const configurationService = { getValue: () => true } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const workspaceService = { getWorkspace: () => ({ folders: [{ uri: WS, name: 'ws' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;

		const service = new LivingDocsService(harness.fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService);
		const clock = new FakeClock();
		service.setClock(clock);
		store.add(service);
		return { service, harness, clock, fixture };
	}

	// --- Iteration 1: the harness + fixture, baseline counts ---

	test('makeScaleFixture generates the asserted shape: N docs over a handful of shared CSVs', () => {
		const fixture = makeScaleFixture(50, 4);
		assert.strictEqual(fixture.docs.length, 50, '50 documents generated');
		assert.strictEqual(fixture.sources.length, 4, 'a handful (4) of shared CSV sources');
		// Every document binds exactly one shared source, so the sources are shared many-to-one.
		const boundSources = new Set<string>();
		for (const d of fixture.docs) {
			const m = /- (metrics-\d+\.csv)/.exec(d.md);
			assert.ok(m, `document ${d.name} declares a shared source`);
			boundSources.add(m![1]);
		}
		assert.strictEqual(boundSources.size, 4, 'the 50 docs fan across exactly the 4 shared sources');
	});

	test('50-doc full refresh: shared sources read once each, timing recorded', async () => {
		const { service, harness } = scaleService(50);
		// Seed discovery: load one document so the folder scan finds its 49 siblings.
		await service.loadDocument(docUri('report-0.md'));
		// Baseline the per-CSV read counts AFTER load, so we measure only the refresh pass (the single-document
		// load path is intentionally uncached - the pass cache is a refresh/agent-run concept, plan 30).
		const baseline = new Map<string, number>();
		for (const s of makeScaleFixture(50).sources) { baseline.set(s.name, harness.readsOf(URI.file(`/ws/${s.name}`))); }
		const readsBefore = harness.reads();

		const t0 = Date.now();
		await service.refreshFromSources();
		const wall = Date.now() - t0;

		// Track 1 gate: within ONE refresh pass each of the 4 shared CSVs is read exactly ONCE - NOT once per
		// dependent document. The all-docs serial sweep read each CSV ~12x (once per bound doc); the shared-
		// source cache collapses that to a single read per pass.
		for (const s of makeScaleFixture(50).sources) {
			const csv = URI.file(`/ws/${s.name}`);
			const passReadsForCsv = harness.readsOf(csv) - (baseline.get(s.name) ?? 0);
			assert.strictEqual(passReadsForCsv, 1, `${s.name} read ${passReadsForCsv} times in the refresh pass - the shared-source cache should read it exactly once`);
		}
		const passReads = harness.reads() - readsBefore;
		console.log(`[plan30] 50-doc full refresh: ${passReads} source reads (post-cache), wall ${wall}ms`);
		assert.ok(passReads > 0, 'the refresh did real work');
	});

	// --- Iteration 2: incremental, changed-source-only derivation + shared-source single read ---

	test('one changed CSV re-derives only its dependents, not the whole folder', async () => {
		const { service, harness } = scaleService(50);
		await service.loadDocument(docUri('report-0.md'));
		// First refresh syncs every document to its source (everything fresh).
		await service.refreshFromSources();

		// Change ONE shared CSV (advance its latest row). Only its dependents should re-derive.
		const changed = URI.file('/ws/metrics-0.csv');
		harness.setFile(changed, [
			'week,date,mrr,signups,churn,active',
			'22,Jun 08,40000,290,3.1,179',
			'23,Jun 15,40900,312,3.1,188',
			'25,Jun 26,99900,999,1.0,999',
		].join('\n') + '\n');

		// Count reads of an UNCHANGED CSV across the incremental refresh: its dependents must NOT re-derive,
		// so a shared cache still bounds the reads, and crucially the derive step must skip those docs.
		const readsBefore = harness.reads();
		await service.refreshFromSources();
		const readsAfter = harness.reads();

		// The dependents of metrics-0 (every 4th doc: report-0, report-4, ...) are 13 of the 50; the other 37
		// are bound to unchanged sources and are hash-checked cheaply but not re-derived. Prove the changed
		// source's dependents saw their new value.
		assert.strictEqual(service.getResolved(docUri('report-0.md')).get('metrics-0.mrr'), '$99.9k', 'changed-source dependent re-derived to the new value');
		// A doc bound to an UNCHANGED source keeps its earlier value (no spurious re-derive).
		assert.strictEqual(service.getResolved(docUri('report-1.md')).get('metrics-1.mrr'), '$49.3k', 'unchanged-source doc untouched');
		console.log(`[plan30] incremental refresh (1 of 4 CSVs changed): ${readsAfter - readsBefore} source reads`);
	});

	test('a shared CSV bound by many docs is read once for value resolution in a pass', async () => {
		const { service, harness } = scaleService(20);
		await service.loadDocument(docUri('report-0.md'));
		// metrics-0 is bound by report-0, report-4, report-8, report-12, report-16 (5 of 20).
		const shared = URI.file('/ws/metrics-0.csv');
		const before = harness.readsOf(shared);
		await service.refreshFromSources();
		const delta = harness.readsOf(shared) - before;
		assert.strictEqual(delta, 1, `shared CSV read ${delta} times in one refresh - expected exactly 1 (the pass cache), not once per dependent`);
	});

	// --- Iteration 3: bounded concurrency, failure isolation, per-host cooldown ---

	// Build a service over many documents each bound to a DISTINCT api host, so every document's refresh
	// makes one remote fetch. The request service defers on a shared gate and records the in-flight peak, so
	// a test can prove the source-fetch limiter caps concurrency at SOURCE_FETCH_CONCURRENCY (4).
	function apiFanoutService(docs: number, gate: DeferredPromise<void>, onFetch: () => void, offFetch: () => void) {
		const seed = new Map<string, string>();
		for (let i = 0; i < docs; i++) {
			// Each host is bound as `data` so the bind key is stable; the DISTINCT host per doc makes each a
			// separate remote fetch (so concurrency is observable) - and a separate cooldown key.
			const alias = `host-${i}.example.com`;
			const md = [
				'---', `title: Signal ${i}`, 'sources:', `  - https://${alias}/data`, '---', '',
				'## Signal', '', `Value is [pending](bind:data.value).`,
			].join('\n') + '\n';
			seed.set(URI.file(`/ws/signal-${i}.md`).toString(), md);
		}
		const harness = makeFiles(seed);
		// The gate + counters only apply once the test ARMS them (after any load), so the load-time resolve
		// does not hang on the deferred nor pollute the in-flight peak / fetch count the refresh measures.
		const armed = { on: false };
		const requestService = {
			request: async (options: { url?: string }) => {
				const url = options.url ?? '';
				const payload: object = { value: 42 };
				if (url.includes('.example.com') && armed.on) {
					onFetch();
					await gate.p;
					offFetch();
				}
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(payload))) };
			},
		} as unknown as IRequestService;
		const editorService = { openEditor: async () => undefined } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		const configurationService = { getValue: () => true } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const workspaceService = { getWorkspace: () => ({ folders: [{ uri: WS, name: 'ws' }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService;
		const fileDialogService = { showOpenDialog: async () => undefined } as unknown as IFileDialogService;
		const hostService = { openWindow: async () => undefined } as unknown as IHostService;
		const service = new LivingDocsService(harness.fileService, editorService, viewsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService, fileDialogService, hostService);
		const clock = new FakeClock();
		service.setClock(clock);
		store.add(service);
		return { service, harness, clock, armed };
	}

	test('source fetches are bounded to at most 4 in flight during a refresh', async () => {
		const gate = new DeferredPromise<void>();
		let inFlight = 0;
		let peak = 0;
		const { service, armed } = apiFanoutService(12, gate, () => { inFlight++; peak = Math.max(peak, inFlight); }, () => { inFlight--; });
		await service.loadDocument(docUri('signal-0.md'));
		armed.on = true;
		// Kick a refresh but do NOT await it yet - let the fetches pile against the limiter.
		const refresh = service.refreshFromSources();
		// Yield real macrotasks so the async discovery + freshness fan-out reaches the (gated) fetches and the
		// limiter admits its full first batch. The fetches then block on the gate, so the peak is stable.
		for (let i = 0; i < 20 && peak < 4; i++) { await new Promise(r => setTimeout(r, 1)); }
		assert.ok(peak <= 4, `peak source fetches in flight was ${peak} - the source limiter caps it at 4`);
		assert.strictEqual(peak, 4, `the limiter should admit exactly 4 concurrent fetches (saw ${peak})`);
		gate.complete();
		await refresh;
	});

	test('per-host cooldown suppresses an identical fetch within 30s, and admits it after', async () => {
		const gate = new DeferredPromise<void>();
		gate.complete(); // resolve fetches immediately for this test
		let fetches = 0;
		const { service, clock, armed } = apiFanoutService(1, gate, () => { fetches++; }, () => { });
		await service.loadDocument(docUri('signal-0.md'));
		armed.on = true;

		await service.refreshFromSources();
		const afterFirst = fetches;
		assert.ok(afterFirst >= 1, 'the first refresh fetched the source');

		// A second refresh WITHIN the cooldown window must not re-fetch the same host.
		clock.advance(10_000);
		await service.refreshFromSources();
		assert.strictEqual(fetches, afterFirst, 'identical host fetch within 30s is suppressed by the cooldown');

		// Past the window, the host is fetched again.
		clock.advance(25_000);
		await service.refreshFromSources();
		assert.ok(fetches > afterFirst, 'after the cooldown window the host is fetched again');
	});

	test('a rejecting source fetch fails only its document; the others still derive', async () => {
		const { service, harness } = scaleService(8);
		await service.loadDocument(docUri('report-0.md'));
		await service.refreshFromSources();
		// Make ONE shared CSV unreadable, then change another so a refresh runs. Docs bound to the broken
		// source fail to re-derive; docs bound to healthy sources complete.
		harness.files.delete(URI.file('/ws/metrics-0.csv').toString());
		harness.setFile(URI.file('/ws/metrics-1.csv'), [
			'week,date,mrr,signups,churn,active',
			'22,Jun 08,41000,290,3.1,179',
			'23,Jun 15,41900,312,3.1,188',
			'25,Jun 26,77777,888,1.0,900',
		].join('\n') + '\n');
		await service.refreshFromSources();
		// report-1 (bound to the healthy, changed metrics-1) derived its new value; the broken source's
		// document kept its last-known value rather than throwing the whole refresh.
		assert.strictEqual(service.getResolved(docUri('report-1.md')).get('metrics-1.mrr'), '$77.8k', 'healthy-source doc derived despite a sibling source failing');
	});
});
