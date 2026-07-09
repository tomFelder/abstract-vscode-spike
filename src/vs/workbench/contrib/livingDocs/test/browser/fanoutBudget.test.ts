/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { estimateTokens, IFanoutDoc, planFanoutBatches } from '../../common/fanoutBudget.js';

// Fan-out context budgeting (plan 30, track 3, D30-B). The pure packer splits the working set into
// context-bounded batches, preserves order, puts each document in exactly one batch, and sets aside a
// document too large for the budget rather than sending (and silently truncating) it. Unit-tested here
// with no model, so the packing contract the service relies on is proven deterministically.

suite('livingDocs fanoutBudget (plan 30, track 3, D30-B)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Build a doc whose body is exactly `tokens * 4` chars, so estimateTokens(body) === tokens (chars/4).
	const doc = (id: string, tokens: number): IFanoutDoc => ({ id, title: id, body: 'x'.repeat(tokens * 4) });

	test('estimateTokens is chars/4, rounds up, and is zero for empty', () => {
		assert.strictEqual(estimateTokens(''), 0, 'empty string is zero tokens');
		assert.strictEqual(estimateTokens('abcd'), 1, '4 chars => 1 token');
		assert.strictEqual(estimateTokens('abcde'), 2, '5 chars => 2 tokens (rounds up)');
		assert.strictEqual(estimateTokens('x'.repeat(4000)), 1000, '4000 chars => 1000 tokens');
	});

	test('a working set that fits the budget is a single batch, order preserved', () => {
		const docs = [doc('a', 100), doc('b', 100), doc('c', 100)];
		// Budget 4000, no overhead => usable 4000 tokens; 300 total fits in one batch.
		const plan = planFanoutBatches(docs, 4000, 0);
		assert.strictEqual(plan.batchCount, 1, 'one batch');
		assert.strictEqual(plan.oversize.length, 0, 'nothing oversize');
		assert.deepStrictEqual(plan.batches[0].docs.map(d => d.id), ['a', 'b', 'c'], 'order preserved');
		assert.strictEqual(plan.batches[0].tokens, 300, 'batch token cost is the summed estimate');
	});

	test('a working set larger than the budget is split into ordered batches at the boundary', () => {
		// Usable per-batch budget = 2600 - 100 overhead = 2500 tokens. Five 600-token docs => 3000 total.
		// Greedy pack: [a,b,c,d] would be 2400 (<=2500) but adding a 5th 600 => 3000 > 2500, so [a,b,c,d]
		// then [e]. Actually 600*4 = 2400 fits, 600*5 = 3000 overflows, so batch1 = a,b,c,d; batch2 = e.
		const docs = [doc('a', 600), doc('b', 600), doc('c', 600), doc('d', 600), doc('e', 600)];
		const plan = planFanoutBatches(docs, 2600, 100);
		assert.strictEqual(plan.batchCount, 2, 'two batches');
		assert.deepStrictEqual(plan.batches[0].docs.map(d => d.id), ['a', 'b', 'c', 'd'], 'first batch fills to the boundary in order');
		assert.deepStrictEqual(plan.batches[1].docs.map(d => d.id), ['e'], 'the overflow document opens the next batch');
		// Every document appears in exactly one batch (uniqueness by construction - the merge cannot double-count).
		const packed = plan.batches.flatMap(b => b.docs.map(d => d.id));
		assert.deepStrictEqual([...packed].sort(), ['a', 'b', 'c', 'd', 'e'], 'every doc packed exactly once');
	});

	test('a document larger than the whole budget is set aside as oversize, never packed', () => {
		// Usable budget 1000; the middle doc is 2000 tokens - too large for any batch.
		const docs = [doc('small-1', 300), doc('huge', 2000), doc('small-2', 300)];
		const plan = planFanoutBatches(docs, 1000, 0);
		assert.deepStrictEqual(plan.oversize.map(d => d.id), ['huge'], 'the oversize doc is flagged, not sent');
		const packed = plan.batches.flatMap(b => b.docs.map(d => d.id));
		assert.ok(!packed.includes('huge'), 'the oversize doc never appears in any batch (no silent truncation)');
		assert.deepStrictEqual([...packed].sort(), ['small-1', 'small-2'], 'the fitting docs still pack');
	});

	test('a large prompt overhead shrinks the usable per-batch budget but never below the floor', () => {
		// contextBudget 1000, overhead 2000 => raw usable would be negative; the floor (512) applies.
		const docs = [doc('a', 100), doc('b', 100)];
		const plan = planFanoutBatches(docs, 1000, 2000);
		// Both docs are 100 tokens, well under the 512 floor, so they still pack into one batch.
		assert.strictEqual(plan.batchCount, 1, 'the floor keeps a usable budget so small docs still pack');
		assert.strictEqual(plan.oversize.length, 0, 'small docs are not spuriously flagged oversize');
	});

	test('an empty working set yields no batches and no oversize', () => {
		const plan = planFanoutBatches([], 4000, 0);
		assert.strictEqual(plan.batchCount, 0, 'no batches');
		assert.strictEqual(plan.oversize.length, 0, 'no oversize');
	});
});
