/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure GFM-table helpers for the in-place table cell editor (issue #140). These are string-in /
// string-out functions with NO DOM and NO browser globals, so they live in `common/` and are unit
// tested. They are ALSO injected verbatim into the webview RUNTIME (via `String(fn)` in
// livingDocRender.ts): the runtime's thin DOM shim calls them to edit a `table_block` node's
// `markdown` attr. Because of that dual use every function here must stay fully self-contained -
// plain ES with no imports, no captured module state, and no TypeScript-only syntax that would
// transpile to a runtime helper reference. The split/escape/alignment logic deliberately MIRRORS
// the shipped ProseMirror bundle's own table code (`Ch`/`Dh`/`Sh`/`ca`/`xh`) so a parse->serialize
// round-trip is byte-identical to what the bundle writes to disk (lossless on an untouched table).

/** A GFM table decomposed into its header cells, per-column alignment, and body rows. */
export interface IGfmTable {
	readonly header: string[];
	/** One entry per column: '' (default), 'left', 'center' or 'right'. */
	readonly align: string[];
	readonly rows: string[][];
}

// Split one table row into its raw cell strings, mirroring the bundle's `Ch`: strip a leading and a
// trailing pipe, then split on unescaped `|`, honouring `\|` as a literal pipe, and trim each cell.
// The returned cells are the RAW cell text (pipes unescaped, inline Markdown intact) - exactly what
// seeds the cell editor.
export function gfmSplitCells(line: string): string[] {
	let e = String(line).trim();
	if (e.charAt(0) === '|') { e = e.slice(1); }
	if (e.charAt(e.length - 1) === '|') { e = e.slice(0, -1); }
	const cells: string[] = [];
	let cur = '';
	for (let i = 0; i < e.length; i++) {
		const ch = e.charAt(i);
		if (ch === '\\' && e.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
		if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
		cur += ch;
	}
	cells.push(cur.trim());
	return cells;
}

// True when every cell of a row is a GFM alignment marker (mirrors the bundle's `Dh`): the row that
// separates the header from the body, e.g. `:---`, `---`, `:---:`, `---:`.
export function gfmIsAlignRow(cells: string[]): boolean {
	return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(String(c).replace(/\s/g, '')));
}

// Parse a single alignment-marker cell into '', 'left', 'center' or 'right' (mirrors the bundle's `Sh`).
export function gfmParseAlign(cell: string): string {
	const e = String(cell).replace(/\s/g, '');
	const left = e.charAt(0) === ':';
	const right = e.charAt(e.length - 1) === ':';
	return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
}

// Escape a cell's raw text for serialization (mirrors the bundle's `ca`): a literal pipe becomes `\|`
// so it cannot be read as a column separator.
export function gfmEscapeCell(text: string): string {
	return String(text).replace(/\|/g, '\\|');
}

// Parse a GFM table's Markdown (the `table_block` node's `markdown` attr) into {header, align, rows}.
// Rows are padded to the header width so cell access is always defined; a normalized table (what the
// bundle stores) is already rectangular, so padding is a no-op there and the round-trip stays lossless.
export function parseGfmTable(md: string): IGfmTable {
	const lines = String(md === null || md === undefined ? '' : md).split('\n').map(l => l.trim()).filter(l => l.length > 0);
	let header: string[] | null = null;
	let align: string[] = [];
	const rows: string[][] = [];
	for (let i = 0; i < lines.length; i++) {
		const cells = gfmSplitCells(lines[i]);
		if (gfmIsAlignRow(cells)) { align = cells.map(gfmParseAlign); continue; }
		if (header === null) { header = cells; } else { rows.push(cells); }
	}
	const h = header || [];
	const width = h.length;
	for (let r = 0; r < rows.length; r++) {
		while (rows[r].length < width) { rows[r].push(''); }
	}
	return { header: h, align, rows };
}

// Serialize {header, align, rows} back to GFM Markdown, byte-identical to the bundle's `xh`: a
// `| a | b |` header, a `| :--- | --- |` alignment row (one marker per header column), then one line
// per body row. Cells are pipe-escaped; alignment markers follow left/center/right/default.
export function serializeGfmTable(t: IGfmTable): string {
	const width = t.header.length;
	const out: string[] = [];
	out.push('| ' + t.header.map(gfmEscapeCell).join(' | ') + ' |');
	const marks: string[] = [];
	for (let c = 0; c < width; c++) {
		const a = t.align[c] || '';
		marks.push(a === 'left' ? ':---' : a === 'center' ? ':---:' : a === 'right' ? '---:' : '---');
	}
	out.push('| ' + marks.join(' | ') + ' |');
	for (let r = 0; r < t.rows.length; r++) {
		const row = t.rows[r].slice(0, width);
		while (row.length < width) { row.push(''); }
		out.push('| ' + row.map(gfmEscapeCell).join(' | ') + ' |');
	}
	return out.join('\n');
}

// Set one cell's raw text. r < 0 addresses the header; r >= 0 addresses body row r. Out-of-range
// addresses are ignored (the editor never dispatches an out-of-range commit, but stay defensive).
export function setCell(t: IGfmTable, r: number, c: number, text: string): IGfmTable {
	if (c < 0 || c >= t.header.length) { return t; }
	if (r < 0) {
		const header = t.header.slice();
		header[c] = text;
		return { header, align: t.align.slice(), rows: t.rows.map(row => row.slice()) };
	}
	if (r >= t.rows.length) { return t; }
	const rows = t.rows.map(row => row.slice());
	rows[r][c] = text;
	return { header: t.header.slice(), align: t.align.slice(), rows };
}

// Insert an empty body row at index `at` (clamped to [0, rows.length]).
export function insertRow(t: IGfmTable, at: number): IGfmTable {
	const width = t.header.length;
	const rows = t.rows.map(row => row.slice());
	const blank: string[] = [];
	for (let c = 0; c < width; c++) { blank.push(''); }
	const idx = Math.max(0, Math.min(at, rows.length));
	rows.splice(idx, 0, blank);
	return { header: t.header.slice(), align: t.align.slice(), rows };
}

// Delete body row `at`. A no-op when `at` is out of range (the header is never a deletable row).
export function deleteRow(t: IGfmTable, at: number): IGfmTable {
	if (at < 0 || at >= t.rows.length) { return t; }
	const rows = t.rows.map(row => row.slice());
	rows.splice(at, 1);
	return { header: t.header.slice(), align: t.align.slice(), rows };
}

// Insert an empty column at index `at` (clamped to [0, width]) across the header, alignment and rows.
export function insertCol(t: IGfmTable, at: number): IGfmTable {
	const width = t.header.length;
	const idx = Math.max(0, Math.min(at, width));
	const header = t.header.slice();
	header.splice(idx, 0, '');
	const align = t.align.slice();
	while (align.length < width) { align.push(''); }
	align.splice(idx, 0, '');
	const rows = t.rows.map(row => {
		const nr = row.slice();
		while (nr.length < width) { nr.push(''); }
		nr.splice(idx, 0, '');
		return nr;
	});
	return { header, align, rows };
}

// Delete column `at`. Guarded to keep at least one column and to a valid index.
export function deleteCol(t: IGfmTable, at: number): IGfmTable {
	const width = t.header.length;
	if (width <= 1 || at < 0 || at >= width) { return t; }
	const header = t.header.slice();
	header.splice(at, 1);
	const align = t.align.slice();
	while (align.length < width) { align.push(''); }
	align.splice(at, 1);
	const rows = t.rows.map(row => {
		const nr = row.slice();
		while (nr.length < width) { nr.push(''); }
		nr.splice(at, 1);
		return nr;
	});
	return { header, align, rows };
}
