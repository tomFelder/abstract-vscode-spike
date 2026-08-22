/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readJournal } from '../../common/changeJournal.js';
import { describeChangeStatus, hashContent, IChange } from '../../common/changeRecord.js';
import { ChangeStore } from '../../common/changeStore.js';
import { anchorAt, FakeChangeDocuments, FakeChangeFileSystem, fakeClock, fakeIds } from './changeStoreFakes.js';

// The change store's adversarial suite (docs/30 section 6, store tier). Every test below is written from a
// failure the product has actually had or a crash window the architecture must survive:
//
//   #329  a document mutated after a proposal must never end up with a standing `approved` record.
//   #334  a bulk verb must act on the ids it confirmed, and never on ones queued while the user was reading.
//   disk full - an approval that cannot be recorded must change nothing, and say so in words.
//   the crash window - a machine that dies between the write and the record of it, in every branch.

const HOME = 'file:///ws/.abstract';
const A = 'file:///ws/a.md';
const B = 'file:///ws/b.md';
const BASE = 'Alpha.\nBeta.\nGamma.\n';

interface IStage {
	readonly fs: FakeChangeFileSystem;
	readonly docs: FakeChangeDocuments;
	readonly store: ChangeStore;
}

function stage(seed: readonly [string, string][] = [[A, BASE]]): IStage {
	const fs = new FakeChangeFileSystem();
	const docs = new FakeChangeDocuments();
	for (const [uri, text] of seed) { docs.docs.set(uri, text); }
	return { fs, docs, store: new ChangeStore(fs, docs, HOME, fakeClock(), fakeIds()) };
}

/** Re-open the same project in a fresh store, exactly as a restart would. */
function reopen(from: IStage): ChangeStore {
	return new ChangeStore(from.fs, from.docs, HOME, fakeClock(), fakeIds());
}

async function proposeEdit({ store, docs }: IStage, docUri: string, oldText: string, newText: string): Promise<string> {
	const anchor = anchorAt(docs, docUri, oldText, newText);
	const receipts = await store.propose({
		setId: 'set-1',
		changes: [{ anchors: [anchor], kind: 'figure', baseLength: (docs.docs.get(docUri) ?? '').length }],
	});
	return receipts.receipts[0].changeId;
}

/** The store's own state, folded the one way every surface must fold it. */
function fold(store: ChangeStore): { readonly open: number; readonly statuses: readonly string[] } {
	return { open: store.openChanges().length, statuses: store.allChanges().map(c => c.status) };
}

/** A record the store's own types cannot express, framed exactly as the journal frames its own. */
interface IForgedRecord {
	readonly seq: number;
	readonly at: number;
	readonly kind: string;
	readonly changeId?: string;
	readonly reason?: string;
}

function forgedLine(record: IForgedRecord): string {
	const payload = JSON.stringify(record);
	return `${hashContent(payload)} ${payload.length} ${payload}\n`;
}

suite('livingDocs changeStore (docs/30 section 5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the happy path journals J1 -> M -> J2 -> J3 in order, and the derived view is exactly the fold', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const report = await it.store.approveByIds([changeId]);
		const records = readJournal(it.fs.files.get(`${HOME}/changes/journal.log`)!).records;
		const derived = JSON.parse(it.fs.files.get(`${HOME}/changes/changes.json`)!) as { version: number; changes: IChange[] };

		assert.deepStrictEqual(
			{
				journal: records.map(r => r.kind),
				snapshotTakenBeforeTheIntent: it.docs.snapshots,
				doc: it.docs.docs.get(A),
				resolved: report.resolved,
				derivedMatchesFold: JSON.stringify(derived.changes) === JSON.stringify(it.store.allChanges()),
			},
			{
				journal: ['propose', 'intent', 'doc-commit', 'resolution'],
				snapshotTakenBeforeTheIntent: [A],
				doc: 'Alpha.\nBETA!\nGamma.\n',
				resolved: [{ changeId: 'id-1', status: 'approved', anchorOutcomes: [{ docUri: A, landed: true, postHash: hashContent('Alpha.\nBETA!\nGamma.\n') }] }],
				derivedMatchesFold: true,
			},
		);
	});

	test('disk full at J1 fails CLOSED: no document is touched, and the refusal says so in the words the user reads', async () => {
		// The intent record is the last reversible moment. If it cannot be made durable, the approval simply
		// does not happen - and the sentence the user is shown is true of their documents, not just of the log.
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		it.fs.failAppendWhen = (_path, text) => text.includes('"kind":"intent"');
		const report = await it.store.approveByIds([changeId]);

		assert.deepStrictEqual(
			{
				failure: report.failure,
				resolved: report.resolved,
				writes: it.docs.writes,
				doc: it.docs.docs.get(A),
				status: it.store.change(changeId)!.status,
			},
			{
				failure: { ok: false, reason: 'append-failed', message: 'Couldn\'t record this approval, so nothing was changed.' },
				resolved: [],
				writes: [],
				doc: BASE,
				status: 'pending',
			},
		);
	});

	test('#329: a document edited under a proposal flips it to needs-attention - unchanged file, no approved record', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const edited = 'Alpha.\nBeta, as amended by hand.\nGamma.\n';
		it.docs.docs.set(A, edited);
		const report = await it.store.approveByIds([changeId]);
		const change = it.store.change(changeId)!;

		assert.deepStrictEqual(
			{
				skipped: report.skipped,
				resolved: report.resolved,
				writes: it.docs.writes,
				doc: it.docs.docs.get(A),
				status: change.status,
				reason: change.attentionReason,
			},
			{
				skipped: [{ changeId: 'id-1', reason: 'stale-base' }],
				resolved: [],
				writes: [],
				doc: edited,
				status: 'needs-attention',
				reason: 'stale-base',
			},
		);
	});

	test('#334: the applied set can only shrink from the captured one - work queued while the user reads is never swept', async () => {
		const it = stage();
		await it.store.open();
		const first = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const captured = it.store.captureBulkSet({ verb: 'approve' });
		// The agent queues more work while the confirm dialog is open. The set the user confirmed is a
		// snapshot, so the second change cannot join it however long the dialog stays up.
		const second = await proposeEdit(it, A, 'Gamma.', 'GAMMA!');
		const report = await it.store.approveByIds(captured.ids);

		assert.deepStrictEqual(
			{
				captured: captured.ids,
				applied: report.resolved.map(r => r.changeId),
				secondStillPending: it.store.change(second)!.status,
				doc: it.docs.docs.get(A),
			},
			{ captured: [first], applied: [first], secondStillPending: 'pending', doc: 'Alpha.\nBETA!\nGamma.\n' },
		);
	});

	test('terminal states are immutable: a decided change is skipped by every later verb, before and after a reload', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		await it.store.approveByIds([changeId]);
		const secondApprove = await it.store.approveByIds([changeId]);
		const reject = await it.store.rejectByIds([changeId]);
		const reopened = reopen(it);
		await reopened.open();
		const afterReload = await reopened.approveByIds([changeId]);

		assert.deepStrictEqual(
			{
				secondApprove: secondApprove.skipped,
				reject: reject.skipped,
				afterReload: afterReload.skipped,
				status: reopened.change(changeId)!.status,
				doc: it.docs.docs.get(A),
			},
			{
				secondApprove: [{ changeId: 'id-1', reason: 'already-decided' }],
				reject: [{ changeId: 'id-1', reason: 'already-decided' }],
				afterReload: [{ changeId: 'id-1', reason: 'already-decided' }],
				status: 'approved',
				doc: 'Alpha.\nBETA!\nGamma.\n',
			},
		);
	});

	test('a change under discussion leaves every bulk capture and refuses to be resolved by id', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const before = it.store.captureBulkSet({ verb: 'approve' }).ids;
		await it.store.comment(changeId, 'why this wording?');
		const after = it.store.captureBulkSet({ verb: 'approve' });
		const report = await it.store.approveByIds([changeId]);

		assert.deepStrictEqual(
			{ before, after: after.ids, excluded: after.excluded, skipped: report.skipped, doc: it.docs.docs.get(A) },
			{
				before: ['id-1'],
				after: [],
				excluded: [{ reason: 'in-discussion', count: 1 }],
				skipped: [{ changeId: 'id-1', reason: 'in-discussion' }],
				doc: BASE,
			},
		);
	});

	test('I8: approving one change rebases the others in that document over the store\'s own write, and flags only the overlapping one', async () => {
		// The store knows exactly what it wrote, so moving the remaining proposals is arithmetic, not
		// searching. Without it, accepting the first of five changes would flag the other four - safe and
		// useless. A change that overlaps what was just written cannot be moved and is recorded as needing
		// attention instead, because there is no honest way to apply it over a decision the user has made.
		const it = stage([[A, 'Alpha.\nBeta.\nGamma.\n']]);
		await it.store.open();
		const first = await proposeEdit(it, A, 'Alpha.', 'Alpha, expanded considerably.');
		const later = await proposeEdit(it, A, 'Gamma.', 'GAMMA!');
		const overlapping = await proposeEdit(it, A, 'Alpha.\nBeta.', 'Merged opening.');
		await it.store.approveByIds([first]);
		const rebased = it.store.change(later)!;
		const doc = it.docs.docs.get(A)!;
		const followUp = await it.store.approveByIds([later]);

		assert.deepStrictEqual(
			{
				spanStillPointsAtItsText: doc.slice(rebased.anchors[0].span.start, rebased.anchors[0].span.end),
				baseMovedOnWithTheDocument: rebased.anchors[0].baseRevision === hashContent('Alpha, expanded considerably.\nBeta.\nGamma.\n'),
				overlapping: { status: it.store.change(overlapping)!.status, reason: it.store.change(overlapping)!.attentionReason },
				followUp: followUp.resolved.map(r => r.status),
				doc: it.docs.docs.get(A),
			},
			{
				spanStillPointsAtItsText: 'Gamma.',
				baseMovedOnWithTheDocument: true,
				overlapping: { status: 'needs-attention', reason: 'stale-base' },
				followUp: ['approved'],
				doc: 'Alpha, expanded considerably.\nBeta.\nGAMMA!\n',
			},
		);
	});

	test('a journal failure AFTER the mutation freezes new intents until an append actually succeeds', async () => {
		// The second change is in a DIFFERENT document, so that what the thaw proves is the freeze lifting and
		// nothing else: this change was never touched by the interrupted write.
		const it = stage([[A, BASE], [B, 'Delta.\n']]);
		await it.store.open();
		const first = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const second = await proposeEdit(it, B, 'Delta.', 'DELTA!');
		it.fs.failAppendWhen = (_path, text) => text.includes('"kind":"doc-commit"');
		const frozenRun = await it.store.approveByIds([first]);
		const frozenAfterTheWrite = it.store.frozen;
		const refused = await it.store.approveByIds([second]);
		const writesWhileFrozen = [...it.docs.writes];
		it.fs.failAppendWhen = undefined;
		const retry = await it.store.retryFrozenAppend();
		const afterThaw = await it.store.approveByIds([second]);

		assert.deepStrictEqual(
			{
				// F3: the post-mutation refusal must NEVER borrow the fail-closed-at-J1 sentence. The document
				// WAS written; telling the user nothing was changed is issue #329's betrayal with the sign
				// flipped, so the phase is carried as its own reason with its own honest copy.
				frozenRun: frozenRun.failure,
				documentWasActuallyChanged: it.docs.docs.get(A),
				frozenAfterTheWrite,
				newIntentRefused: refused.failure,
				writesWhileFrozen,
				retry,
				thawed: it.store.frozen,
				afterThaw: afterThaw.resolved.map(r => r.status),
			},
			{
				frozenRun: {
					ok: false,
					reason: 'append-failed-after-write',
					message: 'This change was written to your document, but recording it failed - so nothing else will be changed until it can be recorded.',
				},
				documentWasActuallyChanged: 'Alpha.\nBETA!\nGamma.\n',
				frozenAfterTheWrite: true,
				newIntentRefused: { ok: false, reason: 'frozen', message: 'An earlier change could not be recorded, so no new changes can be made until that is sorted out.' },
				writesWhileFrozen: [A],
				retry: { ok: true },
				thawed: false,
				afterThaw: ['approved'],
			},
		);
	});

	test('a torn journal tail is healed on open and the decisions that survived it stay decided', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		await it.store.approveByIds([changeId]);
		const path = `${HOME}/changes/journal.log`;
		// The process died part-way through writing a further record.
		it.fs.files.set(path, `${it.fs.files.get(path)!}0000 999 {"kind":"prop`);
		const reopened = reopen(it);
		const report = await reopened.open();

		assert.deepStrictEqual(
			{ truncated: report.truncated, recovered: report.recovered, fold: fold(reopened), stillTorn: readJournal(it.fs.files.get(path)!).truncated },
			{ truncated: 1, recovered: [], fold: { open: 0, statuses: ['approved'] }, stillTorn: 0 },
		);
	});

	test('a multi-anchor move interrupted between its two writes reconciles to partially-applied, per anchor, with no auto-retry', async () => {
		// The insert side is written first, so the interrupted state is text in BOTH documents. The reconciler
		// proves that from the post-hash declared before the write, and then does nothing about it: retrying a
		// write at startup is how a recovery becomes a second, unasked-for edit.
		const it = stage([[A, 'The moved paragraph.\nStay here.\n'], [B, 'Destination.\n']]);
		await it.store.open();
		const receipts = await it.store.propose({
			setId: 'set-1',
			changes: [{
				anchors: [
					anchorAt(it.docs, B, 'Destination.', 'Destination.\nThe moved paragraph.'),
					anchorAt(it.docs, A, 'The moved paragraph.\n', ''),
				],
				kind: 'meaning',
				baseLength: 200,
			}],
		});
		const changeId = receipts.receipts[0].changeId;
		it.fs.failAppendWhen = (_path, text) => text.includes('"kind":"doc-commit"');
		await it.store.approveByIds([changeId]);
		const writesBeforeRestart = [...it.docs.writes];

		it.fs.failAppendWhen = undefined;
		const reopened = reopen(it);
		const report = await reopened.open();

		assert.deepStrictEqual(
			{
				writesBeforeRestart,
				docsAfterTheCrash: { a: it.docs.docs.get(A), b: it.docs.docs.get(B) },
				recovered: report.recovered,
				noAutoRetry: it.docs.writes.length === writesBeforeRestart.length,
			},
			{
				writesBeforeRestart: [B],
				docsAfterTheCrash: { a: 'The moved paragraph.\nStay here.\n', b: 'Destination.\nThe moved paragraph.\n' },
				recovered: [{
					changeId: 'id-1',
					status: 'partially-applied',
					anchorOutcomes: [
						{ docUri: B, landed: true, postHash: hashContent('Destination.\nThe moved paragraph.\n') },
						{ docUri: A, landed: false, reason: 'not-attempted' },
					],
				}],
				noAutoRetry: true,
			},
		);
	});

	test('an external edit inside the crash window flips the same move to unverified and still refuses to retry', async () => {
		const it = stage([[A, 'The moved paragraph.\nStay here.\n'], [B, 'Destination.\n']]);
		await it.store.open();
		const receipts = await it.store.propose({
			setId: 'set-1',
			changes: [{
				anchors: [
					anchorAt(it.docs, B, 'Destination.', 'Destination.\nThe moved paragraph.'),
					anchorAt(it.docs, A, 'The moved paragraph.\n', ''),
				],
				kind: 'meaning',
				baseLength: 200,
			}],
		});
		it.fs.failAppendWhen = (_path, text) => text.includes('"kind":"doc-commit"');
		await it.store.approveByIds([receipts.receipts[0].changeId]);
		const writesBeforeRestart = it.docs.writes.length;
		// Someone opens the document in another editor and types into it before the app comes back up.
		it.docs.docs.set(A, 'Someone else was here.\nStay here.\n');

		it.fs.failAppendWhen = undefined;
		const reopened = reopen(it);
		const report = await reopened.open();

		assert.deepStrictEqual(
			{
				status: report.recovered.map(r => r.status),
				anchorA: report.recovered[0].anchorOutcomes[1],
				noAutoRetry: it.docs.writes.length === writesBeforeRestart,
				docA: it.docs.docs.get(A),
			},
			{
				status: ['unverified'],
				anchorA: { docUri: A, landed: false, reason: 'unverified' },
				noAutoRetry: true,
				docA: 'Someone else was here.\nStay here.\n',
			},
		);
	});

	test('an amend stacks a version on the same id and keeps the thread; a supersede retires it without deciding it', async () => {
		const it = stage();
		await it.store.open();
		const first = await proposeEdit(it, A, 'Beta.', 'BETA!');
		await it.store.comment(first, 'too shouty');
		await it.store.amend(first, [anchorAt(it.docs, A, 'Beta.', 'Beta, revised.')], 'toned it down');
		const amended = it.store.change(first)!;
		const replacement = await it.store.propose({
			setId: 'set-2',
			changes: [{ anchors: [anchorAt(it.docs, A, 'Beta.', 'Beta, again.')], kind: 'figure', baseLength: BASE.length, supersedes: first }],
		});

		assert.deepStrictEqual(
			{
				versions: amended.versions.map(v => ({ revision: v.revision, newText: v.anchors[0].newText })),
				threadSurvived: amended.thread.map(t => t.text),
				statusAfterAmend: amended.status,
				supersededBy: it.store.change(first)!.supersededBy,
				openAfterSupersede: it.store.openChanges().map(c => c.id),
			},
			{
				versions: [{ revision: 1, newText: 'BETA!' }, { revision: 2, newText: 'Beta, revised.' }],
				threadSurvived: ['too shouty'],
				statusAfterAmend: 'pending',
				supersededBy: replacement.receipts[0].changeId,
				openAfterSupersede: [replacement.receipts[0].changeId],
			},
		);
	});

	// --- concurrency: the write boundary must judge validity ATOMICALLY with admission (invariant I8) ---
	//
	// Admission ("is this change still valid against the document?") and the write it authorises are separated
	// by many awaits: reading documents, taking snapshots, appending J1. Left unserialised, two approves both
	// pass admission against the same base, both splice from it, and both write - one edit is lost while both
	// are recorded `approved`, which is issue #329's family reintroduced by way of concurrency, inside the
	// module built to make it impossible. These three tests are that reproduction, now closed.

	test('two overlapping approves in one document are serialised: both edits land, and the journal stays wholly readable', async () => {
		const it = stage();
		await it.store.open();
		const first = await proposeEdit(it, A, 'Alpha.', 'Alpha, at a different length.');
		const second = await proposeEdit(it, A, 'Gamma.', 'GAMMA!');
		const [a, b] = await Promise.all([it.store.approveByIds([first]), it.store.approveByIds([second])]);
		const journal = readJournal(it.fs.files.get(`${HOME}/changes/journal.log`)!);

		assert.deepStrictEqual(
			{
				statuses: [...a.resolved, ...b.resolved].map(r => r.status),
				// Neither edit is lost: the first approve's write is still there under the second's.
				doc: it.docs.docs.get(A),
				// A colliding `seq` would make `readJournal` discard everything after the collision.
				truncated: journal.truncated,
				sequence: journal.records.map(r => r.seq),
				fold: fold(it.store),
			},
			{
				statuses: ['approved', 'approved'],
				doc: 'Alpha, at a different length.\nBeta.\nGAMMA!\n',
				truncated: 0,
				sequence: [1, 2, 3, 4, 5, 6, 7, 8, 9],
				fold: { open: 0, statuses: ['approved', 'approved'] },
			},
		);
	});

	test('two concurrent approves of the SAME id write the document once; the loser is skipped as already-decided', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const [a, b] = await Promise.all([it.store.approveByIds([changeId]), it.store.approveByIds([changeId])]);

		assert.deepStrictEqual(
			{
				resolved: [...a.resolved, ...b.resolved].map(r => r.status),
				skipped: [...a.skipped, ...b.skipped],
				writes: it.docs.writes,
				snapshots: it.docs.snapshots,
				doc: it.docs.docs.get(A),
			},
			{
				resolved: ['approved'],
				skipped: [{ changeId: 'id-1', reason: 'already-decided' }],
				writes: [A],
				snapshots: [A],
				doc: 'Alpha.\nBETA!\nGamma.\n',
			},
		);
	});

	test('an amend racing an approve cannot leave a decided change whose anchors were never written', async () => {
		// The queue makes the outcome an ORDER rather than a race: the approve was asked for first, so it wins,
		// and the amend is refused for the same reason every other verb is refused against a terminal change.
		// What must never happen is the amend landing after the resolution and leaving `anchors` describing
		// text that is not in the document - an audit trail that disagrees with the disk.
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const revised = anchorAt(it.docs, A, 'Beta.', 'Beta, revised.');
		const [approve, amend, comment] = await Promise.all([
			it.store.approveByIds([changeId]),
			it.store.amend(changeId, [revised]),
			it.store.comment(changeId, 'hold on'),
		]);
		const change = it.store.change(changeId)!;

		assert.deepStrictEqual(
			{
				approved: approve.resolved.map(r => r.status),
				amend,
				comment,
				versions: change.versions.length,
				threadStaysEmpty: change.thread.length,
				anchorsDescribeWhatIsOnDisk: it.docs.docs.get(A)!.includes(change.anchors[0].newText),
				doc: it.docs.docs.get(A),
			},
			{
				approved: ['approved'],
				amend: { ok: false, reason: 'already-decided', message: 'This change could not be updated - you have already decided it.' },
				comment: { ok: false, reason: 'already-decided', message: 'This change could not be updated - you have already decided it.' },
				versions: 1,
				threadStaysEmpty: 0,
				anchorsDescribeWhatIsOnDisk: true,
				doc: 'Alpha.\nBETA!\nGamma.\n',
			},
		);
	});

	test('I6: the post-condition is proved by reading the document BACK, so a store that normalises on write cannot mint a false approved', async () => {
		// The exact class R6 will be backed by - a serialiser that re-emits a parsed document is entitled to
		// change bytes on the way out. Restating the intended text as the post-hash would produce a durable
		// `approved` whose hash matches nothing on disk, and the reconciler could never catch it either,
		// because it believes a J2 commit outright. So there is no J2: the absence of a commit is the honest
		// record, and it leaves the disk matching neither the base nor the expectation on any later recovery.
		const it = stage();
		await it.store.open();
		it.docs.normaliseOnWrite = text => text.replace(/\n+$/, '');
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const report = await it.store.approveByIds([changeId]);
		const journal = readJournal(it.fs.files.get(`${HOME}/changes/journal.log`)!);
		const reopened = reopen(it);
		await reopened.open();

		assert.deepStrictEqual(
			{
				status: report.resolved.map(r => r.status),
				anchorOutcomes: report.resolved[0].anchorOutcomes,
				noCommitWasWritten: journal.records.map(r => r.kind),
				textOnDisk: it.docs.docs.get(A),
				survivesAReload: reopened.change(changeId)!.status,
			},
			{
				status: ['unverified'],
				anchorOutcomes: [{ docUri: A, landed: false, reason: 'unverified' }],
				noCommitWasWritten: ['propose', 'intent', 'resolution'],
				textOnDisk: 'Alpha.\nBETA!\nGamma.',
				survivesAReload: 'unverified',
			},
		);
	});

	test('I6: a write that lands the approved hunk AND alters prose nobody approved is unverified, with no approved record', async () => {
		// The other half of the class above, and the one the differ-backed post-check exists for. Here the
		// write does everything it was asked to and something else besides - the shape a lossy or stale write
		// path produces. There is no approved record, the change stays the reviewer's call, and the status it
		// carries is a sentence rather than a log line.
		const it = stage([[A, 'Alpha.\n\nBeta.\n\nGamma.\n']]);
		await it.store.open();
		it.docs.normaliseOnWrite = text => text.replace('Gamma.', 'Something else entirely.');
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const report = await it.store.approveByIds([changeId]);
		const reopened = reopen(it);
		await reopened.open();

		assert.deepStrictEqual(
			{
				status: report.resolved.map(r => r.status),
				anchorOutcomes: report.resolved[0].anchorOutcomes,
				stillOpenAfterAReload: reopened.openChanges().map(c => c.id),
				noApprovedRecordAnywhere: reopened.allChanges().every(c => c.status !== 'approved'),
				userVisible: describeChangeStatus(reopened.change(changeId)!.status),
			},
			{
				status: ['unverified'],
				anchorOutcomes: [{ docUri: A, landed: false, reason: 'unverified' }],
				stillOpenAfterAReload: [changeId],
				noApprovedRecordAnywhere: true,
				userVisible: 'This change cannot be verified - the document does not match what was expected, so nothing was retried',
			},
		);
	});

	test('F4: a retry that lands the frozen record folds it, so no decided change is offered again for the rest of the session', async () => {
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		it.fs.failAppendWhen = (_path, text) => text.includes('"kind":"resolution"');
		await it.store.approveByIds([changeId]);
		const beforeRetry = { status: it.store.change(changeId)!.status, offered: it.store.captureBulkSet({ verb: 'approve' }).ids };
		it.fs.failAppendWhen = undefined;
		const retry = await it.store.retryFrozenAppend();

		assert.deepStrictEqual(
			{
				beforeRetry,
				retry,
				status: it.store.change(changeId)!.status,
				stillOffered: it.store.captureBulkSet({ verb: 'approve' }).ids,
				writesAfterRetry: it.docs.writes,
				agreesWithAReload: await (async () => { const r = reopen(it); await r.open(); return r.change(changeId)!.status; })(),
			},
			{
				beforeRetry: { status: 'pending', offered: ['id-1'] },
				retry: { ok: true },
				status: 'approved',
				stillOffered: [],
				writesAfterRetry: [A],
				agreesWithAReload: 'approved',
			},
		);
	});

	test('a readable record the store cannot make sense of is COUNTED, not passed over, and the records after it still fold', async () => {
		// A store whose thesis is "no silent drops" does not get to make an exception for its own log. An
		// unrecognised kind (a newer version, or a hand edit) and a record naming a change that is not in the
		// log are both quarantined rather than folded away to nothing.
		const it = stage();
		await it.store.open();
		const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
		const path = `${HOME}/changes/journal.log`;
		it.fs.files.set(path, it.fs.files.get(path)!
			+ forgedLine({ seq: 2, at: 2, kind: 'invented-by-a-later-version' })
			+ forgedLine({ seq: 3, at: 3, kind: 'attention', changeId: 'a-change-that-does-not-exist', reason: 'stale-base' })
			+ forgedLine({ seq: 4, at: 4, kind: 'attention', changeId, reason: 'human-edit' }));
		const reopened = reopen(it);
		const report = await reopened.open();

		assert.deepStrictEqual(
			{
				truncated: report.truncated,
				quarantined: report.quarantined,
				laterRecordStillFolded: reopened.change(changeId)!.attentionReason,
				status: reopened.change(changeId)!.status,
			},
			{ truncated: 0, quarantined: 2, laterRecordStillFolded: 'human-edit', status: 'needs-attention' },
		);
	});

	test('every interleaving of propose / edit / verb / reload folds to the same state, and a decided change never resurrects', async () => {
		// Systematically enumerated rather than sampled: three ways the document can move under a proposal,
		// both verbs, with and without a restart in the middle. Each row asserts the two reconciliations that
		// matter - I6 (the document contains exactly the approved hunk and nothing else) and I2 (the status
		// survives a reload, and re-running the same verb over the same captured ids changes nothing).
		const edits = ['none', 'inside', 'elsewhere'] as const;
		const verbs = ['approve', 'reject'] as const;
		const results = [];
		for (const edit of edits) {
			for (const verb of verbs) {
				for (const reload of [false, true]) {
					const it = stage();
					await it.store.open();
					const changeId = await proposeEdit(it, A, 'Beta.', 'BETA!');
					const captured = it.store.captureBulkSet({ verb }).ids;
					if (edit === 'inside') { it.docs.docs.set(A, BASE.replace('Beta.', 'Beta, by hand.')); }
					if (edit === 'elsewhere') { it.docs.docs.set(A, BASE.replace('Gamma.', 'Gamma, by hand.')); }
					await (verb === 'approve' ? it.store.approveByIds(captured) : it.store.rejectByIds(captured));
					const store = reload ? reopen(it) : it.store;
					if (reload) { await store.open(); }
					const again = await (verb === 'approve' ? store.approveByIds(captured) : store.rejectByIds(captured));
					results.push({
						run: `${edit}/${verb}${reload ? '/reload' : ''}`,
						status: store.change(changeId)!.status,
						doc: it.docs.docs.get(A),
						open: store.openChanges().length,
						rerunSkips: again.skipped.map(s => s.reason),
						rerunResolved: again.resolved.length,
					});
				}
			}
		}

		assert.deepStrictEqual(results, [
			{ run: 'none/approve', status: 'approved', doc: 'Alpha.\nBETA!\nGamma.\n', open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'none/approve/reload', status: 'approved', doc: 'Alpha.\nBETA!\nGamma.\n', open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'none/reject', status: 'rejected', doc: BASE, open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'none/reject/reload', status: 'rejected', doc: BASE, open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'inside/approve', status: 'needs-attention', doc: 'Alpha.\nBeta, by hand.\nGamma.\n', open: 1, rerunSkips: ['not-pending'], rerunResolved: 0 },
			{ run: 'inside/approve/reload', status: 'needs-attention', doc: 'Alpha.\nBeta, by hand.\nGamma.\n', open: 1, rerunSkips: ['not-pending'], rerunResolved: 0 },
			{ run: 'inside/reject', status: 'rejected', doc: 'Alpha.\nBeta, by hand.\nGamma.\n', open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'inside/reject/reload', status: 'rejected', doc: 'Alpha.\nBeta, by hand.\nGamma.\n', open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'elsewhere/approve', status: 'needs-attention', doc: 'Alpha.\nBeta.\nGamma, by hand.\n', open: 1, rerunSkips: ['not-pending'], rerunResolved: 0 },
			{ run: 'elsewhere/approve/reload', status: 'needs-attention', doc: 'Alpha.\nBeta.\nGamma, by hand.\n', open: 1, rerunSkips: ['not-pending'], rerunResolved: 0 },
			{ run: 'elsewhere/reject', status: 'rejected', doc: 'Alpha.\nBeta.\nGamma, by hand.\n', open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
			{ run: 'elsewhere/reject/reload', status: 'rejected', doc: 'Alpha.\nBeta.\nGamma, by hand.\n', open: 0, rerunSkips: ['already-decided'], rerunResolved: 0 },
		]);
	});
});
