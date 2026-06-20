/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageModelsService } from '../../../chat/common/languageModels.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';
import { parseLivingDoc, serializeLivingDoc } from '../../common/livingDocMarkdown.js';

const METRICS_CSV = [
	'week,date,mrr,signups,churn,active',
	'22,Jun 08,40300,290,3.1,179',
	'23,Jun 15,41200,312,3.1,188',
	'24,Jun 19,48600,427,2.4,205',
].join('\n');

const WEEKLY_MD = [
	'---',
	'livingDoc: true',
	'title: Weekly Operating Summary',
	'subtitle: Week 23 as authored',
	'source: metrics.csv',
	'syncedWeek: 23',
	'---',
	'',
	'## Highlights',
	'',
	'<!-- bind id=p-highlights kind=figure cells=mrr,signups,churn -->',
	'Revenue grew 12% week-on-week to $41.2k MRR, on 312 new signups. Churn held at 3.1%.',
	'',
	'<!-- table id=kpi-table cells=mrr,signups,churn,active -->',
	'',
	'## Commentary',
	'',
	'<!-- bind id=p-commentary kind=narrative cells=mrr -->',
	'Growth remained steady this week, continuing the gradual climb seen since early Q2.',
	'',
	'## What to watch',
	'',
	'Activation rate on the new onboarding flow.',
].join('\n');

const BOARD_MD = [
	'---',
	'livingDoc: true',
	'title: Board Note',
	'subtitle: Week 23 as authored',
	'source: metrics.csv',
	'syncedWeek: 23',
	'---',
	'',
	'## Numbers',
	'',
	'<!-- table id=kpi-table cells=mrr,signups,churn,active -->',
	'',
	'## Note to the board',
	'',
	'<!-- bind id=p-commentary kind=narrative cells=mrr -->',
	'Momentum is steady; we continue to track plan with no surprises this week.',
].join('\n');

const PLAIN_MD = [
	'# Project Readme',
	'',
	'Some **bold** intro prose with a [link](https://example.com).',
	'',
	'- first item',
	'- second item',
].join('\n');

const WEEKLY = URI.file('/ws/Weekly Summary.living.md');
const BOARD = URI.file('/ws/Board Note.living.md');
const README = URI.file('/ws/README.md');

suite('LivingDocsService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IOpenedEditor { resource?: URI; options?: { selection?: { startLineNumber: number } } }

	function createService(opened: IOpenedEditor[] = [], opts: { boardNote?: boolean } = {}): LivingDocsService {
		const files = new Map<string, string>();
		files.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV);
		files.set(WEEKLY.toString(), WEEKLY_MD);
		files.set(README.toString(), PLAIN_MD);
		if (opts.boardNote) { files.set(BOARD.toString(), BOARD_MD); }

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

		const service = new LivingDocsService(fileService, editorService, viewsService, languageModelsService, configurationService, notificationService, new NullLogService());
		store.add(service);
		return service;
	}

	test('refresh auto-applies figures and queues the meaning-change; approve applies it with an audit trail', async () => {
		const service = createService();

		await service.loadDocument(WEEKLY);
		assert.strictEqual(service.getDoc(WEEKLY)?.syncedWeek, 23, 'loads at authored week');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'nothing pending before refresh');

		await service.refreshFromSources();

		// Figure paragraph auto-applied with the real week-24 numbers (delta 41.2k -> 48.6k = +18%).
		const fig = service.getDoc(WEEKLY)!.blocks.find(b => b.id === 'p-highlights')!;
		assert.ok(fig.text!.includes('18%'), `figure recomputed delta: ${fig.text}`);
		assert.ok(fig.text!.includes('$48.6k') && fig.text!.includes('427'), `figure has new values: ${fig.text}`);
		assert.strictEqual(service.getDoc(WEEKLY)!.syncedWeek, 24, 'KPI table advanced to latest week');
		assert.ok(service.getRecentlyApplied(WEEKLY).has('p-highlights'), 'figure flagged as auto-applied');

		// Meaning-change queued, NOT auto-applied.
		const pending = service.getPendingForDoc(WEEKLY);
		assert.strictEqual(pending.length, 1, 'exactly one change needs approval');
		assert.strictEqual(pending[0].blockId, 'p-commentary');
		assert.strictEqual(pending[0].kind, 'meaning');
		assert.ok(pending[0].newText.toLowerCase().includes('accelerated'), `commentary rewrite: ${pending[0].newText}`);
		const commentaryBefore = service.getDoc(WEEKLY)!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentaryBefore.text!.includes('steady'), 'commentary unchanged until approved');

		// Audit records the auto-applied figures.
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied' && e.blockId === 'p-highlights'), 'figure auto-apply audited');

		// Approve the meaning-change.
		await service.approve(pending[0].id);
		const commentaryAfter = service.getDoc(WEEKLY)!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentaryAfter.text!.toLowerCase().includes('accelerated'), 'commentary applied after approval');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'no pending after approval');
		assert.ok(service.getAudit().some(e => e.action === 'approved' && e.blockId === 'p-commentary'), 'approval audited');
	});

	test('a source change fans out to every bound document; approving one leaves the others', async () => {
		const service = createService([], { boardNote: true });
		await service.loadDocument(WEEKLY);

		await service.refreshFromSources();

		const docsWithChanges = new Set(service.getAllPending().map(c => c.docTitle));
		assert.deepStrictEqual([...docsWithChanges].sort(), ['Board Note', 'Weekly Operating Summary'], 'both bound docs surfaced changes');

		const weeklyChange = service.getAllPending().find(c => c.docTitle === 'Weekly Operating Summary')!;
		const boardChange = service.getAllPending().find(c => c.docTitle === 'Board Note')!;

		await service.approve(weeklyChange.id);

		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0, 'approved document is cleared');
		assert.strictEqual(service.getAllPending().length, 1, 'the other document is still pending');
		assert.strictEqual(service.getAllPending()[0].id, boardChange.id, 'the untouched change is the board note');
		assert.ok(service.getDoc(BOARD)!.blocks.find(b => b.id === 'p-commentary')!.text!.includes('steady'), 'board note left unchanged');
		assert.ok(service.getAudit().some(e => e.docTitle === 'Weekly Operating Summary' && e.action === 'approved'), 'audit spans documents');
	});

	test('reject leaves the document unchanged but records the decision', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);
		await service.refreshFromSources();

		const change = service.getPendingForDoc(WEEKLY)[0];
		service.reject(change.id);

		const commentary = service.getDoc(WEEKLY)!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentary.text!.includes('steady'), 'commentary left unchanged on reject');
		assert.strictEqual(service.getPendingForDoc(WEEKLY).length, 0);
		assert.ok(service.getAudit().some(e => e.action === 'rejected' && e.blockId === 'p-commentary'), 'rejection audited');
	});

	test('revealSource opens the bound source and selects the synced-week row', async () => {
		const opened: IOpenedEditor[] = [];
		const service = createService(opened);
		await service.loadDocument(WEEKLY);
		opened.length = 0; // ignore anything opened during load

		await service.revealSource(WEEKLY, ['mrr']);

		assert.strictEqual(opened.length, 1, 'opened the source once');
		assert.ok(opened[0].resource!.path.endsWith('metrics.csv'), 'opened metrics.csv');
		// header is line 1; week 23 is the 2nd data row (weeks 22,23,24) -> line 3
		assert.strictEqual(opened[0].options?.selection?.startLineNumber, 3, 'selected the week-23 row');
	});

	test('plain Markdown is not treated as a Living Document and takes its title from the first H1', () => {
		const doc = parseLivingDoc(PLAIN_MD);
		assert.strictEqual(doc.isLiving, false, 'no frontmatter flag and no bindings -> plain');
		assert.strictEqual(doc.title, 'Project Readme', 'title from first H1');
		assert.ok(doc.body.includes('- first item'), 'body retains the raw Markdown for generic rendering');
	});

	test('a bound document is detected as living even without the frontmatter flag', () => {
		const doc = parseLivingDoc(WEEKLY_MD);
		assert.strictEqual(doc.isLiving, true);
	});

	test('loading plain Markdown reads no source and reports a Markdown status', async () => {
		const service = createService();
		await service.loadDocument(README);
		assert.strictEqual(service.getDoc(README)?.isLiving, false);
		assert.strictEqual(service.getStatus(README), 'Markdown');
		assert.strictEqual(service.getKpiRows(README).length, 0, 'no KPI rows for plain Markdown');
	});

	test('saveRawText persists verbatim and reparses the document', async () => {
		const service = createService();
		await service.loadDocument(README);

		const edited = PLAIN_MD.replace('Project Readme', 'Renamed Readme');
		await service.saveRawText(README, edited);

		assert.strictEqual(service.getRawText(README), edited, 'raw text updated');
		assert.strictEqual(service.getDoc(README)?.title, 'Renamed Readme', 'reparsed after save');
	});

	test('editBlock edits non-bound prose and persists it, but ignores bound blocks', async () => {
		const service = createService();
		await service.loadDocument(WEEKLY);

		// "What to watch" is a non-bound paragraph -> editable.
		const watch = service.getDoc(WEEKLY)!.blocks.find(b => b.type === 'paragraph' && !b.binding)!;
		await service.editBlock(WEEKLY, watch.id, 'Edited watch item.');
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.find(b => b.id === watch.id)!.text, 'Edited watch item.', 'non-bound prose updated');
		assert.ok(service.getRawText(WEEKLY).includes('Edited watch item.'), 'edit persisted to the Markdown source');

		// A bound block (the commentary) is driven by its source and must not be hand-edited.
		const before = service.getDoc(WEEKLY)!.blocks.find(b => b.id === 'p-commentary')!.text;
		await service.editBlock(WEEKLY, 'p-commentary', 'Should be ignored.');
		assert.strictEqual(service.getDoc(WEEKLY)!.blocks.find(b => b.id === 'p-commentary')!.text, before, 'bound block left unchanged');
	});

	test('markdown parses bindings from comments and round-trips through serialize', () => {
		const doc = parseLivingDoc(WEEKLY_MD);
		assert.strictEqual(doc.title, 'Weekly Operating Summary');
		assert.strictEqual(doc.source, 'metrics.csv');
		assert.strictEqual(doc.syncedWeek, 23);
		const fig = doc.blocks.find(b => b.id === 'p-highlights')!;
		assert.strictEqual(fig.kind, 'figure');
		assert.deepStrictEqual([...fig.binding!.cells], ['mrr', 'signups', 'churn']);
		assert.ok(doc.blocks.some(b => b.type === 'kpiTable' && b.id === 'kpi-table'));

		// serialize -> parse preserves block ids, kinds, and bindings
		const again = parseLivingDoc(serializeLivingDoc(doc));
		assert.deepStrictEqual(again.blocks.map(b => b.id), doc.blocks.map(b => b.id));
		assert.deepStrictEqual(again.blocks.map(b => b.kind), doc.blocks.map(b => b.kind));
		assert.strictEqual(again.blocks.find(b => b.id === 'p-commentary')!.text, doc.blocks.find(b => b.id === 'p-commentary')!.text);
	});
});
