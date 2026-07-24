/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { advanceOnboardingOnPeek, ONBOARDING_DEMO_KEY, ONBOARDING_STEP_KEY, readOnboardingStep } from '../../browser/onboardingWalkthrough.js';

suite('LivingDoc onboarding walkthrough (D26 wow one, #255)', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function newStorage(): IStorageService {
		return store.add(new InMemoryStorageService());
	}

	function walkthrough(step: string, demoUri: string): IStorageService {
		const storage = newStorage();
		storage.store(ONBOARDING_STEP_KEY, step, StorageScope.PROFILE, StorageTarget.MACHINE);
		storage.store(ONBOARDING_DEMO_KEY, demoUri, StorageScope.PROFILE, StorageTarget.MACHINE);
		return storage;
	}

	test('a real peek on the demo doc while wow one is pending advances the card to first-diff', () => {
		const storage = walkthrough('provenance-peek', 'file:///demo/Demo%20Report.md');
		const advanced = advanceOnboardingOnPeek(storage, 'file:///demo/Demo%20Report.md');
		assert.deepStrictEqual(
			{ advanced, step: readOnboardingStep(storage) },
			{ advanced: true, step: 'first-diff' });
	});

	test('the peek must be on the demo doc, at the pending step, and inside a walkthrough (else no-op)', () => {
		const cases = [
			// A peek on some OTHER document does not complete wow one.
			{ storage: walkthrough('provenance-peek', 'file:///demo/Demo%20Report.md'), peeked: 'file:///other/Board%20Note.md' },
			// Wow one is already complete: a later peek must not rewind or re-fire.
			{ storage: walkthrough('first-diff', 'file:///demo/Demo%20Report.md'), peeked: 'file:///demo/Demo%20Report.md' },
			// No walkthrough at all (no persisted step -> defaults to `open`): a peek is just a normal peek.
			{ storage: newStorage(), peeked: 'file:///demo/Demo%20Report.md' },
			// A peek with no document reference is a no-op.
			{ storage: walkthrough('provenance-peek', 'file:///demo/Demo%20Report.md'), peeked: undefined },
		];
		assert.deepStrictEqual(
			cases.map(c => advanceOnboardingOnPeek(c.storage, c.peeked)),
			[false, false, false, false]);
	});
});
