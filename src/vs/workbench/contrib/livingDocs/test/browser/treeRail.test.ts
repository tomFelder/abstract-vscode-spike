/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';
import { ASSETS_FOLDER_ID, buildFileTree, buildOutline, buildTreeRailNodes, classifyWorkspaceExtra, collectAssetsFolderIds, filterTreeRailNodes, isAssetName, ITreeRailNode, RECENT_FOLDER_ID, searchTreeRail } from '../../common/treeRail.js';

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

	test('buildFileTree computes each row\'s status dot: doc precedence (grey/green/yellow/red) + grey source/unsupported dashes (livingDocs #212)', () => {
		const folders = buildFileTree([
			{ title: 'Calm', resource: URI.file('/ws/Calm.md'), pendingCount: 0, sources: ['metrics.csv'] },
			{ title: 'Applied', resource: URI.file('/ws/Applied.md'), pendingCount: 0, sources: [], unseenAgentEdits: 2 },
			{ title: 'Pending', resource: URI.file('/ws/Pending.md'), pendingCount: 3, sources: [] },
			{ title: 'Needs input', resource: URI.file('/ws/Needs.md'), pendingCount: 1, sources: [], stale: true },
		], ['legacy.doc']);
		const projection = folders.map(f => ({
			name: f.name,
			items: f.items.map(i => ({ label: i.label, kind: i.kind, shape: i.dot.shape, color: i.dot.color })),
		}));
		assert.deepStrictEqual(projection, [
			{
				name: 'Reports', items: [
					{ label: 'Applied', kind: 'doc', shape: 'dot', color: 'green' },
					{ label: 'Calm', kind: 'doc', shape: 'dot', color: 'grey' },
					{ label: 'Needs input', kind: 'doc', shape: 'dot', color: 'red' },
					{ label: 'Pending', kind: 'doc', shape: 'dot', color: 'yellow' },
				]
			},
			{ name: 'Sources', items: [{ label: 'metrics.csv', kind: 'source', shape: 'dash', color: 'grey' }] },
			{ name: 'Not yet imported', items: [{ label: 'legacy.doc', kind: 'unsupported', shape: 'dash', color: 'grey' }] },
		]);
	});

	test('buildTreeRailNodes adds a capped, MRU-ordered Recent group above Reports with distinct collision-free ids, hidden below two (livingDocs #212)', () => {
		const docInputs = ['A', 'B', 'C', 'D', 'E', 'F'].map(t => ({ title: t, resource: URI.file(`/ws/${t}.md`), pendingCount: 0, sources: [] }));
		// Six MRU resources (newest first); the group caps at five and drops the rest, in MRU order.
		const recent = ['F', 'E', 'D', 'C', 'B', 'A'].map(t => URI.file(`/ws/${t}.md`));
		const nodes = buildTreeRailNodes(docInputs, [], recent);
		const recentNode = nodes.find(n => n.type === 'folder' && n.id === RECENT_FOLDER_ID);
		assert.ok(recentNode && recentNode.type === 'folder', 'Recent is the first group above Reports');
		assert.deepStrictEqual(
			{
				firstGroupIsRecent: nodes[0].type === 'folder' && nodes[0].id === RECENT_FOLDER_ID,
				recentLeaves: recentNode.children.map(c => c.type === 'leaf' ? { label: c.item.label, id: c.id } : { folder: c.label }),
				// A Recent leaf carries the distinct RECENT_FOLDER_ID prefix, never colliding with its Reports twin.
				idsAllDistinctFromReports: recentNode.children.every(c => c.id.startsWith(`${RECENT_FOLDER_ID}/leaf:`)),
				// One recent doc is not worth a group.
				hiddenBelowTwo: buildTreeRailNodes(docInputs, [], [URI.file('/ws/A.md')]).some(n => n.type === 'folder' && n.id === RECENT_FOLDER_ID),
			},
			{
				firstGroupIsRecent: true,
				recentLeaves: [
					{ label: 'F', id: `${RECENT_FOLDER_ID}/leaf:${URI.file('/ws/F.md').toString()}` },
					{ label: 'E', id: `${RECENT_FOLDER_ID}/leaf:${URI.file('/ws/E.md').toString()}` },
					{ label: 'D', id: `${RECENT_FOLDER_ID}/leaf:${URI.file('/ws/D.md').toString()}` },
					{ label: 'C', id: `${RECENT_FOLDER_ID}/leaf:${URI.file('/ws/C.md').toString()}` },
					{ label: 'B', id: `${RECENT_FOLDER_ID}/leaf:${URI.file('/ws/B.md').toString()}` },
				],
				idsAllDistinctFromReports: true,
				hiddenBelowTwo: false,
			},
		);
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

	test('buildTreeRailNodes gives same-titled documents distinct resource-based leaf ids so the tree cannot reconcile the wrong row (issue #171)', () => {
		// Two documents in the same folder can share a title; a label-based leaf id would collide, and the
		// tree's identityProvider would then select/reconcile the wrong node. Leaf ids derive from the unique
		// on-disk resource, so the two rows are distinguishable even though their labels are identical.
		const nodes = buildTreeRailNodes([
			{ title: 'Status', resource: URI.file('/ws/reports/Status.md'), pendingCount: 0, sources: [], folder: 'reports' },
			{ title: 'Status', resource: URI.file('/ws/reports/Status-2.md'), pendingCount: 0, sources: [], folder: 'reports' },
		]);
		const reports = nodes.find((n): n is Extract<ITreeRailNode, { type: 'folder' }> => n.type === 'folder' && n.label === 'Reports')!;
		const reportsFolder = reports.children.find((c): c is Extract<ITreeRailNode, { type: 'folder' }> => c.type === 'folder' && c.label === 'reports')!;
		const leafIds = reportsFolder.children.filter(c => c.type === 'leaf').map(c => c.id);
		assert.strictEqual(new Set(leafIds).size, 2, 'the two same-titled documents have distinct leaf ids');
		assert.ok(leafIds.every(id => id.includes('Status')), 'each leaf id carries its own resource');
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

	test('buildOutline returns headings in order (living OR plain doc), stripped of Markdown/bind syntax, with a stable headingIndex that skips blank headings', () => {
		// A PLAIN Markdown document (isLiving: false) still gets a full outline (issue #181). The outline is
		// derived from the RAW body the editor renders, so a blank ATX heading (`##` with no text) is not shown
		// as a row but STILL advances headingIndex, keeping each entry lined up with the Nth rendered `<hN>`.
		const body = [
			'# Weekly Operating Summary',
			'',
			'## [Highlights](bind:x)',
			'',
			'Prose in between.',
			'',
			'##   ',
			'',
			'## Key metrics',
			'',
		].join('\n');
		const d: ILivingDoc = { ...doc('Notes', [], body), isLiving: false, blocks: [] };
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Weekly Operating Summary', level: 1, headingIndex: 0 },
			{ text: 'Highlights', level: 2, headingIndex: 1 },
			{ text: 'Key metrics', level: 2, headingIndex: 3 },
		]);
		assert.deepStrictEqual(buildOutline(undefined), []);
	});

	test('buildOutline counts setext + blockquote-nested headings so its indices match the rendered <hN> ordinals (issue #181 regression)', () => {
		// The DOM the Outline scrolls is rendered by prosemirror-markdown (markdown-it) from the raw body, which
		// renders SETEXT headings (`Title` underlined by `===`/`---`) and headings nested in a BLOCKQUOTE as real
		// `<hN>` elements. The old outline counted only single-line ATX headings, so every ordinal after a setext
		// or blockquote heading drifted and Outline clicks scrolled to the WRONG heading. Deriving the outline
		// from the same body scan makes the ordinals line up 1:1. `---` after a blank line is a thematic break,
		// NOT a setext underline, and a fenced code block's `# ...` line is not a heading - both excluded, so the
		// count matches the DOM exactly. Against the pre-fix (block-ordinal) code the indices would read
		// 0/1/2/3 and the setext/blockquote headings would be missing entirely, so this asserts the fix.
		const body = [
			'Alpha Setext Title',    // rendered <h1> #0 (setext, underlined below)
			'==================',
			'',
			'## Bravo',              // rendered <h2> #1 (ATX)
			'',
			'> # Quoted Charlie',    // rendered <h1> #2 (heading inside a blockquote)
			'',
			'```',
			'# Not A Heading',       // inside a fence: NOT rendered as a heading
			'```',
			'',
			'Delta Setext',          // rendered <h2> #3 (setext, `-` underline after content)
			'------------',
			'',
			'---',                   // thematic break (blank line before): NOT a heading
			'',
			'### Echo',              // rendered <h3> #4 (ATX)
			'',
		].join('\n');
		const d: ILivingDoc = { ...doc('Mixed', [], body), isLiving: false, blocks: [] };
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Alpha Setext Title', level: 1, headingIndex: 0 },
			{ text: 'Bravo', level: 2, headingIndex: 1 },
			{ text: 'Quoted Charlie', level: 1, headingIndex: 2 },
			{ text: 'Delta Setext', level: 2, headingIndex: 3 },
			{ text: 'Echo', level: 3, headingIndex: 4 },
		]);
	});

	test('buildOutline counts list-item-nested headings (markdown-it renders `- # x` inside the <li>) without over-counting lazy/code setext underlines (issue #181 regression)', () => {
		// markdown-it renders a heading nested in a list item as a real `<hN>` inside the `<li>`, so the Outline
		// scan must count it or every ordinal after it drifts and clicks scroll to the wrong heading. It must
		// NOT, however, over-count: a setext underline UNDER a list item only underlines when it reaches the
		// item's content column (marker width) and sits no more than three columns past it - a less-indented
		// `===` is a lazy paragraph continuation (no heading) and a more-indented one is a code block (no
		// heading). Verified against markdown-it in the two-parser harness. Each comment is the rendered <hN>.
		const body = [
			'- # Bullet ATX',       // rendered <h1> #0 (ATX inside a `-` list item)
			'',
			'1. ## Ordered ATX',    // rendered <h2> #1 (ATX inside a `1.` list item)
			'',
			'- Setext In List',     // rendered <h1> #2 (setext: underline reaches the content column)
			'  ================',
			'',
			'- Lazy Not Heading',   // NOT a heading: the `===` is unindented -> lazy paragraph continuation
			'===',
			'',
			'## Tail',              // rendered <h2> #3 (ATX) - proves the count did not drift
			'',
		].join('\n');
		const d: ILivingDoc = { ...doc('Listy', [], body), isLiving: false, blocks: [] };
		assert.deepStrictEqual(buildOutline(d), [
			{ text: 'Bullet ATX', level: 1, headingIndex: 0 },
			{ text: 'Ordered ATX', level: 2, headingIndex: 1 },
			{ text: 'Setext In List', level: 1, headingIndex: 2 },
			{ text: 'Tail', level: 2, headingIndex: 3 },
		]);
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

	test('filterTreeRailNodes narrows to matching rows, keeps ancestor folders, and passes a blank query through', () => {
		// Two docs in nested Reports folders + one loose source, so the filter must prune folders that hold no match.
		const nodes = buildTreeRailNodes(
			[
				{ title: 'Weekly Summary', resource: URI.file('/ws/reports/2025/Weekly Summary.md'), pendingCount: 0, sources: [], folder: 'reports/2025' },
				{ title: 'Board Note', resource: URI.file('/ws/reports/Board Note.md'), pendingCount: 0, sources: [], folder: 'reports' },
			],
			['metrics.csv'],
		);
		// Collect every leaf label reachable under a filtered tree, so one deepStrictEqual reads the whole shape.
		const labels = (roots: readonly ITreeRailNode[]): string[] => {
			const out: string[] = [];
			const walk = (n: ITreeRailNode): void => n.type === 'leaf' ? void out.push(n.item.label) : n.children.forEach(walk);
			roots.forEach(walk);
			return out.sort();
		};
		assert.deepStrictEqual(
			{
				weekly: labels(filterTreeRailNodes(nodes, 'weekly')),
				metrics: labels(filterTreeRailNodes(nodes, 'metrics')),
				noMatch: filterTreeRailNodes(nodes, 'zzz').length,
				blankUnchanged: labels(filterTreeRailNodes(nodes, '   ')),
				original: labels(nodes),
			},
			{
				weekly: ['Weekly Summary'],
				metrics: ['metrics.csv'],
				noMatch: 0,
				blankUnchanged: ['Board Note', 'Weekly Summary', 'metrics.csv'],
				original: ['Board Note', 'Weekly Summary', 'metrics.csv'],
			},
		);
	});

	test('filterTreeRailNodes keeps a document matched only by body text (P4.2 content reach)', () => {
		// Two docs whose labels do NOT contain "primary colour" - the phrase only lives in Board Note's body. The
		// view resolves the body-match set via `searchTreeRail`, then feeds the leaf resources to the filter, which
		// must surface Board Note (kept via bodyMatchResources) while a term in no label or body prunes to nothing.
		const boardResource = URI.file('/ws/reports/Board Note.md');
		const nodes = buildTreeRailNodes([
			{ title: 'Weekly Summary', resource: URI.file('/ws/reports/2025/Weekly Summary.md'), pendingCount: 0, sources: [], folder: 'reports/2025' },
			{ title: 'Board Note', resource: boardResource, pendingCount: 0, sources: [], folder: 'reports' },
		]);
		const labels = (roots: readonly ITreeRailNode[]): string[] => {
			const out: string[] = [];
			const walk = (n: ITreeRailNode): void => n.type === 'leaf' ? void out.push(n.item.label) : n.children.forEach(walk);
			roots.forEach(walk);
			return out.sort();
		};
		// The body-match set the view derives from `searchTreeRail` for a given query - always recomputed per query,
		// so the tree filter and the set agree. Only Board Note's body carries "primary colour"; nothing carries "zzz".
		const bodySet = (query: string) => new Set(searchTreeRail(
			[
				{ title: 'Weekly Summary', resource: URI.file('/ws/reports/2025/Weekly Summary.md'), body: 'Revenue grew this week.' },
				{ title: 'Board Note', resource: boardResource, body: 'The brand refresh keeps the primary colour unchanged.' },
			],
			query,
		).map(hit => hit.resource.toString()));
		assert.deepStrictEqual(
			{
				bodyPhrase: labels(filterTreeRailNodes(nodes, 'primary colour', bodySet('primary colour'))),
				noBodySet: filterTreeRailNodes(nodes, 'primary colour').length,
				unmatched: filterTreeRailNodes(nodes, 'zzz', bodySet('zzz')).length,
			},
			{
				bodyPhrase: ['Board Note'],
				noBodySet: 0,
				unmatched: 0,
			},
		);
	});
});
