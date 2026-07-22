/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, EventHelper, EventType, addDisposableListener } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { toAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { documentDisplayTitle } from '../common/livingDocMarkdown.js';
import { ILivingDocsService } from '../common/livingDocs.js';
import { ITabModel, ITabStripModel, TAB_OVERFLOW_THRESHOLD, tabsOverflow, toPersistedTabStrip } from '../common/livingDocTabs.js';
import { LivingDocEditorInput } from './livingDocEditorInput.js';
import { LivingDocSourceInput } from './livingDocSourceInput.js';

// The per-workspace per-group persistence key for the open-tab set (spec 43 section 3.5). Keyed by the group
// id so "Open to the right" (a second group) keeps its own tab row's persisted state.
export function tabStripStorageKey(groupId: number): string {
	return `livingDocs.v2.tabs.${groupId}`;
}

// A window-lifetime gate: while the tab-restore contribution is re-opening the persisted set on reload, strips
// MUST NOT persist. Native editor restoration brings a group back with only its active editor first, so an
// un-gated strip would overwrite the full persisted set with that partial one before restore could read it.
// The restore contribution snapshots the persisted keys, sets this true, re-opens every tab, then clears it.
let tabRestoreInProgress = false;
export function setTabRestoreInProgress(value: boolean): void {
	tabRestoreInProgress = value;
}

/**
 * The product-tab strip (spec 43 section 3.2, plan 45 pin 7): Abstract's own DOM, rendered in the editor pane
 * HOST (native DOM above the webview - not inside it, which would flicker on doc switch). One instance per
 * editor pane (LivingDocEditor + LivingDocSourceEditor both mount one), each bound to its pane's group. The
 * strip is a dumb projection of the group's open editors of our pane family: clicking a tab activates that
 * editor in the group, the × / middle-click closes it (native group behaviour then activates the neighbour and
 * closes the group when the last tab goes). VS Code's own tab strip stays `showTabs:'none'`, so this is the
 * only tab row the user sees.
 */
export class AbstractTabStrip extends Disposable {

	readonly element: HTMLElement;
	private readonly _renderDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _group: IEditorGroup,
		private readonly _livingDocs: ILivingDocsService,
		private readonly _storageService: IStorageService,
		private readonly _contextMenuService: IContextMenuService,
		private readonly _editorService: IEditorService,
	) {
		super();
		this.element = $('.lwd-tabstrip');
		// Re-render on any change to the group's editor set or its active editor, so the strip always mirrors
		// the group (an "Open to the right", a close, a middle-click, a programmatic open all flow through here).
		this._register(this._group.onDidModelChange(() => this.render()));
		this._register(this._group.onDidActiveEditorChange(() => this.render()));
		// Re-render when the living-docs model changes so a tab's label (display title) and status dot refresh -
		// notably after a reload, where restored document tabs first render with the file name before the doc
		// metadata has loaded, then settle to the display title once it is available.
		this._register(this._livingDocs.onDidChange(() => this.render()));
		this.render();
	}

	/** Build the pure tab-strip model from the group's open editors (our pane family only, in group order). */
	private _model(): ITabStripModel {
		const tabs: ITabModel[] = [];
		for (const editor of this._group.editors) {
			const tab = this._tabFor(editor);
			if (tab) { tabs.push(tab); }
		}
		const active = this._group.activeEditor;
		const activeId = active && this._isOurs(active) ? active.resource?.toString() : undefined;
		return { tabs, activeId };
	}

	private _isOurs(editor: EditorInput): boolean {
		return editor instanceof LivingDocEditorInput || editor instanceof LivingDocSourceInput;
	}

	/** The tab descriptor for one editor input, or undefined when it is not one of our pane-family inputs. */
	private _tabFor(editor: EditorInput): ITabModel | undefined {
		const resource = editor.resource;
		if (!resource) { return undefined; }
		if (editor instanceof LivingDocSourceInput) {
			return { id: resource.toString(), label: basename(resource), kind: 'source', dot: 'none' };
		}
		if (editor instanceof LivingDocEditorInput) {
			const doc = this._livingDocs.getDoc(resource);
			const label = doc ? documentDisplayTitle(doc, basename(resource)) : basename(resource);
			// The 6px status dot (P7.2): attention when the doc has pending changes waiting, ok for a clean
			// living doc, none for a plain markdown doc with nothing to say.
			let dot: ITabModel['dot'] = 'none';
			if (doc) {
				if (this._livingDocs.getPendingForDoc(resource).length > 0) { dot = 'attention'; }
				else if (doc.isLiving) { dot = 'ok'; }
			}
			return { id: resource.toString(), label, kind: 'document', dot };
		}
		return undefined;
	}

	/** Re-render the whole strip from the current group model and persist the open-tab set (P7.7). */
	render(): void {
		this._renderDisposables.clear();
		clearNode(this.element);
		const model = this._model();
		this._persist(model);

		const scroller = append(this.element, $('.lwd-tabstrip-scroll'));
		for (const tab of model.tabs) {
			this._renderTab(scroller, tab, tab.id === model.activeId);
		}
		// Overflow menu (P7.6): once past the ~8 cap the strip already scrolls horizontally (CSS), and an
		// overflow button lists every tab so a hidden one is one click away.
		if (tabsOverflow(model)) {
			this._renderOverflow(model);
		}
	}

	private _renderTab(parent: HTMLElement, tab: ITabModel, active: boolean): void {
		const el = append(parent, $(`.lwd-tab${active ? '.active' : ''}${tab.kind === 'source' ? '.source' : ''}`));
		el.setAttribute('role', 'tab');
		el.setAttribute('aria-selected', String(active));
		el.title = tab.label;
		// A source tab carries the mono grid glyph (P7.4); a document tab shows its status dot (P7.2, active only).
		if (tab.kind === 'source') {
			// allow-any-unicode-next-line
			append(el, $('span.lwd-tab-glyph')).textContent = '⌸';
		} else if (active && tab.dot !== 'none') {
			append(el, $(`span.lwd-tab-dot.${tab.dot}`));
		}
		append(el, $('span.lwd-tab-label')).textContent = tab.label;
		// Quiet × on the active tab (P7.2). Idle tabs are text-only (P7.3), so the close affordance is the
		// middle-click (P7.5) plus the active tab's ×.
		if (active) {
			const close = append(el, $('span.lwd-tab-x'));
			// allow-any-unicode-next-line
			close.textContent = '×';
			close.title = localize('livingDocs.tab.close', "Close");
			this._renderDisposables.add(addDisposableListener(close, EventType.MOUSE_DOWN, e => {
				EventHelper.stop(e, true);
				this._close(tab.id);
			}));
		}
		// Left-click activates (P7.3); middle-click closes (P7.5).
		this._renderDisposables.add(addDisposableListener(el, EventType.MOUSE_DOWN, e => {
			const mouse = new StandardMouseEvent(el.ownerDocument.defaultView!, e);
			if (mouse.middleButton) {
				EventHelper.stop(e, true);
				this._close(tab.id);
			} else if (mouse.leftButton && !active) {
				EventHelper.stop(e, true);
				this._activate(tab.id);
			}
		}));
	}

	private _renderOverflow(model: ITabStripModel): void {
		const btn = append(this.element, $('.lwd-tab-overflow'));
		btn.title = localize('livingDocs.tab.overflow', "Show all {0} tabs", model.tabs.length);
		// allow-any-unicode-next-line
		btn.textContent = '⋯';
		this._renderDisposables.add(addDisposableListener(btn, EventType.MOUSE_DOWN, e => {
			EventHelper.stop(e, true);
			const actions = model.tabs.map(tab => toAction({
				id: `livingDocs.tab.${tab.id}`,
				label: tab.label,
				checked: tab.id === model.activeId,
				run: () => this._activate(tab.id),
			}));
			this._contextMenuService.showContextMenu({ getAnchor: () => btn, getActions: () => actions });
		}));
	}

	/** Persist the open-tab set (ids + active) for this group (P7.7, spec section 3.5). */
	private _persist(model: ITabStripModel): void {
		// Never clobber the persisted set while restore is re-opening it (see setTabRestoreInProgress).
		if (tabRestoreInProgress) { return; }
		const key = tabStripStorageKey(this._group.id);
		if (model.tabs.length === 0) {
			this._storageService.remove(key, StorageScope.WORKSPACE);
			return;
		}
		this._storageService.store(key, JSON.stringify(toPersistedTabStrip(model)), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	/**
	 * Activate a tab: make its editor the active editor in THIS group (never opens a second group). Routed
	 * through `IEditorService` (with this group as the preferred group) rather than `group.openEditor` directly,
	 * so the standard open logic (revealIfOpened, focus handling) runs - the tab already lives in this group, so
	 * the effect is a plain activation.
	 */
	private _activate(id: string): void {
		const editor = this._editorFor(id);
		if (editor) { void this._editorService.openEditor(editor, undefined, this._group); }
	}

	/**
	 * Close a tab (P7.5): close its editor in this group. The group activates the neighbour natively, and when
	 * the last tab goes the group closes itself (`workbench.editor.closeEmptyGroups`, the split contract 3.2).
	 */
	private _close(id: string): void {
		const editor = this._editorFor(id);
		if (editor) { void this._group.closeEditor(editor); }
	}

	private _editorFor(id: string): EditorInput | undefined {
		const uri = URI.parse(id);
		return this._group.editors.find(e => this._isOurs(e) && e.resource?.toString() === uri.toString());
	}
}

export { TAB_OVERFLOW_THRESHOLD };

/**
 * The product-tab strip styles (spec pin 7 P7.1-P7.6). Mounted once per editor pane (cloned) so the strip
 * reads identically whether the active tab is a document or a source, and so `studio.css` (owned by plan 44)
 * stays untouched. The active tab's white fill overlaps the toolbar edge by 1px (its bottom border is the
 * background colour) so the tab and the toolbar merge with no double border (P7.2).
 */
export function createTabStripStyle(): HTMLStyleElement {
	const style = document.createElement('style');
	style.textContent = `
.lwd-tabstrip{display:flex;align-items:flex-end;height:40px;flex:none;background:#F3F4F7;padding:0 8px;box-sizing:border-box;overflow:hidden}
.lwd-tabstrip-scroll{display:flex;align-items:flex-end;gap:2px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;flex:1;min-width:0}
.lwd-tabstrip-scroll::-webkit-scrollbar{display:none}
.lwd-tab{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px 9px 0 0;font:500 12.5px/1 system-ui;color:#868B95;white-space:nowrap;cursor:pointer;user-select:none;box-sizing:border-box;flex:none;max-width:200px}
.lwd-tab:hover{background:#ECEDF1}
.lwd-tab.active{height:34px;background:#fff;color:#1A1C20;font-weight:600;border:1px solid #E9EAEE;border-bottom:1px solid #fff;margin-bottom:-1px}
.lwd-tab.active:hover{background:#fff}
.lwd-tab-label{overflow:hidden;text-overflow:ellipsis}
.lwd-tab-glyph{font:400 12.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#5B6DC4;flex:none}
.lwd-tab-dot{width:6px;height:6px;border-radius:50%;flex:none}
.lwd-tab-dot.ok{background:#3E9C6B}
.lwd-tab-dot.attention{background:#C99A2E}
.lwd-tab-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;color:#A3A8B2;font-size:14px;flex:none}
.lwd-tab-x:hover{background:#ECEDF1;color:#52575F}
.lwd-tab-overflow{display:inline-flex;align-items:center;justify-content:center;width:28px;height:32px;flex:none;color:#868B95;font-size:16px;cursor:pointer;border-radius:8px}
.lwd-tab-overflow:hover{background:#ECEDF1}
`;
	return style;
}
