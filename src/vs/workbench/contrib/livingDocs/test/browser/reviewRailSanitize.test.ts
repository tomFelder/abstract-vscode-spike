/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { historyHtml } from '../../browser/historyRender.js';
import { REVIEW_RAIL_HTML_SANITIZER } from '../../browser/reviewRailView.js';

// Issue #168: the History body and the Document-Agents disclosure were assigned via raw `innerHTML`, which
// VS Code's Trusted Types CSP blocks, so both rendered blank at runtime. They now route through
// `safeSetInnerHtml` with a config that augments the allow-list with `<button>` and `style` (the entire
// visual language of these builders). This guards that the CSP-safe path preserves the interactive surface:
// the `<button>` elements, their inline `style=`, and the `data-*` hooks the click delegation reads. The test
// loads the REAL production config (`REVIEW_RAIL_HTML_SANITIZER`) so it stays load-bearing against future changes.
suite('livingDocs review rail Trusted-HTML sanitize (#168)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const NOW = Date.parse('2026-07-06T12:00:00.000Z');
	const SANITIZER = REVIEW_RAIL_HTML_SANITIZER;

	test('the History body survives sanitize with its buttons, inline styles and data-* click hooks intact', () => {
		const html = historyHtml(
			[{ id: 'restore-me', label: 'Before board edits', at: '2026-07-06T11:00:00.000Z', via: 'manual', body: '# Doc', auditIndex: 0 }],
			[{ time: '2026-07-06T11:30:00.000Z', docTitle: 'Weekly Summary', blockId: 'commentary', action: 'approved', oldText: 'a', newText: 'b', via: 'model' }],
			'Weekly Summary',
			undefined,
			NOW,
		);
		const node = $('div');
		safeSetInnerHtml(node, html, SANITIZER);

		assert.deepStrictEqual({
			saveVersion: node.querySelectorAll('button[data-save-version]').length,
			restoreId: node.querySelector('button[data-restore]')?.getAttribute('data-restore'),
			wrongHooks: node.querySelectorAll('[data-wrong]').length,
			// A styled node proves inline `style=` was not stripped (it drives the whole visual language).
			styledNodes: node.querySelectorAll('[style]').length > 0,
			// The escaped user content (the doc title) is rendered as text, not blanked.
			hasTitle: node.textContent!.includes('WEEKLY SUMMARY'),
		}, {
			saveVersion: 1,
			restoreId: 'restore-me',
			wrongHooks: 1,
			styledNodes: true,
			hasTitle: true,
		});
	});
});
