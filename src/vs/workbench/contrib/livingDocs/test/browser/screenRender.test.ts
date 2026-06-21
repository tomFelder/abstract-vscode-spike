/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IScreenState, renderScreenHtml, ScreenId } from '../../browser/screenRender.js';

suite('livingDocs screenRender', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const state: IScreenState = { knScope: 'org', agents: [], filter: 'all' };

	// Every main-area screen carries the comp's global top bar: brand + per-screen crumb on the left,
	// the sync-status pill + Present + the user avatar on the right.
	const screens: { id: ScreenId; crumb: string }[] = [
		{ id: 'home', crumb: 'Home' },
		{ id: 'templates', crumb: 'Templates' },
		{ id: 'knowledge', crumb: 'Knowledge' },
		{ id: 'agents', crumb: 'Agents' },
	];

	for (const { id, crumb } of screens) {
		test(`${id} renders the global top bar (brand, ${crumb} crumb, sync pill, Present, avatar)`, () => {
			const html = renderScreenHtml(id, state);
			const head = html.indexOf('class="topbar"');
			assert.ok(head >= 0, 'has a top bar');
			// The top bar precedes the screen content (it is the first flex child of .screen).
			assert.ok(head < html.indexOf('class="scr-body"') || html.indexOf('class="scr-body"') === -1, 'top bar is above the body');
			assert.ok(html.includes('Opportunity OS'), 'shows the product brand');
			assert.ok(html.includes(`class="crumb">${crumb}<`), `crumb reads ${crumb}`);
			assert.ok(html.includes('All sources synced'), 'shows the sync-status pill');
			assert.ok(/data-msg="present"[^>]*class="tb-present"|class="tb-present"[^>]*data-msg="present"/.test(html), 'has a Present control wired to the present message');
			assert.ok(html.includes('class="av">TS<'), 'shows the user avatar');
		});
	}

	test('exactly one top bar is rendered per screen', () => {
		for (const { id } of screens) {
			const html = renderScreenHtml(id, state);
			assert.strictEqual(html.split('class="topbar"').length - 1, 1, `${id} has a single top bar`);
		}
	});
});
