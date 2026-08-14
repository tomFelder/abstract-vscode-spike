/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { filterMentions, MENTION_PICKER_LIMIT } from '../../browser/reviewRailView.js';
import { activeWikilink, documentNamesFromFiles, matchTypedWikilink, normalizeWikilinkName, parseWikilinks, rankWikilinkTargets, resolveWikilinkTarget, serializeWikilink, splitWikilinkQuery, WIKILINK_PICKER_LIMIT, wikilinksToPlainText } from '../../common/wikilinks.js';

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

	test('the two pickers cannot drift apart - same answer, same cap, across list lengths', () => {
		// `rankWikilinkTargets` is a verbatim lift of the rail's `filterMentions` (#178), and while
		// `reviewRailView.ts` is owned by another lane the two copies coexist, guarded only by this test.
		// The previous version compared four names at the default limit, which can never catch the MOST
		// likely drift: the CAP. So sweep it - list lengths either side of the limit, and explicit limits at
		// 0, 1, cap-1, cap, cap+1 and past the end - and pin that the two DEFAULTS are the same number,
		// which is the one divergence a same-limit comparison is blind to by construction.
		const pool = Array.from({ length: 30 }, (_, i) => `${i % 3 === 0 ? 'Over' : 'Handover'} doc ${'x'.repeat(i % 7)} ${i}`);
		const divergences: string[] = [];
		for (const size of [0, 1, 7, 8, 9, 30]) {
			const names = pool.slice(0, size);
			for (const q of ['over', '', 'doc', 'zzz', 'x', 'HANDOVER', ' ']) {
				for (const limit of [0, 1, WIKILINK_PICKER_LIMIT - 1, WIKILINK_PICKER_LIMIT, WIKILINK_PICKER_LIMIT + 1, 999]) {
					const mine = JSON.stringify(rankWikilinkTargets(names, q, limit));
					const rail = JSON.stringify(filterMentions(names, q, limit));
					if (mine !== rail) { divergences.push(`size=${size} q=${JSON.stringify(q)} limit=${limit}: ${mine} !== ${rail}`); }
				}
				// The limit each picker applies when the caller does not pass one - the real-world path.
				const mineDefault = JSON.stringify(rankWikilinkTargets(names, q));
				const railDefault = JSON.stringify(filterMentions(names, q));
				if (mineDefault !== railDefault) { divergences.push(`size=${size} q=${JSON.stringify(q)} default: ${mineDefault} !== ${railDefault}`); }
			}
		}
		assert.deepStrictEqual({ divergences, sameDefaultCap: WIKILINK_PICKER_LIMIT === MENTION_PICKER_LIMIT }, { divergences: [], sameDefaultCap: true });
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

	test('a hand-typed link is caught the moment ]] lands - and only where the parser would call it one', () => {
		// The defect this fixes: a TYPED wikilink was plain text, and prosemirror-markdown escapes `[` and `]`,
		// so it reached disk as `\\[\\[Doc Name\\]\\]` and was corrupt from the first save. Every expectation
		// below was cross-checked against the REAL vendored bundle's parser, because the invariant is that
		// typing a link and reloading the file agree about what a link is - not that this regex is pretty.
		const hit = (text: string) => { const m = matchTypedWikilink(text); return m ? `${m.target}|${m.alias}|${m.length}` : undefined; };
		assert.deepStrictEqual({
			plain: hit('See [[Team Notes]]'),
			// The case that motivates the whole fix: the picker cannot author an alias, so hand-typing is the
			// ONLY route to the alias form - and it was the route that corrupted the file.
			aliased: hit('See [[Q3 Plan|the plan]]'),
			// The parser splits on the FIRST bar and keeps later ones in the alias; so does this.
			twoBars: hit('See [[a|b|c]]'),
			// `arr[[0]]` IS a link to "0" when the file is reloaded, so it must be one when typed too.
			midWord: hit('arr[[0]]'),
			// `[[[Foo]]` parses as a literal `[` followed by a link, and the run starts at the LAST `[[`.
			tripleBracket: hit('Triple [[[Foo]]'),
			justOpened: hit('See [['),
			oneBracketOnly: hit('See [[Team Notes]'),
			emptyTarget: hit('See [[]]'),
			whitespaceTarget: hit('See [[   ]]'),
			bracketInside: hit('See [[a[b]]'),
			newlineInside: hit('See [[a\nb]]'),
			// An inline LEAF (a bound figure, or an existing chip) contributes U+FFFC; a link may not straddle one.
			leafInside: hit('See [[a\ufffcb]]'),
			// `\\[[x]]` is the user saying "literally", and markdown-it's escape rule agrees.
			escapedOpen: hit('Half \\[[Foo]]'),
			escapedBackslashIsNotAnEscape: hit('Half \\\\[[Foo]]'),
			notFinishedYet: hit('See [[Team Notes'),
			empty: hit(''),
		}, {
			plain: 'Team Notes||14',
			aliased: 'Q3 Plan|the plan|20',
			twoBars: 'a|b|c|9',
			midWord: '0||5',
			tripleBracket: 'Foo||7',
			justOpened: undefined,
			oneBracketOnly: undefined,
			emptyTarget: undefined,
			whitespaceTarget: undefined,
			bracketInside: undefined,
			newlineInside: undefined,
			leafInside: undefined,
			escapedOpen: undefined,
			escapedBackslashIsNotAnEscape: 'Foo||7',
			notFinishedYet: undefined,
			empty: undefined,
		});
	});

	test('the picker query splits at the first bar, so an alias can be authored rather than searched for', () => {
		// Without the split, `[[Q3 Plan|the plan` is matched WHOLE against the document list, finds nothing,
		// and the picker offers to create a document literally named `Q3 Plan|the plan` - a name no
		// filesystem accepts. The split is the same one the parser makes, so the two cannot disagree.
		assert.deepStrictEqual({
			noAlias: splitWikilinkQuery('Q3 Pl'),
			withAlias: splitWikilinkQuery('Q3 Plan|the plan'),
			barJustTyped: splitWikilinkQuery('Q3 Plan|'),
			laterBarsStayInTheAlias: splitWikilinkQuery('a|b|c'),
			trimmed: splitWikilinkQuery('  Q3 Plan | the plan  '),
			empty: splitWikilinkQuery(''),
			// The target half is what the ranking sees, and it still ranks the way the @ picker does.
			ranksOnTheTargetHalf: rankWikilinkTargets(['Overview', 'Handover notes'], splitWikilinkQuery('over|the summary').target),
		}, {
			noAlias: { target: 'Q3 Pl', alias: '', hasAlias: false },
			withAlias: { target: 'Q3 Plan', alias: 'the plan', hasAlias: true },
			barJustTyped: { target: 'Q3 Plan', alias: '', hasAlias: true },
			laterBarsStayInTheAlias: { target: 'a', alias: 'b|c', hasAlias: true },
			trimmed: { target: 'Q3 Plan', alias: 'the plan', hasAlias: true },
			empty: { target: '', alias: '', hasAlias: false },
			ranksOnTheTargetHalf: ['Overview', 'Handover notes'],
		});
	});

	// These run inside the editor webview, interpolated into the RUNTIME with String(fn), so their
	// serialised source must carry no imports, no require and no transpiler helper the injected text
	// would dangle on (the same contract common/livingDocTableEdit.ts holds).
	test('injected helpers are self-contained (no import/require/helper refs in String(fn))', () => {
		for (const fn of [activeWikilink, matchTypedWikilink, rankWikilinkTargets, serializeWikilink, resolveWikilinkTarget, normalizeWikilinkName, splitWikilinkQuery]) {
			const src = String(fn);
			assert.ok(!/\brequire\b/.test(src), `${fn.name} must not reference require`);
			assert.ok(!/\bimport\b/.test(src), `${fn.name} must not reference import`);
			assert.ok(!/__[a-zA-Z]/.test(src), `${fn.name} must not reference a transpiler helper (__x)`);
		}
	});
});
