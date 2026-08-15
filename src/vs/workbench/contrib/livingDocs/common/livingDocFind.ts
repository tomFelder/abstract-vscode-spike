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
 * Every match of `query` in one segment, left to right and non-overlapping (a match advances the scan past
 * its own end, so "aa" in "aaaa" is two matches, not three). An empty query has no matches - the widget must
 * read "No results" while it is empty rather than claiming a match on every character.
 *
 * The comparison case-folds ONE CHARACTER AT A TIME rather than lowercasing the whole haystack, because
 * `'İ'.toLowerCase()` is TWO characters: a whole-string fold would silently shift every offset after
 * such a character, and a replace built on those offsets would corrupt the document. Per-character folding
 * can only ever make such a character fail to match, which is predictable and harmless.
 *
 * `caseSensitive` turns the fold off entirely, which is what the widget's `Aa` toggle drives.
 *
 * Self-contained on purpose: this function's source is injected verbatim into the editor webview (the
 * `String(fn)` seam the table helpers use), so the widget and these tests run the identical matcher.
 */
export function findInText(text: string, query: string, caseSensitive?: boolean): readonly IFindMatch[] {
	const out: IFindMatch[] = [];
	if (!query) {
		return out;
	}
	const limit = text.length - query.length;
	for (let i = 0; i <= limit; i++) {
		let hit = true;
		for (let k = 0; k < query.length; k++) {
			const a = text.charAt(i + k);
			const b = query.charAt(k);
			if (a !== b && (caseSensitive || a.toLowerCase() !== b.toLowerCase())) {
				hit = false;
				break;
			}
		}
		if (hit) {
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
export function findMatches(segments: readonly string[], query: string, caseSensitive?: boolean): readonly IFindMatch[] {
	const out: IFindMatch[] = [];
	for (let s = 0; s < segments.length; s++) {
		const inSegment = findInText(segments[s], query, caseSensitive);
		for (let i = 0; i < inSegment.length; i++) {
			out.push({ segment: s, start: inSegment[i].start, end: inSegment[i].end });
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
 * What to actually insert for one match when the find is case-INSENSITIVE, given the text it matched.
 *
 * A case-blind find matches `Growth` for the query `growth`; substituting the replacement verbatim would then
 * silently lower-case a heading. So the replacement adopts the matched text's own capitalisation - unless the
 * writer typed a capital in the replacement, which is an explicit instruction about case and is honoured as
 * typed. (The rule a word processor's reader already expects; it is why Word's replace does not flatten your
 * headings.) Three shapes are recognised, and anything else is left verbatim:
 *
 * - the match is ALL CAPS (two or more cased characters, none lower) - `MARGIN` -> `CONTRIBUTION`;
 * - the match starts with a capital - `Margin` -> `Contribution`;
 * - the match is lower case - `margin` -> `contribution`.
 *
 * With the `Aa` toggle ON the matched text equals the query in case anyway, so the widget skips this and
 * inserts the replacement exactly as typed.
 *
 * The one case adaptation must NOT swallow is a replacement that differs from the match only in case - typing
 * `github` over `GitHub`, or `growth` over `Growth`. That is not a word substitution at all, it is an explicit
 * instruction about case, and adapting it back to the match's own shape makes the replace a silent no-op on
 * exactly the words the reader is trying to normalise (#316 V2-4: ten of eleven replacements did nothing, and
 * `GitHub` -> `github` produced `Github` - neither what was there nor what was typed). Such a replacement is
 * taken literally, so the `Aa` toggle is not the only way to lower-case a word.
 */
export function caseAdaptReplacement(matched: string, replacement: string): string {
	if (!replacement) {
		return replacement;
	}
	if (matched.toLowerCase() === replacement.toLowerCase()) {
		return replacement;
	}
	for (let i = 0; i < replacement.length; i++) {
		const ch = replacement.charAt(i);
		if (ch !== ch.toLowerCase()) {
			return replacement;
		}
	}
	let cased = 0;
	let upper = 0;
	for (let i = 0; i < matched.length; i++) {
		const ch = matched.charAt(i);
		if (ch.toLowerCase() === ch.toUpperCase()) {
			continue;
		}
		cased++;
		if (ch === ch.toUpperCase()) {
			upper++;
		}
	}
	if (cased >= 2 && upper === cased) {
		return replacement.toUpperCase();
	}
	const first = matched.charAt(0);
	if (first && first.toLowerCase() !== first.toUpperCase() && first === first.toUpperCase()) {
		return replacement.charAt(0).toUpperCase() + replacement.slice(1);
	}
	return replacement;
}

/** One replacement: the half-open range of the text it was derived from, and what goes into that range. */
export interface IFindReplacement {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/** A replace's whole outcome: the rewritten text, and the ranges of the ORIGINAL text it rewrote. */
export interface IFindReplaceResult {
	readonly text: string;
	readonly replacements: readonly IFindReplacement[];
}

/**
 * Replace `query` in `text` - deriving the ranges FROM `text` ITSELF, here, and returning them alongside the
 * rewritten string.
 *
 * That signature is the point of this function, and it is deliberately the ONLY replace this module exports.
 * The obvious alternative - hand a replace the match list the widget is already holding - is what destroyed
 * text on disk in #316 V2-1: the raw-Markdown textarea had no change hook, so the held matches described text
 * that had moved, and every splice landed ten characters early and ate live prose (five `bind:` links gone,
 * silently). A replace built on offsets it did not just compute is unsafe by construction, so there is no way
 * left to express one: a caller cannot pass offsets in, because this derives them from the very string it is
 * about to rewrite.
 *
 * `ordinal` picks a single match by its 0-based position among the matches just derived (what the widget's
 * "Replace" button does with the current match); omitted, or negative, replaces every match. Replacements are
 * applied right to left so an earlier range is still valid after a later one has changed the string's length.
 * Each one is case-adapted (see `caseAdaptReplacement`) unless the find is case sensitive, in which case the
 * matched text equals the query anyway and the replacement is inserted exactly as typed.
 */
export function replaceQueryInText(text: string, query: string, replacement: string, caseSensitive?: boolean, ordinal?: number): IFindReplaceResult {
	const matches = findInText(text, query, caseSensitive);
	const picked: IFindMatch[] = [];
	if (ordinal === undefined || ordinal < 0) {
		for (let i = 0; i < matches.length; i++) {
			picked.push(matches[i]);
		}
	} else if (matches[ordinal]) {
		picked.push(matches[ordinal]);
	}
	const replacements: IFindReplacement[] = [];
	for (let i = 0; i < picked.length; i++) {
		const m = picked[i];
		const rep = caseSensitive ? replacement : caseAdaptReplacement(text.slice(m.start, m.end), replacement);
		replacements.push({ start: m.start, end: m.end, text: rep });
	}
	let out = text;
	for (let i = replacements.length - 1; i >= 0; i--) {
		const r = replacements[i];
		out = out.slice(0, r.start) + r.text + out.slice(r.end);
	}
	return { text: out, replacements: replacements };
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
