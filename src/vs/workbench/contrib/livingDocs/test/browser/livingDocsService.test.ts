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
].join('\n');

suite('LivingDocsService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(): LivingDocsService {
		const files = new Map<string, string>();
		files.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV);
		files.set(URI.file('/ws/Weekly Summary.living.md').toString(), WEEKLY_MD);

		const fileService = {
			readFile: async (resource: URI) => {
				const content = files.get(resource.toString());
				if (content === undefined) { throw new Error(`not found: ${resource.toString()}`); }
				return { value: VSBuffer.fromString(content) };
			},
			writeFile: async (resource: URI, buffer: VSBuffer) => {
				files.set(resource.toString(), buffer.toString());
			},
		} as unknown as IFileService;

		const editorService = { openEditor: async () => undefined } as unknown as IEditorService;
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

		await service.loadDocument(URI.file('/ws/Weekly Summary.living.md'));
		assert.strictEqual(service.getDoc()?.syncedWeek, 23, 'loads at authored week');
		assert.strictEqual(service.getPending().length, 0, 'nothing pending before refresh');

		await service.refreshFromSources();

		// Figure paragraph auto-applied with the real week-24 numbers (delta 41.2k -> 48.6k = +18%).
		const fig = service.getDoc()!.blocks.find(b => b.id === 'p-highlights')!;
		assert.ok(fig.text!.includes('18%'), `figure recomputed delta: ${fig.text}`);
		assert.ok(fig.text!.includes('$48.6k') && fig.text!.includes('427'), `figure has new values: ${fig.text}`);
		assert.strictEqual(service.getDoc()!.syncedWeek, 24, 'KPI table advanced to latest week');
		assert.ok(service.getRecentlyApplied().has('p-highlights'), 'figure flagged as auto-applied');

		// Meaning-change queued, NOT auto-applied.
		const pending = service.getPending();
		assert.strictEqual(pending.length, 1, 'exactly one change needs approval');
		assert.strictEqual(pending[0].blockId, 'p-commentary');
		assert.strictEqual(pending[0].kind, 'meaning');
		assert.ok(pending[0].newText.toLowerCase().includes('accelerated'), `commentary rewrite: ${pending[0].newText}`);
		const commentaryBefore = service.getDoc()!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentaryBefore.text!.includes('steady'), 'commentary unchanged until approved');

		// Audit records the auto-applied figures.
		assert.ok(service.getAudit().some(e => e.action === 'auto-applied' && e.blockId === 'p-highlights'), 'figure auto-apply audited');

		// Approve the meaning-change.
		await service.approve(pending[0].id);
		const commentaryAfter = service.getDoc()!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentaryAfter.text!.toLowerCase().includes('accelerated'), 'commentary applied after approval');
		assert.strictEqual(service.getPending().length, 0, 'no pending after approval');
		assert.ok(service.getAudit().some(e => e.action === 'approved' && e.blockId === 'p-commentary'), 'approval audited');
	});

	test('reject leaves the document unchanged but records the decision', async () => {
		const service = createService();
		await service.loadDocument(URI.file('/ws/Weekly Summary.living.md'));
		await service.refreshFromSources();

		const change = service.getPending()[0];
		service.reject(change.id);

		const commentary = service.getDoc()!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentary.text!.includes('steady'), 'commentary left unchanged on reject');
		assert.strictEqual(service.getPending().length, 0);
		assert.ok(service.getAudit().some(e => e.action === 'rejected' && e.blockId === 'p-commentary'), 'rejection audited');
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
