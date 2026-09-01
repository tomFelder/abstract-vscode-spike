/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The D26 onboarding funnel (doc 20 section D26; doc 15 section 2.1; doc 18 sections 2.4-2.5): the pure,
// self-contained logic behind the two-wow, ten-minute, no-setup path -- step sequencing, the feedback-verb
// log line, and the bundled demo dataset. Consent + capture are NOT here (they are the analytics service's
// job, already built on this base: IAnalyticsService gates every event, NullAnalyticsService is the decline
// state, and the consent moment is the AnalyticsConsentContribution). This module stays PURE: no DOM, no
// service, no fetch, no wall clock (timestamps injected). It is imported by the screen renderer + the
// living-docs service and unit-tested directly, so the funnel's contract is proven without driving a webview.

/**
 * The T5 onboarding funnel steps (doc 15 section 2.1), in order. Every drop-off between steps is a design
 * task, so each is emitted as an `onboarding_step` analytics event (the label is `onboardingStepLabel`).
 */
export type OnboardingStep =
	| 'open'
	| 'demo-report'
	| 'provenance-peek'
	| 'first-diff'
	| 'first-approve-sample'
	| 'first-folder'
	| 'first-approve-own';

/** The funnel order (doc 15 section 2.1). The onboarding surface walks these; the last is the T4 aha. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	'open',
	'demo-report',
	'provenance-peek',
	'first-diff',
	'first-approve-sample',
	'first-folder',
	'first-approve-own',
];

// The human step name emitted as the `onboarding_step` event property, verbatim from the doc-15 section-2.1
// funnel ("open -> demo report generated -> provenance peek hovered -> ..."). Kept as the analytics label so
// every drop-off is legible in the funnel chart. Bounded (well under the label linter's 64 chars).
const STEP_LABELS: Record<OnboardingStep, string> = {
	'open': 'open',
	'demo-report': 'demo report generated',
	'provenance-peek': 'provenance peek hovered',
	'first-diff': 'first diff seen',
	'first-approve-sample': 'first approve (sample)',
	'first-folder': 'first folder opened',
	'first-approve-own': 'first approve (own file)',
};

/** The section-2.1 funnel label for one step, used as the `onboarding_step` event property. */
export function onboardingStepLabel(step: OnboardingStep): string {
	return STEP_LABELS[step];
}

/** The zero-based position of a step in the funnel (for "step N of M" progress + drop-off ordering). */
export function onboardingStepIndex(step: OnboardingStep): number {
	return ONBOARDING_STEPS.indexOf(step);
}

/** The step after `step`, or undefined when `step` is the final aha (nothing follows the own-file approve). */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | undefined {
	const i = ONBOARDING_STEPS.indexOf(step);
	return i >= 0 && i < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[i + 1] : undefined;
}

// --- the feedback verb ("this was wrong", doc 18 section 2.5; doc 15 sections 2.4 + 3.1) ---

/**
 * A "this was wrong" report against one applied change: the analytics-safe change reference (an id, never the
 * document's prose), an optional plain-words comment (kept LOCAL for the founder log, never sent as analytics),
 * and the document title for the founder-visible log line.
 */
export interface IFeedbackReport {
	/** The applied change's reference -- an id/label only, so the analytics event carries no document content. */
	readonly changeRef: string;
	/** The reviewer's optional plain-words note. Stays on the machine (founder log); never an event property. */
	readonly comment: string;
	/** The document the flagged change belongs to (for the founder-visible log line). */
	readonly docTitle: string;
}

/**
 * The founder-visible log line for a "this was wrong" report (doc 18 section 2.5: every report is read). This
 * is a LOCAL log line, so it may carry the plain-words comment (unlike the `this_was_wrong_reported` analytics
 * event, which carries only a hashed ref id). Single line, ASCII, ready to append to the founder log.
 */
export function founderFeedbackLogLine(report: IFeedbackReport, nowIso: string): string {
	const comment = report.comment.trim();
	const tail = comment.length > 0 ? ` -- "${comment.replace(/\s+/g, ' ')}"` : ' (no comment)';
	return `[this-was-wrong] ${nowIso} ${report.docTitle} :: ${report.changeRef}${tail}`;
}

// --- the bundled demo dataset (doc 20 section D26 step 2: "generated from a bundled demo CSV") ---

/** The demo CSV file name written into the open folder by the "See it work" path (no folder to open). */
export const DEMO_CSV_NAME = 'demo-metrics.csv';

/** The demo document's base name (the generated Living Document the onboarding drives the two wows on). */
export const DEMO_DOC_NAME = 'Demo Report';

/**
 * The bundled demo dataset: two weeks of a tiny metrics table so previous/current/delta all resolve. The last
 * two rows drive the bound figures the onboarding peek + iterate on (MRR $48.6k, +18%; signups 427, +37%),
 * matching the deterministic CSV resolver's formatting so a sync leaves the demo figures reconciled (fresh, no
 * spurious change). Read-only demo data (doc 20 section D26 merge semantics).
 */
export const DEMO_CSV = [
	'week,date,mrr,signups,churn,active',
	'23,Jun 15,41200,312,3.1,188',
	'24,Jun 19,48600,427,2.4,205',
	'',
].join('\n');

/**
 * The demo Living Document (doc 20 section D26): a board note bound to the demo CSV. It carries the bound
 * figures the provenance peek reads (wow one) and the exact "Note to the board" paragraph the prompted
 * iteration tightens into a single inline red/green diff (wow two). The bind keys use the CSV's source alias
 * (`demo-metrics`, the file stem), so a sync resolves them straight from the bundled data.
 */
export function buildDemoReportMarkdown(csvName: string = DEMO_CSV_NAME): string {
	const csvStem = csvName.replace(/\.csv$/i, '');
	return [
		'---',
		'title: Demo Report',
		`subtitle: Week 24 - bound to ${csvName}`,
		'sources:',
		`  - ${csvName}`,
		'---',
		'',
		'## Numbers',
		'',
		'| Metric | Previous | Current | Change |',
		'| --- | --- | --- | --- |',
		`| MRR | [$41.2k](bind:${csvStem}.mrr.prev) | [$48.6k](bind:${csvStem}.mrr) | [+18%](bind:${csvStem}.mrr.delta) |`,
		`| New signups | [312](bind:${csvStem}.signups.prev) | [427](bind:${csvStem}.signups) | [+37%](bind:${csvStem}.signups.delta) |`,
		'',
		'## Note to the board',
		'',
		'Momentum is steady; we continue to track plan with no surprises this week.',
		'',
		'## Asks',
		'',
		'No asks this week. We will flag hiring needs once the next cohort closes.',
		'',
	].join('\n');
}

/**
 * The prompt the onboarding sends as the one iteration (doc 20 section D26 step 4: "try tightening this
 * paragraph"). It drives the EXISTING chat path so the model's reply arrives as a single reviewable inline
 * diff on the "Note to the board" paragraph -- wow moment two.
 */
export const DEMO_ITERATION_PROMPT = 'Tighten the note to the board so it is more concise, without changing its meaning.';
