/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { IListAccessibilityProvider } from '../../../../base/browser/ui/list/listWidget.js';
import { ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ITreeRailFolderNode, ITreeRailLeafNode, ITreeRailNode } from '../common/treeRail.js';

// The list/tree plumbing for the Files tab (issue #171): the virtual delegate that sizes rows and picks a
// template, and one renderer per node kind (folder header vs. leaf row). These sit beside the view so the
// view file stays focused on widget wiring, data flow, and the doc actions (import / use-as-source / menu).
// Row height matches the calm rail's 26px rhythm; the tree widget supplies twisties, indent, keyboard nav,
// and a11y for free (issue #171 acceptance: click + keyboard collapse, persisted state, active highlight).

export const TREE_RAIL_ROW_HEIGHT = 26;

/** A leaf-row action the view wires up: an inline button (import / use-as-source) appended to the row. */
export interface ITreeRailLeafActions {
	/** Fill the trailing action area of a leaf row (import door, "Use as source", pending dot); returns a
	 * disposable for any listeners the view attached, cleared when the row is recycled. */
	renderLeafActions(node: ITreeRailLeafNode, container: HTMLElement): DisposableStore;
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
	readonly glyph: HTMLElement;
	readonly label: HTMLElement;
	readonly actions: HTMLElement;
	readonly disposables: DisposableStore;
}

export class TreeRailLeafRenderer implements ITreeRenderer<ITreeRailLeafNode, void, ILeafTemplate> {
	static readonly ID = 'treeRail.leaf';
	get templateId(): string { return TreeRailLeafRenderer.ID; }

	constructor(private readonly _actions: ITreeRailLeafActions) { }

	renderTemplate(container: HTMLElement): ILeafTemplate {
		container.classList.add('rail-tree-leaf');
		const glyph = append(container, $('span.rail-item-glyph'));
		const label = append(container, $('span.rail-item-label'));
		const actions = append(container, $('span.rail-tree-actions'));
		return { row: container, glyph, label, actions, disposables: new DisposableStore() };
	}

	renderElement(node: ITreeNode<ITreeRailLeafNode, void>, _index: number, template: ILeafTemplate): void {
		template.disposables.clear();
		template.actions.replaceChildren();
		const item = node.element.item;
		// Match the rail's existing glyph vocabulary (document / not-imported / api / mcp / file source).
		template.glyph.textContent = item.kind === 'doc' ? '\u25A3'
			: item.kind === 'unsupported' ? '\u2298'
				: (item.sourceKind === 'api' ? '\u21C4' : (item.sourceKind === 'mcp' ? '\u25F7' : '\u229E'));
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
