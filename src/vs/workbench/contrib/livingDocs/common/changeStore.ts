/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { ChangeJournal, IChangeRebase, IChangeResolution, IChangeStoreFileSystem, IIntentDoc, IJournalError, JournalEntry, JournalFailure, JournalRecord } from './changeJournal.js';
import { committedDocs, openIntents, reconcileIntent } from './changeReconciler.js';
import { AnchorFailure, AnchorOutcome, anchorsOverlap, AttentionReason, bulkCandidates, ChangeActor, ChangeStatus, deriveChangeClass, foldAnchorOutcomes, groupAnchorsByDoc, hashContent, hasOpenThread, IChange, IChangeAnchor, IChangeVersion, isOpenChange, isTerminalStatus, orderDocsForWrite, rebaseAnchors, spliceDoc } from './changeRecord.js';
import { buildBulkSet, BulkVerb, ChangeKind, IBulkScope, IBulkSet } from './livingDocsModel.js';

// The persisted change store (docs/30 section 5). It is the single authority for counts, verbs, receipts and
// the audit trail, and it exists because today there is no such authority: the pending queue is an in-memory
// map on the service (`livingDocsService.ts:462`), the audit is a per-document lock file written separately,
// and the activity ledger is a third record. Three homes for one fact is why a count can disagree with
// itself and why a crash loses every proposal.
//
// The API is the invariant carrier, and the shape of it is the point:
//
//   propose(batch) -> receipts     every proposal is RECORDED, including the ones that are not eligible.
//   captureBulkSet(scope)          the only way to address more than one change at once.
//   approveByIds / rejectByIds     act on an immutable id snapshot; the set can shrink, never grow.
//   comment / amend                discussion and revision, on the same id, keeping the thread.
//
// There is deliberately no `setStatus`, and no query-based `approveAll(docId)`. A call site that could
// re-derive a set at apply time is a call site that will eventually apply a set the user never confirmed -
// that was issue #334 - so the shape of the API removes the possibility rather than documenting against it.
//
// Every mutating verb runs SERIALISED (see `_serialised`). Invariant I8 requires the write boundary to judge
// validity "atomically with admission", and admission and the write are separated by many awaits - reading
// documents, taking snapshots, appending J1. Two overlapping approves in the same document would otherwise
// both pass admission against the same base, both write, and one edit would be lost while both were recorded
// as approved: #329's family, reintroduced by way of concurrency inside the module built to make it
// impossible. The queue is what makes an unsafe interleaving unexpressible rather than merely undocumented.
//
// Pure `common/`: everything outside comes through the two injected seams below, which the tests fake and
// R6 backs with the workbench file service.

/**
 * The documents the store edits. Small on purpose: the store's job is to decide WHAT must be written and to
 * record it durably, not to know what a document is.
 */
export interface IChangeStoreDocuments {
	/** The document's current text, or `undefined` when it cannot be read. */
	read(docUri: string): Promise<string | undefined>;
	/**
	 * Capture a restorable version of the document as it currently stands and return its id.
	 *
	 * Called BEFORE the intent is journalled, so the snapshot id can be declared in J1 and the promise every
	 * bulk confirm makes ("a version snapshot is taken first, so you can restore") is kept structurally
	 * rather than by convention.
	 */
	snapshot(docUri: string): Promise<string>;
	/** Write the document's whole new text. Resolves only once durable; rejects when the write did not land. */
	write(docUri: string, text: string): Promise<void>;
}

/** A change as it is handed to {@link ChangeStore.propose}, before the store gives it an identity. */
export interface INewChange {
	readonly anchors: readonly IChangeAnchor[];
	readonly kind: ChangeKind;
	/** The planner's own account of why it proposed this. Advisory provenance, never a control signal. */
	readonly plannerIntent?: string;
	/** The total character length of the base documents, used to derive `targeted` vs `rewrite`. */
	readonly baseLength: number;
	/** Set when this change was split off a revision of another change rather than proposed on its own. */
	readonly spawnedBy?: string;
	/** A change this proposal replaces: the old one leaves the pending view with a `supersededBy` pointer. */
	readonly supersedes?: string;
}

/** One proposal batch. The `setId` groups them for surgical retry and for the review rail's change-set view. */
export interface IProposeBatch {
	readonly setId?: string;
	readonly changes: readonly INewChange[];
}

/**
 * What became of one proposed change. Every input gets one: an id and a status, never a silent drop. A
 * proposal computed against a revision the document has moved past is RECORDED as `needs-attention`
 * (invariant I8) rather than discarded, because a silent drop wearing a safety argument is still a silent
 * drop - the user asked for something and is entitled to see what happened to it.
 */
export interface IChangeReceipt {
	/** The index of this change in the batch, so the caller can line receipts up with what it sent. */
	readonly index: number;
	readonly changeId: string;
	readonly status: ChangeStatus;
	readonly attentionReason?: AttentionReason;
}

/**
 * The result of one propose call.
 *
 * `failure` set with EMPTY receipts means the journal refused and nothing landed. `failure` set alongside
 * receipts means the proposals themselves are recorded and durable, but a follow-on record (a supersession)
 * could not be written - so the batch is real and one link in it is not.
 */
export interface IProposeReceipts {
	readonly setId: string;
	readonly receipts: readonly IChangeReceipt[];
	readonly failure?: IJournalError;
}

/** Why one id in a captured set was not acted on. Reported, never swallowed (invariant I4). */
export type ChangeSkipReason =
	/** No change with that id is in the store. */
	| 'unknown-change'
	/** The change is already approved, applied or rejected. Terminal states are immutable. */
	| 'already-decided'
	/** A later turn replaced this change; deciding it now would decide something the user cannot see. */
	| 'superseded'
	/** The change is under discussion. A bulk verb never resolves something a person is talking about. */
	| 'in-discussion'
	/** The change is not pending - it needs attention, or an earlier attempt left it unverified. */
	| 'not-pending'
	/** The document moved past the revision this change was computed against (invariant I8). */
	| 'stale-base'
	/** Another change in the same batch already claims overlapping text; this one waits for a fresh base. */
	| 'overlap';

/** One skipped id, with the named reason the surface reports. */
export interface IChangeSkip {
	readonly changeId: string;
	readonly reason: ChangeSkipReason;
}

/** A refused single-change write: the machine-readable reason plus the words a surface can show. */
export interface IStoreRefusal {
	readonly ok: false;
	readonly reason: ChangeSkipReason | JournalFailure;
	readonly message: string;
}

/**
 * The closed result of a single-change write (`comment`, `amend`, `retryFrozenAppend`).
 *
 * These used to return `undefined` for both "done" and "refused because the change is terminal or unknown",
 * which is a silent drop inside an API whose whole thesis is that it does not have any.
 */
export type StoreWriteResult = { readonly ok: true } | IStoreRefusal;

/**
 * The result of one bulk verb. The applied set is a SUBSET of the ids handed in, by construction: the store
 * iterates the caller's snapshot and each id lands in exactly one of `resolved` or `skipped`.
 */
export interface IResolutionReport {
	readonly verb: BulkVerb;
	readonly resolved: readonly IChangeResolution[];
	readonly skipped: readonly IChangeSkip[];
	/**
	 * Set when the journal refused. Read `reason` before saying anything to the user: `append-failed` means
	 * no document was touched, `append-failed-after-write` means one was.
	 */
	readonly failure?: IJournalError;
}

/** What opening the store found: a healed journal, and any crash windows the reconciler had to settle. */
export interface IOpenReport {
	/** How many unreadable trailing journal records were dropped. Zero on a clean shutdown. */
	readonly truncated: number;
	/**
	 * How many readable records the store could not make sense of - an unrecognised kind, or one naming a
	 * change that is not in the log. Counted rather than passed over, because a store whose thesis is "no
	 * silent drops" does not get to make an exception for its own log.
	 */
	readonly quarantined: number;
	/** The verdicts the startup reconciler reached. Empty when the last session closed every intent. */
	readonly recovered: readonly IChangeResolution[];
	readonly failure?: IJournalError;
}

/** The plain-words clause for one skip, for composing into a sentence (no leading capital, no full stop). */
export function describeSkipReason(reason: ChangeSkipReason): string {
	switch (reason) {
		case 'unknown-change':
			return localize('livingDocs.store.skip.unknown', "it is no longer in the review queue");
		case 'already-decided':
			return localize('livingDocs.store.skip.decided', "you have already decided it");
		case 'superseded':
			return localize('livingDocs.store.skip.superseded', "a newer version of it replaced it");
		case 'in-discussion':
			return localize('livingDocs.store.skip.discussion', "you are still discussing it");
		case 'not-pending':
			return localize('livingDocs.store.skip.notPending', "it needs your attention first");
		case 'stale-base':
			return localize('livingDocs.store.skip.stale', "the document has changed since it was written");
		case 'overlap':
			return localize('livingDocs.store.skip.overlap', "another change in the same batch rewrites the same text");
	}
}

/** Compose a refusal from one skip reason, so the reason words live in exactly one place. */
function storeRefusal(reason: ChangeSkipReason): IStoreRefusal {
	return { ok: false, reason, message: localize('livingDocs.store.refusal', "This change could not be updated - {0}.", describeSkipReason(reason)) };
}

/** The version stamp on the derived view, so a future format change is detectable rather than silent. */
const DERIVED_VIEW_VERSION = 1;

/**
 * The persisted change store for one project.
 *
 * State is a fold of the journal and nothing else. `open()` reads the log, replays it, reconciles whatever
 * the last session left open, and writes the derived view; every verb afterwards appends to the log and
 * folds the same record it appended. There is no path that mutates a change without a journal record behind
 * it, which is what makes "every surface is a fold" (invariant I2) true rather than aspirational.
 */
export class ChangeStore {

	private readonly _journal: ChangeJournal;
	private readonly _changes = new Map<string, IChange>();

	/**
	 * The log as it currently stands: what was loaded, plus every record appended since. Held so that the
	 * reconciler can run at ANY moment, not only at startup - a journal append that lands late (after a
	 * freeze is lifted) leaves an intent open in exactly the same way a crash does, and it deserves exactly
	 * the same treatment rather than a second, parallel recovery path.
	 */
	private readonly _records: JournalRecord[] = [];

	private _quarantined = 0;

	/** The tail of the operation chain; see the note on serialisation at the top of this file. */
	private _tail: Promise<unknown> = Promise.resolve();

	constructor(
		fs: IChangeStoreFileSystem,
		private readonly _documents: IChangeStoreDocuments,
		/** The project's `.abstract` home. The store lives in `<home>/changes/`. */
		home: string,
		private readonly _now: () => number = () => Date.now(),
		private readonly _newId: () => string = generateUuid,
	) {
		this._journal = new ChangeJournal(fs, home, this._now);
	}

	/** True while a post-mutation journal append is outstanding: every new intent is refused until it lands. */
	get frozen(): boolean {
		return this._journal.frozen;
	}

	/** Every change the store holds, in journal order. The audit trail, including decided history. */
	allChanges(): readonly IChange[] {
		return [...this._changes.values()];
	}

	/** The changes still in the reviewer's field of view: not decided, not superseded. Every count folds here. */
	openChanges(): readonly IChange[] {
		return this.allChanges().filter(isOpenChange);
	}

	/** One change by id, or `undefined`. */
	change(changeId: string): IChange | undefined {
		return this._changes.get(changeId);
	}

	/**
	 * Open the store: read the journal, heal a torn tail, fold it, and reconcile every intent the last
	 * session opened but never closed.
	 *
	 * The reconciler NEVER writes to a document - not even to finish a write it can prove was interrupted.
	 * Auto-retrying at startup is how a recovery turns into a second, unasked-for edit against a document
	 * that may have moved on since. The store records the classification and leaves the recovery to the
	 * person who can see their own writing.
	 */
	open(): Promise<IOpenReport> {
		return this._serialised(async () => {
			const loaded = await this._journal.load();
			if (!loaded.ok) {
				return { truncated: 0, quarantined: 0, recovered: [], failure: loaded };
			}
			this._changes.clear();
			this._records.length = 0;
			this._quarantined = 0;
			for (const record of loaded.records) {
				this._records.push(record);
				if (!this._fold(record)) {
					this._quarantined++;
				}
			}
			const recovered = await this._reconcile();
			await this._writeDerivedView();
			return { truncated: loaded.truncated, quarantined: this._quarantined, recovered };
		});
	}

	/**
	 * Record a batch of proposals (docs/30 section 5: `propose(batch) -> receipts`).
	 *
	 * Every change in the batch gets an id and a receipt. A proposal whose base revision no longer matches
	 * the document is admitted as `needs-attention (stale-base)`: it is real work the agent did and the user
	 * must be able to see it, but it may not be written through, because its offsets describe a document
	 * that no longer exists. The deterministic rebase of non-overlapping staleness over the store's OWN
	 * writes is implemented (invariant I8); rebasing over a human's edits is not, because the store has no
	 * map of what a person typed, so those flip to attention rather than being guessed at.
	 */
	propose(batch: IProposeBatch): Promise<IProposeReceipts> {
		return this._serialised(() => this._propose(batch));
	}

	/**
	 * Capture an immutable bulk set (invariant I4). The eligibility rule and the confirm sentence are R3's
	 * `buildBulkSet`, reached by projecting the store's records onto the shape it judges - so the policy is
	 * stated in exactly one place for the store and the shipped rail alike, rather than drifting apart.
	 *
	 * Synchronous and read-only, so it is deliberately NOT queued: a capture is a snapshot of the store as it
	 * stands at the instant it is called, which is precisely what makes it immutable.
	 */
	captureBulkSet(scope: IBulkScope): IBulkSet {
		return buildBulkSet(scope, bulkCandidates(this.openChanges()));
	}

	/**
	 * Approve an immutable id snapshot, writing the documents and journalling every step (docs/30 section 5).
	 *
	 * The sequence is the invariant. Snapshot each document, declare the whole intent - including the hash
	 * every document MUST have afterwards - and make that record durable. Only then write, one document at a
	 * time, insert sides first, reading each one back to prove it landed where it was declared to. Commit
	 * each document as it lands. Resolve at the end. A crash at any point leaves a journal that says what was
	 * meant to happen and a disk the reconciler can compare against it.
	 */
	approveByIds(ids: readonly string[], actor: ChangeActor = 'user'): Promise<IResolutionReport> {
		return this._serialised(() => this._resolve('approve', ids, actor));
	}

	/**
	 * Reject an immutable id snapshot. No document is touched, which is the promise the confirm sentence
	 * makes, so there is no mutation phase and no crash window over a document body - only the decision
	 * itself has to be made durable.
	 */
	rejectByIds(ids: readonly string[], actor: ChangeActor = 'user'): Promise<IResolutionReport> {
		return this._serialised(() => this._resolve('reject', ids, actor));
	}

	/**
	 * Add a comment to a change's thread. Comment is a third verb beside approve and reject (docs/30 section
	 * 1.5): it never resolves anything, and a change with an open thread is structurally excluded from every
	 * bulk sweep - so asking a question about a change can never be undone by an "Approve all" two clicks
	 * later. Terminal changes refuse comments along with everything else.
	 */
	comment(changeId: string, text: string, actor: ChangeActor = 'user'): Promise<StoreWriteResult> {
		return this._serialised(() => this._comment(changeId, text, actor));
	}

	/**
	 * Stack a revision onto an existing change: same id, same thread, new content. This is what an agent
	 * revision answering a comment does, and it is deliberately NOT a new change - a reviewer who asked for
	 * something different should see their conversation continue on one card, not a second card appear
	 * beside the first with no memory of the exchange.
	 */
	amend(changeId: string, anchors: readonly IChangeAnchor[], plannerIntent?: string): Promise<StoreWriteResult> {
		return this._serialised(() => this._amend(changeId, anchors, plannerIntent));
	}

	/**
	 * Retry the journal append that froze the store, and absorb it.
	 *
	 * Landing the record is only half the repair: until it is folded, memory and the journal disagree, and a
	 * change the log now calls decided keeps being offered in every capture for the rest of the session. The
	 * record is therefore folded, and any intent still left open by the interruption is reconciled exactly as
	 * a restart would reconcile it - one recovery path, not two.
	 */
	retryFrozenAppend(): Promise<StoreWriteResult> {
		return this._serialised(() => this._retryFrozenAppend());
	}

	// --- the serialised implementations ---

	private async _propose(batch: IProposeBatch): Promise<IProposeReceipts> {
		const setId = batch.setId ?? this._newId();
		const reads = new Map<string, string | undefined>();
		const changes: IChange[] = [];
		const receipts: IChangeReceipt[] = [];
		for (const [index, input] of batch.changes.entries()) {
			const attentionReason = await this._admissionReason(input.anchors, reads);
			const change: IChange = {
				id: this._newId(),
				setId,
				anchors: input.anchors,
				status: attentionReason ? 'needs-attention' : 'pending',
				attentionReason,
				plannerIntent: input.plannerIntent,
				changeClass: deriveChangeClass(input.anchors, input.baseLength),
				kind: input.kind,
				versions: [{ revision: 1, anchors: input.anchors, plannerIntent: input.plannerIntent, at: this._now() }],
				thread: [],
				spawnedBy: input.spawnedBy,
				proposedAt: this._now(),
			};
			changes.push(change);
			receipts.push({ index, changeId: change.id, status: change.status, attentionReason });
		}
		const appended = await this._append({ kind: 'propose', setId, changes }, 'pre-mutation');
		if (appended) {
			return { setId, receipts: [], failure: appended };
		}
		for (const change of changes) {
			this._changes.set(change.id, change);
		}
		let failure: IJournalError | undefined;
		for (const [index, input] of batch.changes.entries()) {
			if (input.supersedes) {
				failure = await this._supersede(input.supersedes, receipts[index].changeId) ?? failure;
			}
		}
		await this._writeDerivedView();
		return { setId, receipts, failure };
	}

	private async _comment(changeId: string, text: string, actor: ChangeActor): Promise<StoreWriteResult> {
		const change = this._changes.get(changeId);
		if (!change) {
			return storeRefusal('unknown-change');
		}
		if (isTerminalStatus(change.status)) {
			return storeRefusal('already-decided');
		}
		const entry = { id: this._newId(), actor, text, at: this._now() };
		const appended = await this._append({ kind: 'comment', changeId, entry }, 'pre-mutation');
		if (appended) {
			return appended;
		}
		this._changes.set(changeId, { ...change, thread: [...change.thread, entry] });
		await this._writeDerivedView();
		return { ok: true };
	}

	private async _amend(changeId: string, anchors: readonly IChangeAnchor[], plannerIntent?: string): Promise<StoreWriteResult> {
		const change = this._changes.get(changeId);
		if (!change) {
			return storeRefusal('unknown-change');
		}
		if (isTerminalStatus(change.status)) {
			return storeRefusal('already-decided');
		}
		const version = { revision: change.versions.length + 1, anchors, plannerIntent, at: this._now() };
		const appended = await this._append({ kind: 'amend', changeId, version }, 'pre-mutation');
		if (appended) {
			return appended;
		}
		this._foldAmend(changeId, version);
		await this._writeDerivedView();
		return { ok: true };
	}

	private async _retryFrozenAppend(): Promise<StoreWriteResult> {
		const result = await this._journal.retryFrozenAppend();
		if (!result.ok) {
			return result;
		}
		if (result.record) {
			this._records.push(result.record);
			this._fold(result.record);
			await this._reconcile();
		}
		await this._writeDerivedView();
		return { ok: true };
	}

	// --- resolution ---

	private async _resolve(verb: BulkVerb, ids: readonly string[], actor: ChangeActor): Promise<IResolutionReport> {
		const reads = new Map<string, string | undefined>();
		const skipped: IChangeSkip[] = [];
		const eligible: IChange[] = [];
		const claimed: IChangeAnchor[] = [];
		for (const changeId of ids) {
			const skip = this._eligibilitySkip(changeId);
			if (skip) {
				skipped.push({ changeId, reason: skip });
				continue;
			}
			const change = this._changes.get(changeId)!;
			if (verb === 'approve') {
				const stale = await this._admissionReason(change.anchors, reads);
				if (stale) {
					const flagged = await this._flagAttention(changeId, stale);
					if (flagged) {
						return { verb, resolved: [], skipped, failure: flagged };
					}
					skipped.push({ changeId, reason: 'stale-base' });
					continue;
				}
				if (change.anchors.some(a => claimed.some(c => anchorsOverlap(a, c)))) {
					skipped.push({ changeId, reason: 'overlap' });
					continue;
				}
				claimed.push(...change.anchors);
			}
			eligible.push(change);
		}
		if (!eligible.length) {
			return { verb, resolved: [], skipped };
		}
		return verb === 'reject'
			? this._resolveReject(eligible, skipped, actor)
			: this._resolveApprove(eligible, skipped, actor, reads);
	}

	private _eligibilitySkip(changeId: string): ChangeSkipReason | undefined {
		const change = this._changes.get(changeId);
		if (!change) { return 'unknown-change'; }
		if (isTerminalStatus(change.status)) { return 'already-decided'; }
		if (change.supersededBy !== undefined) { return 'superseded'; }
		if (hasOpenThread(change)) { return 'in-discussion'; }
		if (change.status !== 'pending') { return 'not-pending'; }
		return undefined;
	}

	private async _resolveReject(eligible: readonly IChange[], skipped: readonly IChangeSkip[], actor: ChangeActor): Promise<IResolutionReport> {
		const intentId = this._newId();
		const intent = await this._append({
			kind: 'intent',
			intentId,
			changeIds: eligible.map(c => c.id),
			verb: 'reject' as const,
			actor,
			docs: [],
		}, 'pre-mutation');
		if (intent) {
			return { verb: 'reject', resolved: [], skipped, failure: intent };
		}
		const resolutions: IChangeResolution[] = eligible.map(change => ({
			changeId: change.id,
			status: 'rejected' as const,
			anchorOutcomes: change.anchors.map(a => ({ docUri: a.docUri, landed: false as const, reason: 'not-attempted' as const })),
		}));
		// Nothing was written, so a failure here does not freeze the store: the intent is on disk, and the
		// startup reconciler settles an open reject without touching a document.
		const closed = await this._append({ kind: 'resolution', intentId, resolutions }, 'pre-mutation');
		if (closed) {
			return { verb: 'reject', resolved: [], skipped, failure: closed };
		}
		this._foldResolutions(resolutions);
		await this._writeDerivedView();
		return { verb: 'reject', resolved: resolutions, skipped };
	}

	private async _resolveApprove(eligible: readonly IChange[], skipped: readonly IChangeSkip[], actor: ChangeActor, reads: Map<string, string | undefined>): Promise<IResolutionReport> {
		const allAnchors = eligible.flatMap(c => c.anchors);
		const groups = groupAnchorsByDoc(allAnchors);
		const order = orderDocsForWrite(groups);
		const targets = new Map<string, { readonly base: string; readonly text: string }>();
		for (const docUri of order) {
			const base = reads.get(docUri);
			if (base === undefined) {
				return { verb: 'approve', resolved: [], skipped: [...skipped, ...eligible.map(c => ({ changeId: c.id, reason: 'stale-base' as const }))] };
			}
			const spliced = spliceDoc(base, groups.get(docUri)!);
			if (!spliced.ok) {
				return { verb: 'approve', resolved: [], skipped: [...skipped, ...eligible.map(c => ({ changeId: c.id, reason: 'stale-base' as const }))] };
			}
			targets.set(docUri, { base, text: spliced.text });
		}
		const docs: IIntentDoc[] = [];
		for (const docUri of order) {
			const target = targets.get(docUri)!;
			docs.push({
				docUri,
				baseHash: hashContent(target.base),
				expectedPostHash: hashContent(target.text),
				snapshotId: await this._documents.snapshot(docUri),
			});
		}
		const expected = new Map(docs.map(d => [d.docUri, d.expectedPostHash]));
		const intentId = this._newId();
		// J1. Everything above this line is reversible by doing nothing; everything below it changes the
		// user's documents. If this append does not reach the disk, the batch stops here and the user is told
		// their approval was not recorded - and it is TRUE that nothing was changed.
		const intent = await this._append({ kind: 'intent', intentId, changeIds: eligible.map(c => c.id), verb: 'approve' as const, actor, docs }, 'pre-mutation');
		if (intent) {
			return { verb: 'approve', resolved: [], skipped, failure: intent };
		}
		const landed = new Map<string, string>();
		const failedDocs = new Map<string, AnchorFailure>();
		let frozenBy: IJournalError | undefined;
		for (const docUri of order) {
			if (frozenBy || failedDocs.size) {
				failedDocs.set(docUri, 'not-attempted');
				continue;
			}
			const target = targets.get(docUri)!;
			try {
				await this._documents.write(docUri, target.text);
			} catch {
				failedDocs.set(docUri, 'anchor-miss');
				continue;
			}
			// I6, and the reason it is "total over unknown failure modes": the post-condition is proved by
			// READING THE DOCUMENT BACK, never by restating the string we meant to write. A backing store that
			// normalises on the way out - which is exactly what the serialiser this design quarantines does -
			// would otherwise produce a durable `approved` whose post-hash matches nothing on disk, and the
			// reconciler could never catch it, because it believes a J2 commit outright.
			const observed = await this._documents.read(docUri);
			if (observed === undefined) {
				failedDocs.set(docUri, 'doc-gone');
				continue;
			}
			const postHash = hashContent(observed);
			if (postHash !== expected.get(docUri)) {
				// No J2. A commit here would tell the reconciler this document landed, and it demonstrably did
				// not land where the intent declared - so the honest record is the absence of a commit, which
				// leaves the disk hash matching neither the base nor the expectation: `unverified`, both now and
				// on any later recovery.
				failedDocs.set(docUri, 'unverified');
				continue;
			}
			const commit = await this._append({ kind: 'doc-commit', intentId, docUri, postHash }, 'post-mutation');
			if (commit) {
				frozenBy = commit;
				continue;
			}
			landed.set(docUri, postHash);
		}
		const resolutions: IChangeResolution[] = eligible.map(change => {
			const anchorOutcomes: AnchorOutcome[] = change.anchors.map(anchor => {
				const postHash = landed.get(anchor.docUri);
				return postHash !== undefined
					? { docUri: anchor.docUri, landed: true as const, postHash }
					: { docUri: anchor.docUri, landed: false as const, reason: failedDocs.get(anchor.docUri) ?? 'unverified' };
			});
			const status = foldAnchorOutcomes(anchorOutcomes, 'approved', 'needs-attention');
			return status === 'needs-attention'
				? { changeId: change.id, status, anchorOutcomes, attentionReason: 'apply-failed' as const }
				: { changeId: change.id, status, anchorOutcomes };
		});
		if (frozenBy) {
			// The disk moved and the record of it did not. The store freezes rather than resolving from a
			// journal it knows is behind: the next `open()` - or the fold that follows a successful retry -
			// reconciles this intent from the declared expected post-hashes, which is what they are for.
			return { verb: 'approve', resolved: [], skipped, failure: frozenBy };
		}
		const closed = await this._append({ kind: 'resolution', intentId, resolutions }, 'post-mutation');
		if (closed) {
			return { verb: 'approve', resolved: [], skipped, failure: closed };
		}
		this._foldResolutions(resolutions);
		const rebaseFailure = await this._rebaseOverWrite(docs, groups, new Set(eligible.map(c => c.id)), landed);
		await this._writeDerivedView();
		return { verb: 'approve', resolved: resolutions, skipped, failure: rebaseFailure };
	}

	/**
	 * Move the still-open changes in a document the store just wrote onto the new revision (invariant I8).
	 *
	 * Without this, approving one change would invalidate every other proposal in the same document: their
	 * base revision no longer matches, so the store would refuse them all, and a reviewer working through a
	 * rail of five changes would find four of them flagged after accepting the first. That would be safe and
	 * useless. The rebase is arithmetic over spans the store itself wrote, so it is exact - and a change that
	 * OVERLAPS what was just written is not rebased at all but recorded as needing attention, because there
	 * is no honest way to apply a proposal over text a decision has already replaced.
	 */
	private async _rebaseOverWrite(
		intentDocs: readonly IIntentDoc[],
		groups: ReadonlyMap<string, IChangeAnchor[]>,
		resolved: ReadonlySet<string>,
		landed: ReadonlyMap<string, string>,
	): Promise<IJournalError | undefined> {
		const moved = new Map<string, readonly IChangeAnchor[]>();
		const stale = new Set<string>();
		for (const doc of intentDocs) {
			if (!landed.has(doc.docUri)) {
				continue;
			}
			const applied = groups.get(doc.docUri)!;
			for (const change of this.openChanges()) {
				if (resolved.has(change.id) || stale.has(change.id)) {
					continue;
				}
				const anchors = moved.get(change.id) ?? change.anchors;
				if (!anchors.some(a => a.docUri === doc.docUri && a.baseRevision === doc.baseHash)) {
					continue;
				}
				const next = rebaseAnchors(anchors, doc.docUri, applied, doc.baseHash, doc.expectedPostHash);
				if (!next) {
					stale.add(change.id);
					moved.delete(change.id);
					continue;
				}
				moved.set(change.id, next);
			}
		}
		if (!moved.size && !stale.size) {
			return undefined;
		}
		const rebased = [...moved].map(([changeId, anchors]) => ({ changeId, anchors }));
		const appended = await this._append({ kind: 'rebase', rebased, stale: [...stale] }, 'post-mutation');
		if (appended) {
			return appended;
		}
		this._foldRebase(rebased, [...stale]);
		return undefined;
	}

	// --- admission, attention and supersession ---

	/**
	 * Whether a set of anchors may be written through as it stands, and why not when it may not. A hash
	 * mismatch means the document has moved past the revision the offsets were measured against; a span that
	 * does not hold the text it claims means the proposal describes a document that never existed.
	 *
	 * `reads` caches each document's text for the duration of ONE operation, so admission and the splice that
	 * follows it are judged against the same bytes - and so a ten-change batch does not read the same file
	 * ten times.
	 */
	private async _admissionReason(anchors: readonly IChangeAnchor[], reads: Map<string, string | undefined>): Promise<AttentionReason | undefined> {
		for (const anchor of anchors) {
			if (!reads.has(anchor.docUri)) {
				reads.set(anchor.docUri, await this._documents.read(anchor.docUri));
			}
			const text = reads.get(anchor.docUri);
			if (text === undefined || hashContent(text) !== anchor.baseRevision) {
				return 'stale-base';
			}
			if (anchor.span.end > text.length || text.slice(anchor.span.start, anchor.span.end) !== anchor.oldText) {
				return 'anchor-invalid';
			}
		}
		return undefined;
	}

	private async _flagAttention(changeId: string, reason: AttentionReason): Promise<IJournalError | undefined> {
		const change = this._changes.get(changeId);
		if (!change || isTerminalStatus(change.status)) {
			return undefined;
		}
		const appended = await this._append({ kind: 'attention', changeId, reason }, 'pre-mutation');
		if (appended) {
			return appended;
		}
		this._changes.set(changeId, { ...change, status: 'needs-attention', attentionReason: reason });
		return undefined;
	}

	private async _supersede(changeId: string, supersededBy: string): Promise<IJournalError | undefined> {
		const change = this._changes.get(changeId);
		if (!change || isTerminalStatus(change.status)) {
			return undefined;
		}
		const appended = await this._append({ kind: 'supersede', changeId, supersededBy }, 'pre-mutation');
		if (appended) {
			return appended;
		}
		this._changes.set(changeId, { ...change, supersededBy });
		return undefined;
	}

	// --- the journal, reconciliation and the fold ---

	/**
	 * Append one record and keep the in-memory log in step with it. Returns the refusal, or `undefined` when
	 * the record is durable - the shape that makes `if (failure) { ... }` the only way to reach the happy path.
	 */
	private async _append(entry: JournalEntry, phase: 'pre-mutation' | 'post-mutation'): Promise<IJournalError | undefined> {
		const result = await this._journal.append(entry, phase);
		if (!result.ok) {
			return result;
		}
		this._records.push(result.record);
		return undefined;
	}

	private async _reconcile(): Promise<readonly IChangeResolution[]> {
		const intents = openIntents(this._records);
		if (!intents.length) {
			return [];
		}
		const observed = new Map<string, string | undefined>();
		for (const intent of intents) {
			for (const doc of intent.docs) {
				if (!observed.has(doc.docUri)) {
					const text = await this._documents.read(doc.docUri);
					observed.set(doc.docUri, text === undefined ? undefined : hashContent(text));
				}
			}
		}
		const resolutions: IChangeResolution[] = [];
		for (const intent of intents) {
			resolutions.push(...reconcileIntent(intent, committedDocs(this._records, intent.intentId), observed, this._changes));
		}
		const appended = await this._append({ kind: 'reconcile', intentIds: intents.map(i => i.intentId), resolutions }, 'pre-mutation');
		if (appended) {
			// The verdicts could not be recorded, so they are not applied either: the store keeps the crash
			// windows open and tries again next time rather than holding a conclusion nothing on disk supports.
			return [];
		}
		this._foldResolutions(resolutions);
		return resolutions;
	}

	/**
	 * Fold one record into the store's state. Returns false when the record could not be acted on at all -
	 * an unrecognised kind, or one naming a change the log does not contain - so that `open()` can COUNT what
	 * it could not understand instead of passing over it in silence.
	 *
	 * A record refused because its change is terminal is NOT quarantined: that is the invariant working, not
	 * the store failing to understand something.
	 */
	private _fold(record: JournalRecord): boolean {
		switch (record.kind) {
			case 'propose':
				for (const change of record.changes) {
					if (!this._changes.has(change.id)) { this._changes.set(change.id, change); }
				}
				return true;
			case 'resolution':
			case 'reconcile':
				this._foldResolutions(record.resolutions);
				return record.resolutions.every(r => this._changes.has(r.changeId));
			case 'comment': {
				const change = this._changes.get(record.changeId);
				if (change && !isTerminalStatus(change.status)) {
					this._changes.set(change.id, { ...change, thread: [...change.thread, record.entry] });
				}
				return change !== undefined;
			}
			case 'amend':
				this._foldAmend(record.changeId, record.version);
				return this._changes.has(record.changeId);
			case 'supersede': {
				const change = this._changes.get(record.changeId);
				if (change && !isTerminalStatus(change.status)) {
					this._changes.set(change.id, { ...change, supersededBy: record.supersededBy });
				}
				return change !== undefined;
			}
			case 'rebase':
				this._foldRebase(record.rebased, record.stale);
				return [...record.rebased.map(r => r.changeId), ...record.stale].every(id => this._changes.has(id));
			case 'attention': {
				const change = this._changes.get(record.changeId);
				if (change && !isTerminalStatus(change.status)) {
					this._changes.set(change.id, { ...change, status: 'needs-attention', attentionReason: record.reason });
				}
				return change !== undefined;
			}
			case 'intent':
			case 'doc-commit':
				// Intents and commits are the crash-recovery record; they change no state on their own. What
				// they mean is decided by the resolution that follows, or by the reconciler when none does.
				return true;
			default:
				// Unreachable through the type, reachable through a file: a checksum-valid record written by a
				// newer version, or by hand. Counted, never guessed at.
				return false;
		}
	}

	private _foldAmend(changeId: string, version: IChangeVersion): void {
		const change = this._changes.get(changeId);
		if (!change || isTerminalStatus(change.status)) {
			return;
		}
		this._changes.set(changeId, {
			...change,
			anchors: version.anchors,
			versions: [...change.versions, version],
			status: 'pending',
			attentionReason: undefined,
		});
	}

	private _foldRebase(rebased: readonly IChangeRebase[], stale: readonly string[]): void {
		for (const entry of rebased) {
			const change = this._changes.get(entry.changeId);
			if (change && !isTerminalStatus(change.status)) {
				this._changes.set(change.id, { ...change, anchors: entry.anchors });
			}
		}
		for (const changeId of stale) {
			const change = this._changes.get(changeId);
			if (change && !isTerminalStatus(change.status)) {
				this._changes.set(change.id, { ...change, status: 'needs-attention', attentionReason: 'stale-base' });
			}
		}
	}

	/**
	 * Apply resolutions to the fold. The terminal guard here is where invariant I5 actually bites: a change
	 * that has been decided is never moved again by any record, journalled or replayed, so a decided change
	 * cannot resurrect even if the log says otherwise.
	 */
	private _foldResolutions(resolutions: readonly IChangeResolution[]): void {
		for (const resolution of resolutions) {
			const change = this._changes.get(resolution.changeId);
			if (!change || isTerminalStatus(change.status)) {
				continue;
			}
			this._changes.set(change.id, {
				...change,
				status: resolution.status,
				attentionReason: resolution.attentionReason,
				anchorOutcomes: resolution.anchorOutcomes,
				resolvedAt: this._now(),
			});
		}
	}

	/**
	 * Rebuild the derived view from the fold. It is written for anything that wants to read the store's state
	 * without replaying the log; it is never read back for authority, and never edited in place, so it cannot
	 * drift into being a second source of truth (which is what the per-document lock file became).
	 */
	private async _writeDerivedView(): Promise<void> {
		await this._journal.writeDerivedView(JSON.stringify({ version: DERIVED_VIEW_VERSION, changes: this.allChanges() }, undefined, '\t'));
	}

	/**
	 * Run `operation` after every operation queued before it, whatever became of them.
	 *
	 * This is the store's write boundary. Admission (is this change still valid against the document?) and
	 * the write it authorises are separated by many awaits, and invariant I8 requires them to be atomic with
	 * respect to one another. Serialising the verbs is what delivers that: two approves cannot both read the
	 * same base, both splice from it and both write, losing one edit while recording both as approved.
	 */
	private _serialised<T>(operation: () => Promise<T>): Promise<T> {
		const run = this._tail.then(operation, operation);
		this._tail = run.then(() => undefined, () => undefined);
		return run;
	}
}
