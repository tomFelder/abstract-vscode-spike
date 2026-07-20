/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decideReviewRailOpenOnEntry, IReviewRailEntryContext, ReviewRailManualChoice } from '../../common/railVisibility.js';

suite('LivingDoc review-rail quiet-shell entry (plan 42 L4)', () => {

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

	test('a pending review forces the rail open (trust grammar: never hide a proposal)', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasPendingReview: true })), true);
	});

	test('a pending review overrides a stored manual collapse (the proposal still shows)', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasPendingReview: true, manualChoice: ReviewRailManualChoice.Collapsed })), true);
	});

	test('a manual "open" choice wins over the quiet default', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ manualChoice: ReviewRailManualChoice.Open })), true);
	});

	test('a manual "collapse" choice keeps the rail collapsed even when it has chat history', () => {
		assert.deepStrictEqual(decideReviewRailOpenOnEntry(ctx({ hasChatHistory: true, manualChoice: ReviewRailManualChoice.Collapsed })), false);
	});
});
