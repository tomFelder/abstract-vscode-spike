/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Word-clipboard paste normalisation (issue #137 - the T1-A finding).
//
// Word's clipboard `text/html` does NOT use <ul>/<ol>/<li> for lists: each list item arrives as a
// <p class=MsoListParagraph*> whose bullet/number glyph lives inside a `mso-list:Ignore` span behind
// `<![if !supportLists]>...<![endif]>` conditional comments, and whose nesting level is carried in the
// paragraph style as `mso-list:l0 level2 lfo1`. Pasted as-is, ProseMirror turns a bullet list into flat
// paragraphs with literal glyph characters ("* Pipeline grew in EMEA" becomes a line beginning with a raw
// middot). This module rebuilds those Word list paragraphs into real nested <ul>/<ol>/<li> HTML.
//
// These functions are INJECTED into the webview verbatim (via `String(fn)` interpolation into the RUNTIME
// template in `livingDocRender.ts`) AND unit-tested here in `common/`. They must therefore be:
//   - fully self-contained: no imports, no captured module-scope references, no helper calls;
//   - plain ES2020: no TS-only syntax that transpiles to runtime helpers, no optional chaining / nullish
//     coalescing (kept out so the emitted `String(fn)` is byte-for-byte plain JS on any target);
//   - ASCII-only and DOM-free (no `document`, no browser globals), so they run identically in Node test
//     runners and in the webview.
//
// The normaliser is structured as an ORDERED TRANSFORM CHAIN (an internal array of `html -> html` steps)
// so the sibling paste findings can extend the same seam without rewriting the paste listener: #138
// (pasted Word tables -> table_block) and #139 (tracked-changes residue) append their own step.

/**
 * True when an HTML string looks like a Microsoft Word / Office clipboard payload. Cheap marker sniff
 * (no parse) used by the paste listener to decide whether to intercept; a non-Word paste returns false and
 * falls through to ProseMirror untouched. Self-contained for webview injection.
 */
export function isWordHtml(html: string): boolean {
	if (typeof html !== 'string' || html.length === 0) {
		return false;
	}
	return /mso-list|MsoListParagraph|MsoNormal|urn:schemas-microsoft-com:office/i.test(html);
}

/**
 * Normalise a Word clipboard `text/html` string for pasting into ProseMirror: rebuild Word list paragraphs
 * into real nested <ul>/<ol>/<li>, and drop Word's empty <o:p> spacer runs (the nbsp crumb-paragraphs).
 * Any non-list content (headings, paragraphs, tables, images, tracked-changes residue) is preserved
 * byte-for-byte apart from the spacer cleanup - lists are the only structure this pass rewrites. Runs an
 * internal ordered transform chain; fail-soft on unexpected input (returns the input string unchanged).
 * Self-contained for webview injection.
 */
export function normalizeWordPasteHtml(html: string): string {
	if (typeof html !== 'string' || html.length === 0) {
		return html;
	}

	// --- Step: drop Word's empty <o:p> spacer runs and the blank paragraphs they leave behind. ---
	// Word emits `<o:p></o:p>` at the end of most paragraphs and standalone `<p ...><o:p>&nbsp;</o:p></p>`
	// spacer paragraphs; both paste as stray non-breaking-space crumbs. Minimal + safe: only EMPTY (or
	// nbsp-only) office runs are removed, then any paragraph that is left with no content is dropped.
	function stripOfficeSpacers(input: string): string {
		let out = input;
		// Empty / whitespace / nbsp-only <o:p>...</o:p> runs.
		out = out.replace(/<o:p>(?:\s|&nbsp;|&#160;|\u00A0)*<\/o:p>/gi, '');
		// A paragraph whose only remaining content is whitespace / nbsp -> a spacer crumb; drop it whole.
		out = out.replace(/<p\b[^>]*>(?:\s|&nbsp;|&#160;|\u00A0)*<\/p>/gi, '');
		return out;
	}

	// --- Step: rebuild runs of Word list paragraphs into nested <ul>/<ol>/<li>. ---
	function rebuildWordLists(input: string): string {
		// Read the bullet/number glyph out of a list paragraph's `mso-list:Ignore` span (the glyph Word
		// renders before the text). Tags stripped, spacer entities collapsed, trimmed. '' when absent.
		function extractGlyph(inner: string): string {
			const g = /mso-list\s*:\s*Ignore[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
			let raw = g ? g[1] : '';
			raw = raw.replace(/<[^>]*>/g, '');
			raw = raw.replace(/&nbsp;|&#160;|\u00A0/gi, ' ');
			raw = raw.replace(/\s+/g, ' ');
			return raw.replace(/^\s+/, '').replace(/\s+$/, '');
		}

		// Ordered when the glyph is a number or letter (roman numerals included) followed by '.' or ')'
		// - e.g. "1.", "a)", "iv." Otherwise (a middot, an 'o' circle, a section sign, any symbol) it is a
		// bullet. A lone letter with no trailing '.'/')' (Word's Courier 'o' sub-bullet) stays a bullet.
		function isOrderedGlyph(glyph: string): boolean {
			return /^(?:[0-9]+|[A-Za-z]{1,4})[.)]/.test(glyph);
		}

		// The nesting level from `mso-list:l0 level2 lfo1` in the paragraph attributes; default 1.
		function levelOf(attrs: string): number {
			const lm = /mso-list\s*:[^;'"]*?level(\d+)/i.exec(attrs);
			if (lm) {
				const n = parseInt(lm[1], 10);
				if (n > 0) {
					return n;
				}
			}
			return 1;
		}

		// Strip the glyph markup (conditional-comment block and/or the mso-list:Ignore span) from an item's
		// inner HTML, keeping the real content (bold, links, text). Then trim the leading spacer the glyph
		// left behind. Byte-preserving for everything that is not glyph markup.
		function cleanItemInner(inner: string): string {
			let out = inner;
			// The whole `<![if !supportLists]>...<![endif]>` glyph block (its span nest lives inside).
			out = out.replace(/<!\[if[^\]]*\]>[\s\S]*?<!\[endif\]>/gi, '');
			// A bare mso-list:Ignore span (Word variants that omit the conditional comment). Best-effort:
			// remove the span open, its glyph text and one closing tag.
			out = out.replace(/<span[^>]*mso-list\s*:\s*Ignore[^>]*>[\s\S]*?<\/span>/gi, '');
			// Leading whitespace / nbsp where the glyph sat.
			out = out.replace(/^(?:\s|&nbsp;|&#160;|\u00A0)+/i, '');
			return out.replace(/^\s+/, '').replace(/\s+$/, '');
		}

		// A Word list paragraph: class contains MsoListParagraph, or the style carries `mso-list:`.
		function listInfoOf(attrs: string, inner: string): { level: number; ordered: boolean; inner: string } | null {
			if (!/MsoListParagraph/i.test(attrs) && !/mso-list\s*:/i.test(attrs)) {
				return null;
			}
			return { level: levelOf(attrs), ordered: isOrderedGlyph(extractGlyph(inner)), inner: cleanItemInner(inner) };
		}

		// Build one nested list HTML string from a run of items (each { level, ordered, inner }). A deeper
		// item opens a child list INSIDE the current still-open <li>; a shallower item closes child lists
		// back to its level. Item text sits directly in the <li> (ProseMirror wraps it in a paragraph).
		function buildLists(items: Array<{ level: number; ordered: boolean; inner: string }>): string {
			let out = '';
			const stack: Array<{ level: number; ordered: boolean }> = [];
			for (let i = 0; i < items.length; i++) {
				const it = items[i];
				if (stack.length === 0) {
					out += it.ordered ? '<ol>' : '<ul>';
					stack.push({ level: it.level, ordered: it.ordered });
					out += '<li>' + it.inner;
					continue;
				}
				const top = stack[stack.length - 1];
				if (it.level > top.level) {
					out += it.ordered ? '<ol>' : '<ul>';
					stack.push({ level: it.level, ordered: it.ordered });
					out += '<li>' + it.inner;
				} else if (it.level === top.level) {
					out += '</li><li>' + it.inner;
				} else {
					while (stack.length > 1 && stack[stack.length - 1].level > it.level) {
						out += '</li>';
						out += stack[stack.length - 1].ordered ? '</ol>' : '</ul>';
						stack.pop();
					}
					out += '</li><li>' + it.inner;
				}
			}
			while (stack.length > 0) {
				out += '</li>';
				out += stack[stack.length - 1].ordered ? '</ol>' : '</ul>';
				stack.pop();
			}
			return out;
		}

		// Walk every <p>...</p> in document order. Consecutive list paragraphs (separated only by
		// whitespace / comments) group into one run and are replaced by rebuilt nested lists; any other
		// content - including <p> inside table cells - passes through untouched.
		const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
		let result = '';
		let lastIndex = 0;
		let group: Array<{ level: number; ordered: boolean; inner: string }> = [];
		let m: RegExpExecArray | null;
		while ((m = pRe.exec(input)) !== null) {
			const between = input.slice(lastIndex, m.index);
			const info = listInfoOf(m[1], m[2]);
			if (info) {
				if (group.length === 0) {
					result += between;
				} else {
					// Real content between two list paragraphs interrupts the run; whitespace / comments
					// between consecutive items is swallowed (Word puts blank lines between them).
					const filler = between.replace(/<!--[\s\S]*?-->/g, '').replace(/&nbsp;|&#160;|\u00A0/gi, '').replace(/\s+/g, '');
					if (filler.length > 0) {
						result += buildLists(group);
						group = [];
						result += between;
					}
				}
				group.push(info);
			} else {
				if (group.length > 0) {
					result += buildLists(group);
					group = [];
				}
				result += between + m[0];
			}
			lastIndex = pRe.lastIndex;
		}
		if (group.length > 0) {
			result += buildLists(group);
		}
		result += input.slice(lastIndex);
		return result;
	}

	// Ordered transform chain. #138 (tables) and #139 (tracked changes) append their step here.
	const transforms: Array<(input: string) => string> = [stripOfficeSpacers, rebuildWordLists];
	let out = html;
	for (let i = 0; i < transforms.length; i++) {
		out = transforms[i](out);
	}
	return out;
}
