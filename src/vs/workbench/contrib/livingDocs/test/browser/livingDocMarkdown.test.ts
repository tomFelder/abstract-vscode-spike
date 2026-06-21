/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { extractBindLinks, parseLivingDoc, reconcileBindLinks, serializeLivingDoc } from '../../common/livingDocMarkdown.js';

// A clean-file Living Document: pure Markdown + frontmatter dependency lists + inline bind links.
const WEEKLY_MD = [
	'---',
	'title: Weekly Operating Summary',
	'subtitle: Week 24',
	'sources:',
	'  - metrics.csv',
	'context:',
	'  - market-research.md',
	'---',
	'',
	'## Highlights',
	'',
	'Revenue grew [18%](bind:metrics.mrr.delta) week-on-week to [$48.6k](bind:metrics.mrr) MRR, on [427](bind:metrics.signups) new signups.',
	'',
	'## Commentary',
	'',
	'Growth accelerated sharply this week.',
].join('\n') + '\n';

const PLAIN_MD = [
	'# Project Readme',
	'',
	'Some **bold** intro prose with a [link](https://example.com).',
	'',
	'- first item',
	'- second item',
].join('\n') + '\n';

suite('LivingDoc bind-link format', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses frontmatter dependency lists and inline bind links', () => {
		const doc = parseLivingDoc(WEEKLY_MD);
		assert.deepStrictEqual(
			{
				title: doc.title,
				subtitle: doc.subtitle,
				sources: doc.sources,
				context: doc.context,
				isLiving: doc.isLiving,
				headings: doc.blocks.filter(b => b.type === 'heading').map(b => b.text),
				binds: doc.blocks.flatMap(b => b.binds),
			},
			{
				title: 'Weekly Operating Summary',
				subtitle: 'Week 24',
				sources: ['metrics.csv'],
				context: ['market-research.md'],
				isLiving: true,
				headings: ['Highlights', 'Commentary'],
				binds: [
					{ value: '18%', key: 'metrics.mrr.delta' },
					{ value: '$48.6k', key: 'metrics.mrr' },
					{ value: '427', key: 'metrics.signups' },
				],
			},
		);
	});

	test('a clean .md with bind links round-trips through parse -> serialize unchanged', () => {
		assert.strictEqual(serializeLivingDoc(parseLivingDoc(WEEKLY_MD)), WEEKLY_MD);
	});

	test('reconcileBindLinks rewrites visible cache to the resolved value (lock wins), keeping the key', () => {
		const line = 'MRR is [$41.2k](bind:metrics.mrr) today.';
		const resolved = new Map([['metrics.mrr', '$48.6k']]);
		assert.strictEqual(reconcileBindLinks(line, resolved), 'MRR is [$48.6k](bind:metrics.mrr) today.');
	});

	test('extractBindLinks ignores ordinary Markdown links', () => {
		assert.deepStrictEqual(extractBindLinks('see [the docs](https://example.com) and [427](bind:metrics.signups)'), [
			{ value: '427', key: 'metrics.signups' },
		]);
	});

	// The migrated KPI table (spec 4): a clean Markdown table whose cells are bind links.
	const MIGRATED_TABLE_MD = [
		'---',
		'title: Board Note',
		'sources:',
		'  - metrics.csv',
		'---',
		'',
		'## Numbers',
		'',
		'| Metric | Previous | Current | Change |',
		'| --- | --- | --- | --- |',
		'| MRR | [$41.2k](bind:metrics.mrr.prev) | [$48.6k](bind:metrics.mrr) | [+18%](bind:metrics.mrr.delta) |',
		'| New signups | [312](bind:metrics.signups.prev) | [427](bind:metrics.signups) | [+37%](bind:metrics.signups.delta) |',
	].join('\n') + '\n';

	// The OLD format we replaced: bindings smuggled into HTML comments, a `{cell}`-free figure.
	const OLD_LIVING_MD = [
		'---',
		'livingDoc: true',
		'title: Weekly',
		'source: metrics.csv',
		'syncedWeek: 23',
		'---',
		'',
		'## Highlights',
		'',
		'<!-- bind id=p-highlights kind=figure cells=mrr -->',
		'Revenue grew 12% to $41.2k MRR.',
	].join('\n') + '\n';

	test('migrated sample: a clean table of bind links parses, exposes its keys, and round-trips', () => {
		const doc = parseLivingDoc(MIGRATED_TABLE_MD);
		const table = doc.blocks.find(b => b.type === 'table')!;
		assert.deepStrictEqual(
			{ keys: table.binds.map(b => b.key), roundTrips: serializeLivingDoc(doc) === MIGRATED_TABLE_MD },
			{ keys: ['metrics.mrr.prev', 'metrics.mrr', 'metrics.mrr.delta', 'metrics.signups.prev', 'metrics.signups', 'metrics.signups.delta'], roundTrips: true },
		);
	});

	test('the old HTML-comment binding scheme is no longer a Living Document signal', () => {
		const doc = parseLivingDoc(OLD_LIVING_MD);
		// No frontmatter sources/context and no inline bind links -> the old comment scheme is inert.
		assert.deepStrictEqual({ isLiving: doc.isLiving, binds: doc.blocks.flatMap(b => b.binds).length }, { isLiving: false, binds: 0 });
	});

	test('plain Markdown is not a Living Document and takes its title from the first H1', () => {
		const doc = parseLivingDoc(PLAIN_MD);
		assert.strictEqual(doc.isLiving, false);
		assert.strictEqual(doc.title, 'Project Readme');
		assert.ok(doc.body.includes('- first item'), 'body retains the raw Markdown for generic rendering');
	});
});
