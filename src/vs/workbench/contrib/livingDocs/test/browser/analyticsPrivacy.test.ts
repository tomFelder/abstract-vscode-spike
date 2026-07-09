/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ANALYTICS_EVENTS, AnalyticsEventName, AnalyticsProps, lintEventProps, NullAnalyticsService } from '../../common/analytics.js';

// Plan 36 iter 2 - THE PRIVACY CANARY. Document content must never leave the machine as analytics. This
// suite plants a canary string (the "document body") into every plausible property slot of every registered
// event, drives it through the property-linter, and proves the linter refuses it - the same linter the
// service runs before anything is sent. It also property-lints every event's own schema so a NEW event that
// declares a free-text or path-shaped property fails this test (and therefore the build) until it is fixed.
suite('analytics privacy canary + property-linter (plan 36 iter 2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// A distinctive canary that stands in for real document prose / a bound figure / a file path. If any of
	// these ever survives the linter into a payload, the invariant is broken.
	const CANARY_PROSE = 'Q3 revenue was 49,800 dollars and the CEO is Jane Doe - CONFIDENTIAL CANARY';
	const CANARY_PATH = '/Users/someone/Secret Project/quarterly report.md';
	const CANARY_FIGURE = '49,800.00';

	const eventNames = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

	test('every registered event rejects a canary planted in each of its properties', () => {
		const leaked: { event: string; key: string; value: string }[] = [];
		for (const event of eventNames) {
			const schema = ANALYTICS_EVENTS[event] as Record<string, string>;
			for (const key of Object.keys(schema)) {
				for (const canary of [CANARY_PROSE, CANARY_PATH, CANARY_FIGURE]) {
					const props: AnalyticsProps = { [key]: canary };
					const errors = lintEventProps(event, props);
					// The canary is prose/path/figure: it is longer than a label bound, or path-shaped, or a
					// string where a count/flag was required. Every kind must therefore reject at least one canary.
					// A short numeric figure like "49,800.00" is a string, so it is rejected wherever a count/flag
					// is expected and (being non-path) accepted only into a `label` slot - which is exactly why we
					// assert on the aggregate below rather than demanding every single canary trips every slot.
					if (errors.length === 0) {
						leaked.push({ event, key, value: canary });
					}
				}
			}
		}
		// A `label` slot legitimately accepts a short non-path string, so the figure canary "49,800.00" can pass
		// there. That is intended: a label is a controlled enum value, and a bound figure is never routed into a
		// label slot by the emitters (iter 2). The hard guarantee is that PROSE and PATHS never pass anywhere.
		const proseOrPathLeaks = leaked.filter(l => l.value === CANARY_PROSE || l.value === CANARY_PATH);
		assert.deepStrictEqual(proseOrPathLeaks, [], `prose/path canary leaked past the linter: ${JSON.stringify(proseOrPathLeaks)}`);
	});

	test('the linter rejects undeclared properties (a new field cannot smuggle content)', () => {
		const errors = lintEventProps('app_opened', { version: '1.0.0', secret_note: CANARY_PROSE } as AnalyticsProps);
		assert.deepStrictEqual(errors.map(e => e.key), ['secret_note']);
	});

	test('every event schema uses only enforceable kinds (no free-text kind exists)', () => {
		const allowed = new Set(['count', 'flag', 'label', 'hashed']);
		const bad: string[] = [];
		for (const event of eventNames) {
			const schema = ANALYTICS_EVENTS[event] as Record<string, string>;
			for (const key of Object.keys(schema)) {
				if (!allowed.has(schema[key])) {
					bad.push(`${event}.${key}=${schema[key]}`);
				}
			}
		}
		assert.deepStrictEqual(bad, [], 'a schema property uses a kind the linter cannot enforce');
	});

	test('valid typed payloads pass cleanly (the linter is not simply rejecting everything)', () => {
		const cases: [AnalyticsEventName, AnalyticsProps][] = [
			['app_opened', { version: '1.2.3', first_open: true }],
			['proposal_resolved', { resolution: 'approve', latency_ms: 1200, bulk: false }],
			['source_synced', { kind: 'file', ok: true, staleness_age_ms: 0 }],
			['this_was_wrong_reported', { ref_id: 'd3f8a1c0' }],
			['export_or_publish', { format: 'html', provenance_mode: 'footnoted', stale_sources_present: false }],
		];
		const findings = cases.flatMap(([e, p]) => lintEventProps(e, p));
		assert.deepStrictEqual(findings, [], 'a legitimate typed payload was wrongly rejected');
	});

	test('the null-object never enables and never captures (decline is total)', () => {
		const nul = new NullAnalyticsService();
		nul.setConsent(true); // ignored by the null object.
		nul.capture('app_opened', { version: '1.0.0' });
		nul.identify('x@y.com');
		assert.deepStrictEqual(
			{ chosen: nul.hasChosen, enabled: nul.isEnabled },
			{ chosen: true, enabled: false });
	});
});
