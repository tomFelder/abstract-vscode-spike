/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';
import { IProposedChange } from '../../common/livingDocsModel.js';
import { buildPmDecorationSpec, wordDiffSegments } from '../../common/livingDocPmDecorations.js';

// A living document with a plain prose block (an editable target), a bound block, and headings, so the
// decoration mapping can be exercised against a realistic ProseMirror-backed surface.
const DOC_MD = [
	'---',
	'title: Weekly Summary',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'## Highlights',
	'',
	'Revenue grew fast this week.',
	'',
	'Margins held [40%](bind:metrics.margin) steady.',
].join('\n') + '\n';

function change(overrides: Partial<IProposedChange>): IProposedChange {
	return {
		id: 'c1', docId: 'doc', docTitle: 'Weekly Summary', blockId: '', blockLabel: '',
		oldText: '', newText: '', kind: 'meaning', confidence: 0.85, rationale: '', sourceCells: [],
		...overrides,
	};
}

suite('LivingDoc PM decoration mapping', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a word diff splits into eq/del/ins runs with run counts', () => {
		const diff = wordDiffSegments('Revenue grew fast this week.', 'Revenue dropped sharply this week.');
		assert.deepStrictEqual(diff, {
			segments: [
				{ t: 'eq', text: 'Revenue' },
				{ t: 'del', text: 'grew fast' },
				{ t: 'ins', text: 'dropped sharply' },
				{ t: 'eq', text: 'this week.' },
			],
			added: 1,
			removed: 1,
		});
	});

	test('a meaning-change proposal maps to one edit decoration anchored on the block text', () => {
		const doc = parseLivingDoc(DOC_MD);
		const block = doc.blocks.find(b => b.text.startsWith('Revenue'))!;
		const pending = [change({ blockId: block.id, oldText: block.text, newText: 'Revenue dropped sharply this week.' })];

		const spec = buildPmDecorationSpec(doc, pending, new Set());

		assert.strictEqual(spec.edits.length, 1);
		assert.strictEqual(spec.inserts.length, 0);
		assert.deepStrictEqual(spec.edits[0], {
			id: 'c1',
			anchorText: 'Revenue grew fast this week.',
			segments: [
				{ t: 'eq', text: 'Revenue' },
				{ t: 'del', text: 'grew fast' },
				{ t: 'ins', text: 'dropped sharply' },
				{ t: 'eq', text: 'this week.' },
			],
			added: 1,
			removed: 1,
			source: 'metrics.csv',
			confidence: 0.85,
		});
	});

	test('a wrapped (multi-line) paragraph anchor is whitespace-collapsed so it matches the rendered node text', () => {
		// House style wraps each sentence on its own physical line. CommonMark renders soft wraps as single
		// spaces, so the live ProseMirror node's textContent is single-spaced. The decoration bundle places
		// the inline diff by EXACT match of anchorText against that textContent, so the anchor must collapse
		// its internal whitespace too - otherwise a wrapped paragraph never decorates and the change shows
		// only in the rail (the plan-19 baseline bug).
		const wrappedMd = [
			'## Visual identity',
			'',
			'The primary colour is blue. It anchors the logo, primary buttons, and',
			'links across every surface. The blue is reserved for the single most',
			'important action on a screen.',
		].join('\n') + '\n';
		const doc = parseLivingDoc(wrappedMd);
		const block = doc.blocks.find(b => b.text.startsWith('The primary colour'))!;
		// Sanity: the parsed block text really does carry the hard newlines from the wrapped source.
		assert.ok(block.text.includes('\n'), 'expected the wrapped block text to contain newlines');

		const pending = [change({ blockId: block.id, oldText: block.text, newText: 'The primary colour is red.' })];
		const spec = buildPmDecorationSpec(doc, pending, new Set());

		assert.strictEqual(spec.edits.length, 1);
		assert.strictEqual(
			spec.edits[0].anchorText,
			'The primary colour is blue. It anchors the logo, primary buttons, and links across every surface. The blue is reserved for the single most important action on a screen.',
		);
		assert.ok(!spec.edits[0].anchorText.includes('\n'), 'anchorText must not contain newlines');
	});

	test('a generative insert maps to an insert decoration anchored after its heading', () => {
		const doc = parseLivingDoc(DOC_MD);
		const heading = doc.blocks.find(b => b.type === 'heading')!;
		const pending = [change({
			id: 'c2', insert: true, afterBlockId: heading.id, blockLabel: 'Highlights',
			oldText: '', newText: '* one\n* two',
		})];

		const spec = buildPmDecorationSpec(doc, pending, new Set());

		assert.strictEqual(spec.edits.length, 0);
		assert.deepStrictEqual(spec.inserts, [{
			id: 'c2',
			afterText: 'Highlights',
			newText: '* one\n* two',
			blockLabel: 'Highlights',
			confidence: 0.85,
		}]);
	});

	test('an insert with no anchor block targets the end of the document', () => {
		const doc = parseLivingDoc(DOC_MD);
		const pending = [change({ id: 'c3', insert: true, afterBlockId: '', blockLabel: 'the end', newText: 'A closing note.' })];

		const spec = buildPmDecorationSpec(doc, pending, new Set());

		assert.strictEqual(spec.inserts[0].afterText, null);
	});

	test('bound blocks become gutter markers carrying their bind keys and recent flag', () => {
		const doc = parseLivingDoc(DOC_MD);
		const bound = doc.blocks.find(b => b.binds.length > 0)!;

		const spec = buildPmDecorationSpec(doc, [], new Set([bound.id]));

		assert.deepStrictEqual(spec.gutters, [{ keys: ['metrics.margin'], recent: true }]);
	});
});
