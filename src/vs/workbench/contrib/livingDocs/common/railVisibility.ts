/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The "quiet shell on entry" decision (plan 42 slice L4). This is the PURE core of the rule the
// RailVisibilityContribution executes when the editor surface is entered for a document: should the
// review rail (the AUXILIARYBAR_PART, carrying Chat / Review / History) start OPEN or COLLAPSED? The
// shell must be quiet when the rail has nothing to say - a plain doc with no pending review and no chat
// history opens editor + left rail only - while never hiding a pending proposal from the user (the
// agent-edit trust grammar is untouchable: a pending review always forces the rail open). Keeping the
// decision here (no DOM, no service, no wall clock) means the contract is unit-tested directly, without
// driving the workbench.

/** The user's persisted manual choice for the review rail, or "none" when they have not chosen yet. */
export const enum ReviewRailManualChoice {
	/** The user has not toggled the rail while editing: the default (has-something-to-say) rule applies. */
	None = 'none',
	/** The user manually opened the rail: keep it open on entry (their choice wins over the quiet default). */
	Open = 'open',
	/** The user manually collapsed the rail: keep it collapsed on entry (unless a pending review forces it). */
	Collapsed = 'collapsed',
}

/**
 * The facts the entry decision reads, all cheap reads the contribution gathers for the document it is
 * crossing into the editor surface with.
 */
export interface IReviewRailEntryContext {
	/** True when the document has one or more pending agent proposals (trust grammar: never hide these). */
	readonly hasPendingReview: boolean;
	/** True when the document already has chat history (a prior conversation the user may want to resume). */
	readonly hasChatHistory: boolean;
	/** The user's persisted manual open/collapse choice (their choice wins over the quiet default). */
	readonly manualChoice: ReviewRailManualChoice;
}

/**
 * Decide whether the review rail should be OPEN when the editor surface is entered for a document
 * (plan 42 slice L4). Precedence, in order:
 *
 * 1. A pending review FORCES the rail open - the agent-edit trust grammar is untouchable, so a pending
 *    proposal is never hidden, even against a manual "collapsed" choice.
 * 2. Otherwise the user's manual choice wins: if they have opened or collapsed the rail while editing,
 *    that choice is honoured on entry (and persists across restart).
 * 3. Otherwise the rail opens only when it has "something to say": the document has chat history. A plain
 *    doc with no pending review and no chat history opens quiet - editor + left rail only.
 *
 * Returns true to open the rail, false to leave it collapsed.
 */
export function decideReviewRailOpenOnEntry(context: IReviewRailEntryContext): boolean {
	// 1. Trust grammar: a pending proposal always forces the rail open, overriding any manual collapse.
	if (context.hasPendingReview) {
		return true;
	}
	// 2. The user's manual choice wins over the quiet default (persisted across restart).
	if (context.manualChoice === ReviewRailManualChoice.Open) {
		return true;
	}
	if (context.manualChoice === ReviewRailManualChoice.Collapsed) {
		return false;
	}
	// 3. No manual choice yet: open only when the rail has something to say (existing chat history).
	return context.hasChatHistory;
}
