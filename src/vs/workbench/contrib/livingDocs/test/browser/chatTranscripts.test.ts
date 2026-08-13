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

	const entry = (id: string, messages: readonly IChatMessage[], dropped = 0): ITranscriptInput => ({ id, messages, dropped });
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
