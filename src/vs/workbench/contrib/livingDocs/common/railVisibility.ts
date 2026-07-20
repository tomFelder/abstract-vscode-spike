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

/**
 * The ways the review rail's visibility can change while the user is on the editor surface (plan 42 slice
 * L4). The RECORDING layer classifies each of these peek-vs-choice.
 */
export const enum RailGesture {
	/**
	 * A reveal driven by ILivingDocsService.focusPanel(): the slim edge AI-door affordance, an AI
	 * invocation, the L2 held-prompt choice, or a proposal arriving. This is a PEEK, not a decision.
	 */
	Peek = 'peek',
	/** The rail's own calm collapse control was activated: an explicit user gesture to leave the rail. */
	CollapseControl = 'collapse-control',
}

/**
 * The manual choice (if any) a rail-visibility gesture should RECORD (plan 42 slice L4, fix-round for
 * defect 1). The design rule: only an explicit collapse/expand gesture on the rail itself records a
 * choice; every focusPanel-driven reveal is a peek and records nothing. After the fix the ONLY recorder is
 * the calm collapse control, which records `collapsed`; no UI gesture records `open` (that is acceptable -
 * precedence still honours a stored `collapsed`, and the has-something-to-say default covers auto-open).
 *
 * Returns the choice to persist, or `undefined` when the gesture records nothing.
 */
export function recordedChoiceForRailGesture(gesture: RailGesture): ReviewRailManualChoice | undefined {
	switch (gesture) {
		case RailGesture.Peek:
			return undefined;
		case RailGesture.CollapseControl:
			return ReviewRailManualChoice.Collapsed;
	}
}
