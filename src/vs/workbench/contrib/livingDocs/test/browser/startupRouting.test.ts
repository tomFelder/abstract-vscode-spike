/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StartupRoute, decideStartupRoute, StartupRouteKind } from '../../common/startupRouting.js';

suite('LivingDoc cold-start routing (plan 42 L1)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const doc = (name: string) => URI.file(`/w/${name}`);
	// Normalise the route to a plain snapshot: URI identity carries internal caches that differ between two
	// equal URIs, so compare on the resource STRING (a single snapshot-style assertion per the repo learnings).
	const snap = (route: StartupRoute) => route.kind === StartupRouteKind.OpenDocument
		? { kind: route.kind, resource: route.resource.toString() }
		: { kind: route.kind, hasFolder: route.hasFolder };

	test('with a folder, the most-recently-opened document wins when it is one of the folder docs', () => {
		const route = decideStartupRoute({
			hasFolder: true,
			lastActiveFile: doc('b.md'),
			folderDocuments: [doc('a.md'), doc('b.md'), doc('c.md')],
		});
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.OpenDocument, resource: doc('b.md').toString() });
	});

	test('a stale most-recent file (not in the folder) falls back to the first folder document', () => {
		const route = decideStartupRoute({
			hasFolder: true,
			lastActiveFile: doc('gone.md'),
			folderDocuments: [doc('a.md'), doc('b.md')],
		});
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.OpenDocument, resource: doc('a.md').toString() });
	});

	test('with a folder and no history, the first folder document opens', () => {
		const route = decideStartupRoute({
			hasFolder: true,
			lastActiveFile: undefined,
			folderDocuments: [doc('a.md'), doc('b.md')],
		});
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.OpenDocument, resource: doc('a.md').toString() });
	});

	test('a folder with no documents opens a new untitled Markdown doc (cursor placed, no wizard)', () => {
		const route = decideStartupRoute({ hasFolder: true, lastActiveFile: undefined, folderDocuments: [] });
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.NewUntitledDocument, hasFolder: true });
	});

	test('no folder open lands on a blank untitled Markdown doc, never a walkthrough', () => {
		const route = decideStartupRoute({ hasFolder: false, lastActiveFile: doc('x.md'), folderDocuments: [] });
		assert.deepStrictEqual(snap(route), { kind: StartupRouteKind.NewUntitledDocument, hasFolder: false });
	});
});
