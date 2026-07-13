/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWordHtml, hasHtmlTable, convertHtmlTablesToDataMd, normalizeWordPasteHtml } from '../../common/livingDocWordPaste.js';

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

	test('non-list content around a list run is preserved; a table between paragraphs becomes table_block HTML', () => {
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
		// The Word table is now converted into a <table data-md="..."> element (parses to a real table_block);
		// the raw Word table markup is gone and the cell text is carried in the GFM attribute.
		assert.ok(out.indexOf('<table data-md="') !== -1, 'table converted to data-md element');
		assert.ok(out.indexOf('MsoTableGrid') === -1, 'raw Word table markup removed');
		assert.ok(/data-md="[\s\S]*AMER/.test(out), 'cell text carried into the GFM attribute');
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

	// Self-containment guard (common brief): the helpers are injected into the webview RUNTIME verbatim via
	// String(fn), so their serialized source must carry no imports, no require, and no transpiler helper
	// references - otherwise they would throw when eval'd in the webview where those symbols do not exist.
	test('injected helpers are self-contained (no import/require/helper references in String(fn))', () => {
		for (const fn of [isWordHtml, hasHtmlTable, convertHtmlTablesToDataMd, normalizeWordPasteHtml]) {
			const src = String(fn);
			assert.ok(!/\bimport\b/.test(src), `${fn.name}: no import`);
			assert.ok(!/\brequire\b/.test(src), `${fn.name}: no require`);
			assert.ok(!/\b__[A-Za-z]/.test(src), `${fn.name}: no transpiler helper (__x)`);
			assert.ok(!/\bexports\b/.test(src), `${fn.name}: no exports reference`);
		}
	});

	// --- Table conversion (issue #138, T1-B) ------------------------------------------------------------
	// convertHtmlTablesToDataMd turns any pasted <table> (Word MsoTableGrid or plain HTML) into a
	// <table data-md="...GFM..."> element that the shipped bundle's `table[data-md]` parseDOM rule renders as
	// a real table_block. Unlike the Word-only list/tracked-changes passes, it applies to ALL HTML sources.

	// Read the GFM pipe text back out of the generated `data-md` attribute (reversing the attribute escaping),
	// so the tests can assert the exact markdown the bundle will parse.
	function dataMd(html: string): string {
		const m = /<table data-md="([\s\S]*?)"><\/table>/.exec(html);
		assert.ok(m, 'expected a <table data-md="..."> element');
		return m![1]
			.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
	}

	test('hasHtmlTable sniffs a <table> and ignores table-free HTML', () => {
		assert.strictEqual(hasHtmlTable('<div><table><tr><td>x</td></tr></table></div>'), true);
		assert.strictEqual(hasHtmlTable('<p>plain</p>'), false);
		assert.strictEqual(hasHtmlTable(''), false);
	});

	test('converts the fixture 6-row MsoTableGrid (colspan=2 header) to the expected 4-column GFM', () => {
		// The full table block verbatim from docs/plans/39-verify/fixtures/word-clipboard-report.html: a
		// header row whose first cell is colspan=2 (Region & Segment), then five AMER/EMEA/APAC data rows.
		const table = [
			`<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse'>`,
			` <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>`,
			`  <td width=302 colspan=2 valign=top><p class=MsoNormal><b>Region &amp; Segment</b><o:p></o:p></p></td>`,
			`  <td width=151 valign=top><p class=MsoNormal><b>Revenue</b><o:p></o:p></p></td>`,
			`  <td width=151 valign=top><p class=MsoNormal><b>Growth</b><o:p></o:p></p></td>`,
			` </tr>`,
			` <tr><td><p class=MsoNormal>AMER<o:p></o:p></p></td><td><p class=MsoNormal>Enterprise</p></td><td><p class=MsoNormal>$21,300</p></td><td><p class=MsoNormal>+8%</p></td></tr>`,
			` <tr><td><p class=MsoNormal>AMER</p></td><td><p class=MsoNormal>SMB</p></td><td><p class=MsoNormal>$9,900</p></td><td><p class=MsoNormal>+15%</p></td></tr>`,
			` <tr><td><p class=MsoNormal>EMEA</p></td><td><p class=MsoNormal>Enterprise</p></td><td><p class=MsoNormal>$12,400</p></td><td><p class=MsoNormal>+19%</p></td></tr>`,
			` <tr><td><p class=MsoNormal>EMEA</p></td><td><p class=MsoNormal>SMB</p></td><td><p class=MsoNormal>$4,100</p></td><td><p class=MsoNormal>+11%</p></td></tr>`,
			` <tr><td><p class=MsoNormal>APAC</p></td><td><p class=MsoNormal>All</p></td><td><p class=MsoNormal>$2,100</p></td><td><p class=MsoNormal>+3%</p></td></tr>`,
			`</table>`,
		].join('\n');
		const md = dataMd(convertHtmlTablesToDataMd(table));
		// colspan=2 header rule: "Region & Segment" in the first column, the second column empty; 4 columns
		// wide. Bold cells keep their emphasis. Five data rows, values in the right columns.
		assert.strictEqual(md, [
			'| **Region & Segment** |  | **Revenue** | **Growth** |',
			'| --- | --- | --- | --- |',
			'| AMER | Enterprise | $21,300 | +8% |',
			'| AMER | SMB | $9,900 | +15% |',
			'| EMEA | Enterprise | $12,400 | +19% |',
			'| EMEA | SMB | $4,100 | +11% |',
			'| APAC | All | $2,100 | +3% |',
		].join('\n'));
	});

	test('converts a plain (non-Word) HTML table with a <th> header row', () => {
		const table = '<table><thead><tr><th>Name</th><th>Score</th></tr></thead>'
			+ '<tbody><tr><td>Ann</td><td>91</td></tr><tr><td>Bo</td><td>88</td></tr></tbody></table>';
		const md = dataMd(convertHtmlTablesToDataMd(table));
		assert.strictEqual(md, [
			'| Name | Score |',
			'| --- | --- |',
			'| Ann | 91 |',
			'| Bo | 88 |',
		].join('\n'));
	});

	test('escapes a literal pipe in cell text as \\|', () => {
		const table = '<table><tr><th>Key</th></tr><tr><td>a|b</td></tr></table>';
		const md = dataMd(convertHtmlTablesToDataMd(table));
		assert.ok(md.indexOf('| a\\|b |') !== -1, 'pipe escaped inside the cell');
	});

	test('renders bold, italic and link cell content as markdown-ish inline text', () => {
		const table = '<table><tr><th>Field</th><th>Value</th></tr>'
			+ '<tr><td><b>Bold</b></td><td><i>ital</i></td></tr>'
			+ '<tr><td><a href="https://ex.com/p?a=1&amp;b=2">link</a></td><td>x</td></tr></table>';
		const md = dataMd(convertHtmlTablesToDataMd(table));
		assert.ok(md.indexOf('| **Bold** | *ital* |') !== -1, 'bold and italic converted');
		assert.ok(md.indexOf('| [link](https://ex.com/p?a=1&b=2) | x |') !== -1, 'link converted with decoded href');
	});

	test('converts multiple tables in one paste and preserves the text between them in order', () => {
		const html = 'before<table><tr><th>A</th></tr><tr><td>1</td></tr></table>'
			+ 'middle<table><tr><th>B</th></tr><tr><td>2</td></tr></table>after';
		const out = convertHtmlTablesToDataMd(html);
		assert.ok(/^before<table data-md="/.test(out), 'leading text kept');
		assert.ok(out.indexOf('"></table>middle<table data-md="') !== -1, 'inter-table text kept in order');
		assert.ok(/"><\/table>after$/.test(out), 'trailing text kept');
		assert.strictEqual((out.match(/<table data-md="/g) || []).length, 2, 'both tables converted');
	});

	test('rowspan puts the value in the first row and leaves the cells below it empty', () => {
		const table = '<table><tr><th>Grp</th><th>Item</th></tr>'
			+ '<tr><td rowspan=2>AMER</td><td>Ent</td></tr>'
			+ '<tr><td>SMB</td></tr></table>';
		const md = dataMd(convertHtmlTablesToDataMd(table));
		assert.strictEqual(md, [
			'| Grp | Item |',
			'| --- | --- |',
			'| AMER | Ent |',
			'|  | SMB |',
		].join('\n'));
	});

	test('a paste with no <table> is returned unchanged', () => {
		const html = '<p>Just <b>text</b> and a <a href="x">link</a>.</p>';
		assert.strictEqual(convertHtmlTablesToDataMd(html), html);
	});

	test('fail-soft: a <table> with no rows is left unchanged', () => {
		const html = '<table><caption>empty</caption></table>';
		assert.strictEqual(convertHtmlTablesToDataMd(html), html);
	});
});
