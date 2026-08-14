/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { freshnessLabel, relativeSyncedShort, sourceFreshness, SourceFreshness, unreachableSourceLabel } from '../../common/sourceFreshness.js';
import { AMBER, GREEN, INK, PAPER } from '../../common/abstractTokens.js';

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

	test('labels + colours match the design system: fresh green relative, stale amber "stale · Nd", context neutral', () => {
		const fresh = freshnessLabel(SourceFreshness.Fresh, '2026-07-09T22:00:00Z', NOW);
		const stale = freshnessLabel(SourceFreshness.Stale, '2026-07-01T00:00:00Z', NOW);
		const context = freshnessLabel(SourceFreshness.ContextOnly, undefined, NOW);
		// The colours are asserted against the tokens, not literals: the rule being protected is that a
		// freshness dot means the same thing, in the same hue, as every other state in the product. Pinning
		// hexes here would let the freshness vocabulary drift away from the system while the test still passed.
		assert.deepStrictEqual(
			{ fresh, stale, context },
			{
				fresh: { label: '2h ago', dot: GREEN.base, text: GREEN.base },
				stale: { label: 'stale · 9d', dot: AMBER.base, text: AMBER.label },
				context: { label: 'context only', dot: PAPER.control, text: INK.secondary },
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
