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
// (pasted tables -> table[data-md] -> table_block) and #139 (tracked-changes residue) each append a step.

import { convertDocxHtml, formatImportSummary, IDocxDetections, noDetections } from './docxImport.js';

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
 * The paste-slice open-boundary decision (#256). ProseMirror parses a pasted fragment into a Slice whose start
 * boundary is OPEN (`openStart` > 0) so an inline paste flows into the caret's current textblock - correct for a
 * few words dropped mid-sentence. But when the FIRST pasted node is a STRUCTURAL block (heading / list / table /
 * blockquote / code block) and the caret sits inside a NON-EMPTY paragraph, that open boundary merges the block's
 * text into the paragraph and the block loses its identity - a pasted Word H1 glues onto the prior line. This is
 * the pure predicate the webview's `transformPasted` guard consults to decide whether to CLOSE the slice's start
 * (set `openStart` to 0) so the leading block lands as its own block. Returns true only when ALL hold: the paste
 * is not plain text, the slice start is actually open, the slice's first child is one of the structural block
 * types, and the caret's own textblock already holds content (an empty paragraph has nothing to glue onto, so its
 * heading-lands-as-a-block behaviour is left untouched). DOM-free and self-contained for webview injection.
 */
export function pasteStartShouldClose(firstChildType: string, sliceOpenStart: number, isPlainText: boolean, caretParentIsTextblock: boolean, caretParentContentSize: number): boolean {
	if (isPlainText || sliceOpenStart <= 0) {
		return false;
	}
	// The block node types that must keep their own boundary when they lead a paste onto a non-empty line.
	const structural = /^(?:heading|table_block|bullet_list|ordered_list|blockquote|code_block)$/;
	if (typeof firstChildType !== 'string' || !structural.test(firstChildType)) {
		return false;
	}
	return caretParentIsTextblock === true && caretParentContentSize > 0;
}

/**
 * Normalise a clipboard `text/html` string for pasting into ProseMirror: rebuild Word list paragraphs into
 * real nested <ul>/<ol>/<li>, drop Word's empty <o:p> spacer runs (the nbsp crumb-paragraphs), resolve
 * tracked-changes residue as paste-as-accepted (deleted runs removed, inserted runs kept as plain text), and
 * serialise every pasted <table> to GFM pipe text emitted as a `table[data-md]` element the table_block node
 * adopts. Any other content (headings, paragraphs, images) is preserved byte-for-byte apart from that
 * cleanup. Runs an internal ordered transform chain; fail-soft on unexpected input (returns it unchanged).
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

	// --- Step: rewrite Word heading paragraphs into real <h1>-<h6> so they keep a clean block boundary (#256). ---
	// Word's clipboard export does NOT always emit headings as <h1>-<h6>. When a document uses Word's built-in
	// heading STYLES, several Word paths (Word Online, Mac Word, and some desktop paste routes) instead emit each
	// heading as a styled PARAGRAPH: `<p class=MsoHeading1 ...>` / `<p class=MsoTitle ...>`, and/or a paragraph
	// whose style carries `mso-outline-level:N`. Pasted as-is, ProseMirror parses that as an ordinary paragraph -
	// an "open" inline block - so when the caret sits at the end of the previous paragraph PM MERGES the two and
	// the heading text glues onto the prior line ("...for the boun" + "Pasted Heading One" -> one run-on line).
	// A real <hN> is parsed as its own heading block and never glues, so this step maps Word heading paragraphs to
	// the matching <hN>. The level is read from the class number (MsoHeadingN / MsoTitle=h1 / MsoSubtitle=h2) or,
	// failing that, from `mso-outline-level:N` in the style. A paragraph with neither marker is left untouched, so
	// body paragraphs pass through byte-for-byte. Runs before the table step so a heading inside a cell is not
	// misread (Word never nests headings in cells in this export path; a cell's <p> has no heading class).
	function rewriteWordHeadings(input: string): string {
		// The heading level a Word paragraph's attributes imply, or 0 when it is not a heading paragraph.
		function headingLevelOf(attrs: string): number {
			// A built-in Title / Subtitle style maps to h1 / h2 (Word's own outline treatment).
			if (/\bclass\s*=\s*"?[^">]*\bMsoTitle\b/i.test(attrs) || /\bclass\s*=\s*MsoTitle\b/i.test(attrs)) {
				return 1;
			}
			if (/\bclass\s*=\s*"?[^">]*\bMsoSubtitle\b/i.test(attrs) || /\bclass\s*=\s*MsoSubtitle\b/i.test(attrs)) {
				return 2;
			}
			// `class=MsoHeading1` / `class="MsoHeading2 ..."` etc. (levels beyond 6 clamp to 6, the deepest heading).
			const cm = /\bMsoHeading([1-9])\b/i.exec(attrs);
			if (cm) {
				const n = parseInt(cm[1], 10);
				return n > 6 ? 6 : n;
			}
			// `style='...mso-outline-level:2...'` on a heading-styled paragraph (0 / 'none' is body text, skipped).
			const om = /mso-outline-level\s*:\s*(\d+)/i.exec(attrs);
			if (om) {
				const n = parseInt(om[1], 10);
				if (n >= 1) {
					return n > 6 ? 6 : n;
				}
			}
			return 0;
		}

		const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
		return input.replace(pRe, function (whole, attrs, inner) {
			const level = headingLevelOf(attrs);
			if (level === 0) {
				return whole;
			}
			// Keep the inner markup (bold/italic/links survive into the heading); ProseMirror flattens a heading to
			// plain text, but preserving the inline tags keeps parity with a pasted real <hN> and costs nothing.
			return '<h' + level + '>' + inner + '</h' + level + '>';
		});
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

	// --- Step: convert pasted <table>s into a table[data-md] element the table_block node parses (#138, T1-B). ---
	// The editor schema parses a table ONLY from its own serialization - a `table[data-md]` element whose
	// `data-md` attribute carries the GFM pipe-table Markdown (the table_block node reads that attribute
	// verbatim as its `markdown`). A pasted external <table> (Word's MsoTableGrid/MsoNormalTable or any plain
	// browser HTML table) matches nothing, so ProseMirror hoists every <td>'s content out as a separate
	// paragraph and the table is silently destroyed (a 6-row table lands as ~20 stray one-line paragraphs).
	// This step serialises each pasted <table> to GFM pipe text and re-emits it as `<table data-md="...">`, so
	// the SAME table_block node adopts it (rendering, column alignment and the #140 cell editor all for free).
	// The cell -> Markdown mapping deliberately mirrors the docx importer's table serializer (issue #129), so a
	// pasted table and an imported one read identically: bold/italic kept as `**`/`*`, links as `[text](href)`,
	// Word junk (mso spans, <o:p>, conditional comments) dropped, and each cell's pipes escaped as `\|`.
	//
	// MERGED CELLS degrade by a stated, deterministic rule - never a silent column misalignment (GFM has no
	// cell spanning): a `colspan=N` cell REPEATS its content across the N columns it covers, and a `rowspan=N`
	// cell REPEATS its content down the N rows it covers. Repeat (not blank-fill) is the honest choice - the
	// reader sees the merged value in every position the merge implied, and every row stays rectangular.
	// MULTI-PARAGRAPH cells join their blocks with a single space (a GFM cell is one physical line); an
	// empty or nbsp-only cell becomes an empty cell. Word's per-cell text alignment is NOT mapped (the
	// alignment row is always the default `---`), matching the docx importer - a stated limitation, not a mangle.
	// Fail-soft: a table we cannot turn into a grid (no rows) is left byte-for-byte unchanged.
	function rebuildPastedTables(input: string): string {
		if (input.indexOf('<table') === -1 && input.indexOf('<TABLE') === -1) {
			return input;
		}

		// Resolve the small set of HTML entities a cell's text can carry, so the GFM holds real characters
		// (matching the docx importer). Named + numeric are handled; '&amp;' is resolved LAST so an escaped
		// sequence like '&amp;lt;' (the literal text '&lt;') decodes to '&lt;' and stops rather than to '<'.
		function decodeEntities(s: string): string {
			let out = s.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ');
			out = out.replace(/&#(\d+);/g, function (m, d) {
				const n = parseInt(d, 10);
				return n > 0 && n < 1114112 ? String.fromCodePoint(n) : m;
			});
			out = out.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
				const n = parseInt(h, 16);
				return n > 0 && n < 1114112 ? String.fromCodePoint(n) : m;
			});
			out = out.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, '\'');
			out = out.replace(/&amp;/gi, '&');
			return out;
		}

		// One table cell's inner HTML -> a single line of GFM cell text. Keeps explicit bold/italic/links as
		// inline Markdown (the subset GFM table cells support), drops Word junk, joins block breaks to a space,
		// resolves entities, collapses whitespace and escapes pipes. Pipe-only escaping mirrors the bundle's
		// own cell serializer (`ca`) so a paste and a parse->serialize round-trip write identical bytes.
		function cellToMarkdown(cellInner: string): string {
			let t = cellInner;
			// Word conditional-comment glyph blocks and any HTML comments.
			t = t.replace(/<!\[if[^\]]*\]>[\s\S]*?<!\[endif\]>/gi, '');
			t = t.replace(/<!--[\s\S]*?-->/g, '');
			// Office runs (usually empty spacers; a rare non-empty one still contributes only its text).
			t = t.replace(/<o:p>[\s\S]*?<\/o:p>/gi, '');
			// Links -> [text](href), before the generic tag strip so the href survives.
			t = t.replace(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, function (m, q, dq, sq, inner) {
				let href = dq !== undefined ? dq : (sq !== undefined ? sq : '');
				let label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
				label = label.replace(/^\s+/, '').replace(/\s+$/, '');
				href = href.replace(/^\s+/, '').replace(/\s+$/, '');
				if (href === '' || label === '') {
					return label;
				}
				return '[' + label + '](' + href + ')';
			});
			// Explicit bold / italic tags -> Markdown markers (matches the docx importer; span-based Word bold is
			// deliberately not inferred - it would double-wrap and is out of the issue's scope).
			t = t.replace(/<\s*(?:b|strong)\b[^>]*>/gi, '**').replace(/<\s*\/\s*(?:b|strong)\s*>/gi, '**');
			t = t.replace(/<\s*(?:i|em)\b[^>]*>/gi, '*').replace(/<\s*\/\s*(?:i|em)\s*>/gi, '*');
			// Block breaks inside a cell -> a single space (a GFM cell cannot hold a newline).
			t = t.replace(/<br\b[^>]*>/gi, ' ');
			t = t.replace(/<\/\s*(?:p|div)\s*>/gi, ' ');
			// Strip every remaining tag, keeping its text.
			t = t.replace(/<[^>]+>/g, '');
			t = decodeEntities(t);
			t = t.replace(/\s+/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
			// Escape pipes so a cell value can never be read as a column separator.
			return t.replace(/\|/g, '\\|');
		}

		// Serialise one <table>'s inner HTML to GFM pipe text. Returns '' when there are no rows (fail-soft).
		function tableToGfm(tableInner: string): string {
			// Collect source rows, each a list of cells with their span counts. thead/tbody/tfoot need no
			// special casing - every <tr> is walked in document order regardless of its section wrapper.
			const rows: Array<Array<{ text: string; colspan: number; rowspan: number }>> = [];
			const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
			let trm: RegExpExecArray | null;
			while ((trm = trRe.exec(tableInner)) !== null) {
				const cells: Array<{ text: string; colspan: number; rowspan: number }> = [];
				const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)\s*>/gi;
				let cm: RegExpExecArray | null;
				while ((cm = cellRe.exec(trm[1])) !== null) {
					const attrs = cm[2];
					let colspan = 1;
					let rowspan = 1;
					const csm = /\bcolspan\s*=\s*["']?(\d+)/i.exec(attrs);
					if (csm) {
						const cv = parseInt(csm[1], 10);
						if (cv > 1) {
							colspan = cv > 1000 ? 1000 : cv;
						}
					}
					const rsm = /\browspan\s*=\s*["']?(\d+)/i.exec(attrs);
					if (rsm) {
						const rv = parseInt(rsm[1], 10);
						if (rv > 1) {
							rowspan = rv > 1000 ? 1000 : rv;
						}
					}
					cells.push({ text: cellToMarkdown(cm[3]), colspan: colspan, rowspan: rowspan });
				}
				if (cells.length > 0) {
					rows.push(cells);
				}
			}
			if (rows.length === 0) {
				return '';
			}

			// Expand colspan/rowspan into a rectangular grid by the stated repeat rule. `pending` carries a
			// rowspan cell's content down into the later rows it still covers, keyed by the column it occupies.
			const grid: string[][] = [];
			const pending: { [col: number]: { text: string; left: number } } = {};
			for (let r = 0; r < rows.length; r++) {
				const outRow: string[] = [];
				let col = 0;
				const src = rows[r];
				for (let ci = 0; ci < src.length; ci++) {
					// Skip past columns still owned by a rowspan opened in an earlier row (fill from it).
					while (pending[col] && pending[col].left > 0) {
						outRow[col] = pending[col].text;
						pending[col].left--;
						col++;
					}
					const cell = src[ci];
					for (let k = 0; k < cell.colspan; k++) {
						outRow[col] = cell.text;
						if (cell.rowspan > 1) {
							pending[col] = { text: cell.text, left: cell.rowspan - 1 };
						}
						col++;
					}
				}
				// Trailing rowspan fills after this row ran out of its own cells.
				while (pending[col] && pending[col].left > 0) {
					outRow[col] = pending[col].text;
					pending[col].left--;
					col++;
				}
				grid.push(outRow);
			}

			// Rectangularise: pad every row to the widest, any gap becomes an empty cell.
			let width = 0;
			for (let g = 0; g < grid.length; g++) {
				if (grid[g].length > width) {
					width = grid[g].length;
				}
			}
			if (width === 0) {
				return '';
			}
			for (let g2 = 0; g2 < grid.length; g2++) {
				for (let c2 = 0; c2 < width; c2++) {
					if (grid[g2][c2] === undefined) {
						grid[g2][c2] = '';
					}
				}
				grid[g2].length = width;
			}

			// Serialise header / default-alignment row / body. Byte-identical in shape to the bundle's `xh`
			// and the in-place editor's serializeGfmTable, so a pasted table and a round-trip agree on disk.
			const lines: string[] = [];
			lines.push('| ' + grid[0].join(' | ') + ' |');
			const marks: string[] = [];
			for (let mc = 0; mc < width; mc++) {
				marks.push('---');
			}
			lines.push('| ' + marks.join(' | ') + ' |');
			for (let br = 1; br < grid.length; br++) {
				lines.push('| ' + grid[br].join(' | ') + ' |');
			}
			return lines.join('\n');
		}

		// Escape the GFM for a double-quoted HTML attribute value; getAttribute('data-md') resolves these
		// back to the exact GFM the table_block node stores as its `markdown`. Newlines are legal inside a
		// quoted attribute value and are preserved, so the multi-line pipe table survives intact.
		function attrEscape(s: string): string {
			return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		}

		// Non-greedy so sibling tables become separate matches; a genuinely nested table degrades to its
		// inner </table> (Word does not nest tables in this export path - stated limitation, never a crash).
		const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
		return input.replace(tableRe, function (whole, inner) {
			let gfm = '';
			try {
				gfm = tableToGfm(inner);
			} catch (e) {
				gfm = '';
			}
			if (!gfm) {
				return whole;
			}
			return '<table data-md="' + attrEscape(gfm) + '"></table>';
		});
	}

	// Ordered transform chain. Headings are rewritten to real <hN> first (#256) so a heading paragraph is never
	// swept into a later step; #138 (tables) appends its step last, so cells are serialised AFTER the office
	// spacers, Word headings, Word lists and tracked-changes residue inside them have already been cleaned.
	const transforms: Array<(input: string) => string> = [stripOfficeSpacers, rewriteWordHeadings, rebuildWordLists, stripTrackedChanges, rebuildPastedTables];
	let out = html;
	for (let i = 0; i < transforms.length; i++) {
		out = transforms[i](out);
	}
	return out;
}

/**
 * Detect the "named and dropped" structures a Word CLIPBOARD payload actually carried, so the paste honesty
 * notice names a limitation only when it truly applies (never a fabricated caveat). Only the structures a
 * clipboard fragment can carry are probed: tracked-change marks (the normaliser keeps the FINAL text and drops
 * the mark, mirroring the docx importer) and Word comment anchors. Footnotes / text boxes / headers-footers
 * never survive into clipboard HTML, so they stay false. Host-side only - not injected into the webview.
 */
function detectWordPasteDrops(html: string): IDocxDetections {
	const base = noDetections();
	if (typeof html !== 'string' || html.length === 0) {
		return base;
	}
	// Tracked changes: a <del>/<ins> element or Word's msoDel/msoIns revision spans (the same residue the
	// normaliser resolves paste-as-accepted). Guarded so a legit hand-authored <del>/<ins> in NON-Word HTML is
	// not counted - the whole notice only runs for Word/Office payloads (see wordPasteNotice's isWordHtml gate).
	const trackedChanges = /class\s*=\s*"?[^">]*mso(?:Del|Ins)\b/i.test(html)
		|| (/<(?:del|ins)\b/i.test(html) && /mso[-A-Za-z]|urn:schemas-microsoft-com:office/i.test(html));
	// Comments: Word anchors a comment with a `class=msoComment*` span / a `<w:commentReference>` / a
	// `[if !supportAnnotations]` conditional block. The comment BODY is not in the clipboard fragment, so the
	// mark is dropped on paste - named honestly here.
	const comments = /class\s*=\s*"?[^">]*msoComment/i.test(html)
		|| /commentReference|supportAnnotations/i.test(html);
	return { ...base, trackedChanges, comments };
}

/**
 * Build the plain-words kept/dropped honesty notice for a Word CLIPBOARD paste (issue #256), reusing the docx
 * IMPORT pipeline's converter and summary so a pasted document and an imported one name kept/dropped
 * IDENTICALLY. The cleaned HTML (the exact bytes handed to ProseMirror) is fed through `convertDocxHtml` for the
 * real feature tally (headings, tables, lists, images, bold/italic, links, quotes), and the drops the clipboard
 * fragment actually carried are detected separately. Returns a single line only when something was genuinely
 * dropped - a lossless paste returns `null`, so the notice never cries wolf. Non-Word HTML returns `null`
 * (out of scope). Host-side only (imports the docx converter); the webview posts the raw HTML for this to run.
 */
export function wordPasteNotice(html: string): string | null {
	if (!isWordHtml(html)) {
		return null;
	}
	const detections = detectWordPasteDrops(html);
	// Feed the SAME cleaned HTML that ProseMirror receives through the import converter, so the "kept" phrases
	// reflect exactly what landed (the stem is unused here - the paste path lifts no images to an assets folder).
	// The table step emits `<table data-md="GFM">` (an empty element carrying the pipe table in an attribute); a
	// minimal real <table> is reconstituted from the header row of that GFM so convertDocxHtml still tallies the
	// table as a kept feature (the notice must NOT under-report what survived).
	const cleaned = normalizeWordPasteHtml(html).replace(/<table\s+data-md="([\s\S]*?)"\s*>\s*<\/table>/gi, function (m, md) {
		const first = String(md).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').split('\n')[0];
		const heads = first.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => '<td>' + c.replace(/^\s+/, '').replace(/\s+$/, '') + '</td>').join('');
		return '<table><tr>' + heads + '</tr></table>';
	});
	const conversion = convertDocxHtml(cleaned, 'paste', detections);
	if (conversion.dropped.length === 0) {
		return null;
	}
	return formatImportSummary(conversion.kept, conversion.dropped);
}
