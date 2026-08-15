/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { abstractTokenCss, AMBER, FONT, GREEN, HAIRLINE, INDIGO, INK, PAPER, RED, TYPE } from '../../common/abstractTokens.js';
import { ABSTRACT_FONT_FACE_CSS } from '../../common/abstractFont.js';

// The design system's own guarantees (docs/28-design-system-round2.md). These are not pixel assertions -
// they are the rules that make the system a system, and each one has already been broken once:
// the accent was defined twice and drifted, the mono was named but never shipped, and a tier reached for
// the wrong red. A rule with a test is a rule; a rule in a document is a hope.
suite('Abstract design system (round 2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the mono is bundled, not merely named - both weights inline as woff2', () => {
		// Round 1 declared 'JetBrains Mono' and shipped nothing, so the mono silently fell back to
		// ui-monospace for every reader who did not happen to have it installed. The @font-face must carry
		// real bytes, and it must reach the webviews, which cannot resolve a relative url().
		const faces = ABSTRACT_FONT_FACE_CSS.match(/@font-face\{/g) ?? [];
		assert.deepStrictEqual(
			{
				faces: faces.length,
				weights: (ABSTRACT_FONT_FACE_CSS.match(/font-weight:(\d+)/g) ?? []).sort(),
				inlined: (ABSTRACT_FONT_FACE_CSS.match(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\)/g) ?? []).length,
				named: ABSTRACT_FONT_FACE_CSS.includes(`font-family:'IBM Plex Mono'`),
				inTokenCss: abstractTokenCss().includes('@font-face'),
			},
			{ faces: 2, weights: ['font-weight:400', 'font-weight:600'], inlined: 2, named: true, inTokenCss: true },
		);
	});

	test('the mono stack leads with the bundled family, and the sans never claims to be it', () => {
		assert.deepStrictEqual(
			{ monoLeads: FONT.mono.startsWith(`'IBM Plex Mono'`), monoFallsBack: FONT.mono.includes('ui-monospace'), sansIsSystem: FONT.sans.includes('-apple-system') },
			{ monoLeads: true, monoFallsBack: true, sansIsSystem: true },
		);
	});

	test('every hue keeps exactly one meaning: green and red are never a fill a button could take', () => {
		// The rule the comp states outright. Green reports a settled state and red reports a failure; a
		// button is an invitation, so neither may ever be one. Only the indigo is a primary fill.
		assert.deepStrictEqual(
			{ primary: INDIGO.base, green: GREEN.base, amber: AMBER.base, red: RED.base },
			{ primary: '#4353C9', green: '#1F7A4D', amber: '#C77E1F', red: '#B3261E' },
		);
	});

	test('the neutrals are the cool slate ramp, nesting outward-in from canvas to card', () => {
		// The one deliberate departure from the comp, which draws the paper warm. Only the neutrals differ;
		// the meaning colours above are exactly the comp's. Each surface must be strictly lighter than the
		// one it sits on, or the depth model stops reading without shadows.
		const luma = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
		const ramp = [PAPER.canvas, PAPER.frame, PAPER.rail, PAPER.page, PAPER.card];
		assert.deepStrictEqual(
			{
				ramp,
				strictlyLightening: ramp.every((c, i) => i === 0 || luma(c) > luma(ramp[i - 1])),
				hairlines: [HAIRLINE.strong, HAIRLINE.medium, HAIRLINE.soft],
			},
			{
				ramp: ['#E3E6EC', '#ECEEF2', '#F5F6F8', '#FAFBFC', '#FFFFFF'],
				strictlyLightening: true,
				hairlines: ['#DFE2E8', '#E7E9EE', '#EDEFF2'],
			},
		);
	});

	test('the ink ramp is four steps that darken, and only four', () => {
		const luma = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
		const ramp = [INK.heading, INK.body, INK.secondary, INK.meta];
		assert.deepStrictEqual(
			{ ramp, strictlyLightening: ramp.every((c, i) => i === 0 || luma(c) > luma(ramp[i - 1])) },
			{ ramp: ['#1B1B20', '#34373D', '#676B74', '#9498A3'], strictlyLightening: true },
		);
	});

	test('the type ladder carries only weights 400 and 600, and mono only where mono is allowed', () => {
		// Mono is reserved for section labels, kind badges and provenance facts. Anything else claiming the
		// mono family is a step towards the "everything is code" look the product is trying not to have.
		const steps = Object.entries(TYPE);
		const monoSteps = steps.filter(([, v]) => v.includes('IBM Plex Mono')).map(([k]) => k).sort();
		assert.deepStrictEqual(
			{
				weightsUsed: [...new Set(steps.map(([, v]) => /^(\d+)/.exec(v)?.[1]))].sort(),
				monoSteps,
			},
			{
				weightsUsed: ['400', '600'],
				monoSteps: ['kindBadge', 'provenance', 'provenanceInline', 'sectionLabel', 'tableHeader'],
			},
		);
	});
});
