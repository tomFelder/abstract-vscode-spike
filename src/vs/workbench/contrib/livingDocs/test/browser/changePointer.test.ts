/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildChangePointer, buildTurnPointers, changeRendersInline } from '../../common/changePointer.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';
import { buildPmDecorationSpec } from '../../common/livingDocPmDecorations.js';
import { ILivingDoc, IProposedChange } from '../../common/livingDocsModel.js';

// A document with the block shapes the routing rule has to tell apart: plain prose (decorates), prose
// carrying a bound figure (decorates - bind links bake down to their values before anchoring), a bullet
// list (does NOT decorate, issue #300) and a table (does not decorate either, same mechanism).
const DOC_MD = [
	'---',
	'title: Weekly Operating Summary',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'## Commentary',
	'',
	'Growth remained steady this week, continuing the gradual climb seen since early Q2.',
	'',
	'Margins held [40%](bind:metrics.margin) steady through the quarter.',
	'',
	'## Colour tokens',
	'',
	'- Neutral ink `#14161A`',
	'- Surface `#FFFFFF`',
	'- Accent blue `#2C5BE5`',
	'',
	'| Metric | Value |',
	'| --- | --- |',
	'| Churn | 3.1% |',
].join('\n') + '\n';

function change(overrides: Partial<IProposedChange>): IProposedChange {
	return {
		id: 'c1', docId: 'file:///weekly.md', docTitle: 'Weekly Operating Summary', blockId: '', blockLabel: '',
		oldText: '', newText: '', kind: 'meaning', confidence: 0.9, rationale: '', sourceCells: [],
		...overrides,
	};
}

function blockStartingWith(doc: ILivingDoc, prefix: string) {
	return doc.blocks.find(b => b.text.startsWith(prefix))!;
}

suite('livingDocs - the chat transcript change pointer (plan 52 WP-A1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const doc = parseLivingDoc(DOC_MD);
	const prose = blockStartingWith(doc, 'Growth remained');
	const bound = blockStartingWith(doc, 'Margins held');
	const list = blockStartingWith(doc, '- Neutral ink');
	const table = blockStartingWith(doc, '| Metric');

	const proseEdit = change({
		id: 'p1', blockId: prose.id, blockLabel: 'Commentary', oldText: prose.text,
		newText: 'Growth accelerated sharply this week, surpassing the gradual climb observed since early Q2.',
	});
	const boundEdit = change({
		id: 'p2', blockId: bound.id, blockLabel: 'Commentary', oldText: bound.text,
		newText: 'Margins held 40% steady through the half.',
	});
	const listEdit = change({
		id: 'p3', blockId: list.id, blockLabel: 'Colour tokens', oldText: list.text,
		newText: '- Neutral ink `#101214`',
	});
	const tableEdit = change({
		id: 'p4', blockId: table.id, blockLabel: 'Metric', oldText: table.text,
		newText: '| Metric | Value |\n| --- | --- |\n| Churn | 2.4% |',
	});
	const insertion = change({
		id: 'p5', blockId: '', blockLabel: 'Colour tokens', insert: true, afterBlockId: list.id,
		oldText: '', newText: 'A new paragraph the model wrote.', kind: 'meaning',
	});

	test('the route follows whether the document will actually mount an inline widget', () => {
		// The mechanism, asserted against the REAL decoration spec rather than a hand-written list. A widget is
		// placed by matching its anchor against a live ProseMirror node's rendered `textContent`, so an anchor
		// that still carries Markdown syntax can never match: `- Neutral ink \`#14161A\`` versus the node's
		// `Neutral ink #14161A`. The anchors below are what the decoration layer really ships for this set, and
		// the routes must agree with them block type for block type - that agreement is the point of the pointer.
		const pending = [proseEdit, boundEdit, listEdit, tableEdit, insertion];
		const spec = buildPmDecorationSpec(doc, pending, new Set());

		assert.deepStrictEqual({
			routes: pending.map(c => `${c.id}:${buildChangePointer(c, doc).route}`),
			anchors: spec.edits.map(e => `${e.id}:${e.anchorText}`),
			// An insertion mounts its own all-additions widget after a heading, so it is always a document route.
			insertRendersInline: changeRendersInline(doc, insertion),
		}, {
			routes: ['p1:document', 'p2:document', 'p3:review', 'p4:review', 'p5:document'],
			anchors: [
				// Plain prose: the anchor is the sentence the reader sees, so it matches its node.
				'p1:Growth remained steady this week, continuing the gradual climb seen since early Q2.',
				// A bound figure bakes down to its value before anchoring, so this one matches its node too.
				'p2:Margins held 40% steady through the quarter.',
				// The list keeps its `-` marker and its backticks; no rendered node ever reads like this (#300).
				'p3:- Neutral ink `#14161A`',
				// The table keeps its pipes, for the same reason.
				'p4:| Metric | Value | | --- | --- | | Churn | 3.1% |',
			],
			insertRendersInline: true,
		});
	});

	test('a pointer carries identity, address and size - and never the proposed prose', () => {
		const pointer = buildChangePointer(proseEdit, doc);
		assert.deepStrictEqual({
			pointer,
			// The whole reason the model is structural: nothing on it repeats the proposal's words. A pointer
			// that carried `newText` would be the second copy this package exists to remove.
			carriesProse: JSON.stringify(pointer).includes('accelerated sharply'),
		}, {
			pointer: {
				changeId: 'p1',
				docId: 'file:///weekly.md',
				blockId: prose.id,
				insert: false,
				attention: true,
				blockLabel: 'Commentary',
				// "Commentary" is line 1, so the prose paragraph under it is line 2.
				line: 2,
				// The same word-run counts the inline widget prints for this change ("+3 added, 3 removed").
				added: 3,
				removed: 3,
				route: 'document',
			},
			carriesProse: false,
		});
	});

	test('an unloaded document, a deleted block and an insertion each degrade to a legible surface', () => {
		// A block the document no longer has: no widget to scroll to and no line to cite, so the pointer routes
		// to Review (which still renders the change) rather than stranding the reader on a missing block.
		const orphan = change({ id: 'p6', blockId: 'gone', blockLabel: 'Commentary', oldText: 'x', newText: 'y' });
		assert.deepStrictEqual({
			unloadedDoc: buildChangePointer(proseEdit, undefined),
			orphan: { line: buildChangePointer(orphan, doc).line, route: buildChangePointer(orphan, doc).route },
			// An insertion has no oldText to diff, so it reports no counts at all rather than a hollow "+1 -0".
			insertion: { added: buildChangePointer(insertion, doc).added, removed: buildChangePointer(insertion, doc).removed, insert: true },
		}, {
			unloadedDoc: {
				changeId: 'p1', docId: 'file:///weekly.md', blockId: prose.id, insert: false, attention: true,
				blockLabel: 'Commentary', added: 3, removed: 3, route: 'review',
			},
			orphan: { line: undefined, route: 'review' },
			insertion: { added: undefined, removed: undefined, insert: true },
		});
	});

	test('a turn shows pointers only for the changes still pending, in live order', () => {
		// The turn proposed three changes; one has since been approved (so it left the pending set) and one id
		// belongs to a different turn. The transcript must show exactly the two that are still open.
		const stillPending = [listEdit, proseEdit, boundEdit];
		const pointers = buildTurnPointers(['p1', 'p3', 'p9-approved'], stillPending, () => doc);
		assert.deepStrictEqual(pointers.map(p => ({ id: p.changeId, route: p.route, label: p.blockLabel })), [
			{ id: 'p3', route: 'review', label: 'Colour tokens' },
			{ id: 'p1', route: 'document', label: 'Commentary' },
		]);
	});
});
