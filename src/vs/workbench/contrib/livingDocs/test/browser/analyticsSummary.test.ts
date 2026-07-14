/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	IAnalyticsEventRecord,
	ONBOARDING_FUNNEL_STEPS,
	TWEAK_REJECT_BAND,
	classifyTweakRejectBand,
	foldFunnel,
	foldGuardrails,
} from '../../common/analyticsSummary.js';

// Plan 36 / doc 15 section 3.2 - the "dashboards as code" minimal v1. These tests drive the pure funnel + guardrail
// folds over synthetic event streams (exactly the shape the local sink writes to events.log) so the activation
// funnel and the trust guardrails are reproducible without PostHog (the real dashboards, deferred to iter 3).
suite('analyticsSummary folds (plan 36: funnel + guardrails as code)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function step(distinct_id: string, name: string): IAnalyticsEventRecord {
		return { event: 'onboarding_step', distinct_id, step: name };
	}
	function resolved(resolution: string): IAnalyticsEventRecord {
		return { event: 'proposal_resolved', resolution, bulk: false };
	}

	test('foldFunnel counts distinct users per ordered step with non-negative drop-off', () => {
		// u1 walks the whole funnel; u2 stops after the provenance peek; u3 only opens.
		const records: IAnalyticsEventRecord[] = [
			...ONBOARDING_FUNNEL_STEPS.map(s => step('u1', s)),
			step('u2', 'open'), step('u2', 'demo_report_generated'), step('u2', 'provenance_peeked'),
			step('u3', 'open'),
			// A duplicate emit must not double-count a user.
			step('u1', 'open'),
		];
		const funnel = foldFunnel(records);
		const byStep = Object.fromEntries(funnel.map(f => [f.step, f.users]));
		assert.deepStrictEqual(
			{ open: byStep.open, demo: byStep.demo_report_generated, peek: byStep.provenance_peeked, last: byStep.first_approve_own_file },
			{ open: 3, demo: 2, peek: 2, last: 1 });
		// Drop-off is the loss versus the previous step, never negative.
		const openStep = funnel.find(f => f.step === 'open')!;
		const demoStep = funnel.find(f => f.step === 'demo_report_generated')!;
		const peekStep = funnel.find(f => f.step === 'provenance_peeked')!;
		assert.deepStrictEqual(
			{ openDrop: openStep.dropFromPrevious, demoDrop: demoStep.dropFromPrevious, peekDrop: peekStep.dropFromPrevious },
			{ openDrop: 0, demoDrop: 1, peekDrop: 0 });
		assert.ok(funnel.every(f => f.dropFromPrevious >= 0), 'drop-off is never negative');
	});

	test('foldFunnel ignores non-onboarding events and unknown step labels', () => {
		const records: IAnalyticsEventRecord[] = [
			step('u1', 'open'),
			{ event: 'app_opened', distinct_id: 'u1', version: '1.0.0' },
			{ event: 'onboarding_step', distinct_id: 'u1', step: 'a_step_not_in_the_funnel' },
		];
		const funnel = foldFunnel(records);
		assert.strictEqual(funnel.find(f => f.step === 'open')!.users, 1);
		assert.strictEqual(funnel.length, ONBOARDING_FUNNEL_STEPS.length, 'the funnel shape is exactly the ordered steps');
	});

	test('classifyTweakRejectBand marks below/healthy/above around the 5-25% band', () => {
		assert.deepStrictEqual(
			{
				none: classifyTweakRejectBand(undefined),
				zero: classifyTweakRejectBand(0),
				floor: classifyTweakRejectBand(TWEAK_REJECT_BAND.min),
				mid: classifyTweakRejectBand(0.15),
				ceil: classifyTweakRejectBand(TWEAK_REJECT_BAND.max),
				over: classifyTweakRejectBand(0.40),
			},
			{ none: 'no-data', zero: 'below', floor: 'healthy', mid: 'healthy', ceil: 'healthy', over: 'above' });
	});

	test('foldGuardrails computes the tweak+reject rate, band, staleness escapes and undo rate', () => {
		// 6 approves, 1 tweak, 1 reject over 8 resolutions -> tweak+reject = 2/8 = 0.25 (top of the healthy band).
		const records: IAnalyticsEventRecord[] = [
			...Array.from({ length: 6 }, () => resolved('approve')),
			resolved('tweak'),
			resolved('reject'),
			{ event: 'export_or_publish', format: 'html', provenance_mode: 'footnoted', stale_sources_present: true },
			{ event: 'export_or_publish', format: 'markdown', provenance_mode: 'clean', stale_sources_present: false },
			{ event: 'undo_after_approve', depth: 1 },
			{ event: 'undo_after_approve', depth: 2 },
		];
		const g = foldGuardrails(records);
		assert.deepStrictEqual(
			{
				resolved: g.proposalsResolved, approvals: g.approvals, tweaks: g.tweaks, rejects: g.rejects,
				rate: g.tweakRejectRate, band: g.tweakRejectBand,
				staleness: g.stalenessEscapes, undo: g.undoAfterApprove, undoRate: g.undoAfterApproveRate,
			},
			{
				resolved: 8, approvals: 6, tweaks: 1, rejects: 1,
				rate: 0.25, band: 'healthy',
				staleness: 1, undo: 2, undoRate: 2 / 6,
			});
	});

	test('foldGuardrails flags rubber-stamping (below band) and returns no-data on an empty stream', () => {
		// 20 approves, 0 tweak/reject -> rate 0 -> below the 5% floor (the rubber-stamping alarm).
		const rubberStamp = foldGuardrails(Array.from({ length: 20 }, () => resolved('approve')));
		assert.deepStrictEqual({ rate: rubberStamp.tweakRejectRate, band: rubberStamp.tweakRejectBand }, { rate: 0, band: 'below' });
		const empty = foldGuardrails([]);
		assert.deepStrictEqual(
			{ resolved: empty.proposalsResolved, rate: empty.tweakRejectRate, band: empty.tweakRejectBand, undoRate: empty.undoAfterApproveRate },
			{ resolved: 0, rate: undefined, band: 'no-data', undoRate: undefined });
	});

	test('foldGuardrails flags the agent-not-good-enough alarm (above band)', () => {
		// 5 approves, 5 rejects -> rate 0.5 -> above the 25% ceiling.
		const records = [...Array.from({ length: 5 }, () => resolved('approve')), ...Array.from({ length: 5 }, () => resolved('reject'))];
		const g = foldGuardrails(records);
		assert.deepStrictEqual({ rate: g.tweakRejectRate, band: g.tweakRejectBand }, { rate: 0.5, band: 'above' });
	});
});
