/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelProviderStatus, ModelProvider, ModelReadiness } from '../../common/livingDocs.js';
import { ModelAccessGate, needsModelChoice } from '../../common/modelAccessGate.js';

// Plan 42 slice L2 (issue #198): the first-AI-use model-access gate. These prove the pending-prompt / inline-choice
// contract deterministically, with no model, broker, or DOM: the choice is gated ONLY on an unconfigured backend,
// and a held prompt is preserved verbatim and popped exactly once for replay so the typed prompt is never lost.

suite('livingDocs modelAccessGate (plan 42 L2, issue #198)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const status = (provider: ModelProvider, readiness: ModelReadiness, signedIn = false): IModelProviderStatus =>
		({ provider, readiness, signedIn, dailyBudgetUsd: 0 });

	test('needsModelChoice: gated only on no backend configured, never on a chosen door', () => {
		const cases = {
			// The first-AI-use moment: no door chosen yet - the broker has no backend wired or is not up.
			noneUnconfigured: needsModelChoice(status('none', 'unconfigured')),
			noneBrokerDown: needsModelChoice(status('none', 'broker-down')),
			// A door is already serving (or rate-capped): NOT the first-use choice - the existing paths handle it.
			includedReady: needsModelChoice(status('included', 'ready')),
			includedBudgetPaused: needsModelChoice(status('included', 'budget-paused')),
			chatgptReady: needsModelChoice(status('chatgpt', 'ready', true)),
		};
		assert.deepStrictEqual(cases, {
			noneUnconfigured: true,
			noneBrokerDown: true,
			includedReady: false,
			includedBudgetPaused: false,
			chatgptReady: false,
		});
	});

	test('hold, read, and take a prompt: the typed text is preserved and popped exactly once', () => {
		const gate = store.add(new ModelAccessGate());
		const doc = URI.parse('file:///a.md');
		const other = URI.parse('file:///b.md');

		gate.holdPrompt(doc, 'tighten the intro');

		const snapshot = {
			hasForDoc: gate.hasPending(doc),
			pendingForDoc: gate.getPending(doc),
			hasForOther: gate.hasPending(other),
			// Take pops it (so the inline choice disappears) and returns the exact held prompt for replay.
			taken: gate.takePending(doc),
			hasAfterTake: gate.hasPending(doc),
			takenAgain: gate.takePending(doc),
		};
		assert.deepStrictEqual(snapshot, {
			hasForDoc: true,
			pendingForDoc: { resource: doc, text: 'tighten the intro', displayText: undefined },
			hasForOther: false,
			taken: { resource: doc, text: 'tighten the intro', displayText: undefined },
			hasAfterTake: false,
			takenAgain: undefined,
		});
	});

	test('newest send wins, clear drops without replay, and every mutation fires onDidChangePending', () => {
		const gate = store.add(new ModelAccessGate());
		const doc = URI.parse('file:///a.md');
		let fired = 0;
		store.add(gate.onDidChangePending(() => fired++));

		gate.holdPrompt(doc, 'first draft');
		gate.holdPrompt(doc, 'second draft');   // re-send before choosing a door: latest text replaces
		const afterReplace = gate.getPending(doc)?.text;
		gate.clear(doc);                          // dismiss: drops it without replay
		const afterClear = gate.hasPending(doc);
		gate.clear(doc);                          // clearing an empty slot fires nothing

		assert.deepStrictEqual(
			{ afterReplace, afterClear, fired },
			{ afterReplace: 'second draft', afterClear: false, fired: 3 },
		);
	});
});
