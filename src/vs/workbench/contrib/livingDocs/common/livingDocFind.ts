/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// In-document find & replace (plan 52 WP-E), as PURE string logic: no DOM, no ProseMirror, no webview.
//
// The find widget itself lives INSIDE the editor webview (the document body is an out-of-process iframe, so
// the matches, their rectangles and the scroll container are all in there). That is unavoidably DOM code -
// which is exactly why every decision a find can get WRONG is lifted out into this module and unit-tested
// here: what counts as a match, how matches are ordered across the whole document, how next/previous wrap,
// what the count reads, and what a replace produces. The webview runtime only supplies the text and carries
// out the edits.
//
// The document is fed in as SEGMENTS - one string per searchable unit, in document order. The runtime builds
// them from the live ProseMirror document: one segment per textblock (a paragraph, heading, list item or
// code block), whose text is the concatenation of its text nodes, plus one segment per table cell (tables are
// atoms in this fork, holding their GFM source in a node attribute). Concatenating a textblock's text nodes
// is what makes a query match ACROSS inline formatting: `**bo**ld` is two text nodes but one segment reading
// "bold". Segmenting per block is what stops a match running across a block boundary.
//
// Matching is literal by construction - a hand-rolled scan, never a RegExp - so regex-special characters
// (`.`, `*`, `(`, `[`, `\`) are typed and found literally with no escaping step to get wrong.

/** One match: its segment's index in the document-ordered segment list, and its half-open range in that segment. */
export interface IFindMatch {
	readonly segment: number;
	readonly start: number;
	readonly end: number;
}

/**
 * Case-fold one UTF-16 code unit for comparison. Folding PER CHARACTER (rather than lowercasing the whole
 * haystack) is what keeps every offset exact: `'İ'.toLowerCase()` is TWO characters, so a whole-string
 * fold would silently shift every match offset after it and a replace would corrupt the document. Folding a
 * character at a time can only ever make such a character fail to match, which is predictable and harmless.
 */
function fold(ch: string): string {
	return ch.toLowerCase();
}

/** Whether `needle` occurs in `hay` at `at`, compared case-insensitively one character at a time. */
function matchesAt(hay: string, needle: string, at: number): boolean {
	for (let k = 0; k < needle.length; k++) {
		if (fold(hay.charAt(at + k)) !== fold(needle.charAt(k))) {
			return false;
		}
	}
	return true;
}

/**
 * Every match of `query` in one segment, left to right and non-overlapping (a match advances the scan past
 * its own end, so "aa" in "aaaa" is two matches, not three). An empty query has no matches - the widget must
 * read "No results" while it is empty rather than claiming a match on every character.
 */
export function findInText(text: string, query: string): readonly IFindMatch[] {
	const out: IFindMatch[] = [];
	if (!query) {
		return out;
	}
	const limit = text.length - query.length;
	for (let i = 0; i <= limit; i++) {
		if (matchesAt(text, query, i)) {
			out.push({ segment: 0, start: i, end: i + query.length });
			i += query.length - 1;
		}
	}
	return out;
}

/**
 * Every match across the WHOLE document, in document order - the count the widget shows. Counting here (over
 * every segment) rather than over the visible DOM is what makes the count honest on a long document: matches
 * far below the fold are counted, and next/previous can reach them.
 */
export function findMatches(segments: readonly string[], query: string): readonly IFindMatch[] {
	const out: IFindMatch[] = [];
	for (let s = 0; s < segments.length; s++) {
		for (const m of findInText(segments[s], query)) {
			out.push({ segment: s, start: m.start, end: m.end });
		}
	}
	return out;
}

/**
 * The next current-match index after stepping by `delta` (+1 for next, -1 for previous), WRAPPING at both
 * ends. `current` is -1 when nothing is current yet, in which case a next lands on the first match and a
 * previous on the last. With no matches the answer is -1: there is nothing to be current.
 */
export function stepMatchIndex(count: number, current: number, delta: number): number {
	if (count <= 0) {
		return -1;
	}
	if (current < 0) {
		return delta >= 0 ? 0 : count - 1;
	}
	return ((current + delta) % count + count) % count;
}

/**
 * Apply `replacement` to `matches` within one segment's text. Applied right to left so an earlier match's
 * offsets are still valid after a later one has changed the string's length. Matches are assumed to be
 * non-overlapping and in ascending order, which is what `findInText` produces.
 */
export function replaceInText(text: string, matches: readonly IFindMatch[], replacement: string): string {
	let out = text;
	for (let i = matches.length - 1; i >= 0; i--) {
		const m = matches[i];
		out = out.slice(0, m.start) + replacement + out.slice(m.end);
	}
	return out;
}

/** The two localised templates the count reads from; supplied by the host so the widget's text is translatable. */
export interface IFindStatusLabels {
	/** e.g. "{0} of {1}" - the current match's 1-based ordinal and the total. */
	readonly ofTemplate: string;
	/** e.g. "No results" - shown for an empty query and for a query that matches nothing. */
	readonly noResults: string;
}

/**
 * The find widget's count, e.g. "3 of 12". Zero matches (including an empty query) reads as the plain
 * "No results" rather than "0 of 0", and a match set with nothing current yet reads as its first match, so
 * the count never shows a 0th ordinal. Built from localised templates with placeholders - never concatenation.
 */
export function findStatusLabel(count: number, current: number, labels: IFindStatusLabels): string {
	if (count <= 0) {
		return labels.noResults;
	}
	const ordinal = current < 0 ? 1 : current + 1;
	return labels.ofTemplate.replace('{0}', String(ordinal)).replace('{1}', String(count));
}
