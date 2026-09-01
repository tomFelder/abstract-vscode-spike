/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AnalyticsEventName } from './analytics.js';

/**
 * The "dashboards as code" minimal v1 (plan 36 / doc 15 section 3.2). The plan's real dashboards need PostHog
 * (deferred, iteration 3); this pure module is the honest interim: it folds a stream of captured events -
 * exactly the JSON lines the local sink writes to ~/.abstract/events.log - into the doc-15 activation funnel
 * (section 2.1) and the trust guardrails (section 2.4). No DOM, no browser globals, no I/O: string/record-in, summary-out,
 * so it runs identically in a unit test and in any future read-only "usage summary" surface.
 */

/**
 * One parsed analytics event, as the local sink stores it (the proxy stamps `ts`; the service writes `event`,
 * `distinct_id` and the typed props flat alongside). Property values are the same narrow scalars the linter
 * allows - counts, flags, labels, ids - never document prose.
 */
export interface IAnalyticsEventRecord {
	readonly event: AnalyticsEventName | string;
	readonly distinct_id?: string;
	readonly [prop: string]: string | number | boolean | undefined;
}

/**
 * The T5 onboarding sub-funnel (doc 15 section 2.1), in order. These are the `step` labels an `onboarding_step`
 * event carries once the onboarding surface exists (issue #127, deferred); the fold is written now so the
 * dashboard lands the moment those events start flowing. Every drop-off between two adjacent steps is a
 * design task (doc 15 section 2.1).
 */
export const ONBOARDING_FUNNEL_STEPS = [
	'open',
	'demo_report_generated',
	'provenance_peeked',
	'first_diff_seen',
	'first_approve_sample',
	'first_folder_opened',
	'first_approve_own_file',
] as const;

/** The healthy tweak+reject band (doc 15 section 2.4): below is rubber-stamping, above is an agent not good enough. */
export const TWEAK_REJECT_BAND = { min: 0.05, max: 0.25 } as const;

/** One funnel step's fold: how many distinct users reached it, and how many were lost since the previous step. */
export interface IFunnelStepResult {
	readonly step: string;
	readonly users: number;
	readonly dropFromPrevious: number;
}

/**
 * Fold an event stream into the ordered onboarding funnel. A user (by `distinct_id`) has "reached" a step if
 * they emitted an `onboarding_step` event carrying that step label. `dropFromPrevious` is how many users the
 * step lost relative to the one before it (never negative - a later step can legitimately show more users if
 * an earlier step's event was missed, and we do not invent a decline that is not there).
 */
export function foldFunnel(
	records: readonly IAnalyticsEventRecord[],
	steps: readonly string[] = ONBOARDING_FUNNEL_STEPS,
): IFunnelStepResult[] {
	const usersByStep = new Map<string, Set<string>>();
	for (const step of steps) {
		usersByStep.set(step, new Set<string>());
	}
	for (const record of records) {
		if (record.event !== 'onboarding_step') {
			continue;
		}
		const step = typeof record.step === 'string' ? record.step : undefined;
		if (step === undefined) {
			continue;
		}
		const bucket = usersByStep.get(step);
		if (bucket) {
			bucket.add(record.distinct_id ?? 'anonymous');
		}
	}
	const results: IFunnelStepResult[] = [];
	let previous: number | undefined;
	for (const step of steps) {
		const users = usersByStep.get(step)!.size;
		const dropFromPrevious = previous === undefined ? 0 : Math.max(0, previous - users);
		results.push({ step, users, dropFromPrevious });
		previous = users;
	}
	return results;
}

/** Which side of the healthy band a rate sits on (or that there is nothing to judge yet). */
export type GuardrailBand = 'no-data' | 'below' | 'healthy' | 'above';

/** The trust guardrails (doc 15 section 2.4) folded from an event stream - the honest interim for dashboard 4. */
export interface IGuardrailSummary {
	/** Total `change_resolved` events seen (the denominator for the band). */
	readonly changesResolved: number;
	readonly approvals: number;
	readonly tweaks: number;
	readonly rejects: number;
	/** (tweaks + rejects) / changesResolved, or undefined when nothing has been resolved yet. */
	readonly tweakRejectRate: number | undefined;
	/** Where {@link tweakRejectRate} sits against {@link TWEAK_REJECT_BAND} (5-25%). */
	readonly tweakRejectBand: GuardrailBand;
	/** `export_or_publish` events where a bound source was stale (doc 15 section 2.4: target zero, each is an incident). */
	readonly stalenessEscapes: number;
	/** How many times a user reached back past an approval (plan 26); a spike marks a trust wound. */
	readonly undoAfterApprove: number;
	/** undoAfterApprove / approvals, or undefined when nothing has been approved yet. */
	readonly undoAfterApproveRate: number | undefined;
}

/**
 * Classify a tweak+reject rate against the healthy band. Undefined (no resolutions yet) is `no-data`; below
 * the floor and above the ceiling are both alarms (doc 15 section 2.4), so the caller can surface either end.
 */
export function classifyTweakRejectBand(rate: number | undefined): GuardrailBand {
	if (rate === undefined) {
		return 'no-data';
	}
	if (rate < TWEAK_REJECT_BAND.min) {
		return 'below';
	}
	if (rate > TWEAK_REJECT_BAND.max) {
		return 'above';
	}
	return 'healthy';
}

/** Fold an event stream into the doc-15 trust guardrails. Pure: the same input always yields the same summary. */
export function foldGuardrails(records: readonly IAnalyticsEventRecord[]): IGuardrailSummary {
	let approvals = 0;
	let tweaks = 0;
	let rejects = 0;
	let stalenessEscapes = 0;
	let undoAfterApprove = 0;
	for (const record of records) {
		switch (record.event) {
			case 'change_resolved':
				if (record.resolution === 'approve') { approvals++; }
				else if (record.resolution === 'tweak') { tweaks++; }
				else if (record.resolution === 'reject') { rejects++; }
				break;
			case 'export_or_publish':
				if (record.stale_sources_present === true) { stalenessEscapes++; }
				break;
			case 'undo_after_approve':
				undoAfterApprove++;
				break;
			default:
				break;
		}
	}
	const changesResolved = approvals + tweaks + rejects;
	const tweakRejectRate = changesResolved > 0 ? (tweaks + rejects) / changesResolved : undefined;
	const undoAfterApproveRate = approvals > 0 ? undoAfterApprove / approvals : undefined;
	return {
		changesResolved,
		approvals,
		tweaks,
		rejects,
		tweakRejectRate,
		tweakRejectBand: classifyTweakRejectBand(tweakRejectRate),
		stalenessEscapes,
		undoAfterApprove,
		undoAfterApproveRate,
	};
}
