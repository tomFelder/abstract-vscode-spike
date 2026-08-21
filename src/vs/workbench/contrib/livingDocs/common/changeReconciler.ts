/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AnchorOutcome, ChangeStatus, IChange } from './changeRecord.js';
import { IChangeResolution, IIntentRecord, JournalRecord } from './changeJournal.js';

// The startup reconciler (docs/30 section 5). It answers one question about every intent the journal opened
// but never closed: WHAT ACTUALLY HAPPENED TO THE DOCUMENT?
//
// The answer is a proof rather than a guess, and it is a proof only because the intent declared its expected
// post-hash BEFORE the write. Three hashes, three different facts:
//
//   disk === expectedPostHash  ->  the write landed; the crash happened between the write and the record.
//                                  The change is `applied (recovered)`: real, done, and now recorded.
//   disk === baseHash          ->  the write never happened; the document is exactly as the user left it.
//                                  The change goes back to being an offer, and retry is the USER's to take.
//   disk === neither           ->  something else touched the document inside the crash window. Nothing can
//                                  be proven, so nothing is assumed: `unverified`, and no auto-action.
//
// The third branch is the one that matters most, and it is the reason a "just retry on startup" recovery is
// wrong. Retrying a write against a document that has moved on is how you get a duplicated paragraph, or a
// paragraph applied to the wrong place, with an approval record swearing it went fine. The reconciler never
// writes. It classifies, records the classification, and leaves the recovery to a person who can see the
// document.
//
// Pure: it takes journal records and observed hashes and returns verdicts. No file system, no service.

/** What the reconciler observed on disk for one document, or `undefined` when it could not be read. */
export type ObservedHashes = ReadonlyMap<string, string | undefined>;

/**
 * The intents the journal opened and never closed: no J3 resolution, and no reconciler verdict from an
 * earlier startup. These are the crash windows, and they are the only thing reconciliation looks at - a
 * closed intent is settled history and reopening it would be exactly the resurrection invariant I5 forbids.
 */
export function openIntents(records: readonly JournalRecord[]): readonly IIntentRecord[] {
	const closed = new Set<string>();
	for (const record of records) {
		if (record.kind === 'resolution') {
			closed.add(record.intentId);
		} else if (record.kind === 'reconcile') {
			for (const intentId of record.intentIds) { closed.add(intentId); }
		}
	}
	return records.filter((r): r is IIntentRecord => r.kind === 'intent' && !closed.has(r.intentId));
}

/** The per-document commit hashes already journalled (J2) for one intent. */
export function committedDocs(records: readonly JournalRecord[], intentId: string): ReadonlyMap<string, string> {
	const committed = new Map<string, string>();
	for (const record of records) {
		if (record.kind === 'doc-commit' && record.intentId === intentId) {
			committed.set(record.docUri, record.postHash);
		}
	}
	return committed;
}

/** The document-level verdict the three-way classification produces, before it is folded per change. */
type DocVerdict =
	| { readonly landed: true; readonly postHash: string }
	| { readonly landed: false; readonly reason: 'not-attempted' | 'unverified' | 'doc-gone' };

/**
 * Classify one document inside a crash window. A J2 commit is believed on its own - the write landed and
 * said so - and any later divergence on disk is just the document having been edited since, which is
 * ordinary life rather than a failure. Everything else goes through the three-way hash comparison.
 */
function classifyDoc(baseHash: string, expectedPostHash: string, committed: string | undefined, observed: string | undefined): DocVerdict {
	if (committed !== undefined) {
		return { landed: true, postHash: committed };
	}
	if (observed === undefined) {
		return { landed: false, reason: 'doc-gone' };
	}
	if (observed === expectedPostHash) {
		return { landed: true, postHash: observed };
	}
	if (observed === baseHash) {
		return { landed: false, reason: 'not-attempted' };
	}
	return { landed: false, reason: 'unverified' };
}

/**
 * Fold a change's per-anchor outcomes into its status, least-assuming verdict first.
 *
 * The ordering is the whole ethic of the module. If ANY anchor is unprovable, the change is `unverified`
 * even when the others plainly landed - claiming a partial success over a document we cannot account for
 * would be a smaller lie than #329's but the same kind. Only when every anchor is accounted for do the
 * cheerful classifications become available.
 */
function foldStatus(outcomes: readonly AnchorOutcome[]): ChangeStatus {
	if (outcomes.some(o => !o.landed && (o.reason === 'unverified' || o.reason === 'doc-gone'))) {
		return 'unverified';
	}
	const landed = outcomes.filter(o => o.landed).length;
	if (landed === outcomes.length) {
		return 'applied-recovered';
	}
	return landed === 0 ? 'interrupted' : 'partially-applied';
}

/**
 * Reconcile one crash window into a verdict per change (docs/30 section 5).
 *
 * A `reject` intent is settled without looking at any document: rejecting never mutates anything, so a
 * crash between the intent and its resolution left the user's writing untouched and the decision they
 * already made stands. Only `approve` intents have a document state to prove.
 *
 * Multi-anchor changes carry a per-anchor outcome, which is what makes `partially-applied` a real,
 * explainable state ("the moved text was added to B but could not be removed from A - it currently appears
 * in both places") rather than a shrug about drift.
 */
export function reconcileIntent(
	intent: IIntentRecord,
	committed: ReadonlyMap<string, string>,
	observed: ObservedHashes,
	changes: ReadonlyMap<string, IChange>,
): readonly IChangeResolution[] {
	const verdicts = new Map<string, DocVerdict>();
	for (const doc of intent.docs) {
		verdicts.set(doc.docUri, classifyDoc(doc.baseHash, doc.expectedPostHash, committed.get(doc.docUri), observed.get(doc.docUri)));
	}
	const resolutions: IChangeResolution[] = [];
	for (const changeId of intent.changeIds) {
		const change = changes.get(changeId);
		if (!change) {
			continue;
		}
		if (intent.verb === 'reject') {
			resolutions.push({
				changeId,
				status: 'rejected',
				anchorOutcomes: change.anchors.map(a => ({ docUri: a.docUri, landed: false, reason: 'not-attempted' as const })),
			});
			continue;
		}
		const anchorOutcomes: AnchorOutcome[] = change.anchors.map(anchor => {
			const verdict = verdicts.get(anchor.docUri) ?? { landed: false as const, reason: 'unverified' as const };
			return verdict.landed
				? { docUri: anchor.docUri, landed: true, postHash: verdict.postHash }
				: { docUri: anchor.docUri, landed: false, reason: verdict.reason };
		});
		resolutions.push({ changeId, status: foldStatus(anchorOutcomes), anchorOutcomes });
	}
	return resolutions;
}
