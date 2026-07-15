/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// The source-extraction + parsing-floor engine for the "spreadsheets as CSV sources + PDF as
// read-only context" domain (issue #131, doc 22 §4). Extraction runs in the node/proxy layer where
// file access lives, NEVER in the renderer (P6 portability + the guardrail that a limitation is
// named, never a silent misread). This module is pure and dependency-injectable so it can be
// unit-tested directly with `node --test` (see lwd-source-extract.test.js): callers pass in the
// heavy libraries (SheetJS for workbooks, pdf-parse for PDF text) so the tests can stub them.
//
// What it does:
//  - decodeBuffer: strip a UTF-8/UTF-16 BOM, tolerate Windows-1252 bytes, yield a clean string.
//  - sniffDelimiter: choose `,` vs `;` vs tab for a European-Excel "CSV" that is not comma-delimited.
//  - parseNumberCell: read `$1,234.56`, `(430)`, `1.234,56`, `12%` as their real numeric value.
//  - normaliseDateCell: fold three common date shapes to an ISO `YYYY-MM-DD`.
//  - normaliseCsv: re-emit a messy CSV as clean, comma-delimited, number/date-normalised UTF-8.
//  - extractWorkbook: one clean CSV per sheet, with NAMED limitations (merged headers, pivots).
//  - extractPdf: page text for a text PDF; an image-only/scanned PDF names itself unreadable.
//
// Everything the engine cannot do honestly returns a stated reason - it never fabricates a value
// or silently misreads (plan 33 L8).

// --- encoding ---------------------------------------------------------------------------------

// Decode a source file's raw bytes to a string, tolerating the Excel realities from doc 21 §6.5:
// a UTF-8/UTF-16 byte-order mark, and Windows-1252 (CP-1252) bytes that plain UTF-8 would mangle
// into replacement characters. Returns the decoded text plus the detected encoding label (for the
// named-limitation surface). `buffer` is a Node Buffer.
function decodeBuffer(buffer) {
	if (!buffer || buffer.length === 0) { return { text: '', encoding: 'utf-8' }; }
	// UTF-16 LE/BE BOM.
	if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
		return { text: buffer.toString('utf16le', 2), encoding: 'utf-16le' };
	}
	if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
		// Node has no native utf16be; swap byte pairs then decode as LE.
		const swapped = Buffer.from(buffer.subarray(2));
		swapped.swap16();
		return { text: swapped.toString('utf16le'), encoding: 'utf-16be' };
	}
	// UTF-8 BOM.
	let start = 0;
	if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
		start = 3;
	}
	const body = start ? buffer.subarray(start) : buffer;
	// Is the body valid UTF-8? Round-trip and look for the replacement character U+FFFD, which
	// signals a decode failure - the classic sign of Windows-1252 bytes (a lone 0x92 curly quote,
	// 0xA3 pound sign, etc.) read as UTF-8.
	const asUtf8 = body.toString('utf8');
	if (asUtf8.indexOf('�') === -1) {
		return { text: asUtf8, encoding: start ? 'utf-8-bom' : 'utf-8' };
	}
	return { text: decodeWindows1252(body), encoding: 'windows-1252' };
}

// Map Windows-1252 (CP-1252) bytes to their Unicode code points. Bytes 0x00-0x7F and 0xA0-0xFF are
// Latin-1 identical; only 0x80-0x9F differ (the "smart" punctuation Excel emits). This table covers
// exactly that gap so a pound sign, curly quotes, en/em dashes and the euro sign survive.
const CP1252_HIGH = {
	0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
	0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018,
	0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC,
	0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};
function decodeWindows1252(body) {
	let out = '';
	for (let i = 0; i < body.length; i++) {
		const b = body[i];
		if (b >= 0x80 && b <= 0x9F) {
			out += String.fromCodePoint(CP1252_HIGH[b] ?? b);
		} else {
			out += String.fromCodePoint(b);
		}
	}
	return out;
}

// --- delimiter --------------------------------------------------------------------------------

// Sniff the field delimiter of a delimited-text source. European Excel emits `;`-separated files
// (because the comma is the decimal separator there), and TSV is common from database exports. We
// count candidate delimiters OUTSIDE quoted fields across the first few lines and pick the winner;
// a comma is the default when nothing else dominates. Returns one of ',' ';' '\t' '|'.
function sniffDelimiter(text) {
	const candidates = [',', ';', '\t', '|'];
	const lines = text.split(/\r?\n/).filter(l => l.length > 0).slice(0, 5);
	if (!lines.length) { return ','; }
	const scores = new Map(candidates.map(c => [c, 0]));
	for (const line of lines) {
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '"') { inQuotes = !inQuotes; continue; }
			if (inQuotes) { continue; }
			if (scores.has(ch)) { scores.set(ch, scores.get(ch) + 1); }
		}
	}
	let best = ',';
	let bestScore = 0;
	for (const c of candidates) {
		if (scores.get(c) > bestScore) { best = c; bestScore = scores.get(c); }
	}
	return bestScore > 0 ? best : ',';
}

// --- CSV parse / write ------------------------------------------------------------------------

// Parse one delimited line into fields, honouring RFC-4180 double-quote quoting (a `""` inside a
// quoted field is a literal quote). Single-line only; the row splitter above handles line breaks
// (embedded newlines inside quotes are a rare enough case we leave to the workbook path, which
// never has them).
function parseDelimitedLine(line, delimiter) {
	const fields = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			fields.push(field); field = '';
		} else {
			field += ch;
		}
	}
	fields.push(field);
	return fields;
}

// Emit one row as a clean comma-delimited CSV line, quoting any cell that contains a comma, a double
// quote, or a line break (RFC-4180). The extracted CSVs must be plain text a non-Abstract user can
// open in any tool (P6), so we always emit UTF-8 with `\n` and a comma delimiter.
function writeCsvRow(cells) {
	return cells.map(cell => {
		const s = cell == null ? '' : String(cell);
		if (/[",\n\r]/.test(s)) { return '"' + s.replace(/"/g, '""') + '"'; }
		return s;
	}).join(',');
}

// --- number normalisation ---------------------------------------------------------------------

// Read a cell as a number if it plausibly is one, folding the Excel realities (doc 21 §6.5): a
// leading currency symbol, thousands separators, a parenthesised negative `(430)`, a trailing
// percent, and both US (`1,234.56`) and European (`1.234,56`) grouping. Returns the machine value
// as a string when confident, otherwise `null` (the cell is left as-is - text is never coerced).
function parseNumberCell(raw) {
	if (raw == null) { return null; }
	let s = String(raw).trim();
	if (s === '') { return null; }
	let negative = false;
	// Parenthesised negative: `(430)` or `($430)`.
	const paren = /^\((.*)\)$/.exec(s);
	if (paren) { negative = true; s = paren[1].trim(); }
	// A trailing percent is preserved as a marker but does not block numeric parsing.
	let percent = false;
	if (/%$/.test(s)) { percent = true; s = s.slice(0, -1).trim(); }
	// Strip a leading/trailing currency symbol and any surrounding spaces.
	s = s.replace(/^\s*[$€£¥₹]\s?/, '').replace(/\s*[$€£¥₹]\s*$/, '').trim();
	// A leading sign after symbol stripping.
	if (/^[-+]/.test(s)) {
		if (s[0] === '-') { negative = !negative; }
		s = s.slice(1).trim();
	}
	// Must now look like grouped digits with an optional decimal part.
	if (!/^[0-9][0-9.,\s]*$/.test(s)) { return null; }
	s = s.replace(/\s/g, '');
	const hasDot = s.indexOf('.') >= 0;
	const hasComma = s.indexOf(',') >= 0;
	let normalised;
	if (hasDot && hasComma) {
		// The rightmost separator is the decimal point; the other groups thousands.
		if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
			normalised = s.replace(/,/g, '');            // US: comma thousands, dot decimal.
		} else {
			normalised = s.replace(/\./g, '').replace(',', '.'); // EU: dot thousands, comma decimal.
		}
	} else if (hasComma) {
		// Single comma: a `1,234` / `1,234,567` shape reads as thousands; otherwise a decimal comma.
		normalised = /^\d{1,3}(,\d{3})+$/.test(s)
			? s.replace(/,/g, '')
			: s.replace(',', '.');
	} else {
		// Only dots: `1.234.567` is grouped thousands; a single dot is a decimal.
		normalised = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
	}
	const n = Number(normalised);
	if (!isFinite(n)) { return null; }
	const signed = negative ? -n : n;
	// Keep the plain machine value; re-attach the percent marker so downstream formatting (which
	// re-adds `%` for rates) still recognises it.
	return percent ? `${signed}%` : String(signed);
}

// --- date normalisation -----------------------------------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Fold a date-looking cell to an ISO `YYYY-MM-DD`. Handles ISO already, `DD/MM/YYYY` and
// `MM/DD/YYYY` (ambiguous -> see note), and `12 Jan 2026` / `Jan 12, 2026`. Returns null when the
// cell is not clearly a date (never coerces a plain number or text). The day/month order for a
// slash date is resolved by value where possible (a component > 12 must be the day); a genuinely
// ambiguous slash date (both <= 12) is read day-first only when `dayFirst` is set, else month-first
// (US Excel default).
function normaliseDateCell(raw, dayFirst = false) {
	if (raw == null) { return null; }
	const s = String(raw).trim();
	if (s === '') { return null; }
	// Already ISO.
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
	if (m) { return isoDate(+m[1], +m[2], +m[3]); }
	// Slash or dot separated numeric date.
	m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/.exec(s);
	if (m) {
		const a = +m[1], b = +m[2];
		const year = normaliseYear(+m[3]);
		let day, month;
		if (a > 12 && b <= 12) { day = a; month = b; }
		else if (b > 12 && a <= 12) { month = a; day = b; }
		else { if (dayFirst) { day = a; month = b; } else { month = a; day = b; } }
		return isoDate(year, month, day);
	}
	// `12 Jan 2026` / `12 January 2026`.
	m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/.exec(s);
	if (m) {
		const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
		if (month) { return isoDate(normaliseYear(+m[3]), month, +m[1]); }
	}
	// `Jan 12, 2026` / `January 12 2026`.
	m = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(s);
	if (m) {
		const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
		if (month) { return isoDate(normaliseYear(+m[3]), month, +m[2]); }
	}
	return null;
}

function normaliseYear(y) { return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; }

function isoDate(year, month, day) {
	if (month < 1 || month > 12 || day < 1 || day > 31) { return null; }
	const mm = String(month).padStart(2, '0');
	const dd = String(day).padStart(2, '0');
	return `${year}-${mm}-${dd}`;
}

// Normalise one cell's text: numbers first (the common case), then dates, else leave untouched.
function normaliseCell(raw, opts) {
	const num = parseNumberCell(raw);
	if (num !== null) { return num; }
	const date = normaliseDateCell(raw, opts && opts.dayFirst);
	if (date !== null) { return date; }
	return raw == null ? '' : String(raw);
}

// --- CSV normalisation (raw file -> clean CSV) ------------------------------------------------

// Re-emit a raw delimited-text file as clean, comma-delimited, number/date-normalised UTF-8 CSV.
// This is the parsing floor applied to a CSV/TSV the user already has (a `;`-delimited European
// export, a BOM/Windows-1252 file). `buffer` is the raw bytes. Returns { csv, delimiter, encoding,
// warnings }.
function normaliseCsv(buffer, opts) {
	const { text, encoding } = decodeBuffer(buffer);
	const warnings = [];
	if (encoding === 'windows-1252') { warnings.push('Read as Windows-1252 text (not UTF-8) - a few characters may differ.'); }
	const delimiter = sniffDelimiter(text);
	const rows = text.split(/\r?\n/).filter(l => l.length > 0).map(l => parseDelimitedLine(l, delimiter));
	const out = rows.map((cells, i) => writeCsvRow(i === 0 ? cells.map(c => c.trim()) : cells.map(c => normaliseCell(c, opts))));
	return { csv: out.join('\n') + (out.length ? '\n' : ''), delimiter, encoding, warnings };
}

// --- workbook extraction ----------------------------------------------------------------------

// Extract each sheet of an xlsx/xls workbook to a clean comma-delimited CSV, normalising numbers
// and dates on the way out (doc 22 §4). `buffer` is the workbook bytes; `xlsx` is the injected
// SheetJS module (require('xlsx')) - injected so the engine stays testable without the binary lib.
// Returns { sheets: [{ name, csv, rows, cols, warnings }] }. A sheet with merged header cells is a
// NAMED limitation ("this sheet has merged headers - values may misalign"), never a silent misread.
function extractWorkbook(buffer, xlsx, opts) {
	const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true, cellNF: false });
	const sheets = [];
	for (const name of wb.SheetNames) {
		const ws = wb.Sheets[name];
		if (!ws || !ws['!ref']) { sheets.push({ name, csv: '', rows: 0, cols: 0, warnings: ['This sheet is empty.'] }); continue; }
		const warnings = [];
		const merges = ws['!merges'] || [];
		const range = xlsx.utils.decode_range(ws['!ref']);
		const headerRow = range.s.r;
		// A merge that touches the header row means the column headers do not line up 1:1 with the
		// data columns - warn rather than silently misalign the values (doc 22 §4, doc 21 §6.5).
		if (merges.some(mg => mg.s.r <= headerRow && mg.e.r >= headerRow)) {
			warnings.push('This sheet has merged header cells - values may misalign with their columns.');
		} else if (merges.length) {
			warnings.push('This sheet has merged cells - the extracted grid flattens them to their top-left value.');
		}
		// Read the grid as a matrix, then normalise each non-header cell.
		const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
		const cleaned = matrix.map((row, i) => (i === 0
			? row.map(c => String(c == null ? '' : c).trim())
			: row.map(c => normaliseCell(c, opts))));
		const cols = cleaned.reduce((max, r) => Math.max(max, r.length), 0);
		// A "pivot-looking" sheet (a largely blank header band above a totals block) is common; we
		// cannot reliably un-pivot it, so we name that limitation when the header row is mostly blank.
		if (cleaned.length && cols > 1 && cleaned[0].filter(c => String(c).trim() !== '').length < Math.max(1, Math.floor(cols / 2))) {
			warnings.push('This sheet looks like a pivot or report layout - column headers may be incomplete.');
		}
		const csv = cleaned.map(r => writeCsvRow(padRow(r, cols))).join('\n') + (cleaned.length ? '\n' : '');
		sheets.push({ name, csv, rows: cleaned.length, cols, warnings });
	}
	return { sheets };
}

function padRow(row, cols) {
	if (row.length >= cols) { return row; }
	const out = row.slice();
	while (out.length < cols) { out.push(''); }
	return out;
}

// A workbook sheet name becomes a file name: keep it legible but strip characters illegal on common
// filesystems, and never let it be empty. Mirrors the "portable file on disk" rule (P6).
function sheetFileName(name) {
	const cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
	return (cleaned || 'Sheet') + '.csv';
}

// --- PDF extraction ---------------------------------------------------------------------------

// Extract the text of a PDF for use as read-only CONTEXT (doc 22 §4 - PDFs feed framing, never
// value bindings). `buffer` is the PDF bytes; `PdfParse` is the injected pdf-parse `PDFParse` class.
// A password-protected or corrupt PDF, and a scanned/image-only PDF that yields no text, each NAME
// themselves unreadable (with a plain-words reason) rather than returning empty context. Returns
// { readable, text, pages, reason }.
async function extractPdf(buffer, PdfParse) {
	let parser;
	try {
		parser = new PdfParse({ data: buffer });
	} catch (e) {
		return { readable: false, text: '', pages: 0, reason: 'This PDF could not be opened.' };
	}
	try {
		const result = await parser.getText();
		// pdf-parse injects a `-- N of M --` page-separator marker per page; strip those so the
		// emptiness check measures real document content, not the library's own chrome.
		const text = (result.text || '').replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '').trim();
		const pages = result.total || (result.pages ? result.pages.length : 0);
		// A page count with (almost) no extractable text is the scanned/image-only signature: the page
		// is a picture of a document, not selectable text. Name it unreadable, don't yield empty context.
		if (text.replace(/\s/g, '').length < 8) {
			return { readable: false, text: '', pages, reason: 'This PDF has no selectable text - it looks scanned or image-only.' };
		}
		return { readable: true, text, pages, reason: '' };
	} catch (e) {
		const msg = String(e && e.name ? e.name : e);
		const reason = /Password/i.test(msg)
			? 'This PDF is password-protected.'
			: 'This PDF could not be read.';
		return { readable: false, text: '', pages: 0, reason };
	} finally {
		try { if (parser && parser.destroy) { await parser.destroy(); } } catch { /* already gone */ }
	}
}

module.exports = {
	decodeBuffer,
	decodeWindows1252,
	sniffDelimiter,
	parseDelimitedLine,
	writeCsvRow,
	parseNumberCell,
	normaliseDateCell,
	normaliseCell,
	normaliseCsv,
	extractWorkbook,
	sheetFileName,
	extractPdf,
};
