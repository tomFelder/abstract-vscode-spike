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
// so the sibling paste findings extend the same seam without rewriting the paste listener: #139
// (tracked-changes residue) and #138 (pasted tables -> table_block) each append a step. The #138 table step
// (`convertHtmlTablesToDataMd`) is exported separately as well, because tables convert for ANY HTML source -
// the paste listener calls it directly for a plain, non-Word table paste (which the Word marker gate skips).

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
 * True when an HTML string carries at least one `<table>` element. Cheap marker sniff (no parse) used by the
 * paste listener so a PLAIN (non-Word) HTML table paste is also intercepted and routed through the table
 * transform - unlike the Word-only list/tracked-changes passes, `<table>` conversion applies to any source
 * (issue #138). A payload with no table returns false and falls through to ProseMirror untouched.
 * Self-contained for webview injection.
 */
export function hasHtmlTable(html: string): boolean {
	if (typeof html !== 'string' || html.length === 0) {
		return false;
	}
	return /<table\b/i.test(html);
}

/**
 * Convert every `<table>...</table>` in a pasted HTML string into a `<table data-md="...GFM pipe text...">`
 * element - exactly what the shipped ProseMirror bundle's `table[data-md]` parseDOM rule turns into a real
 * rendered `table_block`. Without this, a pasted table has no schema node and ProseMirror flattens each cell
 * into a separate paragraph (issue #138, the T1-B finding). Applies to ALL tables (Word's MsoTableGrid and
 * plain HTML), so it runs both inside the Word normaliser chain and directly on plain-HTML table pastes.
 *
 * Conversion rules (cell text -> markdown-ish inline): <b>/<strong> -> **bold**, <i>/<em> -> *italic*,
 * <a href> -> [text](href), <br> -> space, everything else -> its text with tags stripped and entities
 * decoded; a literal `|` is escaped as `\|`. The first `<tr>` becomes the GFM header and a `| --- |`
 * separator sized to the column count is emitted.
 *
 * MERGED-CELL RULE (stated): `colspan=N` puts the cell's text in its first column and leaves the remaining
 * N-1 columns empty; `rowspan=N` puts the value in the first row and leaves the cells below it empty. The
 * column count is the maximum expanded row width; short rows are padded with empty cells. Nothing is silently
 * dropped - every cell's text lands in exactly one grid position. Fail-soft: a table that yields no rows is
 * left unchanged. Self-contained for webview injection (no imports, no DOM, ASCII-only).
 */
export function convertHtmlTablesToDataMd(html: string): string {
	if (typeof html !== 'string' || html.length === 0) {
		return html;
	}
	if (!/<table\b/i.test(html)) {
		return html;
	}

	// Decode the small set of HTML entities that show up in clipboard cell text into their literal
	// characters (named specials + numeric/hex refs; nbsp -> space). `&amp;` is decoded last so a
	// double-encoded `&amp;lt;` resolves to `&lt;`, not `<`. Anything unrecognised is left verbatim.
	function decodeEntities(s: string): string {
		let out = s.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ');
		out = out.replace(/&#(\d+);/g, function (m, d) {
			const n = parseInt(d, 10);
			if (n >= 0 && n <= 1114111) {
				return String.fromCodePoint(n);
			}
			return m;
		});
		out = out.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
			const n = parseInt(h, 16);
			if (n >= 0 && n <= 1114111) {
				return String.fromCodePoint(n);
			}
			return m;
		});
		out = out.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
		out = out.replace(/&apos;/g, '\'').replace(/&#39;/g, '\'');
		out = out.replace(/&amp;/g, '&');
		return out;
	}

	// HTML-attribute-escape the finished GFM so it is safe inside `data-md="..."`. Newlines are preserved
	// verbatim (the DOM parser keeps them in the attribute value; the bundle splits the markdown on \n).
	function attrEscape(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// Text inside an inline mark (bold / italic / link) -> plain text with markup and whitespace collapsed
	// and trimmed. Entities are NOT decoded here (a single decode pass runs at the end of cellToMd) but nbsp
	// is folded to a space so a nbsp-only mark trims to empty. Trimming avoids `** bold **` (space-padded
	// emphasis that markdown would not render).
	function stripInline(frag: string): string {
		let t = frag.replace(/<br\s*\/?>/gi, ' ');
		t = t.replace(/<[^>]*>/g, '');
		t = t.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ');
		t = t.replace(/\s+/g, ' ');
		return t.replace(/^\s+/, '').replace(/\s+$/, '');
	}

	// One cell's inner HTML -> a single line of markdown-ish inline text (see the rules in the doc comment).
	function cellToMd(frag: string): string {
		let s = frag.replace(/<br\s*\/?>/gi, ' ');
		// <a href> -> [text](href). href may be double-, single-, or unquoted. Entities in text and href are
		// left for the final decode pass.
		s = s.replace(/<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi,
			function (m, dq, sq, uq, inner) {
				const href = dq !== undefined ? dq : (sq !== undefined ? sq : (uq !== undefined ? uq : ''));
				const txt = stripInline(inner);
				return '[' + txt + '](' + href + ')';
			});
		// <b>/<strong> -> **...**, dropping an empty (whitespace-only) mark rather than emitting `****`.
		s = s.replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, function (m, inner) {
			const t = stripInline(inner);
			return t.length ? '**' + t + '**' : '';
		});
		// <i>/<em> -> *...*
		s = s.replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, function (m, inner) {
			const t = stripInline(inner);
			return t.length ? '*' + t + '*' : '';
		});
		// Everything else: strip remaining tags to a space (so block boundaries do not fuse words), decode
		// entities once, collapse whitespace, trim, then escape any literal pipe.
		s = s.replace(/<[^>]*>/g, ' ');
		s = decodeEntities(s);
		s = s.replace(/\s+/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
		s = s.replace(/\|/g, '\\|');
		return s;
	}

	// One `<table>` inner HTML -> the GFM pipe-table text (or '' when there are no rows, for fail-soft).
	function tableToGfm(tableInner: string): string {
		const rows: Array<Array<{ text: string; colspan: number; rowspan: number }>> = [];
		const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
		let mr: RegExpExecArray | null;
		while ((mr = trRe.exec(tableInner)) !== null) {
			const rowInner = mr[1];
			const cells: Array<{ text: string; colspan: number; rowspan: number }> = [];
			// Backreference on the tag name so <td>...</td> and <th>...</th> each close on their own kind.
			const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
			let mc: RegExpExecArray | null;
			while ((mc = cellRe.exec(rowInner)) !== null) {
				const attrs = mc[2];
				let colspan = 1;
				let rowspan = 1;
				const cm = /colspan\s*=\s*["']?(\d+)/i.exec(attrs);
				if (cm) {
					const cv = parseInt(cm[1], 10);
					if (cv > 1) {
						colspan = cv;
					}
				}
				const rm = /rowspan\s*=\s*["']?(\d+)/i.exec(attrs);
				if (rm) {
					const rv = parseInt(rm[1], 10);
					if (rv > 1) {
						rowspan = rv;
					}
				}
				cells.push({ text: cellToMd(mc[3]), colspan: colspan, rowspan: rowspan });
			}
			rows.push(cells);
		}
		if (rows.length === 0) {
			return '';
		}

		// Expand colspan/rowspan into a dense grid of strings. `carry[col]` counts how many further rows a
		// rowspan still occupies at that column (those continuation cells are empty). A cell's text sits in
		// its top-left position; every other position it spans is an empty string.
		const grid: string[][] = [];
		const carry: number[] = [];
		for (let ri = 0; ri < rows.length; ri++) {
			const rowCells = rows[ri];
			const outRow: string[] = [];
			let col = 0;
			let ci = 0;
			while (ci < rowCells.length || (carry[col] && carry[col] > 0)) {
				if (carry[col] && carry[col] > 0) {
					outRow[col] = '';
					carry[col] = carry[col] - 1;
					col++;
					continue;
				}
				const cell = rowCells[ci];
				ci++;
				const startCol = col;
				for (let k = 0; k < cell.colspan; k++) {
					outRow[col] = k === 0 ? cell.text : '';
					col++;
				}
				if (cell.rowspan > 1) {
					for (let c2 = startCol; c2 < startCol + cell.colspan; c2++) {
						carry[c2] = cell.rowspan - 1;
					}
				}
			}
			grid.push(outRow);
		}

		let maxCols = 0;
		for (let g = 0; g < grid.length; g++) {
			if (grid[g].length > maxCols) {
				maxCols = grid[g].length;
			}
		}
		if (maxCols === 0) {
			return '';
		}
		for (let g2 = 0; g2 < grid.length; g2++) {
			const r0 = grid[g2];
			for (let p = 0; p < maxCols; p++) {
				if (r0[p] === undefined) {
					r0[p] = '';
				}
			}
		}

		const lines: string[] = [];
		lines.push('| ' + grid[0].join(' | ') + ' |');
		const sep: string[] = [];
		for (let s2 = 0; s2 < maxCols; s2++) {
			sep.push('---');
		}
		lines.push('| ' + sep.join(' | ') + ' |');
		for (let b = 1; b < grid.length; b++) {
			lines.push('| ' + grid[b].join(' | ') + ' |');
		}
		return lines.join('\n');
	}

	return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, function (whole, inner) {
		const gfm = tableToGfm(inner);
		if (!gfm) {
			return whole;
		}
		return '<table data-md="' + attrEscape(gfm) + '"></table>';
	});
}

/**
 * Normalise a Word clipboard `text/html` string for pasting into ProseMirror: rebuild Word list paragraphs
 * into real nested <ul>/<ol>/<li>, drop Word's empty <o:p> spacer runs (the nbsp crumb-paragraphs), resolve
 * tracked-changes residue as paste-as-accepted (deleted runs removed, inserted runs kept as plain text), and
 * convert Word tables into `<table data-md="...">` so they parse to real `table_block` nodes. Any other
 * content (headings, paragraphs, images) is preserved byte-for-byte apart from that cleanup. Runs an internal
 * ordered transform chain; fail-soft on unexpected input (returns the input string unchanged).
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

	// --- Step: resolve Word tracked-changes residue as paste-as-accepted (issue #139, T1-C). ---
	// Word exports revisions inline: deleted text sits in a `<del>` element or a `class=msoDel` span (its
	// CSS carries text-decoration:line-through), inserted text in an `<ins>` element or a `class=msoIns`
	// span (underline + colour). Pasted as-is, PM keeps BOTH runs, splicing the deleted words back into the
	// sentence ("revised down" + "held flat" -> "revised downheld flat"). This mirrors pasting into Word
	// itself: DROP deleted runs entirely, KEEP inserted runs as plain text with their revision styling
	// removed. Only acts on genuine Word/Office payloads - a legit <del>/<ins> from a non-Word source is
	// left untouched (the marker sniff gates the whole step), so plain-HTML pastes are out of scope.
	function stripTrackedChanges(input: string): string {
		// Word-payload gate (msoDel/msoIns/mso-* tokens or the Office namespace). A non-Word paste with a
		// hand-authored <del>/<ins> matches nothing here and returns byte-for-byte unchanged.
		if (!/mso[-A-Za-z]|urn:schemas-microsoft-com:office/i.test(input)) {
			return input;
		}
		let out = input;
		// Deleted runs -> removed (content and wrapper). <del> elements first, then Word's msoDel spans.
		out = out.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '');
		out = out.replace(/<span\b[^>]*msoDel[^>]*>[\s\S]*?<\/span>/gi, '');
		// A span whose inline style strikes text through AND carries a Word marker is a deleted run too
		// (Word variants that inline the style instead of the msoDel class). Guarded on an mso token so a
		// plain strikethrough span in the same payload is not swallowed.
		out = out.replace(/<span\b([^>]*)>[\s\S]*?<\/span>/gi, function (m, attrs) {
			if (/text-decoration\s*:\s*[^;>"']*line-through/i.test(attrs) && /mso/i.test(attrs)) {
				return '';
			}
			return m;
		});
		// Inserted runs -> kept as plain text, the revision wrapper (underline / teal colour) dropped.
		out = out.replace(/<ins\b[^>]*>([\s\S]*?)<\/ins>/gi, '$1');
		out = out.replace(/<span\b[^>]*msoIns[^>]*>([\s\S]*?)<\/span>/gi, '$1');
		return out;
	}

	// Ordered transform chain. The table step (issue #138) runs LAST so cell contents have already had Word
	// spacers, list markup and tracked-changes residue resolved before they are serialised to GFM. It is the
	// shared top-level `convertHtmlTablesToDataMd` (also injected into the webview and used directly for plain,
	// non-Word HTML table pastes), so Word and plain tables go through one implementation.
	const transforms: Array<(input: string) => string> = [stripOfficeSpacers, rebuildWordLists, stripTrackedChanges, convertHtmlTablesToDataMd];
	let out = html;
	for (let i = 0; i < transforms.length; i++) {
		out = transforms[i](out);
	}
	return out;
}
