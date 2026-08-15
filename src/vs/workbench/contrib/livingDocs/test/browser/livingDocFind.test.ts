/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FIND_WIDGET_HTML, FIND_WIDGET_RUNTIME, FIND_WIDGET_STYLE } from '../../browser/livingDocFindWidget.js';
import { caseAdaptReplacement, findInText, findMatches, findStatusLabel, replaceQueryInText, stepMatchIndex } from '../../common/livingDocFind.js';
import * as livingDocFind from '../../common/livingDocFind.js';

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
		assert.deepStrictEqual(
			{
				one: replaceQueryInText(text, 'margin', 'ratio', true, 0).text,
				second: replaceQueryInText(text, 'margin', 'ratio', true, 1).text,
				all: replaceQueryInText(text, 'margin', 'contribution ratio', true).text,
				emptied: replaceQueryInText(text, 'margin', '', true).text,
				pastTheEnd: replaceQueryInText(text, 'margin', 'ratio', true, 9).text,
				absent: replaceQueryInText(text, 'revenue', 'ratio', true).text,
				emptyQuery: replaceQueryInText(text, '', 'ratio', true).text,
			},
			{
				one: 'const ratio = 0.4; // margin',
				second: 'const margin = 0.4; // ratio',
				all: 'const contribution ratio = 0.4; // contribution ratio',
				emptied: 'const  = 0.4; // ',
				pastTheEnd: 'const margin = 0.4; // margin',
				absent: 'const margin = 0.4; // margin',
				emptyQuery: 'const margin = 0.4; // margin',
			}
		);
	});

	// The defect that failed #316's second validation round: raw-mode typing had no refresh hook, so the widget
	// held matches describing text that had MOVED, and Replace All spliced at those dead offsets - eating live
	// prose and destroying five `bind:` links on disk, silently. The runtime fix is a refresh hook plus deriving
	// at splice time; the API fix is this - the replace derives its own ranges from the very string it rewrites,
	// so the caller has nowhere to pass a stale offset in. Assert the property directly: replacing in text that
	// has been edited underneath the caller still lands exactly on the matches, and touches nothing else.
	test('a replace derives its own ranges, so text edited underneath it is still rewritten exactly', () => {
		const before = 'MRR is [$48.6k](bind:metrics.mrr) and also [$48.6k](bind:metrics.mrr) again.';
		const staleRanges = findInText(before, 'bind:metrics.mrr');
		// The reader types ten characters ABOVE the first match: every true offset has moved by ten.
		const edited = 'Headline. ' + before;
		const result = replaceQueryInText(edited, 'bind:metrics.mrr', 'REPLACED', true);
		assert.deepStrictEqual(
			{
				text: result.text,
				ranges: result.replacements.map(r => ({ start: r.start, end: r.end, text: r.text })),
				movedOffTheStaleRanges: result.replacements.map((r, i) => r.start - staleRanges[i].start),
				// What the old offset-taking replace would have written, reconstructed by hand from the stale ranges.
				hadItTrustedTheStaleRanges: edited.slice(0, staleRanges[0].start) + 'REPLACED' + edited.slice(staleRanges[0].end),
			},
			{
				text: 'Headline. MRR is [$48.6k](REPLACED) and also [$48.6k](REPLACED) again.',
				ranges: [{ start: 26, end: 42, text: 'REPLACED' }, { start: 53, end: 69, text: 'REPLACED' }],
				movedOffTheStaleRanges: [10, 10],
				hadItTrustedTheStaleRanges: 'Headline. MRR is [$48.6kREPLACEDetrics.mrr) and also [$48.6k](bind:metrics.mrr) again.',
			}
		);
	});

	// Belt and braces on the same property: the module must not export ANY replace that takes ranges from its
	// caller, because such a call is unsafe by construction however carefully the caller is written today.
	test('no exported replace accepts caller-supplied ranges', () => {
		const replacers = Object.keys(livingDocFind).filter(name => /replace/i.test(name) && typeof (livingDocFind as Record<string, unknown>)[name] === 'function');
		assert.deepStrictEqual(
			{
				exported: replacers,
				// `replaceQueryInText(text, query, replacement, caseSensitive, ordinal)` - a query and an ordinal, no offsets.
				takesNoRanges: replacers.every(name => !/\b(matches|ranges|hits)\b/.test(String((livingDocFind as Record<string, unknown>)[name]).split('{')[0])),
			},
			{ exported: ['caseAdaptReplacement', 'replaceQueryInText'], takesNoRanges: true }
		);
	});

	test('the Aa toggle makes matching exact, so a lower-case query stops matching a heading', () => {
		assert.deepStrictEqual(
			{
				insensitive: findMatches(SEGMENTS, 'margin'/* caseSensitive: off */).length,
				sensitive: findMatches(SEGMENTS, 'margin', true).length,
				sensitiveCapital: findMatches(SEGMENTS, 'Margin', true).length,
				exactStillLiteral: findInText('a.b axb', 'a.b', true),
			},
			{ insensitive: 8, sensitive: 4, sensitiveCapital: 4, exactStillLiteral: [{ segment: 0, start: 0, end: 3 }] }
		);
	});

	test('a case-blind replace puts back the match\'s own capitalisation, unless the replacement asks otherwise', () => {
		// The sharp edge of a case-INSENSITIVE find: it matches "Growth" for the query "growth", and inserting
		// the replacement verbatim would silently lower-case the heading. A lower-case replacement therefore
		// adopts the match's shape; a replacement the writer capitalised themselves is an explicit instruction.
		assert.deepStrictEqual(
			{
				lower: caseAdaptReplacement('growth', 'momentum'),
				title: caseAdaptReplacement('Growth', 'momentum'),
				upper: caseAdaptReplacement('GROWTH', 'momentum'),
				mixed: caseAdaptReplacement('gROWTH', 'momentum'),
				writerSaidCapital: caseAdaptReplacement('growth', 'Momentum'),
				writerSaidAllCaps: caseAdaptReplacement('Growth', 'MRR'),
				singleCapital: caseAdaptReplacement('I', 'we'),
				emptyReplacement: caseAdaptReplacement('Growth', ''),
				nonLetterMatch: caseAdaptReplacement('40%', 'half'),
			},
			{
				lower: 'momentum',
				title: 'Momentum',
				upper: 'MOMENTUM',
				mixed: 'momentum',
				writerSaidCapital: 'Momentum',
				writerSaidAllCaps: 'MRR',
				singleCapital: 'We',
				emptyReplacement: '',
				nonLetterMatch: 'half',
			}
		);
	});

	test('replace applies case adaptation per match, and leaves it off when the find is case sensitive', () => {
		const text = 'Margin and margin and MARGIN';
		assert.deepStrictEqual(
			{
				adapted: replaceQueryInText(text, 'margin', 'ratio').text,
				sensitive: replaceQueryInText(text, 'margin', 'ratio', true).text,
				sensitiveCapital: replaceQueryInText(text, 'Margin', 'ratio', true).text,
			},
			{
				adapted: 'Ratio and ratio and RATIO',
				sensitive: 'Margin and ratio and MARGIN',
				sensitiveCapital: 'ratio and margin and MARGIN',
			}
		);
	});

	// The second sharp edge of a case-blind replace, and the one that fails SILENTLY: adapting the replacement to
	// the match's own shape makes "normalise this brand" a no-op, because the replacement the reader typed is put
	// back exactly as it was found. A replacement that differs from its match only in case is therefore an
	// instruction about case and is taken literally (#316 V2-4) - while a genuine word substitution still adapts.
	test('a replacement that differs from the match only in case is taken literally, so lower-casing works', () => {
		assert.deepStrictEqual(
			{
				brand: replaceQueryInText('We ship GitHub and Github and GITHUB.', 'github', 'github').text,
				heading: replaceQueryInText('Growth held. GROWTH held. growth held.', 'growth', 'growth').text,
				upperCasing: replaceQueryInText('the mrr line', 'mrr', 'MRR').text,
				stillAdaptsARealSubstitution: replaceQueryInText('Growth held. GROWTH held.', 'growth', 'momentum').text,
				caseOnlyPair: caseAdaptReplacement('GitHub', 'github'),
				substitutionPair: caseAdaptReplacement('Growth', 'momentum'),
			},
			{
				brand: 'We ship github and github and github.',
				heading: 'growth held. growth held. growth held.',
				upperCasing: 'the MRR line',
				stillAdaptsARealSubstitution: 'Momentum held. MOMENTUM held.',
				caseOnlyPair: 'github',
				substitutionPair: 'Momentum',
			}
		);
	});

	// Every one of these is injected into the editor webview RUNTIME via String(fn) so the widget runs the
	// SAME matcher these tests cover; assert each is fully self-contained, with no import/require/transpiler
	// helper reference the interpolated source would dangle on (the livingDocTableEdit.ts precedent).
	test('injected helpers are self-contained (no import/require/helper refs in String(fn))', () => {
		for (const fn of [findInText, findMatches, stepMatchIndex, caseAdaptReplacement, replaceQueryInText, findStatusLabel]) {
			const src = String(fn);
			assert.ok(!/\brequire\b/.test(src), `${fn.name} must not reference require`);
			assert.ok(!/\bimport\b/.test(src), `${fn.name} must not reference import`);
			assert.ok(!/__[a-zA-Z]/.test(src), `${fn.name} must not reference a transpiler helper (__x)`);
		}
	});

	// The widget is three strings spliced into the webview shell, and the runtime is a template literal holding
	// JavaScript. A stray backtick inside it silently TRUNCATES the string (it closes the literal early), which
	// typechecks in some shapes and ships a half-written runtime - the widget would simply never open. Assert
	// each entry point the shell calls is actually present in what we hand it.
	test('the injected widget strings are complete and carry their entry points', () => {
		assert.deepStrictEqual(
			{
				openFind: FIND_WIDGET_RUNTIME.includes('function openFind()'),
				refresh: FIND_WIDGET_RUNTIME.includes('function findRefresh()'),
				matcher: FIND_WIDGET_RUNTIME.includes('function findInText('),
				caseAdapter: FIND_WIDGET_RUNTIME.includes('function caseAdaptReplacement('),
				chord: FIND_WIDGET_RUNTIME.includes('e.metaKey || e.ctrlKey'),
				host: FIND_WIDGET_HTML.includes('id="lwd-find"'),
				inputs: FIND_WIDGET_HTML.includes('data-find-input') && FIND_WIDGET_HTML.includes('data-find-replace-input'),
				caseToggle: FIND_WIDGET_HTML.includes('data-find-case') && FIND_WIDGET_HTML.includes('aria-pressed="false"'),
				highlights: FIND_WIDGET_STYLE.includes('::highlight(lwd-find)') && FIND_WIDGET_STYLE.includes('::highlight(lwd-find-current)'),
			},
			{ openFind: true, refresh: true, matcher: true, caseAdapter: true, chord: true, host: true, inputs: true, caseToggle: true, highlights: true }
		);
	});

	// Two behaviours the validator of #316 caught live, guarded here so they cannot silently come back: the
	// runtime must never ask for a SMOOTH scroll (which is a no-op inside this webview frame, so next/previous
	// reported a match it never scrolled to), and it must search the raw-Markdown textarea rather than
	// answering "No results" for source text sitting on screen.
	test('the runtime scrolls instantly, and searches the raw-Markdown source too', () => {
		assert.deepStrictEqual(
			{
				noSmoothScroll: /behavior\s*:\s*['"]smooth['"]/.test(FIND_WIDGET_RUNTIME),
				readsRawTextarea: FIND_WIDGET_RUNTIME.includes(`querySelector('textarea.raw')`),
				revealsRawMatch: FIND_WIDGET_RUNTIME.includes('function findRevealInTextarea('),
				replacesRawUndoably: FIND_WIDGET_RUNTIME.includes(`document.execCommand('insertText'`),
			},
			{ noSmoothScroll: false, readsRawTextarea: true, revealsRawMatch: true, replacesRawUndoably: true }
		);
	});

	// The three hooks the second validation round of #316 turned on, guarded so they cannot silently come back
	// out: an `input` listener on the raw textarea (without it the count froze and Replace All spliced at dead
	// offsets, destroying text on disk), a replace that re-derives instead of trusting `findHits`, and Cmd+Z in
	// the find box reaching the document's own history rather than the input's.
	test('the runtime hears raw-mode typing, re-derives before replacing, and routes undo to the document', () => {
		assert.deepStrictEqual(
			{
				hearsRawTyping: /addEventListener\('input'[\s\S]{0,240}classList\.contains\('raw'\)[\s\S]{0,80}findRefresh\(\)/.test(FIND_WIDGET_RUNTIME),
				derivesBeforeReplacing: /function findReplace\(all\)\{\s*\n\s*if \(!findIsOpen\(\) \|\| !findQuery\(\)\)\{ return; \}\s*\n\s*findDerive\(\);/.test(FIND_WIDGET_RUNTIME),
				replaceTakesNoOffsets: FIND_WIDGET_RUNTIME.includes('function replaceQueryInText(') && !FIND_WIDGET_RUNTIME.includes('function replaceInText('),
				routesUndoToDocument: FIND_WIDGET_RUNTIME.includes('function findUndoDocument(') && FIND_WIDGET_RUNTIME.includes(`someProp('handleKeyDown'`),
			},
			{ hearsRawTyping: true, derivesBeforeReplacing: true, replaceTakesNoOffsets: true, routesUndoToDocument: true }
		);
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
