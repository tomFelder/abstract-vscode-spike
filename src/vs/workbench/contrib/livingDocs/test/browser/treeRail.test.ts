/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILivingDoc } from '../../common/livingDocsModel.js';
import { buildFileTree, buildOutline, classifyWorkspaceExtra, searchTreeRail } from '../../common/treeRail.js';

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
});
