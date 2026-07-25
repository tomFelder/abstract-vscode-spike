/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StartupRoute, decideStartupRoute, StartupRouteKind } from '../../common/startupRouting.js';

suite('LivingDoc cold-start routing (map-D2, WP-H, WP-I)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const snap = (route: StartupRoute) => ({ kind: route.kind, hasFolder: route.hasFolder });

	test('a folder open (a project) lands on Project Home - the empty-project front door / populated dashboard is decided by Home from the live docs', () => {
		const route = decideStartupRoute({ hasFolder: true });
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.OpenHome, hasFolder: true });
	});

	test('no folder open (a new window / Cmd+Shift+N) lands on Project Home\'s "Open a folder" front door, never the bare untitled editor (issue #260 leak 5)', () => {
		const route = decideStartupRoute({ hasFolder: false });
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.OpenHome, hasFolder: false });
	});
});
