/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWordHtml, normalizeWordPasteHtml } from '../../common/livingDocWordPaste.js';

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

	test('non-list content around a list run is preserved; a table between paragraphs is untouched', () => {
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
		// The table markup is intact and its cell text still pastes (as a paragraph).
		assert.ok(out.indexOf('<table class=MsoTableGrid>') !== -1, 'table open tag preserved');
		assert.ok(out.indexOf('</table>') !== -1, 'table close tag preserved');
		assert.ok(out.indexOf('AMER') !== -1, 'table cell text preserved');
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
		for (const fn of [isWordHtml, normalizeWordPasteHtml]) {
			const src = String(fn);
			assert.ok(!/\bimport\b/.test(src), `${fn.name}: no import`);
			assert.ok(!/\brequire\b/.test(src), `${fn.name}: no require`);
			assert.ok(!/\b__[A-Za-z]/.test(src), `${fn.name}: no transpiler helper (__x)`);
			assert.ok(!/\bexports\b/.test(src), `${fn.name}: no exports reference`);
		}
	});
});
