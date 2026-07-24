/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ONBOARDING_STEPS, OnboardingStep } from '../common/onboarding.js';

// The D26 walkthrough's cross-surface state (issues #254/#255). The onboarding SCREEN drives most of the funnel,
// but the provenance peek (wow one) happens in the DOCUMENT editor, which is a different pane the screen cannot
// reach. Both surfaces are lane-2 editor code, so the two profile-scoped keys and the tiny advance-on-peek rule
// live here as the single onboarding contract - rather than one pane reaching into the other's private storage.

/** The persisted current funnel step (profile scope), the source of truth for the onboarding card's progress. */
export const ONBOARDING_STEP_KEY = 'livingDocs.onboardingStep';
/** The persisted demo-document URI (profile scope): the stage where both wows are experienced in the editor. */
export const ONBOARDING_DEMO_KEY = 'livingDocs.onboardingDemoUri';

/** Read the persisted funnel step, defaulting to `open` when unset or unrecognised. */
export function readOnboardingStep(storage: IStorageService): OnboardingStep {
	const saved = storage.get(ONBOARDING_STEP_KEY, StorageScope.PROFILE) as OnboardingStep | undefined;
	return saved && (ONBOARDING_STEPS as readonly string[]).includes(saved) ? saved : 'open';
}

/** Persist the funnel step (profile scope, machine target). */
export function writeOnboardingStep(storage: IStorageService, step: OnboardingStep): void {
	storage.store(ONBOARDING_STEP_KEY, step, StorageScope.PROFILE, StorageTarget.MACHINE);
}

/**
 * Advance the walkthrough on a real provenance peek (#255): if a walkthrough is waiting at `provenance-peek`
 * (wow one pending) and the peek happened on the demo document, move the persisted step to `first-diff` so the
 * onboarding card reflects a peek that actually occurred. The funnel analytics event fires separately, at the
 * same real peek (LivingDocsService.notePeek), so the card and events.log agree. A no-op when there is no
 * walkthrough, no demo document, the peeked document is not the demo, or wow one is already complete. Returns
 * true when it advanced, so the caller can refresh a mounted onboarding card.
 */
export function advanceOnboardingOnPeek(storage: IStorageService, peekedDocUri: string | undefined): boolean {
	if (!peekedDocUri) { return false; }
	const demoUri = storage.get(ONBOARDING_DEMO_KEY, StorageScope.PROFILE);
	if (!demoUri || demoUri !== peekedDocUri) { return false; }
	if (readOnboardingStep(storage) !== 'provenance-peek') { return false; }
	writeOnboardingStep(storage, 'first-diff');
	return true;
}
