/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decideReviewRailOpenOnEntry, RailGesture, recordedChoiceForRailGesture, reviewRailManualChoiceFromPersistedCollapse, ReviewRailManualChoice, reviewRailVisibilityEffects, treeRailHiddenOnEntry } from '../../common/railVisibility.js';

suite('livingDocs review-rail entry (plan 42 L4, issue #363)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// The first-run default and the respect-the-user rule, driven through the REAL production chain: the
	// per-workspace `livingDocs.v2.rightRailCollapsed` value -> the manual-choice tri-state -> the open
	// decision. `undefined` is what IStorageService.getBoolean returns when the key has never been written,
	// i.e. a true first run, and issue #363 says the rail must be OPEN there - it is this product's primary
	// surface, not something to discover. Everything after that is the user's call: a persisted collapse
	// keeps it closed across restarts, a persisted open keeps it open.
	test('the review rail opens on a true first run (nothing persisted) and honours the user\'s choice thereafter (issue #363)', () => {
		const openForStoredValue = (persistedCollapsed: boolean | undefined): boolean =>
			decideReviewRailOpenOnEntry({ manualChoice: reviewRailManualChoiceFromPersistedCollapse(persistedCollapsed) });
		assert.deepStrictEqual(
			{
				firstRun: openForStoredValue(undefined),
				userCollapsed: openForStoredValue(true),
				userOpened: openForStoredValue(false),
			},
			{
				firstRun: true,       // no persisted state -> the rail opens by default
				userCollapsed: false, // the user closed it -> it stays closed, across restarts
				userOpened: true,     // the user opened it -> it stays open
			});
	});

	// #353's exact repro. The app's one-click AI-door affordance opens the rail through focusPanel(), which
	// this contribution flags as a PEEK so it is not recorded as a manual choice. That guard used to return
	// early ahead of the width seed, so the 392px default never landed and stock VS Code sized the rail at
	// Math.min(300, width / 4) - a ~239px clip box at 1440x900. Seeding and recording are now independent:
	// EVERY open seeds, only a non-programmatic change records.
	test('a programmatic open still seeds the default width, and records no manual choice (issue #353)', () => {
		assert.deepStrictEqual(
			{
				programmaticOpen: reviewRailVisibilityEffects(true, true),
				programmaticClose: reviewRailVisibilityEffects(false, true),
				userOpen: reviewRailVisibilityEffects(true, false),
				userClose: reviewRailVisibilityEffects(false, false),
			},
			{
				programmaticOpen: { seedWidth: true, recordCollapsed: undefined },
				programmaticClose: { seedWidth: false, recordCollapsed: undefined },
				userOpen: { seedWidth: true, recordCollapsed: false },
				userClose: { seedWidth: false, recordCollapsed: true },
			});
	});

	// The recording rule (plan 42 slice L4, fix-round for defect 1): only an explicit gesture on the rail
	// records a manual choice; every focusPanel-driven reveal (AI door affordance, AI invocation, held
	// prompt, change arrival) is a peek and records nothing. The sole recorder is the calm collapse
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
	// the user's explicit choice: unset -> a true first run; true/false -> honoured on entry.
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

	// The tree rail opens on entry unless the user has explicitly collapsed it (the same rule the right rail
	// now follows too, issue #363).
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
