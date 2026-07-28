/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { freshnessLabel, relativeSyncedShort, sourceFreshness, SourceFreshness, unreachableSourceLabel } from '../../common/sourceFreshness.js';

// The ONE freshness vocabulary (#122 F12, plan 49-a): pure classification + labels under an injectable clock,
// so every surface (Knowledge table, drawer, tree meta, hover-peek, Context tab) speaks the same words and the
// relative times are deterministic (no `Date.now()` in the render path).
suite('sourceFreshness (F12 vocabulary)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const NOW = Date.parse('2026-07-10T00:00:00Z');

	test('classification: stale wins, then context-only, then fresh; marked-expected calms to context', () => {
		assert.deepStrictEqual(
			[
				sourceFreshness({ fresh: false, contextOnly: false }),
				sourceFreshness({ fresh: false, contextOnly: false, markedExpected: true }),
				sourceFreshness({ fresh: true, contextOnly: true }),
				sourceFreshness({ fresh: true, contextOnly: false }),
			],
			[SourceFreshness.Stale, SourceFreshness.ContextOnly, SourceFreshness.ContextOnly, SourceFreshness.Fresh],
		);
	});

	test('short relative time is deterministic under the injected clock', () => {
		assert.deepStrictEqual(
			[
				relativeSyncedShort(undefined, NOW),
				relativeSyncedShort('2026-07-09T23:59:40Z', NOW),
				relativeSyncedShort('2026-07-09T23:55:00Z', NOW),
				relativeSyncedShort('2026-07-09T21:00:00Z', NOW),
				relativeSyncedShort('2026-07-01T00:00:00Z', NOW),
			],
			['not yet synced', 'just now', '5m ago', '3h ago', '9d ago'],
		);
	});

	test('labels + colours match the mock: fresh green relative, stale amber "stale · Nd" + cream, context grey', () => {
		const fresh = freshnessLabel(SourceFreshness.Fresh, '2026-07-09T22:00:00Z', NOW);
		const stale = freshnessLabel(SourceFreshness.Stale, '2026-07-01T00:00:00Z', NOW);
		const context = freshnessLabel(SourceFreshness.ContextOnly, undefined, NOW);
		assert.deepStrictEqual(
			{ fresh, stale, context },
			{
				fresh: { label: '2h ago', dot: '#2C8159', text: '#2C8159' },
				stale: { label: 'stale · 9d', dot: '#C99A2E', text: '#8A6D1A' },
				context: { label: 'context only', dot: '#D5D8DE', text: '#868B95' },
			},
		);
	});

	test('a sub-day stale source reports hours, never a fabricated 0d', () => {
		assert.strictEqual(freshnessLabel(SourceFreshness.Stale, '2026-07-09T20:00:00Z', NOW).label, 'stale · 4h');
	});

	test('an unreachable source borrows the STALE family (amber dot + stale text), never a fourth colour', () => {
		assert.deepStrictEqual(unreachableSourceLabel(), {
			label: 'Stale · source unreachable',
			line: 'Live value unavailable - showing the last synced value',
			dot: freshnessLabel(SourceFreshness.Stale, undefined, NOW).dot,
			text: freshnessLabel(SourceFreshness.Stale, undefined, NOW).text,
		});
	});
});
