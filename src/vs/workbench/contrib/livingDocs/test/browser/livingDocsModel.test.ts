/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IProposedChange, nextPendingDocId } from '../../common/livingDocsModel.js';

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
