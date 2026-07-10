/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';
import { buildOutline, buildWorkspaceTree, searchTreeRail } from '../../common/treeRail.js';

const WEEKLY = URI.file('/ws/Weekly Summary.md');
const BOARD = URI.file('/ws/Board Note.md');

function doc(title: string, headings: readonly { text: string; level: number }[], body: string): ILivingDoc {
	const blocks = headings.map((h, i) => ({ id: `h${i}`, type: 'heading' as const, text: h.text, level: h.level, binds: [] }));
	return { title, subtitle: '', sources: ['metrics.csv'], context: [], blocks, isLiving: true, body };
}

suite('treeRail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('buildWorkspaceTree preserves subfolder hierarchy, groups sources, and marks unsupported files', () => {
		const folders = buildWorkspaceTree(
			[
				{ title: 'Weekly Summary', resource: WEEKLY, pendingCount: 1, sources: ['metrics.csv', 'crm.api'], relativeDir: '' },
				{ title: 'Board Note', resource: BOARD, pendingCount: 0, sources: ['metrics.csv'], relativeDir: '' },
				{ title: '2025 Plan', resource: URI.file('/ws/reports/2025/plan.md'), pendingCount: 0, sources: [], relativeDir: 'reports/2025' },
			],
			[
				{ name: 'notes.txt', relativeDir: '', kind: 'data' },
				{ name: 'legacy.doc', relativeDir: '', kind: 'unsupported', note: 'not yet imported' },
			],
		);
		const projection = folders.map(f => ({
			name: f.name,
			depth: f.depth,
			items: f.items.map(i => ({ label: i.label, kind: i.kind, pending: i.pending, note: i.note })),
		}));
		// Root docs under "Reports" (depth 0); the nested reports/2025 keeps its own indented folder (F7).
		// Sources: deduped bound sources + the .txt data file, then the .doc marked "not yet imported" (F9/F10).
		assert.deepStrictEqual(projection, [
			{
				name: 'Reports', depth: 0, items: [
					{ label: 'Board Note', kind: 'doc', pending: false, note: undefined },
					{ label: 'Weekly Summary', kind: 'doc', pending: true, note: undefined },
				]
			},
			{
				name: '2025', depth: 2, items: [
					{ label: '2025 Plan', kind: 'doc', pending: false, note: undefined },
				]
			},
			{
				name: 'Sources', depth: 0, items: [
					{ label: 'crm.api', kind: 'source', pending: false, note: undefined },
					{ label: 'metrics.csv', kind: 'source', pending: false, note: undefined },
					{ label: 'notes.txt', kind: 'source', pending: false, note: undefined },
					{ label: 'legacy.doc', kind: 'source', pending: false, note: 'not yet imported' },
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
