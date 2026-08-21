/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildBulkSet, bulkVerbLabel, chordTargetChange, describeBulkSkips, groupDecisions, groupPendingByDoc, IProposedChange, ISkillRunDocResult, nextPendingDocId, reviewConfidence, reviewedDocsFromSeen, reviewFraming, summariseProjectRun, summariseSkillRun } from '../../common/livingDocsModel.js';

function change(docId: string, id: string): IProposedChange {
	return {
		id, docId, docTitle: docId, blockId: '', blockLabel: '', oldText: '', newText: '',
		kind: 'meaning', confidence: 0.8, rationale: '', sourceCells: [],
	};
}

function grounded(docId: string, id: string, rationale: string, sourceQuote?: string, sourceLine?: number): IProposedChange {
	return { ...change(docId, id), rationale, sourceQuote, sourceLine };
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
			skippedDocs: 0,
			oversizeDocs: 0,
			failedDocs: 0,
			policyDocs: 0,
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
			skippedDocs: 0,
			oversizeDocs: 0,
			failedDocs: 0,
			policyDocs: 0,
		});
	});

	test('a stopped run marks not-yet-changed documents skipped, keeping changed ones (plan 27 iter 4)', () => {
		// The whole-project fan-out is a single model call, so a mid-flight Stop means every document that
		// did not already land a change is honestly skipped (it never ran), while a changed doc keeps its work.
		const pending = [change('a', '1')];
		assert.deepStrictEqual(summariseProjectRun(docs, pending, true), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'changed', changeCount: 1 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'skipped', changeCount: 0 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'skipped', changeCount: 0 },
			],
			totalChanges: 1,
			changedDocs: 1,
			unchangedDocs: 0,
			skippedDocs: 2,
			oversizeDocs: 0,
			failedDocs: 0,
			policyDocs: 0,
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
			skippedDocs: 0,
			oversizeDocs: 0,
			failedDocs: 0,
			policyDocs: 0,
		});
	});

	test('an oversize document is flagged and reported as its own bucket, priority over changed/no-change (plan 30, track 3)', () => {
		// doc `b` is too large for the fan-out budget: it was never sent, so its tile is `oversize` even though
		// it also has no pending change. It must not read `no change` (which would claim it ran and found none).
		const pending = [change('a', '1')];
		assert.deepStrictEqual(summariseProjectRun(docs, pending, false, ['b']), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'changed', changeCount: 1 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'oversize', changeCount: 0 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'no-change', changeCount: 0 },
			],
			totalChanges: 1,
			changedDocs: 1,
			unchangedDocs: 1,
			skippedDocs: 0,
			oversizeDocs: 1,
			failedDocs: 0,
			policyDocs: 0,
		});
	});

	test('a document the model could not be reached for is flagged failed, never no-change (F14, issue #123)', () => {
		// doc `b` failed (model unreachable) with no pending change: its tile must read `failed`, not the silent
		// `no-change` all-clear that would falsely claim it ran and found nothing. It is its own honest bucket.
		const pending = [change('a', '1')];
		assert.deepStrictEqual(summariseProjectRun(docs, pending, false, [], ['b']), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'changed', changeCount: 1 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'failed', changeCount: 0 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'no-change', changeCount: 0 },
			],
			totalChanges: 1,
			changedDocs: 1,
			unchangedDocs: 1,
			skippedDocs: 0,
			oversizeDocs: 0,
			failedDocs: 1,
			policyDocs: 0,
		});
	});

	test('every document failed reads as all-failed, zero unchanged - never a silent all-clear (F14)', () => {
		assert.deepStrictEqual(summariseProjectRun(docs, [], false, [], ['a', 'b', 'c']), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'failed', changeCount: 0 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'failed', changeCount: 0 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'failed', changeCount: 0 },
			],
			totalChanges: 0,
			changedDocs: 0,
			unchangedDocs: 0,
			skippedDocs: 0,
			oversizeDocs: 0,
			failedDocs: 3,
			policyDocs: 0,
		});
	});

	test('oversize takes priority over failed for a document flagged as both', () => {
		// A document too large to send never reached the model, so "too large" is the more precise reason it
		// produced nothing; it must not double-count as both oversize and failed.
		const summary = summariseProjectRun(docs, [], false, ['b'], ['b']);
		assert.strictEqual(summary.tiles[1].status, 'oversize', 'oversize wins over failed');
		assert.strictEqual(summary.oversizeDocs, 1);
		assert.strictEqual(summary.failedDocs, 0);
		assert.strictEqual(summary.unchangedDocs, 2);
	});

	test('a "Never change this doc" document is flagged policy, its own bucket, never no-change (issue #257)', () => {
		// doc `b` is dialled never: the run left it alone by the human's own choice, so its tile must read `policy`
		// (left alone), NOT the silent `no-change` all-clear that would hide the dial being honoured.
		const pending = [change('a', '1')];
		assert.deepStrictEqual(summariseProjectRun(docs, pending, false, [], [], ['b']), {
			tiles: [
				{ docId: 'a', docTitle: 'Access Control', status: 'changed', changeCount: 1 },
				{ docId: 'b', docTitle: 'Acceptable Use', status: 'policy', changeCount: 0 },
				{ docId: 'c', docTitle: 'Cryptography', status: 'no-change', changeCount: 0 },
			],
			totalChanges: 1,
			changedDocs: 1,
			unchangedDocs: 1,
			skippedDocs: 0,
			oversizeDocs: 0,
			failedDocs: 0,
			policyDocs: 1,
		});
	});

	test('policy takes priority over failed for a never-doc even when the model was down (issue #257)', () => {
		// A never-doc was never sent regardless of the model state, so "left alone by policy" is the true reason -
		// it must not be mislabelled `failed` (a model outage it never met).
		const summary = summariseProjectRun(docs, [], false, [], ['b'], ['b']);
		assert.strictEqual(summary.tiles[1].status, 'policy', 'policy wins over failed');
		assert.strictEqual(summary.policyDocs, 1);
		assert.strictEqual(summary.failedDocs, 0);
	});
});

suite('LivingDoc model - groupDecisions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups grounded changes by their source line, counting distinct documents affected', () => {
		// Two documents changed by the same MFA decision (line 2) + one by a separate TLS decision (line 19).
		const pending = [
			grounded('a', '1', 'MFA required', 'multi-factor authentication is now REQUIRED', 2),
			grounded('b', '2', 'MFA required', 'multi-factor authentication is now REQUIRED', 2),
			grounded('c', '3', 'TLS 1.2+', 'data in transit must use TLS 1.2 or higher', 19),
		];
		assert.deepStrictEqual(groupDecisions(pending), [
			{ quote: 'multi-factor authentication is now REQUIRED', sourceLine: 2, docsAffected: 2, changeCount: 2, grounded: true },
			{ quote: 'data in transit must use TLS 1.2 or higher', sourceLine: 19, docsAffected: 1, changeCount: 1, grounded: true },
		]);
	});

	test('groups by quote when the model gave a quote but no line (no fabricated line)', () => {
		const pending = [
			grounded('a', '1', 'BYOD', 'personal devices may access email and calendar only'),
			grounded('b', '2', 'BYOD', 'personal devices may access email and calendar only'),
		];
		assert.deepStrictEqual(groupDecisions(pending), [
			{ quote: 'personal devices may access email and calendar only', docsAffected: 2, changeCount: 2, grounded: true },
		]);
	});

	test('degrades honestly to rationale grouping when no change carries a source grounding', () => {
		const pending = [
			grounded('a', '1', 'Tidy the intro'),
			grounded('b', '2', 'Tidy the intro'),
			grounded('c', '3', 'Fix the heading'),
		];
		assert.deepStrictEqual(groupDecisions(pending), [
			{ quote: 'Tidy the intro', docsAffected: 2, changeCount: 2, grounded: false },
			{ quote: 'Fix the heading', docsAffected: 1, changeCount: 1, grounded: false },
		]);
	});

	test('counts a document once per decision even when it has several changes from that decision', () => {
		const pending = [
			grounded('a', '1', 'MFA', 'MFA is required', 2),
			grounded('a', '2', 'MFA', 'MFA is required', 2),
		];
		assert.deepStrictEqual(groupDecisions(pending), [
			{ quote: 'MFA is required', sourceLine: 2, docsAffected: 1, changeCount: 2, grounded: true },
		]);
	});

	test('returns an empty list when there are no pending changes', () => {
		assert.deepStrictEqual(groupDecisions([]), []);
	});
});

suite('LivingDoc model - reviewConfidence (D24-A)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function withKind(kind: 'figure' | 'meaning', confidence: number): IProposedChange {
		return { ...change('a', '1'), kind, confidence };
	}

	test('a meaning change below 0.8 is Inferred; every other change is High', () => {
		assert.deepStrictEqual(
			[
				reviewConfidence(withKind('meaning', 0.79)),
				reviewConfidence(withKind('meaning', 0.8)),
				reviewConfidence(withKind('meaning', 0.95)),
				reviewConfidence(withKind('meaning', 0.5)),
				reviewConfidence(withKind('figure', 0.4)),
				reviewConfidence(withKind('figure', 0.99)),
			],
			['inferred', 'high', 'high', 'inferred', 'high', 'high'],
		);
	});
});

suite('LivingDoc model - groupPendingByDoc', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups changes by document in first-appearance order, keeping every change', () => {
		const pending = [change('a', '1'), change('b', '2'), change('a', '3'), change('c', '4')];
		assert.deepStrictEqual(
			groupPendingByDoc(pending).map(g => ({ docId: g.docId, docTitle: g.docTitle, ids: g.changes.map(c => c.id) })),
			[
				{ docId: 'a', docTitle: 'a', ids: ['1', '3'] },
				{ docId: 'b', docTitle: 'b', ids: ['2'] },
				{ docId: 'c', docTitle: 'c', ids: ['4'] },
			],
		);
	});

	test('returns an empty list when there are no pending changes', () => {
		assert.deepStrictEqual(groupPendingByDoc([]), []);
	});
});

suite('LivingDoc model - reviewedDocsFromSeen', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a seen doc with no remaining pending is reviewed with its human title, in seen order', () => {
		const seen = new Map<string, string>([['a-uri', 'Access Control'], ['b-uri', 'Backup Policy'], ['c-uri', 'Cryptography']]);
		const pendingDocIds = new Set<string>(['b-uri']);
		assert.deepStrictEqual(
			reviewedDocsFromSeen(seen, pendingDocIds),
			[{ docId: 'a-uri', title: 'Access Control' }, { docId: 'c-uri', title: 'Cryptography' }],
		);
	});

	test('nothing is reviewed while every seen doc still has pending changes', () => {
		const seen = new Map<string, string>([['a-uri', 'Access Control']]);
		assert.deepStrictEqual(reviewedDocsFromSeen(seen, new Set(['a-uri'])), []);
	});
});

suite('LivingDoc model - reviewFraming (plan 31 iter 2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a low-confidence meaning change frames as an attention kind tag + Inferred chip', () => {
		const f = reviewFraming({ kind: 'meaning', confidence: 0.6, rationale: 'Because the CSV moved.', sourceLine: 12 }, 'metrics.csv');
		assert.strictEqual(f.kindLabel, 'MEANING CHANGE · needs your call');
		assert.strictEqual(f.kindAttention, true);
		assert.strictEqual(f.confidence, 'inferred');
		assert.strictEqual(f.confidenceLabel, '◐ Inferred');
		assert.strictEqual(f.rationale, 'Because the CSV moved.');
		assert.strictEqual(f.sourceLabel, 'metrics.csv · line 12');
	});

	test('a confident meaning change frames as High', () => {
		const f = reviewFraming({ kind: 'meaning', confidence: 0.9, rationale: '', sourceLine: undefined }, '');
		assert.strictEqual(f.confidence, 'high');
		assert.strictEqual(f.confidenceLabel, '● High');
	});

	test('a figure change frames as an ok FIGURE tag and is always High', () => {
		const f = reviewFraming({ kind: 'figure', confidence: 0.4, rationale: '', sourceLine: undefined }, 'metrics.csv');
		assert.strictEqual(f.kindLabel, 'FIGURE');
		assert.strictEqual(f.kindAttention, false);
		assert.strictEqual(f.confidence, 'high');
		assert.strictEqual(f.sourceLabel, 'metrics.csv');
	});

	test('omits the source label when no source is given and never fabricates a line', () => {
		const f = reviewFraming({ kind: 'meaning', confidence: 0.9, rationale: '', sourceLine: undefined }, '');
		assert.strictEqual(f.sourceLabel, '');
		assert.strictEqual(f.rationale, '');
	});
});

// The ONE bulk path (docs/30 section 5, invariant I4; issues #334 / #305). `buildBulkSet` is where scope,
// eligibility, the confirm policy and the sentence all live, so it is where they are all tested.
suite('LivingDoc model - buildBulkSet (the one bulk path, docs/30 I4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function figure(docId: string, id: string): IProposedChange {
		return { ...change(docId, id), kind: 'figure' };
	}

	test('a document-scoped capture takes that document only, and counts in decisions', () => {
		const pending = [change('a', '1'), change('b', '2'), change('a', '3')];
		const set = buildBulkSet({ verb: 'approve', docId: 'a' }, pending);
		assert.deepStrictEqual(
			{ ids: set.ids, docCount: set.docCount, confirmNeeded: set.confirmNeeded, sentence: set.sentence },
			{
				ids: ['1', '3'], docCount: 1, confirmNeeded: true,
				sentence: 'Approve 2 changes? A version snapshot is taken first, so you can restore.',
			},
		);
	});

	test('an everywhere capture spans documents and the sentence names how many', () => {
		const set = buildBulkSet({ verb: 'approve' }, [change('a', '1'), change('b', '2'), change('b', '3')]);
		assert.deepStrictEqual(
			{ ids: set.ids, docCount: set.docCount, sentence: set.sentence },
			{
				ids: ['1', '2', '3'], docCount: 2,
				sentence: 'Approve 3 changes across 2 documents? A version snapshot is taken first, so you can restore.',
			},
		);
	});

	// Eligibility lives INSIDE the capture (docs/30 section 4.5), and what it excludes it NAMES. A change
	// whose approve failed to apply is needs-attention, not pending: sweeping it into a bulk approve is how
	// a reviewer comes to believe a stuck edit landed.
	test('an unapplied change is excluded from the set and named in the sentence, never silently dropped', () => {
		const stuck: IProposedChange = { ...change('a', '2'), applyFailure: 'anchor-miss' };
		const set = buildBulkSet({ verb: 'approve', docId: 'a' }, [change('a', '1'), stuck, change('a', '3')]);
		assert.deepStrictEqual(
			{ ids: set.ids, excluded: set.excluded, sentence: set.sentence },
			{
				ids: ['1', '3'],
				excluded: [{ reason: 'needs-attention', count: 1 }],
				sentence: 'Approve 2 changes? 1 change needing attention is not included. A version snapshot is taken first, so you can restore.',
			},
		);
	});

	// The confirm policy, at every level, in one table. The only one-click case left is a small,
	// single-document, figures-only approve.
	test('confirm policy: reject always, everywhere always, multi-doc always, over ten always, meaning always', () => {
		const oneDocFigures = [figure('a', '1'), figure('a', '2')];
		const eleven = Array.from({ length: 11 }, (_, i) => figure('a', `f${i}`));
		assert.deepStrictEqual(
			{
				rejectOneDocFigures: buildBulkSet({ verb: 'reject', docId: 'a' }, oneDocFigures).confirmNeeded,
				rejectEverywhere: buildBulkSet({ verb: 'reject' }, oneDocFigures).confirmNeeded,
				approveEverywhere: buildBulkSet({ verb: 'approve' }, oneDocFigures).confirmNeeded,
				approveMultiDocFigures: buildBulkSet({ verb: 'approve' }, [figure('a', '1'), figure('b', '2')]).confirmNeeded,
				approveElevenFigures: buildBulkSet({ verb: 'approve', docId: 'a' }, eleven).confirmNeeded,
				approveMeaning: buildBulkSet({ verb: 'approve', docId: 'a' }, [change('a', '1')]).confirmNeeded,
				approveOneDocFigures: buildBulkSet({ verb: 'approve', docId: 'a' }, oneDocFigures).confirmNeeded,
				approveEmpty: buildBulkSet({ verb: 'approve', docId: 'a' }, []).confirmNeeded,
			},
			{
				rejectOneDocFigures: true,
				rejectEverywhere: true,
				approveEverywhere: true,
				approveMultiDocFigures: true,
				approveElevenFigures: true,
				approveMeaning: true,
				approveOneDocFigures: false,
				approveEmpty: false,
			},
		);
	});

	test('a reject sentence promises what a reject does: nothing is written to the documents', () => {
		const set = buildBulkSet({ verb: 'reject', docId: 'a' }, [change('a', '1')]);
		assert.deepStrictEqual(
			{ sentence: set.sentence, primaryButton: set.primaryButton },
			{ sentence: 'Reject 1 change? The documents are left unchanged.', primaryButton: 'Reject All' },
		);
	});

	// The ellipsis audit: a trailing ellipsis is a promise that a dialog follows, so it appears if and only
	// if this exact set would raise one.
	test('ellipsis audit: a label carries an ellipsis exactly when its set confirms', () => {
		const figures = [figure('a', '1'), figure('a', '2')];
		assert.deepStrictEqual(
			{
				approveOneClick: bulkVerbLabel(buildBulkSet({ verb: 'approve', docId: 'a' }, figures)),
				approveConfirming: bulkVerbLabel(buildBulkSet({ verb: 'approve', docId: 'a' }, [change('a', '1')])),
				rejectConfirming: bulkVerbLabel(buildBulkSet({ verb: 'reject', docId: 'a' }, figures)),
				emptyNeverPromises: bulkVerbLabel(buildBulkSet({ verb: 'reject', docId: 'a' }, [])),
			},
			{
				approveOneClick: 'Approve all 2',
				approveConfirming: 'Approve all 1\u2026',
				rejectConfirming: 'Reject all\u2026',
				emptyNeverPromises: 'Reject all',
			},
		);
	});

	test('a bulk apply that did exactly what it said reports nothing; one that shrank names what it left', () => {
		assert.deepStrictEqual(
			{
				clean: describeBulkSkips({ verb: 'approve', captured: 2, applied: ['1', '2'], skipped: [] }),
				shrank: describeBulkSkips({
					verb: 'approve', captured: 3, applied: ['1'], skipped: [
						{ id: '2', label: 'Weekly Update - Commentary', reason: 'apply-failed' },
						{ id: '3', label: '', reason: 'decided-elsewhere' },
					],
				}),
			},
			{
				clean: '',
				shrank: '2 of 3 changes were not applied. Still waiting on you: Weekly Update - Commentary.',
			},
		);
	});
});

// Plan 52 A2: the approval chords have no pointer, so the change they act on must be predictable before the
// key is pressed - the first one still pending, in the order every surface already draws them.
suite('LivingDoc model - chordTargetChange (plan 52 A2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('takes the first pending change, and nothing at all from an empty set', () => {
		const pending = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
		assert.deepStrictEqual(
			[chordTargetChange(pending), chordTargetChange(pending.slice(1)), chordTargetChange([])],
			[{ id: 'c1' }, { id: 'c2' }, undefined]
		);
	});
});

suite('LivingDoc model - summariseSkillRun (plan 32 iter 3)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function res(docId: string, status: ISkillRunDocResult['status'], detail = ''): ISkillRunDocResult {
		return { docId, docTitle: docId, status, detail };
	}

	test('tallies flagged, passed and skipped from the real per-doc results', () => {
		const results = [res('a', 'flag', '2 headings'), res('b', 'pass'), res('c', 'skipped', 'not living'), res('d', 'flag')];
		const summary = summariseSkillRun('formatting', 'Formatting agent', results);
		assert.strictEqual(summary.skillId, 'formatting');
		assert.strictEqual(summary.skillName, 'Formatting agent');
		assert.strictEqual(summary.flagged, 2, 'two documents flagged');
		assert.strictEqual(summary.passed, 1, 'one passed');
		assert.strictEqual(summary.skipped, 1, 'one skipped');
		assert.strictEqual(summary.results.length, 4, 'the per-doc results are carried verbatim');
	});

	test('an empty project run has zero tallies (truthful empty state)', () => {
		const summary = summariseSkillRun('financial', 'Financial agent', []);
		assert.deepStrictEqual({ flagged: summary.flagged, passed: summary.passed, skipped: summary.skipped }, { flagged: 0, passed: 0, skipped: 0 });
	});
});
