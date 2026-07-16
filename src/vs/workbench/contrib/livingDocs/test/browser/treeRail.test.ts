/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';
import { ASSETS_FOLDER_ID, buildFileTree, buildOutline, buildTreeRailNodes, classifyWorkspaceExtra, collectAssetsFolderIds, isAssetName, ITreeRailNode, searchTreeRail } from '../../common/treeRail.js';

// Compact projection of a node tree for snapshot-style assertions: folders show label + children, leaves
// show label + kind. Ids are checked separately where they matter (persistence + identity).
function project(nodes: readonly ITreeRailNode[]): unknown {
	return nodes.map(n => n.type === 'folder'
		? { folder: n.label, children: project(n.children) }
		: { leaf: n.item.label, kind: n.item.kind });
}

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

	test('buildFileTree resolves a file source to a URI in the referencing document\'s folder (for the Files-tab menu), but not an api (URL) source', () => {
		const folders = buildFileTree([
			{ title: 'Weekly Summary', resource: WEEKLY, pendingCount: 0, sources: ['metrics.csv', 'https://api.example.com/mrr'] },
		]);
		const sources = folders.find(f => f.name === 'Sources')!.items;
		const csv = sources.find(i => i.label === 'metrics.csv')!;
		const api = sources.find(i => i.label === 'https://api.example.com/mrr')!;
		// A file source is renamable/deletable, so it carries a real sibling URI; an api (URL) source has no file.
		assert.strictEqual(csv.resource?.toString(), URI.file('/ws/metrics.csv').toString());
		assert.strictEqual(api.resource, undefined);
	});

	test('buildFileTree preserves the on-disk folder hierarchy instead of flattening subfolders (F7)', () => {
		const A = URI.file('/ws/root.md');
		const B = URI.file('/ws/subfolder-a/note.md');
		const C = URI.file('/ws/subfolder-a/deep/deep.md');
		const D = URI.file('/ws/reports/2025/q1.md');
		const folders = buildFileTree([
			{ title: 'Root Doc', resource: A, pendingCount: 0, sources: [], folder: '' },
			{ title: 'Sub Note', resource: B, pendingCount: 0, sources: [], folder: 'subfolder-a' },
			{ title: 'Deep Doc', resource: C, pendingCount: 0, sources: [], folder: 'subfolder-a/deep' },
			{ title: 'Q1', resource: D, pendingCount: 0, sources: [], folder: 'reports/2025' },
		]);
		// One "Reports" group: root docs at top level, subfolders nested by their path (not flattened).
		const reports = folders.find(f => f.name === 'Reports')!;
		assert.deepStrictEqual(reports.items.map(i => i.label), ['Root Doc']);
		const shape = reports.folders.map(f => ({
			name: f.name,
			items: f.items.map(i => i.label),
			subs: f.folders.map(s => ({ name: s.name, items: s.items.map(i => i.label) })),
		}));
		assert.deepStrictEqual(shape, [
			{ name: 'reports', items: [], subs: [{ name: '2025', items: ['Q1'] }] },
			{ name: 'subfolder-a', items: ['Sub Note'], subs: [{ name: 'deep', items: ['Deep Doc'] }] },
		]);
	});

	test('buildFileTree lists discovered non-Markdown files as SOURCES and unsupported files as "Not yet imported" (F9/F10)', () => {
		const A = URI.file('/ws/report.md');
		const folders = buildFileTree(
			[{ title: 'Report', resource: A, pendingCount: 0, sources: ['metrics.csv'], folder: '' }],
			['data.csv', 'notes.txt', 'chart.png', 'metrics.csv', 'brief.docx', 'old.doc', 'deck.pptx'],
		);
		const sources = folders.find(f => f.name === 'Sources')!;
		// Bound source + discovered data/txt/image files, deduped (metrics.csv appears once), sorted.
		assert.deepStrictEqual(sources.items.map(i => ({ label: i.label, kind: i.kind })), [
			{ label: 'chart.png', kind: 'source' },
			{ label: 'data.csv', kind: 'source' },
			{ label: 'metrics.csv', kind: 'source' },
			{ label: 'notes.txt', kind: 'source' },
		]);
		const notYet = folders.find(f => f.name === 'Not yet imported')!;
		assert.deepStrictEqual(notYet.items.map(i => ({ label: i.label, kind: i.kind, hasReason: !!i.note, importable: !!i.importable })), [
			{ label: 'brief.docx', kind: 'unsupported', hasReason: false, importable: true },
			{ label: 'deck.pptx', kind: 'unsupported', hasReason: true, importable: false },
			{ label: 'old.doc', kind: 'unsupported', hasReason: true, importable: false },
		]);
	});

	test('classifyWorkspaceExtra sorts data/image files into sources, office files into not-yet-imported, and skips md/system files', () => {
		assert.strictEqual(classifyWorkspaceExtra('data.csv')?.kind, 'source');
		assert.strictEqual(classifyWorkspaceExtra('photo.PNG')?.kind, 'source');
		assert.strictEqual(classifyWorkspaceExtra('notes.txt')?.kind, 'source');
		const docx = classifyWorkspaceExtra('brief.docx');
		assert.strictEqual(docx?.kind, 'unsupported');
		assert.strictEqual(docx?.importable, true, 'a .docx offers the import door rather than a dead reason');
		assert.ok(!docx?.reason, 'an importable .docx carries no refusal reason');
		const doc = classifyWorkspaceExtra('old.doc');
		assert.ok(doc?.reason && doc.reason.length > 0, 'a genuinely-unsupported file carries a plain-words reason');
		// Never surfaced: Markdown (the Reports tree owns it), lock sidecars, the agents registry, hidden files.
		assert.strictEqual(classifyWorkspaceExtra('doc.md'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('report.lock.json'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('agents.json'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('.hidden'), undefined);
		assert.strictEqual(classifyWorkspaceExtra('README'), undefined);
	});

	test('classifyWorkspaceExtra offers workbooks + PDFs as usable sources with a "Use as source" action (issue #131)', () => {
		assert.deepStrictEqual(classifyWorkspaceExtra('Budget.xlsx'), { kind: 'source', action: 'use-xlsx' });
		assert.deepStrictEqual(classifyWorkspaceExtra('legacy.XLS'), { kind: 'source', action: 'use-xlsx' });
		assert.deepStrictEqual(classifyWorkspaceExtra('Report.pdf'), { kind: 'source', action: 'use-pdf' });
		// A workbook/PDF lands in SOURCES (with its action), never in the dead "Not yet imported" section.
		const folders = buildFileTree([], ['Budget.xlsx', 'Report.pdf']);
		const sources = folders.find(f => f.name === 'Sources')!;
		assert.deepStrictEqual(sources.items.map(i => ({ label: i.label, kind: i.kind, action: i.action })), [
			{ label: 'Budget.xlsx', kind: 'source', action: 'use-xlsx' },
			{ label: 'Report.pdf', kind: 'source', action: 'use-pdf' },
		]);
		assert.strictEqual(folders.find(f => f.name === 'Not yet imported'), undefined);
	});

	test('isAssetName flags image/screenshot files (case-insensitive) and nothing else', () => {
		assert.deepStrictEqual(
			['shot.png', 'photo.JPG', 'a.jpeg', 'b.gif', 'c.svg', 'd.webp', 'data.csv', 'notes.txt', 'report.md', 'noext'].map(isAssetName),
			[true, true, true, true, true, true, false, false, false, false],
		);
	});

	test('buildTreeRailNodes shapes the grouped tree into collapsible folder + leaf nodes (issue #171)', () => {
		const A = URI.file('/ws/root.md');
		const B = URI.file('/ws/reports/2025/q1.md');
		const nodes = buildTreeRailNodes([
			{ title: 'Root Doc', resource: A, pendingCount: 0, sources: ['metrics.csv'], folder: '' },
			{ title: 'Q1', resource: B, pendingCount: 0, sources: [], folder: 'reports/2025' },
		]);
		// Reports keeps the on-disk hierarchy as nested folder nodes; Sources becomes a folder of leaves.
		assert.deepStrictEqual(project(nodes), [
			{
				folder: 'Reports', children: [
					{ folder: 'reports', children: [{ folder: '2025', children: [{ leaf: 'Q1', kind: 'doc' }] }] },
					{ leaf: 'Root Doc', kind: 'doc' },
				]
			},
			{ folder: 'Sources', children: [{ leaf: 'metrics.csv', kind: 'source' }] },
		]);
	});

	test('buildTreeRailNodes buckets un-bound image assets behind one collapsed Assets node, keeping bound sources visible (issue #171)', () => {
		const A = URI.file('/ws/report.md');
		const nodes = buildTreeRailNodes(
			// chart.png is a BOUND source (referenced by the doc) and stays visible; the loose screenshots are assets.
			[{ title: 'Report', resource: A, pendingCount: 0, sources: ['chart.png', 'metrics.csv'], folder: '' }],
			['shot-1.png', 'shot-2.png', 'shot-3.jpg', 'data.csv'],
		);
		const sources = nodes.find((n): n is Extract<ITreeRailNode, { type: 'folder' }> => n.type === 'folder' && n.label === 'Sources')!;
		assert.deepStrictEqual(project([sources]), [{
			folder: 'Sources', children: [
				// Non-image sources (bound + discovered), then a single collapsed Assets bucket for the images.
				{ leaf: 'chart.png', kind: 'source' },
				{ leaf: 'data.csv', kind: 'source' },
				{ leaf: 'metrics.csv', kind: 'source' },
				{
					folder: 'Assets (3)', children: [
						{ leaf: 'shot-1.png', kind: 'source' },
						{ leaf: 'shot-2.png', kind: 'source' },
						{ leaf: 'shot-3.jpg', kind: 'source' },
					]
				},
			],
		}]);
		// Ids are stable + path-based so selection + persisted collapse state survive re-renders/restart.
		const assetsNode = sources.children.find(c => c.type === 'folder')!;
		assert.strictEqual(assetsNode.id, 'folder:Sources/Assets');
	});

	test('collectAssetsFolderIds finds the Assets bucket id so the view can seed it collapsed on first open (issue #171)', () => {
		const A = URI.file('/ws/report.md');
		const withAssets = buildTreeRailNodes(
			[{ title: 'Report', resource: A, pendingCount: 0, sources: [], folder: '' }],
			['shot-1.png', 'shot-2.png', 'data.csv'],
		);
		const noAssets = buildTreeRailNodes(
			[{ title: 'Report', resource: A, pendingCount: 0, sources: [], folder: '' }],
			['data.csv'],
		);
		assert.deepStrictEqual(
			{ withAssets: collectAssetsFolderIds(withAssets), noAssets: collectAssetsFolderIds(noAssets), constId: ASSETS_FOLDER_ID },
			{ withAssets: ['folder:Sources/Assets'], noAssets: [], constId: 'folder:Sources/Assets' },
		);
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
