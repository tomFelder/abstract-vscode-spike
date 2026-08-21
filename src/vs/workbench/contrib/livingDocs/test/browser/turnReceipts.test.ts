/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { reconcileTurnReceipt } from '../../common/turnReceipts.js';

// I3 (docs/30; issue #303): a reply that claims edits the queue dropped must reconcile before it renders. The
// service tests stage each drop reason end to end; this suite pins the pure formatting contract those receipts
// are rendered through - the failure/partial/clean split, the named reasons, and the plural forms - with no
// model, no service and no DOM. Together they cover both halves of the invariant: that the right reason is
// DETECTED (service suite) and that it is SAID in plain words (here).

suite('livingDocs turnReceipts (I3, issue #303)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('claimed with NOTHING queued is a failure that names every reason and discards the success prose', () => {
		const outcome = reconcileTurnReceipt({
			claimed: 4,
			queued: 0,
			drops: ['policy', 'heading', 'no-match', 'heading'],
			reply: 'I tightened all four sections for you.',
		});
		assert.deepStrictEqual(
			outcome,
			{
				content: 'I described 4 changes but could not apply any of them: 2 targeted headings, 1 was blocked by the document\'s policy, 1 quoted text that is not in the document.',
				isError: true,
			},
			'the reasons are tallied and named, and the model\'s prose never reaches the bubble',
		);
	});

	test('every drop reason has plain words in both its singular and plural form', () => {
		const say = (drops: Parameters<typeof reconcileTurnReceipt>[0]['drops']) =>
			reconcileTurnReceipt({ claimed: drops.length, queued: 0, drops, reply: 'done' }).content;
		assert.deepStrictEqual(
			{
				policy: say(['policy']),
				heading: say(['heading']),
				noMatch: say(['no-match']),
				bindGuard: say(['bind-guard']),
				noOp: say(['no-op']),
				empty: say(['empty']),
				titleMiss: say(['title-miss']),
				plurals: say(['bind-guard', 'bind-guard', 'title-miss', 'title-miss']),
			},
			{
				policy: 'I described a change but could not apply it: 1 was blocked by the document\'s policy.',
				heading: 'I described a change but could not apply it: 1 targeted a heading.',
				noMatch: 'I described a change but could not apply it: 1 quoted text that is not in the document.',
				bindGuard: 'I described a change but could not apply it: 1 targeted a live figure.',
				noOp: 'I described a change but could not apply it: 1 would have changed nothing.',
				empty: 'I described a change but could not apply it: 1 arrived with no text to apply.',
				titleMiss: 'I described a change but could not apply it: 1 named a document that was not in this run.',
				plurals: 'I described 4 changes but could not apply any of them: 2 targeted live figures, 2 named documents that were not in this run.',
			},
		);
	});

	test('a partial keeps the reply and appends the named shortfall (never a silent difference)', () => {
		const outcome = reconcileTurnReceipt({
			claimed: 3,
			queued: 1,
			drops: ['heading', 'policy'],
			reply: 'Sharpened the sections.',
		});
		assert.deepStrictEqual(
			outcome,
			{
				content: 'Sharpened the sections.\n\n2 changes could not be applied: 1 targeted a heading, 1 was blocked by the document\'s policy.',
				isError: false,
			},
			'proposals landed, so the turn is not a failure - but the shortfall is still spoken',
		);
	});

	test('a shortfall with no reply stands on its own, and a shortfall of one reads singular', () => {
		assert.deepStrictEqual(
			{
				noReply: reconcileTurnReceipt({ claimed: 2, queued: 1, drops: ['no-op'], reply: '' }).content,
				one: reconcileTurnReceipt({ claimed: 2, queued: 1, drops: ['heading'], reply: 'Done.' }).content,
			},
			{
				noReply: '1 change could not be applied: 1 would have changed nothing.',
				one: 'Done.\n\n1 change could not be applied: 1 targeted a heading.',
			},
		);
	});

	test('a shortfall with no recorded reasons still says the count, never inventing a reason it was not told', () => {
		assert.deepStrictEqual(
			{
				noneApplied: reconcileTurnReceipt({ claimed: 2, queued: 0, drops: [], reply: 'All done!' }),
				partial: reconcileTurnReceipt({ claimed: 3, queued: 2, drops: [], reply: 'Two landed.' }),
			},
			{
				noneApplied: { content: 'I described 2 changes but could not apply any of them to this document.', isError: true },
				partial: { content: 'Two landed.\n\n1 change could not be applied.', isError: false },
			},
		);
	});

	test('nothing to reconcile: a prose-only answer and a fully-landed turn pass through untouched', () => {
		assert.deepStrictEqual(
			{
				proseOnly: reconcileTurnReceipt({ claimed: 0, queued: 0, drops: [], reply: 'MRR is $48.6k this week.' }),
				allLanded: reconcileTurnReceipt({ claimed: 2, queued: 2, drops: [], reply: 'Sharpened both lines.' }),
			},
			{
				proseOnly: { content: 'MRR is $48.6k this week.', isError: false },
				allLanded: { content: 'Sharpened both lines.', isError: false },
			},
			'the reconciliation is invisible on the golden path',
		);
	});
});
