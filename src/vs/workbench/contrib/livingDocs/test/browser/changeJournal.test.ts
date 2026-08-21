/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChangeJournal, frameRecord, readJournal } from '../../common/changeJournal.js';
import { FakeChangeFileSystem, fakeClock } from './changeStoreFakes.js';

// The append-only journal (docs/30 section 5). Two properties are load-bearing and both are adversarial:
// a torn append must be detectable and survivable, and an append that fails AFTER a document has already
// been mutated must stop the store rather than being retried into a deeper mess.

const HOME = 'file:///ws/.abstract';

function journal(fs: FakeChangeFileSystem): ChangeJournal {
	return new ChangeJournal(fs, HOME, fakeClock());
}

suite('livingDocs changeJournal (docs/30 section 5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('recovery truncates a torn tail and the journal stays usable afterwards', async () => {
		const fs = new FakeChangeFileSystem();
		const first = journal(fs);
		await first.load();
		await first.append({ kind: 'supersede', changeId: 'c1', supersededBy: 'c2' }, 'pre-mutation');
		await first.append({ kind: 'supersede', changeId: 'c3', supersededBy: 'c4' }, 'pre-mutation');
		// The machine dies part-way through the third append: the bytes that arrived are a prefix of a record
		// and there is no closing newline. Read back as-is they would parse as plausible nonsense.
		const torn = frameRecord({ kind: 'supersede', changeId: 'c5', supersededBy: 'c6', seq: 3, at: 3 }).slice(0, 40);
		fs.files.set(first.path, fs.files.get(first.path)! + torn);

		const recovered = journal(fs);
		const loaded = await recovered.load();
		assert.ok(loaded.ok);
		await recovered.append({ kind: 'supersede', changeId: 'c7', supersededBy: 'c8' }, 'pre-mutation');
		const reread = readJournal(fs.files.get(recovered.path)!);

		assert.deepStrictEqual(
			{
				truncatedOnLoad: loaded.truncated,
				keptOnLoad: loaded.records.map(r => r.seq),
				afterFurtherAppend: reread.records.map(r => ({ seq: r.seq, kind: r.kind })),
				stillTorn: reread.truncated,
			},
			{
				truncatedOnLoad: 1,
				keptOnLoad: [1, 2],
				afterFurtherAppend: [{ seq: 1, kind: 'supersede' }, { seq: 2, kind: 'supersede' }, { seq: 3, kind: 'supersede' }],
				stillTorn: 0,
			},
		);
	});

	test('a corrupted record and everything after it is dropped: the log stops being trusted where it stops making sense', () => {
		const clean = [1, 2, 3].map(seq => frameRecord({ kind: 'supersede', changeId: `c${seq}`, supersededBy: 'x', seq, at: seq })).join('');
		// Flip a character inside the SECOND record's payload. Its length still matches; only the checksum
		// catches it, which is exactly why the frame carries both.
		const corrupted = clean.replace('"changeId":"c2"', '"changeId":"cX"');
		assert.deepStrictEqual(
			{ records: readJournal(corrupted).records.map(r => r.seq), truncated: readJournal(corrupted).truncated },
			{ records: [1], truncated: 2 },
		);
	});

	test('a pre-mutation append failure is clean, a post-mutation one freezes, and only a real append lifts the freeze', async () => {
		const fs = new FakeChangeFileSystem();
		const log = journal(fs);
		await log.load();
		fs.failAppendWhen = () => true;

		const preMutation = await log.append({ kind: 'supersede', changeId: 'c1', supersededBy: 'c2' }, 'pre-mutation');
		const frozenByNothing = log.frozen;
		await log.append({ kind: 'doc-commit', intentId: 'i1', docUri: 'file:///ws/a.md', postHash: 'h' }, 'post-mutation');
		const frozenAfterMutation = log.frozen;
		const refusedWhileFrozen = await log.append({ kind: 'supersede', changeId: 'c3', supersededBy: 'c4' }, 'pre-mutation');
		const retryWhileStillFailing = await log.retryFrozenAppend();
		const stillFrozenAfterFailedRetry = log.frozen;
		fs.failAppendWhen = undefined;
		const retryOnceDiskIsBack = await log.retryFrozenAppend();

		assert.deepStrictEqual(
			{
				preMutation,
				frozenByNothing,
				frozenAfterMutation,
				refusedWhileFrozen,
				retryWhileStillFailing: retryWhileStillFailing.ok,
				stillFrozenAfterFailedRetry,
				retryOnceDiskIsBack: retryOnceDiskIsBack.ok,
				frozenAtTheEnd: log.frozen,
				recordedAtTheEnd: readJournal(fs.files.get(log.path) ?? '').records.map(r => r.kind),
			},
			{
				preMutation: { ok: false, reason: 'append-failed', message: 'Couldn\'t record this approval, so nothing was changed.' },
				frozenByNothing: false,
				frozenAfterMutation: true,
				refusedWhileFrozen: { ok: false, reason: 'frozen', message: 'An earlier change could not be recorded, so no new changes can be made until that is sorted out.' },
				retryWhileStillFailing: false,
				stillFrozenAfterFailedRetry: true,
				retryOnceDiskIsBack: true,
				frozenAtTheEnd: false,
				recordedAtTheEnd: ['doc-commit'],
			},
		);
	});

	test('concurrent appends claim distinct, contiguous sequence numbers instead of colliding on one', async () => {
		// A sequence number read before an await and written after it is claimed by everything in flight at
		// once. The file then holds several records swearing they are the same entry in the log, and
		// `readJournal` - rightly - stops trusting everything past the collision, discarding the very commits
		// and resolutions that prove what happened to a document. The journal cannot be the authority on the
		// order things happened in if it cannot order its own writes.
		const fs = new FakeChangeFileSystem();
		const log = journal(fs);
		await log.load();
		await Promise.all([1, 2, 3, 4, 5].map(n => log.append({ kind: 'supersede', changeId: `c${n}`, supersededBy: 'x' }, 'pre-mutation')));
		const reread = readJournal(fs.files.get(log.path)!);

		assert.deepStrictEqual(
			{ seqs: reread.records.map(r => r.seq), truncated: reread.truncated },
			{ seqs: [1, 2, 3, 4, 5], truncated: 0 },
		);
	});

	test('a store directory with no journal is reported, never mistaken for a project that has never had changes', async () => {
		// Silently starting empty would forget every decision the user has already made. Forgetting is not a
		// state the store is allowed to enter quietly.
		const fs = new FakeChangeFileSystem();
		const log = journal(fs);
		fs.files.set(log.snapshotPath, '{"version":1,"changes":[]}');
		assert.deepStrictEqual(await log.load(), { ok: false, reason: 'journal-missing', message: 'The record of this project\'s changes could not be found.' });
	});
});
