/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ATTACH_COLLAPSED_CAP, activeMention, collapseAttachChips, filterMentions, MENTION_PICKER_LIMIT, replaceActiveMention } from '../../browser/reviewRailView.js';

// The pure logic behind the chat composer's collapsed Attach row (#177) and the @mention picker (#178).
// Kept DOM-free so the cap, filter/rank and token replacement can be snapshot-asserted in isolation.
suite('livingDocs composer suggestions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const FILES = ['architecture', 'handover-notes', 'learnings', 'overview', 'what-we-built'];

	test('collapseAttachChips caps to the first four with an expander, expands to the full list (#177)', () => {
		const many = ['a', 'b', 'c', 'd', 'e', 'f'];
		const few = ['a', 'b', 'c'];
		assert.deepStrictEqual({
			capValue: ATTACH_COLLAPSED_CAP,
			collapsedMany: collapseAttachChips(many, false),
			expandedMany: collapseAttachChips(many, true),
			collapsedFew: collapseAttachChips(few, false),
			collapsedExactlyCap: collapseAttachChips(['a', 'b', 'c', 'd'], false),
		}, {
			capValue: 4,
			collapsedMany: { shown: ['a', 'b', 'c', 'd'], hasMore: true },
			expandedMany: { shown: many, hasMore: true },
			collapsedFew: { shown: few, hasMore: false },
			collapsedExactlyCap: { shown: ['a', 'b', 'c', 'd'], hasMore: false },
		});
	});

	test('filterMentions ranks prefix over mid-string, then shorter, then alpha, capped to the limit (#178)', () => {
		assert.deepStrictEqual({
			limit: MENTION_PICKER_LIMIT,
			over: filterMentions(FILES, 'over'),
			empty: filterMentions(FILES, ''),
			eRankAndLength: filterMentions(['learnings', 'overview', 'ledger'], 'e'),
			miss: filterMentions(FILES, 'zzz'),
			caseInsensitive: filterMentions(FILES, 'OVER'),
			capped: filterMentions(['aa1', 'aa2', 'aa3'], 'aa', 2),
		}, {
			limit: 8,
			over: ['overview', 'handover-notes'],
			empty: ['overview', 'learnings', 'architecture', 'what-we-built', 'handover-notes'],
			eRankAndLength: ['ledger', 'overview', 'learnings'],
			miss: [],
			caseInsensitive: ['overview', 'handover-notes'],
			capped: ['aa1', 'aa2'],
		});
	});

	test('activeMention detects the @query under the caret; replaceActiveMention swaps in the token (#178)', () => {
		assert.deepStrictEqual({
			atStart: activeMention('@over', 5),
			afterSpace: activeMention('hi @ov', 6),
			midEmail: activeMention('mail me@x', 9),
			noAt: activeMention('hello', 5),
			spaceEndsIt: activeMention('@over now', 9),
			bareAt: activeMention('ask @', 5),
			replacePartial: replaceActiveMention('tell me about @over now', 19, 'overview'),
			replaceAtCaretNoMention: replaceActiveMention('hi', 2, 'overview'),
		}, {
			atStart: { start: 0, query: 'over' },
			afterSpace: { start: 3, query: 'ov' },
			midEmail: undefined,
			noAt: undefined,
			spaceEndsIt: undefined,
			bareAt: { start: 4, query: '' },
			replacePartial: 'tell me about @overview  now',
			replaceAtCaretNoMention: 'hi @overview ',
		});
	});
});
