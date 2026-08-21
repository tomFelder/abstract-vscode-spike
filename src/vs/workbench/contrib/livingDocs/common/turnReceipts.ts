/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

// Honest turn receipts (docs/30 invariant I3; kills the confirmed mechanism behind issue #303). A model reply
// routinely claims edits the queue-time pipeline then drops - the target was a heading, the document is dialled
// "never", the quoted text matched nothing, the range carries a live figure link, the fan-out named a document
// that was not in the run. Every one of those drops used to be a bare `undefined` return, so the user read the
// model's success prose over a document nothing had happened to.
//
// This pure module is the reconciliation: the consumer counts what the model CLAIMED against what actually
// QUEUED and hands the shortfall here, which renders it as named reasons in plain words. Two rules carry the
// invariant: a claim that queued NOTHING renders as a failure and the success prose never reaches the bubble;
// a claim that queued SOME renders the reply plus a named shortfall line, so the count the user reads is the
// count the review rail holds. No DOM, no service, no model - deterministic string formatting, unit-tested
// directly and reused by the single-doc chat composer and the fan-out composer.

/**
 * Why one parsed edit or insert never became a queued proposal. Each value is a distinct, explainable
 * refusal the receipt can NAME, so a shortfall never degrades into "some changes did not apply".
 */
export type ChatDropReason =
	/** The document is dialled "Never change this doc", so no proposal is ever created for it. */
	| 'policy'
	/** The quoted text matched a heading; chat rewrites prose, never the document's structure. */
	| 'heading'
	/** No block in the document was close enough to the quoted text to be the edit's target. */
	| 'no-match'
	/** The targeted range carries a live figure link (a bind), which is never rewritten by prose. */
	| 'bind-guard'
	/** The rewrite is byte-identical to the text already in the document. */
	| 'no-op'
	/** The model returned an edit with no text to match or no text to write. */
	| 'empty'
	/** Fan-out only: the reply named a document that was not one of this run's targets. */
	| 'title-miss';

/** What a turn claimed versus what it queued, plus the model's own prose, ready to be reconciled. */
export interface ITurnReceiptInput {
	/** How many edits + inserts the parsed reply claimed (0 when the model only answered in prose). */
	readonly claimed: number;
	/** How many proposals actually landed in the review queue. */
	readonly queued: number;
	/** One entry per claimed-but-dropped edit, in the order the consumer processed them. */
	readonly drops: readonly ChatDropReason[];
	/** The prose the turn would otherwise show (the model's reply, or a composed fan-out line). */
	readonly reply: string;
}

/** The reconciled turn text plus whether the turn must render as a failure rather than an answer. */
export interface ITurnReceiptOutcome {
	/** The text the bubble shows: the reply, the reply plus a named shortfall, or a named failure. */
	readonly content: string;
	/** True when the turn claimed changes and queued NONE: the surface renders a failure, never prose. */
	readonly isError: boolean;
}

// Reasons are reported in a fixed order rather than first-seen order, so the same shortfall always reads the
// same way regardless of the order the model happened to return its edits in.
const REASON_ORDER: readonly ChatDropReason[] = ['heading', 'policy', 'no-match', 'bind-guard', 'no-op', 'empty', 'title-miss'];

/** The plain-words phrase for `count` drops that share one reason, e.g. "2 targeted headings". */
function reasonPhrase(reason: ChatDropReason, count: number): string {
	const one = count === 1;
	switch (reason) {
		case 'policy':
			return one
				? localize('livingDocs.receipt.reason.policy.one', "{0} was blocked by the document's policy", count)
				: localize('livingDocs.receipt.reason.policy.many', "{0} were blocked by the document's policy", count);
		case 'heading':
			return one
				? localize('livingDocs.receipt.reason.heading.one', "{0} targeted a heading", count)
				: localize('livingDocs.receipt.reason.heading.many', "{0} targeted headings", count);
		case 'no-match':
			return one
				? localize('livingDocs.receipt.reason.noMatch.one', "{0} quoted text that is not in the document", count)
				: localize('livingDocs.receipt.reason.noMatch.many', "{0} quoted text that is not in the document", count);
		case 'bind-guard':
			return one
				? localize('livingDocs.receipt.reason.bindGuard.one', "{0} targeted a live figure", count)
				: localize('livingDocs.receipt.reason.bindGuard.many', "{0} targeted live figures", count);
		case 'no-op':
			return one
				? localize('livingDocs.receipt.reason.noOp.one', "{0} would have changed nothing", count)
				: localize('livingDocs.receipt.reason.noOp.many', "{0} would have changed nothing", count);
		case 'empty':
			return one
				? localize('livingDocs.receipt.reason.empty.one', "{0} arrived with no text to apply", count)
				: localize('livingDocs.receipt.reason.empty.many', "{0} arrived with no text to apply", count);
		case 'title-miss':
			return one
				? localize('livingDocs.receipt.reason.titleMiss.one', "{0} named a document that was not in this run", count)
				: localize('livingDocs.receipt.reason.titleMiss.many', "{0} named documents that were not in this run", count);
	}
}

/** Tally the drops by reason and render them as one comma-separated, plain-words list. */
function describeDrops(drops: readonly ChatDropReason[]): string {
	const counts = new Map<ChatDropReason, number>();
	for (const reason of drops) { counts.set(reason, (counts.get(reason) ?? 0) + 1); }
	return REASON_ORDER.filter(r => counts.has(r)).map(r => reasonPhrase(r, counts.get(r)!)).join(', ');
}

/**
 * Reconcile what a turn claimed against what it queued (I3). Three outcomes, in priority order:
 *
 *  1. `claimed > 0` and `queued === 0` -> a FAILURE. The model's prose is discarded (it would be success
 *     prose over a document nothing happened to) and the content is the named reconciliation instead:
 *     "I described 2 changes but could not apply any of them: 1 targeted a heading, 1 was blocked ...".
 *  2. `queued > 0` with drops -> a partial. The reply is kept (the proposals that landed are real) and a
 *     named shortfall line is appended, so the count the user reads matches the count the rail holds.
 *  3. no drops -> nothing to reconcile: the reply passes through untouched.
 *
 * `drops` is expected to hold exactly `claimed - queued` entries; a shorter list still renders honestly,
 * falling back to a count-only sentence rather than inventing a reason it was never told.
 */
export function reconcileTurnReceipt(input: ITurnReceiptInput): ITurnReceiptOutcome {
	const shortfall = Math.max(input.claimed - input.queued, 0);
	if (!shortfall) {
		return { content: input.reply, isError: false };
	}
	const reasons = describeDrops(input.drops);
	if (input.queued === 0) {
		const content = reasons
			? (input.claimed === 1
				? localize('livingDocs.receipt.noneApplied.one', "I described a change but could not apply it: {0}.", reasons)
				: localize('livingDocs.receipt.noneApplied.many', "I described {0} changes but could not apply any of them: {1}.", input.claimed, reasons))
			: (input.claimed === 1
				? localize('livingDocs.receipt.noneApplied.bare.one', "I described a change but could not apply it to this document.")
				: localize('livingDocs.receipt.noneApplied.bare.many', "I described {0} changes but could not apply any of them to this document.", input.claimed));
		return { content, isError: true };
	}
	const note = reasons
		? (shortfall === 1
			? localize('livingDocs.receipt.shortfall.one', "1 change could not be applied: {0}.", reasons)
			: localize('livingDocs.receipt.shortfall.many', "{0} changes could not be applied: {1}.", shortfall, reasons))
		: (shortfall === 1
			? localize('livingDocs.receipt.shortfall.bare.one', "1 change could not be applied.")
			: localize('livingDocs.receipt.shortfall.bare.many', "{0} changes could not be applied.", shortfall));
	return { content: input.reply ? `${input.reply}\n\n${note}` : note, isError: false };
}
