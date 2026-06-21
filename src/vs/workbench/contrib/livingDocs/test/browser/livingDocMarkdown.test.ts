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

	test('plain Markdown is not a Living Document and takes its title from the first H1', () => {
		const doc = parseLivingDoc(PLAIN_MD);
		assert.strictEqual(doc.isLiving, false);
		assert.strictEqual(doc.title, 'Project Readme');
		assert.ok(doc.body.includes('- first item'), 'body retains the raw Markdown for generic rendering');
	});
});
