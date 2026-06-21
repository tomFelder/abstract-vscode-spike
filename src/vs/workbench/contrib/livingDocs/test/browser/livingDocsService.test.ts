/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ILanguageModelsService } from '../../../chat/common/languageModels.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { AgentPolicy, IAgentDef } from '../../common/livingDocsModel.js';
import { buildContextGroups } from '../../common/contextGroups.js';

const METRICS_CSV = [
	'week,date,mrr,signups,churn,active',
	'22,Jun 08,40300,290,3.1,179',
	'23,Jun 15,41200,312,3.1,188',
	'24,Jun 19,48600,427,2.4,205',
].join('\n');

// A clean-file Living Document: bind links authored at the week-23 values; resolving against the CSV
// (latest = week 24) should reconcile the visible cache to the week-24 values.
const WEEKLY_MD = [
	'---',
	'title: Weekly Operating Summary',
	'subtitle: Week 23',
	'sources:',
	'  - metrics.csv',
	'context:',
	'  - market-research.md',
	'---',
	'',
	'## Highlights',
	'',
	'Revenue grew [12%](bind:metrics.mrr.delta) week-on-week to [$41.2k](bind:metrics.mrr) MRR, on [312](bind:metrics.signups) new signups.',
	'',
	'## Commentary',
	'',
	'Growth remained steady this week.',
	'',
	'## What to watch',
	'',
	'Activation rate on the new onboarding flow.',
].join('\n') + '\n';

// A second bound document - its KPI table is a clean Markdown table whose cells are bind links.
const BOARD_MD = [
	'---',
	'title: Board Note',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'## Numbers',
	'',
	'| Metric | Current |',
	'| --- | --- |',
	'| MRR | [$41.2k](bind:metrics.mrr) |',
	'| Signups | [312](bind:metrics.signups) |',
	'',
	'## Note to the board',
	'',
	'Momentum is steady this week.',
].join('\n') + '\n';

const PLAIN_MD = [
	'# Team Notes',
	'',
	'A plain Markdown file with **no** frontmatter and no bindings.',
	'',
	'- first item',
	'- second item',
].join('\n') + '\n';

// The influence (context) source for the Weekly Summary - plain Markdown, not itself a living doc.
const MARKET_MD = [
	'# Market research',
	'',
	'Steady competitive landscape; no major moves this week.',
].join('\n') + '\n';

const API_MD = [
	'---',
	'title: Ecosystem Signal',
	'sources:',
	'  - https://api.example.com/repo',
	'---',
	'',
	'## Ecosystem',
	'',
	'The repository has [0](bind:repo.stargazers_count) stars and [0](bind:repo.open_issues_count) open issues.',
].join('\n') + '\n';

// A document whose figure block mixes a resolvable bind with one the source can't provide; the
// Financial grader must block the run because metrics.unknown does not reconcile.
const BADBIND_MD = [
	'---', 'title: Ratio Doc', 'sources:', '  - metrics.csv', '---', '',
	'## Ratio', '', 'MRR is [$41.2k](bind:metrics.mrr) at a ratio of [0.0](bind:metrics.unknown).',
].join('\n') + '\n';

const API_PAYLOAD = { stargazers_count: 12345, open_issues_count: 678, full_name: 'microsoft/vscode' };

const WEEKLY = URI.file('/ws/Weekly Summary.md');
const BOARD = URI.file('/ws/Board Note.md');
const README = URI.file('/ws/Team Notes.md');
const API = URI.file('/ws/Ecosystem.md');
const BADBIND = URI.file('/ws/Ratio Doc.md');

suite('LivingDocsService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IOpenedEditor { resource?: URI; options?: { selection?: { startLineNumber: number } } }

	let lastFiles: Map<string, string> | undefined;

	function createService(opened: IOpenedEditor[] = [], opts: { boardNote?: boolean; api?: boolean; badBind?: boolean; agents?: IAgentDef[] } = {}): LivingDocsService {
		const files = new Map<string, string>();
		lastFiles = files;
		files.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV);
		files.set(URI.file('/ws/market-research.md').toString(), MARKET_MD);
		files.set(WEEKLY.toString(), WEEKLY_MD);
		files.set(README.toString(), PLAIN_MD);
		// Seed the agent registry before construction so the orchestrator loads it instead of defaults.
		if (opts.agents) { files.set(URI.file('/ws/agents.json').toString(), JSON.stringify(opts.agents)); }
		if (opts.boardNote) { files.set(BOARD.toString(), BOARD_MD); }
		if (opts.api) { files.set(API.toString(), API_MD); }
		if (opts.badBind) { files.set(BADBIND.toString(), BADBIND_MD); }

		const fileService = {
			readFile: async (resource: URI) => {
				const content = files.get(resource.toString());
				if (content === undefined) { throw new Error(`not found: ${resource.toString()}`); }
				return { value: VSBuffer.fromString(content) };
			},
			writeFile: async (resource: URI, buffer: VSBuffer) => {
				files.set(resource.toString(), buffer.toString());
			},
			// List the direct children of a directory, so document discovery can fan out.
			resolve: async (resource: URI) => {
				const prefix = resource.toString().replace(/\/+$/, '') + '/';
				const children = [...files.keys()]
					.filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
					.map(key => ({ resource: URI.parse(key), isDirectory: false }));
				return { children };
			},
		} as unknown as IFileService;

		const editorService = { openEditor: async (input: IOpenedEditor) => { opened.push(input); return undefined; } } as unknown as IEditorService;
		const viewsService = { openView: async () => null } as unknown as IViewsService;
		const languageModelsService = { selectLanguageModels: async () => [] } as unknown as ILanguageModelsService;
		const configurationService = { getValue: () => true } as unknown as IConfigurationService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const requestService = {
			request: async () => ({
				res: { statusCode: 200, headers: {} },
				stream: bufferToStream(VSBuffer.fromString(JSON.stringify(API_PAYLOAD))),
			}),
		} as unknown as IRequestService;
		const workspaceService = { getWorkspace: () => ({ folders: [{ uri: URI.file('/ws') }] }) } as unknown as IWorkspaceContextService;

		const service = new LivingDocsService(fileService, editorService, viewsService, languageModelsService, configurationService, notificationService, new NullLogService(), requestService, workspaceService);
		store.add(service);
		return service;
	}

	function blockText(service: LivingDocsService, uri: URI, headingId: string): string {
		// The bound paragraph follows its heading; return the first block after the given heading.
		const blocks = service.getDoc(uri)!.blocks;
		const i = blocks.findIndex(b => b.id === headingId);
		return blocks[i + 1].text;
	}

	test('loading a bound document resolves its bind keys to the latest source values', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		// Authored at the week-23 cache ($41.2k / 312 / 12%); resolved to week-24 ($48.6k / 427 / +18%).
		const resolved = service.getResolved(WEEKLY);
		assert.deepStrictEqual(
			{ mrr: resolved.get('metrics.mrr'), signups: resolved.get('metrics.signups'), delta: resolved.get('metrics.mrr.delta') },
			{ mrr: '$48.6k', signups: '427', delta: '+18%' },
		);
		// Load is read-only: the on-disk cache is untouched until an explicit refresh/save.
		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'on-disk cache unchanged on load');
	});

	test('refreshFromSources reconciles the visible cache (figures auto-apply), persists, and audits', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources();

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.ok(highlights.includes('[$48.6k](bind:metrics.mrr)') && highlights.includes('[427](bind:metrics.signups)') && highlights.includes('[+18%](bind:metrics.mrr.delta)'), `reconciled in memory: ${highlights}`);
		const onDisk = lastFiles!.get(WEEKLY.toString()) ?? '';
		assert.ok(onDisk.includes('[$48.6k](bind:metrics.mrr)'), `persisted resolved value: ${onDisk}`);
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied'), 'figure auto-apply audited');
	});

	test('first open bootstraps a lock sidecar from the sources (resolved value, hash, syncedAt, kind)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const lockText = lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString());
		assert.ok(lockText, 'a lock sidecar was written on first open');
		const lock = JSON.parse(lockText!);
		const mrr = lock.bindings['metrics.mrr'];
		assert.strictEqual(mrr.resolved, '$48.6k', 'resolved value bootstrapped from the source');
		assert.ok(mrr.sourceHash && mrr.syncedAt, 'binding carries a source hash and sync time');
		assert.deepStrictEqual({ appliedBy: mrr.appliedBy, kind: mrr.kind }, { appliedBy: 'agent', kind: 'figure' });
	});

	test('the lock is the source of truth for resolved values: load does not re-read sources (lock wins)', async () => {
		const service = createService();
		// Seed a lock whose resolved value is NOT derivable from the CSV; load must honour it.
		lastFiles!.set(URI.file('/ws/Weekly Summary.lock.json').toString(), JSON.stringify({
			version: 1,
			bindings: { 'metrics.mrr': { resolved: '$99.9k', source: 'metrics.csv#mrr', sourceHash: 'stale', syncedAt: 't', appliedBy: 'agent', kind: 'figure' } },
			context: {}, claims: {}, pins: [], audit: [],
		}));

		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getResolved(WEEKLY).get('metrics.mrr'), '$99.9k', 'load shows the lock value, not a fresh source read');
	});

	test('re-syncing a changed source updates the lock binding resolved + sourceHash and reconciles the .md', async () => {
		const service = createService();
		lastFiles!.set(URI.file('/ws/Weekly Summary.lock.json').toString(), JSON.stringify({
			version: 1,
			bindings: { 'metrics.mrr': { resolved: '$99.9k', source: 'metrics.csv#mrr', sourceHash: 'stale', syncedAt: 't', appliedBy: 'agent', kind: 'figure' } },
			context: {}, claims: {}, pins: [], audit: [],
		}));
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources();

		const mrr = service.getLock(WEEKLY)!.bindings['metrics.mrr'];
		assert.strictEqual(mrr.resolved, '$48.6k', 're-sync pulls the current source value into the lock');
		assert.notStrictEqual(mrr.sourceHash, 'stale', 'source hash refreshed at sync');
		const lockOnDisk = JSON.parse(lastFiles!.get(URI.file('/ws/Weekly Summary.lock.json').toString())!);
		assert.strictEqual(lockOnDisk.bindings['metrics.mrr'].resolved, '$48.6k', 'lock persisted to its sidecar');
	});

	test('changing a value source flips the binding dirty bit (hash mismatch), with no model calls', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getFreshness(WEEKLY).dirty, false, 'fresh immediately after load');

		// A new week lands in the CSV - the bound document may be affected.
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.checkSources(WEEKLY);

		const fresh = service.getFreshness(WEEKLY);
		assert.ok(fresh.dirty && fresh.staleBindings.includes('metrics.mrr'), `binding dirty on source change: ${JSON.stringify(fresh)}`);
	});

	test('changing a context source flips its freshness to stale (the influence path)', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleContext, [], 'context current after load');

		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleContext, ['market-research.md'], 'context flagged changed-since-review');
	});

	test('the Context panel groups the document\'s linked sources and referenced files, fresh by default', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const groups = buildContextGroups(service.getDoc(WEEKLY)!, service.getFreshness(WEEKLY));
		// metrics.csv feeds the one bound block (Highlights); market-research.md is influence-only.
		assert.deepStrictEqual(groups, [
			{ label: 'Linked sources', items: [{ name: 'metrics.csv', kind: 'file', detail: 'live · feeds 1 block', changed: false }] },
			{ label: 'Referenced files', items: [{ name: 'market-research.md', kind: 'reference', detail: 'current', changed: false }] },
		]);
	});

	test('a changed value source flips its linked-source row to changed; a changed context source flips its referenced row', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		const groups = buildContextGroups(service.getDoc(WEEKLY)!, service.getFreshness(WEEKLY));
		assert.deepStrictEqual(groups, [
			{ label: 'Linked sources', items: [{ name: 'metrics.csv', kind: 'file', detail: 'changed · feeds 1 block', changed: true }] },
			{ label: 'Referenced files', items: [{ name: 'market-research.md', kind: 'reference', detail: 'changed since review', changed: true }] },
		]);
	});

	test('an api source is grouped as a linked source with its kind', async () => {
		const service = createService([], { api: true });
		await service.loadDocument(API);

		const groups = buildContextGroups(service.getDoc(API)!, service.getFreshness(API));
		assert.deepStrictEqual(groups, [
			{ label: 'Linked sources', items: [{ name: 'https://api.example.com/repo', kind: 'api', detail: 'live · polled', changed: false }] },
		]);
	});

	test('the Skills report grades the document: Financial reconciles, Formatting flags sentence-case headings, Strategy needs a model', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const report = service.getSkillReport(WEEKLY).map(s => ({ id: s.id, status: s.status, detail: s.detail, canRun: s.canRun }));
		assert.deepStrictEqual(report, [
			{ id: 'strategy', status: 'needs-model', detail: 'Connect a model to test claims against the decision stack.', canRun: false },
			{ id: 'financial', status: 'pass', detail: 'All 3 linked figures reconcile with sources.', canRun: true },
			{ id: 'formatting', status: 'flag', detail: '1 heading-case fix suggested.', canRun: true },
		]);
	});

	test('the Financial skill flags a bound figure that does not reconcile to its source', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);

		const financial = service.getSkillReport(BADBIND).find(s => s.id === 'financial')!;
		assert.deepStrictEqual(
			{ status: financial.status, detail: financial.detail },
			{ status: 'flag', detail: '1 of 2 figures do not reconcile: metrics.unknown.' },
		);
	});

	test('refreshing re-syncs the value bindings and clears their dirty bits', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.checkSources(WEEKLY);
		assert.ok(service.getFreshness(WEEKLY).dirty, 'dirty before refresh');

		await service.refreshFromSources();

		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleBindings, [], 'binding dirty bits cleared after re-sync');
		assert.strictEqual(service.getResolved(WEEKLY).get('metrics.mrr'), '$52.0k', 'lock now holds the new value');
	});

	function seedLock(uri: URI, lock: object): void {
		const stem = uri.path.split('/').pop()!.replace(/\.md$/, '');
		lastFiles!.set(URI.file(`/ws/${stem}.lock.json`).toString(), JSON.stringify(lock));
	}

	test('Review impact on a changed context queues a candidate; approve applies it, updates the lock, and clears the flag', async () => {
		const service = createService();
		// Authored claim bound to the context, anchored to the Commentary sentence.
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);

		// The context source changes -> the document is flagged, then the user runs Review impact.
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);
		await service.reviewImpact(WEEKLY);

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one impact candidate queued');
		assert.deepStrictEqual(
			{ kind: pending[0].kind, via: pending[0].via, context: pending[0].contextReviewed, claim: pending[0].claimId, relink: !!pending[0].relink },
			{ kind: 'meaning', via: 'heuristic', context: ['market-research.md'], claim: 'commentary-tone', relink: false },
		);
		const commentaryBlockId = pending[0].blockId;
		assert.notStrictEqual(pending[0].newText, pending[0].oldText, 'a real edit is proposed');

		await service.approve(pending[0].id);

		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'cleared from the rail');
		assert.deepStrictEqual(service.getFreshness(WEEKLY).staleContext, [], 'context flag cleared after approve');
		const lock = service.getLock(WEEKLY)!;
		assert.strictEqual(lock.claims['commentary-tone'].state, 'applied', 'claim re-anchored + applied');
		assert.ok(lock.audit.some(e => e.action === 'approved' && e.blockId === commentaryBlockId), 'approval audited in the lock');
	});

	test('a claim whose anchor no longer matches surfaces a re-link prompt instead of mis-attaching', async () => {
		const service = createService();
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'orphan': { anchor: 'A sentence that does not appear anywhere in this document.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		const before = service.getDoc(WEEKLY)!.blocks.map(b => b.text).join('\n');

		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);
		await service.reviewImpact(WEEKLY);

		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'one prompt queued');
		assert.ok(pending[0].relink, 'it is a loud re-link prompt, not a silent re-attach');
		assert.ok(/re-link/i.test(pending[0].rationale), `prompt explains the re-link: ${pending[0].rationale}`);
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.map(b => b.text).join('\n'), before, 'no prose was changed');
	});

	test('with no model available, Review impact is a visible heuristic state (not a silent degrade)', async () => {
		const service = createService();
		seedLock(WEEKLY, {
			version: 1, bindings: {}, context: {},
			claims: { 'commentary-tone': { anchor: 'Growth remained steady this week.', boundTo: ['market-research.md'], kind: 'meaning', state: 'applied' } },
			pins: [], audit: [],
		});
		await service.loadDocument(WEEKLY);
		lastFiles!.set(URI.file('/ws/market-research.md').toString(), MARKET_MD + '\nA new competitor entered the market.\n');
		await service.checkSources(WEEKLY);

		await service.reviewImpact(WEEKLY);

		assert.ok(/no model/i.test(service.getStatus(WEEKLY)), `surfaces the no-model state: ${service.getStatus(WEEKLY)}`);
		assert.strictEqual(service.getPendingForDoc(WEEKLY)[0].via, 'heuristic', 'candidate marked as the heuristic fallback');
	});

	test('a clean Markdown table with bind links in cells resolves each cell on refresh', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(BOARD);
		await service.refreshFromSources();

		const table = service.getDoc(BOARD)!.blocks.find(b => b.type === 'table')!;
		assert.ok(table.text.includes('[$48.6k](bind:metrics.mrr)') && table.text.includes('[427](bind:metrics.signups)'), `table cells resolved: ${table.text}`);
	});

	test('plain Markdown is not a Living Document and reports a Markdown status', async () => {
		const service = createService();
		await service.loadDocument(README);
		assert.strictEqual(service.getDoc(README)?.isLiving, false);
		assert.strictEqual(service.getStatus(README), 'Markdown');
	});

	test('saveRawText persists verbatim and reparses the document', async () => {
		const service = createService();
		await service.loadDocument(README);

		const edited = PLAIN_MD.replace('Team Notes', 'Renamed Notes');
		await service.saveRawText(README, edited);

		assert.strictEqual(service.getRawText(README), edited, 'raw text updated');
		assert.strictEqual(service.getDoc(README)?.title, 'Renamed Notes', 'reparsed after save');
	});

	test('an api source resolves live values into its bind links on refresh', async () => {
		const service = createService([], { api: true });
		await service.loadDocument(API);
		await service.refreshFromSources();

		const eco = service.getDoc(API)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(eco.text.includes('[12,345](bind:repo.stargazers_count)'), `live stars resolved: ${eco.text}`);
		assert.ok(eco.text.includes('[678](bind:repo.open_issues_count)'), `live issues resolved: ${eco.text}`);
	});

	test('editBlock edits non-bound prose and persists it, but ignores bound blocks', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		const watch = service.getDoc(WEEKLY)!.blocks.find(b => b.type === 'paragraph' && b.binds.length === 0)!;
		await service.editBlock(WEEKLY, watch.id, 'Edited prose.');
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.find(b => b.id === watch.id)!.text, 'Edited prose.', 'non-bound prose updated');
		assert.ok(service.getRawText(WEEKLY).includes('Edited prose.'), 'edit persisted to the Markdown source');

		const bound = service.getDoc(WEEKLY)!.blocks.find(b => b.binds.length > 0)!;
		const before = bound.text;
		await service.editBlock(WEEKLY, bound.id, 'Should be ignored.');
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.find(b => b.id === bound.id)!.text, before, 'bound block left unchanged');
	});

	test('listDocuments discovers Living Documents, excludes plain Markdown, and sorts by title', async () => {
		const service = createService([], { boardNote: true, api: true });

		const docs = await service.listDocuments();
		assert.deepStrictEqual(docs.map(d => d.title), ['Board Note', 'Ecosystem Signal', 'Weekly Operating Summary'], 'living docs listed (Team Notes excluded), sorted by title');
		assert.ok(docs.every(d => d.isLiving), 'all discovered documents are living');
		assert.deepStrictEqual(docs.find(d => d.title === 'Ecosystem Signal')!.sourceKinds, ['api'], 'api source kind surfaced for the chip');
	});

	test('exportMarkdown writes a clean static .md with resolved values and no bind syntax', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();

		const target = await service.exportMarkdown(WEEKLY);
		assert.ok(target && target.path.endsWith('Weekly Summary.export.md'), `target name: ${target?.path}`);
		const md = lastFiles!.get(target!.toString()) ?? '';
		assert.ok(md.startsWith('# Weekly Operating Summary'), 'starts with the H1 title');
		assert.ok(md.includes('$48.6k') && md.includes('427'), 'resolved values inlined');
		assert.ok(!md.includes('bind:') && !md.includes(']('), 'no bind-link syntax in the export');
	});

	function manualAgent(policy: AgentPolicy): IAgentDef {
		return { id: 'agent', name: 'Agent', trigger: { kind: 'manual' }, flow: { sources: [], docs: [WEEKLY.toString()] }, policy, status: 'idle' };
	}

	test('policy auto-figures applies the figure silently and audits it, with nothing queued', async () => {
		const service = createService([], { agents: [manualAgent('auto-figures')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		const highlights = blockText(service, WEEKLY, 'h-highlights');
		assert.ok(highlights.includes('[$48.6k](bind:metrics.mrr)'), `figure auto-applied to the doc: ${highlights}`);
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'nothing queued for review');
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied'), 'auto-apply audited in the lock');
	});

	test('policy ask-before-apply queues a pending figure change and leaves the doc untouched', async () => {
		const service = createService([], { agents: [manualAgent('ask-before-apply')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'doc cache untouched');
		const pending = service.getPendingForDoc(WEEKLY);
		assert.deepStrictEqual({ count: pending.length, kind: pending[0]?.kind, draft: !!pending[0]?.draft }, { count: 1, kind: 'figure', draft: false });
	});

	test('policy draft-only prepares a draft in the rail and never lands it', async () => {
		const service = createService([], { agents: [manualAgent('draft-only')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$41.2k](bind:metrics.mrr)'), 'doc untouched by a draft-only run');
		const pending = service.getPendingForDoc(WEEKLY);
		assert.deepStrictEqual({ count: pending.length, draft: !!pending[0]?.draft }, { count: 1, draft: true });
	});

	test('the verify gate blocks a run whose figures do not reconcile (Financial flag), applying nothing', async () => {
		const agent: IAgentDef = { id: 'agent', name: 'Agent', trigger: { kind: 'manual' }, flow: { sources: [], docs: [BADBIND.toString()] }, policy: 'auto-figures', status: 'idle' };
		const service = createService([], { badBind: true, agents: [agent] });
		await service.loadDocument(BADBIND);

		await service.runAgent('agent');

		const ratio = service.getDoc(BADBIND)!.blocks.find(b => b.type === 'paragraph' && b.binds.length > 0)!;
		assert.ok(ratio.text.includes('[$41.2k](bind:metrics.mrr)'), 'no figure applied - the run was blocked at the gate');
		assert.strictEqual(service.getAgents().find(a => a.id === 'agent')!.status, 'blocked', 'agent surfaces the blocked state');
		assert.strictEqual(service.getPendingForDoc(BADBIND).length, 0, 'nothing queued either');
	});

	test('a clean run passes the verify gate and lands the figure', async () => {
		const service = createService([], { agents: [manualAgent('auto-figures')] });
		await service.loadDocument(WEEKLY);

		await service.runAgent('agent');

		assert.ok(blockText(service, WEEKLY, 'h-highlights').includes('[$48.6k](bind:metrics.mrr)'), 'clean figures land');
		assert.strictEqual(service.getAgents().find(a => a.id === 'agent')!.status, 'idle', 'agent is not blocked');
	});

	test('before-export gate blocks export when the document figures do not reconcile', async () => {
		const service = createService([], { badBind: true });
		await service.loadDocument(BADBIND);

		const target = await service.exportMarkdown(BADBIND);

		assert.strictEqual(target, undefined, 'export blocked at the gate');
		assert.strictEqual(lastFiles!.get(URI.file('/ws/Ratio Doc.export.md').toString()), undefined, 'no export file written');
	});

	test('on-publish writes a pin snapshotting the current source versions', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		await service.publishDocument(WEEKLY);

		const pins = service.getLock(WEEKLY)!.pins;
		assert.ok(pins.some(p => p.source === 'metrics.csv' && !!p.version), `pinned to the source version: ${JSON.stringify(pins)}`);
	});

	test('on-open freshness shows a changed source as stale without a manual refresh', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getFreshness(WEEKLY).dirty, false, 'current on first open');

		// A source moves on while the doc is closed; re-opening must surface the staleness.
		lastFiles!.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV + '\n25,Jun 26,52000,470,2.2,210');
		await service.loadDocument(WEEKLY);

		assert.ok(service.getFreshness(WEEKLY).dirty, 'on-open recompute flags the changed source');
	});

	test('revealSource opens a styled source view listing bound keys and the referencing document', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);
		await service.loadDocument(WEEKLY);
		opened.length = 0;

		await service.revealSource(WEEKLY, ['metrics.mrr']);

		assert.strictEqual(opened.length, 1, 'opened the source view once');
		assert.ok(opened[0].resource!.path.endsWith('metrics.source.md'), `styled source view: ${opened[0].resource!.path}`);
		const md = lastFiles!.get(opened[0].resource!.toString()) ?? '';
		assert.ok(md.includes('**metrics.mrr**'), 'emphasizes the selected bound key');
		assert.ok(md.includes('Weekly Operating Summary'), 'lists the referencing document');
	});
});
