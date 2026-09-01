/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ANALYTICS_EVENTS } from '../../common/analytics.js';
import {
	IAnalyticsEventRecord,
	ONBOARDING_FUNNEL_STEPS,
	TWEAK_REJECT_BAND,
	canonicalEventName,
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
		return { event: 'change_resolved', resolution, bulk: false };
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
				resolved: g.changesResolved, approvals: g.approvals, tweaks: g.tweaks, rejects: g.rejects,
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
			{ resolved: empty.changesResolved, rate: empty.tweakRejectRate, band: empty.tweakRejectBand, undoRate: empty.undoAfterApproveRate },
			{ resolved: 0, rate: undefined, band: 'no-data', undoRate: undefined });
	});

	test('foldGuardrails flags the agent-not-good-enough alarm (above band)', () => {
		// 5 approves, 5 rejects -> rate 0.5 -> above the 25% ceiling.
		const records = [...Array.from({ length: 5 }, () => resolved('approve')), ...Array.from({ length: 5 }, () => resolved('reject'))];
		const g = foldGuardrails(records);
		assert.deepStrictEqual({ rate: g.tweakRejectRate, band: g.tweakRejectBand }, { rate: 0.5, band: 'above' });
	});

	// --- issue #378: a log written before the proposal -> change rename still folds ---
	//
	// ~/.abstract/events.log is ONE global append-only file per machine. The rename could not migrate it, so a
	// real log is mixed: pre-rename `proposal_resolved` records sit beside post-rename `change_resolved` ones.
	// These tests pin the read-side alias, and in particular the failure mode it exists to prevent - a mixed log
	// read by exact string collapses the denominator to the handful of new records and INVERTS the guardrail,
	// reporting rubber-stamping off a history that says the opposite.

	/** A resolution as it was written before the rename. */
	function retiredResolved(resolution: string): IAnalyticsEventRecord {
		return { event: 'proposal_resolved', resolution, bulk: false };
	}

	test('#378: canonicalEventName folds the retired names and passes everything else through', () => {
		assert.deepStrictEqual(
			{
				created: canonicalEventName('proposal_created'),
				resolvedEvent: canonicalEventName('proposal_resolved'),
				current: canonicalEventName('change_resolved'),
				untouched: canonicalEventName('undo_after_approve'),
				unknown: canonicalEventName('an_event_this_build_has_never_heard_of'),
			},
			{
				created: 'change_created',
				resolvedEvent: 'change_resolved',
				current: 'change_resolved',
				untouched: 'undo_after_approve',
				unknown: 'an_event_this_build_has_never_heard_of',
			});
	});

	test('#378: the retired names are readable but NOT emittable - the alias is read-side only', () => {
		const emittable = Object.keys(ANALYTICS_EVENTS);
		assert.ok(!emittable.includes('proposal_created'), 'proposal_created cannot be emitted again');
		assert.ok(!emittable.includes('proposal_resolved'), 'proposal_resolved cannot be emitted again');
		assert.ok(emittable.includes('change_created') && emittable.includes('change_resolved'), 'the current names are emittable');
	});

	test('#378: a mixed log folds pre-rename and post-rename records into ONE denominator', () => {
		// Interleaved rather than blocked, because that is how the file actually reads: the build changed
		// mid-history, so old and new names alternate around the upgrade.
		const records: IAnalyticsEventRecord[] = [
			retiredResolved('approve'), { event: 'change_resolved', resolution: 'approve', bulk: false },
			retiredResolved('tweak'), { event: 'change_resolved', resolution: 'tweak', bulk: false },
			retiredResolved('reject'), { event: 'change_resolved', resolution: 'reject', bulk: false },
			retiredResolved('approve'), { event: 'change_resolved', resolution: 'approve', bulk: false },
			{ event: 'undo_after_approve', depth: 1 },
		];
		const g = foldGuardrails(records);
		assert.deepStrictEqual(
			{
				resolved: g.changesResolved, approvals: g.approvals, tweaks: g.tweaks, rejects: g.rejects,
				rate: g.tweakRejectRate, band: g.tweakRejectBand, undoRate: g.undoAfterApproveRate,
			},
			// 8 resolutions, not the 4 an exact-string fold would see: 4 approves, 2 tweaks, 2 rejects.
			{ resolved: 8, approvals: 4, tweaks: 2, rejects: 2, rate: 0.5, band: 'above', undoRate: 1 / 4 });
	});

	test('#378: a mostly-pre-rename log does NOT invert into a false rubber-stamping alarm', () => {
		// The founder's real log, in proportion: 158 pre-rename resolutions at a healthy 24.05% tweak+reject
		// rate and one undo, plus the single post-rename resolution a HEAD build had appended by then.
		const records: IAnalyticsEventRecord[] = [
			...Array.from({ length: 120 }, () => retiredResolved('approve')),
			...Array.from({ length: 19 }, () => retiredResolved('tweak')),
			...Array.from({ length: 19 }, () => retiredResolved('reject')),
			{ event: 'undo_after_approve', depth: 1 },
			{ event: 'change_resolved', resolution: 'approve', bulk: false },
		];
		const g = foldGuardrails(records);

		// The whole history is counted, not just the one record written under the current name.
		assert.strictEqual(g.changesResolved, 159, 'every resolution counts, whichever name it was written under');
		assert.strictEqual(g.approvals, 121);
		assert.strictEqual(g.tweaks, 19);
		assert.strictEqual(g.rejects, 19);

		// The specific inversion this guards: read by exact string the denominator is 1, the rate is 0 and the
		// band reads 'below' - which section 2.4 defines as rubber-stamping. The data says the opposite.
		assert.strictEqual(g.tweakRejectBand, 'healthy');
		assert.notStrictEqual(g.tweakRejectBand, 'below', 'a healthy history must never be reported as rubber-stamping');
		assert.ok(g.tweakRejectRate! > TWEAK_REJECT_BAND.min && g.tweakRejectRate! < TWEAK_REJECT_BAND.max,
			`the rate sits inside the healthy band, got ${g.tweakRejectRate}`);

		// And the undo rate stays sane: `undo_after_approve` never renamed, so with a collapsed approvals
		// denominator it would read 100%. Against the real denominator it is under one percent.
		assert.strictEqual(g.undoAfterApproveRate, 1 / 121);
		assert.ok(g.undoAfterApproveRate! < 0.01, `the undo rate is under 1%, got ${g.undoAfterApproveRate}`);
	});
});
