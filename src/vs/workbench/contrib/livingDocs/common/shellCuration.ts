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

/**
 * Persistent bookkeeping for the two ways a stock palette command is demoted, tracked across the repeated
 * `_curatePalette()` re-applies that `MenuRegistry.onDidChangeMenu` triggers (many stock/palette entries register
 * after this contribution, so curation runs many times, not once). Two id sets that MUST both survive re-applies:
 *
 * - {@link markExplicitShadowed}: a command whose REAL explicit palette item was hidden in place (its `when` mutated).
 * - {@link markAppended}: a command with no real explicit item, for which we APPENDED our own gated shadow item.
 *
 * The convergence bug this guards against: the in-place mutation pass is idempotent and skips an already-shadowed
 * item BEFORE it can re-record that item's id. If the explicit-shadowed ids were only a per-call local, then on every
 * re-apply after the first, an already-shadowed explicit command would be missing from that call's set, and the
 * implicit loop would append a brand-new duplicate gated item for it - so once "All Commands" lifts the gate the
 * command shows TWICE. Persisting both sets here keeps {@link shouldAppendImplicit} convergent across re-applies.
 */
export class PaletteShadowBookkeeping {
	/** Ids of stock commands whose real explicit palette item we hid in place. Persists across re-applies. */
	private readonly _explicitShadowedIds = new Set<string>();
	/** Ids of stock commands for which we appended our own gated implicit-shadow item. Persists across re-applies. */
	private readonly _appendedIds = new Set<string>();

	/** Record that the real explicit item for `id` was shadowed in place, so the implicit loop never re-appends for it. */
	markExplicitShadowed(id: string): void {
		this._explicitShadowedIds.add(id);
	}

	/** Record that we appended a gated implicit-shadow item for `id`, so a later re-apply never double-appends. */
	markAppended(id: string): void {
		this._appendedIds.add(id);
	}

	/**
	 * True when the implicit-command loop should append a fresh gated shadow item for `id`: only when we have neither
	 * already appended one for it nor shadowed its real explicit item in place. False keeps the palette convergent
	 * (no duplicate) across re-applies.
	 */
	shouldAppendImplicit(id: string): boolean {
		return !this._appendedIds.has(id) && !this._explicitShadowedIds.has(id);
	}
}
