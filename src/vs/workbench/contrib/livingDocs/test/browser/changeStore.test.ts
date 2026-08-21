/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readJournal } from '../../common/changeJournal.js';
import { hashContent, IChange } from '../../common/changeRecord.js';
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
				frozenRun: frozenRun.failure?.reason,
				frozenAfterTheWrite,
				newIntentRefused: refused.failure,
				writesWhileFrozen,
				retry,
				thawed: it.store.frozen,
				afterThaw: afterThaw.resolved.map(r => r.status),
			},
			{
				frozenRun: 'append-failed',
				frozenAfterTheWrite: true,
				newIntentRefused: { ok: false, reason: 'frozen', message: 'An earlier change could not be recorded, so no new changes can be made until that is sorted out.' },
				writesWhileFrozen: [A],
				retry: undefined,
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
