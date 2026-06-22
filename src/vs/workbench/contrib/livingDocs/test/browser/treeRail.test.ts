/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';
import { buildFileTree, buildOutline, searchTreeRail } from '../../common/treeRail.js';

const WEEKLY = URI.file('/ws/Weekly Summary.md');
const BOARD = URI.file('/ws/Board Note.md');

function doc(title: string, headings: readonly { text: string; level: number }[], body: string): ILivingDoc {
	const blocks = headings.map((h, i) => ({ id: `h${i}`, type: 'heading' as const, text: h.text, level: h.level, binds: [] }));
	return { title, subtitle: '', sources: ['metrics.csv'], context: [], blocks, isLiving: true, body };
}

suite('treeRail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('buildFileTree groups documents under Reports and deduped sources under Sources', () => {
		const folders = buildFileTree([
			{ title: 'Weekly Summary', resource: WEEKLY, pendingCount: 1, sources: ['metrics.csv', 'crm.api'] },
			{ title: 'Board Note', resource: BOARD, pendingCount: 0, sources: ['metrics.csv'] },
		]);
		const projection = folders.map(f => ({
			name: f.name,
			items: f.items.map(i => ({ label: i.label, kind: i.kind, pending: i.pending })),
		}));
		// Reports sorted by title (pending = pendingCount > 0); Sources deduped + sorted.
		assert.deepStrictEqual(projection, [
			{
				name: 'Reports', items: [
					{ label: 'Board Note', kind: 'doc', pending: false },
					{ label: 'Weekly Summary', kind: 'doc', pending: true },
				]
			},
			{
				name: 'Sources', items: [
					{ label: 'crm.api', kind: 'source', pending: false },
					{ label: 'metrics.csv', kind: 'source', pending: false },
				]
			},
		]);
	});

	test('buildOutline returns headings in order, stripped of Markdown and bind syntax', () => {
		const d = doc('Weekly', [
			{ text: '# Weekly Operating Summary', level: 1 },
			{ text: '## [Highlights](bind:x)', level: 2 },
			{ text: '## Key metrics', level: 2 },
		], 'body');
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Weekly Operating Summary', level: 1 },
			{ text: 'Highlights', level: 2 },
			{ text: 'Key metrics', level: 2 },
		]);
		assert.deepStrictEqual(buildOutline(undefined), []);
	});

	test('searchTreeRail matches title or body case-insensitively with a snippet, and ignores blank queries', () => {
		const docs = [
			{ title: 'Weekly Summary', resource: WEEKLY, body: 'Revenue grew this week as growth accelerated sharply.' },
			{ title: 'Board Note', resource: BOARD, body: 'Momentum is steady.' },
		];
		const hits = searchTreeRail(docs, 'ACCELERAT');
		assert.deepStrictEqual(
			{ count: hits.length, title: hits[0]?.title, hasSnippet: /accelerat/i.test(hits[0]?.snippet ?? '') },
			{ count: 1, title: 'Weekly Summary', hasSnippet: true },
		);
		assert.strictEqual(searchTreeRail(docs, '   ').length, 0, 'blank query returns nothing');
	});
});
