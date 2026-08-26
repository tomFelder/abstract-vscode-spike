/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The rail-entry decisions (plan 42 slice L4, revised by issue #363). This is the PURE core of the rules
// the RailVisibilityContribution executes when the editor surface is entered for a document: should the
// review rail (the AUXILIARYBAR_PART, carrying Chat / Review / History) start OPEN or COLLAPSED, and what
// should a visibility change of that part do? Keeping the decisions here (no DOM, no service, no wall
// clock) means the contracts are unit-tested directly, without driving the workbench.
//
// Issue #363 retired the old "quiet shell" default. This is an AI-native product: the chat/review rail is
// the primary surface, so on a TRUE first run - no persisted choice for this workspace - it opens. What
// the user does next still wins: an explicit collapse is persisted and honoured on every later entry.

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
 * The facts the entry decision reads. After issue #363 the only fact that matters is whether the user has
 * already made an explicit choice for this workspace: everything else - a pending proposal, prior chat
 * history - no longer changes the answer, because the rail now opens by default either way.
 */
export interface IReviewRailEntryContext {
	/** The user's persisted manual open/collapse choice, or `None` on a true first run. */
	readonly manualChoice: ReviewRailManualChoice;
}

/**
 * Decide whether the review rail should be OPEN when the editor surface is entered for a document
 * (plan 42 slice L4, revised by plan 44-b P2.5 and again by issue #363):
 *
 * 1. An explicit manual COLLAPSE wins: once the user has closed the rail while editing, it stays closed on
 *    every later entry and across restart. A pending proposal does not yank it back open - the 8px amber
 *    badge dot on the right rail toggle surfaces it instead (plan 44-b P2.5).
 * 2. Otherwise the rail is OPEN. That covers both an explicit manual open and the true first run, where
 *    nothing is persisted: the chat/review rail is this product's primary surface and must not have to be
 *    discovered (issue #363, replacing the old has-something-to-say "quiet shell" default).
 *
 * Returns true to open the rail, false to leave it collapsed.
 */
export function decideReviewRailOpenOnEntry(context: IReviewRailEntryContext): boolean {
	return context.manualChoice !== ReviewRailManualChoice.Collapsed;
}

/** What a review-rail (auxiliary bar) visibility change should cause, decided purely (issue #353). */
export interface IReviewRailVisibilityEffects {
	/**
	 * Seed the rail's 392px default width. True on EVERY open, programmatic or not - a part's size cannot
	 * be set while it is hidden, so the open event is the only moment the default can land. The
	 * once-per-profile guard lives in the contribution, so a width the user has since dragged is never
	 * re-pinned (issue #173).
	 */
	readonly seedWidth: boolean;
	/**
	 * The collapse state to persist as the user's manual choice, or `undefined` when the change records
	 * nothing (a programmatic toggle - our own entry sync, or a focusPanel peek - is not a decision).
	 */
	readonly recordCollapsed: boolean | undefined;
}

/**
 * Decide what a review-rail visibility change does (issue #353). The two effects are INDEPENDENT, and
 * conflating them was the bug: the contribution returned early on the programmatic path before seeding the
 * width, so the app's own one-click affordance opened the rail at the workbench fallback
 * (`Math.min(300, width / 4)` - a ~239px clip box at 1440x900) and the 392px design width never applied.
 * The programmatic guard exists to stop a peek being MISTAKEN FOR A CHOICE; it was never a reason to leave
 * the rail unsized.
 *
 * @param visible whether the part became visible.
 * @param programmatic whether this contribution (or a guarded focusPanel peek) caused the change.
 */
export function reviewRailVisibilityEffects(visible: boolean, programmatic: boolean): IReviewRailVisibilityEffects {
	return {
		seedWidth: visible,
		recordCollapsed: programmatic ? undefined : !visible,
	};
}

/**
 * Map the per-workspace `livingDocs.v2.rightRailCollapsed` value (plan 43 section 3.5) onto the review
 * rail's manual-choice tri-state. The storage key is the single source of truth for the user's explicit
 * open/collapse choice on the right rail (plan 44-b fix-round 2, reconciling the old
 * `reviewRailManualChoice` key): an UNSET key means the user has not chosen, so this is a true first run
 * and the open-by-default rule applies; `true` records an explicit collapse; `false` an explicit open.
 *
 * @param persistedCollapsed the stored boolean, or `undefined` when the key has never been written.
 */
export function reviewRailManualChoiceFromPersistedCollapse(persistedCollapsed: boolean | undefined): ReviewRailManualChoice {
	if (persistedCollapsed === undefined) {
		return ReviewRailManualChoice.None;
	}
	return persistedCollapsed ? ReviewRailManualChoice.Collapsed : ReviewRailManualChoice.Open;
}

/**
 * Decide whether the TREE rail (the left SIDEBAR part) should be HIDDEN when the editor surface is
 * entered for a document (plan 44-b P2.4). Unlike the right rail there is no quiet-shell default: the
 * tree rail simply opens by default and stays collapsed only when the user has explicitly collapsed it,
 * persisted per-workspace under `livingDocs.v2.treeRailCollapsed`.
 *
 * @param persistedCollapsed the stored boolean, or `undefined` when the key has never been written.
 */
export function treeRailHiddenOnEntry(persistedCollapsed: boolean | undefined): boolean {
	return persistedCollapsed === true;
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
 * precedence still honours a stored `collapsed`, and every other case now opens by default, issue #363).
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
