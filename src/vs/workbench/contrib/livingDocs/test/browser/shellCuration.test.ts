/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ABSTRACT_COMMAND_CATEGORY, PALETTE_KEEP_COMMANDS, PaletteShadowBookkeeping, shouldShadowPaletteCommand } from '../../common/shellCuration.js';

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

	// Regression for the CodeRabbit "duplicate palette entries after the first re-apply" finding (#260, #263): the
	// in-place shadow pass is idempotent - on a re-apply it SKIPS an already-shadowed explicit item before it can
	// re-record that item's id. If the explicit-shadowed tracking were a per-call local, the implicit loop would then
	// append a fresh duplicate for that command, and it would show twice once "All Commands" lifts the gate. This test
	// simulates the two `_curatePalette` passes that `onDidChangeMenu` triggers and asserts no duplicate is appended.
	test('convergence: an already-shadowed explicit command is never re-appended as an implicit duplicate on re-apply', () => {
		const book = new PaletteShadowBookkeeping();

		// A stock command that HAS a real explicit palette item (shadowed in place) and one that is implicit-only.
		const explicitId = 'workbench.action.toggleDevTools';
		const implicitId = 'workbench.action.openSettings';

		// One curation pass, faithful to the contribution: the in-place mutation pass records an explicit id ONLY when
		// it actually shadows the item this pass (i.e. it was not already shadowed - the idempotency skip), then the
		// implicit loop appends for every shadow-worthy command it has not already accounted for.
		const runPass = (explicitFiresCallback: boolean): string[] => {
			if (explicitFiresCallback) {
				book.markExplicitShadowed(explicitId);
			}
			const appendedThisPass: string[] = [];
			for (const id of [explicitId, implicitId]) {
				if (!book.shouldAppendImplicit(id) || !shouldShadowPaletteCommand(undefined, id)) {
					continue;
				}
				book.markAppended(id);
				appendedThisPass.push(id);
			}
			return appendedThisPass;
		};

		// Pass 1: the explicit item is shadowed in place now (callback fires); only the implicit-only command is appended.
		// Pass 2 (the onDidChangeMenu re-apply): the explicit item is ALREADY shadowed, so its callback does NOT fire -
		// the bug would let the implicit loop append a duplicate for it. Nothing should be appended on pass 2.
		assert.deepStrictEqual(
			{ pass1: runPass(true), pass2: runPass(false) },
			{ pass1: [implicitId], pass2: [] }
		);
	});
});
