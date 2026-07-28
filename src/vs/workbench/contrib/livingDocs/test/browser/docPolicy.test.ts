/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { coerceDocPolicy, defaultDocPolicy, DOC_AUTONOMY_LEVELS, docPolicyAuthored, docPolicyOption, docPolicyToneHex, effectiveDocPolicy } from '../../common/docPolicy.js';
import { renderPolicyEditor } from '../../browser/policyEditorRender.js';
import { renderPropertiesPanel } from '../../browser/propertiesPanelRender.js';

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

	test('docPolicyToneHex maps each tone to its exact spec colour', () => {
		assert.deepStrictEqual(
			DOC_AUTONOMY_LEVELS.map(o => docPolicyToneHex(o.tone)),
			['#2C8159', '#8A6D1A', '#B5514B']);
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
		assert.ok(html.includes('data-policy="never" style="--pol-tone:#B5514B"'));
		assert.strictEqual(renderPolicyEditor.CLICK_SELECTOR, '[data-policy]');
	});

	// The display rule the figure pipeline enforces: only an EXPLICIT dial changes behaviour, so an unauthored
	// document is `auto-apply` (its real behaviour), not the coerced `ask-first` middle the dial used to show.
	test('effectiveDocPolicy reports what is really in effect, and docPolicyAuthored who chose it', () => {
		assert.deepStrictEqual(
			['auto-apply', 'ask-first', 'never', 'nonsense', ' ', '', undefined]
				.map(raw => ({ level: effectiveDocPolicy(raw), authored: docPolicyAuthored(raw) })),
			[
				{ level: 'auto-apply', authored: true },
				{ level: 'ask-first', authored: true },
				{ level: 'never', authored: true },
				// A hand-edited typo IS an authored value and coerces exactly as the enforcement does, so the dial
				// and the pipeline still agree.
				{ level: 'ask-first', authored: true },
				{ level: 'auto-apply', authored: false },
				{ level: 'auto-apply', authored: false },
				{ level: 'auto-apply', authored: false },
			]);
	});

	// An UN-DIALLED document must not have an unchosen level presented as the reader's own: the row in effect is
	// still marked (that IS what happens) but badged "Default" instead of ticked, with a hint naming the unset
	// state. The Agents cards, whose level always comes from the registry, pass no `unset` and are untouched.
	test('renderPolicyEditor badges the default instead of ticking it when no human has dialled the level', () => {
		const unset = renderPolicyEditor({ selected: 'auto-apply', name: 'doc-1', unset: true });
		const dialled = renderPolicyEditor({ selected: 'auto-apply', name: 'doc-1' });
		assert.deepStrictEqual(
			{
				unset: {
					marksTheEffectiveRow: (unset.match(/class="pol-opt on"/g) ?? []).length,
					badgesDefault: unset.includes('<span class="pol-default">Default</span>'),
					ticked: unset.includes('&#10003;'),
					saysUnset: /Not set for this document yet/.test(unset),
					flagged: unset.includes('data-policy-unset'),
				},
				dialled: {
					marksTheEffectiveRow: (dialled.match(/class="pol-opt on"/g) ?? []).length,
					badgesDefault: dialled.includes('pol-default'),
					ticked: dialled.includes('&#10003;'),
					saysUnset: /Not set for this document yet/.test(dialled),
					flagged: dialled.includes('data-policy-unset'),
				},
			},
			{
				unset: { marksTheEffectiveRow: 1, badgesDefault: true, ticked: false, saysUnset: true, flagged: true },
				dialled: { marksTheEffectiveRow: 1, badgesDefault: false, ticked: true, saysUnset: false, flagged: false },
			});
	});

	// The Properties panel is where a reader meets the dial, so it must carry the unauthored state through to the
	// shared control rather than quietly presenting the effective level as a choice.
	test('the Properties panel passes the unauthored state to the dial (the reader sees Default, not a choice)', () => {
		const panel = (policyAuthored: boolean) => renderPropertiesPanel({
			docId: 'doc-1', title: '', displayTitle: 'Weekly Summary', status: '', tags: [],
			boundSources: [], policy: 'auto-apply', policyAuthored,
		});
		assert.deepStrictEqual(
			{
				undialled: { badgesDefault: panel(false).includes('pol-default'), saysUnset: /Not set for this document yet/.test(panel(false)) },
				dialled: { badgesDefault: panel(true).includes('pol-default'), saysUnset: /Not set for this document yet/.test(panel(true)) },
			},
			{
				undialled: { badgesDefault: true, saysUnset: true },
				dialled: { badgesDefault: false, saysUnset: false },
			});
	});

	test('renderPolicyEditor escapes the control name (no markup injection)', () => {
		const html = renderPolicyEditor({ selected: 'ask-first', name: 'a"><b>' });
		assert.ok(!html.includes('<b>'), 'a hostile name is escaped, never emitted as markup');
	});
});
