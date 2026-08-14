/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { findInText, findMatches, findStatusLabel, replaceInText, stepMatchIndex } from '../common/livingDocFind.js';

// The in-document find & replace widget (plan 52 WP-E), as three strings the editor's webview shell splices
// in: its CSS, its markup, and its runtime. It is kept in its own module - rather than added to the already
// 1400-line `livingDocRender.ts` - so the shell's diff stays six one-line splices, which is what keeps this
// package rebaseable against the lanes editing that same file.
//
// WHERE THE WIDGET LIVES, AND WHY. The document body is an out-of-process iframe (a VS Code webview), so the
// find either lives inside it or in the pane host outside it. It lives INSIDE, as host-authored JS injected
// into the webview - the same seam the inline-widget report (#302) and the paste-boundary guard (#256) use.
// Three reasons:
//   1. Everything a find needs is in the iframe. The matches, their client rectangles, the scroll container
//      and the ProseMirror view are all in there; a host-side widget would have to round-trip a postMessage
//      per keystroke just to show a count, and a second round-trip per step to scroll.
//   2. Focus. `Esc` must hand focus back to the document. Inside the frame that is one `view.focus()` call;
//      across the frame boundary it is a message plus a webview focus dance that the OOPIF can lose.
//   3. Overlaying workbench DOM on top of an out-of-process webview is the fragile arrangement VS Code's own
//      webview find widget has to fight; not doing it avoids the whole class of z-order and focus bugs.
//
// No ProseMirror bundle rebuild was needed. Everything the runtime touches - `state.doc.descendants`,
// `domAtPos`, `tr.insertText`, `tr.setNodeMarkup`, `dispatch`, `focus` - is stock EditorView/Transaction API
// already present on the vendored view object, exactly as the table-cell shim already relies on.

/** The widget's CSS, appended to the webview shell's stylesheet. */
export const FIND_WIDGET_STYLE = `
/* In-document find (plan 52 WP-E). A calm floating card over the document, never a second editor chrome. */
.lwd-find{position:fixed;top:56px;right:24px;z-index:40;display:flex;flex-direction:column;gap:6px;padding:9px 10px;background:#fff;border:1px solid #e6e8ec;border-radius:10px;box-shadow:0 10px 30px rgba(15,22,40,.16)}
.lwd-find[hidden]{display:none}
.lwd-find .lf-row{display:flex;align-items:center;gap:6px}
.lwd-find input{width:190px;height:26px;box-sizing:border-box;padding:0 8px;border:1px solid #e2e5ea;border-radius:6px;background:#fbfbfc;color:#23262c;font:400 12.5px/1 system-ui;outline:none}
.lwd-find input:focus{border-color:oklch(0.66 0.16 45 / .55);background:#fff}
.lwd-find .lf-count{min-width:74px;text-align:right;font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#8b909a;white-space:nowrap}
.lwd-find button{height:26px;min-width:26px;padding:0 6px;border:1px solid #e6e8ec;border-radius:6px;background:#fff;color:#52575f;font:500 12px/1 system-ui;cursor:pointer}
.lwd-find button:hover{background:#f6f7f9;border-color:#d8dce2}
.lwd-find button:disabled{opacity:.42;cursor:default}
.lwd-find .lf-act{font:500 11.5px/1 system-ui;padding:0 9px}
/* Matches are painted with the CSS Custom Highlight API, so NOTHING is inserted into the document's DOM:
   ProseMirror's own DOM invariants - and the pending inline-diff widgets sitting in it - are untouched. */
::highlight(lwd-find){background:#ffe9a3;color:#1a1c20}
::highlight(lwd-find-current){background:oklch(0.78 0.17 60);color:#1a1c20}`;

// Escape a localised label for use as HTML text / an attribute value.
function esc(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FIND_LABEL = localize('livingDocs.find.find', "Find");
const REPLACE_LABEL = localize('livingDocs.find.replace', "Replace");
const PREVIOUS_LABEL = localize('livingDocs.find.previous', "Previous Match (Shift+Enter)");
const NEXT_LABEL = localize('livingDocs.find.next', "Next Match (Enter)");
const CLOSE_LABEL = localize('livingDocs.find.close', "Close (Escape)");
const REPLACE_ALL_LABEL = localize('livingDocs.find.replaceAll', "Replace All");
const NO_RESULTS_LABEL = localize('livingDocs.find.noResults', "No results");
const OF_TEMPLATE = localize('livingDocs.find.countOf', "{0} of {1}");

/**
 * The widget's markup, placed as a SIBLING of `#lwd-root` rather than inside it: the shell replaces
 * `#lwd-root`'s innerHTML on every render, which would otherwise destroy the widget (and the query in it)
 * every time the document saved.
 */
export const FIND_WIDGET_HTML = `<div id="lwd-find" class="lwd-find" hidden>`
	+ `<div class="lf-row">`
	+ `<input data-find-input type="text" aria-label="${esc(FIND_LABEL)}" placeholder="${esc(FIND_LABEL)}">`
	+ `<span class="lf-count" data-find-count aria-live="polite">${esc(NO_RESULTS_LABEL)}</span>`
	+ `<button data-find-act="prev" title="${esc(PREVIOUS_LABEL)}" aria-label="${esc(PREVIOUS_LABEL)}">&uarr;</button>`
	+ `<button data-find-act="next" title="${esc(NEXT_LABEL)}" aria-label="${esc(NEXT_LABEL)}">&darr;</button>`
	+ `<button data-find-act="close" title="${esc(CLOSE_LABEL)}" aria-label="${esc(CLOSE_LABEL)}">&#10005;</button>`
	+ `</div>`
	+ `<div class="lf-row">`
	+ `<input data-find-replace-input type="text" aria-label="${esc(REPLACE_LABEL)}" placeholder="${esc(REPLACE_LABEL)}">`
	+ `<button class="lf-act" data-find-act="replace">${esc(REPLACE_LABEL)}</button>`
	+ `<button class="lf-act" data-find-act="replaceAll">${esc(REPLACE_ALL_LABEL)}</button>`
	+ `</div></div>`;

// The matcher is injected VERBATIM (the `String(fn)` seam the GFM table helpers already use), so the widget
// running in the webview and the unit tests in test/browser/livingDocFind.test.ts are literally the same
// code. Each function is asserted self-contained by that test, so the interpolated source dangles on nothing.
const FIND_PURE = [findInText, findMatches, stepMatchIndex, replaceInText, findStatusLabel].map(fn => String(fn)).join('\n');

/**
 * The widget's runtime, appended to the webview shell's RUNTIME script (so it shares that scope and can
 * reach `pmView`, `root` and the injected GFM table helpers). Exposes `openFind()` (called by the host's
 * Cmd+F action) and `findRefresh()` (called whenever the document changes underneath an open widget).
 */
export const FIND_WIDGET_RUNTIME = `${FIND_PURE}
// ---- In-document find & replace (plan 52 WP-E) --------------------------------------------------
const FIND_LABELS = { ofTemplate: ${JSON.stringify(OF_TEMPLATE)}, noResults: ${JSON.stringify(NO_RESULTS_LABEL)} };
const findEl = document.getElementById('lwd-find');
const findInput = findEl ? findEl.querySelector('[data-find-input]') : null;
const findRepInput = findEl ? findEl.querySelector('[data-find-replace-input]') : null;
const findCountEl = findEl ? findEl.querySelector('[data-find-count]') : null;
// The live search state: the document's searchable segments, the matches across ALL of them, and which one
// is current (-1 = none). Rebuilt from the document on every keystroke, so the count can never go stale.
let findSegs = [], findHits = [], findCur = -1;
// Build the searchable segments from the LIVE ProseMirror document, in document order. A segment is a
// maximal contiguous run of TEXT nodes inside one textblock, so:
//   - a query matches across inline formatting (\`**bo**ld\` is two text nodes but one segment, "bold");
//   - a query never matches across a block boundary (each paragraph/heading/list item/code block is its own);
//   - an inline ATOM (an image, a bound figure) BREAKS the run, so a match can never straddle one and a
//     replace can never land inside one.
// Because consecutive text nodes occupy consecutive ProseMirror positions, a segment's characters map to
// document positions by simple addition from \`from\`. Tables are atoms holding their GFM source in a node
// attribute, so each CELL contributes a segment carrying what a write-back needs (the table's position, its
// markdown, and the cell's coordinates).
function findBuildSegments(){
	const segs = [];
	if (!pmView) { return segs; }
	let tIdx = -1;
	pmView.state.doc.descendants(function(node, pos){
		if (node.type && node.type.name === 'table_block'){
			tIdx++;
			const md = node.attrs.markdown || '';
			const t = parseGfmTable(md);
			for (let c = 0; c < t.header.length; c++){ segs.push({ text: t.header[c], tIdx: tIdx, tPos: pos, tMd: md, r: -1, c: c }); }
			for (let r = 0; r < t.rows.length; r++){ for (let c = 0; c < t.rows[r].length; c++){ segs.push({ text: t.rows[r][c], tIdx: tIdx, tPos: pos, tMd: md, r: r, c: c }); } }
			return false;
		}
		if (node.isTextblock){
			let run = null;
			node.forEach(function(child, offset){
				if (child.isText){
					if (!run){ run = { text: '', from: pos + 1 + offset }; segs.push(run); }
					run.text += child.text;
				} else { run = null; }
			});
			return false;
		}
		return true;
	});
	return segs;
}
function findQuery(){ return findInput ? findInput.value : ''; }
function findIsOpen(){ return !!(findEl && !findEl.hidden); }
// Paint every match, with the current one in its own stronger colour, using the CSS Custom Highlight API.
// Nothing is inserted into the document DOM, so a pending proposal's inline diff widgets cannot be disturbed.
function findPaint(){
	if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function'){ return; }
	const all = new Highlight(), cur = new Highlight();
	for (let i = 0; i < findHits.length; i++){
		const r = findRangeFor(findHits[i]);
		if (!r){ continue; }
		all.add(r);
		if (i === findCur){ cur.add(r); }
	}
	CSS.highlights.set('lwd-find', all);
	CSS.highlights.set('lwd-find-current', cur);
}
function findClearPaint(){ if (window.CSS && CSS.highlights){ CSS.highlights.delete('lwd-find'); CSS.highlights.delete('lwd-find-current'); } }
// Place a range over [start, end) of an element's concatenated text nodes. Used for a table cell, whose DOM
// is built by the table atom's node view rather than mapped by ProseMirror positions.
function findRangeInElement(el, start, end){
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
	const range = document.createRange();
	let at = 0, node = walker.nextNode(), gotStart = false;
	while (node){
		const len = node.nodeValue.length;
		if (!gotStart && start <= at + len){ range.setStart(node, start - at); gotStart = true; }
		if (gotStart && end <= at + len){ range.setEnd(node, end - at); return range; }
		at += len;
		node = walker.nextNode();
	}
	return null;
}
// The concatenated text of an element's text nodes - what the reader actually sees in a table cell.
function findElementText(el){
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
	let out = '', node = walker.nextNode();
	while (node){ out += node.nodeValue; node = walker.nextNode(); }
	return out;
}
// The DOM Range covering one match. A text match resolves both ends through ProseMirror's own position->DOM
// mapping, so decoration widgets are skipped by construction. A table-cell match is placed over the cell's
// own text nodes when the cell's RENDERED text equals its GFM source (the ordinary case, so the highlight is
// character-exact); when the cell carries inline markdown the two differ by the syntax characters, there is no
// exact mapping, and marking the whole cell is the honest thing to show rather than a highlight off by the
// width of a `**`.
function findRangeFor(hit){
	const seg = findSegs[hit.segment];
	if (!seg || !pmView){ return null; }
	try {
		const range = document.createRange();
		if (seg.tPos !== undefined){
			const cell = cellAt(tablesInView()[seg.tIdx], { r: seg.r, c: seg.c });
			if (!cell){ return null; }
			if (findElementText(cell) === seg.text){
				const exact = findRangeInElement(cell, hit.start, hit.end);
				if (exact){ return exact; }
			}
			range.selectNodeContents(cell);
			return range;
		}
		const a = pmView.domAtPos(seg.from + hit.start, 1);
		const b = pmView.domAtPos(seg.from + hit.end, -1);
		range.setStart(a.node, a.offset);
		range.setEnd(b.node, b.offset);
		return range;
	} catch (e) { return null; }
}
// Scroll the current match to the middle of the surface when it is not comfortably in view. The webview's
// own window is the scroller (html/body are full-height and the document overflows them).
function findScrollToCurrent(){
	const hit = findHits[findCur];
	if (!hit){ return; }
	const r = findRangeFor(hit);
	if (!r){ return; }
	const box = r.getBoundingClientRect();
	if (!box.height && !box.width){ return; }
	if (box.top >= 96 && box.bottom <= window.innerHeight - 48){ return; }
	window.scrollBy({ top: box.top - window.innerHeight / 2, behavior: 'smooth' });
}
// Re-read the document, recompute every match and repaint. \`keepCurrent\` holds the reader's place across a
// replace or an edit; otherwise a fresh query lands on the first match, which is what makes typing feel live.
function findRun(keepCurrent, scroll){
	if (!findIsOpen()){ return; }
	findSegs = findBuildSegments();
	const texts = [];
	for (let i = 0; i < findSegs.length; i++){ texts.push(findSegs[i].text); }
	findHits = findMatches(texts, findQuery());
	if (!findHits.length){ findCur = -1; }
	else if (!keepCurrent || findCur < 0){ findCur = 0; }
	else if (findCur >= findHits.length){ findCur = findHits.length - 1; }
	if (findCountEl){ findCountEl.textContent = findStatusLabel(findHits.length, findCur, FIND_LABELS); }
	findPaint();
	if (scroll){ findScrollToCurrent(); }
}
/** Re-run an OPEN find after the document changed underneath it (a keystroke, a save, an approved proposal). */
function findRefresh(){ if (findIsOpen()){ findRun(true, false); } }
function findStep(delta){
	if (!findHits.length){ return; }
	findCur = stepMatchIndex(findHits.length, findCur, delta);
	if (findCountEl){ findCountEl.textContent = findStatusLabel(findHits.length, findCur, FIND_LABELS); }
	findPaint();
	findScrollToCurrent();
}
// Apply a set of matches as ONE ProseMirror transaction, so a replace-all is a single undo step and fires the
// normal debounced save exactly once. Edits are applied in DESCENDING document position, which keeps every
// remaining position valid against the original document. A table's cells are folded into one node-attribute
// write (the same \`setNodeMarkup\` seam in-place cell editing already uses).
function findApplyReplace(hits, replacement){
	if (!pmView || !hits.length){ return 0; }
	const edits = [], tables = Object.create(null);
	const bySeg = Object.create(null);
	for (let i = 0; i < hits.length; i++){ (bySeg[hits[i].segment] = bySeg[hits[i].segment] || []).push(hits[i]); }
	for (const key in bySeg){
		const seg = findSegs[key], list = bySeg[key];
		if (!seg){ continue; }
		if (seg.tPos !== undefined){
			let entry = tables[seg.tIdx];
			if (!entry){ entry = tables[seg.tIdx] = { pos: seg.tPos, t: parseGfmTable(seg.tMd) }; }
			entry.t = setCell(entry.t, seg.r, seg.c, replaceInText(seg.text, list, replacement));
		} else {
			for (let i = 0; i < list.length; i++){ edits.push({ pos: seg.from + list[i].start, to: seg.from + list[i].end }); }
		}
	}
	for (const k in tables){ edits.push({ pos: tables[k].pos, md: serializeGfmTable(tables[k].t) }); }
	edits.sort(function(a, b){ return b.pos - a.pos; });
	let tr = pmView.state.tr;
	for (let i = 0; i < edits.length; i++){
		const ed = edits[i];
		if (ed.md !== undefined){ tr = tr.setNodeMarkup(ed.pos, null, { markdown: ed.md }); }
		else if (replacement){ tr = tr.insertText(replacement, ed.pos, ed.to); }
		else { tr = tr.delete(ed.pos, ed.to); }
	}
	pmView.dispatch(tr);
	return hits.length;
}
function findReplaceCurrent(){
	const hit = findHits[findCur];
	if (!hit || !findQuery()){ return; }
	findApplyReplace([hit], findRepInput ? findRepInput.value : '');
	findRun(true, true);
}
function findReplaceAll(){
	if (!findHits.length || !findQuery()){ return; }
	findApplyReplace(findHits, findRepInput ? findRepInput.value : '');
	findRun(false, true);
}
// Open (or re-focus) the widget. Re-pressing Cmd+F on an open widget selects the query, the way every find
// box behaves, so the chord is idempotent however it arrives - from this frame or from the host's action.
function openFind(){
	if (!findEl || !findInput){ return; }
	const wasOpen = findIsOpen();
	findEl.hidden = false;
	// Sit the card clear of whatever chrome is sticky at the top (the toolbar, and the review bar when a
	// proposal is pending), measured rather than guessed so a pending proposal never hides the widget.
	let top = 12;
	const bars = root ? root.querySelectorAll('.etoolbar, .reviewbar, .rawtop') : [];
	for (let i = 0; i < bars.length; i++){ const b = bars[i].getBoundingClientRect(); if (b.height){ top = Math.max(top, b.bottom + 10); } }
	findEl.style.top = top + 'px';
	// Seed from a single-line selection in the document, the way a find box is expected to.
	if (!wasOpen && pmView){
		try {
			const sel = pmView.state.selection;
			if (!sel.empty){
				const seeded = pmView.state.doc.textBetween(sel.from, sel.to, '', '');
				if (seeded && seeded.indexOf('\\n') < 0){ findInput.value = seeded; }
			}
		} catch (e) {}
	}
	findInput.focus();
	findInput.select();
	findRun(false, true);
}
function closeFind(){
	if (!findIsOpen()){ return; }
	findEl.hidden = true;
	findHits = []; findCur = -1;
	findClearPaint();
	if (pmView){ try { pmView.focus(); } catch (e) {} }
}
function findAct(act){
	if (act === 'next'){ return findStep(1); }
	if (act === 'prev'){ return findStep(-1); }
	if (act === 'replace'){ return findReplaceCurrent(); }
	if (act === 'replaceAll'){ return findReplaceAll(); }
	if (act === 'close'){ return closeFind(); }
}
if (findEl){
	// Buttons act on mousedown with preventDefault so the find input never loses focus to the click.
	findEl.addEventListener('mousedown', function(e){
		const b = e.target.closest && e.target.closest('button[data-find-act]');
		if (!b){ return; }
		e.preventDefault();
		findAct(b.getAttribute('data-find-act'));
	});
	// Only the FIND box re-runs the search; typing a replacement must not throw the reader off their match.
	findEl.addEventListener('input', function(e){ if (e.target === findInput){ findRun(false, true); } });
	findEl.addEventListener('keydown', function(e){
		if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); return closeFind(); }
		if (e.key === 'Enter'){
			e.preventDefault(); e.stopPropagation();
			if (e.target === findRepInput){ return findReplaceCurrent(); }
			return findStep(e.shiftKey ? -1 : 1);
		}
	});
}
// Cmd/Ctrl+F anywhere in the document opens the find. Taken in the CAPTURE phase on this frame's document so
// it beats ProseMirror's own key handling AND runs before the webview host script's window-level listener,
// whose job is to forward unhandled keys to the workbench: stopping propagation here means the chord is
// answered once, in the frame that owns the document, with no round trip. Shift is excluded so the (already
// neutralised) Cmd+Shift+F chord is not caught by accident.
document.addEventListener('keydown', function(e){
	if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')){
		e.preventDefault(); e.stopPropagation();
		return openFind();
	}
	// Escape from the document closes an open find. An Escape inside another overlay's own input (the table
	// cell editor) belongs to that overlay, so it is left alone.
	if (e.key === 'Escape' && findIsOpen() && findEl && !findEl.contains(e.target) && !(e.target && e.target.tagName === 'INPUT')){
		e.preventDefault(); e.stopPropagation();
		return closeFind();
	}
}, true);`;
