/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The product-tab model (spec 43 section 3.2, owner: plan 45 / PR-b; consumers: plan 46 "Open to the right",
// plan 49 "row-click opens source tab").
//
// The contract in one paragraph: the product tab row is Abstract's own DOM, rendered in the editor pane host,
// one row per editor group. The tabs mirror the group's open editors, but the ORDER, the visible-label, the
// per-tab KIND (a document vs a source viewer) and the persisted set live in this pure model so the host DOM
// stays a dumb projection and the whole thing is unit-testable without a workbench. Each tab carries a durable
// `id` (the editor resource string) - persisted per-workspace per-group under `livingDocs.v2.tabs.<groupId>`
// (spec section 3.5) - so the set restores across reload. This module is DOM-free and service-free: it is the
// reducer the host and the service both drive.

/** The kind of surface a product tab shows: a living/plain document, or a source-viewer (grid-glyph) tab. */
export type TabKind = 'document' | 'source';

/** One product tab: its durable id (the editor resource string), display label, kind and status dot tone. */
export interface ITabModel {
	/** The durable identity of the tab - the editor input's resource `toString()`. Stable across reloads. */
	readonly id: string;
	/** The visible label (a document title, or a source file name). */
	readonly label: string;
	readonly kind: TabKind;
	/**
	 * The 6px status dot tone (spec pin 7 P7.2). `ok` = synced/clean, `attention` = changes waiting,
	 * `none` = no dot (a plain doc / a source with nothing to say). Only the active tab renders its dot.
	 */
	readonly dot: 'ok' | 'attention' | 'none';
	/**
	 * True while this tab is the group's PREVIEW tab (plan 52 WP-F): the ephemeral "I am only peeking" tab a
	 * single click in the Files tree opens, which the next single click REUSES instead of adding a tab. Rendered
	 * italic, exactly like VS Code's preview tab. Mirrors `IEditorGroup.isPinned(editor) === false` - the strip
	 * never owns this state, it projects the group's own preview slot (a group has at most one).
	 */
	readonly preview: boolean;
}

/** The whole tab strip for one editor group: the ordered tabs plus which one is active. */
export interface ITabStripModel {
	readonly tabs: readonly ITabModel[];
	/** The active tab's id, or undefined when the group is empty. */
	readonly activeId: string | undefined;
}

/** The empty strip - a group with no editors renders no tabs (and, per the split contract, closes itself). */
export const emptyTabStrip: ITabStripModel = { tabs: [], activeId: undefined };

/**
 * The count above which the strip stops growing and overflows into a horizontal-scroll + overflow menu
 * (spec pin 7 P7.6: "cap visible tabs ~8, then overflow menu"). Exported so the host and its tests agree.
 */
export const TAB_OVERFLOW_THRESHOLD = 8;

/** True when the strip has more tabs than fit before the overflow affordance is needed (spec P7.6). */
export function tabsOverflow(model: ITabStripModel): boolean {
	return model.tabs.length > TAB_OVERFLOW_THRESHOLD;
}

/**
 * The neighbour a close should activate (spec pin 7 P7.5: "closing the active tab activates its neighbour").
 * Returns the id of the tab that should become active AFTER `closeId` is removed, or `undefined` when the
 * strip would be left empty (the group then closes - the split contract, section 3.2). Only meaningful when
 * `closeId` is the currently active tab; closing an inactive tab never changes the active one, so callers pass
 * the current `activeId` back unchanged in that case. Prefers the RIGHT neighbour (the tab that slides into the
 * closed one's place), falling back to the left when the closed tab was last - matching native editor-group
 * focus-after-close so the two strips never disagree.
 */
export function neighbourAfterClose(model: ITabStripModel, closeId: string): string | undefined {
	const index = model.tabs.findIndex(t => t.id === closeId);
	if (index < 0) { return model.activeId; }
	if (model.tabs.length <= 1) { return undefined; }
	// Right neighbour first (the tab now at `index` after removal), else the left neighbour.
	const right = model.tabs[index + 1];
	if (right) { return right.id; }
	return model.tabs[index - 1]?.id;
}

/**
 * Serialise a strip's tab ids for the per-group persistence key (spec section 3.5). Only the durable ids are
 * stored; labels/kinds/dots are recomputed live from the service on restore, so a renamed doc or a re-synced
 * source never persists a stale label. The active id is stored alongside so the restored group re-activates the
 * same tab.
 */
export interface IPersistedTabStrip {
	readonly ids: readonly string[];
	readonly activeId: string | undefined;
	/**
	 * The id of the tab that was the group's PREVIEW tab, or undefined when every tab was pinned (plan 52 WP-F).
	 * A group has at most one preview tab, so this is a single id rather than a set. Restoring it keeps the
	 * relaunch honest: a tab the user only peeked at comes back italic and is still reused by the next peek,
	 * matching what VS Code does for its own tabs (`EditorGroupModel` serialises its preview index too).
	 */
	readonly previewId: string | undefined;
}

/**
 * The id of the strip's preview tab, or undefined when every tab is pinned. A group owns at most ONE preview
 * tab (core's `EditorGroupModel.preview`), so a well-formed strip has at most one `preview: true` tab; if a
 * malformed model ever carried more, the FIRST wins, so this is total and never throws.
 */
export function previewTabId(model: ITabStripModel): string | undefined {
	return model.tabs.find(t => t.preview)?.id;
}

/** Project a strip down to its persistable shape (ids + active id + the preview tab's id). */
export function toPersistedTabStrip(model: ITabStripModel): IPersistedTabStrip {
	return { ids: model.tabs.map(t => t.id), activeId: model.activeId, previewId: previewTabId(model) };
}

/**
 * Parse a persisted strip back from its stored JSON string, tolerating any malformed/legacy value by returning
 * an empty persisted strip (never throws - a corrupt key must degrade to "no restored tabs", not wedge the
 * editor). Validates shape defensively: `ids` must be an array of strings; `activeId` and `previewId`, when
 * present, must each be a string that also appears in `ids` (else they are dropped so no phantom active or
 * preview tab survives). A key written before WP-F carries no `previewId` at all, which reads back as
 * undefined - every restored tab is then pinned, exactly as that older build behaved.
 */
export function parsePersistedTabStrip(raw: string | undefined): IPersistedTabStrip {
	if (!raw) { return { ids: [], activeId: undefined, previewId: undefined }; }
	try {
		const parsed = JSON.parse(raw) as { ids?: unknown; activeId?: unknown; previewId?: unknown };
		const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === 'string') : [];
		const activeId = typeof parsed.activeId === 'string' && ids.includes(parsed.activeId) ? parsed.activeId : undefined;
		const previewId = typeof parsed.previewId === 'string' && ids.includes(parsed.previewId) ? parsed.previewId : undefined;
		return { ids, activeId, previewId };
	} catch {
		return { ids: [], activeId: undefined, previewId: undefined };
	}
}
