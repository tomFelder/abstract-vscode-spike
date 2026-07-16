/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FANOUT_NO_CHANGES, IFanoutFailedDoc, summarizeFanoutRun } from '../../common/fanoutOutcome.js';

// F14 (issue #123): a model outage on the fan-out path must never render as a silent "no changes proposed".
// The pure summariser aggregates a run's tallies into an honest outcome: a named error listing the failed
// documents on outage, the cap message on pause, and the clean reply / neutral no-change line ONLY when there
// were no failures and no pause. Unit-tested here so the honesty contract the run surfaces rely on is proven
// deterministically, with no model and no DOM.

suite('livingDocs fanoutOutcome (F14, issue #123)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const doc = (id: string, title: string): IFanoutFailedDoc => ({ id, title });

	test('every document down: a NAMED unreachable error listing all failed docs, never an all-clear', () => {
		const failedDocs = [doc('a', 'Access Control'), doc('b', 'Acceptable Use'), doc('c', 'Cryptography')];
		const outcome = summarizeFanoutRun({ proposedCount: 0, failedDocs });
		assert.strictEqual(outcome.isError, true, 'the run is an honest error');
		assert.strictEqual(outcome.isPaused, false);
		assert.deepStrictEqual(outcome.failedDocs, failedDocs, 'all failed docs are carried for Retry failed');
		// Names the model as unavailable (matching the single-doc rail's tone) and lists every failed document.
		assert.ok(/The model was not available/.test(outcome.content), 'names the model as unavailable');
		assert.ok(/Access Control, Acceptable Use, Cryptography/.test(outcome.content), 'lists every failed document');
		assert.ok(/Open Model access to connect a model/.test(outcome.content), 'points at the Model access screen, never a shell script');
		assert.ok(!/lwd-anthropic-proxy|local proxy|\.sh/.test(outcome.content), 'never references a shell script');
		assert.ok(/Retry failed/.test(outcome.content), 'offers the surgical retry affordance');
		// Crucially never an all-clear.
		assert.ok(!/no changes|nothing to change|did not find anything/i.test(outcome.content), 'never reads as an all-clear');
		assert.notStrictEqual(outcome.content, FANOUT_NO_CHANGES);
	});

	test('partial success: leads with the proposals that landed, then names the failures + Retry failed', () => {
		const failedDocs = [doc('b', 'Acceptable Use')];
		const outcome = summarizeFanoutRun({ proposedCount: 2, failedDocs });
		assert.strictEqual(outcome.isError, true);
		assert.deepStrictEqual(outcome.failedDocs, failedDocs, 'only the failed doc is offered for retry (surgical)');
		assert.ok(/2 changes proposed/.test(outcome.content), 'reports the proposals that landed');
		assert.ok(/The model was not available for 1 document: Acceptable Use/.test(outcome.content), 'names the single failure');
		assert.ok(/Retry failed to re-run just those/.test(outcome.content), 'the retry re-runs just the failed docs');
		assert.ok(!/no changes|nothing to change/i.test(outcome.content), 'never an all-clear on a partial success');
	});

	test('singular vs plural document wording', () => {
		const one = summarizeFanoutRun({ proposedCount: 0, failedDocs: [doc('a', 'One')] });
		assert.ok(/for 1 document: One/.test(one.content), 'singular "document"');
		const two = summarizeFanoutRun({ proposedCount: 0, failedDocs: [doc('a', 'One'), doc('b', 'Two')] });
		assert.ok(/for 2 documents: One, Two/.test(two.content), 'plural "documents"');
		const oneChange = summarizeFanoutRun({ proposedCount: 1, failedDocs: [doc('a', 'One')] });
		assert.ok(/^1 change proposed\./.test(oneChange.content), 'singular "1 change"');
	});

	test('budget-cap pause: the cap message, a pause (not an error, not an all-clear), finished proposals kept', () => {
		const outcome = summarizeFanoutRun({ proposedCount: 3, failedDocs: [], pausedMessage: 'You\'ve used today\'s included usage.' });
		assert.strictEqual(outcome.isPaused, true, 'the run paused');
		assert.strictEqual(outcome.isError, false, 'a pause is NOT a failure');
		assert.deepStrictEqual(outcome.failedDocs, [], 'a pause lists no failed docs');
		assert.strictEqual(outcome.content, 'You\'ve used today\'s included usage.', 'shows the plain-words cap message');
	});

	test('a pause takes priority over failures so the calm cap message wins (never a mixed error)', () => {
		const outcome = summarizeFanoutRun({ proposedCount: 1, failedDocs: [doc('a', 'One')], pausedMessage: 'capped' });
		assert.strictEqual(outcome.isPaused, true);
		assert.strictEqual(outcome.isError, false);
		assert.strictEqual(outcome.content, 'capped');
	});

	test('clean run keeps the model reply when it gave one', () => {
		const outcome = summarizeFanoutRun({ proposedCount: 2, failedDocs: [], reply: 'Tightened the intros.' });
		assert.strictEqual(outcome.isError, false);
		assert.strictEqual(outcome.isPaused, false);
		assert.strictEqual(outcome.content, 'Tightened the intros.');
	});

	test('clean run with proposals but no reply carries empty content (the cards speak)', () => {
		const outcome = summarizeFanoutRun({ proposedCount: 2, failedDocs: [] });
		assert.strictEqual(outcome.content, '', 'proposals carry the meaning, so no prose is forced');
	});

	test('clean run that genuinely proposed nothing reads the neutral no-change line (the ONLY all-clear path)', () => {
		const outcome = summarizeFanoutRun({ proposedCount: 0, failedDocs: [] });
		assert.strictEqual(outcome.isError, false);
		assert.strictEqual(outcome.content, FANOUT_NO_CHANGES, 'the all-clear is reachable only with no failures and no pause');
	});
});
