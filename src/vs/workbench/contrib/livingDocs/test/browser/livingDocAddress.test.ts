/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { addressLabel, buildBlockGutterEntries, computeBlockAddresses, resolveBlockLine, resolveBlockOrdinal } from '../../common/livingDocAddress.js';
import { parseLivingDoc } from '../../common/livingDocMarkdown.js';
import { IProposedChange } from '../../common/livingDocsModel.js';

// A living document: a heading, a plain prose block, then a source-bound block, so the address model can be
// exercised over a realistic block set (headings and paragraphs both count as blocks).
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

suite('LivingDoc address model (spec 43 section 3.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('computeBlockAddresses numbers every block 1-based in document order', () => {
		const doc = parseLivingDoc(DOC_MD);
		assert.deepStrictEqual(computeBlockAddresses(doc), [
			{ id: doc.blocks[0].id, line: 1 },
			{ id: doc.blocks[1].id, line: 2 },
			{ id: doc.blocks[2].id, line: 3 },
		]);
	});

	test('resolveBlockLine returns the current line for a live block and undefined for a deleted one', () => {
		const doc = parseLivingDoc(DOC_MD);
		assert.strictEqual(resolveBlockLine(doc, doc.blocks[1].id), 2);
		assert.strictEqual(resolveBlockLine(doc, doc.blocks[2].id), 3);
		// A persisted reference to a block that is gone degrades to undefined (deep link => doc, no scroll, no error).
		assert.strictEqual(resolveBlockLine(doc, 'b-does-not-exist'), undefined);
	});

	test('addressLabel renders the human "Line N" string every surface cites', () => {
		assert.strictEqual(addressLabel(1), 'Line 1');
		assert.strictEqual(addressLabel(6), 'Line 6');
	});

	test('buildBlockGutterEntries tones each block: idle, bound, or pending (pending outranks bound)', () => {
		const doc = parseLivingDoc(DOC_MD);
		const boundBlock = doc.blocks.find(b => b.binds.length > 0)!;
		// A pending, in-place meaning-change over the (source-bound) block: it must read as `pending`, not `bound`.
		const pending = [change({ blockId: boundBlock.id, oldText: boundBlock.text, newText: 'Margins slipped.' })];

		const entries = buildBlockGutterEntries(doc, pending, new Set([boundBlock.id]));

		assert.deepStrictEqual(entries, [
			{ id: doc.blocks[0].id, line: 1, tone: 'idle', keys: [], recent: false },
			{ id: doc.blocks[1].id, line: 2, tone: 'idle', keys: [], recent: false },
			{ id: doc.blocks[2].id, line: 3, tone: 'pending', keys: ['metrics.margin'], recent: true },
		]);
	});

	// The address the decoration layer mounts on (docs/30 section 4.3). Text is not an address; the ordinal is.
	suite('resolveBlockOrdinal', () => {
		test('resolves a block by id, and survives that block being edited after the change was proposed', () => {
			const doc = parseLivingDoc(DOC_MD);
			// The proposal was written against "Revenue grew fast this week."; the block has since been retyped.
			const drifted = parseLivingDoc(DOC_MD.replace('Revenue grew fast this week.', 'Revenue collapsed overnight, actually.'));
			assert.deepStrictEqual(
				{ before: resolveBlockOrdinal(doc, change({ blockId: doc.blocks[1].id })), afterDrift: resolveBlockOrdinal(drifted, change({ blockId: doc.blocks[1].id })) },
				{ before: 1, afterDrift: 1 },
			);
		});

		test('falls back to the span when the id addresses no block (a re-slugged heading)', () => {
			// A heading's id is its slug, so editing its text destroys the id the proposal was written against.
			// The span still says where in the body the change sits, and the body still chunks the same way.
			const doc = parseLivingDoc(DOC_MD);
			const spanOfThirdBlock = { start: doc.body.indexOf('Margins held'), end: doc.body.length };
			assert.deepStrictEqual(
				{
					withSpan: resolveBlockOrdinal(doc, change({ blockId: 'h-a-heading-that-was-renamed', span: spanOfThirdBlock })),
					withoutSpan: resolveBlockOrdinal(doc, change({ blockId: 'h-a-heading-that-was-renamed' })),
				},
				{ withSpan: 2, withoutSpan: undefined },
			);
		});

		test('disambiguates colliding heading ids by the span (two "## Notes" both slug to h-notes)', () => {
			const md = ['# Report', '', '## Notes', '', 'First note.', '', '## Notes', '', 'Second note.'].join('\n') + '\n';
			const doc = parseLivingDoc(md);
			assert.strictEqual(doc.blocks[1].id, doc.blocks[3].id, 'the two headings must actually collide for this test to mean anything');
			// Without a span the id can only offer the first of the two; with one, the second is addressable.
			const secondHeading = doc.body.lastIndexOf('## Notes');
			assert.deepStrictEqual(
				{
					second: resolveBlockOrdinal(doc, change({ blockId: doc.blocks[3].id, span: { start: secondHeading, end: secondHeading + '## Notes'.length } })),
					ambiguous: resolveBlockOrdinal(doc, change({ blockId: doc.blocks[3].id })),
				},
				{ second: 3, ambiguous: 1 },
			);
		});
	});

	test('an insert-only pending change tones no block as pending (it targets between blocks, not a block)', () => {
		const doc = parseLivingDoc(DOC_MD);
		const boundBlock = doc.blocks.find(b => b.binds.length > 0)!;
		const pending = [change({ id: 'ins1', insert: true, afterBlockId: doc.blocks[0].id, newText: '- a\n- b', blockLabel: 'Highlights' })];

		const entries = buildBlockGutterEntries(doc, pending, new Set());

		assert.deepStrictEqual(entries, [
			{ id: doc.blocks[0].id, line: 1, tone: 'idle', keys: [], recent: false },
			{ id: doc.blocks[1].id, line: 2, tone: 'idle', keys: [], recent: false },
			{ id: boundBlock.id, line: 3, tone: 'bound', keys: ['metrics.margin'], recent: false },
		]);
	});
});
