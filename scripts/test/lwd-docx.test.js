/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

'use strict';

// Pure-node unit proof for the docx writer (doc 22 §6 Export acceptance). Runs with a plain `node` - no
// workbench build - so the "rendered-doc -> docx bytes with correct styles" checkbox is provable here.
// Because the writer packs parts with the ZIP STORE method (no compression), each part's bytes appear
// verbatim in the archive; the test both walks the ZIP central directory (structural validity + CRC) and
// asserts on the extracted document.xml.

const assert = require('assert');
const zlib = require('zlib');
const { renderDocx, parseInline, crc32 } = require('../lwd-docx.js');

/** Extract one named entry from a ZIP buffer via its central directory (validates the archive is well-formed). */
function readZipEntry(buf, name) {
	// Find End Of Central Directory (scan back for the signature).
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	assert.ok(eocd >= 0, 'EOCD record present');
	const count = buf.readUInt16LE(eocd + 10);
	let ptr = buf.readUInt32LE(eocd + 16);
	for (let e = 0; e < count; e++) {
		assert.strictEqual(buf.readUInt32LE(ptr), 0x02014b50, 'central dir header signature');
		const method = buf.readUInt16LE(ptr + 10);
		const crc = buf.readUInt32LE(ptr + 16);
		const compSize = buf.readUInt32LE(ptr + 20);
		const nameLen = buf.readUInt16LE(ptr + 28);
		const extraLen = buf.readUInt16LE(ptr + 30);
		const commentLen = buf.readUInt16LE(ptr + 32);
		const localOff = buf.readUInt32LE(ptr + 42);
		const entryName = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
		if (entryName === name) {
			// Jump to the local header to find the actual data start.
			assert.strictEqual(buf.readUInt32LE(localOff), 0x04034b50, 'local header signature');
			const lNameLen = buf.readUInt16LE(localOff + 26);
			const lExtraLen = buf.readUInt16LE(localOff + 28);
			const dataStart = localOff + 30 + lNameLen + lExtraLen;
			const raw = buf.subarray(dataStart, dataStart + compSize);
			const data = method === 0 ? raw : zlib.inflateRawSync(raw);
			assert.strictEqual(crc32(data) >>> 0, crc >>> 0, `CRC matches for ${name}`);
			return data;
		}
		ptr += 46 + nameLen + extraLen + commentLen;
	}
	return undefined;
}

// A 1x1 transparent PNG (the smallest valid image), as a data URI.
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const markdown = [
	'# Weekly Summary',
	'',
	'_Week of 14 July_',
	'',
	'Revenue reached **$1.2M** this week, up from last week. See the [dashboard](https://example.com/dash).',
	'',
	'## Key Figures',
	'',
	'| Metric | Value |',
	'| --- | --- |',
	'| Revenue | $1.2M |',
	'| Signups | 340 |',
	'',
	'## Notes',
	'',
	'- Top line grew',
	'  - driven by enterprise',
	'- Watch churn',
	'',
	'1. Review pipeline',
	'2. Confirm forecast',
	'',
	'> A quote worth keeping.',
	'',
	'![Chart](assets/summary/chart.png)',
	'',
].join('\n');

function main() {
	// The real service path passes ONLY the resolved Markdown (which already leads with `# title` + `_subtitle_`);
	// the writer promotes those to Word's Title/Subtitle styles, so the title is never rendered twice.
	const buf = renderDocx({
		markdown,
		images: { 'assets/summary/chart.png': PNG_1x1 },
	});

	// 1. It is a real ZIP (PK signature) and the OOXML parts are all present + CRC-valid.
	assert.strictEqual(buf.subarray(0, 2).toString('latin1'), 'PK', 'ZIP magic');
	const docXml = readZipEntry(buf, 'word/document.xml').toString('utf8');
	const stylesXml = readZipEntry(buf, 'word/styles.xml').toString('utf8');
	const numberingXml = readZipEntry(buf, 'word/numbering.xml').toString('utf8');
	const contentTypes = readZipEntry(buf, '[Content_Types].xml').toString('utf8');
	assert.ok(readZipEntry(buf, 'word/_rels/document.xml.rels'), 'document rels part present');
	assert.ok(readZipEntry(buf, 'word/media/image1.png'), 'image media part present');

	// 2. Well-formed-ish XML.
	assert.ok(docXml.startsWith('<?xml'), 'document.xml is XML');
	assert.ok(contentTypes.includes('wordprocessingml.document.main+xml'), 'content types declare the doc part');

	// 3. Built-in styles: the body uses these (the leading `# title` is promoted to Title, the `##` sections to
	// Heading 2), and styles.xml DEFINES the full set (incl. Heading 1) so the receiving org can restyle.
	for (const styleId of ['Title', 'Subtitle', 'Heading2', 'ListBullet', 'ListNumber', 'TableGrid', 'Quote', 'Hyperlink']) {
		assert.ok(docXml.includes(`w:val="${styleId}"`), `body uses ${styleId}`);
	}
	for (const styleId of ['Title', 'Subtitle', 'Heading1', 'Heading2', 'ListBullet', 'ListNumber', 'TableGrid']) {
		assert.ok(stylesXml.includes(`w:styleId="${styleId}"`), `styles.xml defines ${styleId}`);
	}
	// The leading `# title` is promoted to the Title style and rendered ONCE (never also as a Heading 1).
	assert.strictEqual(docXml.split('Weekly Summary').length - 1, 1, 'the title appears exactly once');
	// Built-in NAMES (so Word treats them as native and a restyle reflows ours).
	for (const name of ['Title', 'heading 1', 'heading 2', 'List Bullet', 'List Number', 'Table Grid']) {
		assert.ok(stylesXml.includes(`w:val="${name}"`), `styles.xml carries built-in name "${name}"`);
	}

	// 4. Structure landed: title/subtitle, headings, table cells, list numbering, quote, hyperlink, image.
	assert.ok(docXml.includes('Weekly Summary'), 'title text');
	assert.ok(docXml.includes('Key Figures') && docXml.includes('Notes'), 'headings');
	assert.ok(docXml.includes('<w:tbl>') && docXml.includes('Revenue') && docXml.includes('Signups'), 'GFM table -> w:tbl');
	assert.ok(docXml.includes('<w:numPr>') && docXml.includes(`w:numId w:val="1"`) && docXml.includes(`w:numId w:val="100"`), 'bullet + ordered numbering (ordered list uses a per-list instance)');
	assert.ok(docXml.includes('<w:ilvl w:val="1"/>'), 'nested list level');
	assert.ok(numberingXml.includes('abstractNum'), 'numbering.xml has abstractNum defs');
	assert.ok(docXml.includes('<w:hyperlink'), 'hyperlink run');
	assert.ok(docXml.includes('<w:drawing>') && docXml.includes('r:embed='), 'inline image drawing');
	assert.ok(docXml.includes('<w:b/>') && docXml.includes('$1.2M'), 'bold inline + inlined value text');

	// 5. Bound values are inlined as PLAIN TEXT and NO Abstract chrome reaches the output.
	assert.ok(!docXml.includes('bind:'), 'no bind: chrome');
	assert.ok(!/provenance|data-cells|diff|d-o|d-n|editblock|bound-figure/i.test(docXml), 'no provenance/diff chrome');

	// 6. Plain-Markdown (non-living) still exports cleanly.
	const plain = renderDocx({ title: 'Plain', markdown: 'Just a paragraph.\n' });
	assert.ok(readZipEntry(plain, 'word/document.xml').toString('utf8').includes('Just a paragraph.'), 'plain export body');

	// 7. Emphasis parsing keeps intra-word and unmatched `*`/`_` as literal text (never silently dropped), while
	// still toggling for genuinely paired emphasis. A run is {text, bold, italic}; we assert the literal survives
	// with no emphasis, and that valid pairs still style.
	const plainText = t => parseInline(t).map(r => r.text).join('');
	const isPlainRun = t => { const rs = parseInline(t); return rs.length === 1 && rs[0].kind === 'text' && !rs[0].bold && !rs[0].italic; };
	assert.ok(isPlainRun('customer_id') && plainText('customer_id') === 'customer_id', 'intra-word underscore kept literal');
	assert.ok(isPlainRun('a * b') && plainText('a * b') === 'a * b', 'space-flanked asterisk kept literal');
	assert.ok(isPlainRun('unmatched_') && plainText('unmatched_') === 'unmatched_', 'unmatched underscore kept literal');
	assert.ok(isPlainRun('a__b') && plainText('a__b') === 'a__b', 'intra-word bold underscore kept literal');
	assert.ok(parseInline('_hi_').some(r => r.italic && r.text === 'hi'), 'valid italic still toggles');
	assert.ok(parseInline('**hi**').some(r => r.bold && r.text === 'hi'), 'valid bold still toggles');

	// 8. Ordered lists preserve their starting ordinal and number independently. `3. Third` must start at 3 (a
	// startOverride), and two separate ordered lists get distinct numbering instances so they do not continue
	// one another.
	const ol = renderDocx({ title: 'L', markdown: ['3. Third', '4. Fourth', '', 'A paragraph.', '', '1. One', '2. Two', ''].join('\n') });
	const olDoc = readZipEntry(ol, 'word/document.xml').toString('utf8');
	const olNum = readZipEntry(ol, 'word/numbering.xml').toString('utf8');
	assert.ok(olNum.includes('<w:startOverride w:val="3"/>'), 'first ordered list starts at 3');
	assert.ok(olNum.includes('<w:startOverride w:val="1"/>'), 'second ordered list starts at 1');
	assert.ok(olDoc.includes('w:numId w:val="100"') && olDoc.includes('w:numId w:val="101"'), 'two independent ordered numbering instances');

	console.log('lwd-docx.test.js: OK');
}

main();
