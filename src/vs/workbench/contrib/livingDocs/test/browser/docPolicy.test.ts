/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { coerceDocPolicy, defaultDocPolicy, DOC_AUTONOMY_LEVELS, docPolicyOption, docPolicyToneHex } from '../../common/docPolicy.js';
import { renderPolicyEditor } from '../../browser/policyEditorRender.js';
import { AMBER, GREEN, RED } from '../../common/abstractTokens.js';

// The shared plain-language policy grammar + its browser renderer (plan 45 pin 12 / #122 F11, spec 43 section
// 3.4). These are the ONE source of truth reused verbatim by plan 49's agent cards, so the tests pin the
// contract: three levels in a fixed order, a safe default, tolerant coercion, exact tones, and a renderer that
// marks exactly the selected level and carries the delegation hooks a host binds to.
suite('Shared doc policy (plan 45 pin 12 / #122 F11)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the grammar is the three tiers in escalation order with their tones', () => {
		assert.deepStrictEqual(
			DOC_AUTONOMY_LEVELS.map(o => ({ level: o.level, tone: o.tone })),
			[
				{ level: 'auto-apply', tone: 'ok' },
				{ level: 'ask-first', tone: 'attention' },
				{ level: 'never', tone: 'removed' },
			]);
	});

	test('the default is the safe ask-first, and every level has plain-language text', () => {
		assert.strictEqual(defaultDocPolicy(), 'ask-first');
		assert.ok(DOC_AUTONOMY_LEVELS.every(o => o.label.length > 0 && o.description.length > 0));
	});

	test('coerceDocPolicy normalises known values and degrades unknown/absent to the default', () => {
		assert.deepStrictEqual(
			['auto-apply', 'ask-first', 'never', 'nonsense', '', undefined].map(coerceDocPolicy),
			['auto-apply', 'ask-first', 'never', 'ask-first', 'ask-first', 'ask-first']);
	});

	test('docPolicyToneHex maps each tone to its design-system colour', () => {
		// Asserted against the tokens rather than literals: the point of the rule is that a policy tier
		// speaks the SAME colour language as the rest of the product, so pinning a hex here would let the
		// two drift while the test still passed.
		assert.deepStrictEqual(
			DOC_AUTONOMY_LEVELS.map(o => docPolicyToneHex(o.tone)),
			[GREEN.base, AMBER.label, RED.diffInk]);
	});

	test('docPolicyOption never returns undefined', () => {
		assert.strictEqual(docPolicyOption('never').level, 'never');
	});

	test('renderPolicyEditor marks exactly the selected level and carries the delegation hooks', () => {
		const html = renderPolicyEditor({ selected: 'never', name: 'doc-1' });
		// The group carries its stable name; exactly one option is `on`; every level is a [data-policy] button.
		assert.ok(html.includes('data-policy-editor="doc-1"'));
		assert.strictEqual((html.match(/class="pol-opt on"/g) ?? []).length, 1);
		assert.strictEqual((html.match(/data-policy="/g) ?? []).length, DOC_AUTONOMY_LEVELS.length);
		// The selected option is the one whose data-policy is `never`, tinted with its removed tone.
		assert.ok(html.includes(`data-policy="never" style="--pol-tone:${RED.diffInk}"`));
		assert.strictEqual(renderPolicyEditor.CLICK_SELECTOR, '[data-policy]');
	});

	test('renderPolicyEditor escapes the control name (no markup injection)', () => {
		const html = renderPolicyEditor({ selected: 'ask-first', name: 'a"><b>' });
		assert.ok(!html.includes('<b>'), 'a hostile name is escaped, never emitted as markup');
	});
});
