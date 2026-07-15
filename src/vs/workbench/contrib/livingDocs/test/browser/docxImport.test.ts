/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildImportSummary, convertDocxHtml, formatImportSummary, IDocxDetections, noDetections } from '../../common/docxImport.js';

// The pure docx -> Markdown conversion half of the import pipeline (issue #129, doc 22 section 2). The
// input here is exactly the semantic-HTML subset mammoth emits from a docx, so these assertions pin the
// fidelity floor the acceptance criteria bite on (GFM headings/lists/tables/images) without a real build.

// A tiny 1x1 PNG as a data URI, the shape mammoth inlines an embedded image as.
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const JPG_DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRA==';

function detections(over: Partial<IDocxDetections>): IDocxDetections {
	return { ...noDetections(), ...over };
}

suite('docxImport', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('headings, paragraphs, bold/italic and links convert to GFM Markdown', () => {
		const html = '<h1>Weekly Summary</h1><h2>Overview</h2><p>Revenue is <strong>up</strong> and <em>steady</em>. '
			+ 'See <a href="https://example.com/q">the query</a>.</p>';
		const { markdown } = convertDocxHtml(html, 'Weekly Summary');
		assert.strictEqual(markdown,
			'# Weekly Summary\n\n## Overview\n\nRevenue is **up** and *steady*. See [the query](https://example.com/q).\n');
	});

	test('nested lists indent by depth; ordered vs unordered markers are preserved', () => {
		const html = '<ul><li>Top<ul><li>Child<ul><li>Grandchild</li></ul></li></ul></li><li>Second</li></ul>'
			+ '<ol><li>First</li><li>Second</li></ol>';
		const { markdown } = convertDocxHtml(html, 'Doc');
		assert.strictEqual(markdown,
			'- Top\n  - Child\n    - Grandchild\n- Second\n\n1. First\n2. Second\n');
	});

	test('tables become GFM pipe tables with a header separator row', () => {
		const html = '<table><tr><td>Region</td><td>MRR</td></tr><tr><td>EMEA</td><td>$1,200</td></tr>'
			+ '<tr><td>APAC</td><td>$980</td></tr></table>';
		const { markdown, kept } = convertDocxHtml(html, 'Doc');
		assert.strictEqual(markdown,
			'| Region | MRR |\n| --- | --- |\n| EMEA | $1,200 |\n| APAC | $980 |\n');
		// A table is kept but named display-only until the #140 editing path (doc 22 section 2).
		assert.ok(kept.some(k => /table/i.test(k) && /display-only/i.test(k)));
	});

	test('embedded images are lifted to assets/<doc>/ with relative references and unique names', () => {
		const html = `<p>Chart one</p><p><img src="${PNG_DATA}" alt="Chart"></p><p><img src="${JPG_DATA}"></p>`;
		const { markdown, images } = convertDocxHtml(html, 'Weekly Summary');
		assert.strictEqual(markdown,
			'Chart one\n\n![Chart](assets/Weekly Summary/image-1.png)\n\n![](assets/Weekly Summary/image-2.jpg)\n');
		assert.deepStrictEqual(images.map(i => ({ name: i.name, contentType: i.contentType })), [
			{ name: 'image-1.png', contentType: 'image/png' },
			{ name: 'image-2.jpg', contentType: 'image/jpeg' },
		]);
		assert.strictEqual(images[0].base64, 'iVBORw0KGgoAAAANSUhEUg==');
	});

	test('block quotes convert and are named in the kept summary', () => {
		const { markdown, kept } = convertDocxHtml('<blockquote><p>A quoted line.</p></blockquote>', 'Doc');
		assert.strictEqual(markdown, '> A quoted line.\n');
		assert.ok(kept.includes('Block quotes'));
	});

	test('the kept/dropped summary names only the limitations the document actually had, and tracked changes keep the final text honestly', () => {
		const summary = buildImportSummary(
			{ headings: true, lists: true, tables: 2, images: 3, links: true, emphasis: true, quotes: false },
			detections({ comments: true, trackedChanges: true, footnotes: true }),
		);
		assert.deepStrictEqual(summary, {
			kept: ['Headings', 'Paragraphs', 'Lists', '2 tables (display-only for now)', 'Bold and italic', 'Links', '3 images', 'The final text of tracked changes'],
			dropped: ['Comments', 'Tracked-change marks (the final text was kept)', 'Footnotes'],
		});
		// A clean document names no caveats at all - never a fabricated "not imported" line.
		const clean = buildImportSummary(
			{ headings: true, lists: false, tables: 0, images: 0, links: false, emphasis: false, quotes: false },
			noDetections(),
		);
		assert.deepStrictEqual(clean.dropped, []);
		assert.strictEqual(formatImportSummary(clean.kept, clean.dropped), 'Headings, Paragraphs kept');
	});

	test('unknown/foreign tags degrade to their text rather than mangling or throwing', () => {
		const html = '<p>Before <span style="color:red">inline</span> after.</p><customblock>Kept text</customblock>';
		const { markdown } = convertDocxHtml(html, 'Doc');
		assert.strictEqual(markdown, 'Before inline after.\n\nKept text\n');
	});

	test('markdown-significant characters in text are escaped so imported prose is not reinterpreted', () => {
		const { markdown } = convertDocxHtml('<p>Costs were 50% lower [see *notes*] and _underscored_.</p>', 'Doc');
		assert.strictEqual(markdown, 'Costs were 50% lower \\[see \\*notes\\*\\] and \\_underscored\\_.\n');
	});
});
