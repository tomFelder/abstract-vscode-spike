/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWordHtml, normalizeWordPasteHtml, pasteStartShouldClose, wordPasteNotice } from '../../common/livingDocWordPaste.js';
import { PROSEMIRROR_BUNDLE_BASE64 } from '../../browser/prosemirrorBundle.js';

// Pull the GFM Markdown out of a `<table data-md="...">` element the normaliser emits, resolving the HTML
// attribute entities back to the real characters (the value the table_block node reads via getAttribute).
function extractDataMd(html: string): string {
	const m = /data-md="([\s\S]*?)"/.exec(html);
	if (!m) { throw new Error('no data-md attribute in: ' + html); }
	return m[1]
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

// The vendored ProseMirror bundle's headless surface (see prosemirrorBundle.test.ts): roundTrip parses
// Markdown -> doc -> Markdown, docJSON parses Markdown -> doc JSON. Because the table_block node reads its
// `markdown` attr verbatim from `data-md`, feeding the emitted GFM through these proves the pasted table
// genuinely becomes a table_block and serialises back to the same GFM via the REAL bundle.
interface ILwdpmSurface {
	roundTrip(markdown: string): string;
	docJSON(markdown: string): unknown;
}
function loadLwdpm(): ILwdpmSurface {
	const code = decodeBase64(PROSEMIRROR_BUNDLE_BASE64).toString();
	const sandbox: { LWDPM?: ILwdpmSurface } = {};
	new Function('window', code)(sandbox);
	if (!sandbox.LWDPM) { throw new Error('vendored ProseMirror bundle did not define window.LWDPM'); }
	return sandbox.LWDPM;
}

// The list block from the synthesised Word clipboard fixture
// (docs/plans/39-verify/fixtures/word-clipboard-report.html): a 2-level bullet list carried as
// MsoListParagraph* paragraphs, the glyph inside a `mso-list:Ignore` span behind supportLists comments,
// and the nesting level in the paragraph style (`mso-list:l0 level2 lfo1`).
const WORD_LIST_BLOCK = [
	`<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span`,
	`style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:`,
	`Symbol'><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`,
	`</span></span></span><![endif]>Pipeline grew in EMEA<o:p></o:p></p>`,
	``,
	`<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;`,
	`mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";`,
	`mso-fareast-font-family:"Courier New"'><span style='mso-list:Ignore'>o<span`,
	`style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`,
	`</span></span></span><![endif]>Two new enterprise logos<o:p></o:p></p>`,
	``,
	`<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;`,
	`mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";`,
	`mso-fareast-font-family:"Courier New"'><span style='mso-list:Ignore'>o<span`,
	`style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`,
	`</span></span></span><![endif]>Renewal rate held at 96%<o:p></o:p></p>`,
	``,
	`<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span`,
	`style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:`,
	`Symbol'><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`,
	`</span></span></span><![endif]>Hiring paused in G&amp;A<o:p></o:p></p>`,
].join('\n');

// The MsoTableGrid table from the same fixture (docs/plans/39-verify/fixtures/word-clipboard-report.html):
// a 6-row grid whose header's first cell is a `colspan=2` merge ("Region & Segment"), each cell wrapped in a
// `<p class=MsoNormal>` with an <o:p> spacer, verbatim from Word's clipboard export (line wrapping included).
const WORD_TABLE_BLOCK = [
	`<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0`,
	` style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;`,
	` mso-yfti-tbllook:1184;mso-padding-alt:0cm 5.4pt 0cm 5.4pt'>`,
	` <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>`,
	`  <td width=302 colspan=2 valign=top style='width:226.3pt;border:solid windowtext 1.0pt;`,
	`  mso-border-alt:solid windowtext .5pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal><b>Region &amp; Segment</b><o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='width:113.15pt;border:solid windowtext 1.0pt;`,
	`  border-left:none;mso-border-left-alt:solid windowtext .5pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal><b>Revenue</b><o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='width:113.15pt;border:solid windowtext 1.0pt;`,
	`  border-left:none;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal><b>Growth</b><o:p></o:p></p>`,
	`  </td>`,
	` </tr>`,
	` <tr style='mso-yfti-irow:1'>`,
	`  <td width=151 valign=top style='width:113.15pt;border:solid windowtext 1.0pt;`,
	`  border-top:none;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>AMER<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='width:113.15pt;border-top:none;border-left:`,
	`  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>Enterprise<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='width:113.15pt;border-top:none;border-left:`,
	`  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>$21,300<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='width:113.15pt;border-top:none;border-left:`,
	`  none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>+8%<o:p></o:p></p>`,
	`  </td>`,
	` </tr>`,
	` <tr style='mso-yfti-irow:2'>`,
	`  <td width=151 valign=top style='border:solid windowtext 1.0pt;border-top:none;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>AMER<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>SMB<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>$9,900<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>+15%<o:p></o:p></p>`,
	`  </td>`,
	` </tr>`,
	` <tr style='mso-yfti-irow:3'>`,
	`  <td width=151 valign=top style='border:solid windowtext 1.0pt;border-top:none;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>EMEA<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>Enterprise<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>$12,400<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>+19%<o:p></o:p></p>`,
	`  </td>`,
	` </tr>`,
	` <tr style='mso-yfti-irow:4'>`,
	`  <td width=151 valign=top style='border:solid windowtext 1.0pt;border-top:none;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>EMEA<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>SMB<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>$4,100<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>+11%<o:p></o:p></p>`,
	`  </td>`,
	` </tr>`,
	` <tr style='mso-yfti-irow:5;mso-yfti-lastrow:yes'>`,
	`  <td width=151 valign=top style='border:solid windowtext 1.0pt;border-top:none;`,
	`  padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>APAC<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>All<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>$2,100<o:p></o:p></p>`,
	`  </td>`,
	`  <td width=151 valign=top style='border-top:none;border-left:none;border-bottom:`,
	`  solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>`,
	`  <p class=MsoNormal>+3%<o:p></o:p></p>`,
	`  </td>`,
	` </tr>`,
	`</table>`,
].join('\n');

// The exact GFM the fixture table serialises to: the colspan=2 header cell repeats across both columns it
// merges (the stated merged-cell rule), bold survives as `**...**`, and `&amp;` resolves to a literal `&`.
const WORD_TABLE_GFM = [
	'| **Region & Segment** | **Region & Segment** | **Revenue** | **Growth** |',
	'| --- | --- | --- | --- |',
	'| AMER | Enterprise | $21,300 | +8% |',
	'| AMER | SMB | $9,900 | +15% |',
	'| EMEA | Enterprise | $12,400 | +19% |',
	'| EMEA | SMB | $4,100 | +11% |',
	'| APAC | All | $2,100 | +3% |',
].join('\n');

// Collapse whitespace between tags so structural assertions are robust to the source's line wrapping.
function squash(html: string): string {
	return html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

suite('LivingDoc Word paste', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rebuilds a 2-level Word bullet list into real nested <ul>/<li> (4 items, 2 levels)', () => {
		const out = squash(normalizeWordPasteHtml(WORD_LIST_BLOCK));
		// The fixture's list block becomes one nested bullet list: two level-1 items, two level-2 items
		// nested inside the first, in order.
		assert.strictEqual(
			out,
			'<ul><li>Pipeline grew in EMEA<ul><li>Two new enterprise logos</li>'
			+ '<li>Renewal rate held at 96%</li></ul></li><li>Hiring paused in G&amp;A</li></ul>'
		);
		// No glyph characters and no nbsp runs survive as document text.
		assert.ok(!/&middot;/.test(out), 'middot glyph entity stripped');
		assert.ok(!/mso-list/i.test(out), 'mso-list markup stripped');
		assert.ok(!/&nbsp;/i.test(out), 'nbsp spacer runs stripped');
		assert.ok(out.indexOf('<o:p>') === -1, 'empty office runs stripped');
	});

	test('preserves inline marks inside list items (bold survives)', () => {
		const block = `<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'>`
			+ `<![if !supportLists]><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt'>&nbsp;</span></span></span><![endif]>`
			+ `Pipeline grew in <b>EMEA</b><o:p></o:p></p>`;
		const out = squash(normalizeWordPasteHtml(block));
		assert.strictEqual(out, '<ul><li>Pipeline grew in <b>EMEA</b></li></ul>');
	});

	test('detects ordered lists from a number glyph and builds <ol>', () => {
		const block = [
			`<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'>`
			+ `<![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt'>&nbsp;</span></span></span><![endif]>First step<o:p></o:p></p>`,
			`<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'>`
			+ `<![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt'>&nbsp;</span></span></span><![endif]>Second step<o:p></o:p></p>`,
		].join('\n');
		const out = squash(normalizeWordPasteHtml(block));
		assert.strictEqual(out, '<ol><li>First step</li><li>Second step</li></ol>');
	});

	test('a lettered glyph (a) / a. ) is ordered; a Courier "o" sub-bullet stays a bullet', () => {
		const lettered = `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>`
			+ `<![if !supportLists]><span style='mso-list:Ignore'>a)<span style='font:7.0pt'>&nbsp;</span></span></span><![endif]>Alpha<o:p></o:p></p>`;
		assert.strictEqual(squash(normalizeWordPasteHtml(lettered)), '<ol><li>Alpha</li></ol>');
		const circle = `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>`
			+ `<![if !supportLists]><span style='mso-list:Ignore'>o<span style='font:7.0pt'>&nbsp;</span></span></span><![endif]>Circle<o:p></o:p></p>`;
		assert.strictEqual(squash(normalizeWordPasteHtml(circle)), '<ul><li>Circle</li></ul>');
	});

	test('non-list Word HTML passes through byte-identical (apart from empty <o:p> spacer cleanup)', () => {
		// A plain Word paragraph with no list markup and no empty office runs is returned unchanged.
		const para = `<p class=MsoNormal>This week&#8217;s revenue reached <b>$49,800</b>, `
			+ `see the <a href="https://example.com/dashboard">dashboard</a>.</p>`;
		assert.strictEqual(normalizeWordPasteHtml(para), para);
	});

	test('non-list content around a list run is preserved; a table between paragraphs becomes table[data-md]', () => {
		const html = `<h1>Q3 Weekly Report</h1>\n`
			+ `<p class=MsoNormal>Intro paragraph.<o:p></o:p></p>\n`
			+ WORD_LIST_BLOCK + `\n`
			+ `<table class=MsoTableGrid><tr><td><p class=MsoNormal>AMER<o:p></o:p></p></td></tr></table>\n`
			+ `<p class=MsoNormal>Closing paragraph.<o:p></o:p></p>`;
		const out = normalizeWordPasteHtml(html);
		// The heading and the surrounding paragraphs survive verbatim (text-wise).
		assert.ok(out.indexOf('<h1>Q3 Weekly Report</h1>') !== -1, 'heading preserved');
		assert.ok(out.indexOf('Intro paragraph.') !== -1, 'intro preserved');
		assert.ok(out.indexOf('Closing paragraph.') !== -1, 'closing preserved');
		// The pasted table is now converted to a table[data-md] element the table_block node parses (#138):
		// the old MsoTableGrid markup is gone and the cell text lives inside the GFM the attribute carries.
		assert.ok(out.indexOf('MsoTableGrid') === -1, 'original Word table markup replaced');
		assert.ok(out.indexOf('<table data-md="') !== -1, 'table[data-md] emitted');
		assert.strictEqual(extractDataMd(out), '| AMER |\n| --- |');
		// The list became a real nested list between them.
		assert.ok(squash(out).indexOf('<ul><li>Pipeline grew in EMEA<ul>') !== -1, 'list rebuilt in place');
	});

	test('strips Word empty <o:p> spacer paragraphs (the nbsp crumbs)', () => {
		const html = `<p class=MsoNormal>Real text.<o:p></o:p></p>\n<p class=MsoNormal><o:p>&nbsp;</o:p></p>`;
		const out = normalizeWordPasteHtml(html);
		assert.ok(out.indexOf('Real text.') !== -1, 'real paragraph kept');
		assert.ok(out.indexOf('<o:p>') === -1, 'empty office runs removed');
		assert.ok(!/<p[^>]*>\s*<\/p>/.test(out), 'blank spacer paragraph removed');
	});

	test('isWordHtml sniffs Word/Office markers and ignores plain HTML', () => {
		assert.strictEqual(isWordHtml(`<p class=MsoListParagraph style='mso-list:l0 level1'>x</p>`), true);
		assert.strictEqual(isWordHtml(`<html xmlns:o="urn:schemas-microsoft-com:office:office"><p>x</p></html>`), true);
		assert.strictEqual(isWordHtml('<p>plain paragraph</p>'), false);
		assert.strictEqual(isWordHtml('<ul><li>a real list</li></ul>'), false);
		assert.strictEqual(isWordHtml(''), false);
	});

	test('fail-soft on empty / non-string input', () => {
		assert.strictEqual(normalizeWordPasteHtml(''), '');
		assert.strictEqual(normalizeWordPasteHtml('plain text with no tags'), 'plain text with no tags');
	});

	// --- Tracked-changes residue (issue #139, T1-C) -----------------------------------------------------
	// Word exports revisions inline: deleted text in a `class=msoDel` span / `<del>`, inserted text in a
	// `class=msoIns` span / `<ins>`. normalizeWordPasteHtml resolves them paste-as-accepted: deleted runs are
	// removed outright, inserted runs are kept as plain text with their revision styling dropped.

	test('drops msoDel deleted runs and keeps msoIns inserted runs as plain text (the fixture sentence)', () => {
		// Verbatim from docs/plans/39-verify/fixtures/word-clipboard-report.html (the msoIns span open tag
		// wraps across a newline exactly as Word emits it).
		const sentence = `<p class=MsoNormal>The forecast was <span class=msoDel>revised down</span><span\n`
			+ `class=msoIns>held flat</span> after the review; final wording pending.<o:p></o:p></p>`;
		const out = normalizeWordPasteHtml(sentence);
		assert.strictEqual(
			squash(out),
			'<p class=MsoNormal>The forecast was held flat after the review; final wording pending.</p>'
		);
		// The deleted words are gone (no "revised down", no "revised downheld flat" concatenation).
		assert.ok(out.indexOf('revised down') === -1, 'deleted run removed');
		assert.ok(out.indexOf('revised downheld flat') === -1, 'no deleted+inserted concatenation');
		// No revision markup survives as document text.
		assert.ok(!/msoDel|msoIns/i.test(out), 'revision marker classes stripped');
	});

	test('resolves <del>/<ins> element revisions in a Word payload (del removed, ins unwrapped)', () => {
		const html = `<p class=MsoNormal>Price was <del>ten</del><ins>eight</ins> dollars.<o:p></o:p></p>`;
		assert.strictEqual(
			squash(normalizeWordPasteHtml(html)),
			'<p class=MsoNormal>Price was eight dollars.</p>'
		);
	});

	test('drops an inline line-through span carrying a Word marker (msoDel variant without the class)', () => {
		const html = `<p class=MsoNormal>Keep <span style='mso-bidi-font-weight:normal;`
			+ `text-decoration:line-through'>cut me</span>this.<o:p></o:p></p>`;
		const out = normalizeWordPasteHtml(html);
		assert.ok(out.indexOf('cut me') === -1, 'line-through+mso run removed');
		assert.ok(out.indexOf('Keep this.') !== -1, 'surrounding text preserved');
	});

	test('handles nested / multiple del+ins pairs in one paragraph', () => {
		const html = `<p class=MsoNormal>`
			+ `The <span class=msoDel>old</span><span class=msoIns>new</span> plan `
			+ `<del>was</del><ins>is</ins> ready; <span class=msoIns>and</span> shipping.`
			+ `<o:p></o:p></p>`;
		assert.strictEqual(
			squash(normalizeWordPasteHtml(html)),
			'<p class=MsoNormal>The new plan is ready; and shipping.</p>'
		);
	});

	test('a <del>/<ins> inside NON-Word HTML is left untouched (plain-HTML paste is out of scope)', () => {
		const plain = `<p>Price was <del>ten</del><ins>eight</ins> dollars.</p>`;
		assert.strictEqual(normalizeWordPasteHtml(plain), plain);
		// A plain strikethrough span with no Word marker is also preserved.
		const strike = `<p>See <span style="text-decoration:line-through">crossed</span> out.</p>`;
		assert.strictEqual(normalizeWordPasteHtml(strike), strike);
	});

	// --- Pasted tables -> table[data-md] -> table_block (issue #138, T1-B) -----------------------------------
	// The editor schema only parses a table from `table[data-md]` (the table_block node reads `data-md` as its
	// `markdown` verbatim). normalizeWordPasteHtml serialises each pasted <table> to GFM pipe text and emits it
	// as that element, so a pasted Word/HTML table becomes a real table instead of ProseMirror hoisting every
	// cell out as a stray paragraph. Merged cells degrade by a stated rule (colspan/rowspan REPEAT their value).

	test('the fixture MsoTableGrid table serialises to the exact GFM inside table[data-md]', () => {
		const out = normalizeWordPasteHtml(WORD_TABLE_BLOCK);
		assert.ok(out.indexOf('<table data-md="') !== -1, 'table[data-md] emitted');
		assert.ok(out.indexOf('MsoTableGrid') === -1, 'original Word table markup replaced');
		assert.strictEqual(extractDataMd(out), WORD_TABLE_GFM);
		// The merged (colspan=2) header cell repeated across both columns - never a silent misalignment.
		assert.strictEqual(extractDataMd(out).split('\n')[0], '| **Region & Segment** | **Region & Segment** | **Revenue** | **Growth** |');
	});

	test('a plain (non-Word) HTML table with thead/tbody is converted too', () => {
		const html = `<table><thead><tr><th>Name</th><th>Role</th></tr></thead>`
			+ `<tbody><tr><td>Ada</td><td>Engineer</td></tr><tr><td>Grace</td><td>Admiral</td></tr></tbody></table>`;
		const out = normalizeWordPasteHtml(html);
		assert.strictEqual(
			extractDataMd(out),
			'| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Grace | Admiral |'
		);
	});

	test('a colspan header cell repeats across the columns it merges (stated rule)', () => {
		const html = `<table><tr><th colspan=2>Merged</th><th>C</th></tr>`
			+ `<tr><td>a</td><td>b</td><td>c</td></tr></table>`;
		assert.strictEqual(
			extractDataMd(normalizeWordPasteHtml(html)),
			'| Merged | Merged | C |\n| --- | --- | --- |\n| a | b | c |'
		);
	});

	test('a rowspan cell repeats down the rows it spans, keeping every row rectangular (stated rule)', () => {
		const html = `<table><tr><td rowspan=2>Region</td><td>Enterprise</td><td>$12</td></tr>`
			+ `<tr><td>SMB</td><td>$4</td></tr></table>`;
		assert.strictEqual(
			extractDataMd(normalizeWordPasteHtml(html)),
			'| Region | Enterprise | $12 |\n| --- | --- | --- |\n| Region | SMB | $4 |'
		);
	});

	test('a combined colspan+rowspan cell fills the whole block it spans', () => {
		const html = `<table><tr><td colspan=2 rowspan=2>Big</td><td>C</td></tr>`
			+ `<tr><td>D</td></tr><tr><td>e</td><td>f</td><td>g</td></tr></table>`;
		assert.strictEqual(
			extractDataMd(normalizeWordPasteHtml(html)),
			'| Big | Big | C |\n| --- | --- | --- |\n| Big | Big | D |\n| e | f | g |'
		);
	});

	test('pipes are escaped, inline bold/links kept as Markdown, empty and nbsp-only cells become empty', () => {
		const html = `<table><tr><td>a|b</td><td><b>bold</b></td><td></td></tr>`
			+ `<tr><td>x</td><td><a href="http://e.com">link</a></td><td>&nbsp;</td></tr></table>`;
		assert.strictEqual(
			extractDataMd(normalizeWordPasteHtml(html)),
			'| a\\|b | **bold** |  |\n| --- | --- | --- |\n| x | [link](http://e.com) |  |'
		);
	});

	test('a multi-paragraph cell joins its blocks with a single space (a GFM cell is one line)', () => {
		const html = `<table><tr><td><p>Line one</p><p>Line two</p></td><td>Single<br>break</td></tr></table>`;
		assert.strictEqual(
			extractDataMd(normalizeWordPasteHtml(html)),
			'| Line one Line two | Single break |\n| --- | --- |'
		);
	});

	test('multiple tables in one payload are each converted; surrounding prose is preserved', () => {
		const html = `<p>Intro</p><table><tr><td>T1</td></tr></table>`
			+ `<p>Mid</p><table><tr><td>T2</td></tr></table><p>End</p>`;
		const out = normalizeWordPasteHtml(html);
		assert.strictEqual(
			out,
			'<p>Intro</p><table data-md="| T1 |\n| --- |"></table>'
			+ '<p>Mid</p><table data-md="| T2 |\n| --- |"></table><p>End</p>'
		);
	});

	test('a payload that is ONLY a table works (no surrounding content required)', () => {
		const out = normalizeWordPasteHtml(`<table><tr><th>H</th></tr><tr><td>v</td></tr></table>`);
		assert.strictEqual(extractDataMd(out), '| H |\n| --- |\n| v |');
	});

	test('nbsp-only Word cells and <p class=MsoNormal> wrappers reduce to empty / plain cell text', () => {
		const html = `<table class=MsoNormalTable><tr>`
			+ `<td><p class=MsoNormal>&nbsp;<o:p></o:p></p></td>`
			+ `<td><p class=MsoNormal>Value<o:p></o:p></p></td></tr></table>`;
		assert.strictEqual(extractDataMd(normalizeWordPasteHtml(html)), '|  | Value |\n| --- | --- |');
	});

	test('a non-table payload is byte-identical (the pass-through guarantee is unchanged)', () => {
		const plain = `<p>plain paragraph</p><h2>Heading</h2><ul><li>one</li></ul>`;
		assert.strictEqual(normalizeWordPasteHtml(plain), plain);
	});

	// Round-trip through the REAL vendored bundle: the emitted `data-md` GFM must parse into a single
	// table_block node and serialise back to the same GFM byte-for-byte. This proves the data-md contract
	// (getAttribute('data-md') === the node's `markdown`) end to end, not against a re-implementation.
	test('emitted table[data-md] GFM parses to a table_block and round-trips via the real bundle', () => {
		const lwdpm = loadLwdpm();
		const gfm = extractDataMd(normalizeWordPasteHtml(WORD_TABLE_BLOCK));
		assert.strictEqual(gfm, WORD_TABLE_GFM);
		// Serialize -> parse -> serialize is byte-identical (the on-disk round-trip the keystone needs).
		assert.strictEqual(lwdpm.roundTrip(gfm).trim(), gfm);
		// And it is exactly one table_block node carrying that GFM as its `markdown` attr.
		const json = JSON.parse(JSON.stringify(lwdpm.docJSON(gfm))) as { content: Array<{ type: string; attrs?: { markdown?: string } }> };
		assert.strictEqual(json.content.length, 1, 'one top-level node');
		assert.strictEqual(json.content[0].type, 'table_block', 'the node is a table_block');
		assert.strictEqual(json.content[0].attrs && json.content[0].attrs.markdown, gfm, 'markdown attr equals the data-md GFM');
	});

	test('a pipe-escaped / empty-cell table also round-trips byte-identically via the real bundle', () => {
		const lwdpm = loadLwdpm();
		const html = `<table><tr><td>a|b</td><td><b>bold</b></td><td></td></tr>`
			+ `<tr><td>x</td><td><a href="http://e.com">link</a></td><td>y</td></tr></table>`;
		const gfm = extractDataMd(normalizeWordPasteHtml(html));
		assert.strictEqual(lwdpm.roundTrip(gfm).trim(), gfm);
	});

	// --- Word heading paragraphs -> real <hN> (issue #256, T1 re-run) -------------------------------------
	// Word's clipboard export carries a heading that uses a built-in heading STYLE as a styled PARAGRAPH
	// (`<p class=MsoHeadingN>` / `<p class=MsoTitle>` / a paragraph whose style has `mso-outline-level:N`), not
	// as <hN>. Pasted as a plain paragraph it MERGES into the previous block ("...for the boun" + "Pasted
	// Heading One"). normalizeWordPasteHtml rewrites those to real <hN> so each heading keeps its block boundary.

	test('rewrites a Word heading paragraph (MsoHeading1 + mso-outline-level) to a real <h1> so it does not glue', () => {
		const html = `<p class=MsoNormal>See the summary for the bound figure.<o:p></o:p></p>\n`
			+ `<p class=MsoHeading1 style='mso-outline-level:1'><b>Pasted Heading One</b><o:p></o:p></p>`;
		assert.strictEqual(
			squash(normalizeWordPasteHtml(html)),
			'<p class=MsoNormal>See the summary for the bound figure.</p><h1><b>Pasted Heading One</b></h1>'
		);
	});

	test('maps heading level from the class number, MsoTitle/MsoSubtitle, and mso-outline-level (h1-h6)', () => {
		const html = [
			`<p class=MsoTitle>Title Line<o:p></o:p></p>`,
			`<p class=MsoSubtitle>Subtitle Line<o:p></o:p></p>`,
			`<p class="MsoHeading3 foo">Section Three<o:p></o:p></p>`,
			`<p class=MsoNormal style='mso-outline-level:4'>Deep Four<o:p></o:p></p>`,
			`<p class=MsoNormal>Body stays a paragraph.<o:p></o:p></p>`,
		].join('\n');
		assert.strictEqual(
			squash(normalizeWordPasteHtml(html)),
			'<h1>Title Line</h1><h2>Subtitle Line</h2><h3>Section Three</h3><h4>Deep Four</h4>'
			+ '<p class=MsoNormal>Body stays a paragraph.</p>'
		);
	});

	test('the full faithful Word payload converts to blocks a heading keeps, a table, a list, marks (snapshot)', () => {
		const payload = [
			`<html xmlns:o="urn:schemas-microsoft-com:office:office">`,
			`<body>`,
			`<p class=MsoNormal>See the <a href="https://ex.com">Weekly Summary</a> for the bound figure.<o:p></o:p></p>`,
			`<p class=MsoHeading1 style='mso-outline-level:1'>Pasted Heading One<o:p></o:p></p>`,
			`<p class=MsoNormal>This paragraph has <b>bold text</b> and <i>italic text</i>.<o:p></o:p></p>`,
			WORD_LIST_BLOCK,
			`<table class=MsoTableGrid border=1><tr><td><p class=MsoNormal>Name<o:p></o:p></p></td>`
			+ `<td><p class=MsoNormal>Value<o:p></o:p></p></td></tr>`
			+ `<tr><td><p class=MsoNormal>Alpha<o:p></o:p></p></td><td><p class=MsoNormal>100<o:p></o:p></p></td></tr>`
			+ `<tr><td><p class=MsoNormal>Beta<o:p></o:p></p></td><td><p class=MsoNormal>200<o:p></o:p></p></td></tr></table>`,
			`<p class=MsoNormal>Trailing paragraph after table.<o:p></o:p></p>`,
			`</body></html>`,
		].join('\n');
		const out = normalizeWordPasteHtml(payload);
		assert.deepStrictEqual(
			{
				heading: /<h1>Pasted Heading One<\/h1>/.test(out),
				headingDidNotGlue: out.indexOf('figure.</p>') !== -1 && out.indexOf('figure.<h1>') === -1 && out.indexOf('bounPasted') === -1,
				list: squash(out).indexOf('<ul><li>Pipeline grew in EMEA<ul>') !== -1,
				tableGfm: extractDataMd(out),
				tableMarkupGone: out.indexOf('MsoTableGrid') === -1,
				trailingKept: out.indexOf('Trailing paragraph after table.') !== -1,
			},
			{
				heading: true,
				headingDidNotGlue: true,
				list: true,
				tableGfm: '| Name | Value |\n| --- | --- |\n| Alpha | 100 |\n| Beta | 200 |',
				tableMarkupGone: true,
				trailingKept: true,
			}
		);
	});

	// --- Kept/dropped honesty notice (issue #256) --------------------------------------------------------
	// wordPasteNotice reuses the docx IMPORT converter + summary so a pasted document names kept/dropped
	// IDENTICALLY to an imported one. It returns a line ONLY when the clipboard fragment genuinely dropped
	// something (tracked-change marks, comments); a lossless paste and a non-Word paste both return null.

	test('a lossless Word paste raises no notice; tracked changes and comments each raise the honest line', () => {
		const clean = `<p class=MsoNormal>Plain <b>bold</b> text with a <a href="https://e.com">link</a>.<o:p></o:p></p>`;
		const tracked = `<p class=MsoNormal>The forecast was <span class=msoDel>revised down</span>`
			+ `<span class=msoIns>held flat</span>.<o:p></o:p></p>`;
		const commented = `<p class=MsoNormal>Revenue<span class=msoCommentReference>[1]</span> was up.<o:p></o:p></p>`;
		const plainTable = `<table><tr><td>a</td><td>b</td></tr></table>`;
		assert.deepStrictEqual(
			{
				lossless: wordPasteNotice(clean),
				tracked: wordPasteNotice(tracked),
				commented: wordPasteNotice(commented),
				nonWord: wordPasteNotice(plainTable),
			},
			{
				lossless: null,
				tracked: 'Paragraphs, The final text of tracked changes kept · Tracked-change marks (the final text was kept) not imported',
				commented: 'Paragraphs kept · Comments not imported',
				nonWord: null,
			}
		);
	});

	// The loss detector must MATCH what stripTrackedChanges() actually drops (#269 CR-4): (a) a style-only Word
	// deletion (an mso strike-through span the normaliser removes) raises the tracked-change line - previously it
	// was invisible to the detector; (b) ordinary prose that merely contains the words "commentReference" or
	// "supportAnnotations" is NOT flagged as a dropped comment - only the STRUCTURAL markers (msoComment span,
	// <w:commentReference> element, `[if !supportAnnotations]` conditional block) count.
	test('loss detector mirrors the normaliser: style-only deletions flagged, bare comment words are not', () => {
		const styleStrikeDeletion = `<p class=MsoNormal>The fee was <span style='mso-spl:yes;text-decoration:line-through'>waived</span> charged.<o:p></o:p></p>`;
		const proseWithCommentWords = `<p class=MsoNormal>Our commentReference guidelines and supportAnnotations rollout are on track.<o:p></o:p></p>`;
		const structuralComment = `<p class=MsoNormal>Revenue<w:commentReference w:id="1"/> was up.<o:p></o:p></p>`;
		const conditionalComment = `<p class=MsoNormal>Total<!--[if !supportAnnotations]--><span>[a1]</span><!--[endif]--> rose.<o:p></o:p></p>`;
		assert.deepStrictEqual(
			{
				styleStrikeDeletion: wordPasteNotice(styleStrikeDeletion),
				proseWithCommentWords: wordPasteNotice(proseWithCommentWords),
				structuralComment: wordPasteNotice(structuralComment),
				conditionalComment: wordPasteNotice(conditionalComment),
			},
			{
				styleStrikeDeletion: 'Paragraphs, The final text of tracked changes kept · Tracked-change marks (the final text was kept) not imported',
				proseWithCommentWords: null,
				structuralComment: 'Paragraphs kept · Comments not imported',
				conditionalComment: 'Paragraphs kept · Comments not imported',
			}
		);
	});

	// --- Paste-slice open-boundary decision (issue #256, fix round 1) ------------------------------------
	// The tag rewrite above turns a Word heading paragraph into a real <hN>, but on a LIVE paste ProseMirror
	// still parses the fragment into a Slice with an OPEN start (openStart > 0) and, when the caret sits in a
	// NON-EMPTY paragraph, merges that first heading's text into the paragraph - the "pasted H1 glues onto the
	// previous line" audit symptom. pasteStartShouldClose is the pure predicate the webview's transformPasted
	// guard consults to decide whether to close the slice's start (openStart -> 0) so the leading structural
	// block lands as its own block. This covers the decision table directly (no DOM / no live view needed).

	test('pasteStartShouldClose closes the start only for a structural first block landing on a non-empty line', () => {
		// A non-empty caret paragraph (size 20) with an open-start slice (openStart 1), not a plain-text paste.
		const onNonEmpty = (type: string) => pasteStartShouldClose(type, 1, false, true, 20);
		assert.deepStrictEqual(
			{
				// Structural first blocks glue and MUST be split off.
				heading: onNonEmpty('heading'),
				bullet_list: onNonEmpty('bullet_list'),
				ordered_list: onNonEmpty('ordered_list'),
				table_block: onNonEmpty('table_block'),
				blockquote: onNonEmpty('blockquote'),
				code_block: onNonEmpty('code_block'),
				// A leading plain paragraph keeps the ordinary inline-merge behaviour (not structural).
				paragraph: onNonEmpty('paragraph'),
				// Non-regression guards: plain-text paste, an already-closed slice, an empty caret paragraph,
				// and a caret that is not a textblock all leave the slice untouched.
				plainText: pasteStartShouldClose('heading', 1, true, true, 20),
				alreadyClosed: pasteStartShouldClose('heading', 0, false, true, 20),
				emptyParagraph: pasteStartShouldClose('heading', 1, false, true, 0),
				notATextblock: pasteStartShouldClose('heading', 1, false, false, 20),
			},
			{
				heading: true, bullet_list: true, ordered_list: true, table_block: true, blockquote: true, code_block: true,
				paragraph: false, plainText: false, alreadyClosed: false, emptyParagraph: false, notATextblock: false,
			}
		);
	});

	// Self-containment guard (common brief): the helpers are injected into the webview RUNTIME verbatim via
	// String(fn), so their serialized source must carry no imports, no require, and no transpiler helper
	// references - otherwise they would throw when eval'd in the webview where those symbols do not exist.
	// The tables step (#138) lives INSIDE normalizeWordPasteHtml, so its source is covered here too; we also
	// assert it is present and free of ES2020+ syntax (optional chaining / nullish coalescing) that would be
	// emitted verbatim into the injected String(fn).
	test('injected helpers are self-contained (no import/require/helper references in String(fn))', () => {
		for (const fn of [isWordHtml, normalizeWordPasteHtml, pasteStartShouldClose]) {
			const src = String(fn);
			assert.ok(!/\bimport\b/.test(src), `${fn.name}: no import`);
			assert.ok(!/\brequire\b/.test(src), `${fn.name}: no require`);
			assert.ok(!/\b__[A-Za-z]/.test(src), `${fn.name}: no transpiler helper (__x)`);
			assert.ok(!/\bexports\b/.test(src), `${fn.name}: no exports reference`);
			assert.ok(!/\?\./.test(src), `${fn.name}: no optional chaining`);
			assert.ok(!/\?\?/.test(src), `${fn.name}: no nullish coalescing`);
		}
		// The tables transform is inlined into normalizeWordPasteHtml (part of the ordered chain).
		assert.ok(/rebuildPastedTables/.test(String(normalizeWordPasteHtml)), 'the #138 tables step is inlined into the injected normaliser');
	});
});
