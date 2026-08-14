/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { IListAccessibilityProvider } from '../../../../base/browser/ui/list/listWidget.js';
import { ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IRailDot } from '../common/railStatus.js';
import { ITreeRailFolderNode, ITreeRailLeafNode, ITreeRailNode, sourceKindGlyph, sourceMeta } from '../common/treeRail.js';

// The list/tree plumbing for the Files tab (issue #171): the virtual delegate that sizes rows and picks a
// template, and one renderer per node kind (folder header vs. leaf row). These sit beside the view so the
// view file stays focused on widget wiring, data flow, and the doc actions (import / use-as-source / menu).
// Row heights follow the v2 row anatomy (pin 5): folder rows 28px, document/source (leaf) rows 30px. The
// tree widget supplies twisties, indent, keyboard nav, and a11y for free (issue #171 acceptance: click +
// keyboard collapse, persisted state, active highlight); the delegate sizes each row kind independently.

/** Folder (group / directory) row height (P5.1). */
export const TREE_RAIL_FOLDER_ROW_HEIGHT = 28;
/** Document / source (leaf) row height (P5.2). */
export const TREE_RAIL_LEAF_ROW_HEIGHT = 30;

/** A leaf-row action the view wires up: an inline button (import / use-as-source) appended to the row. */
export interface ITreeRailLeafActions {
	/** Fill the trailing action area of a leaf row (import door, "Use as source"); returns a
	 * disposable for any listeners the view attached, cleared when the row is recycled. */
	renderLeafActions(node: ITreeRailLeafNode, container: HTMLElement): DisposableStore;
	/** Attach a managed hover (IHoverService) to `el` showing `content`; returns the hover's disposable, which
	 * the per-row template store owns so a recycled row never leaks its hover (issue #212). The view backs this
	 * with `hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), el, content)`. */
	setupHover(el: HTMLElement, content: string): IDisposable;
	/**
	 * Inline rename (P6.3): when this leaf is the row being renamed, mount an edit-in-place input into `label`
	 * (in place of its text) and return its disposable; return undefined otherwise so the row renders normally.
	 * Enter commits, Esc cancels - the view owns the input + the commit path (the silent-rename service call).
	 */
	renderRenameInput(node: ITreeRailLeafNode, label: HTMLElement): IDisposable | undefined;
}

export class TreeRailDelegate implements IListVirtualDelegate<ITreeRailNode> {
	getHeight(element: ITreeRailNode): number {
		return element.type === 'folder' ? TREE_RAIL_FOLDER_ROW_HEIGHT : TREE_RAIL_LEAF_ROW_HEIGHT;
	}
	getTemplateId(element: ITreeRailNode): string {
		return element.type === 'folder' ? TreeRailFolderRenderer.ID : TreeRailLeafRenderer.ID;
	}
}

interface IFolderTemplate {
	readonly label: HTMLElement;
	readonly count: HTMLElement;
}

/** The number of leaf rows (documents / sources) beneath a folder node, for the right-aligned doc-count (P5.1). */
function countLeaves(node: ITreeRailNode): number {
	if (node.type === 'leaf') { return 1; }
	let total = 0;
	for (const child of node.children) { total += countLeaves(child); }
	return total;
}

export class TreeRailFolderRenderer implements ITreeRenderer<ITreeRailFolderNode, void, IFolderTemplate> {
	static readonly ID = 'treeRail.folder';
	get templateId(): string { return TreeRailFolderRenderer.ID; }

	renderTemplate(container: HTMLElement): IFolderTemplate {
		container.classList.add('rail-tree-folder');
		const label = append(container, $('span.rail-tree-folder-label'));
		// The right-aligned mono doc-count (P5.1): the number of documents/sources this group holds, in meta ink.
		const count = append(container, $('span.rail-tree-folder-count'));
		return { label, count };
	}

	renderElement(node: ITreeNode<ITreeRailFolderNode, void>, _index: number, template: IFolderTemplate): void {
		template.label.textContent = node.element.label;
		template.count.textContent = `${countLeaves(node.element)}`;
	}

	disposeTemplate(_template: IFolderTemplate): void { }
}

interface ILeafTemplate {
	readonly row: HTMLElement;
	readonly status: HTMLElement;
	readonly glyph: HTMLElement;
	readonly label: HTMLElement;
	/** The trailing status marker: the LWD chip (living doc) OR the amber pending pill (P5.3, never both). */
	readonly marker: HTMLElement;
	/** For a source row, the right meta (P5.6: "synced" / relative time). Hidden on document rows. */
	readonly meta: HTMLElement;
	readonly actions: HTMLElement;
	readonly disposables: DisposableStore;
}

/** The status element's colour/shape classes, cleared on each render so a recycled row never carries a stale one. */
const RAIL_STATUS_CLASSES = ['rail-status-dot', 'rail-status-dash', 'rail-status-grey', 'rail-status-green', 'rail-status-yellow', 'rail-status-red'];

export class TreeRailLeafRenderer implements ITreeRenderer<ITreeRailLeafNode, void, ILeafTemplate> {
	static readonly ID = 'treeRail.leaf';
	get templateId(): string { return TreeRailLeafRenderer.ID; }

	constructor(private readonly _actions: ITreeRailLeafActions) { }

	renderTemplate(container: HTMLElement): ILeafTemplate {
		container.classList.add('rail-tree-leaf');
		// The leading indicator: for a document, the status dot (P5.2, colour from `item.dot`); for a source, the
		// mono kind glyph (P5.6). Both live in the same leading slot - the renderer shows exactly one.
		const status = append(container, $('span.rail-status'));
		const glyph = append(container, $('span.rail-tree-glyph'));
		const label = append(container, $('span.rail-item-label'));
		// The trailing status marker (P5.3): the LWD chip (living document) OR the amber pending pill (a document
		// with pending approvals). Pending wins - the renderer shows at most one, never both.
		const marker = append(container, $('span.rail-tree-marker'));
		// The source row's right meta (P5.6): "synced" / relative time. Empty (hidden) on document rows.
		const meta = append(container, $('span.rail-tree-meta'));
		const actions = append(container, $('span.rail-tree-actions'));
		return { row: container, status, glyph, label, marker, meta, actions, disposables: new DisposableStore() };
	}

	renderElement(node: ITreeNode<ITreeRailLeafNode, void>, _index: number, template: ILeafTemplate): void {
		template.disposables.clear();
		template.actions.replaceChildren();
		template.marker.replaceChildren();
		template.marker.className = 'rail-tree-marker';
		template.meta.textContent = '';
		template.meta.className = 'rail-tree-meta'; // drops any freshness tone class so a recycled row is clean
		const item = node.element.item;
		const isDoc = item.kind === 'doc';
		template.row.classList.toggle('rail-tree-leaf-source', !isDoc);
		// The leading slot: a document shows its status dot; a source/extra row shows its mono kind glyph (P5.6).
		template.status.classList.remove(...RAIL_STATUS_CLASSES);
		template.status.style.display = isDoc ? '' : 'none';
		template.glyph.style.display = isDoc ? 'none' : '';
		if (isDoc) {
			const dot: IRailDot = item.dot;
			// Reset then apply this row's status classes (shape + colour band). Rows recycle, so a stale class must go.
			template.status.classList.add(dot.shape === 'dash' ? 'rail-status-dash' : 'rail-status-dot', `rail-status-${dot.color}`);
			// The dot's plain-words reason + count lives in the hover tooltip (IHoverService), never as inline text -
			// the rail stays a calm column of colour. The returned hover disposable is owned by the per-row store.
			template.disposables.add(this._actions.setupHover(template.status, dot.tooltip));
		} else {
			template.glyph.textContent = sourceKindGlyph(item.label);
		}
		// Inline rename (P6.3): when this row is the one being renamed, the view mounts an edit-in-place input
		// into the label slot (Enter commits, Esc cancels) instead of the static text. Otherwise render the label.
		template.label.replaceChildren();
		const renameInput = this._actions.renderRenameInput(node.element, template.label);
		if (renameInput) {
			template.disposables.add(renameInput);
		} else {
			template.label.textContent = item.label;
		}
		if (isDoc) {
			// The trailing marker (P5.3), precedence: pending wins. A document with pending approvals shows the amber
			// count pill; a living document with none shows the LWD chip; a plain document shows neither.
			if (item.pendingCount > 0) {
				const pill = append(template.marker, $('span.rail-tree-pending'));
				pill.textContent = `${item.pendingCount}`;
			} else if (item.living) {
				const chip = append(template.marker, $('span.rail-tree-lwd'));
				chip.textContent = 'LWD';
			}
		} else {
			// The source's right meta (P5.6) reads the ONE freshness vocabulary (#122 F12) so the rail agrees with
			// the Knowledge table: a drifted source reads "stale" (amber), a context-only source "context only"
			// (grey), a fresh folder-resolved source the quiet "synced". `sourceMeta` is the single home of that
			// wording, shared with the Context tab's workspace sources (plan 52 WP-D3), so the two can never say
			// different words about the same file. It returns nothing for a non-source row or a source with no
			// freshness context and no local file - the reset above already left the slot empty.
			const meta = sourceMeta(item);
			if (meta) {
				template.meta.textContent = meta.text;
				template.meta.classList.add(`rail-meta-${meta.tone}`);
			}
		}
		template.disposables.add(this._actions.renderLeafActions(node.element, template.actions));
	}

	disposeElement(_node: ITreeNode<ITreeRailLeafNode, void>, _index: number, template: ILeafTemplate): void {
		template.disposables.clear();
		template.actions.replaceChildren();
		template.marker.replaceChildren();
		// A recycled row must not carry a previous row's rename input; the next renderElement repopulates the label.
		template.label.replaceChildren();
	}

	disposeTemplate(template: ILeafTemplate): void {
		template.disposables.dispose();
	}
}

export class TreeRailAccessibilityProvider implements IListAccessibilityProvider<ITreeRailNode> {
	getWidgetAriaLabel(): string {
		return localize("livingDocs.filesTree", "Files");
	}
	getAriaLabel(element: ITreeRailNode): string {
		return element.type === 'folder' ? element.label : element.item.label;
	}
}
