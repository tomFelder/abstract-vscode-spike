/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { filterMentions } from '../../browser/reviewRailView.js';
import { activeWikilink, documentNamesFromFiles, normalizeWikilinkName, parseWikilinks, rankWikilinkTargets, resolveWikilinkTarget, serializeWikilink, WIKILINK_PICKER_LIMIT, wikilinksToPlainText } from '../../common/wikilinks.js';

suite('livingDocs - [[wikilinks]] (plan 52 WP-C, decision 179)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const DOCS = ['Team Notes', 'Overview', 'Handover notes', 'Q3 Plan', 'Q1/Q2 Review'];

	test('the picker reuses the @-mention ranking, not a second one', () => {
		// The rule is the mention picker's (browser/reviewRailView.ts, #178) lifted into common/ so the
		// webview can inject it: prefix beats mid-string, then shorter, then alphabetical. This asserts BOTH
		// the ranking itself AND that it is byte-for-byte the same answer `filterMentions` gives, so the two
		// can never drift apart without a test failing.
		const names = ['Overview', 'Handover notes', 'Over the wire', 'Team Notes'];
		assert.deepStrictEqual({
			ranked: rankWikilinkTargets(names, 'over'),
			emptyQueryKeepsEverything: rankWikilinkTargets(names, ''),
			noMatch: rankWikilinkTargets(names, 'zzz'),
			capped: rankWikilinkTargets(['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj'], 'a').length,
			matchesMentionPicker: ['over', '', 'notes', 'zzz', 'e'].every(q =>
				JSON.stringify(rankWikilinkTargets(names, q)) === JSON.stringify(filterMentions(names, q))),
		}, {
			ranked: ['Overview', 'Over the wire', 'Handover notes'],
			emptyQueryKeepsEverything: ['Overview', 'Team Notes', 'Over the wire', 'Handover notes'],
			noMatch: [],
			capped: WIKILINK_PICKER_LIMIT,
			matchesMentionPicker: true,
		});
	});

	test('the caret is inside a partial [[ only while the run could still become one', () => {
		// A document name is prose, so unlike an @mention the query may contain spaces. What ends the run is
		// evidence it is NOT an open link: a closing bracket, a second opening bracket, or a line break.
		assert.deepStrictEqual({
			justOpened: activeWikilink('See [[', 6),
			partial: activeWikilink('See [[Team No', 13),
			withSpaces: activeWikilink('See [[Q3 Plan for', 17),
			afterClose: activeWikilink('See [[Team Notes]] then', 23),
			caretBeforeOpen: activeWikilink('See [[Team Notes]]', 3),
			noOpen: activeWikilink('Plain prose here', 16),
			acrossNewline: activeWikilink('See [[\nnext line', 16),
			runaway: activeWikilink(`See [[${'x'.repeat(200)}`, 206),
		}, {
			justOpened: { start: 4, query: '' },
			partial: { start: 4, query: 'Team No' },
			withSpaces: { start: 4, query: 'Q3 Plan for' },
			afterClose: undefined,
			caretBeforeOpen: undefined,
			noOpen: undefined,
			acrossNewline: undefined,
			runaway: undefined,
		});
	});

	test('the on-disk form is exactly [[Target]] - the Obsidian contract - and parses back', () => {
		const body = 'Links to [[Team Notes]] and [[Q3 Plan|the plan]] plus a {{slot}} and [49,800](bind:metrics.mrr).';
		assert.deepStrictEqual({
			plain: serializeWikilink('Team Notes'),
			aliased: serializeWikilink('Q3 Plan', 'the plan'),
			aliasEqualToTargetIsNotWritten: serializeWikilink('Q3 Plan', 'Q3 Plan'),
			trimmed: serializeWikilink('  Team Notes  '),
			parsed: parseWikilinks(body).map(w => ({ target: w.target, alias: w.alias, slice: body.slice(w.start, w.end) })),
			// The other two grammars this document carries must be invisible to the wikilink parser.
			leavesBindAndSlotsAlone: parseWikilinks('{{slot}} and [49,800](bind:metrics.mrr)'),
		}, {
			plain: '[[Team Notes]]',
			aliased: '[[Q3 Plan|the plan]]',
			aliasEqualToTargetIsNotWritten: '[[Q3 Plan]]',
			trimmed: '[[Team Notes]]',
			parsed: [
				{ target: 'Team Notes', alias: '', slice: '[[Team Notes]]' },
				{ target: 'Q3 Plan', alias: 'the plan', slice: '[[Q3 Plan|the plan]]' },
			],
			leavesBindAndSlotsAlone: [],
		});
	});

	test('a target resolves case- and extension-insensitively, and unresolved is a real answer', () => {
		assert.deepStrictEqual({
			exact: resolveWikilinkTarget('Team Notes', DOCS),
			differentCase: resolveWikilinkTarget('team notes', DOCS),
			withExtension: resolveWikilinkTarget('Team Notes.md', DOCS),
			looseWhitespace: resolveWikilinkTarget('  Team   Notes ', DOCS),
			// Creating [[Q1/Q2 Review]] writes `Q1 Q2 Review.md` (the service strips path-hostile
			// characters), so the link that created the document has to resolve to it afterwards.
			pathHostileName: resolveWikilinkTarget('Q1/Q2 Review', ['Q1 Q2 Review']),
			missing: resolveWikilinkTarget('Nonexistent Doc', DOCS),
			empty: resolveWikilinkTarget('   ', DOCS),
			normalised: normalizeWikilinkName(' Team Notes.MD '),
		}, {
			exact: 'Team Notes',
			differentCase: 'Team Notes',
			withExtension: 'Team Notes',
			looseWhitespace: 'Team Notes',
			pathHostileName: 'Q1 Q2 Review',
			missing: undefined,
			empty: undefined,
			normalised: 'team notes',
		});
	});

	test('exports read cleanly - a wikilink becomes the words a reader sees, never chip markup', () => {
		// Code is the exception, and it is not cosmetic: stripping the brackets out of a code sample would
		// silently rewrite somebody's code in the exported file.
		const body = '# Q3\n\nSee [[Team Notes]] and [[Q3 Plan|the plan]], plus [[Nonexistent Doc]].\n\n'
			+ 'A bound figure [49,800](bind:metrics.mrr) and a slot {{customer}} are untouched.\n\n'
			+ '```\nconst wiki = "[[Team Notes]]";\n```\n\nInline `[[Team Notes]]` stays code.';
		assert.deepStrictEqual(wikilinksToPlainText(body),
			'# Q3\n\nSee Team Notes and the plan, plus Nonexistent Doc.\n\n'
			+ 'A bound figure [49,800](bind:metrics.mrr) and a slot {{customer}} are untouched.\n\n'
			+ '```\nconst wiki = "[[Team Notes]]";\n```\n\nInline `[[Team Notes]]` stays code.');
	});

	test('the picker offers documents, not sources, templates or export artefacts', () => {
		assert.deepStrictEqual(documentNamesFromFiles([
			'Team Notes.md', 'metrics.csv', 'crm.json', 'Overview.md',
			'Quarterly.template.md', 'Overview.export.md', 'notes/Nested Doc.md', 'Team Notes.md',
		]), ['Nested Doc', 'Overview', 'Team Notes']);
	});

	// These run inside the editor webview, interpolated into the RUNTIME with String(fn), so their
	// serialised source must carry no imports, no require and no transpiler helper the injected text
	// would dangle on (the same contract common/livingDocTableEdit.ts holds).
	test('injected helpers are self-contained (no import/require/helper refs in String(fn))', () => {
		for (const fn of [activeWikilink, rankWikilinkTargets, serializeWikilink, resolveWikilinkTarget, normalizeWikilinkName]) {
			const src = String(fn);
			assert.ok(!/\brequire\b/.test(src), `${fn.name} must not reference require`);
			assert.ok(!/\bimport\b/.test(src), `${fn.name} must not reference import`);
			assert.ok(!/__[a-zA-Z]/.test(src), `${fn.name} must not reference a transpiler helper (__x)`);
		}
	});
});
