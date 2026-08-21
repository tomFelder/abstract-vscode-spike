/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { agentPolicyTable, agentPolicyToLevel, coerceAgentPolicyFromLevel } from '../../common/agentPolicyGrammar.js';

// The legacy-agent-dial -> three-tier grammar bridge (plan 49-b A2.2). The registry stores one legacy dial
// per agent; the Editor v2 speaks one three-tier grammar. These tests pin the honest map: every dial resolves
// to a table of exactly the three tiers (no fourth state), draft-only and ask-before-apply read the same
// (the grammar cannot distinguish "drafts" from "waits"), and the level -> dial write path is reversible onto
// a known dial the router already reads. The labels below are the comp-3a VERB phrases the table has shipped
// with since #241 ("Update figures & dates", not "Figures & dates"): the card is headed "WITHOUT ASKING, IT
// MAY", so each row has to complete that sentence (agentPolicyGrammar.ts:46-49).
suite('Agent policy grammar bridge (plan 49-b A2.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('auto-figures resolves to auto-apply figures, ask-first meaning, never structure', () => {
		assert.deepStrictEqual(agentPolicyTable('auto-figures'), [
			{ label: 'Update figures & dates', level: 'auto-apply' },
			{ label: 'Change meaning', level: 'ask-first' },
			{ label: 'Restructure', level: 'never' },
		]);
	});

	test('ask-before-apply and draft-only read identically (nothing auto-applies; no fourth display state)', () => {
		const askFirst = agentPolicyTable('ask-before-apply');
		assert.deepStrictEqual(askFirst, agentPolicyTable('draft-only'), 'the two non-auto dials collapse onto the same three-tier table');
		assert.deepStrictEqual(askFirst, [
			{ label: 'Update figures & dates', level: 'ask-first' },
			{ label: 'Change meaning', level: 'ask-first' },
			{ label: 'Restructure', level: 'never' },
		]);
	});

	test('the whole-agent level is auto-apply only for auto-figures, ask-first otherwise', () => {
		assert.deepStrictEqual(
			(['auto-figures', 'ask-before-apply', 'draft-only'] as const).map(agentPolicyToLevel),
			['auto-apply', 'ask-first', 'ask-first']);
	});

	test('a chosen level maps back onto a known legacy dial reversibly (no undefined state)', () => {
		assert.deepStrictEqual(
			(['auto-apply', 'ask-first', 'never'] as const).map(coerceAgentPolicyFromLevel),
			['auto-figures', 'ask-before-apply', 'draft-only']);
	});
});
