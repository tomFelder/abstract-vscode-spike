/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StartupRoute, decideStartupRoute, StartupRouteKind } from '../../common/startupRouting.js';

suite('LivingDoc cold-start routing (map-D2, WP-H)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const snap = (route: StartupRoute) => route.kind === StartupRouteKind.NewUntitledDocument
		? { kind: route.kind, hasFolder: route.hasFolder }
		: { kind: route.kind };

	test('a folder open (a project) lands on Project Home - the empty-project front door / populated dashboard is decided by Home from the live docs', () => {
		const route = decideStartupRoute({ hasFolder: true });
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.OpenHome });
	});

	test('no folder open lands on a blank untitled Markdown doc, never a walkthrough', () => {
		const route = decideStartupRoute({ hasFolder: false });
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.NewUntitledDocument, hasFolder: false });
	});
});
