/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decideReviewRailOpenOnEntry, IReviewRailEntryContext, RailGesture, recordedChoiceForRailGesture, reviewRailManualChoiceFromPersistedCollapse, ReviewRailManualChoice, treeRailHiddenOnEntry } from '../../common/railVisibility.js';

suite('livingDocs review-rail quiet-shell entry (plan 42 L4)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// A quiet default context: no pending review, no chat history, no manual choice. Each test overrides
	// only the fact under test, so the precedence rules read as a single snapshot-style assertion each.
	const ctx = (over: Partial<IReviewRailEntryContext> = {}): IReviewRailEntryContext => ({
		hasPendingReview: false,
		hasChatHistory: false,
		manualChoice: ReviewRailManualChoice.None,
		...over,
	});

	test('a plain doc with nothing to say opens quiet (review rail collapsed)', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx()), false);
	});

	test('chat history for the doc opens the rail (has something to say)', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasChatHistory: true })), true);
	});

	test('a pending review opens the rail on first look (no manual choice yet)', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasPendingReview: true })), true);
	});

	test('a stored manual collapse is respected even with a pending proposal (the badge dot surfaces it - P2.5)', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasPendingReview: true, manualChoice: ReviewRailManualChoice.Collapsed })), false);
	});

	test('a manual "open" choice wins over the quiet default', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ manualChoice: ReviewRailManualChoice.Open })), true);
	});

	test('a manual "collapse" choice keeps the rail collapsed even when it has chat history', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasChatHistory: true, manualChoice: ReviewRailManualChoice.Collapsed })), false);
	});

	// The recording rule (plan 42 slice L4, fix-round for defect 1): only an explicit gesture on the rail
	// records a manual choice; every focusPanel-driven reveal (AI door affordance, AI invocation, held
	// prompt, proposal arrival) is a peek and records nothing. The sole recorder is the calm collapse
	// control, which records `collapsed`; after the fix NO gesture records `open`.
	test('the recording rule: a focusPanel peek records nothing, the collapse control records "collapsed"', () => {
		assert.deepStrictEqual(
			{
				peek: recordedChoiceForRailGesture(RailGesture.Peek),
				collapseControl: recordedChoiceForRailGesture(RailGesture.CollapseControl),
			},
			{
				peek: undefined,
				collapseControl: ReviewRailManualChoice.Collapsed,
			});
	});

	// Per-workspace collapse persistence (plan 44-b P2.4, keys `livingDocs.v2.treeRailCollapsed` /
	// `livingDocs.v2.rightRailCollapsed`). The right rail's stored boolean is the single source of truth for
	// the user's explicit choice: unset -> the quiet-shell default applies; true/false -> honoured on entry.
	test('the persisted right-rail collapse boolean maps onto the review-rail manual choice tri-state', () => {
		assert.deepStrictEqual(
			{
				unset: reviewRailManualChoiceFromPersistedCollapse(undefined),
				collapsed: reviewRailManualChoiceFromPersistedCollapse(true),
				open: reviewRailManualChoiceFromPersistedCollapse(false),
			},
			{
				unset: ReviewRailManualChoice.None,
				collapsed: ReviewRailManualChoice.Collapsed,
				open: ReviewRailManualChoice.Open,
			});
	});

	// The tree rail has no quiet-shell default: it opens on entry unless the user has explicitly collapsed it.
	test('the tree rail hides on entry only when the persisted collapse flag is true', () => {
		assert.deepStrictEqual(
			{
				unset: treeRailHiddenOnEntry(undefined),
				collapsed: treeRailHiddenOnEntry(true),
				open: treeRailHiddenOnEntry(false),
			},
			{
				unset: false,
				collapsed: true,
				open: false,
			});
	});
});
