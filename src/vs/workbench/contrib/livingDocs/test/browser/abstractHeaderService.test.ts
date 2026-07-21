/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AbstractHeaderService } from '../../browser/abstractHeaderService.js';
import { EMPTY_HEADER_CONTENT, HeaderPillKind, IAbstractHeaderContent } from '../../common/abstractHeader.js';

suite('livingDocs abstract header content service (plan 44-b)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('starts empty, then relays the published content and fires exactly once per publish', () => {
		const service = new AbstractHeaderService();
		let fires = 0;
		const sub = service.onDidChange(() => fires++);

		const initial = service.content;

		const editor: IAbstractHeaderContent = {
			breadcrumb: 'Weekly Summary',
			fileName: 'weekly-summary.md',
			pill: { kind: HeaderPillKind.Sync, label: 'All sources synced' },
			action: { label: '↗ Present', run: () => { } },
			showRailToggles: true,
		};
		service.setContent(editor);
		const afterEditor = service.content;

		const screen: IAbstractHeaderContent = { breadcrumb: 'Home', showRailToggles: false };
		service.setContent(screen);
		const afterScreen = service.content;

		assert.deepStrictEqual(
			{
				initialIsEmpty: initial === EMPTY_HEADER_CONTENT,
				afterEditorBreadcrumb: afterEditor.breadcrumb,
				afterEditorPill: afterEditor.pill?.kind,
				afterEditorToggles: afterEditor.showRailToggles,
				afterScreenBreadcrumb: afterScreen.breadcrumb,
				afterScreenPill: afterScreen.pill,
				afterScreenToggles: afterScreen.showRailToggles,
				fires,
			},
			{
				initialIsEmpty: true,
				afterEditorBreadcrumb: 'Weekly Summary',
				afterEditorPill: HeaderPillKind.Sync,
				afterEditorToggles: true,
				afterScreenBreadcrumb: 'Home',
				afterScreenPill: undefined,
				afterScreenToggles: false,
				fires: 2,
			});

		sub.dispose();
		service.dispose();
	});
});
