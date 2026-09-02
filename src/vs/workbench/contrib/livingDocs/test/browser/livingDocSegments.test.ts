/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { chunkDocBody } from '../../common/livingDocMarkdown.js';
import {
	DocSegment, expandSegments, ISegmentExpansion, ISegmentViolation, parseSegments, screenSegmentHunks,
	SegmentViolation, summariseSegmentReceipts
} from '../../common/livingDocSegments.js';

// The segment list and its host expansion (issue #381; doc 30 section 2.1, invariant I6).
//
// Everything here is pure: a body string in, an expansion out. No service, no DOM, no store, no clock. The
// suite is table-driven for the failure grammar - one row per way a list can be wrong - because the value of
// this module is precisely that EVERY wrong list has a name, and a table is the only shape in which "every"
// is legible. The fuzz round at the end is the invariant the whole design rests on: whatever a valid list
// says, every byte the list did not claim survives the expansion untouched.

suite('livingDocs segment expansion (issue #381, doc 30 2.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// One document exercising every block shape the alignment has to hold still for: two IDENTICAL headings
	// (the collision that makes content-derived ids unusable, doc 30 2.1), a fenced code block whose blank
	// lines are content, and a tight list that is one block with several items.
	const BASE = [
		'# Pricing',
		'',
		'We charge $10 per seat per month.',
		'',
		'## Notes',
		'',
		'Billing runs on the first.',
		'',
		'```js',
		'const rate = 10;',
		'',
		'export { rate };',
		'```',
		'',
		'## Notes',
		'',
		'- Seats are per person',
		'- Annual billing saves 10%',
		'',
		'Contact sales for volume.',
		''
	].join('\n');

	// B1 `# Pricing`, B2 the price line, B3 `## Notes`, B4 the billing line, B5 the fence, B6 `## Notes`
	// again, B7 the list, B8 the closing line.
	const BLOCKS = 8;

	test('the fixture chunks the way the labels claim, or every row below is about a different document', () => {
		assert.deepStrictEqual(chunkDocBody(BASE).map(chunk => chunk.text), [
			'# Pricing',
			'We charge $10 per seat per month.',
			'## Notes',
			'Billing runs on the first.',
			'```js\nconst rate = 10;\n\nexport { rate };\n```',
			'## Notes',
			'- Seats are per person\n- Annual billing saves 10%',
			'Contact sales for volume.',
		]);
	});

	function expanded(segments: readonly DocSegment[], base: string = BASE): ISegmentExpansion {
		const result = expandSegments(base, segments);
		assert.ok(result.ok, `expected an expansion, got ${(result as ISegmentViolation).violation}: ${(result as ISegmentViolation).message}`);
		return result;
	}

	function rejected(segments: readonly DocSegment[], base: string = BASE): ISegmentViolation {
		const result = expandSegments(base, segments);
		assert.ok(!result.ok, 'expected the list to be rejected');
		return result;
	}

	/** Every byte of the base outside the hunks, in order - the part an expansion must never touch. */
	function survivingBase(base: string, spans: readonly { start: number; end: number }[]): string {
		let out = '';
		let cursor = 0;
		for (const span of spans) {
			out += base.slice(cursor, span.start);
			cursor = span.end;
		}
		return out + base.slice(cursor);
	}

	/**
	 * The same bytes, read off the RESULT: walk the hunks in order, accumulating the length delta each one
	 * introduces, and cut out the region each hunk's new text occupies. Deliberately computed independently
	 * of the module rather than by asking it, so the assertion is a proof rather than a tautology.
	 */
	function survivingResult(expansion: ISegmentExpansion): string {
		let out = '';
		let cursor = 0;
		let delta = 0;
		for (const hunk of expansion.hunks) {
			const start = hunk.span.start + delta;
			out += expansion.body.slice(cursor, start);
			cursor = start + hunk.newText.length;
			delta += hunk.newText.length - (hunk.span.end - hunk.span.start);
		}
		return out + expansion.body.slice(cursor);
	}

	// --- what a valid list does -------------------------------------------------------------------------

	test('a list of nothing but keeps reproduces the document byte for byte', () => {
		const result = expanded([{ keep: 'B1-B8' }]);
		assert.strictEqual(result.body, BASE);
		assert.strictEqual(result.hunks.length, 0);
		assert.strictEqual(result.keptBlocks, BLOCKS);
	});

	test('a heading rename works - the instruction that used to evaporate - when the heading is unique', () => {
		// B1 `# Pricing` is the one heading in the fixture with no twin, so an echo can prove which block it is.
		const result = expanded([
			{ replace: 'B1', echo: ['# Pricing'], content: '# Prices' },
			{ keep: 'B2-B8' },
		]);
		assert.strictEqual(result.body, BASE.replace('# Pricing', '# Prices'));
		assert.strictEqual(result.hunks.length, 1);
		assert.strictEqual(result.hunks[0].op, 'replace');
		assert.strictEqual(result.hunks[0].blockOrdinal, 0);
		assert.strictEqual(result.hunks[0].oldText, '# Pricing');
		assert.strictEqual(result.keptBlocks, 7);
	});

	test('duplicate headings cannot be told apart by an echo, so the list is rejected rather than guessed', () => {
		// B3 and B6 are both `## Notes`; no echo can distinguish byte-identical blocks, so a replace of either
		// is rejected loudly rather than silently applied to one of them (issue #381 cycle 2; the #300 family).
		const result = rejected([
			{ keep: 'B1-B5' },
			{ replace: 'B6', echo: ['## Notes'], content: '## Seats' },
			{ keep: 'B7-B8' },
		]);
		assert.strictEqual(result.violation, 'ambiguous-echo', result.message);
		assert.ok(result.message.includes('word for word the same'), result.message);
	});

	test('a fenced code block is one block, and replacing it leaves its neighbours untouched', () => {
		const result = expanded([
			{ keep: 'B1-B4' },
			{ replace: 'B5', echo: ['```js'], content: '```js\nconst rate = 12;\n```' },
			{ keep: 'B6-B8' },
		]);
		assert.ok(result.body.includes('```js\nconst rate = 12;\n```'));
		assert.ok(!result.body.includes('export { rate };'));
		assert.strictEqual(survivingResult(result), survivingBase(BASE, result.hunks.map(h => h.span)));
	});

	test('a tight list is one block, and rewriting it keeps every neighbouring byte', () => {
		const result = expanded([
			{ keep: 'B1-B6' },
			{ replace: 'B7', echo: ['Seats are per person'], content: '- Seats are per person\n- Annual billing saves 15%' },
			{ keep: 'B8' },
		]);
		assert.ok(result.body.includes('- Annual billing saves 15%'));
		assert.ok(result.body.endsWith('Contact sales for volume.\n'));
		assert.strictEqual(survivingResult(result), survivingBase(BASE, result.hunks.map(h => h.span)));
	});

	test('insertAfter adds a paragraph without disturbing the document\'s trailing newline', () => {
		const result = expanded([
			{ keep: 'B1-B8' },
			{ insertAfter: 'B8', content: 'Enterprise pricing is on request.' },
		]);
		assert.ok(result.body.endsWith('Contact sales for volume.\n\nEnterprise pricing is on request.\n'));
		assert.strictEqual(result.hunks[0].op, 'insert');
		assert.strictEqual(result.hunks[0].span.start, result.hunks[0].span.end);
		assert.strictEqual(result.hunks[0].blockOrdinal, 7);
	});

	test('an empty replace deletes the blocks AND the blank line they sat under', () => {
		const result = expanded([
			{ keep: 'B1-B3' },
			{ replace: 'B4', echo: ['Billing runs'], content: '' },
			{ keep: 'B5-B8' },
		]);
		assert.ok(!result.body.includes('Billing runs on the first.'));
		assert.ok(result.body.includes('## Notes\n\n```js'), 'the deletion must not leave a doubled blank line behind');
		assert.strictEqual(result.hunks[0].op, 'delete');
		assert.strictEqual(result.hunks[0].blockOrdinal, 3);
	});

	test('deleting the first block does not leave the document starting with blank lines', () => {
		const result = expanded([
			{ replace: 'B1', echo: ['# Pricing'], content: '' },
			{ keep: 'B2-B8' },
		]);
		assert.ok(result.body.startsWith('We charge $10 per seat per month.'));
	});

	test('a CRLF document keeps its line endings, including the one the insertion introduces', () => {
		const crlf = BASE.replace(/\n/g, '\r\n');
		const result = expanded([{ keep: 'B1-B8' }, { insertAfter: 'B8', content: 'Enterprise pricing is on request.' }], crlf);
		assert.ok(result.body.includes('volume.\r\n\r\nEnterprise pricing is on request.'));
		assert.ok(!result.body.includes('volume.\n\nEnterprise'));
	});

	test('the blockViews the model was shown are what the echo is checked against', () => {
		// `read_document` resolves bind links, so the model reads "4.2M" where the raw body says
		// "[4.2M](bind:revenue)". Without the view the echo could never match and a legitimate change would
		// be rejected as an off-by-one.
		const body = '# Revenue\n\nWe closed at [4.2M](bind:revenue) this year.\n';
		const views = ['# Revenue', 'We closed at 4.2M this year.'];
		const segments: DocSegment[] = [
			{ keep: 'B1' },
			{ replace: 'B2', echo: ['We closed at 4.2M'], content: 'We closed at [4.2M](bind:revenue) this year, ahead of plan.' },
		];
		assert.ok(expandSegments(body, segments, { blockViews: views }).ok);
		assert.strictEqual((expandSegments(body, segments) as ISegmentViolation).violation, 'echo-mismatch');
	});

	// --- the failure grammar: one row per way a list can be wrong -----------------------------------------

	const REJECTIONS: readonly { readonly name: string; readonly segments: readonly DocSegment[]; readonly violation: SegmentViolation; readonly says: string }[] = [
		{
			name: 'an off-by-one range whose echo names the block next door',
			segments: [{ keep: 'B1-B3' }, { replace: 'B4', echo: ['## Notes'], content: 'Billing runs on the last day.' }, { keep: 'B5-B8' }],
			violation: 'echo-mismatch',
			says: 'B4 does not start with',
		},
		{
			name: 'an off-by-one RUN, where only the second block is wrong',
			segments: [{ keep: 'B1-B2' }, { replace: 'B3-B4', echo: ['## Notes', '```js'], content: 'nope' }, { keep: 'B5-B8' }],
			violation: 'echo-mismatch',
			says: 'B4 does not start with',
		},
		{
			name: 'a replace that echoed fewer blocks than it claims',
			segments: [{ keep: 'B1-B2' }, { replace: 'B3-B4', echo: ['## Notes'], content: 'nope' }, { keep: 'B5-B8' }],
			violation: 'echo-mismatch',
			says: 'covers 2 blocks but echoed 1',
		},
		{
			name: 'a replace with an empty echo',
			segments: [{ keep: 'B1-B2' }, { replace: 'B3', echo: ['  '], content: 'nope' }, { keep: 'B4-B8' }],
			violation: 'echo-mismatch',
			says: 'is empty',
		},
		{
			name: 'a list that forgets the tail of the document',
			segments: [{ keep: 'B1-B7' }],
			violation: 'uncovered-block',
			says: 'B8 is not accounted for',
		},
		{
			name: 'a list that forgets a block in the middle',
			segments: [{ keep: 'B1-B3' }, { keep: 'B5-B8' }],
			violation: 'uncovered-block',
			says: 'B4 is not accounted for',
		},
		{
			name: 'two segments claiming the same block',
			segments: [{ keep: 'B1-B5' }, { keep: 'B5-B8' }],
			violation: 'overlapping-range',
			says: 'already claimed',
		},
		{
			name: 'a label that names a block the document does not have',
			segments: [{ keep: 'B1-B8' }, { insertAfter: 'B12', content: 'nope' }],
			violation: 'stale-ordinal',
			says: 'it has 8 blocks',
		},
		{
			name: 'a range that names past the end of the document',
			segments: [{ keep: 'B1-B9' }],
			violation: 'stale-ordinal',
			says: 'B1 to B8',
		},
		{
			name: 'a range that ends before it starts',
			segments: [{ keep: 'B1-B4' }, { keep: 'B8-B5' }],
			violation: 'bad-range',
			says: 'ends before it starts',
		},
		{
			name: 'a label that is not a label at all',
			segments: [{ keep: 'the pricing section' }],
			violation: 'bad-label',
			says: 'is not a block label',
		},
		{
			name: 'an insertAfter with nothing to insert',
			segments: [{ keep: 'B1-B8' }, { insertAfter: 'B4', content: '   ' }],
			violation: 'empty-content',
			says: 'has nothing to insert',
		},
		{
			name: 'two insertions racing for the same position',
			segments: [{ keep: 'B1-B8' }, { insertAfter: 'B4', content: 'one' }, { insertAfter: 'B4', content: 'two' }],
			violation: 'overlapping-range',
			says: 'so does segment',
		},
		{
			name: 'an insertion into the middle of a range that is on its way out',
			segments: [{ keep: 'B1-B2' }, { replace: 'B3-B5', echo: ['## Notes', 'Billing runs', '```js'], content: 'new' }, { insertAfter: 'B4', content: 'orphan' }, { keep: 'B6-B8' }],
			violation: 'overlapping-range',
			says: 'in the middle of the range',
		},
		{
			name: 'an insertion positioned exactly where a deletion begins',
			segments: [{ keep: 'B1-B3' }, { insertAfter: 'B3', content: 'new' }, { replace: 'B4', echo: ['Billing runs'], content: '' }, { keep: 'B5-B8' }],
			violation: 'overlapping-range',
			says: 'not decidable',
		},
		{
			name: 'two neighbouring deletions that both reach for the same blank line',
			segments: [{ replace: 'B1', echo: ['# Pricing'], content: '' }, { replace: 'B2', echo: ['We charge'], content: '' }, { keep: 'B3-B8' }],
			violation: 'overlapping-range',
			says: 'not decidable',
		},
	];

	for (const row of REJECTIONS) {
		test(`rejected whole: ${row.name}`, () => {
			const result = rejected(row.segments);
			assert.strictEqual(result.violation, row.violation, result.message);
			assert.ok(result.message.includes(row.says), `expected the message to say "${row.says}", got: ${result.message}`);
		});
	}

	test('a rejected list changes nothing at all - there is no partial expansion to salvage', () => {
		const result = expandSegments(BASE, [{ keep: 'B1-B3' }, { replace: 'B4', echo: ['## Notes'], content: 'wrong' }, { keep: 'B5-B8' }]);
		assert.ok(!result.ok);
		assert.strictEqual((result as { body?: string }).body, undefined, 'a violation must not carry a body a caller could mistake for a result');
	});

	test('an empty document has no blocks to name, and says so rather than expanding nothing', () => {
		assert.strictEqual(rejected([{ keep: 'B1' }], '').violation, 'stale-ordinal');
	});

	// --- reading the list off the wire --------------------------------------------------------------------

	test('parseSegments reads the three shapes and rejects everything else by name', () => {
		const ok = parseSegments([{ keep: 'B1-B7' }, { replace: 'B8', echo: ['Contact'], content: 'new' }, { insertAfter: 'B8', content: 'more' }]);
		assert.ok(ok.ok);
		assert.deepStrictEqual(ok.segments, [{ keep: 'B1-B7' }, { replace: 'B8', echo: ['Contact'], content: 'new' }, { insertAfter: 'B8', content: 'more' }]);

		const rows: readonly { readonly input: unknown; readonly says: string }[] = [
			{ input: undefined, says: 'non-empty list' },
			{ input: [], says: 'non-empty list' },
			{ input: 'B1-B7', says: 'non-empty list' },
			{ input: ['B1-B7'], says: 'is not an object' },
			{ input: [{}], says: 'it carried none' },
			{ input: [{ keep: 'B1', replace: 'B2' }], says: 'keep and replace' },
			{ input: [{ keep: 4 }], says: 'must be a block label' },
			{ input: [{ replace: 'B1', echo: ['a'] }], says: 'needs a content string' },
			{ input: [{ replace: 'B1', content: 'x' }], says: 'needs echo' },
			{ input: [{ replace: 'B1', echo: 'a', content: 'x' }], says: 'needs echo' },
			{ input: [{ insertAfter: 'B1' }], says: 'needs a content string' },
		];
		for (const row of rows) {
			const result = parseSegments(row.input);
			assert.ok(!result.ok, `${JSON.stringify(row.input)} should not parse`);
			assert.ok(result.message.includes(row.says), `expected "${row.says}", got: ${result.message}`);
		}
	});

	// --- screening: the two refusals that are facts about the document, not mistakes in the list ----------

	test('a hunk that would dissolve a live figure into prose is dropped by name, not applied', () => {
		const body = '# Revenue\n\nWe closed at [4.2M](bind:revenue) this year.\n';
		const result = expanded([
			{ keep: 'B1' },
			{ replace: 'B2', echo: ['We closed at [4.2M](bind:revenue)'], content: 'We closed at 4.2 million this year.' },
		], body);
		assert.deepStrictEqual(screenSegmentHunks(result.hunks).map(entry => entry.drop), ['bind-guard']);
	});

	test('a hunk that keeps the bind markup is queued', () => {
		const body = '# Revenue\n\nWe closed at [4.2M](bind:revenue) this year.\n';
		const result = expanded([
			{ keep: 'B1' },
			{ replace: 'B2', echo: ['We closed at [4.2M](bind:revenue)'], content: 'We closed the year at [4.2M](bind:revenue), ahead of plan.' },
		], body);
		assert.deepStrictEqual(screenSegmentHunks(result.hunks).map(entry => entry.drop), [undefined]);
	});

	test('a replacement identical to what is already there is a no-op, not a card', () => {
		const result = expanded([
			{ keep: 'B1-B7' },
			{ replace: 'B8', echo: ['Contact sales'], content: 'Contact sales for volume.' },
		]);
		assert.deepStrictEqual(screenSegmentHunks(result.hunks).map(entry => entry.drop), ['no-op']);
	});

	test('DELETING a bound block is bind-guarded too - a live figure is not removed without a signal', () => {
		// An empty replacement carries none of the base's keys, so the delete hunk is dropped rather than
		// allowed to take the live figure out with it (doc 30 2.1, the deliberately conservative case).
		const body = '# Revenue\n\nWe closed at [4.2M](bind:revenue) this year.\n';
		const result = expanded([{ keep: 'B1' }, { replace: 'B2', echo: ['We closed at [4.2M](bind:revenue)'], content: '' }], body);
		assert.strictEqual(result.hunks[0].op, 'delete');
		assert.deepStrictEqual(screenSegmentHunks(result.hunks).map(entry => entry.drop), ['bind-guard']);
	});

	test('the receipt summary names EVERY drop reason in the vocabulary, including a queued change', () => {
		// One of each: the full doc 30 2.4 receipt vocabulary run through the summariser, so a reader can be
		// told exactly why any segment did not land - stale-ordinal included, even though the single-turn
		// expansion catches most staleness earlier as a whole-list rejection.
		const said = summariseSegmentReceipts([
			{ segmentIndex: 0, label: 'B1', changeId: 'c1' },
			{ segmentIndex: 1, label: 'B2', reason: 'policy' },
			{ segmentIndex: 2, label: 'B3', reason: 'out-of-scope' },
			{ segmentIndex: 3, label: 'B4', reason: 'bind-guard' },
			{ segmentIndex: 4, label: 'B5', reason: 'stale-ordinal' },
			{ segmentIndex: 5, label: 'B6', reason: 'no-op' },
		]);
		assert.ok(said.includes('1 change is waiting for your review'), said);
		assert.ok(said.includes('set never to change'), said);
		assert.ok(said.includes('not one of the ones you attached'), said);
		assert.ok(said.includes('live figure'), said);
		assert.ok(said.includes('moved on'), said);
		assert.ok(said.includes('changed nothing'), said);
	});

	// --- the echo must DISAMBIGUATE, not merely touch (issue #381 cycle 2, the #300/#303/#329 family) ------
	//
	// A startsWith on a few normalised words is satisfied by any sibling that opens the same way, so an echo
	// that "matches" is not proof the range is not off by one. Each row below is a list that the OLD prefix
	// check accepted and that landed on a block the model may not have meant; each must now be rejected whole,
	// with nothing expanded. The positive control proves a legitimate replace on a uniquely-identifiable block
	// still succeeds, so the guard has not been turned into a blanket refusal.

	test('shared-prefix paragraphs: an echo that fits two of them is rejected, not applied to the first', () => {
		const base = '# Doc\n\nWe charge $10 per seat.\n\nWe charge extra for support.\n';
		const result = expandSegments(base, [
			{ keep: 'B1' },
			// "We charge" opens B2 AND B3; the model may have meant either, so this must not silently hit B2.
			{ replace: 'B2', echo: ['We charge'], content: 'We charge $12 per seat.' },
			{ keep: 'B3' },
		]);
		assert.ok(!result.ok, 'a shared-prefix echo must be rejected');
		assert.strictEqual((result as ISegmentViolation).violation, 'ambiguous-echo');
		assert.strictEqual((result as { hunks?: unknown }).hunks, undefined, 'nothing may be expanded from an ambiguous list');
	});

	test('duplicate headings: no echo can distinguish byte-identical blocks, so the list is rejected loudly', () => {
		const base = '# Doc\n\n## Notes\n\nAlpha.\n\n## Notes\n\nBravo.\n';
		const result = expandSegments(base, [
			{ keep: 'B1' },
			{ replace: 'B2', echo: ['## Notes'], content: '## Overview' },
			{ keep: 'B3-B5' },
		]);
		assert.ok(!result.ok);
		assert.strictEqual((result as ISegmentViolation).violation, 'ambiguous-echo');
		assert.ok((result as ISegmentViolation).message.includes('word for word the same'), (result as ISegmentViolation).message);
	});

	test('a heading whose text opens the paragraph beneath it is ambiguous, and rejected', () => {
		const base = '# Doc\n\n## Summary\n\nSummary of the quarter follows.\n';
		const result = expandSegments(base, [
			{ keep: 'B1' },
			// "Summary" is B2's whole text AND the opening of B3, so it cannot say which block is meant.
			{ replace: 'B2', echo: ['Summary'], content: '## Overview' },
			{ keep: 'B3' },
		]);
		assert.ok(!result.ok);
		assert.strictEqual((result as ISegmentViolation).violation, 'ambiguous-echo');
	});

	test('the positive control: a replace on a block whose echo is unique still succeeds', () => {
		const base = '# Doc\n\nWe charge $10 per seat.\n\nWe charge extra for support.\n';
		// "We charge extra" opens only B3, so a short echo is enough - the guard does not over-reject.
		const result = expandSegments(base, [
			{ keep: 'B1-B2' },
			{ replace: 'B3', echo: ['We charge extra'], content: 'We charge extra for premium support.' },
		]);
		assert.ok(result.ok, `expected success, got ${(result as ISegmentViolation).violation}: ${(result as ISegmentViolation).message}`);
		assert.strictEqual((result as ISegmentExpansion).hunks[0].oldText, 'We charge extra for support.');
	});

	// --- the invariant, fuzzed --------------------------------------------------------------------------

	test('fuzz: whatever a valid list says, every byte it did not claim survives byte-for-byte', () => {
		// A deterministic generator, so a failure is reproducible from the seed printed in the message rather
		// than from a lucky re-run. Nothing in this module is allowed to be random, and neither is its test.
		let seed = 0x5eed1234;
		const next = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 0x100000000;
		};
		const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)];

		// Every block carries a UNIQUE, fixed-width, prefix-free tag, so no block's text is a prefix of another
		// and the full-text echoes below always identify exactly one block. The ambiguity cases (duplicate and
		// shared-prefix blocks) are pinned by their own rows above; the fuzz is about byte-exact expansion, so
		// it stays inside the grammar the discrimination guard admits.
		const tag = (n: number) => `b${String(n).padStart(5, '0')}`;
		const shapes: readonly ((n: number) => string)[] = [
			n => `Para ${tag(n)} carries a sentence and then some more of one.`,
			n => `${'#'.repeat(1 + (n % 3))} Section ${tag(n)}`,
			n => `- ${tag(n)} item one\n- ${tag(n)} item two\n- ${tag(n)} item three`,
			n => `\`\`\`ts\nconst ${tag(n)} = 1;\n\nexport { ${tag(n)} };\n\`\`\``,
			n => `| ${tag(n)} | ${tag(n)}z |\n| --- | --- |\n| x | y |`,
		];

		for (let round = 0; round < 400; round++) {
			const count = 2 + Math.floor(next() * 10);
			const blocks: string[] = [];
			for (let i = 0; i < count; i++) { blocks.push(pick(shapes)(i + round)); }
			const base = `${blocks.join('\n\n')}\n`;
			const chunks = chunkDocBody(base);
			// A generated shape that does not chunk one-to-one would be testing the chunker, not this module.
			if (chunks.length !== count) { continue; }

			// Cut the document into runs and give each run one fate. Two rules keep the generator inside the
			// grammar rather than inside the collision cases, which have their own rows above: never two
			// deletions in a row, and never an insertion immediately before one.
			const segments: DocSegment[] = [];
			const claimedSpans: { start: number; end: number }[] = [];
			let ordinal = 0;
			let previousWasDelete = false;
			const pendingInsertAfter: number[] = [];
			while (ordinal < count) {
				const width = 1 + Math.floor(next() * Math.min(3, count - ordinal));
				const from = ordinal;
				const to = ordinal + width - 1;
				const label = width === 1 ? `B${from + 1}` : `B${from + 1}-B${to + 1}`;
				const roll = next();
				const canDelete = !previousWasDelete && !pendingInsertAfter.includes(from - 1);
				if (roll < 0.5) {
					segments.push({ keep: label });
					previousWasDelete = false;
					if (next() < 0.2) { pendingInsertAfter.push(to); }
				} else if (roll < 0.85 || !canDelete) {
					const echo = [];
					for (let i = from; i <= to; i++) { echo.push(chunks[i].text); }
					segments.push({ replace: label, echo, content: `Rewritten ${from}-${to} for round ${round}.` });
					previousWasDelete = false;
				} else {
					const echo = [];
					for (let i = from; i <= to; i++) { echo.push(chunks[i].text); }
					segments.push({ replace: label, echo, content: '' });
					previousWasDelete = true;
				}
				ordinal = to + 1;
			}
			for (const after of pendingInsertAfter) {
				segments.push({ insertAfter: `B${after + 1}`, content: `Inserted after ${after} in round ${round}.` });
			}

			const result = expandSegments(base, segments);
			assert.ok(result.ok, `round ${round}: ${(result as ISegmentViolation).violation} - ${(result as ISegmentViolation).message}`);
			for (const hunk of result.hunks) { claimedSpans.push(hunk.span); }
			assert.strictEqual(
				survivingResult(result),
				survivingBase(base, claimedSpans),
				`round ${round}: bytes outside the claimed spans did not survive the expansion`
			);
			// And the claimed spans really are what they say they are, so "outside them" means something.
			for (const hunk of result.hunks) {
				assert.strictEqual(base.slice(hunk.span.start, hunk.span.end), hunk.oldText, `round ${round}: a hunk's oldText is not what is at its span`);
			}
			// Every KEPT block is still in the result, verbatim.
			for (let i = 0; i < count; i++) {
				const claimed = result.hunks.some(hunk => hunk.span.start <= chunks[i].start && hunk.span.end >= chunks[i].end);
				if (!claimed) { assert.ok(result.body.includes(chunks[i].text), `round ${round}: kept block B${i + 1} is not in the result`); }
			}
		}
	});
});
