/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { bulkCandidates, deriveChangeClass, groupAnchorsByDoc, hashContent, IChange, IChangeAnchor, isOpenChange, isTerminalStatus, orderDocsForWrite, spliceDoc } from '../../common/changeRecord.js';
import { buildBulkSet } from '../../common/livingDocsModel.js';

// The change record's algebra (docs/30 sections 2.1 and 5). These are the pure rules the store leans on:
// which statuses are final, which changes a count may see, which end of a move is written first, and whether
// a splice is allowed to touch a document at all.

const A = 'file:///ws/a.md';
const B = 'file:///ws/b.md';

function anchor(docUri: string, base: string, oldText: string, newText: string): IChangeAnchor {
	const start = base.indexOf(oldText);
	return { docUri, baseRevision: hashContent(base), span: { start, end: start + oldText.length }, oldText, newText };
}

function change(id: string, partial: Partial<IChange>): IChange {
	return {
		id,
		setId: 'set-1',
		anchors: [anchor(A, 'one two three', 'two', 'TWO')],
		status: 'pending',
		changeClass: 'targeted',
		kind: 'figure',
		versions: [],
		thread: [],
		proposedAt: 1,
		...partial,
	};
}

suite('livingDocs changeRecord (docs/30 sections 2.1, 5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the three decided statuses are terminal and the four interrupted ones are not', () => {
		// Terminal means immutable: the store refuses every later write against these, which is what makes
		// "a decided change never resurrects" structural rather than a rule call sites must remember.
		assert.deepStrictEqual(
			(['pending', 'needs-attention', 'partially-applied', 'interrupted', 'unverified', 'approved', 'applied-recovered', 'rejected'] as const)
				.filter(isTerminalStatus),
			['approved', 'applied-recovered', 'rejected'],
		);
	});

	test('the open view hides decided and superseded changes, and every count folds through it', () => {
		const changes = [
			change('c1', {}),
			change('c2', { status: 'needs-attention', attentionReason: 'stale-base' }),
			change('c3', { status: 'approved' }),
			change('c4', { supersededBy: 'c5' }),
			change('c5', {}),
		];
		assert.deepStrictEqual(changes.filter(isOpenChange).map(c => c.id), ['c1', 'c2', 'c5']);
	});

	test('a bulk capture over store records reuses R3s ONE eligibility rule: attention and discussion are named exclusions', () => {
		// The store does not restate the bulk policy - it projects onto the shape `buildBulkSet` judges, so a
		// change that needs attention and a change under discussion are excluded and COUNTED in the sentence
		// rather than silently missing from the set (invariant I4).
		const changes = [
			change('c1', { kind: 'meaning' }),
			change('c2', { status: 'needs-attention', attentionReason: 'apply-failed' }),
			change('c3', { thread: [{ id: 't1', actor: 'user', text: 'why this wording?', at: 2 }] }),
			change('c4', { status: 'rejected' }),
		];
		const set = buildBulkSet({ verb: 'approve', docId: A }, bulkCandidates(changes));
		assert.deepStrictEqual(
			{ ids: set.ids, excluded: set.excluded, sentence: set.sentence },
			{
				ids: ['c1'],
				excluded: [{ reason: 'needs-attention', count: 1 }, { reason: 'in-discussion', count: 1 }],
				sentence: 'Approve 1 change? 1 change needing attention is not included. 1 change you are discussing is not included. A version snapshot is taken first, so you can restore.',
			},
		);
	});

	test('changeClass is derived from how much of the document the change touches, not from what the planner claims', () => {
		const base = 'x'.repeat(100);
		assert.deepStrictEqual(
			{
				targeted: deriveChangeClass([{ docUri: A, baseRevision: 'h', span: { start: 0, end: 20 }, oldText: '', newText: '' }], base.length),
				rewrite: deriveChangeClass([{ docUri: A, baseRevision: 'h', span: { start: 0, end: 100 }, oldText: '', newText: '' }], base.length),
			},
			{ targeted: 'targeted', rewrite: 'rewrite' },
		);
	});

	test('a move writes the insert side first, so an interrupted move duplicates text rather than losing it', () => {
		// The delete side is the one that destroys writing. Ordering it last means every crash window between
		// the two writes leaves the paragraph in BOTH documents - visible, nameable and recoverable - instead
		// of in neither, which is silent loss the user only discovers much later.
		const groups = groupAnchorsByDoc([
			anchor(A, 'keep this para', 'this para', ''),
			anchor(B, 'destination', 'destination', 'destination\nthis para'),
		]);
		assert.deepStrictEqual(orderDocsForWrite(groups), [B, A]);
	});

	test('a splice verifies every anchor before writing anything, and descending order keeps later offsets true', () => {
		const base = 'alpha beta gamma';
		assert.deepStrictEqual(
			{
				both: spliceDoc(base, [anchor(A, base, 'alpha', 'ALPHA'), anchor(A, base, 'gamma', 'GAMMA')]),
				moved: spliceDoc(base, [{ docUri: A, baseRevision: 'h', span: { start: 6, end: 10 }, oldText: 'moved on', newText: 'x' }]),
				outside: spliceDoc(base, [{ docUri: A, baseRevision: 'h', span: { start: 0, end: 99 }, oldText: base, newText: 'x' }]),
			},
			{
				both: { ok: true, text: 'ALPHA beta GAMMA' },
				moved: { ok: false, reason: 'anchor-miss' },
				outside: { ok: false, reason: 'block-gone' },
			},
		);
	});
});
