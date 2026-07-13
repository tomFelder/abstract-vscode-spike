/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Fan-out run honesty (F14, issue #123; docs/21 section 4 item 3). A model outage on the whole-project /
// working-set fan-out path must NEVER render as a silent "no changes proposed" all-clear: a document the
// model could not be reached for is a FAILURE, not a document that ran and found nothing. This pure module
// aggregates the per-document outcomes of a fan-out into an honest, plain-words result: it names the model
// as unreachable, lists which documents failed, and (on a partial success) reports the proposals that DID
// land alongside the failures - matching the single-doc rail's named-error standard ("The agent model is
// not reachable ..."). No DOM, no service, no model - deterministic string formatting, unit-tested directly
// and reused by the service's fan-out composer and the run screen.

/** One document a fan-out could not process because the model was unreachable/errored: id + human title. */
export interface IFanoutFailedDoc {
	/** The document's resource string (its stable id), used to re-run ONLY this document on Retry failed. */
	readonly id: string;
	/** The document's human title, shown in the named failure list. */
	readonly title: string;
}

/** The honest, aggregated result of a fan-out run, ready for the run surface (rail turn / run screen). */
export interface IFanoutRunOutcome {
	/** The plain-words turn text: a named failure list on error, the cap message on pause, else the reply. */
	readonly content: string;
	/** The documents that failed (empty when none) - drives the "Retry failed" affordance that re-runs them. */
	readonly failedDocs: readonly IFanoutFailedDoc[];
	/** True when at least one document failed: the surface renders a named error, never an all-clear. */
	readonly isError: boolean;
	/** True when the run paused on the budget cap: finished proposals stay reviewable, NOT an error/all-clear. */
	readonly isPaused: boolean;
}

/** The raw tallies a fan-out collects as it runs its batches, before formatting into an honest outcome. */
export interface IFanoutSummaryInput {
	/** The number of proposals that landed across all documents (0 when the model was down for every doc). */
	readonly proposedCount: number;
	/** The documents the model could not be reached/errored for, in run order. */
	readonly failedDocs: readonly IFanoutFailedDoc[];
	/** The model's own reply prose, if any batch returned one (used only on the clean, no-failure path). */
	readonly reply?: string;
	/** Set when the run paused on the spent-budget cap: the plain-words cap message the proxy streamed. */
	readonly pausedMessage?: string;
}

// The named-error standard, matching the single-doc rail's reference string ("The agent model is not
// reachable. Start the local proxy (scripts/lwd-anthropic-proxy.sh) ...") so the fan-out speaks the SAME
// plain words (P5). Kept as constants so the tone stays in one place.
const NOT_REACHABLE = 'The agent model is not reachable';
const PROXY_HINT = 'Start the local proxy (scripts/lwd-anthropic-proxy.sh)';

/** The neutral honest line when a clean run genuinely proposed nothing (no failures, no pause). */
export const FANOUT_NO_CHANGES = 'I did not find anything to change across those documents.';

function plural(n: number): string {
	return n === 1 ? '' : 's';
}

function names(failedDocs: readonly IFanoutFailedDoc[]): string {
	return failedDocs.map(d => d.title).join(', ');
}

/**
 * Aggregate a fan-out's tallies into an honest run outcome (F14). Priority, highest first:
 *
 *  1. `pausedMessage` set -> the run paused on the budget cap: the content is the plain-words cap message,
 *     `isPaused` true, NO failed docs, NOT an error. Finished proposals (counted in `proposedCount`) stay
 *     reviewable; the surface must render this as a calm pause, never a failure and never an all-clear.
 *  2. `failedDocs` non-empty -> at least one document could not be reached: a NAMED error listing every
 *     failed document. On a partial success (`proposedCount > 0`) it leads with the proposals that landed,
 *     then names the failures and points at "Retry failed" to re-run ONLY those. `isError` true.
 *  3. otherwise -> the clean path: the model's `reply` when it gave one, nothing when proposals carry the
 *     meaning (their cards speak), else the neutral honest "nothing to change" line.
 *
 * Crucially, case 3's all-clear line is reachable ONLY when there were no failures and no pause, so a model
 * outage can never be mistaken for "no changes proposed".
 */
export function summarizeFanoutRun(input: IFanoutSummaryInput): IFanoutRunOutcome {
	if (input.pausedMessage) {
		return { content: input.pausedMessage, failedDocs: [], isError: false, isPaused: true };
	}
	const failedDocs = input.failedDocs;
	if (failedDocs.length) {
		const n = failedDocs.length;
		const list = names(failedDocs);
		const content = input.proposedCount > 0
			? `${input.proposedCount} change${plural(input.proposedCount)} proposed. ${NOT_REACHABLE} for ${n} document${plural(n)}: ${list}. ${PROXY_HINT}, then Retry failed to re-run just those.`
			: `${NOT_REACHABLE}, so I could not propose changes for ${n} document${plural(n)}: ${list}. ${PROXY_HINT}, then Retry failed.`;
		return { content, failedDocs, isError: true, isPaused: false };
	}
	const content = input.reply || (input.proposedCount ? '' : FANOUT_NO_CHANGES);
	return { content, failedDocs: [], isError: false, isPaused: false };
}
