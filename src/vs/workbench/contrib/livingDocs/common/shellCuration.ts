/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure decision logic for the calm-shell command-palette curation (issue #260, WP-I, V-2).
 *
 * The command palette's default view is curated by exclusion-with-allowlist: a stock entry is demoted (shadowed
 * behind the palette-advanced context key, reachable only via the explicit "All Commands" route) unless it is one
 * of ours (the Abstract command category) or a genuinely useful, writer-relevant editor command (the keep-list).
 *
 * Kept as a pure predicate here so the decision is unit-testable without the DOM / MenuRegistry: the browser
 * contribution (livingDocs.contribution.ts) feeds it each palette menu item's category + id.
 */

/**
 * The Abstract command category value. Every fork palette command sets this via `localize2('livingDocs.category',
 * "Abstract")`, so its untranslated `original` (and the English `value`) is "Abstract". Matched by value so the
 * palette curation survives localisation.
 */
export const ABSTRACT_COMMAND_CATEGORY = 'Abstract';

/**
 * The small set of genuinely useful, writer-relevant editor/workbench commands that stay in the calm palette default
 * view (undo/redo, clipboard, find, save). Everything else stock is demoted behind the palette-advanced key. Kept
 * intentionally minimal - the floor is "Abstract-led first screen", not "re-list the IDE".
 */
export const PALETTE_KEEP_COMMANDS: ReadonlySet<string> = new Set([
	'undo',
	'redo',
	'editor.action.clipboardCutAction',
	'editor.action.clipboardCopyAction',
	'editor.action.clipboardPasteAction',
	'actions.find',
	'editor.action.startFindReplaceAction',
	'workbench.action.files.save',
	'workbench.action.files.saveAll',
]);

/**
 * True when a command-palette entry is stock (not Abstract-categorised) and not in the keep-list, i.e. it should be
 * shadowed out of the calm palette default view. `category` is the resolved category value (or `undefined` for an
 * uncategorised command). `keepIds` defaults to {@link PALETTE_KEEP_COMMANDS}.
 */
export function shouldShadowPaletteCommand(category: string | undefined, id: string, keepIds: ReadonlySet<string> = PALETTE_KEEP_COMMANDS): boolean {
	if (category === ABSTRACT_COMMAND_CATEGORY) {
		return false;
	}
	return !keepIds.has(id);
}
