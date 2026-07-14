/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	deleteCol, deleteRow, gfmEscapeCell, gfmIsAlignRow, gfmParseAlign, gfmSplitCells,
	insertCol, insertRow, parseGfmTable, serializeGfmTable, setCell
} from '../../common/livingDocTableEdit.js';

// A normalized 3x2 table exactly as the bundle stores it in the `table_block` `markdown` attr.
const T3x2 = [
	'| Metric | Q1 | Q2 |',
	'| --- | ---: | ---: |',
	'| Revenue | $21,300 | $24,100 |',
	'| Signups | 427 | 512 |',
].join('\n');

suite('LivingDoc table edit', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('gfmSplitCells strips outer pipes, trims, and honours \\| escapes', () => {
		assert.deepStrictEqual(gfmSplitCells('| a | b | c |'), ['a', 'b', 'c']);
		assert.deepStrictEqual(gfmSplitCells('a | b'), ['a', 'b']);
		assert.deepStrictEqual(gfmSplitCells('| x \\| y | z |'), ['x | y', 'z']);
	});

	test('gfmIsAlignRow / gfmParseAlign classify the separator row', () => {
		assert.ok(gfmIsAlignRow(['---', ':---:', '---:']));
		assert.ok(!gfmIsAlignRow(['Metric', 'Q1']));
		assert.strictEqual(gfmParseAlign(':---:'), 'center');
		assert.strictEqual(gfmParseAlign('---:'), 'right');
		assert.strictEqual(gfmParseAlign(':---'), 'left');
		assert.strictEqual(gfmParseAlign('---'), '');
	});

	test('gfmEscapeCell escapes literal pipes', () => {
		assert.strictEqual(gfmEscapeCell('a|b'), 'a\\|b');
		assert.strictEqual(gfmEscapeCell('plain'), 'plain');
	});

	test('parseGfmTable extracts header, per-column alignment and body rows', () => {
		const t = parseGfmTable(T3x2);
		assert.deepStrictEqual(t.header, ['Metric', 'Q1', 'Q2']);
		assert.deepStrictEqual(t.align, ['', 'right', 'right']);
		assert.deepStrictEqual(t.rows, [['Revenue', '$21,300', '$24,100'], ['Signups', '427', '512']]);
	});

	test('parse -> serialize round-trips a normalized table byte-for-byte (alignment preserved)', () => {
		assert.strictEqual(serializeGfmTable(parseGfmTable(T3x2)), T3x2);
	});

	test('escaped-pipe cells survive a parse -> serialize round-trip', () => {
		const md = ['| a | b |', '| --- | --- |', '| x \\| y | z |'].join('\n');
		const t = parseGfmTable(md);
		assert.deepStrictEqual(t.rows, [['x | y', 'z']]);
		assert.strictEqual(serializeGfmTable(t), md);
	});

	test('inline markdown in a cell is preserved as raw text', () => {
		const md = ['| a | b |', '| --- | --- |', '| **bold** | _em_ |'].join('\n');
		const t = parseGfmTable(md);
		assert.strictEqual(t.rows[0][0], '**bold**');
		assert.strictEqual(serializeGfmTable(t), md);
	});

	test('a body row of all-dash cells is data, not a second separator (round-trips)', () => {
		// Only the delimiter line right after the header is the alignment row; a later row whose cells
		// all look like markers (e.g. `| --- | --- |`) is ordinary data and must survive intact.
		const md = ['| a | b |', '| --- | --- |', '| Bob | 5 |', '| --- | --- |', '| Sue | 7 |'].join('\n');
		const t = parseGfmTable(md);
		assert.deepStrictEqual(t.rows, [['Bob', '5'], ['---', '---'], ['Sue', '7']]);
		assert.strictEqual(serializeGfmTable(t), md);
		// Editing an unrelated cell must not drop the all-dash row.
		assert.strictEqual(parseGfmTable(serializeGfmTable(setCell(t, 0, 1, '6'))).rows.length, 3);
	});

	test('setCell edits a body cell and leaves the rest untouched', () => {
		const t = setCell(parseGfmTable(T3x2), 0, 1, '$22,000');
		assert.strictEqual(serializeGfmTable(t), [
			'| Metric | Q1 | Q2 |',
			'| --- | ---: | ---: |',
			'| Revenue | $22,000 | $24,100 |',
			'| Signups | 427 | 512 |',
		].join('\n'));
	});

	test('setCell with r < 0 edits the header', () => {
		const t = setCell(parseGfmTable(T3x2), -1, 0, 'KPI');
		assert.deepStrictEqual(parseGfmTable(serializeGfmTable(t)).header, ['KPI', 'Q1', 'Q2']);
	});

	test('editing one cell leaves a bold cell in a different column intact', () => {
		const md = ['| a | b |', '| --- | --- |', '| **bold** | plain |'].join('\n');
		const edited = setCell(parseGfmTable(md), 0, 1, 'changed');
		const back = parseGfmTable(serializeGfmTable(edited));
		assert.strictEqual(back.rows[0][0], '**bold**');
		assert.strictEqual(back.rows[0][1], 'changed');
	});

	test('insertRow appends an empty body row of the right width', () => {
		const t = insertRow(parseGfmTable(T3x2), 2);
		assert.deepStrictEqual(t.rows[2], ['', '', '']);
		assert.strictEqual(t.rows.length, 3);
	});

	test('insertRow clamps an out-of-range index', () => {
		const t = insertRow(parseGfmTable(T3x2), 99);
		assert.strictEqual(t.rows.length, 3);
		assert.deepStrictEqual(t.rows[2], ['', '', '']);
	});

	test('deleteRow removes a body row and is guarded off the ends', () => {
		const t = deleteRow(parseGfmTable(T3x2), 0);
		assert.deepStrictEqual(t.rows, [['Signups', '427', '512']]);
		assert.strictEqual(deleteRow(parseGfmTable(T3x2), 5).rows.length, 2);
		assert.strictEqual(deleteRow(parseGfmTable(T3x2), -1).rows.length, 2);
	});

	test('deleteRow can empty the body but the header/alignment remain a valid table', () => {
		let t = parseGfmTable(T3x2);
		t = deleteRow(t, 0);
		t = deleteRow(t, 0);
		assert.strictEqual(t.rows.length, 0);
		assert.strictEqual(serializeGfmTable(t), '| Metric | Q1 | Q2 |\n| --- | ---: | ---: |');
	});

	test('insertCol adds a column across header, alignment and every row', () => {
		const t = insertCol(parseGfmTable(T3x2), 1);
		assert.deepStrictEqual(t.header, ['Metric', '', 'Q1', 'Q2']);
		assert.deepStrictEqual(t.align, ['', '', 'right', 'right']);
		assert.deepStrictEqual(t.rows[0], ['Revenue', '', '$21,300', '$24,100']);
	});

	test('deleteCol removes a column and keeps alignment aligned to columns', () => {
		const t = deleteCol(parseGfmTable(T3x2), 1);
		assert.deepStrictEqual(t.header, ['Metric', 'Q2']);
		assert.deepStrictEqual(t.align, ['', 'right']);
		assert.deepStrictEqual(t.rows[0], ['Revenue', '$24,100']);
	});

	test('deleteCol is guarded to keep at least one column', () => {
		const one = parseGfmTable('| only |\n| --- |\n| a |');
		assert.strictEqual(serializeGfmTable(deleteCol(one, 0)), serializeGfmTable(one));
	});

	test('a 1-row table (header only, no body) parses and serializes', () => {
		const md = '| a | b |\n| --- | --- |';
		const t = parseGfmTable(md);
		assert.strictEqual(t.rows.length, 0);
		assert.strictEqual(serializeGfmTable(t), md);
	});

	// The functions are injected into the webview RUNTIME via String(fn); assert each one is fully
	// self-contained - no import/require/helper references the interpolated source would dangle on.
	test('injected helpers are self-contained (no import/require/helper refs in String(fn))', () => {
		const fns = [
			gfmSplitCells, gfmIsAlignRow, gfmParseAlign, gfmEscapeCell,
			parseGfmTable, serializeGfmTable, setCell, insertRow, deleteRow, insertCol, deleteCol,
		];
		for (const fn of fns) {
			const src = String(fn);
			assert.ok(!/\brequire\b/.test(src), `${fn.name} must not reference require`);
			assert.ok(!/\bimport\b/.test(src), `${fn.name} must not reference import`);
			assert.ok(!/__[a-zA-Z]/.test(src), `${fn.name} must not reference a transpiler helper (__x)`);
		}
	});
});
