/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../base/common/hash.js';
import { localize } from '../../../../nls.js';
import { BlockApplyFailure } from './applyOutcome.js';
import { ChangeKind, IBulkCandidate } from './livingDocsModel.js';

// The `Change` record (docs/30 sections 2.1 and 5): the single persisted home for a change's identity,
// state and count (invariant I5). Today the pending queue lives in `_pending`, a plain in-memory map on
// the service (`livingDocsService.ts:462`), which is why a count can be re-derived three different ways
// and why a crash loses every proposal. The record below is what replaces it.
//
// Two properties carry most of the design:
//
//  - `anchors` is an ARRAY. A change that moves text from one document to another is ONE change with ONE
//    decision, not two changes a reviewer can half-approve. Resolution therefore reports a PER-ANCHOR
//    outcome, so "added to B, could not be removed from A" is expressible rather than being flattened
//    into a lie about the whole change.
//  - terminal states are immutable. Once a change is `approved`, `applied-recovered` or `rejected`, no
//    code path may move it again - which is what makes "a decided change never resurrects" a structural
//    fact rather than a rule everyone has to remember.
//
// Pure: no DOM, no service, no file system. The store, the journal and the reconciler all build on it.

/**
 * The status of one change. Only three of these are terminal ({@link isTerminalStatus}); the rest are
 * states the reviewer can still act from, which is deliberate - a change that could not be applied stays
 * the reviewer's call rather than disappearing into a success record (issue #329).
 */
export type ChangeStatus =
	/** Proposed and waiting on the reviewer. The only status a bulk verb may sweep. */
	| 'pending'
	/** Recorded but not eligible: something about the document moved on. See {@link AttentionReason}. */
	| 'needs-attention'
	/** Some anchors landed and some did not - the moved text is in both places, or in neither end state. */
	| 'partially-applied'
	/** The intent was journalled but NO anchor landed; the document still reads exactly as it did. */
	| 'interrupted'
	/** The document matches neither the base nor the declared expectation: nothing can be proven. */
	| 'unverified'
	/** Decided and applied, with a post-state hash proving it. TERMINAL. */
	| 'approved'
	/** Applied, but proven at startup from the declared expected post-hash rather than at write time. TERMINAL. */
	| 'applied-recovered'
	/** Decided against; the document was never touched. TERMINAL. */
	| 'rejected';

/** Why a recorded change is not eligible to be decided as it stands. Named, never silent. */
export type AttentionReason =
	/** The change was computed against a revision the document has since moved past (invariant I8). */
	| 'stale-base'
	/** A human edit landed inside the change's span after it was proposed. */
	| 'human-edit'
	/** The reviewer approved it and the apply did not land (invariant I1). */
	| 'apply-failed'
	/** The change describes text that is not where it says it is - a proposal against a document that never existed. */
	| 'anchor-invalid';

/**
 * Whether the alignment says this change rewrites its document or edits part of it (docs/30 section 2.1).
 * It switches the review unit: a `rewrite` is decided at the document level with per-hunk drill-in.
 */
export type ChangeClass = 'targeted' | 'rewrite';

/** Who performed an action: the person at the keyboard, or the agent acting on their instruction. */
export type ChangeActor = 'user' | 'agent';

/** A half-open character range `[start, end)` in the base revision of a document. */
export interface IChangeSpan {
	readonly start: number;
	readonly end: number;
}

/**
 * One end of a change: the text to replace, where, and what it becomes.
 *
 * `baseRevision` is the hash of the WHOLE document body the span was measured against. It is the thing
 * that makes staleness provable rather than guessed: if the document's current hash differs, the offsets
 * in `span` describe a document that no longer exists, and the store refuses to write through them.
 */
export interface IChangeAnchor {
	readonly docUri: string;
	readonly baseRevision: string;
	readonly span: IChangeSpan;
	/** The exact text sitting at `span` in the base revision. Verified again immediately before any write. */
	readonly oldText: string;
	/** The text that replaces it. Empty for the delete side of a move; `oldText` empty for a pure insert. */
	readonly newText: string;
}

/** Why one anchor did not land. Extends the closed apply-failure vocabulary from invariant I1 (R2). */
export type AnchorFailure =
	| BlockApplyFailure
	/** The write was never attempted - an earlier anchor of the same change failed first. */
	| 'not-attempted'
	/** The document matches neither the base nor the declared expectation; what happened is unknowable. */
	| 'unverified'
	/** The document moved past the base revision this anchor was measured against. */
	| 'stale-base'
	/** The document is no longer readable at all. */
	| 'doc-gone';

/** This anchor's write landed: `postHash` is the hash of the document as it stands after it. */
export interface IAnchorLanded {
	readonly docUri: string;
	readonly landed: true;
	readonly postHash: string;
}

/** This anchor's write did NOT land: nothing was written for it, and `reason` names why. */
export interface IAnchorFailed {
	readonly docUri: string;
	readonly landed: false;
	readonly reason: AnchorFailure;
}

/** The per-anchor outcome of resolving a change. Narrow on `landed` before reaching for `postHash`. */
export type AnchorOutcome = IAnchorLanded | IAnchorFailed;

/**
 * One revision of a change's content. An agent revision answering a comment thread stacks a new version
 * on the SAME id (so the thread and the history survive); it never creates a second card.
 */
export interface IChangeVersion {
	/** 1-based; version 1 is the change as first proposed. */
	readonly revision: number;
	readonly anchors: readonly IChangeAnchor[];
	readonly plannerIntent?: string;
	readonly at: number;
}

/**
 * One entry in a change's comment thread. The thread type exists from day one so that identity, history
 * and discussion survive every revision path; the thread VERBS beyond `comment` (reply, resolve, ask the
 * agent to revise) arrive with the review work that consumes them.
 */
export interface IChangeThreadEntry {
	readonly id: string;
	readonly actor: ChangeActor;
	readonly text: string;
	readonly at: number;
}

/**
 * A persisted change: the unit of decision, and the store's only currency.
 *
 * Identity is decided by provenance, not geometry (docs/30 section 2.1). A human edit underneath never
 * re-diffs a proposal into a new change - it flips this one to `needs-attention` on the same id. An agent
 * revision stacks a {@link IChangeVersion}. A later turn over the same region sets `supersededBy` rather
 * than versioning, so the superseded change keeps its own audit trail instead of being overwritten.
 */
export interface IChange {
	readonly id: string;
	/** The proposal batch this change arrived in; the unit a surgical retry replays. */
	readonly setId: string;
	/** Every end of the change. One entry for an ordinary edit; two or more for a move. */
	readonly anchors: readonly IChangeAnchor[];
	readonly status: ChangeStatus;
	/** Set exactly when `status` is `needs-attention`, naming what the reviewer is being asked about. */
	readonly attentionReason?: AttentionReason;
	/** The planner's own account of why it proposed this. Advisory provenance, never a control signal. */
	readonly plannerIntent?: string;
	readonly changeClass: ChangeClass;
	/** The review class the shipped surfaces already group and label by (figure vs meaning change). */
	readonly kind: ChangeKind;
	/** Every revision, oldest first. `anchors` always equals the last version's anchors. */
	readonly versions: readonly IChangeVersion[];
	/** The comment thread. A change with an open thread is structurally excluded from every bulk sweep. */
	readonly thread: readonly IChangeThreadEntry[];
	/** Present once the change has been resolved (or reconciled): one entry per anchor, in anchor order. */
	readonly anchorOutcomes?: readonly AnchorOutcome[];
	/** Set when this change was split off a revision of another change rather than proposed on its own. */
	readonly spawnedBy?: string;
	/** Set when a later turn replaced this change. A superseded change leaves the pending view at once. */
	readonly supersededBy?: string;
	readonly proposedAt: number;
	readonly resolvedAt?: number;
}

/** The three statuses no code path may move a change out of (invariant I5). */
const TERMINAL: ReadonlySet<ChangeStatus> = new Set<ChangeStatus>(['approved', 'applied-recovered', 'rejected']);

/**
 * Whether `status` is terminal. The store refuses every write against a terminal change, which is what
 * makes "a decided change never resurrects" hold across reloads, replays and reconciliation alike.
 */
export function isTerminalStatus(status: ChangeStatus): boolean {
	return TERMINAL.has(status);
}

/**
 * Whether a change is still in the pending queue's field of view: not terminal and not superseded. This
 * is the one predicate every derived count folds through, so a count can never be re-derived a second way.
 */
export function isOpenChange(change: IChange): boolean {
	return !isTerminalStatus(change.status) && change.supersededBy === undefined;
}

/**
 * Whether the change's thread is OPEN - i.e. it is under discussion and no bulk verb may sweep it.
 *
 * A decided change's thread is history rather than a live conversation, so it does not hold anything open:
 * the thread survives for the audit trail (that is the point of stacking versions on one id), but there is
 * nothing left to protect it from, and a terminal change is refused by every verb anyway.
 */
export function hasOpenThread(change: IChange): boolean {
	return change.thread.length > 0 && !isTerminalStatus(change.status);
}

/**
 * Project the open changes onto the shape {@link import('./livingDocsModel.js').buildBulkSet} judges, so
 * bulk eligibility lives in exactly ONE function for the store as well as for the shipped rail (docs/30
 * invariant I4). Anything not `pending` is handed over as ineligible, which the capture then names as an
 * exclusion in the confirm sentence rather than dropping it silently.
 *
 * A multi-anchor change is attributed to its FIRST anchor's document: it is one decision, so it must be
 * counted once. Cross-document moves therefore understate the documents a set touches; detection of those
 * moves is deferred (docs/30 section 2.1), so no such change can exist yet.
 */
export function bulkCandidates(changes: readonly IChange[]): readonly IBulkCandidate[] {
	return changes.filter(isOpenChange).map(change => ({
		id: change.id,
		docId: change.anchors.length ? change.anchors[0].docUri : '',
		kind: change.kind,
		// `needsAttention` rather than a borrowed `applyFailure`: the store's records carry four different
		// non-pending states (`needs-attention`, `partially-applied`, `interrupted`, `unverified`) and only one
		// of them is an apply failure. Restating them in R2's vocabulary would keep the eligibility rule shared
		// at the cost of saying something untrue about three of them.
		needsAttention: change.status !== 'pending',
		hasOpenThread: hasOpenThread(change),
	}));
}

/**
 * Fold a change's per-anchor outcomes into its status, least-assuming verdict first.
 *
 * The ordering is the ethic and it is shared by the live resolution path and the startup reconciler; only
 * the two LABELS differ, because a status reached by writing and a status reached by proving after a crash
 * are different facts about the same document and the audit trail should say which one happened. If ANY
 * anchor is unprovable the change is `unverified` even when the others plainly landed - claiming a partial
 * success over a document nobody can account for is a smaller lie than issue #329's, but the same kind.
 */
export function foldAnchorOutcomes(outcomes: readonly AnchorOutcome[], allLanded: ChangeStatus, noneLanded: ChangeStatus): ChangeStatus {
	if (outcomes.some(o => !o.landed && (o.reason === 'unverified' || o.reason === 'doc-gone'))) {
		return 'unverified';
	}
	const landed = outcomes.filter(o => o.landed).length;
	if (landed === outcomes.length) {
		return allLanded;
	}
	return landed === 0 ? noneLanded : 'partially-applied';
}

/**
 * The hash of a document body, used for `baseRevision`, `expectedPostHash` and `postHash` alike.
 *
 * SHA1 rather than the cheap 32-bit {@link import('../../../../base/common/hash.js').stringHash}: this
 * value is what the startup reconciler PROVES a crash-window outcome from, and a collision there would
 * classify a document nothing happened to as `applied (recovered)`. Deliberately not injectable - a seam
 * here would be a seam for exactly the wrong-hash bug the invariant exists to rule out.
 */
export function hashContent(text: string): string {
	const sha = new StringSHA1();
	sha.update(text);
	return sha.digest();
}

/**
 * Derive `changeClass` from the alignment (docs/30 section 2.1): a change touching 60% or more of the
 * base document's characters is a rewrite, and its review moves to the document level. The planner's own
 * declared intent is stored beside this as advisory provenance; a mismatch between the two is a free
 * quality signal, which is why the host derives rather than believes.
 */
export function deriveChangeClass(anchors: readonly IChangeAnchor[], baseLength: number): ChangeClass {
	const changed = anchors.reduce((sum, a) => sum + Math.max(a.span.end - a.span.start, a.newText.length), 0);
	return changed / Math.max(baseLength, 1) >= 0.6 ? 'rewrite' : 'targeted';
}

/**
 * Group a change's anchors by document, preserving anchor order within each document.
 */
export function groupAnchorsByDoc(anchors: readonly IChangeAnchor[]): Map<string, IChangeAnchor[]> {
	const groups = new Map<string, IChangeAnchor[]>();
	for (const anchor of anchors) {
		const existing = groups.get(anchor.docUri);
		if (existing) { existing.push(anchor); } else { groups.set(anchor.docUri, [anchor]); }
	}
	return groups;
}

/**
 * The order the documents of one change are written in: INSERT SIDES FIRST, delete sides last (docs/30
 * section 5, journal discipline).
 *
 * This is the rule that decides what a crash between two writes leaves behind. Writing the insert first
 * means the interrupted state is text appearing in BOTH places - visible, nameable, recoverable by
 * deleting one. Writing the delete first would mean the interrupted state is text appearing in NEITHER -
 * silent loss, and the user's only clue is prose that has quietly gone missing. Every crash window in the
 * store fails towards visible duplication for this reason.
 */
export function orderDocsForWrite(groups: ReadonlyMap<string, IChangeAnchor[]>): readonly string[] {
	const docs = [...groups.keys()];
	const isPureDelete = (docUri: string) => groups.get(docUri)!.every(a => a.newText.length === 0);
	return [...docs.filter(d => !isPureDelete(d)), ...docs.filter(isPureDelete)];
}

/** Whether two anchors in the same document share at least one character. Touching spans do not overlap. */
export function anchorsOverlap(a: IChangeAnchor, b: IChangeAnchor): boolean {
	return a.docUri === b.docUri && a.span.start < b.span.end && b.span.start < a.span.end;
}

/**
 * Rebase a change's anchors over a write the store itself just made (invariant I8).
 *
 * This is the deterministic half of I8, and the reason it is safe is that the store KNOWS what it changed:
 * the geometry moves by arithmetic over the spans it wrote, with no searching, no fuzzy matching and no
 * re-reading of the document. Anchors before the write do not move; anchors after it move by the exact
 * length difference; anchors that overlap what was written cannot be rebased at all and are reported stale
 * so the store can record them as needing attention rather than applying them over a decision.
 *
 * Human edits are deliberately NOT rebased by this function: the store has no map of what a person typed,
 * so a proposal underneath one flips to `needs-attention` instead. Guessing there is how anchored
 * search/replace earns its defect families.
 *
 * Returns the rebased anchors, or `undefined` when the change overlaps the write and cannot be moved.
 */
export function rebaseAnchors(
	anchors: readonly IChangeAnchor[],
	docUri: string,
	applied: readonly IChangeAnchor[],
	fromRevision: string,
	toRevision: string,
): readonly IChangeAnchor[] | undefined {
	const rebased: IChangeAnchor[] = [];
	for (const anchor of anchors) {
		if (anchor.docUri !== docUri || anchor.baseRevision !== fromRevision) {
			rebased.push(anchor);
			continue;
		}
		if (applied.some(a => anchorsOverlap(a, anchor))) {
			return undefined;
		}
		const delta = applied
			.filter(a => a.span.end <= anchor.span.start)
			.reduce((sum, a) => sum + a.newText.length - (a.span.end - a.span.start), 0);
		rebased.push({ ...anchor, baseRevision: toRevision, span: { start: anchor.span.start + delta, end: anchor.span.end + delta } });
	}
	return rebased;
}

/** Splicing one document failed: nothing was written, and `reason` names why (invariant I1's vocabulary). */
export interface ISpliceFailed {
	readonly ok: false;
	readonly reason: AnchorFailure;
}

/** Splicing one document succeeded: `text` is the whole document as it must now be written. */
export interface ISpliceApplied {
	readonly ok: true;
	readonly text: string;
}

export type SpliceResult = ISpliceApplied | ISpliceFailed;

/**
 * Splice one document's anchors into its base text, verifying every anchor before touching anything.
 *
 * Two properties matter and are both structural rather than checked-after-the-fact. First, verification
 * happens for ALL anchors before the first character is written, so a partially spliced document is not a
 * state this function can produce. Second, splices are applied in DESCENDING start order, so an earlier
 * splice never shifts a later anchor's offsets - the arithmetic post-condition invariant I6 asks for,
 * obtained by construction rather than by re-diffing afterwards.
 */
export function spliceDoc(base: string, anchors: readonly IChangeAnchor[]): SpliceResult {
	for (const anchor of anchors) {
		if (anchor.span.start < 0 || anchor.span.end > base.length || anchor.span.start > anchor.span.end) {
			return { ok: false, reason: 'block-gone' };
		}
		if (base.slice(anchor.span.start, anchor.span.end) !== anchor.oldText) {
			return { ok: false, reason: 'anchor-miss' };
		}
	}
	const ordered = [...anchors].sort((a, b) => b.span.start - a.span.start);
	let text = base;
	for (const anchor of ordered) {
		text = text.slice(0, anchor.span.start) + anchor.newText + text.slice(anchor.span.end);
	}
	return { ok: true, text };
}

/**
 * The plain-words clause for one anchor failure, for composing into a sentence (no leading capital, no
 * full stop). It says what happened to the DOCUMENT, because that is the reader's actual question.
 */
export function describeAnchorFailure(reason: AnchorFailure): string {
	switch (reason) {
		case 'block-gone':
			return localize('livingDocs.change.reason.blockGone', "the part of the document it was written for is no longer there");
		case 'anchor-miss':
			return localize('livingDocs.change.reason.anchorMiss', "the text it was written for has changed since it was proposed");
		case 'not-attempted':
			return localize('livingDocs.change.reason.notAttempted', "an earlier part of the same change could not be written, so this part was left alone");
		case 'unverified':
			return localize('livingDocs.change.reason.unverified', "the document does not match what was expected, so what happened to it cannot be established");
		case 'stale-base':
			return localize('livingDocs.change.reason.staleBase', "the document has moved on since this was written");
		case 'doc-gone':
			return localize('livingDocs.change.reason.docGone', "the document could not be read");
	}
}

/**
 * The status line for a change, in the words the reviewer needs. The three interrupted states each name
 * what is TRUE of the document right now and what the reviewer can do about it, because "something went
 * wrong" is the sentence that destroys trust in a system that edits your writing.
 */
export function describeChangeStatus(status: ChangeStatus): string {
	switch (status) {
		case 'pending':
			return localize('livingDocs.change.status.pending', "Waiting on your call");
		case 'needs-attention':
			return localize('livingDocs.change.status.attention', "Needs your attention");
		case 'partially-applied':
			return localize('livingDocs.change.status.partial', "Only part of this change was written - the documents are not yet in the state it describes");
		case 'interrupted':
			return localize('livingDocs.change.status.interrupted', "This change was interrupted before anything was written - your documents are unchanged");
		case 'unverified':
			return localize('livingDocs.change.status.unverified', "This change cannot be verified - the document does not match what was expected, so nothing was retried");
		case 'approved':
			return localize('livingDocs.change.status.approved', "Approved and applied");
		case 'applied-recovered':
			return localize('livingDocs.change.status.recovered', "Applied - confirmed after a restart");
		case 'rejected':
			return localize('livingDocs.change.status.rejected', "Rejected");
	}
}
