/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { addressLabel, buildBlockGutterEntries, computeBlockAddresses, resolveBlockLine } from '../../common/livingDocAddress.js';
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
