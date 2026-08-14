/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { findInText, findMatches, findStatusLabel, replaceInText, stepMatchIndex } from '../../common/livingDocFind.js';

// The document as the webview runtime hands it to the pure layer: one segment per searchable unit, in
// document order. Here that is a heading, a paragraph, a paragraph whose bold run splits the word across two
// ProseMirror text nodes (the runtime concatenates them, so the segment reads as one word), a list item, a
// code block, and two table cells - every block shape WP-E's acceptance walks.
const SEGMENTS: readonly string[] = [
	'Quarterly Margin Review',			// heading
	'Margin held steady this quarter.',	// paragraph
	'The bold margin figure.',			// a match spanning inline formatting (**bo**ld margin)
	'Margin per region',				// list item
	'const margin = 0.4; // margin',	// code block
	'Margin',							// table header cell
	'40% margin',						// table body cell
];

suite('livingDocFind (plan 52 WP-E)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('matches are counted across the whole document, in document order, case-insensitively', () => {
		assert.deepStrictEqual(findMatches(SEGMENTS, 'margin'), [
			{ segment: 0, start: 10, end: 16 },
			{ segment: 1, start: 0, end: 6 },
			{ segment: 2, start: 9, end: 15 },
			{ segment: 3, start: 0, end: 6 },
			{ segment: 4, start: 6, end: 12 },
			{ segment: 4, start: 23, end: 29 },
			{ segment: 5, start: 0, end: 6 },
			{ segment: 6, start: 4, end: 10 },
		]);
	});

	test('a query is matched literally: regex metacharacters, emoji and CJK are text, never a pattern', () => {
		const segments = ['costs rose 40%.', 'a.b matched a[x] and c*d', 'axb is not a.b', 'ship it 🚀 now', '季度利润率上升'];
		assert.deepStrictEqual(
			{
				dot: findMatches(segments, 'a.b'),
				bracket: findMatches(segments, 'a[x]'),
				star: findMatches(segments, 'c*d'),
				emoji: findMatches(segments, '🚀'),
				cjk: findMatches(segments, '利润率'),
				backslash: findMatches(segments, '\\d'),
			},
			{
				dot: [{ segment: 1, start: 0, end: 3 }, { segment: 2, start: 11, end: 14 }],
				bracket: [{ segment: 1, start: 12, end: 16 }],
				star: [{ segment: 1, start: 21, end: 24 }],
				emoji: [{ segment: 3, start: 8, end: 10 }],
				cjk: [{ segment: 4, start: 2, end: 5 }],
				backslash: [],
			}
		);
	});

	test('an empty query, and a query nothing matches, both find nothing', () => {
		assert.deepStrictEqual(
			{ empty: findMatches(SEGMENTS, ''), absent: findMatches(SEGMENTS, 'revenue'), longer: findInText('ab', 'abc') },
			{ empty: [], absent: [], longer: [] }
		);
	});

	test('repeated matches are non-overlapping, left to right', () => {
		assert.deepStrictEqual(findInText('aaaa', 'aa'), [{ segment: 0, start: 0, end: 2 }, { segment: 0, start: 2, end: 4 }]);
	});

	test('next and previous wrap at both ends, and there is no current match when there are none', () => {
		assert.deepStrictEqual(
			{
				firstNext: stepMatchIndex(3, -1, 1),
				firstPrevious: stepMatchIndex(3, -1, -1),
				next: stepMatchIndex(3, 1, 1),
				wrapForward: stepMatchIndex(3, 2, 1),
				previous: stepMatchIndex(3, 1, -1),
				wrapBackward: stepMatchIndex(3, 0, -1),
				single: stepMatchIndex(1, 0, 1),
				none: stepMatchIndex(0, -1, 1),
			},
			{ firstNext: 0, firstPrevious: 2, next: 2, wrapForward: 0, previous: 0, wrapBackward: 2, single: 0, none: -1 }
		);
	});

	test('replace rewrites the matched ranges only, right to left, whatever the replacement length', () => {
		const text = 'const margin = 0.4; // margin';
		const all = findInText(text, 'margin');
		assert.deepStrictEqual(
			{
				one: replaceInText(text, [all[0]], 'ratio'),
				all: replaceInText(text, all, 'contribution ratio'),
				emptied: replaceInText(text, all, ''),
				untouched: replaceInText(text, [], 'ratio'),
			},
			{
				one: 'const ratio = 0.4; // margin',
				all: 'const contribution ratio = 0.4; // contribution ratio',
				emptied: 'const  = 0.4; // ',
				untouched: 'const margin = 0.4; // margin',
			}
		);
	});

	test('replace preserves the matched text\'s own case only where the replacement says so', () => {
		// A case-insensitive find matches "Margin" and "margin" alike; the replacement is inserted verbatim,
		// so the writer gets exactly what they typed rather than a guessed capitalisation.
		const text = 'Margin and margin';
		assert.deepStrictEqual(replaceInText(text, findInText(text, 'margin'), 'ratio'), 'ratio and ratio');
	});

	test('the count reads honestly at zero, before a first step, and while stepping', () => {
		const labels = { ofTemplate: '{0} of {1}', noResults: 'No results' };
		assert.deepStrictEqual(
			{
				none: findStatusLabel(0, -1, labels),
				beforeFirstStep: findStatusLabel(8, -1, labels),
				first: findStatusLabel(8, 0, labels),
				last: findStatusLabel(8, 7, labels),
			},
			{ none: 'No results', beforeFirstStep: '1 of 8', first: '1 of 8', last: '8 of 8' }
		);
	});
});
