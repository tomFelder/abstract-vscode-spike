/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IProposedChange, nextPendingDocId, summariseProjectRun } from '../../common/livingDocsModel.js';

function change(docId: string, id: string): IProposedChange {
	return {
		id, docId, docTitle: docId, blockId: '', blockLabel: '', oldText: '', newText: '',
		kind: 'meaning', confidence: 0.8, rationale: '', sourceCells: [],
	};
}

suite('LivingDoc model - nextPendingDocId', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('advances to the next document that still has pending changes', () => {
		const pending = [change('a', '1'), change('b', '2'), change('c', '3')];
		assert.strictEqual(nextPendingDocId(pending, 'a'), 'b');
		assert.strictEqual(nextPendingDocId(pending, 'b'), 'c');
	});

	test('cycles round-robin from the last changed document back to the first', () => {
		const pending = [change('a', '1'), change('b', '2'), change('c', '3')];
		assert.strictEqual(nextPendingDocId(pending, 'c'), 'a');
	});

	test('orders by first appearance and ignores duplicate changes on the same doc', () => {
		const pending = [change('a', '1'), change('a', '2'), change('b', '3')];
		assert.strictEqual(nextPendingDocId(pending, 'a'), 'b');
	});

	test('returns the first changed doc when the current document has no pending changes', () => {
		const pending = [change('b', '1'), change('c', '2')];
		assert.strictEqual(nextPendingDocId(pending, 'a'), 'b');
	});

	test('returns undefined when the current document is the only one with pending changes', () => {
		assert.strictEqual(nextPendingDocId([change('a', '1'), change('a', '2')], 'a'), undefined);
	});

	test('returns undefined when there are no pending changes at all', () => {
		assert.strictEqual(nextPendingDocId([], 'a'), undefined);
	});
});

suite('LivingDoc model - summariseProjectRun', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const docs = [
		{ docId: 'a', docTitle: 'Access Control' },
		{ docId: 'b', docTitle: 'Acceptable Use' },
		{ docId: 'c', docTitle: 'Cryptography' },
	];

	test('aggregates pending changes by document into changed / no-change tiles with totals', () => {
		const pending = [change('a', '1'), change('a', '2'), change('b', '3')];
		assert.deepStrictEqual(summariseProjectRun(docs, pending), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'changed', changeCount: 2 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'changed', changeCount: 1 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'no-change', changeCount: 0 },
			],
			totalChanges: 3,
			changedDocs: 2,
			unchangedDocs: 1,
		});
	});

	test('reports every document as no-change and zero totals when nothing is pending', () => {
		assert.deepStrictEqual(summariseProjectRun(docs, []), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'no-change', changeCount: 0 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'no-change', changeCount: 0 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'no-change', changeCount: 0 },
			],
			totalChanges: 0,
			changedDocs: 0,
			unchangedDocs: 3,
		});
	});

	test('ignores pending changes for documents outside the project so totalChanges equals the tile sum', () => {
		// A stale snapshot / a doc removed mid-run can leave a pending change whose docId has no tile.
		// It must not inflate totalChanges, which the bottom bar reports as "N changes in M documents".
		const pending = [change('a', '1'), change('ghost', '2'), change('ghost', '3')];
		const summary = summariseProjectRun([{ docId: 'a', docTitle: 'Access Control' }], pending);
		assert.deepStrictEqual(summary, {
			tiles: [{ docId: 'a', docTitle: 'Access Control', status: 'changed', changeCount: 1 }],
			totalChanges: 1,
			changedDocs: 1,
			unchangedDocs: 0,
		});
	});
});
