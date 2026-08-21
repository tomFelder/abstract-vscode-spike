/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { committedDocs, openIntents, reconcileIntent } from '../../common/changeReconciler.js';
import { AnchorOutcome, ChangeStatus, IChange } from '../../common/changeRecord.js';
import { IIntentRecord, JournalRecord } from '../../common/changeJournal.js';

// The startup reconciler's three-way classification (docs/30 section 5). The whole point of declaring the
// expected post-hash BEFORE the write is that these three branches become facts rather than guesses, so
// each one is pinned here against the same intent with only the observed disk hash varying.

const A = 'file:///ws/a.md';
const B = 'file:///ws/b.md';

const CHANGE: IChange = {
	id: 'c1',
	setId: 's1',
	anchors: [{ docUri: A, baseRevision: 'base-a', span: { start: 0, end: 3 }, oldText: 'old', newText: 'new' }],
	status: 'pending',
	changeClass: 'targeted',
	kind: 'figure',
	versions: [],
	thread: [],
	proposedAt: 1,
};

const MOVE: IChange = {
	...CHANGE,
	id: 'c2',
	anchors: [
		{ docUri: B, baseRevision: 'base-b', span: { start: 0, end: 0 }, oldText: '', newText: 'the moved paragraph' },
		{ docUri: A, baseRevision: 'base-a', span: { start: 0, end: 3 }, oldText: 'old', newText: '' },
	],
};

function intent(changeIds: readonly string[], docs: readonly { docUri: string; baseHash: string; expectedPostHash: string }[]): IIntentRecord {
	return {
		kind: 'intent',
		seq: 1,
		at: 1,
		intentId: 'i1',
		changeIds,
		verb: 'approve',
		actor: 'user',
		docs: docs.map(d => ({ ...d, snapshotId: 'snapshot-1' })),
	};
}

const SINGLE = intent(['c1'], [{ docUri: A, baseHash: 'base-a', expectedPostHash: 'post-a' }]);
const CHANGES = new Map<string, IChange>([['c1', CHANGE], ['c2', MOVE]]);

function classify(observedA: string | undefined): { status: ChangeStatus; outcomes: readonly AnchorOutcome[] } {
	const [resolution] = reconcileIntent(SINGLE, new Map(), new Map([[A, observedA]]), CHANGES);
	return { status: resolution.status, outcomes: resolution.anchorOutcomes };
}

suite('livingDocs changeReconciler (docs/30 section 5, the crash window)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the three-way classification: equals the declared expectation, equals the base, equals neither', () => {
		// Branch 1 is the win the declared post-hash buys: the write DID land, the crash merely happened before
		// the record of it, and the change can be closed honestly instead of being offered again.
		// Branch 2 is the clean interruption: the document is exactly as the user left it, so retry is theirs.
		// Branch 3 is the one that must never be automated: something else touched the document inside the
		// window, so what happened is unknowable and nothing is assumed.
		assert.deepStrictEqual(
			{
				equalsExpected: classify('post-a'),
				equalsBase: classify('base-a'),
				equalsNeither: classify('someone-else-edited-it'),
				unreadable: classify(undefined),
			},
			{
				equalsExpected: { status: 'applied-recovered', outcomes: [{ docUri: A, landed: true, postHash: 'post-a' }] },
				equalsBase: { status: 'interrupted', outcomes: [{ docUri: A, landed: false, reason: 'not-attempted' }] },
				equalsNeither: { status: 'unverified', outcomes: [{ docUri: A, landed: false, reason: 'unverified' }] },
				unreadable: { status: 'unverified', outcomes: [{ docUri: A, landed: false, reason: 'doc-gone' }] },
			},
		);
	});

	test('a journalled doc commit settles its document without a disk comparison; later edits are just later edits', () => {
		// A J2 commit says the write landed and carries the hash it landed at. A document that has since been
		// edited is ordinary life, not a failure, so the change stays closed rather than reopening every time
		// the user touches the file afterwards.
		const [resolution] = reconcileIntent(SINGLE, new Map([[A, 'post-a']]), new Map([[A, 'edited-since']]), CHANGES);
		assert.deepStrictEqual(resolution, { changeId: 'c1', status: 'applied-recovered', anchorOutcomes: [{ docUri: A, landed: true, postHash: 'post-a' }] });
	});

	test('a multi-anchor move interrupted between its two writes is partially-applied, with a per-anchor account', () => {
		// Not "drift", not a generic failure: the insert side landed and the delete side did not, so the text
		// is in both places and the reviewer can be told exactly that - and offered the delete-side retry.
		const moveIntent = intent(['c2'], [
			{ docUri: B, baseHash: 'base-b', expectedPostHash: 'post-b' },
			{ docUri: A, baseHash: 'base-a', expectedPostHash: 'post-a' },
		]);
		assert.deepStrictEqual(
			reconcileIntent(moveIntent, new Map(), new Map([[B, 'post-b'], [A, 'base-a']]), CHANGES),
			[{
				changeId: 'c2',
				status: 'partially-applied',
				anchorOutcomes: [{ docUri: B, landed: true, postHash: 'post-b' }, { docUri: A, landed: false, reason: 'not-attempted' }],
			}],
		);
	});

	test('one unprovable anchor makes the whole change unverified, however well the others went', () => {
		// Claiming a partial success over a document nobody can account for is a smaller lie than issue #329's,
		// but the same kind of lie. The least-assuming verdict wins.
		const moveIntent = intent(['c2'], [
			{ docUri: B, baseHash: 'base-b', expectedPostHash: 'post-b' },
			{ docUri: A, baseHash: 'base-a', expectedPostHash: 'post-a' },
		]);
		assert.deepStrictEqual(
			reconcileIntent(moveIntent, new Map(), new Map([[B, 'post-b'], [A, 'a-human-typed-here']]), CHANGES).map(r => r.status),
			['unverified'],
		);
	});

	test('an interrupted REJECT is settled without looking at any document, because rejecting never wrote one', () => {
		const rejectIntent: IIntentRecord = { ...SINGLE, verb: 'reject', docs: [] };
		assert.deepStrictEqual(
			reconcileIntent(rejectIntent, new Map(), new Map(), CHANGES),
			[{ changeId: 'c1', status: 'rejected', anchorOutcomes: [{ docUri: A, landed: false, reason: 'not-attempted' }] }],
		);
	});

	test('only intents the log never closed are crash windows; a resolved or already-reconciled one is history', () => {
		const records: JournalRecord[] = [
			SINGLE,
			{ kind: 'doc-commit', seq: 2, at: 2, intentId: 'i1', docUri: A, postHash: 'post-a' },
			{ kind: 'resolution', seq: 3, at: 3, intentId: 'i1', resolutions: [] },
			{ ...SINGLE, seq: 4, intentId: 'i2' },
			{ kind: 'reconcile', seq: 5, at: 5, intentIds: ['i2'], resolutions: [] },
			{ ...SINGLE, seq: 6, intentId: 'i3' },
		];
		assert.deepStrictEqual(
			{ open: openIntents(records).map(i => i.intentId), committedForI1: [...committedDocs(records, 'i1')] },
			{ open: ['i3'], committedForI1: [[A, 'post-a']] },
		);
	});
});
