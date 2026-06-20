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
import { ILanguageModelsService } from '../../../chat/common/languageModels.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { LivingDocsService } from '../../browser/livingDocsService.js';

const METRICS_CSV = [
	'week,date,mrr,signups,churn,active',
	'22,Jun 08,40300,290,3.1,179',
	'23,Jun 15,41200,312,3.1,188',
	'24,Jun 19,48600,427,2.4,205',
].join('\n');

const WEEKLY_LDOC = JSON.stringify({
	title: 'Weekly Operating Summary',
	subtitle: 'Week 23 · as authored',
	syncedWeek: 23,
	blocks: [
		{ id: 'h-highlights', type: 'heading', text: 'Highlights' },
		{ id: 'p-highlights', type: 'paragraph', kind: 'figure', binding: { source: 'metrics.csv', cells: ['mrr', 'signups', 'churn'] }, text: 'Revenue grew 12% week-on-week to $41.2k MRR, on 312 new signups. Churn held at 3.1%.' },
		{ id: 'kpi-table', type: 'kpiTable', binding: { source: 'metrics.csv', cells: ['mrr'] } },
		{ id: 'h-commentary', type: 'heading', text: 'Commentary' },
		{ id: 'p-commentary', type: 'paragraph', kind: 'narrative', binding: { source: 'metrics.csv', cells: ['mrr'] }, text: 'Growth remained steady this week, continuing the gradual climb seen since early Q2.' },
	],
});

suite('LivingDocsService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(): LivingDocsService {
		const files = new Map<string, string>();
		files.set(URI.file('/ws/metrics.csv').toString(), METRICS_CSV);
		files.set(URI.file('/ws/Weekly Summary.ldoc').toString(), WEEKLY_LDOC);

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
		const languageModelsService = { selectLanguageModels: async () => [] } as unknown as ILanguageModelsService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;

		const service = new LivingDocsService(fileService, editorService, languageModelsService, notificationService, new NullLogService());
		store.add(service);
		return service;
	}

	test('refresh auto-applies figures and queues the meaning-change; approve applies it with an audit trail', async () => {
		const service = createService();

		await service.loadDocument(URI.file('/ws/Weekly Summary.ldoc'));
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
		await service.loadDocument(URI.file('/ws/Weekly Summary.ldoc'));
		await service.refreshFromSources();

		const change = service.getPending()[0];
		service.reject(change.id);

		const commentary = service.getDoc()!.blocks.find(b => b.id === 'p-commentary')!;
		assert.ok(commentary.text!.includes('steady'), 'commentary left unchanged on reject');
		assert.strictEqual(service.getPending().length, 0);
		assert.ok(service.getAudit().some(e => e.action === 'rejected' && e.blockId === 'p-commentary'), 'rejection audited');
	});
});
