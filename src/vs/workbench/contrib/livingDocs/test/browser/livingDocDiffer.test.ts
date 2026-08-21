/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { deriveChangeClass, spliceDoc } from '../../common/changeRecord.js';
import { diffDocBody, IDocDiffHunk } from '../../common/livingDocDiffer.js';
import { chunkDocBody, withReplacedBody } from '../../common/livingDocMarkdown.js';

// The local differ (docs/30 section 2.1). Two kinds of test live here and they are testing different things.
//
// The FIXTURES pin the alignment's judgement: which blocks it decides correspond to which, and therefore
// what a reviewer is shown. Those are the council-record probe cases - a fence that must not shred, two
// identical headings that must not cross-pair, a split, a merge, a rename - and they are the part a change
// to the thresholds is allowed to move (visibly, by updating a snapshot).
//
// The PROPERTY tests pin the contract, which nothing is allowed to move: `spliceDoc(base, hunks)` reproduces
// the proposed text byte-exactly, for every input, including CRLF, missing trailing newlines and multi-byte
// characters. The fuzz round exists because the fixtures can only ever cover the cases someone thought of.
//
// Unicode in this file is written as escapes so the source stays ASCII (the repo's precommit rule) while the
// strings under test are genuinely multi-byte.

// --- fixtures ---------------------------------------------------------------------------------------

const FENCE_BASE = [
	'# Title',
	'',
	'```js',
	'const a = 1;',
	'',
	'const b = 2;',
	'```',
	'',
	'Tail paragraph.',
	'',
].join('\n');

const DUPLICATE_HEADINGS_BASE = [
	'# Report',
	'',
	'## Notes',
	'',
	'First note.',
	'',
	'## Notes',
	'',
	'Second note.',
	'',
].join('\n');

const LIST_BASE = [
	'# List',
	'',
	'- alpha',
	'- beta',
	'- gamma',
	'',
	'Done.',
	'',
].join('\n');

const SPLIT_BASE = '# S\n\nOne paragraph. It has two sentences.\n\nA second paragraph, left alone.\n\nA third paragraph, also left alone.\n';
const SPLIT_PROPOSED = '# S\n\nOne paragraph.\n\nIt has two sentences.\n\nA second paragraph, left alone.\n\nA third paragraph, also left alone.\n';

const STABLE_BASE = '# H\n\nFirst paragraph stays.\n\nSecond paragraph stays too.\n\nThird paragraph stays as well.\n';

const REWRITE_BASE = [
	'# Quarterly update',
	'',
	'Revenue grew steadily through the quarter.',
	'',
	'Hiring stayed flat against the plan.',
	'',
	'Churn was unchanged from last quarter.',
	'',
].join('\n');

const REWRITE_PROPOSED = [
	'# Quarterly update',
	'',
	'Every number below has been restated against the new ledger.',
	'',
	'The team shrank by four people during a hiring freeze.',
	'',
	'Cancellations doubled after the pricing change landed.',
	'',
].join('\n');

interface IFixture {
	readonly name: string;
	readonly base: string;
	readonly proposed: string;
}

const FIXTURES: readonly IFixture[] = [
	{
		name: 'a fenced code block is one unit - an edit inside it does not shred into per-line blocks',
		base: FENCE_BASE,
		proposed: FENCE_BASE.replace('const b = 2;', 'const b = 3;'),
	},
	{
		name: 'two identical headings never cross-pair - the edit lands under the second one',
		base: DUPLICATE_HEADINGS_BASE,
		proposed: DUPLICATE_HEADINGS_BASE.replace('Second note.', 'Second note, revised.'),
	},
	{
		name: 'a tight list is one block - an item edit plus a mid-list insertion is one hunk',
		base: LIST_BASE,
		proposed: LIST_BASE.replace('- beta\n- gamma', '- beta two\n- new item\n- gamma'),
	},
	{
		name: 'a heading rename reads as a rename even when it shares no words with the old one',
		base: '# Doc\n\n## Risks\n\nSomething risky.\n',
		proposed: '# Doc\n\n## Open questions\n\nSomething risky.\n',
	},
	{
		name: 'a paragraph split is one hunk pairing one base block to two proposed blocks',
		base: SPLIT_BASE,
		proposed: SPLIT_PROPOSED,
	},
	{
		name: 'a paragraph merge is one hunk pairing two base blocks to one proposed block',
		base: SPLIT_PROPOSED,
		proposed: SPLIT_BASE,
	},
	{
		name: 'a new paragraph is a pure insert - empty oldText, zero-width span',
		base: STABLE_BASE,
		proposed: STABLE_BASE.replace('Third paragraph', 'An inserted paragraph.\n\nThird paragraph'),
	},
	{
		name: 'a removed paragraph is a pure delete - empty newText',
		base: STABLE_BASE,
		proposed: STABLE_BASE.replace('Second paragraph stays too.\n\n', ''),
	},
	{
		name: 'a whole-document rewrite flips the class',
		base: REWRITE_BASE,
		proposed: REWRITE_PROPOSED,
	},
];

/** A hunk rendered for a snapshot: how it was reached, what it does, which blocks it spans, and its texts. */
function renderHunk(hunk: IDocDiffHunk): string {
	const ordinals = `B[${hunk.blockOrdinals.base.join(' ')}]->P[${hunk.blockOrdinals.proposed.join(' ')}]`;
	return `${hunk.pairing}/${hunk.op} ${ordinals} ${JSON.stringify(hunk.oldText)} => ${JSON.stringify(hunk.newText)}`;
}

/** The word-grain runs of a hunk, rendered as `+added` / `-removed` (equal runs elided). */
function renderSegments(hunk: IDocDiffHunk): string {
	return hunk.segments.filter(s => s.t !== 'eq').map(s => `${s.t === 'ins' ? '+' : '-'}${s.text}`).join(' ');
}

suite('livingDocs livingDocDiffer (docs/30 section 2.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the alignment fixtures - what each shape of edit compiles into', () => {
		const actual: Record<string, unknown> = {};
		for (const fixture of FIXTURES) {
			const diff = diffDocBody(fixture.base, fixture.proposed);
			const spliced = spliceDoc(fixture.base, diff.hunks);
			actual[fixture.name] = {
				blocks: `${diff.stats.baseBlocks} -> ${diff.stats.proposedBlocks}`,
				hunks: diff.hunks.map(renderHunk),
				changeClass: diff.changeClass,
				splicesExactly: spliced.ok && spliced.text === fixture.proposed,
			};
		}
		assert.deepStrictEqual(actual, {
			'a fenced code block is one unit - an edit inside it does not shred into per-line blocks': {
				blocks: '3 -> 3',
				hunks: ['modified/replace B[1]->P[1] "const b = 2;\\n" => "const b = 3;\\n"'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'two identical headings never cross-pair - the edit lands under the second one': {
				blocks: '5 -> 5',
				hunks: ['modified/replace B[4]->P[4] "Second note." => "Second note, revised."'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a tight list is one block - an item edit plus a mid-list insertion is one hunk': {
				blocks: '3 -> 3',
				hunks: ['modified/replace B[1]->P[1] "- beta\\n" => "- beta two\\n- new item\\n"'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a heading rename reads as a rename even when it shares no words with the old one': {
				blocks: '3 -> 3',
				hunks: ['modified/replace B[1]->P[1] "## Risks" => "## Open questions"'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a paragraph split is one hunk pairing one base block to two proposed blocks': {
				blocks: '4 -> 5',
				hunks: ['split/replace B[1]->P[1 2] "One paragraph. It has two sentences." => "One paragraph.\\n\\nIt has two sentences."'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a paragraph merge is one hunk pairing two base blocks to one proposed block': {
				blocks: '5 -> 4',
				hunks: ['merge/replace B[1 2]->P[1] "One paragraph.\\n\\nIt has two sentences." => "One paragraph. It has two sentences."'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a new paragraph is a pure insert - empty oldText, zero-width span': {
				blocks: '4 -> 5',
				hunks: ['insert/insert B[]->P[3] "" => "An inserted paragraph.\\n\\n"'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a removed paragraph is a pure delete - empty newText': {
				blocks: '4 -> 3',
				hunks: ['delete/delete B[2]->P[] "Second paragraph stays too.\\n\\n" => ""'],
				changeClass: 'targeted',
				splicesExactly: true,
			},
			'a whole-document rewrite flips the class': {
				blocks: '4 -> 4',
				hunks: [
					'substitute/replace B[1 2 3]->P[1 2 3] "Revenue grew steadily through the quarter.\\n\\nHiring stayed flat against the plan.\\n\\nChurn was unchanged from last quarter.\\n" => "Every number below has been restated against the new ledger.\\n\\nThe team shrank by four people during a hiring freeze.\\n\\nCancellations doubled after the pricing change landed.\\n"',
				],
				changeClass: 'rewrite',
				splicesExactly: true,
			},
		});
	});

	test('word-grain segments come from the shipped word diff, so the widget and the record cannot disagree', () => {
		const diff = diffDocBody(LIST_BASE, LIST_BASE.replace('- beta\n- gamma', '- beta two\n- new item\n- gamma'));
		assert.deepStrictEqual(diff.hunks.map(renderSegments), ['+two - new item']);
	});

	test('frontmatter is not the differ\'s to see - it diffs body text and the caller re-attaches the block', () => {
		// The seam that quarantines the serialiser data-loss bug: `fromTemplate` is a field the parser reads
		// and the serialiser drops, so the approve path must never route a document through a component that
		// could re-emit it. The differ is handed a body and returns body-relative spans; the frontmatter is
		// carried across verbatim by `withReplacedBody` without either side needing to know about the other.
		const full = '---\ntitle: Weekly\nfromTemplate: Weekly report\n---\n# Weekly\n\nOne.\n';
		const baseBody = '# Weekly\n\nOne.\n';
		const diff = diffDocBody(baseBody, '# Weekly\n\nOne, revised.\n');
		const spliced = spliceDoc(baseBody, diff.hunks);
		assert.deepStrictEqual(
			{
				touchesFrontmatter: diff.hunks.some(h => h.oldText.includes('fromTemplate') || h.newText.includes('fromTemplate')),
				result: spliced.ok ? withReplacedBody(full, spliced.text) : 'splice failed',
			},
			{
				touchesFrontmatter: false,
				result: '---\ntitle: Weekly\nfromTemplate: Weekly report\n---\n\n# Weekly\n\nOne, revised.\n',
			},
		);
	});

	test('the class is derived at a changed-character ratio of 0.6, and the differ reports the same ratio it decided on', () => {
		// Ten one-line paragraphs of 30 characters each. Changing six of them lands the ratio one thousandth
		// UNDER the bar and seven puts it over - the boundary the review unit switches at, straddled as
		// tightly as the fixture can express it.
		const paragraph = (n: number) => `${String(n)}${'x'.repeat(29)}`;
		const build = (changed: number) => Array.from({ length: 10 }, (_, i) => i < changed ? `${String(i)}${'y'.repeat(29)}` : paragraph(i)).join('\n\n') + '\n';
		const base = build(0);
		const at = (changed: number) => {
			const diff = diffDocBody(base, build(changed));
			return { ratio: Number(diff.stats.changedRatio.toFixed(3)), changeClass: diff.changeClass };
		};
		assert.deepStrictEqual(
			{
				fiveChanged: at(5),
				sixChanged: at(6),
				sevenChanged: at(7),
				derivationAt59: deriveChangeClass([{ span: { start: 0, end: 59 }, oldText: '', newText: '' }], 100),
				derivationAt60: deriveChangeClass([{ span: { start: 0, end: 60 }, oldText: '', newText: '' }], 100),
				derivationAt61: deriveChangeClass([{ span: { start: 0, end: 61 }, oldText: '', newText: '' }], 100),
			},
			{
				fiveChanged: { ratio: 0.498, changeClass: 'targeted' },
				sixChanged: { ratio: 0.599, changeClass: 'targeted' },
				sevenChanged: { ratio: 0.699, changeClass: 'rewrite' },
				derivationAt59: 'targeted',
				derivationAt60: 'rewrite',
				derivationAt61: 'rewrite',
			},
		);
	});

	test('the same inputs always produce the same alignment - no clock, no randomness, no iteration-order luck', () => {
		const first = diffDocBody(DUPLICATE_HEADINGS_BASE, REWRITE_PROPOSED);
		const second = diffDocBody(DUPLICATE_HEADINGS_BASE, REWRITE_PROPOSED);
		assert.deepStrictEqual(first, second);
	});

	// --- the splice property ---------------------------------------------------------------------------

	const CORPUS: readonly string[] = [
		FENCE_BASE,
		DUPLICATE_HEADINGS_BASE,
		LIST_BASE,
		REWRITE_BASE,
		// CRLF throughout, and no trailing newline at all.
		'# Windows\r\n\r\n- one\r\n- two\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\nLast line with no newline after it.',
		// Multi-byte and combining characters: an emoji (surrogate pair), a precomposed accent, and an "e"
		// followed by a combining acute, which must survive as two code units either side of every splice.
		'# R\u00e9sum\u00e9 \uD83D\uDE80\n\nCaf\u00e9 vs cafe\u0301 - the same word, two encodings.\n\n\uD83D\uDC4D \uD83C\uDDE6\uD83C\uDDFA \u5b57\n',
		// Blank-line-only and whitespace-only bodies, the degenerate ends of the chunker.
		'\n\n\n',
		'',
	];

	/** A reproducible PRNG. Seeded so a failing fuzz case can be re-run exactly as it failed. */
	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6D2B79F5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const WORDS = ['alpha', 'beta', 'gamma', 'delta', '\u00e9psilon', '\uD83D\uDE80', 'cafe\u0301', 'and', 'the'];

	/** One random block-level mutation of `body`, using the body's own line ending so CRLF documents stay CRLF. */
	function mutate(body: string, random: () => number): string {
		const separator = body.includes('\r\n') ? '\r\n\r\n' : '\n\n';
		const blocks = chunkDocBody(body);
		const word = () => WORDS[Math.floor(random() * WORDS.length)];
		if (blocks.length === 0) { return body + separator + word() + ' ' + word(); }
		const pick = Math.floor(random() * blocks.length);
		const block = blocks[pick];
		const before = body.slice(0, block.start);
		const after = body.slice(block.end);
		switch (Math.floor(random() * 7)) {
			case 0: // rewrite the block
				return before + word() + ' ' + word() + ' ' + word() + after;
			case 1: // edit one word of it
				return before + block.text.replace(/\S+/, word()) + after;
			case 2: // drop the block, and the separator that followed it
				return body.slice(0, block.start) + body.slice(block.end).replace(/^(\r?\n){0,2}/, '');
			case 3: // insert a block after it
				return before + block.text + separator + word() + ' ' + word() + after;
			case 4: // split it in two
				return before + block.text.replace(' ', separator) + after;
			case 5: // merge it with what follows
				return before + block.text + ' ' + body.slice(block.end).replace(/^(\r?\n){0,2}/, '');
			default: // move the trailing newline around
				return body.endsWith('\n') ? body.slice(0, -1) : body + '\n';
		}
	}

	/** Every property that must hold of a diff, for any pair of bodies at all. */
	function checkDiff(base: string, proposed: string): string[] {
		const diff = diffDocBody(base, proposed);
		const failures: string[] = [];
		const spliced = spliceDoc(base, diff.hunks);
		if (!spliced.ok) {
			failures.push(`splice refused: ${spliced.reason}`);
		} else if (spliced.text !== proposed) {
			failures.push('splice did not reproduce the proposed text');
		}
		if (diff.stats.wholeBodyFallback) { failures.push('degraded to a whole-body rewrite'); }
		// Strictly increasing STARTS, not merely non-overlapping spans. `spliceDoc` applies hunks in descending
		// start order, which is only well defined when no two share a start - a zero-width insertion sitting
		// exactly where the next changed block begins is the case that breaks it.
		let previousStart = -1;
		let previousEnd = 0;
		for (const hunk of diff.hunks) {
			if (hunk.span.start <= previousStart || hunk.span.start < previousEnd) { failures.push('hunks overlap, collide or are out of order'); }
			if (base.slice(hunk.span.start, hunk.span.end) !== hunk.oldText) { failures.push('a hunk misquotes its own base text'); }
			previousStart = hunk.span.start;
			previousEnd = hunk.span.end;
		}
		// Any SUBSET must splice too - that is what makes approving three of seven hunks arithmetic rather
		// than a re-diff. Verified on the even-indexed subset, which is the interesting interleaved case.
		const subset: IDocDiffHunk[] = diff.hunks.filter((_, i) => i % 2 === 0);
		if (!spliceDoc(base, subset).ok) { failures.push('a subset of the hunks would not splice'); }
		return failures;
	}

	test('splice(base, hunks) reproduces the proposed body byte-exactly for every pair in the corpus', () => {
		const failures: string[] = [];
		for (const base of CORPUS) {
			for (const proposed of CORPUS) {
				for (const failure of checkDiff(base, proposed)) {
					failures.push(`${JSON.stringify(base.slice(0, 24))} -> ${JSON.stringify(proposed.slice(0, 24))}: ${failure}`);
				}
			}
		}
		assert.deepStrictEqual(failures, []);
	});

	test('splice(base, hunks) survives a seeded fuzz round of block-level mutations', () => {
		const failures: string[] = [];
		let cases = 0;
		for (let seed = 1; seed <= 40; seed++) {
			const random = mulberry32(seed);
			for (const base of CORPUS) {
				let proposed = base;
				for (let step = 0; step < 4; step++) {
					proposed = mutate(proposed, random);
					cases++;
					for (const failure of checkDiff(base, proposed)) {
						failures.push(`seed ${String(seed)} step ${String(step)} on ${JSON.stringify(base.slice(0, 24))}: ${failure}`);
					}
				}
			}
		}
		assert.deepStrictEqual({ failures, ranAtLeast: cases >= 1000 }, { failures: [], ranAtLeast: true });
	});
});
