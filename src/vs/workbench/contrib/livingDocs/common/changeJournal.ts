/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { AnchorOutcome, AttentionReason, ChangeActor, ChangeStatus, hashContent, IChange, IChangeAnchor, IChangeThreadEntry, IChangeVersion } from './changeRecord.js';
import { BulkVerb } from './livingDocsModel.js';

// The append-only intent journal (docs/30 section 5, journal discipline). The store's durability story in
// one sentence: WRITE DOWN WHAT YOU ARE ABOUT TO DO, INCLUDING THE HASH YOU EXPECT TO SEE AFTERWARDS,
// BEFORE YOU DO IT.
//
// That single ordering is what turns crash recovery from suspicion into proof. Without a declared expected
// post-hash, a document that does not match its base after a crash is ambiguous forever - did the write
// land, or did something else edit it? With one, the three possible hashes are three different, provable
// facts, and the reconciler can tell the user which one happened (see `changeReconciler.ts`).
//
// The discipline the writers must keep:
//   J1  intent    - change ids, verb, actor, and per document baseHash + expectedPostHash + snapshot id.
//                   Appended and durable BEFORE any mutation. If this append fails, NOTHING is mutated.
//   M   mutations - one document at a time, insert sides before delete sides, so every crash window fails
//                   towards visible duplication rather than silent loss.
//   J2  doc commit - per document, carrying the postHash actually observed.
//   J3  resolution - the change's final status and its per-anchor outcomes.
//   then derived views are rebuilt from the fold. They are never written to directly.
//
// Every record is framed with its own length and checksum, so a torn append (the machine died mid-write)
// is detectable rather than being read back as plausible nonsense; recovery truncates the torn tail and
// leaves the journal usable.
//
// Pure: the only outside contact is the injected {@link IChangeStoreFileSystem}, which the tests fake and
// R6 backs with the real file system.

/** Where the store lives inside the project's `.abstract/` home. */
export const CHANGES_DIR = 'changes';

/** The append-only journal file, relative to {@link CHANGES_DIR}. */
export const JOURNAL_FILE = 'journal.log';

/** The derived view of the folded store, rebuilt after every resolution and never read for authority. */
export const SNAPSHOT_FILE = 'changes.json';

/**
 * The minimal file system the change store needs.
 *
 * Deliberately tiny, and deliberately NOT `IFileService`: the store and the journal are pure `common/`
 * modules so that the invariants can be tested at unit speed with a fake that fails on demand (disk full,
 * a torn append, a write that dies between two documents). R6 backs this with the workbench file service.
 *
 * Paths are opaque strings joined with `/`; the caller supplies the project's `.abstract` home, so this
 * interface never has to know whether it is holding a file path or a URI.
 */
export interface IChangeStoreFileSystem {
	/** The file's whole content, or `undefined` when it does not exist. Rejects only on a real read error. */
	read(path: string): Promise<string | undefined>;
	/**
	 * Append `text` to the file, creating it and its parent directories if absent.
	 *
	 * **SINGLE WRITER.** The store assumes one window per project journal. A backing implementation that has
	 * to read the file and write it back - which the renderer's file service does, having no append - loses a
	 * record outright when two windows append at the same moment: both read the same bytes, both write their
	 * own record onto them, and the first one to land is overwritten with no trace of it anywhere. Sequential
	 * interleaving is safe and is NAMED rather than misread ({@link IJournalReadResult.foreign}); concurrent
	 * interleaving is not safe and cannot be made safe here. Real multi-window support needs a lock or a
	 * genuinely atomic append at this seam.
	 *
	 * MUST resolve only once the bytes are durable on disk - an fsync, or the platform equivalent. The whole
	 * journal discipline rests on this: an append that has resolved but not reached the platter would let a
	 * mutation proceed against an intent nobody can recover. Durability is part of the contract rather than a
	 * separate `fsync()` member precisely so that no caller can forget to call it, and because a backing
	 * implementation that cannot honour it must fail here rather than quietly no-op a sync call.
	 */
	append(path: string, text: string): Promise<void>;
	/** Replace the file's whole content atomically. Used by torn-append recovery and derived views. */
	replace(path: string, text: string): Promise<void>;
	/** The file names directly under `dir`; empty when the directory does not exist. */
	list(dir: string): Promise<readonly string[]>;
}

/** Fields every journal record carries: who wrote it, its position in that writer's log, and when. */
interface IJournalRecordBase {
	/**
	 * 1-based and contiguous WITHIN ONE INSTANCE. A gap is how a truncated tail announces itself.
	 *
	 * Per-instance rather than per-file because the file can hold records from more than one window. A single
	 * global counter meant a second window's perfectly good append collided with a number the first had
	 * already used, and the contiguity check - correctly, on its own terms - read that as a torn tail and
	 * threw away everything from the collision on, reporting it as `truncated`. That is a lost decision
	 * reported as a disk fault, which is precisely the kind of thing this store exists not to do.
	 */
	readonly seq: number;
	/**
	 * The window that wrote this record. Absent on journals written before instances were stamped, which read
	 * as one lineage - correct, because nothing else was writing them.
	 */
	readonly instance?: string;
	readonly at: number;
}

/** A batch of newly proposed changes entered the store. */
export interface IProposeRecord extends IJournalRecordBase {
	readonly kind: 'propose';
	readonly setId: string;
	readonly changes: readonly IChange[];
}

/** One document's declared expectation for an intent: where it starts, where it must end, how to restore it. */
export interface IIntentDoc {
	readonly docUri: string;
	/** The hash of the document as the intent was declared. */
	readonly baseHash: string;
	/** The hash the document MUST have once this intent's writes land. Declared before any of them. */
	readonly expectedPostHash: string;
	/** The restorable version snapshot taken before the write, so the reviewer can always go back. */
	readonly snapshotId: string;
}

/** J1: what is about to happen, written down and made durable before any of it does. */
export interface IIntentRecord extends IJournalRecordBase {
	readonly kind: 'intent';
	readonly intentId: string;
	readonly changeIds: readonly string[];
	readonly verb: BulkVerb;
	readonly actor: ChangeActor;
	readonly docs: readonly IIntentDoc[];
}

/** J2: one document's write landed, carrying the hash actually observed afterwards. */
export interface IDocCommitRecord extends IJournalRecordBase {
	readonly kind: 'doc-commit';
	readonly intentId: string;
	readonly docUri: string;
	readonly postHash: string;
}

/** One change's final word in a resolution: the status it reached and what happened at each anchor. */
export interface IChangeResolution {
	readonly changeId: string;
	readonly status: ChangeStatus;
	readonly anchorOutcomes: readonly AnchorOutcome[];
	/** Set exactly when `status` is `needs-attention`, naming what the reviewer is being asked about. */
	readonly attentionReason?: AttentionReason;
}

/** J3: the intent is finished. Until this record exists, the intent is an open crash window. */
export interface IResolutionRecord extends IJournalRecordBase {
	readonly kind: 'resolution';
	readonly intentId: string;
	readonly resolutions: readonly IChangeResolution[];
}

/** A comment was added to a change's thread, which also takes it out of every bulk sweep. */
export interface ICommentRecord extends IJournalRecordBase {
	readonly kind: 'comment';
	readonly changeId: string;
	readonly entry: IChangeThreadEntry;
}

/** A revision stacked onto an existing change: same id, same thread, new content. */
export interface IAmendRecord extends IJournalRecordBase {
	readonly kind: 'amend';
	readonly changeId: string;
	readonly version: IChangeVersion;
}

/** A later turn replaced this change; it leaves the pending view without being decided or discarded. */
export interface ISupersedeRecord extends IJournalRecordBase {
	readonly kind: 'supersede';
	readonly changeId: string;
	readonly supersededBy: string;
}

/** One change's anchors after the store rebased them over its own write. */
export interface IChangeRebase {
	readonly changeId: string;
	readonly anchors: readonly IChangeAnchor[];
}

/**
 * The store rebased the still-open changes in a document it just wrote (invariant I8).
 *
 * The resulting anchors are recorded outright rather than the arithmetic that produced them, so replaying
 * the log lands on exactly the same geometry as the live run did - a fold that recomputed would be a second
 * implementation of the same rule, and two implementations of one rule eventually disagree.
 */
export interface IRebaseRecord extends IJournalRecordBase {
	readonly kind: 'rebase';
	readonly rebased: readonly IChangeRebase[];
	/** Changes whose spans overlapped what was written: recorded as needing attention, never discarded. */
	readonly stale: readonly string[];
	/**
	 * Why the stale ones need attention. Absent means `stale-base` - the store wrote over them itself.
	 * A remap over a HUMAN edit records `human-edit` instead, because the two are different facts about the
	 * document and the reviewer is entitled to be told which one moved their proposal.
	 */
	readonly staleReason?: AttentionReason;
}

/** A recorded change became ineligible - the document moved on underneath it. Never a silent drop. */
export interface IAttentionRecord extends IJournalRecordBase {
	readonly kind: 'attention';
	readonly changeId: string;
	readonly reason: AttentionReason;
}

/** The startup reconciler's verdict on the crash windows it found, journalled so a restart is idempotent. */
export interface IReconcileRecord extends IJournalRecordBase {
	readonly kind: 'reconcile';
	readonly intentIds: readonly string[];
	readonly resolutions: readonly IChangeResolution[];
}

/** Every shape the journal can hold. Narrow on `kind`. */
export type JournalRecord =
	| IProposeRecord
	| IIntentRecord
	| IDocCommitRecord
	| IResolutionRecord
	| ICommentRecord
	| IAmendRecord
	| ISupersedeRecord
	| IRebaseRecord
	| IAttentionRecord
	| IReconcileRecord;

/**
 * Everything a record needs except its position in the log, which the journal assigns. Distributive, so a
 * caller still gets one exact record shape per `kind` rather than a merged bag of optional fields.
 */
export type JournalEntry = JournalRecord extends infer T ? T extends JournalRecord ? Omit<T, 'seq' | 'at' | 'instance'> : never : never;

/** What reading a journal file produced, including whether its tail had to be thrown away. */
export interface IJournalReadResult {
	readonly records: readonly JournalRecord[];
	/** How many trailing records were unreadable and dropped. Zero on a clean journal. */
	readonly truncated: number;
	/**
	 * How many records another window wrote into this journal. Zero in the supported single-window case.
	 *
	 * Counted and NAMED rather than silently absorbed: the records are read and folded (they are real
	 * decisions, made by a real person, and dropping them would be the silent loss the whole design refuses),
	 * but their presence means this journal has had two writers, and the append path cannot promise that no
	 * record was lost between them - see {@link IChangeStoreFileSystem.append}.
	 */
	readonly foreign: number;
	/** The journal text with the unreadable tail removed. Written back so the next append lands cleanly. */
	readonly healed: string;
}

/**
 * Frame one record for the log: `<checksum> <length> <payload>` on a single line.
 *
 * The length and the checksum are both present because they catch different failures. The length catches
 * the torn append - the process died part-way through the write, so fewer bytes arrived than were promised.
 * The checksum catches the corrupted one - the right number of bytes arrived, but not the right bytes. A
 * record that survives both is one the reconciler is entitled to reason from.
 */
export function frameRecord(record: JournalRecord): string {
	const payload = JSON.stringify(record);
	return `${hashContent(payload)} ${payload.length} ${payload}\n`;
}

/** Parse one framed line back into a record, or `undefined` when the frame does not hold up. */
function parseFramed(line: string): JournalRecord | undefined {
	const firstSpace = line.indexOf(' ');
	const secondSpace = line.indexOf(' ', firstSpace + 1);
	if (firstSpace <= 0 || secondSpace <= firstSpace) {
		return undefined;
	}
	const checksum = line.slice(0, firstSpace);
	const declaredLength = Number(line.slice(firstSpace + 1, secondSpace));
	const payload = line.slice(secondSpace + 1);
	if (!Number.isInteger(declaredLength) || declaredLength !== payload.length || hashContent(payload) !== checksum) {
		return undefined;
	}
	try {
		return JSON.parse(payload) as JournalRecord;
	} catch {
		return undefined;
	}
}

/**
 * Read a journal, truncating a torn or corrupt tail (docs/30 section 5).
 *
 * Truncation runs from the FIRST unreadable record to the end rather than skipping it and carrying on. The
 * journal is a sequence of facts about the order things happened in; once one of them is unreadable, the
 * ones after it cannot be trusted to mean what they say, and a store that read past the damage would fold
 * a state that never existed. Dropping the tail leaves the store at a real, earlier moment in time - and
 * anything genuinely lost that way reappears as an open crash window for the reconciler to classify.
 */
export function readJournal(text: string, instance?: string): IJournalReadResult {
	const records: JournalRecord[] = [];
	const kept: string[] = [];
	// One counter per writer. The log's ORDER is the file's order and stays that way; what is per-instance is
	// only each writer's own numbering, which is the thing a second window cannot coordinate with.
	const seqByInstance = new Map<string, number>();
	let foreign = 0;
	// A well-formed journal always ends in a newline, so the final split element is an empty string. Dropping
	// the last element unconditionally therefore discards either that empty string or a record whose write
	// never finished - and the torn one is discarded even in the rare case where it happens to be complete
	// except for its newline, because appending after it would splice two records into one unreadable line.
	const parts = text.length ? text.split('\n') : [];
	const complete = parts.slice(0, -1);
	let truncated = text.length && !text.endsWith('\n') ? 1 : 0;
	for (const line of complete) {
		const record = parseFramed(line);
		const writer = record?.instance ?? '';
		if (!record || record.seq !== (seqByInstance.get(writer) ?? 0) + 1) {
			truncated += complete.length - kept.length;
			break;
		}
		seqByInstance.set(writer, record.seq);
		if (instance !== undefined && writer !== '' && writer !== instance) { foreign++; }
		records.push(record);
		kept.push(line);
	}
	return { records, truncated, foreign, healed: kept.length ? `${kept.join('\n')}\n` : '' };
}

/**
 * Why the journal could not do what was asked. Each one is a sentence the UI can say out loud.
 *
 * The two append failures are separate reasons rather than one reason plus a phase field, because the phase
 * IS the difference in meaning: before the mutation, the honest sentence is that nothing was changed; after
 * it, that sentence is false about the user's own writing. A caller that cannot tell them apart will
 * eventually say the wrong one, so the type does not let it hold an undifferentiated "append failed".
 */
export type JournalFailure =
	/** The append did not reach the disk BEFORE any mutation: out of space, read-only, permissions. */
	| 'append-failed'
	/** The append did not reach the disk AFTER the document was written. The document HAS changed. */
	| 'append-failed-after-write'
	/** A post-mutation append failed earlier; new intents are refused until that append lands. */
	| 'frozen'
	/** The store directory exists but its journal does not - the record of past decisions is missing. */
	| 'journal-missing';

/** A refusal from the journal: the machine-readable reason plus the words the surface can show. */
export interface IJournalError {
	readonly ok: false;
	readonly reason: JournalFailure;
	readonly message: string;
}

/** The append landed and is durable. `record` is what was written, stamped with its place in the log. */
export interface IJournalOk {
	readonly ok: true;
	readonly record: JournalRecord;
}

export type JournalResult = IJournalOk | IJournalError;

/** A retry that had nothing outstanding to retry: the journal was never frozen. */
export interface IJournalNothingPending {
	readonly ok: true;
	readonly record: undefined;
}

/** The journal was read: its records, and how many unreadable trailing ones had to be dropped. */
export interface IJournalLoaded {
	readonly ok: true;
	readonly records: readonly JournalRecord[];
	readonly truncated: number;
	/** How many of those records another window wrote. See {@link IJournalReadResult.foreign}. */
	readonly foreign: number;
}

/**
 * The plain-words sentence for a journal refusal. The first one is the copy docs/30 names explicitly: the
 * user must be told that their approval was not recorded AND that their documents were therefore not
 * touched, because "the save failed" alone leaves them unable to tell what state their writing is in.
 */
export function describeJournalFailure(reason: JournalFailure): string {
	switch (reason) {
		case 'append-failed':
			return localize('livingDocs.journal.appendFailed', "Couldn't record this approval, so nothing was changed.");
		case 'append-failed-after-write':
			// Never the sentence above. The document HAS been changed, and telling someone their writing is
			// untouched when it is not is the same betrayal as issue #329 with the sign flipped.
			return localize('livingDocs.journal.appendFailedAfterWrite', "This change was written to your document, but recording it failed - so nothing else will be changed until it can be recorded.");
		case 'frozen':
			return localize('livingDocs.journal.frozen', "An earlier change could not be recorded, so no new changes can be made until that is sorted out.");
		case 'journal-missing':
			return localize('livingDocs.journal.missing', "The record of this project's changes could not be found.");
	}
}

function journalError(reason: JournalFailure): IJournalError {
	return { ok: false, reason, message: describeJournalFailure(reason) };
}

/**
 * The append-only journal for one project.
 *
 * It owns exactly two responsibilities: assigning every record its place in the log, and knowing when the
 * log has stopped being trustworthy. The second one is the freeze: if an append fails AFTER a document has
 * already been mutated, the disk and the record of the disk have diverged, and the only safe thing to do is
 * stop accepting new intents until the record catches up. Continuing would pile unrecorded mutations on top
 * of an unrecorded mutation, and no reconciler can unpick that.
 */
export class ChangeJournal {

	private _seq = 0;
	private _frozen = false;
	private _pending: JournalRecord | undefined;

	/**
	 * The tail of the append chain. Every append waits for the previous one before it reads `_seq`, so a
	 * sequence number is claimed and written in one uninterrupted step.
	 *
	 * Without this, two appends in flight at once both read `_seq` as `n` and both write themselves as `n + 1`.
	 * The file then holds two records claiming the same place in the log, `readJournal`'s contiguity check
	 * (correctly) refuses to trust anything past the collision, and every record after it is discarded on the
	 * next load - including the commits and resolutions that prove what happened to a document. The journal
	 * cannot be the authority on the order things happened in if it cannot order its own writes.
	 */
	private _tail: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly _fs: IChangeStoreFileSystem,
		/** The project's `.abstract` home; the store lives in `<home>/changes/`. */
		private readonly _home: string,
		private readonly _now: () => number,
		/** This window's identity in the log. Injected so a test can stage two writers deterministically. */
		private readonly _instance: string = generateUuid(),
	) { }

	/** The directory holding the journal and its derived views. */
	get dir(): string {
		return `${this._home}/${CHANGES_DIR}`;
	}

	get path(): string {
		return `${this.dir}/${JOURNAL_FILE}`;
	}

	get snapshotPath(): string {
		return `${this.dir}/${SNAPSHOT_FILE}`;
	}

	/**
	 * True when a post-mutation append failed and has not since succeeded. While frozen, the store refuses
	 * every new intent (docs/30 section 5).
	 */
	get frozen(): boolean {
		return this._frozen;
	}

	/**
	 * Load the journal, healing a torn tail if there is one.
	 *
	 * A missing journal beside an existing derived view is reported rather than treated as an empty project:
	 * silently starting fresh would forget every decision the user has already made, and forgetting is not a
	 * state the store is allowed to enter quietly.
	 */
	async load(): Promise<IJournalLoaded | IJournalError> {
		const text = await this._fs.read(this.path);
		if (text === undefined) {
			const siblings = await this._fs.list(this.dir);
			if (siblings.length > 0) {
				return journalError('journal-missing');
			}
			this._seq = 0;
			return { ok: true, records: [], truncated: 0, foreign: 0 };
		}
		const result = readJournal(text, this._instance);
		if (result.truncated > 0) {
			await this._fs.replace(this.path, result.healed);
		}
		// This window numbers only its OWN records, and on a journal it has not written to before that starts
		// at zero however many records are already in the file.
		this._seq = result.records.reduce((highest, r) => (r.instance === this._instance ? Math.max(highest, r.seq) : highest), 0);
		return { ok: true, records: result.records, truncated: result.truncated, foreign: result.foreign };
	}

	/**
	 * Append a record and wait for it to be durable.
	 *
	 * `phase` decides what a failure MEANS, which is why the caller has to say it out loud. A `pre-mutation`
	 * failure is clean: nothing has happened yet, so the intent simply does not proceed and the user is told
	 * their approval was not recorded. A `post-mutation` failure is not clean: the document has already
	 * changed, so the journal freezes and the store stops taking new intents until the record catches up.
	 */
	append(entry: JournalEntry, phase: 'pre-mutation' | 'post-mutation'): Promise<JournalResult> {
		return this._serialised(async () => {
			if (this._frozen && phase === 'pre-mutation') {
				return journalError('frozen');
			}
			const record: JournalRecord = { ...entry, seq: this._seq + 1, instance: this._instance, at: this._now() };
			try {
				await this._fs.append(this.path, frameRecord(record));
			} catch {
				if (phase === 'post-mutation') {
					this._frozen = true;
					this._pending = record;
					return journalError('append-failed-after-write');
				}
				return journalError('append-failed');
			}
			this._seq = record.seq;
			return { ok: true, record };
		});
	}

	/**
	 * Retry the append that froze the journal, returning the record it landed so the caller can absorb it into
	 * its own state. The freeze lifts only when an append actually succeeds - the one condition docs/30 sets -
	 * so a caller cannot clear it by asserting that things are fine now.
	 */
	retryFrozenAppend(): Promise<IJournalOk | IJournalNothingPending | IJournalError> {
		return this._serialised(async () => {
			if (!this._frozen || !this._pending) {
				return { ok: true, record: undefined };
			}
			const record: JournalRecord = { ...this._pending, seq: this._seq + 1 };
			try {
				await this._fs.append(this.path, frameRecord(record));
			} catch {
				return journalError('append-failed-after-write');
			}
			this._seq = record.seq;
			this._frozen = false;
			this._pending = undefined;
			return { ok: true, record };
		});
	}

	/** Rewrite a derived view. Derived views are rebuilt idempotently from the fold, never edited in place. */
	async writeDerivedView(text: string): Promise<void> {
		try {
			await this._fs.replace(this.snapshotPath, text);
		} catch {
			// A derived view is a convenience, not a fact: the journal remains the authority and the next
			// rebuild will overwrite whatever is there. Failing the user's approval over it would be absurd.
		}
	}

	/**
	 * Run `operation` after every operation queued before it, whatever became of them. Failures do not break
	 * the chain: an append that could not reach the disk must not stop the retry that repairs it from running.
	 */
	private _serialised<T>(operation: () => Promise<T>): Promise<T> {
		const run = this._tail.then(operation, operation);
		this._tail = run.then(() => undefined, () => undefined);
		return run;
	}
}
