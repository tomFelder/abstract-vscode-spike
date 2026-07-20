/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { docHasEarnedLiving, projectHasLivingSurface } from '../../common/livingUpgrade.js';

suite('livingDocs earned-upgrade rule (plan 42 L3)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const facts = (over: Partial<Parameters<typeof docHasEarnedLiving>[0]> = {}) => ({
		hasFrontmatterSources: false,
		hasFrontmatterContext: false,
		hasBindLinks: false,
		hasSiblingLock: false,
		...over,
	});

	test('a plain doc has NOT earned living; each upgrade trigger earns it', () => {
		// One snapshot over the whole truth table: plain Markdown stays plain, and any single trigger --
		// a bound source, bound context, an inline bind link, or a sibling lock -- earns living status.
		assert.deepStrictEqual({
			plain: docHasEarnedLiving(facts()),
			frontmatterSources: docHasEarnedLiving(facts({ hasFrontmatterSources: true })),
			frontmatterContext: docHasEarnedLiving(facts({ hasFrontmatterContext: true })),
			bindLinks: docHasEarnedLiving(facts({ hasBindLinks: true })),
			siblingLock: docHasEarnedLiving(facts({ hasSiblingLock: true })),
		}, {
			plain: false,
			frontmatterSources: true,
			frontmatterContext: true,
			bindLinks: true,
			siblingLock: true,
		});
	});

	test('the project has no living surface until a doc is living or a source is bound', () => {
		assert.deepStrictEqual({
			emptyProject: projectHasLivingSurface({}),
			plainDocsOnly: projectHasLivingSurface({ anyDocLiving: false, boundSourceCount: 0 }),
			oneLivingDoc: projectHasLivingSurface({ anyDocLiving: true, boundSourceCount: 0 }),
			oneBoundSource: projectHasLivingSurface({ anyDocLiving: false, boundSourceCount: 1 }),
		}, {
			emptyProject: false,
			plainDocsOnly: false,
			oneLivingDoc: true,
			oneBoundSource: true,
		});
	});
});
