/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// Unit tests for the source-extraction + parsing-floor engine (issue #131, doc 22 §4/§6). Run with:
//   node --test scripts/lwd-source-extract.test.js
// SheetJS and pdf-parse are the real libraries (installed as dev deps); the PDF-branching tests also
// use a small stub class so the readable/image-only/password logic is proven without a binary.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');
const { PDFParse } = require('pdf-parse');
const E = require('./lwd-source-extract.js');
const { makeTextPdf, makeImageOnlyPdf } = require('./lwd-source-extract.fixtures.js');

// --- number parsing floor (doc 21 §6.5) -------------------------------------------------------

test('parseNumberCell folds the Excel number realities', () => {
	const cases = [
		['$1,234.56', '1234.56'],   // currency + US thousands + decimal
		['(430)', '-430'],          // parenthesised negative
		['($1,000)', '-1000'],      // parenthesised negative currency
		['1.234,56', '1234.56'],    // European: dot thousands, comma decimal
		['1,234', '1234'],          // US thousands, no decimal
		['12,5', '12.5'],           // European decimal comma
		['12%', '12%'],             // percent marker preserved
		['-7.5', '-7.5'],           // plain signed decimal
		['£2,500', '2500'],         // pound + thousands
		['1.234.567', '1234567'],   // grouped thousands with dots
	];
	for (const [input, expected] of cases) {
		assert.equal(E.parseNumberCell(input), expected, `parseNumberCell(${JSON.stringify(input)})`);
	}
	// Text is never coerced.
	for (const text of ['Q1 2026', 'Acme Ltd', '', 'N/A', 'TBD']) {
		assert.equal(E.parseNumberCell(text), null, `parseNumberCell(${JSON.stringify(text)}) should be null`);
	}
});

// --- date normalisation (doc 21 §6.5 "dates in three formats") --------------------------------

test('normaliseDateCell folds three date shapes to ISO', () => {
	assert.equal(E.normaliseDateCell('2026-01-05'), '2026-01-05');
	assert.equal(E.normaliseDateCell('13/01/2026'), '2026-01-13'); // 13 > 12 so day-first is forced
	assert.equal(E.normaliseDateCell('01/13/2026'), '2026-01-13'); // month-first
	assert.equal(E.normaliseDateCell('05/06/2026'), '2026-05-06'); // ambiguous -> month-first default
	assert.equal(E.normaliseDateCell('05/06/2026', true), '2026-06-05'); // dayFirst hint
	assert.equal(E.normaliseDateCell('12 Jan 2026'), '2026-01-12');
	assert.equal(E.normaliseDateCell('Jan 12, 2026'), '2026-01-12');
	assert.equal(E.normaliseDateCell('hello'), null);
});

// --- delimiter sniffing + encoding (BOM / Windows-1252) ---------------------------------------

test('sniffDelimiter picks the dominant delimiter outside quotes', () => {
	assert.equal(E.sniffDelimiter('a;b;c\n1;2;3'), ';');
	assert.equal(E.sniffDelimiter('a,b,c\n1,2,3'), ',');
	assert.equal(E.sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
	assert.equal(E.sniffDelimiter('"a,b";c\n"1,2";3'), ';'); // comma inside quotes is not the delimiter
});

test('decodeBuffer strips BOMs and tolerates Windows-1252', () => {
	// UTF-8 BOM.
	const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('name,mrr\nAcme,10', 'utf8')]);
	assert.equal(E.decodeBuffer(bom).text, 'name,mrr\nAcme,10');
	assert.equal(E.decodeBuffer(bom).encoding, 'utf-8-bom');
	// Windows-1252: 0x92 is a curly apostrophe, 0xA3 is the pound sign - invalid UTF-8, must not mangle.
	const cp1252 = Buffer.from([0x49, 0x74, 0x92, 0x73, 0x20, 0xA3, 0x35]); // "It’s £5"
	const decoded = E.decodeBuffer(cp1252);
	assert.equal(decoded.encoding, 'windows-1252');
	assert.equal(decoded.text, 'It’s £5');
});

test('normaliseCsv re-emits a semicolon/BOM/Windows-1252 CSV as clean comma CSV', () => {
	// European Excel: BOM + semicolons + comma decimals + a currency column + a slash date.
	const raw = Buffer.concat([
		Buffer.from([0xEF, 0xBB, 0xBF]),
		Buffer.from('name;mrr;date\nAcme;1.234,56;13/01/2026\nBeta;(430);05/02/2026\n', 'utf8'),
	]);
	const out = E.normaliseCsv(raw, { dayFirst: true });
	assert.equal(out.delimiter, ';');
	assert.equal(out.csv, 'name,mrr,date\nAcme,1234.56,2026-01-13\nBeta,-430,2026-02-05\n');
});

// --- workbook extraction (real SheetJS) -------------------------------------------------------

function buildWorkbook() {
	const wb = xlsx.utils.book_new();
	// FY26: currency, thousands, parenthesised negative, percent, dates.
	const fy26 = xlsx.utils.aoa_to_sheet([
		['Month', 'MRR', 'Churn', 'Net'],
		['2026-01-05', '$1,234.56', '2%', '(430)'],
		['2026-02-05', '$2,000', '1.5%', '150'],
	]);
	xlsx.utils.book_append_sheet(wb, fy26, 'FY26');
	// Merged-header sheet: a merged cell spanning the header row must WARN, not silently misalign.
	const merged = xlsx.utils.aoa_to_sheet([
		['Region', 'Sales', ''],
		['', 'Q1', 'Q2'],
		['North', '10', '20'],
	]);
	merged['!merges'] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }]; // B1:C1 merged, touches header row 0
	xlsx.utils.book_append_sheet(wb, merged, 'Merged');
	return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('extractWorkbook writes one clean normalised CSV per sheet', () => {
	const buffer = buildWorkbook();
	const { sheets } = E.extractWorkbook(buffer, xlsx, { dayFirst: false });
	const fy26 = sheets.find(s => s.name === 'FY26');
	assert.ok(fy26, 'FY26 sheet extracted');
	// Numbers/dates normalised; header preserved.
	assert.equal(fy26.csv, 'Month,MRR,Churn,Net\n2026-01-05,1234.56,2%,-430\n2026-02-05,2000,1.5%,150\n');
	assert.deepEqual(fy26.warnings, []);
});

test('extractWorkbook NAMES a merged-header sheet rather than misaligning it', () => {
	const buffer = buildWorkbook();
	const { sheets } = E.extractWorkbook(buffer, xlsx, {});
	const merged = sheets.find(s => s.name === 'Merged');
	assert.ok(merged, 'Merged sheet extracted');
	assert.ok(
		merged.warnings.some(w => /merged header/i.test(w)),
		`expected a merged-header warning, got ${JSON.stringify(merged.warnings)}`,
	);
});

test('sheetFileName produces a portable file name', () => {
	assert.equal(E.sheetFileName('FY26'), 'FY26.csv');
	assert.equal(E.sheetFileName('Sales / EU'), 'Sales - EU.csv');
	assert.equal(E.sheetFileName(''), 'Sheet.csv');
});

// --- PDF extraction: stubbed branches ---------------------------------------------------------

test('extractPdf reads a text PDF, and names image-only / password PDFs unreadable (stubbed)', async () => {
	class ReadableStub { constructor() { } async getText() { return { text: 'Revenue grew to 1234 this quarter.', total: 1, pages: [{ num: 1, text: 'x' }] }; } async destroy() { } }
	class ImageOnlyStub { constructor() { } async getText() { return { text: '   \n  ', total: 3, pages: [] }; } async destroy() { } }
	class PasswordStub { constructor() { } async getText() { const e = new Error('nope'); e.name = 'PasswordException'; throw e; } async destroy() { } }

	const ok = await E.extractPdf(Buffer.from('x'), ReadableStub);
	assert.equal(ok.readable, true);
	assert.match(ok.text, /Revenue grew/);

	const scanned = await E.extractPdf(Buffer.from('x'), ImageOnlyStub);
	assert.equal(scanned.readable, false);
	assert.match(scanned.reason, /scanned or image-only/i);

	const locked = await E.extractPdf(Buffer.from('x'), PasswordStub);
	assert.equal(locked.readable, false);
	assert.match(locked.reason, /password-protected/i);
});

// --- PDF extraction: real pdf-parse against generated fixtures ---------------------------------

test('extractPdf reads a real text PDF and names a real text-free PDF unreadable', async () => {
	const textPdf = makeTextPdf('Weekly revenue reached 1234 dollars.');
	const readable = await E.extractPdf(textPdf, PDFParse);
	assert.equal(readable.readable, true, `expected readable, got ${JSON.stringify(readable)}`);
	assert.match(readable.text, /revenue/i);

	const imageOnly = makeImageOnlyPdf();
	const unreadable = await E.extractPdf(imageOnly, PDFParse);
	assert.equal(unreadable.readable, false, `expected unreadable, got ${JSON.stringify(unreadable)}`);
	assert.match(unreadable.reason, /no selectable text|could not be read/i);
});
