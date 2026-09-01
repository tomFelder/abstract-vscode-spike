/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { deserialiseTranscripts, ITranscriptInput, serialiseTranscripts, TRANSCRIPT_CONTENT_CAP, TRANSCRIPT_MESSAGE_CAP, TRANSCRIPT_TOTAL_CAP } from '../../common/chatTranscripts.js';
import { IChatMessage } from '../../common/livingDocs.js';

suite('livingDocs - chat transcripts in workspace storage (plan 52 WP-B residuals)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const entry = (id: string, messages: readonly IChatMessage[], droppedBefore = 0): ITranscriptInput => ({ id, messages, droppedBefore });
	const user = (content: string): IChatMessage => ({ role: 'user', content });
	const assistant = (content: string): IChatMessage => ({ role: 'assistant', content, via: 'model' });
	const roundTrip = (entries: readonly ITranscriptInput[]) => deserialiseTranscripts(serialiseTranscripts(entries).raw);

	test('a conversation round-trips, and every restored turn is marked as a record rather than a live reply', () => {
		const restored = roundTrip([entry('s1', [
			{ role: 'user', content: 'Summarise this', mentions: ['metrics.csv'] },
			{ role: 'assistant', content: 'Revenue grew.', via: 'model', proposedIds: ['c1', 'c2'] },
		])]);
		assert.deepStrictEqual(restored.transcripts.get('s1'), [
			{ role: 'user', content: 'Summarise this', restored: true, mentions: ['metrics.csv'] },
			// The live `proposedIds` are NOT stored: pending changes die with the process, so an id would restore
			// as a pointer that leads nowhere. The count survives instead, and the rail speaks it.
			{ role: 'assistant', content: 'Revenue grew.', restored: true, via: 'model', proposedCount: 2 },
		]);
	});

	test('the caps trim the oldest turns, clip an over-long body, and COUNT everything they drop', () => {
		const long = 'x'.repeat(TRANSCRIPT_CONTENT_CAP + 500);
		const many = Array.from({ length: TRANSCRIPT_MESSAGE_CAP + 5 }, (_, i) => user(`m${i}`));
		const written = serialiseTranscripts([entry('s1', many, 3), entry('s2', [assistant(long)])]);
		const restored = deserialiseTranscripts(written.raw);
		const kept = restored.transcripts.get('s1') ?? [];
		const clipped = (restored.transcripts.get('s2') ?? [])[0];
		assert.deepStrictEqual({
			keptCount: kept.length,
			// The END of the conversation survives - the part the reader is actually in.
			first: kept[0]?.content,
			last: kept[kept.length - 1]?.content,
			// 3 already lost in an earlier save + the 5 this save trimmed: the running total never resets.
			dropped: restored.dropped.get('s1'),
			clippedLength: clipped?.content.length,
			clippedMarked: clipped?.clipped,
			// Nothing was lost from the second chat, so it carries no count at all.
			s2Dropped: restored.dropped.has('s2'),
		}, {
			keptCount: TRANSCRIPT_MESSAGE_CAP,
			first: 'm5',
			last: `m${TRANSCRIPT_MESSAGE_CAP + 4}`,
			dropped: 8,
			clippedLength: TRANSCRIPT_CONTENT_CAP,
			clippedMarked: true,
			s2Dropped: false,
		});
	});

	test('the shared budget is spent in the order given, so the chat you are in keeps its history', () => {
		// Two chats at the maximum a single chat can ever store (the message cap x the content cap). Together
		// they are larger than the whole workspace budget, so something has to give - and what gives is decided
		// by the ORDER the caller hands them in. The service hands the ACTIVE chat first, so it survives whole.
		const maxChat = Array.from({ length: TRANSCRIPT_MESSAGE_CAP }, () => assistant('x'.repeat(TRANSCRIPT_CONTENT_CAP)));
		const perChat = TRANSCRIPT_MESSAGE_CAP * TRANSCRIPT_CONTENT_CAP;
		const restored = roundTrip([entry('active', maxChat), entry('older', maxChat)]);
		assert.deepStrictEqual({
			activeKept: (restored.transcripts.get('active') ?? []).length,
			activeDropped: restored.dropped.has('active'),
			// The older chat keeps only what the remaining budget reaches - the END of it - and says how much of
			// it is missing rather than presenting the tail as the whole conversation.
			olderKept: (restored.transcripts.get('older') ?? []).length,
			olderDropped: restored.dropped.get('older'),
		}, {
			activeKept: TRANSCRIPT_MESSAGE_CAP,
			activeDropped: false,
			olderKept: (TRANSCRIPT_TOTAL_CAP - perChat) / TRANSCRIPT_CONTENT_CAP,
			olderDropped: TRANSCRIPT_MESSAGE_CAP - (TRANSCRIPT_TOTAL_CAP - perChat) / TRANSCRIPT_CONTENT_CAP,
		});
	});

	test('saving the same conversation over and over reports the same loss, rather than inflating it', () => {
		// The severe defect of fix round 1 (#312): the writer was fed its own previous ANSWER as its next input,
		// while the in-memory array it measured against was never trimmed. Every save re-added the old total on
		// top of a freshly recomputed one - twice per turn - so a chat that had only ever held 60 messages
		// reported 230 of them lost. Driven here exactly as the service drives it: the same untrimmed array, the
		// same fixed baseline, saved ten times over.
		const messages = Array.from({ length: TRANSCRIPT_MESSAGE_CAP + 20 }, (_, i) => user(`m${i}`));
		const starved = Array.from({ length: TRANSCRIPT_MESSAGE_CAP }, () => assistant('x'.repeat(TRANSCRIPT_CONTENT_CAP)));
		const reports: number[] = [];
		const starvedReports: number[] = [];
		for (let save = 0; save < 10; save++) {
			// Two chats at the per-chat maximum sit between them and eat the workspace budget, so the last chat
			// is starved and stores nothing at all - the case that inflated fastest of the lot.
			const written = serialiseTranscripts([
				entry('trimmed', messages),
				entry('a', starved), entry('b', starved),
				entry('starved', starved),
			]);
			reports.push(written.dropped.get('trimmed') ?? 0);
			starvedReports.push(written.dropped.get('starved') ?? 0);
		}
		assert.deepStrictEqual({
			trimmed: [...new Set(reports)],
			starved: [...new Set(starvedReports)],
			// The baseline a restore read back IS carried - those messages really are gone from the array - it
			// is only the writer's own answer that must never be fed back to it.
			withBaseline: serialiseTranscripts([entry('trimmed', messages, 7)]).dropped.get('trimmed'),
		}, {
			// One value, ten saves: 60 live messages, 40 stored, 20 lost. Not 20, 40, 60, ...
			trimmed: [20],
			// Nothing of this chat fits, so all 40 are lost - and stay 40 however often it is re-starved.
			starved: [TRANSCRIPT_MESSAGE_CAP],
			withBaseline: 27,
		});
	});

	test('a restored turn keeps the facts only its first write knew, however many times it is saved again', () => {
		// D2/D3 of fix round 1 (#312): the writer re-derived both honesty markers from evidence a RESTORED turn
		// no longer carries - a clipped body is now exactly the cap long (not `>` it), and the live change ids
		// died with the process that made them. So one ordinary save in an unrelated chat erased the "this was
		// shortened" warning and the record that the agent had proposed work at all. Two round trips is the
		// smallest reproduction: the first was always fine, the second was where the truth quietly went.
		const first = roundTrip([entry('s1', [
			{ role: 'user', content: 'p'.repeat(TRANSCRIPT_CONTENT_CAP + 250) },
			{ role: 'assistant', content: 'Rewrote it.', via: 'model', proposedIds: ['c1'] },
		])]);
		const second = roundTrip([entry('s1', first.transcripts.get('s1') ?? [])]);
		const third = roundTrip([entry('s1', second.transcripts.get('s1') ?? [])]);
		assert.deepStrictEqual(third.transcripts.get('s1'), [
			{ role: 'user', content: 'p'.repeat(TRANSCRIPT_CONTENT_CAP), restored: true, clipped: true },
			{ role: 'assistant', content: 'Rewrote it.', restored: true, via: 'model', proposedCount: 1 },
		]);
	});

	test('what became of a turn\'s changes survives every later save, and can never out-count them', () => {
		// #312 fix round 2: `proposedCount` is honest about HOW MANY and silent about WHAT HAPPENED, so the rail
		// filled the silence with a guess - it told an APPROVED change it had been thrown away when the workspace
		// closed. The outcome is recorded on the turn as the user acts, and has to survive the same two round
		// trips the other honesty markers do, because a fact that lasts exactly one relaunch is not a record.
		const turn = (approved?: number, rejected?: number): IChatMessage => ({
			role: 'assistant', content: 'Rewrote it.', via: 'model', proposedIds: ['c1', 'c2', 'c3'],
			...(approved ? { approvedCount: approved } : {}), ...(rejected ? { rejectedCount: rejected } : {}),
		});
		const twice = (m: IChatMessage) => {
			const first = roundTrip([entry('s1', [m])]).transcripts.get('s1') ?? [];
			return (roundTrip([entry('s1', first)]).transcripts.get('s1') ?? [])[0];
		};
		const counts = (m: IChatMessage | undefined) => [m?.proposedCount, m?.approvedCount, m?.rejectedCount];
		assert.deepStrictEqual({
			approvedAndRejected: counts(twice(turn(1, 2))),
			approvedOnly: counts(twice(turn(1))),
			untouched: counts(twice(turn())),
			// A restored turn has no `proposedIds` left, so these counts are all it has - and they must not decay.
			restoredAgain: counts(twice({ role: 'assistant', content: 'x', restored: true, proposedCount: 2, approvedCount: 2 })),
			// More outcomes than changes cannot be stored: the rail builds one sentence out of these numbers and
			// it has to add up. The overflow is clamped away rather than carried.
			overClaimed: counts(twice({ role: 'assistant', content: 'x', proposedIds: ['c1'], approvedCount: 4, rejectedCount: 4 })),
		}, {
			approvedAndRejected: [3, 1, 2],
			approvedOnly: [3, 1, undefined],
			untouched: [3, undefined, undefined],
			restoredAgain: [2, 2, undefined],
			overClaimed: [1, 1, undefined],
		});
	});

	test('a corrupt or stale stored value degrades honestly - never a throw, never a half-built transcript', () => {
		const partial = deserialiseTranscripts(JSON.stringify({
			version: 1,
			sessions: [
				{ id: 'good', dropped: 2, messages: [{ role: 'user', content: 'kept' }, { role: 'ghost', content: 'bad role' }, { role: 'user' }, null] },
				{ dropped: 1, messages: [{ role: 'user', content: 'no session id' }] },
			],
		}));
		assert.deepStrictEqual({
			missing: deserialiseTranscripts(undefined).transcripts.size,
			garbage: deserialiseTranscripts('{not json').transcripts.size,
			wrongVersion: deserialiseTranscripts(JSON.stringify({ version: 99, sessions: [{ id: 'a', messages: [] }] })).transcripts.size,
			notAnArray: deserialiseTranscripts(JSON.stringify({ version: 1, sessions: 'nope' })).transcripts.size,
			keptIds: [...partial.transcripts.keys()],
			keptMessages: (partial.transcripts.get('good') ?? []).map(m => m.content),
			keptDropped: partial.dropped.get('good'),
		}, {
			missing: 0,
			garbage: 0,
			wrongVersion: 0,
			notAnArray: 0,
			keptIds: ['good'],
			keptMessages: ['kept'],
			keptDropped: 2,
		});
	});
});
