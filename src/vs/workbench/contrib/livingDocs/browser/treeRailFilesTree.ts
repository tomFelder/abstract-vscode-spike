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
import { ITreeRailFolderNode, ITreeRailLeafNode, ITreeRailNode } from '../common/treeRail.js';

// The list/tree plumbing for the Files tab (issue #171): the virtual delegate that sizes rows and picks a
// template, and one renderer per node kind (folder header vs. leaf row). These sit beside the view so the
// view file stays focused on widget wiring, data flow, and the doc actions (import / use-as-source / menu).
// Row height matches the calm rail's 26px rhythm; the tree widget supplies twisties, indent, keyboard nav,
// and a11y for free (issue #171 acceptance: click + keyboard collapse, persisted state, active highlight).

export const TREE_RAIL_ROW_HEIGHT = 26;

/** A leaf-row action the view wires up: an inline button (import / use-as-source) appended to the row. */
export interface ITreeRailLeafActions {
	/** Fill the trailing action area of a leaf row (import door, "Use as source"); returns a
	 * disposable for any listeners the view attached, cleared when the row is recycled. */
	renderLeafActions(node: ITreeRailLeafNode, container: HTMLElement): DisposableStore;
	/** Attach a managed hover (IHoverService) to `el` showing `content`; returns the hover's disposable, which
	 * the per-row template store owns so a recycled row never leaks its hover (issue #212). The view backs this
	 * with `hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), el, content)`. */
	setupHover(el: HTMLElement, content: string): IDisposable;
}

export class TreeRailDelegate implements IListVirtualDelegate<ITreeRailNode> {
	getHeight(_element: ITreeRailNode): number {
		return TREE_RAIL_ROW_HEIGHT;
	}
	getTemplateId(element: ITreeRailNode): string {
		return element.type === 'folder' ? TreeRailFolderRenderer.ID : TreeRailLeafRenderer.ID;
	}
}

interface IFolderTemplate {
	readonly label: HTMLElement;
}

export class TreeRailFolderRenderer implements ITreeRenderer<ITreeRailFolderNode, void, IFolderTemplate> {
	static readonly ID = 'treeRail.folder';
	get templateId(): string { return TreeRailFolderRenderer.ID; }

	renderTemplate(container: HTMLElement): IFolderTemplate {
		container.classList.add('rail-tree-folder');
		const label = append(container, $('span.rail-tree-folder-label'));
		return { label };
	}

	renderElement(node: ITreeNode<ITreeRailFolderNode, void>, _index: number, template: IFolderTemplate): void {
		template.label.textContent = node.element.label;
	}

	disposeTemplate(_template: IFolderTemplate): void { }
}

interface ILeafTemplate {
	readonly row: HTMLElement;
	readonly status: HTMLElement;
	readonly label: HTMLElement;
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
		// The leading status indicator (issue #212): a fixed-size dot (documents) or a muted dash (source/extra
		// rows), replacing the old 13px blue glyph. Its colour + shape are set per render from `item.dot`.
		const status = append(container, $('span.rail-status'));
		const label = append(container, $('span.rail-item-label'));
		const actions = append(container, $('span.rail-tree-actions'));
		return { row: container, status, label, actions, disposables: new DisposableStore() };
	}

	renderElement(node: ITreeNode<ITreeRailLeafNode, void>, _index: number, template: ILeafTemplate): void {
		template.disposables.clear();
		template.actions.replaceChildren();
		const item = node.element.item;
		const dot: IRailDot = item.dot;
		// Reset then apply this row's status classes (shape + colour band). Rows recycle, so a stale class must go.
		template.status.classList.remove(...RAIL_STATUS_CLASSES);
		template.status.classList.add(dot.shape === 'dash' ? 'rail-status-dash' : 'rail-status-dot', `rail-status-${dot.color}`);
		// The dot's plain-words reason + count lives in the hover tooltip (IHoverService), never as inline text -
		// the rail stays a calm column of colour. The returned hover disposable is owned by the per-row store.
		template.disposables.add(this._actions.setupHover(template.status, dot.tooltip));
		template.label.textContent = item.label;
		template.row.classList.toggle('rail-tree-leaf-source', item.kind !== 'doc');
		template.disposables.add(this._actions.renderLeafActions(node.element, template.actions));
	}

	disposeElement(_node: ITreeNode<ITreeRailLeafNode, void>, _index: number, template: ILeafTemplate): void {
		template.disposables.clear();
		template.actions.replaceChildren();
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
