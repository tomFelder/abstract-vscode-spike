/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ABSTRACT_COMMAND_CATEGORY, PALETTE_KEEP_COMMANDS, shouldShadowPaletteCommand } from '../../common/shellCuration.js';

suite('Calm-shell command-palette curation (WP-I, V-2)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('Abstract-led first screen: fork commands stay, the stock developer wall is demoted, the useful keep-list stays', () => {
		// One row per palette entry class the audit flagged, snapshotting the shadow decision.
		const cases = [
			// Abstract (fork) commands - kept regardless of id.
			{ category: ABSTRACT_COMMAND_CATEGORY, id: 'livingDocs.open.settings' },
			{ category: ABSTRACT_COMMAND_CATEGORY, id: 'livingDocs.open.editor' },
			{ category: ABSTRACT_COMMAND_CATEGORY, id: 'livingDocs.palette.allCommands' },
			// The stock developer wall the audit named - demoted.
			{ category: 'Developer', id: 'workbench.action.toggleDevTools' },
			{ category: 'Debug', id: 'editor.debug.action.addFunctionBreakpoint' },
			{ category: 'Authentication', id: 'noAuthenticationProviders' },
			{ category: undefined, id: 'workbench.action.openSettings' },
			// The genuinely useful keep-list - kept even though stock.
			...[...PALETTE_KEEP_COMMANDS].map(id => ({ category: undefined, id })),
		];
		const decision = cases.map(c => ({ id: c.id, shadowed: shouldShadowPaletteCommand(c.category, c.id) }));
		assert.deepStrictEqual(decision, [
			{ id: 'livingDocs.open.settings', shadowed: false },
			{ id: 'livingDocs.open.editor', shadowed: false },
			{ id: 'livingDocs.palette.allCommands', shadowed: false },
			{ id: 'workbench.action.toggleDevTools', shadowed: true },
			{ id: 'editor.debug.action.addFunctionBreakpoint', shadowed: true },
			{ id: 'noAuthenticationProviders', shadowed: true },
			{ id: 'workbench.action.openSettings', shadowed: true },
			{ id: 'undo', shadowed: false },
			{ id: 'redo', shadowed: false },
			{ id: 'editor.action.clipboardCutAction', shadowed: false },
			{ id: 'editor.action.clipboardCopyAction', shadowed: false },
			{ id: 'editor.action.clipboardPasteAction', shadowed: false },
			{ id: 'actions.find', shadowed: false },
			{ id: 'editor.action.startFindReplaceAction', shadowed: false },
			{ id: 'workbench.action.files.save', shadowed: false },
			{ id: 'workbench.action.files.saveAll', shadowed: false },
		]);
	});
});
