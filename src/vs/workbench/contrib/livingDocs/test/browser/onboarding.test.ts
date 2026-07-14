/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildDemoReportMarkdown,
	DEMO_CSV,
	DEMO_CSV_NAME,
	founderFeedbackLogLine,
	nextOnboardingStep,
	onboardingStepIndex,
	onboardingStepLabel,
	ONBOARDING_STEPS,
} from '../../common/onboarding.js';
import { ANALYTICS_EVENTS, lintEventProps } from '../../common/analytics.js';

suite('LivingDoc onboarding funnel (D26)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the funnel is the seven doc-15 section-2.1 steps, in order', () => {
		assert.deepStrictEqual([...ONBOARDING_STEPS], [
			'open', 'demo-report', 'provenance-peek', 'first-diff', 'first-approve-sample', 'first-folder', 'first-approve-own',
		]);
	});

	test('step labels are the verbatim funnel names', () => {
		assert.deepStrictEqual(ONBOARDING_STEPS.map(onboardingStepLabel), [
			'open', 'demo report generated', 'provenance peek hovered', 'first diff seen', 'first approve (sample)', 'first folder opened', 'first approve (own file)',
		]);
	});

	test('every step label is a valid onboarding_step analytics property (passes the privacy linter)', () => {
		// Guard the seam to the analytics dictionary: each funnel label must satisfy the `onboarding_step`
		// schema (a bounded `label`), so emitting a step can never be dropped by the property-linter.
		assert.ok(ANALYTICS_EVENTS.onboarding_step !== undefined);
		for (const step of ONBOARDING_STEPS) {
			const errors = lintEventProps('onboarding_step', { step: onboardingStepLabel(step) });
			assert.deepStrictEqual(errors, [], `step "${step}" label must be a clean analytics label`);
		}
	});

	test('nextOnboardingStep walks the funnel and stops at the aha', () => {
		assert.deepStrictEqual(ONBOARDING_STEPS.map(nextOnboardingStep), [
			'demo-report', 'provenance-peek', 'first-diff', 'first-approve-sample', 'first-folder', 'first-approve-own', undefined,
		]);
	});

	test('onboardingStepIndex gives the funnel position', () => {
		assert.deepStrictEqual(ONBOARDING_STEPS.map(onboardingStepIndex), [0, 1, 2, 3, 4, 5, 6]);
	});

	test('the founder log line is a single ASCII line that keeps the local comment', () => {
		const line = founderFeedbackLogLine({ changeRef: 'c-42', comment: 'wrong\n number', docTitle: 'Board Note' }, '2026-07-13T00:00:00.000Z');
		assert.strictEqual(line, '[this-was-wrong] 2026-07-13T00:00:00.000Z Board Note :: c-42 -- "wrong number"');
		assert.ok(!line.includes('\n'));
		assert.ok(/^[\x00-\x7F]*$/.test(line), 'founder log line is ASCII');
		const none = founderFeedbackLogLine({ changeRef: 'c-1', comment: '', docTitle: 'Doc' }, '2026-07-13T00:00:00.000Z');
		assert.ok(none.endsWith('(no comment)'));
	});

	test('the demo dataset resolves the bound figures the two wows use', () => {
		// The CSV last two rows drive prev/current/delta for MRR + signups.
		const rows = DEMO_CSV.trim().split('\n');
		assert.strictEqual(rows[0], 'week,date,mrr,signups,churn,active');
		assert.ok(rows[rows.length - 1].startsWith('24,'));
		assert.strictEqual(DEMO_CSV_NAME, 'demo-metrics.csv');
	});

	test('the demo document is a living doc bound to the demo CSV with the tightenable paragraph', () => {
		const md = buildDemoReportMarkdown();
		// Frontmatter binds it to the demo CSV (makes it a Living Document).
		assert.ok(md.includes('sources:'));
		assert.ok(md.includes('- demo-metrics.csv'));
		// Bound figures for the provenance peek (wow one) use the CSV's source alias.
		assert.ok(md.includes('[$48.6k](bind:demo-metrics.mrr)'));
		assert.ok(md.includes('[427](bind:demo-metrics.signups)'));
		// The exact paragraph the prompted iteration tightens (wow two) -- a single reviewable block.
		assert.ok(md.includes('Momentum is steady; we continue to track plan with no surprises this week.'));
	});

	test('a collision-safe demo CSV name remains a valid bind source alias', () => {
		const md = buildDemoReportMarkdown('demo-metrics-2.csv');
		assert.ok(md.includes('- demo-metrics-2.csv'));
		assert.ok(md.includes('(bind:demo-metrics-2.mrr)'));
	});
});
