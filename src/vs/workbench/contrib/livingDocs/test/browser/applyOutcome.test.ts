/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyFailureRailNote, applyFailureStatus, blockApplyFailed, blockApplyLanded, describeApplyFailure } from '../../common/applyOutcome.js';

// I1 (docs/30; issue #329): an apply outcome is a CLOSED result, and a failure is said in plain words. The
// service suite stages both failures end to end and pins that no approval is recorded; the markdown suite pins
// which result the primitive returns. This suite pins the third half of the invariant - that the failure the
// user actually reads names what happened to their document - with no service and no DOM.

suite('livingDocs applyOutcome (I1, issue #329)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the two shapes are disjoint: a landed result carries text, a failed one carries only a reason', () => {
		// The whole invariant in one assertion. There is no `text` on a failure to be mistaken for the block, and
		// no `reason` on a success - so no caller can read one as the other, which is exactly how issue #329
		// turned an untouched document into a recorded approval.
		assert.deepStrictEqual(
			{ landed: blockApplyLanded('the rewritten block'), failed: blockApplyFailed('anchor-miss') },
			{ landed: { landed: true, text: 'the rewritten block' }, failed: { landed: false, reason: 'anchor-miss' } },
		);
	});

	test('both failures read as plain words about the document, in the clause, the rail note and the status', () => {
		assert.deepStrictEqual(
			{
				anchorClause: describeApplyFailure('anchor-miss'),
				goneClause: describeApplyFailure('block-gone'),
				railNote: applyFailureRailNote('anchor-miss'),
				status: applyFailureStatus('Weekly Summary', 'block-gone'),
			},
			{
				anchorClause: 'the text it was written for has changed since it was proposed',
				goneClause: 'the part of the document it was written for is no longer there',
				railNote: 'This change was not applied - the text it was written for has changed since it was proposed. Nothing was written to the document, and the change is still waiting on your call.',
				status: 'Change could not be applied - Weekly Summary is unchanged because the part of the document it was written for is no longer there',
			},
		);
	});
});
