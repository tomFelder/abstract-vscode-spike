/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, isHTMLElement } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IAnchor } from '../../../../base/browser/ui/contextview/contextview.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IObjectTreeElement } from '../../../../base/browser/ui/tree/tree.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { WorkbenchObjectTree } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { ClickGestureGuard } from '../common/clickGesture.js';
import { buildContextGroups, keyNamespace, sourceNamespace } from '../common/contextGroups.js';
import { AddedContextKind } from '../common/livingDocsModel.js';
import { ILivingDocsService, ILivingDocSummary } from '../common/livingDocs.js';
import { buildOutline, buildRecentDocItems, buildTreeRailNodes, buildWorkspaceSourceNodes, collectAssetsFolderIds, filterTreeRailNodes, isMissingSource, ITreeRailItem, ITreeRailLeafNode, ITreeRailNode, RECENT_STRIP_ID, searchTreeRail, sourceKindGlyph, sourceMeta, touchRecentDoc, TreeRailAction, TreeRailFreshness } from '../common/treeRail.js';
import { createDocumentMenuActions, createDocumentMenuStyle, createSourceMenuActions, DOCUMENT_MENU_CLASS_NAME, IDocumentMenuServices } from './documentContextMenu.js';
import { TreeRailAccessibilityProvider, TreeRailDelegate, TreeRailFolderRenderer, TreeRailLeafRenderer } from './treeRailFilesTree.js';
import { ScreenEditor } from './screenEditor.js';
import { ScreenEditorInput } from './screenEditorInput.js';

// Three calm tabs (pin 4): Search is gone as a tab - it folds into Files as type-to-filter (P4.1/P4.2).
type TreeRailTab = 'files' | 'context' | 'outline';

const TABS: readonly { id: TreeRailTab; label: string }[] = [
	{ id: 'files', label: 'Files' },
	{ id: 'context', label: 'Context' },
	{ id: 'outline', label: 'Outline' },
];

// The comp's single left tree-rail: one sidebar view with Files / Context / Outline / Search tabs and a
// folder tree, replacing the spike-era activity-bar-per-view split (Documents + Context were separate
// containers). DOM-rendered like DocumentsView. ADDITIVE-CONTRIBUTION (merge-tax ledger).
export class TreeRailView extends ViewPane {

	private _body: HTMLElement | undefined;
	private _stylesInjected = false;
	private _renderToken = 0;
	private _tab: TreeRailTab = 'files';
	// The Files-tab type-to-filter (P4.2): narrows the tree rows live. Kept across re-renders so an
	// onDidChange/onDidActiveEditorChange re-render never drops what the user has typed. Only the rail's own
	// filter input writes it - typing in the editor never reaches here (plan-42 quiet-shell focus discipline).
	private _filter = '';
	// Context-tab "Add context" composer state, kept across re-renders (onDidChange re-renders the rail).
	private _ctxAdding = false;
	// 'file' references a real folder file (frontmatter context, R6); the others are lock context items.
	private _ctxKind: 'file' | AddedContextKind = 'file';
	private _ctxDraft = '';
	private _ctxFileCandidates: readonly string[] = [];
	// Context-tab "Add source" picker state (R5): folder data files offered when the picker is open.
	private _srcAdding = false;
	private _srcCandidates: readonly string[] = [];
	private readonly _renderDisposables = this._register(new DisposableStore());
	// The Files-tab file tree (issue #171): a WorkbenchObjectTree that persists across re-renders (rebuilding
	// it would lose focus + in-session state), re-parented into the freshly-built panel each render. Its
	// per-leaf action listeners (import / use-as-source) live in a store cleared on each setChildren.
	private _filesTree: WorkbenchObjectTree<ITreeRailNode, void> | undefined;
	private _filesTreeContainer: HTMLElement | undefined;
	// Folder ids the user has collapsed, persisted so expansion survives restart (issue #171 acceptance).
	private _collapsedFolders = new Set<string>();
	// Set while reveal-to-active expands ancestor folders, so those programmatic expansions are not persisted.
	private _suppressCollapsePersist = false;
	// The hover service, backing the status-dot tooltips the Files-tree leaf renderer attaches (issue #212).
	private readonly _hoverService: IHoverService;
	// Inline rename (P6.3): the resource string of the row currently in edit-in-place mode, or undefined. While
	// set, that row mounts an input into its label instead of the static text - on the Files tree for a document
	// row, or on the Context tab's workspace-source row, whichever surface actually holds the file.
	private _renaming: string | undefined;
	// The documents OPENED in this window, most-recent first (plan 52 WP-D2, fix round 1 / R-2). This is the
	// Recent strip's source of truth: the editor history alone cannot serve, because a preview tab is disposed
	// when the next preview replaces it, taking its document out of history with it. Bounded by
	// `touchRecentDoc` to `RECENT_STRIP_MEMORY`. Window-lifetime only - a jump-list is about this sitting.
	private _openedDocs: readonly URI[] = [];
	// The one thing that keeps a double-click honest (fix round 2 / R-1): while a click sequence is in flight,
	// every redraw an event asks for is HELD, so nothing under the pointer can move as a consequence of the
	// first click. One deferred redraw is replayed when the gesture releases.
	private readonly _gesture = this._register(new ClickGestureGuard(() => void this._render()));
	// The document the FILES TREE itself just opened, so `_highlightActiveDoc` does not scroll the tree to a row
	// the user picked in that very tree (fix round 2 / R-1). A reveal is for navigation the user did NOT initiate
	// in this list; on a self-caused activation it only throws away the place they had scrolled to.
	private _treeOpened: string | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly _editors: IEditorService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IQuickInputService private readonly _quickInput: IQuickInputService,
		@IStorageService private readonly _storageService: IStorageService,
		@IHistoryService private readonly _history: IHistoryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._hoverService = hoverService;
		this._collapsedFolders = this._readCollapsedFolders();
	}

	// Persisted (workspace-scoped) collapse state for everything the rail can fold, keyed by node id so
	// expansion survives restart (issue #171): the Files tree's folders, the Context tab's Assets bucket, and
	// the Files tab's Recent strip (`RECENT_STRIP_ID`, plan 52 WP-D2 - one set, one key, one idiom). Owned by
	// this view - no reaching into another component's storage keys.
	private static readonly COLLAPSED_STORAGE_KEY = 'livingDocs.treeRail.filesCollapsed';
	// One-time flag: the Assets bucket defaults to collapsed on first open (so ~400 screenshots never flood the
	// pane, issue #171), but after that it behaves like any other folder - user expand/collapse persists. The
	// collapsed set stores COLLAPSED ids, so we cannot tell "never seeded" from "user expanded Assets" without
	// this marker; once set we never re-seed, so the user's choice always wins from then on.
	private static readonly ASSETS_SEEDED_STORAGE_KEY = 'livingDocs.treeRail.assetsSeeded';

	private _readCollapsedFolders(): Set<string> {
		const raw = this._storageService.get(TreeRailView.COLLAPSED_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) { return new Set(); }
		try {
			const ids = JSON.parse(raw);
			return Array.isArray(ids) ? new Set(ids.filter((id: unknown): id is string => typeof id === 'string')) : new Set();
		} catch {
			return new Set();
		}
	}

	private _persistCollapsedFolders(): void {
		this._storageService.store(TreeRailView.COLLAPSED_STORAGE_KEY, JSON.stringify([...this._collapsedFolders]), StorageScope.WORKSPACE, StorageTarget.USER);
	}

	// The one-time default: the first time a workspace's sources are rendered, mark every Assets bucket collapsed
	// so the screenshot flood never appears (issue #171 acceptance). Guarded by a persisted seed flag so it fires
	// once; thereafter the user's expand/collapse of Assets persists like any other folder.
	private _seedAssetsCollapsed(nodes: readonly ITreeRailNode[]): void {
		if (this._storageService.getBoolean(TreeRailView.ASSETS_SEEDED_STORAGE_KEY, StorageScope.WORKSPACE, false)) { return; }
		const assetsIds = collectAssetsFolderIds(nodes);
		// Only seed (and mark seeded) once an Assets bucket actually exists - so a first render before any
		// screenshots exist does not burn the one-shot and leave a later flood expanded.
		if (!assetsIds.length) { return; }
		for (const id of assetsIds) { this._collapsedFolders.add(id); }
		this._persistCollapsedFolders();
		this._storageService.store(TreeRailView.ASSETS_SEEDED_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._injectStyles(container);
		const body = append(container, $('.living-docs-rail'));
		this._body = body;
		body.style.height = '100%';
		body.style.display = 'flex';
		body.style.flexDirection = 'column';
		// The restyled native context-menu skin (P6.7). Owned per-view and mounted on the document head, because
		// the menu overlay renders OUTSIDE this view's DOM subtree so a view-scoped sheet could never reach it.
		const menuStyle = createDocumentMenuStyle();
		this.element.ownerDocument.head.appendChild(menuStyle);
		this._register(toDisposable(() => menuStyle.remove()));
		// The click-gesture guard (fix round 2 / R-1). A click in this rail opens a document, and opening a
		// document changes what the rail draws - so the redraw lands BETWEEN the two clicks of a double-click and
		// moves whatever the second click was aimed at. The primary button starts a gesture here and releases it
		// a double-click window after it comes back up; every event-driven redraw in between is held (see
		// `_scheduleRender`). Only the primary button: a right-click has no double-click semantics, and its menu
		// may swallow the release. The release is watched on the document, so dragging out of the rail and letting
		// go still ends the gesture.
		this._register(addDisposableListener(body, 'mousedown', (e: MouseEvent) => {
			if (e.button === 0) { this._gesture.begin(); }
		}));
		this._register(addDisposableListener(this.element.ownerDocument, 'mouseup', (e: MouseEvent) => {
			if (e.button === 0) { this._gesture.end(); }
		}));
		// Context/Outline track the active document; Files/Search track the document set. Every activation is also
		// what the Recent strip remembers (fix round 1 / R-2): the MRU is recorded HERE, when a document is
		// opened, rather than read back later off the editors that happen to have survived. Non-document editors
		// (a source tab, a screen) are recorded too and filtered out when the strip is built, so this stays a
		// dumb "what became active, in order" tape with no knowledge of what counts as a document.
		this._register(this._editors.onDidActiveEditorChange(() => {
			const resource = this._editors.activeEditor?.resource;
			if (resource) { this._openedDocs = touchRecentDoc(this._openedDocs, resource); }
			this._scheduleRender();
		}));
		this._register(this._livingDocs.onDidChange(() => this._scheduleRender()));
		// The two document-menu items whose UI only THIS rail can mount (pin 6 / P6.3, P6.5). They arrive as
		// service requests so the same menu item works whether it was raised on a tree row or on a product tab
		// (plan 52 WP-F) - the tab strip holds no reference to this view.
		this._register(this._livingDocs.onDidRequestRenameDocument(e => this._startInlineRename(URI.parse(e.docId))));
		this._register(this._livingDocs.onDidRequestBindSources(e => void this._bindSources(URI.parse(e.docId))));
		void this._render();
	}

	// The resource whose document surface the editor is currently rendering - living OR plain Markdown.
	// The Context and Outline tabs both track "the open document", and the doc editor renders any `.md`
	// through the same ProseMirror surface, so gating these tabs on `isLiving` made a plainly-open document
	// invisible to them (issue #181). We only need a PARSED document to shape an outline / its context, and
	// `getDoc` is populated for every `.md` the editor opens (living or not), so the surface resource is any
	// active document with a parsed model. `isLiving` still governs where behaviour genuinely differs (e.g.
	// the source-binding affordances below), not whether the document exists.
	private _activeSurfaceResource(): URI | undefined {
		const resource = this._editors.activeEditor?.resource;
		return resource && this._livingDocs.getDoc(resource) ? resource : undefined;
	}

	/**
	 * Redraw because something CHANGED underneath us - a document was opened, the folder's set moved, an agent
	 * applied an edit. Every one of those is a consequence, and a consequence that lands between the two clicks
	 * of a double-click moves the thing the second click was aimed at. So while a click sequence is in flight the
	 * redraw is held and replayed once the gesture is over (`ClickGestureGuard`).
	 *
	 * Redraws the user ASKS for go straight to `_render` instead: switching tab, typing in the filter, folding the
	 * strip. Those are the direct effect of the control that was just clicked, on the control that was clicked -
	 * holding them would only make the rail feel broken.
	 */
	private _scheduleRender(): void {
		if (this._gesture.hold()) { return; }
		void this._render();
	}

	private async _render(): Promise<void> {
		const root = this._body;
		if (!root) { return; }
		const token = ++this._renderToken;
		const documents = await this._livingDocs.listDocuments();
		// Both Files ("Not yet imported") and Context (the workspace sources section, plan 52 WP-D3) read the
		// folder's non-Markdown files; Outline is purely per-document, so it skips the scan.
		const extras = this._tab === 'outline' ? [] : await this._livingDocs.listWorkspaceExtras();
		if (token !== this._renderToken || !this._body) { return; }
		this._renderDisposables.clear();
		clearNode(root);

		// Tab strip: three chips, a flexible spacer, then the quiet + (P4.1/P4.3/P4.4).
		const tabs = append(root, $('div.rail-tabs'));
		for (const t of TABS) {
			const btn = append(tabs, $(`button.rail-tab${this._tab === t.id ? '.active' : ''}`)) as HTMLButtonElement;
			append(btn, document.createTextNode(t.label));
			this._renderDisposables.add(addDisposableListener(btn, 'click', () => {
				if (this._tab !== t.id) { this._tab = t.id; void this._render(); }
			}));
		}
		append(tabs, $('div.rail-tabs-spacer'));
		// The quiet + : the new-document door (P4.4). WP-H (#261) unifies every new-doc door onto ONE rich dialog:
		// this + now opens Project Home's New-document sheet (Blank + templates + "From sources...") - the same
		// dialog the Home tile opens - instead of a poor name-only quick input that could only make blank docs.
		const plus = append(tabs, $('button.rail-new-doc')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		plus.textContent = '＋'; // fullwidth plus, matching the mock's quiet new-document glyph
		plus.title = localize('livingDocs.treeRail.newDocument', "New Document");
		plus.setAttribute('aria-label', plus.title);
		this._renderDisposables.add(addDisposableListener(plus, 'click', () => void this._newDocument()));

		const panel = append(root, $('div.rail-panel'));
		switch (this._tab) {
			case 'files': this._renderFiles(panel, documents, extras); break;
			case 'context': this._renderContext(panel, documents, extras); break;
			case 'outline': this._renderOutline(panel); break;
		}
	}

	// The new-document door from the tree rail's + (P4.4, unified by WP-H / #261): open Project Home and ask it
	// to open its rich New-document sheet - the SAME dialog the Home tile opens (Blank + real templates + "From
	// sources..."), so the obvious "+" no longer hides the template/from-sources on-ramp behind a name-only quick
	// input. Home already backs blank, template-generate and from-sources creation through the review-safe paths.
	private async _newDocument(): Promise<void> {
		const input = this.instantiationService.createInstance(ScreenEditorInput, 'home');
		const pane = await this._editors.openEditor(input, { pinned: true });
		// The screen input is a Singleton: the service may return an already-open Home pane rather than adopt the
		// instance we created, leaving us the owner - dispose ours unless the resolved pane is backed by it.
		if (pane?.input !== input) {
			input.dispose();
		}
		if (pane instanceof ScreenEditor) {
			pane.openSheet('newdoc');
		}
	}

	// The Files tab (issue #171): a real collapsible file tree on the VS Code tree widget. The widget is
	// created once and re-parented into the freshly-rendered panel on every re-render, so its focus, keyboard
	// state and selection survive the onDidChange/onDidActiveEditorChange re-renders that drive this rail.
	private _renderFiles(panel: HTMLElement, documents: readonly ILivingDocSummary[], extras: readonly string[]): void {
		const nodes = buildTreeRailNodes(documents.map(d => this._toDocInput(d)), extras);
		if (!nodes.length) {
			append(panel, $('div.rail-empty')).textContent = localize('livingDocs.treeRail.noDocuments', "No documents yet.");
			return;
		}
		panel.classList.add('rail-panel-files');

		// Recents sits at the HEAD of the pane, above the filter box (fix round 2 / R-1). Position is not what
		// made a double-click pin the wrong document - a band that changes size is, wherever it sits, because the
		// second click can land anywhere the first one could. That is held by the gesture guard now, which frees
		// this to be decided on merit: "get me back to what I was doing" is the highest-traffic control in the
		// pane, so it belongs where the hand starts and the eye lands, not below the scroll of a long tree. The
		// pane then reads top-down as "where you were" -> "find one" -> "the folder itself".
		this._renderRecentStrip(panel, documents);

		// The type-to-filter field (P4.2, the folded-in Search): a quiet input that narrows the tree rows live.
		// It captures keystrokes only when it holds focus, so typing in the editor never triggers it (plan-42
		// quiet-shell focus discipline). Rendered above the tree so the filter reads as part of the Files pane.
		this._renderFilter(panel);

		// The bulk-import banner (doc 22 section 2, the 2b moment): when several Word documents are waiting,
		// offer to import them all at once - "I found N Word documents - import them?". A banner above the tree.
		const importable = this._collectImportable(nodes);
		if (importable.length > 1) { this._renderBulkImport(panel, importable); }

		this._ensureFilesTree();
		const tree = this._filesTree!;
		const container = this._filesTreeContainer!;
		append(panel, container);

		// Narrow the rows to the active filter (P4.2): a blank filter shows the whole tree unchanged. The filter
		// matches a row's label AND - restoring the old Search tab's reach - a document's body text: `searchTreeRail`
		// (the single home of title-OR-body matching) resolves the docs whose body contains the query, and the tree
		// keeps those doc rows even when their label does not match, so a body-only phrase still finds the document.
		const bodyMatches = this._bodyMatchResources(documents);
		const visible = filterTreeRailNodes(nodes, this._filter, bodyMatches);
		if (visible.length) {
			// Per-leaf action listeners (import / use-as-source) are owned by the renderer's per-row template store,
			// cleared when a row is recycled or disposed - so a rebuild never leaks the previous generation.
			tree.setChildren(null, visible.map(n => this._toTreeElement(n)));
		} else {
			// The filter matched nothing: keep the tree mounted but empty and say so, so the input stays live.
			tree.setChildren(null, []);
			append(panel, $('div.rail-empty')).textContent = localize('livingDocs.treeRail.noMatches', "No documents match '{0}'.", this._filter.trim());
		}

		if (!visible.length) { return; }
		this._layoutFilesTree();
		this._highlightActiveDoc();
	}

	/**
	 * The Recent strip (plan 52 WP-D2): the documents you have opened, most-recent first, capped at five, as its
	 * own compact band at the FOOT of the Files pane - not as rows inside the tree.
	 *
	 * Why a vertical strip rather than a row of horizontal chips: the rail is ~248px wide and document titles
	 * here run long ("Project Brief - Northwind Migration", "Appendix - Design Tokens"). Five chips across that
	 * width give each about 40px, so every chip would be an ellipsis; chips that size to their content need a
	 * horizontal scroller, which hides the very entries the affordance exists to expose. A stacked band of
	 * 24px rows shows five full titles in ~140px, reads at a glance, and folds away to a single caption line
	 * when it is not wanted (the fold persists, sharing the same collapse set the tree's folders use).
	 *
	 * Where it sits, and why that is NOT what keeps a double-click honest (fix round 2 / R-1): a band that changes
	 * size moves click targets wherever it is put. Above the tree it moved the tree's rows; below the tree it moved
	 * its OWN rows into the space the tree gave up - and every strip row opens a different document, so that was
	 * the worse of the two. What actually protects the gesture is `ClickGestureGuard`: no redraw at all lands
	 * between the two clicks. With that held separately, the strip sits where it belongs - at the head of the pane,
	 * where the hand starts - rather than where the geometry hurt least.
	 *
	 * Why it hides below two entries: see `RECENT_STRIP_MIN`. The strip deliberately keeps the ACTIVE document a
	 * row too - marked, not hidden - so the band reads as "where you are, and where you just were".
	 */
	private _renderRecentStrip(panel: HTMLElement, documents: readonly ILivingDocSummary[]): void {
		const items = buildRecentDocItems(documents.map(d => this._toDocInput(d)), this._recentDocResources(documents));
		if (!items.length) { return; } // nothing worth a jump-list yet: the strip is absent, not an empty box
		const strip = append(panel, $('div.rail-recent'));
		const collapsed = this._collapsedFolders.has(RECENT_STRIP_ID);
		const head = append(strip, $('button.rail-recent-head')) as HTMLButtonElement;
		head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		// The twistie mirrors the tree's: pointing right when folded, down when open. Kept as escapes so the
		// source stays ASCII-only (the hygiene rule); textContent renders them directly.
		append(head, $('span.rail-recent-twistie')).textContent = collapsed ? '\u25B8' : '\u25BE';
		append(head, $('span.rail-recent-title')).textContent = localize('livingDocs.treeRail.recent', "Recent");
		append(head, $('span.rail-recent-count')).textContent = `${items.length}`;
		this._renderDisposables.add(addDisposableListener(head, 'click', () => {
			if (collapsed) { this._collapsedFolders.delete(RECENT_STRIP_ID); } else { this._collapsedFolders.add(RECENT_STRIP_ID); }
			this._persistCollapsedFolders();
			void this._render();
		}));
		if (collapsed) { return; }
		const active = this._editors.activeEditor?.resource?.toString();
		for (const item of items) {
			const resource = item.resource!; // every recent row is a document resolved from the folder's document set
			const row = append(strip, $(`button.rail-recent-item${resource.toString() === active ? '.active' : ''}`)) as HTMLButtonElement;
			// The same leading status dot the tree row carries (issue #212), from the same `item.dot` - one
			// document, one status vocabulary, wherever it is drawn.
			append(row, $(`span.rail-status.rail-status-${item.dot.shape === 'dash' ? 'dash' : 'dot'}.rail-status-${item.dot.color}`));
			append(row, $('span.rail-item-label')).textContent = item.label;
			// Long titles ellipsise in a 248px rail, so the full title lives in a managed hover (IHoverService),
			// registered on the per-render store - this method runs on every onDidChange, so `this._register`
			// here would leak one hover per render.
			this._renderDisposables.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), row, item.label));
			// Preview semantics match the tree (plan 52 WP-F): a single click opens the group's preview tab, a
			// double click pins it. Focus is left to the editor's own default - the document surface is a webview
			// and takes the keyboard on activation either way, so a `preserveFocus` argument here decides nothing.
			this._renderDisposables.add(addDisposableListener(row, 'click', () => {
				void this._editors.openEditor({ resource, options: { pinned: false } });
			}));
			this._renderDisposables.add(addDisposableListener(row, 'dblclick', () => {
				void this._editors.openEditor({ resource, options: { pinned: true } });
			}));
			this._renderDisposables.add(addDisposableListener(row, 'contextmenu', e => {
				e.preventDefault();
				e.stopPropagation();
				this._showDocMenu({ x: e.clientX, y: e.clientY }, resource, item.label);
			}));
		}
	}

	// The Files type-to-filter (P4.2): a quiet input that narrows the tree live. Focus discipline (plan-42
	// quiet-shell): it only reacts to its own `input` events, so typing while the editor is focused never
	// reaches it - the criterion "filter must not steal keyboard focus from the editor". Focus is restored to
	// the input after a background re-render only when a filter is already active, so an idle rail never grabs
	// focus from the editor.
	private _renderFilter(panel: HTMLElement): void {
		const wrap = append(panel, $('div.rail-filter'));
		const input = append(wrap, $('input.rail-filter-input')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = localize('livingDocs.treeRail.filterPlaceholder', "Filter documents…");
		input.setAttribute('aria-label', localize('livingDocs.treeRail.filterLabel', "Filter documents"));
		input.value = this._filter;
		this._renderDisposables.add(addDisposableListener(input, 'input', () => {
			this._filter = input.value;
			void this._render();
		}));
		if (this._filter) {
			input.focus();
			input.setSelectionRange(this._filter.length, this._filter.length);
		}
	}

	// The set of documents whose *body text* matches the active filter (P4.2, the folded-in Search's content
	// reach): reuse `searchTreeRail` - the single home of title-OR-body matching - over the loaded document
	// bodies, and project its hits down to the `resource.toString()` keys the tree filter checks. A blank filter
	// short-circuits to the empty set (no body work when nothing is typed); an unloaded document contributes an
	// empty body, so it matches only by title, exactly as the old Search tab behaved.
	private _bodyMatchResources(documents: readonly ILivingDocSummary[]): Set<string> {
		if (!this._filter.trim()) { return new Set(); }
		const docs = documents.map(d => ({ title: d.title, resource: d.resource, body: this._livingDocs.getDoc(d.resource)?.body ?? '' }));
		return new Set(searchTreeRail(docs, this._filter).map(hit => hit.resource.toString()));
	}

	// One document summary, in the shape the pure tree module consumes. Shared by every surface that draws
	// document rows (the Files tree, the Recent strip, the Context tab's workspace sources), so the status-dot
	// inputs are threaded through in exactly one place.
	private _toDocInput(d: ILivingDocSummary): { title: string; resource: URI; pendingCount: number; sources: readonly string[]; folder?: string; isLiving?: boolean; unseenAgentEdits?: number; relinkCount?: number; stale?: boolean; fanoutFailed?: boolean; needsSourceBinding?: boolean } {
		return {
			title: d.title, resource: d.resource, pendingCount: d.pendingCount, sources: d.sources, folder: d.folder, isLiving: d.isLiving,
			// The Files-rail status dot inputs (issue #212): passed straight through from the summary so the pure
			// tree module computes each doc's leading dot via the shared precedence ladder.
			unseenAgentEdits: d.unseenAgentEdits, relinkCount: d.relinkCount, stale: d.stale, fanoutFailed: d.fanoutFailed,
			// PN.1 (routed from 48-c/#233): a template-born doc with no source bound carries the "bind sources" nudge.
			needsSourceBinding: d.needsSourceBinding,
		};
	}

	// The ONE freshness vocabulary for the SOURCES meta (#122 F12): map each bound source LABEL to its state so
	// the tree agrees with the Knowledge table. A value source is 'stale' when any document that binds it reports
	// a stale binding key in that source's namespace (the engine's real hash-drift set, read synchronously via
	// getFreshness); otherwise 'fresh'. Discovered extras (no owning document) are left absent - a bare file has
	// no freshness. Pure read - no mutation, warn-never-auto-fix intact.
	private _sourceFreshnessByLabel(documents: readonly ILivingDocSummary[], extras: readonly string[]): Map<string, TreeRailFreshness> {
		const out = new Map<string, TreeRailFreshness>();
		// The folder's actual files, from the same extras scan the sources section is built from. A bound source
		// whose file is not among them is GONE - the phantom the app's own `Delete…` leaves behind, because it
		// removes the file but not the `sources:` frontmatter naming it (fix round 1 / C-2).
		const present = new Set(extras);
		for (const d of documents) {
			if (!d.sources.length) { continue; }
			const freshness = this._livingDocs.getFreshness(d.resource);
			const staleNamespaces = new Set(freshness.staleBindings.map(keyNamespace));
			for (const source of d.sources) {
				const stale = staleNamespaces.has(sourceNamespace(source)) || freshness.staleContext.includes(source);
				const state: TreeRailFreshness = isMissingSource(source, present) ? 'missing' : stale ? 'stale' : 'fresh';
				// A source stale (or gone) for ANY document reads that way in the rail - worst-case wins, like the
				// Knowledge table. `missing` is the strongest statement of the three, so it is never overwritten.
				if (out.get(source) === 'missing') { continue; }
				if (state !== 'fresh' || !out.has(source)) { out.set(source, state); }
			}
		}
		return out;
	}

	// The MRU document resources for the Recent strip (issue #212, plan 52 WP-D2, fix round 1 / R-2), newest
	// first and de-duplicated. Two sources, in this order:
	//  1. `_openedDocs` - what this window actually OPENED, recorded on each activation. This is the real answer,
	//     and the only one that survives the default single-click journey: a preview tab is closed and disposed
	//     when the next preview replaces it, and the editor history drops a disposed input with it, so history
	//     alone reported exactly one recent no matter how many documents had been visited;
	//  2. the editor history - the fallback for documents opened BEFORE this rail was created (the rail is a lazy
	//     view, so a session can be under way by the time it first renders) and for restored editors.
	// Entries that are not documents in the current folder set are left for the pure module to drop. Nothing is
	// frozen here any more (fix round 1 froze the band while the pointer hovered it): a hover-scoped freeze is
	// defeated by any excursion between the two clicks, and the gesture-scoped guard holds the whole redraw.
	private _recentDocResources(documents: readonly ILivingDocSummary[]): URI[] {
		const docKeys = new Set(documents.map(d => d.resource.toString()));
		const out: URI[] = [];
		const seen = new Set<string>();
		const add = (resource: URI | undefined): void => {
			if (!resource) { return; }
			const key = resource.toString();
			if (seen.has(key) || !docKeys.has(key)) { return; }
			seen.add(key);
			out.push(resource);
		};
		for (const resource of this._openedDocs) { add(resource); }
		for (const entry of this._history.getHistory()) { add(entry.resource); }
		return out;
	}

	private _ensureFilesTree(): void {
		if (this._filesTree) { return; }
		const container = $('div.rail-files-tree');
		this._filesTreeContainer = container;
		const tree = this._register(this.instantiationService.createInstance(
			WorkbenchObjectTree<ITreeRailNode, void>,
			'livingDocsFilesTree',
			container,
			new TreeRailDelegate(),
			[
				new TreeRailFolderRenderer(),
				new TreeRailLeafRenderer({
					renderLeafActions: (node, host) => this._renderLeafActions(node, host),
					// The status dot's hover (issue #212): a managed IHoverService hover with the mouse delegate, so
					// the tooltip follows the rail's hover timing. The renderer registers the returned disposable in the
					// per-row template store, so a recycled row disposes its hover - no leak across the tree's row pool.
					setupHover: (el, content) => this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), el, content),
					// Inline rename (P6.3): mount an edit-in-place input on the row being renamed, else render normally.
					renderRenameInput: (node, label) => this._renderRenameInput(node, label),
				}),
			],
			{
				accessibilityProvider: new TreeRailAccessibilityProvider(),
				identityProvider: { getId: (e: ITreeRailNode) => e.id },
				expandOnlyOnTwistieClick: false,
				// Children indent 14px per level (P5.5), matching the mock's 14px child inset. NOTE: WorkbenchObjectTree
				// discards this per-instance option and uses `workbench.tree.indent` (listService.ts), so the value that
				// actually reaches the widget is the config default we set to 14 in livingDocs.contribution.ts (routed via
				// orchestrator, plan 44 ownership). This option is kept as documentation of the intended per-level inset.
				indent: 14,
				overrideStyles: { listBackground: 'sideBar.background' },
				// Fast navigation (issue #212): type-to-filter (type-ahead) + the Ctrl/Cmd+F find widget. The label
				// provider gives the tree each row's searchable text (a folder's name, a leaf's item label); the
				// WorkbenchObjectTree already supplies the contextViewProvider, so this lights up BOTH the type-ahead
				// highlight and the find widget with no extra wiring.
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (e: ITreeRailNode) => e.type === 'folder' ? e.label : e.item.label,
				},
				findWidgetEnabled: true,
			},
		)) as WorkbenchObjectTree<ITreeRailNode, void>;
		this._filesTree = tree;

		// Persist the collapse state so expansion survives restart (issue #171 acceptance). Programmatic
		// reveal-to-active expansions are suppressed so they never overwrite the user's own collapse choices.
		this._register(tree.onDidChangeCollapseState(e => {
			if (this._suppressCollapsePersist) { return; }
			const node = e.node.element;
			if (!node || node.type !== 'folder') { return; }
			if (e.node.collapsed) { this._collapsedFolders.add(node.id); } else { this._collapsedFolders.delete(node.id); }
			this._persistCollapsedFolders();
		}));

		// Selecting a document opens it (click or keyboard Enter, both funnel through onDidOpen). A SOURCES row
		// opens the source as a product tab on the same strip (pin 7 / P7.4) - never a plain text editor - so a
		// source is a first-class working surface alongside the document.
		this._register(tree.onDidOpen(e => {
			const el = e.element;
			if (el?.type !== 'leaf' || !el.item.resource) { return; }
			if (el.item.kind === 'doc') {
				// Preview tabs (plan 52 WP-F) come free from core: the tree widget's own `ResourceNavigator`
				// (`platform/list/browser/listService.ts`) already decides pinned-ness the VS Code way and hands it
				// to us on the open event - a single click gives `pinned: false` (open as the group's PREVIEW tab,
				// which the next single click REUSES), a double click gives `pinned: true`. This is exactly what the
				// built-in Explorer does with `e.editorOptions.pinned`; before WP-F this site hard-coded
				// `pinned: true`, which is why no tab was ever a preview. Focus is the one place the fork's own
				// behaviour is kept: a keyboard open moves focus into the document, a mouse open leaves it here.
				//
				// Remember that THIS TREE opened it, so the highlight that follows does not scroll the tree to a
				// row the user just picked out of it (fix round 2 / R-1).
				this._treeOpened = el.item.resource.toString();
				void this._editors.openEditor({
					resource: el.item.resource,
					options: { pinned: e.editorOptions.pinned, preserveFocus: e.browserEvent?.type === 'keydown' ? false : e.editorOptions.preserveFocus },
				});
			} else if (el.item.kind === 'source') {
				// A source row stays PINNED: opening a data file is a deliberate "work with this" gesture, and a
				// previewing source would evict the document being peeked (a group owns exactly one preview slot).
				void this._livingDocs.openSourceTab(el.item.resource);
			}
		}));

		// The right-click menu (pin 6): a document gets the full four-group menu (P6.1); a source / other real-file
		// row keeps the lighter provenance-safe menu. Both render through the restyled native ContextMenuService.
		this._register(tree.onContextMenu(e => {
			const el = e.element;
			if (el?.type !== 'leaf' || !el.item.resource) { return; }
			// The tree's anchor is the row element (right-click) or a mouse position (keyboard menu key).
			const anchor = isHTMLElement(e.anchor) ? e.anchor : { x: e.anchor.posx, y: e.anchor.posy };
			if (el.item.kind === 'doc') {
				this._showDocMenu(anchor, el.item.resource, el.item.label);
			} else {
				this._showSourceMenu(anchor, el.item.resource, el.item.label);
			}
		}));
	}

	private _layoutFilesTree(): void {
		if (!this._filesTree || !this._filesTreeContainer) { return; }
		const height = this._filesTreeContainer.clientHeight || this._body?.clientHeight || 400;
		this._filesTree.layout(height, this._filesTreeContainer.clientWidth || undefined);
	}

	// Map a data node to the widget's element tree, applying the persisted collapse state to folders (a folder
	// defaults to expanded unless the user collapsed it - except the Assets bucket, which is seeded collapsed on
	// first open by _seedAssetsCollapsed so the screenshot flood never renders; leaves are never collapsible).
	private _toTreeElement(node: ITreeRailNode): IObjectTreeElement<ITreeRailNode> {
		if (node.type === 'leaf') { return { element: node }; }
		return {
			element: node,
			collapsible: true,
			collapsed: this._collapsedFolders.has(node.id),
			children: node.children.map(c => this._toTreeElement(c)),
		};
	}

	// Reveal + select the active document's node so the open document is highlighted in the tree (issue #171).
	// Ancestor folders are expanded (transiently, without persisting) so the highlighted row is actually visible.
	//
	// The SCROLL is skipped when this tree is what opened the document (fix round 2 / R-1). A reveal exists for
	// navigation the user did not initiate in this list - a jump from the strip, a tab, the quick switcher, an
	// agent. When they clicked the row themselves it was already in front of them, and scrolling it "into view"
	// only throws away the place they had scrolled to: on a 30-document tree a click on the last row pulled the
	// tree ~690px back to the top. Selection and focus still move, so the row is still marked.
	private _highlightActiveDoc(): void {
		const tree = this._filesTree;
		if (!tree) { return; }
		const resource = this._editors.activeEditor?.resource;
		if (this._treeOpened && this._treeOpened !== resource?.toString()) { this._treeOpened = undefined; }
		if (!resource) { tree.setSelection([]); return; }
		let match: ITreeRailLeafNode | undefined;
		let ancestors: ITreeRailNode[] = [];
		const walk = (node: ITreeRailNode, path: ITreeRailNode[]): void => {
			if (match) { return; }
			if (node.type === 'leaf') {
				if (node.item.resource?.toString() === resource.toString()) { match = node; ancestors = path; }
			} else {
				for (const c of node.children) { walk(c, [...path, node]); }
			}
		};
		for (const root of tree.getNode().children.map(c => c.element)) { if (root) { walk(root, []); } }
		if (!match) { tree.setSelection([]); return; }
		this._suppressCollapsePersist = true;
		try {
			for (const folder of ancestors) { tree.expand(folder); }
		} finally {
			this._suppressCollapsePersist = false;
		}
		if (this._treeOpened !== resource.toString()) { tree.reveal(match); }
		tree.setSelection([match]);
		tree.setFocus([match]);
	}

	// Collect every importable `.docx` across the whole tree (for the bulk-import banner count).
	private _collectImportable(nodes: readonly ITreeRailNode[]): ITreeRailItem[] {
		const out: ITreeRailItem[] = [];
		const walk = (node: ITreeRailNode): void => {
			if (node.type === 'leaf') {
				if (node.item.kind === 'unsupported' && node.item.importable) { out.push(node.item); }
			} else {
				for (const c of node.children) { walk(c); }
			}
		};
		for (const n of nodes) { walk(n); }
		return out;
	}

	// "I found N Word documents - import them?" (doc 22 section 2): one button that imports every waiting
	// `.docx` in turn through the same single-file path, so the tree refreshes as each becomes a document.
	private _renderBulkImport(panel: HTMLElement, importable: readonly ITreeRailItem[]): void {
		const btn = append(panel, $('button.rail-import.rail-import-bulk')) as HTMLButtonElement;
		btn.textContent = `Import All ${importable.length} Word Documents`;
		const idleLabel = `Import All ${importable.length} Word Documents`;
		this._renderDisposables.add(addDisposableListener(btn, 'click', async () => {
			if (btn.disabled) { return; }
			btn.disabled = true;
			btn.textContent = 'Importing…';
			// Each successful import fires onDidChange and re-renders this rail; a refusal/error does not, so
			// restore the button in a finally or a refused file leaves it stuck disabled with no retry. The
			// per-file plain-words reason is surfaced by the service's own notification. Keep going through the
			// batch so one refused document does not strand the rest.
			try {
				for (const item of importable) { await this._livingDocs.importDocx(item.label); }
			} finally {
				btn.disabled = false;
				btn.textContent = idleLabel;
			}
		}));
	}

	// Fill the trailing action area of one leaf row in the file tree (issue #171): the import door, the
	// "Use as source" button, or the not-yet-imported note (the status dot is the LEADING indicator, drawn by the
	// renderer from item.dot - issue #212). The tree renderer calls this on
	// every (re)render of a row and disposes the returned store when the row is recycled - so listeners are
	// scoped to the row's lifetime, not this view's. Open + context-menu are handled by the tree widget.
	private _renderLeafActions(node: ITreeRailLeafNode, host: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		const item = node.item;
		// PN.1 (routed from 48-c/#233): a template-born document with no source bound carries a quiet "bind
		// sources" nudge, inviting the user to connect its data. Clicking it opens the document and reveals the
		// Context tab's Add-source flow (the same door as the menu's "Bind sources…"). It clears the moment a
		// source binds - `needsSourceBinding` goes false and this render no longer draws the chip.
		if (item.kind === 'doc' && item.resource && item.needsSourceBinding) {
			const resource = item.resource;
			const nudge = append(host, $('button.rail-nudge')) as HTMLButtonElement;
			nudge.textContent = localize('livingDocs.treeRail.bindNudge', "Bind sources");
			nudge.title = localize('livingDocs.treeRail.bindNudgeTooltip', "This document has no data connected yet - bind a source.");
			store.add(addDisposableListener(nudge, 'click', e => {
				e.stopPropagation();
				void this._bindSources(resource);
			}));
		}
		// A `.docx` we CAN convert turns the F10 marker into a door: an "Import as document" button that
		// converts it to a Living Document beside the untouched original (issue #129, doc 22 section 2).
		if (item.kind === 'unsupported' && item.importable) {
			const name = item.label;
			const importBtn = append(host, $('button.rail-import')) as HTMLButtonElement;
			importBtn.textContent = 'Import as Document';
			store.add(addDisposableListener(importBtn, 'click', async e => {
				e.stopPropagation();
				if (importBtn.disabled) { return; }
				importBtn.disabled = true;
				importBtn.textContent = 'Importing\u2026';
				// On success the service fires onDidChange and this rail re-renders (the row becomes a document,
				// so this button is gone). On any refusal or error it does NOT fire, so without this restore the
				// row is left permanently stuck on a disabled "Importing\u2026" with no retry. The specific plain-words
				// reason (proxy down, encrypted/legacy/unparseable file, write failure) is surfaced by the
				// service's own notification - the same channel every other livingDocs refusal uses.
				try {
					const outcome = await this._livingDocs.importDocx(name);
					if (outcome?.ok) { return; }
				} catch {
					// A rejected promise falls through to the same restore as an ok:false refusal.
				}
				importBtn.disabled = false;
				importBtn.textContent = 'Import as Document';
			}));
		} else if (item.note) {
			// A file we still cannot import is shown, never dropped, with its plain-words reason (F10).
			const note = append(host, $('span.rail-item-note'));
			note.textContent = `not yet imported \u2014 ${item.note}`;
			note.title = item.note;
		}
		// A workbook / PDF SOURCES row offers "Use as source" (issue #131): extract sheets to CSVs, or a PDF's
		// text to read-only context. Inline button (the row has no backing document, so no context menu).
		if (item.action) {
			const action = item.action;
			const label = item.label;
			const button = append(host, $('button.rail-srcaction')) as HTMLButtonElement;
			button.textContent = 'Use as source';
			store.add(addDisposableListener(button, 'click', e => {
				e.stopPropagation();
				void this._useAsSource(action, label);
			}));
		}
		// The trailing amber pending dot is gone (issue #212): pending changes now show as the LEADING yellow
		// status dot the renderer draws from `item.dot`, so a document has one status indicator, not two.
		return store;
	}

	// The right-click menu on a document row (pin 6 / P6.1): four groups - Open / Open to the right \u00b7 Rename\u2026 /
	// Duplicate / Move to\u2026 \u00b7 Bind sources\u2026 / View history / Present \u00b7 Delete. The action list itself now lives in
	// `documentContextMenu.ts`, shared VERBATIM with the product-tab strip's right-click menu (plan 52 WP-F), so
	// the two menus can never drift apart. Rendered by the RESTYLED native ContextMenuService (P6.7 - no parallel
	// menu): the 208px/radius-12/30px-rows skin is a document-scoped stylesheet keyed to the class named here.
	private _showDocMenu(anchor: HTMLElement | IAnchor, resource: URI, label: string): void {
		const actions = createDocumentMenuActions(this._menuServices(), resource, label);
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions, getMenuClassName: () => DOCUMENT_MENU_CLASS_NAME });
	}

	// A source / non-document leaf row keeps the lighter provenance-safe menu (it has no living-doc affordances):
	// Add to chat, plus rename/delete on a real file. Delete stays the LAST entry so the removed-ink skin lands.
	private _showSourceMenu(anchor: HTMLElement | IAnchor, resource: URI, label: string): void {
		const actions = createSourceMenuActions(this._menuServices(), resource, label);
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions, getMenuClassName: () => DOCUMENT_MENU_CLASS_NAME });
	}

	// The services the shared document menu needs, gathered from this view's constructor-injected ones.
	private _menuServices(): IDocumentMenuServices {
		return { editorService: this._editors, livingDocs: this._livingDocs, dialogService: this._dialogService, quickInputService: this._quickInput };
	}

	// "Bind sources\u2026" (P6.5): reveal the Context tab's Add-source flow for a document - the SAME door the PN.1
	// nudge uses, and the door the menu item reaches through `requestBindSources` (which opens the document and
	// reveals this rail first, so a tab right-click lands here too). Switching to Context and expanding the
	// "+ Add source" picker puts the user on the bind affordance with no extra click.
	private async _bindSources(resource: URI): Promise<void> {
		await this._editors.openEditor({ resource, options: { pinned: true } });
		this._tab = 'context';
		this._srcCandidates = await this._livingDocs.getSourceCandidates(resource);
		this._srcAdding = true;
		await this._render();
	}

	// "Use as source" on a workbook / PDF row (issue #131). Resolves the file name to its URI, then routes to
	// the service: a workbook extracts each sheet to a CSV; a PDF extracts its text as read-only context for
	// the active document. The service raises the plain-words result toast (success, named limitation, or an
	// unreadable/scanned reason), and its onDidChange re-renders this rail once the new sources land.
	private async _useAsSource(action: TreeRailAction, name: string): Promise<void> {
		const resource = await this._livingDocs.resolveWorkspaceExtra(name);
		if (!resource) {
			// The classifier listed this row from disk, but the file may have been moved or renamed
			// since the tree rendered (the one classifier->click race). Name that plainly rather than
			// swallow the click - the button stays clickable, so the row remains actionable.
			await this._dialogService.info('That file could not be found', `"${name}" may have been moved or renamed since this list was built. Refresh the sources and try again.`);
			return;
		}
		if (action === 'use-xlsx') {
			await this._livingDocs.useXlsxAsSource(resource);
			return;
		}
		// A PDF is read-only CONTEXT for a document, so it needs an active document to attach to.
		const active = this._editors.activeEditor?.resource;
		if (!active || !active.path.endsWith('.md')) {
			await this._dialogService.info('Open a document first', `Open the document that ${name} should inform, then use it as a source.`);
			return;
		}
		await this._livingDocs.usePdfAsSource(resource, active);
	}

	// Inline rename (P6.3): put the row into edit-in-place mode. Sets the renaming resource, re-renders so the
	// owning surface mounts the input on that row, then Enter commits / Esc cancels through the silent-rename
	// service (plan 42 L5: no modal, no toast on success).
	//
	// It has to reveal the tab the row is actually ON (fix round 1 / C-1). This used to switch to Files
	// unconditionally and ask the TREE to find the row - which was right while sources were tree rows, and
	// silently dead the moment D3 moved them to the Context tab: nothing matched, no editor appeared, the file
	// was untouched, and the user was thrown out of the tab they were working in with no explanation.
	private _startInlineRename(resource: URI): void {
		const tab: TreeRailTab = this._isDocumentResource(resource) ? 'files' : 'context';
		if (this._tab !== tab) { this._tab = tab; }
		this._renaming = resource.toString();
		void this._render();
	}

	// Is this file one of the workspace's DOCUMENTS (a Files-tree row), or a SOURCE (a Context-tab row)? Markdown
	// is the document format - `buildFileTree` puts every `.md` in the tree and never in the sources set - so the
	// file's own extension answers it, the same test `_useAsSource` already uses for "is a document open". A
	// loaded model is accepted first so a document is never mis-routed on an unusual extension.
	private _isDocumentResource(resource: URI): boolean {
		return !!this._livingDocs.getDoc(resource) || resource.path.toLowerCase().endsWith('.md');
	}

	// Mount the edit-in-place input for the row being renamed (P6.3), returning its disposable so the row's own
	// renderer scopes its lifetime. Called by BOTH surfaces that draw a renamable row - the Files tree's leaf
	// renderer for a document, `_renderSourceRow` for a workspace source - so the two cannot grow different
	// rename behaviours. Enter commits the trimmed stem through the service's silent renameFile (the title
	// frontmatter follows + the lock sidecar moves, plan 42 L5); Esc or a blur cancels. The extension is
	// preserved automatically by renameFile, so the input edits only the visible stem.
	private _renderRenameInput(node: ITreeRailLeafNode, label: HTMLElement): IDisposable | undefined {
		const item = node.item;
		if (!item.resource || item.resource.toString() !== this._renaming) { return undefined; }
		const resource = item.resource;
		const name = basename(resource);
		const dot = name.lastIndexOf('.');
		const stem = dot >= 0 ? name.slice(0, dot) : name;
		const store = new DisposableStore();
		const input = append(label, $('input.rail-rename-input')) as HTMLInputElement;
		input.type = 'text';
		input.value = stem;
		input.setAttribute('aria-label', item.kind === 'doc'
			? localize('livingDocs.treeRail.renameLabel', "Rename document")
			: localize('livingDocs.treeRail.renameSourceLabel', "Rename source"));
		let done = false;
		const finish = (commit: boolean): void => {
			if (done) { return; }
			done = true;
			const next = input.value.trim();
			this._renaming = undefined;
			if (commit && next && next !== stem) {
				void this._livingDocs.renameFile(resource, next);
			} else {
				// A cancel / no-op rename never fires onDidChange, so re-render to restore the static label.
				void this._render();
			}
		};
		store.add(addDisposableListener(input, 'keydown', e => {
			if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
			else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
		}));
		// A blur commits the pending name (matching the explorer's rename), unless Enter/Esc already resolved it.
		store.add(addDisposableListener(input, 'blur', () => finish(true)));
		// Stop a click on the input from reaching the tree row (which would open the document mid-rename).
		store.add(addDisposableListener(input, 'mousedown', e => e.stopPropagation()));
		// Focus + select the stem after the row paints (the tree mounts the template synchronously).
		queueMicrotask(() => { if (!done) { input.focus(); input.setSelectionRange(0, stem.length); } });
		return store;
	}

	// The Context tab: what the agent can see. Two halves, in this order:
	//  1. the ACTIVE DOCUMENT's context - its linked sources, referenced files, images, pasted text and company
	//     knowledge, with the "+ Add source" / "+ Add context" doors. Absent (with a plain-words invitation to
	//     open a document) when nothing is open;
	//  2. the WORKSPACE's sources - every data file the folder holds, whichever document is active, moved here
	//     from the Files tree by plan 52 WP-D3 so the tree can be exactly the folder's hierarchy.
	// The two answer different questions - "what feeds THIS document" versus "what does this project have to
	// work with" - so they are separate captioned sections rather than one merged list.
	private _renderContext(panel: HTMLElement, documents: readonly ILivingDocSummary[], extras: readonly string[]): void {
		this._renderDocumentContext(panel);
		this._renderWorkspaceSources(panel, documents, extras);
	}

	private _renderDocumentContext(panel: HTMLElement): void {
		const resource = this._activeSurfaceResource();
		const doc = resource ? this._livingDocs.getDoc(resource) : undefined;
		if (!resource || !doc) {
			append(panel, $('div.rail-empty')).textContent = localize('livingDocs.context.noDocument', "Open a document to see its context.");
			return;
		}
		const groups = buildContextGroups(doc, this._livingDocs.getFreshness(resource), this._livingDocs.getAddedContext(resource));
		if (!groups.length) {
			// A plain Markdown document that has not connected any data yet. On the entry path this is the
			// common state, so the copy stays markdown-first (plan 42 L3): it invites connecting data rather
			// than leading with "no bound sources" lock/provenance ceremony before the user has met an agent.
			// It stays truthful (issue #181) -- a document IS open, it simply has nothing connected -- and the
			// "Add source" / "Add context" affordances below are the doors that connect data here.
			append(panel, $('div.rail-empty')).textContent = localize('livingDocs.context.noBindings', "Connect a data source to keep figures in this document up to date.");
		}
		for (const group of groups) {
			append(panel, $('div.rail-folder')).textContent = `${group.label.toUpperCase()} \u00B7 ${group.items.length}`;
			const isLinkedSources = group.label === 'Linked sources';
			for (const ci of group.items) {
				const row = append(panel, $('div.rail-item'));
				append(row, $('span.rail-item-label')).textContent = ci.name;
				if (ci.detail) { append(row, $('span.rail-item-detail')).textContent = ci.detail; }
				// Linked sources (R5) and referenced files (R6) carry an unbind (x) - it rewrites the frontmatter.
				const unbind = isLinkedSources ? 'source' : (ci.kind === 'reference' ? 'reference' : undefined);
				if (unbind) {
					const name = ci.name;
					const remove = append(row, $('button.rail-srcremove')) as HTMLButtonElement;
					remove.textContent = '\u00D7';
					remove.title = unbind === 'source' ? 'Remove source' : 'Remove reference';
					this._renderDisposables.add(addDisposableListener(remove, 'click', e => {
						e.stopPropagation();
						void (unbind === 'source' ? this._livingDocs.removeSource(resource, name) : this._livingDocs.removeContextFile(resource, name));
					}));
				}
			}
			// The "+ Add source" picker sits under the Linked sources group (or stands alone if there are none yet).
			if (isLinkedSources) { this._renderAddSource(panel, resource); }
		}
		if (!groups.some(g => g.label === 'Linked sources')) { this._renderAddSource(panel, resource); }
		this._renderAddContext(panel, resource);
	}

	/**
	 * The workspace sources section (plan 52 WP-D3): every source the folder holds - bound sources, discovered
	 * data files, workbooks and PDFs offering "Use as source" - shown whichever document is active, and with
	 * none open at all. This is the Files tree's old synthetic "Sources" group, moved whole:
	 *  - each row still states its freshness ("synced" / "stale" / "context only") through `sourceMeta`, the
	 *    single home of that vocabulary, shared with the tree's leaf renderer;
	 *  - un-bound image/screenshot sources still sit behind ONE collapsed Assets bucket, seeded collapsed on
	 *    first open and persisted under the same `ASSETS_FOLDER_ID` key, so a folder of ~200 screenshots never
	 *    floods the pane (issue #171);
	 *  - each row still opens as a product tab on click and still raises the LIGHTER provenance-safe source
	 *    menu on right-click (Rename / Add to Chat / Delete), never the document menu - and `Rename…` now mounts
	 *    its edit-in-place input on THIS row (fix round 1 / C-1), which is where the source lives after D3.
	 *
	 * A folder with no data files renders nothing here at all - no caption, no empty-state line (fix round 1 /
	 * C-3), the same rule the Recent strip follows.
	 */
	private _renderWorkspaceSources(panel: HTMLElement, documents: readonly ILivingDocSummary[], extras: readonly string[]): void {
		const nodes = buildWorkspaceSourceNodes(documents.map(d => this._toDocInput(d)), extras, this._sourceFreshnessByLabel(documents, extras));
		// A folder with no data files says nothing at all (fix round 1 / C-3): a caption reading "\u00B7 0" over an
		// empty-state sentence is two rows of furniture for something that does not exist, and the Recent strip in
		// this same pane already follows the opposite rule. Absence is the calmest way to say "there is nothing".
		if (!nodes.length) { return; }
		// First sight of this workspace's assets: seed the bucket collapsed so the screenshot flood never renders.
		// One-time only - after this the bucket persists whatever the user chooses, like every other folder.
		this._seedAssetsCollapsed(nodes);
		const count = nodes.reduce((n, node) => n + (node.type === 'folder' ? node.children.length : 1), 0);
		// One localised sentence with a placeholder, never a localised fragment concatenated to a separator and a
		// number: a translation may need the count somewhere else entirely, and the separator is part of the
		// phrase, not punctuation the code owns.
		append(panel, $('div.rail-folder')).textContent = localize('livingDocs.context.workspaceSources', "Workspace sources \u00B7 {0}", count);
		for (const node of nodes) {
			if (node.type === 'leaf') { this._renderSourceRow(panel, node); continue; }
			// The Assets bucket: one collapsible row standing in for every un-bound screenshot (issue #171).
			const collapsed = this._collapsedFolders.has(node.id);
			const bucket = append(panel, $('button.rail-bucket')) as HTMLButtonElement;
			bucket.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
			append(bucket, $('span.rail-bucket-twistie')).textContent = collapsed ? '\u25B8' : '\u25BE';
			append(bucket, $('span')).textContent = node.label;
			this._renderDisposables.add(addDisposableListener(bucket, 'click', () => {
				if (collapsed) { this._collapsedFolders.delete(node.id); } else { this._collapsedFolders.add(node.id); }
				this._persistCollapsedFolders();
				void this._render();
			}));
			if (collapsed) { continue; }
			for (const child of node.children) {
				if (child.type === 'leaf') { this._renderSourceRow(panel, child, true); }
			}
		}
	}

	// One source row in the Context tab's workspace sources. The row's inline doors ("Use as source" for a
	// workbook / PDF, issue #131) are drawn by the SAME `_renderLeafActions` the Files tree uses, so the two
	// surfaces cannot offer different actions on the same file. `nested` insets rows inside the Assets bucket.
	private _renderSourceRow(panel: HTMLElement, node: ITreeRailLeafNode, nested = false): void {
		const item = node.item;
		const row = append(panel, $(`div.rail-item.rail-item-src${nested ? '.rail-item-nested' : ''}`));
		append(row, $('span.rail-item-glyph')).textContent = sourceKindGlyph(item.label);
		const label = append(row, $('span.rail-item-label'));
		// `Rename…` on a source lands HERE (fix round 1 / C-1) - the same edit-in-place input the tree mounts on a
		// document row, mounted by the SAME method, on the surface that now owns source rows. While the row is an
		// editor it is only an editor: no freshness meta, no "Use as source" door, no click-to-open underneath it.
		const rename = this._renderRenameInput(node, label);
		if (rename) {
			this._renderDisposables.add(rename);
			return;
		}
		label.textContent = item.label;
		const meta = sourceMeta(item);
		if (meta) {
			append(row, $(`span.rail-item-detail.rail-meta-${meta.tone}`)).textContent = meta.text;
		}
		this._renderDisposables.add(this._renderLeafActions(node, append(row, $('span.rail-tree-actions'))));
		// An api/mcp source, or a data file discovered on disk that no document binds, has no resource to act
		// on: it is listed (it is real) but it opens nothing and raises no menu - exactly as in the old tree.
		const resource = item.resource;
		if (!resource) { return; }
		row.setAttribute('role', 'button');
		row.tabIndex = 0;
		this._renderDisposables.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), row, item.label));
		// A source opens as a product tab on the same strip (pin 7 / P7.4), never a plain text editor, and stays
		// PINNED: opening a data file is a deliberate "work with this" gesture, so it never evicts a preview.
		const open = () => void this._livingDocs.openSourceTab(resource);
		this._renderDisposables.add(addDisposableListener(row, 'click', open));
		this._renderDisposables.add(addDisposableListener(row, 'keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
		}));
		this._renderDisposables.add(addDisposableListener(row, 'contextmenu', e => {
			e.preventDefault();
			e.stopPropagation();
			this._showSourceMenu({ x: e.clientX, y: e.clientY }, resource, item.label);
		}));
	}

	// The "+ Add source" affordance (R5): a button that, when opened, lists the folder's data files (csv/json)
	// not already bound; picking one writes the frontmatter `sources:` list via the service (no hand-editing).
	private _renderAddSource(panel: HTMLElement, resource: URI): void {
		if (!this._srcAdding) {
			const add = append(panel, $('button.rail-addctx.rail-addsrc')) as HTMLButtonElement;
			add.textContent = '\uFF0B Add source';
			this._renderDisposables.add(addDisposableListener(add, 'click', async () => {
				this._srcCandidates = await this._livingDocs.getSourceCandidates(resource);
				this._srcAdding = true;
				await this._render();
			}));
			return;
		}
		const form = append(panel, $('div.rail-addctx-form'));
		if (!this._srcCandidates.length) {
			append(form, $('div.rail-empty')).textContent = 'No more data files in this folder.';
		}
		for (const cand of this._srcCandidates) {
			const chip = append(form, $('button.rail-srccand')) as HTMLButtonElement;
			append(chip, $('span.rail-item-glyph')).textContent = '\u229E';
			append(chip, $('span')).textContent = cand;
			this._renderDisposables.add(addDisposableListener(chip, 'click', async () => {
				this._srcAdding = false;
				await this._livingDocs.addSource(resource, cand);
			}));
		}
		const cancel = append(form, $('button.rail-addctx-cancel')) as HTMLButtonElement;
		cancel.textContent = 'Cancel';
		cancel.style.marginTop = '8px';
		this._renderDisposables.add(addDisposableListener(cancel, 'click', () => { this._srcAdding = false; void this._render(); }));
	}

	// The comp's "+ Add context" affordance at the foot of the Context tab. Collapsed to a single button;
	// expands to a kind picker (Pasted text / Image / Company knowledge) + an input that calls the
	// service's addContext (data model already supports all three kinds) - so the user can populate the
	// Pasted text / Images / Company knowledge groups the data model defines.
	private _renderAddContext(panel: HTMLElement, resource: URI): void {
		if (!this._ctxAdding) {
			const add = append(panel, $('button.rail-addctx')) as HTMLButtonElement;
			add.textContent = '\uFF0B Add context';
			this._renderDisposables.add(addDisposableListener(add, 'click', async () => {
				this._ctxAdding = true;
				this._ctxFileCandidates = await this._livingDocs.getContextCandidates(resource);
				await this._render();
			}));
			return;
		}

		const form = append(panel, $('div.rail-addctx-form'));
		const kinds: { kind: 'file' | AddedContextKind; label: string }[] = [
			{ kind: 'file', label: 'File' },
			{ kind: 'pasted', label: 'Pasted text' },
			{ kind: 'image', label: 'Image' },
			{ kind: 'knowledge', label: 'Company knowledge' },
		];
		const chips = append(form, $('div.rail-addctx-kinds'));
		for (const k of kinds) {
			const chip = append(chips, $(`button.rail-addctx-chip${this._ctxKind === k.kind ? '.active' : ''}`)) as HTMLButtonElement;
			chip.textContent = k.label;
			this._renderDisposables.add(addDisposableListener(chip, 'click', async () => {
				this._ctxKind = k.kind;
				if (k.kind === 'file') { this._ctxFileCandidates = await this._livingDocs.getContextCandidates(resource); }
				await this._render();
			}));
		}

		// File kind (R6): reference a real folder file - a picker of candidates writes the context frontmatter.
		if (this._ctxKind === 'file') {
			if (!this._ctxFileCandidates.length) {
				append(form, $('div.rail-empty')).textContent = 'No more files in this folder to reference.';
			}
			for (const cand of this._ctxFileCandidates) {
				const pick = append(form, $('button.rail-srccand')) as HTMLButtonElement;
				append(pick, $('span.rail-item-glyph')).textContent = '\u25A3';
				append(pick, $('span')).textContent = cand;
				this._renderDisposables.add(addDisposableListener(pick, 'click', async () => {
					this._ctxAdding = false;
					await this._livingDocs.addContextFile(resource, cand);
				}));
			}
			const cancelFile = append(form, $('button.rail-addctx-cancel')) as HTMLButtonElement;
			cancelFile.textContent = 'Cancel';
			cancelFile.style.marginTop = '8px';
			this._renderDisposables.add(addDisposableListener(cancelFile, 'click', () => { this._ctxAdding = false; void this._render(); }));
			return;
		}

		const input = append(form, $('textarea.rail-addctx-input')) as HTMLTextAreaElement;
		input.placeholder = this._ctxKind === 'image' ? 'Image path or URL\u2026' : this._ctxKind === 'knowledge' ? 'A company fact the agent should know\u2026' : 'Paste a note for the agent\u2026';
		input.value = this._ctxDraft;
		this._renderDisposables.add(addDisposableListener(input, 'input', () => { this._ctxDraft = input.value; }));

		const actions = append(form, $('div.rail-addctx-actions'));
		const submit = append(actions, $('button.rail-addctx-add')) as HTMLButtonElement;
		submit.textContent = 'Add';
		const doAdd = async () => {
			const text = this._ctxDraft.trim();
			if (!text || this._ctxKind === 'file') { return; }
			const kind = this._ctxKind;
			this._ctxAdding = false;
			this._ctxDraft = '';
			await this._livingDocs.addContext(resource, kind, text);
		};
		this._renderDisposables.add(addDisposableListener(submit, 'click', () => void doAdd()));
		const cancel = append(actions, $('button.rail-addctx-cancel')) as HTMLButtonElement;
		cancel.textContent = 'Cancel';
		this._renderDisposables.add(addDisposableListener(cancel, 'click', () => { this._ctxAdding = false; this._ctxDraft = ''; void this._render(); }));

		// Keep focus on the input so a background re-render does not interrupt typing.
		input.focus();
		input.setSelectionRange(this._ctxDraft.length, this._ctxDraft.length);
	}

	private _renderOutline(panel: HTMLElement): void {
		const resource = this._activeSurfaceResource();
		const doc = resource ? this._livingDocs.getDoc(resource) : undefined;
		const entries = buildOutline(doc);
		if (!resource || !entries.length) {
			// Distinguish "no document open" from "document open but has no headings" (issue #181).
			append(panel, $('div.rail-empty')).textContent = resource
				? localize('livingDocs.outline.noHeadings', "This document has no headings yet.")
				: localize('livingDocs.outline.noDocument', "Open a document to see its outline.");
			return;
		}
		for (const e of entries) {
			// Each heading is a navigation target: clicking scrolls the editor surface to it (issue #181),
			// reusing the same rail-to-editor reveal channel the Review rail uses for pending changes.
			const row = append(panel, $(`div.rail-outline.lvl-${Math.min(e.level, 3)}`));
			row.textContent = e.text;
			row.setAttribute('role', 'button');
			row.tabIndex = 0;
			const reveal = () => this._livingDocs.revealHeading(resource, e.headingIndex);
			this._renderDisposables.add(addDisposableListener(row, 'click', reveal));
			this._renderDisposables.add(addDisposableListener(row, 'keydown', ev => {
				if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); reveal(); }
			}));
		}
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-rail .rail-tabs{flex:none;height:38px;display:flex;align-items:center;gap:2px;padding:0 10px;border-bottom:1px solid #EEF0F3}
		.living-docs-rail .rail-tabs-spacer{flex:1}
		.living-docs-rail .rail-tab{border:none;background:none;cursor:pointer;height:26px;padding:0 10px;display:flex;align-items:center;border-radius:8px;font:500 12px/1 system-ui;color:#868B95}
		.living-docs-rail .rail-tab:hover{color:#52575F}
		.living-docs-rail .rail-tab.active{font-weight:600;color:#1A1C20;background:#fff;box-shadow:0 1px 2px rgba(20,22,28,.05)}
		.living-docs-rail .rail-new-doc{flex:none;border:none;background:none;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:7px;font:400 15px/1 system-ui;color:#868B95}
		.living-docs-rail .rail-new-doc:hover{background:#EEF0F3;color:#52575F}
		/* The Recent strip (plan 52 WP-D2): a compact band at the HEAD of the Files pane - a caption row that folds
		   it away, then up to five 24px rows. Deliberately quieter and denser than a tree row (24px vs 30px, 12.5px
		   vs 13px type) so it reads as a jump-list above the tree, never as a second copy of it. A hairline below
		   it separates "where you were" from the filter + the folder itself. Its size still changes as the MRU
		   fills, and that is safe now for a reason that has nothing to do with CSS: no redraw lands between the two
		   clicks of a double-click (fix round 2 / R-1, the ClickGestureGuard). */
		.living-docs-rail .rail-recent{flex:none;display:flex;flex-direction:column;padding:2px 4px 6px;border-bottom:1px solid #F1F2F6;margin-bottom:6px}
		.living-docs-rail .rail-recent-head{display:flex;align-items:center;gap:5px;width:100%;box-sizing:border-box;height:22px;padding:0 4px;border:none;background:none;cursor:pointer;border-radius:6px;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#A3A8B2;text-transform:uppercase;text-align:left}
		.living-docs-rail .rail-recent-head:hover{background:#F1F2F6;color:#868B95}
		.living-docs-rail .rail-recent-twistie{flex:none;width:10px;font-size:10px;line-height:1;color:#A3A8B2}
		.living-docs-rail .rail-recent-count{margin-left:auto;flex:none;letter-spacing:0;color:#C2C6CE}
		.living-docs-rail .rail-recent-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;height:24px;padding:0 8px;border:none;background:none;cursor:pointer;border-radius:6px;font:400 12.5px/1 system-ui;color:#52575F;text-align:left}
		.living-docs-rail .rail-recent-item:hover{background:#F1F2F6;color:#26292F}
		/* The document you are in stays IN the strip, marked with the tree's selected-row treatment, so the strip
		   reads as "where you are, and where you just were" rather than as a duplicate list. */
		.living-docs-rail .rail-recent-item.active{background:#F4F5FD;color:#2A2F60;box-shadow:inset 0 0 0 1px #E0E5FB}
		.living-docs-rail .rail-recent-item .rail-status{flex:none;display:inline-flex;align-items:center;justify-content:center;width:7px;height:7px}
		.living-docs-rail .rail-recent-item .rail-status-dot{width:7px;height:7px;border-radius:999px}
		.living-docs-rail .rail-recent-item .rail-status-dash{width:8px;height:2px;border-radius:1px;background:#D5D8DE}
		.living-docs-rail .rail-recent-item .rail-status-dot.rail-status-grey{background:#D5D8DE}
		.living-docs-rail .rail-recent-item .rail-status-dot.rail-status-green{background:#2C8159}
		.living-docs-rail .rail-recent-item .rail-status-dot.rail-status-yellow{background:#C99A2E}
		.living-docs-rail .rail-recent-item .rail-status-dot.rail-status-red{background:#B5514B}
		.living-docs-rail .rail-filter{flex:none;padding:2px 4px 8px}
		.living-docs-rail .rail-filter-input{width:100%;box-sizing:border-box;border:1px solid #E9EAEE;background:#FBFCFD;color:var(--vscode-input-foreground);border-radius:9px;padding:7px 10px;font:400 12.5px/1 system-ui;outline:none}
		.living-docs-rail .rail-filter-input:focus{border-color:#9AA2E0}
		.living-docs-rail .rail-filter-input::placeholder{color:#A3A8B2}
		.living-docs-rail .rail-panel{flex:1;overflow-y:auto;padding:10px 8px}
		.living-docs-rail .rail-panel.rail-panel-files{display:flex;flex-direction:column;overflow:hidden;padding:6px 4px}
		.living-docs-rail .rail-files-tree{flex:1;min-height:0}
		/* Row shells (pin 5): folder rows 28px, doc/source rows 30px radius 8. Hover + selection paint the whole tree-widget row so the full 264px width lights up. */
		/* The workbench controls-tier clamp (styleOverrides roundedCorners.css) sets the list-row radius to var(--vscode-cornerRadius-small) = 4px at the !important tier, so a bare 8px declaration is overruled. This rule is more specific (the .rail-files-tree scope) AND !important, so equal-importance specificity resolves in the rail's favour and the 8px radius reaches the screen. */
		.living-docs-rail .rail-files-tree .monaco-list-row{border-radius:8px !important}
		/* Hover #F1F2F6 (P5.5): the widget paints hover through its own generated rule (the .monaco-list.list_id_N :hover:not(.selected):not(.focused) variant) reading --vscode-list-hoverBackground, more specific than a plain row-level rule here - so, as with selection, we pin the VARIABLE (below) rather than fight the widget rule. */
		/* Row inset (mock: padding 0 8px). The right pad applies to every row; the left pad applies only to leaf rows, whose content starts at the indent (folders keep the twistie flush left). */
		.living-docs-rail .rail-files-tree .monaco-tl-contents{padding-right:8px}
		.living-docs-rail .rail-files-tree .rail-tree-leaf{padding-left:8px}
		.living-docs-rail .rail-files-tree .rail-tree-folder{display:flex;align-items:center;height:100%;min-width:0;gap:6px}
		.living-docs-rail .rail-files-tree .rail-tree-folder-label{font:600 12.5px/1 system-ui;color:#52575F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.living-docs-rail .rail-files-tree .rail-tree-folder-count{margin-left:auto;flex:none;font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2}
		/* The chevron (P5.1): the widget's own twistie, restyled to a 9px glyph #A3A8B2 with a 150ms rotation. The widget toggles .collapsed (points right); expanded points down. */
		.living-docs-rail .rail-files-tree .monaco-tl-twistie{width:14px;transform:none}
		.living-docs-rail .rail-files-tree .monaco-tl-twistie::before{font-size:9px;color:#A3A8B2;transition:transform 150ms ease}
		.living-docs-rail .rail-files-tree .rail-tree-leaf{display:flex;align-items:center;gap:8px;height:100%;min-width:0;font:400 13px/1.3 system-ui;color:#26292F}
		.living-docs-rail .rail-files-tree .rail-tree-leaf-source .rail-item-label{color:#26292F;font-family:system-ui;font-size:12.5px}
		.living-docs-rail .rail-files-tree .rail-tree-glyph{flex:none;display:none;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:#5B6DC4;width:11px;text-align:center}
		.living-docs-rail .rail-files-tree .rail-status{flex:none;display:inline-flex;align-items:center;justify-content:center;width:7px;height:7px}
		.living-docs-rail .rail-files-tree .rail-status-dot{width:7px;height:7px;border-radius:999px}
		.living-docs-rail .rail-files-tree .rail-status-dash{width:8px;height:2px;border-radius:1px;background:#D5D8DE}
		/* Dot colours (P5.2): synced (ok) green, attention (pending) amber, plain #D5D8DE. The PR-212 red precedence ladder still wins in railStatus.ts, so a red-band doc keeps its treatment on top. */
		.living-docs-rail .rail-files-tree .rail-status-dot.rail-status-grey{background:#D5D8DE}
		.living-docs-rail .rail-files-tree .rail-status-dot.rail-status-green{background:#2C8159}
		.living-docs-rail .rail-files-tree .rail-status-dot.rail-status-yellow{background:#C99A2E}
		.living-docs-rail .rail-files-tree .rail-status-dot.rail-status-red{background:#B5514B}
		/* The trailing markers (P5.3): the LWD chip and the amber pending pill (never both, pending wins). */
		.living-docs-rail .rail-files-tree .rail-tree-marker{margin-left:auto;flex:none;display:inline-flex;align-items:center}
		.living-docs-rail .rail-files-tree .rail-tree-lwd{font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#5B6DC4;background:#fff;border:1px solid #E0E5FB;border-radius:5px;padding:2px 5px}
		.living-docs-rail .rail-files-tree .rail-tree-pending{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#8A6D1A;background:#FDFAF2;border:1px solid #E4DCCB;border-radius:999px;padding:2px 6px}
		/* The source row's right meta (P5.6): synced (green) / relative time. */
		.living-docs-rail .rail-files-tree .rail-tree-meta{margin-left:auto;flex:none;font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#A3A8B2}
		/* Selected row (P5.4): accent-tint bg + accent border, accent-ink text. The live list paints selection through its own per-instance rules (the focused .monaco-list.list_id_N:focus .monaco-list-row.selected and the inactive .monaco-list .monaco-list-row.selected), which read the --vscode-list-*Selection* CSS variables (defaultStyles maps them via asCssVariable). A row-level background here loses to those generated rules, so we override the VARIABLES scoped to the rail instead - the widget's own rules then render the spec colour. The spec says "Selected row = accent-tint #F4F5FD bg" with no focus distinction, so BOTH the focused (active) and blurred (inactive) selection backgrounds are pinned to #F4F5FD, and both selection foregrounds to the accent ink #2A2F60. The focus outlines are neutralised so the widget's blue focus ring never fights the #E0E5FB spec border (the inset box-shadow below). */
		.living-docs-rail .rail-files-tree{--vscode-list-activeSelectionBackground:#F4F5FD;--vscode-list-inactiveSelectionBackground:#F4F5FD;--vscode-list-activeSelectionForeground:#2A2F60;--vscode-list-inactiveSelectionForeground:#2A2F60;--vscode-list-hoverBackground:#F1F2F6;--vscode-list-focusOutline:transparent;--vscode-list-focusAndSelectionOutline:transparent;--vscode-list-inactiveFocusOutline:transparent}
		.living-docs-rail .rail-files-tree .monaco-list-row.selected{box-shadow:inset 0 0 0 1px #E0E5FB}
		.living-docs-rail .rail-files-tree .monaco-list-row.selected .rail-item-label,.living-docs-rail .rail-files-tree .monaco-list-row.selected .rail-tree-leaf{color:#2A2F60}
		.living-docs-rail .rail-files-tree .rail-tree-actions{flex:none;display:flex;align-items:center;gap:6px}
		/* Inline rename (P6.3): the edit-in-place input filling the label slot; Enter commits, Esc cancels. Stated
		   once for BOTH surfaces that can host it - a document row in the tree, and a workspace-source row in the
		   Context tab (fix round 1 / C-1) - so a rename looks the same wherever the file lives. */
		.living-docs-rail .rail-rename-input{width:100%;box-sizing:border-box;border:1px solid #9AA2E0;background:#fff;color:#26292F;border-radius:6px;padding:1px 5px;font:400 13px/1.3 system-ui;outline:none}
		/* The "bind sources" nudge (PN.1): a quiet accent chip on a template-born row with no source bound. */
		.living-docs-rail .rail-files-tree .rail-nudge{flex:none;border:1px solid #E0E5FB;background:#F4F5FD;color:#4650B8;border-radius:5px;padding:2px 6px;font:600 9.5px/1 system-ui;cursor:pointer;white-space:nowrap}
		.living-docs-rail .rail-files-tree .rail-nudge:hover{background:#E0E5FB}
		.living-docs-rail .rail-empty{font:400 12px/1.5 system-ui;color:var(--vscode-descriptionForeground);padding:8px 6px}
		.living-docs-rail .rail-folder{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;color:#A3A8B2;text-transform:uppercase;padding:10px 6px 6px}
		.living-docs-rail .rail-item{display:flex;align-items:center;gap:7px;padding:6px 8px 6px 18px;border-radius:6px;font:400 13px/1.3 system-ui;color:var(--vscode-foreground);cursor:default}
		.living-docs-rail .rail-item[role=button]{cursor:pointer}
		.living-docs-rail .rail-item[role=button]:hover{background:var(--vscode-list-hoverBackground)}
		.living-docs-rail .rail-item-source{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-item-glyph{color:oklch(0.55 0.13 255);flex:none}
		.living-docs-rail .rail-item-source .rail-item-glyph{color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-item-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		/* The row's trailing detail is a single quiet line, never a wrapping block: without nowrap a long detail
		   ("live - feeds 2 blocks") wrapped to two lines and crushed the source name beside it to "metrics....".
		   When the row still cannot fit both, the DETAIL yields and ellipsises - its freshness word leads, so
		   "stale - feeds..." keeps the part that matters while the file's own name, which is the row's identity,
		   stays whole. Flexbox distributes shrink in proportion to (factor x basis), so a factor of 20 still left
		   the NAME absorbing about 2.5% of the overflow - which is exactly why "metrics.csv" still ellipsised, by
		   half a pixel (label box 68.9px against 69.4px needed). At 200 the name's share of any realistic overflow
		   is sub-pixel and rounds away, which is what "the detail yields FIRST" was always meant to say. */
		.living-docs-rail .rail-item .rail-item-label{flex:1 1 auto}
		.living-docs-rail .rail-item-detail{margin-left:auto;flex:0 200 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground)}
		/* The ONE freshness vocabulary's tones (#122 F12), written once for BOTH surfaces that draw a source row:
		   the Files tree's leaf renderer and the Context tab's workspace sources. The tree's own meta rule is one
		   class deeper (.rail-files-tree), so each tone is stated at both depths rather than fought with !important. */
		.living-docs-rail .rail-meta-stale,.living-docs-rail .rail-files-tree .rail-meta-stale{color:#8A6D1A}
		.living-docs-rail .rail-meta-context-only,.living-docs-rail .rail-files-tree .rail-meta-context-only{color:#868B95}
		.living-docs-rail .rail-meta-synced,.living-docs-rail .rail-files-tree .rail-meta-synced{color:#5D8A66}
		/* A workspace-source row in the Context tab (plan 52 WP-D3): the tab's own row idiom, so it sits with the
		   Linked sources / Referenced files rows rather than importing the tree's row shell into a non-tree pane. */
		.living-docs-rail .rail-item-src{padding-left:8px}
		.living-docs-rail .rail-item-src .rail-item-label{flex:1}
		.living-docs-rail .rail-item-src .rail-item-glyph{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:#5B6DC4;width:11px;text-align:center}
		.living-docs-rail .rail-item-nested{padding-left:24px}
		/* The Assets bucket (issue #171): one collapsible row standing in for every un-bound screenshot. */
		.living-docs-rail .rail-bucket{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;height:26px;padding:0 8px;border:none;background:none;cursor:pointer;border-radius:6px;font:600 12px/1 system-ui;color:#52575F;text-align:left}
		.living-docs-rail .rail-bucket:hover{background:#F1F2F6}
		.living-docs-rail .rail-bucket-twistie{flex:none;width:10px;font-size:10px;line-height:1;color:#A3A8B2}
		.living-docs-rail .rail-item-snippet{width:100%;padding-left:0;font:400 11.5px/1.5 system-ui;color:var(--vscode-descriptionForeground)}
			.living-docs-rail .rail-item-unsupported{align-items:flex-start;flex-wrap:wrap;cursor:default}
			.living-docs-rail .rail-item-unsupported .rail-item-glyph{color:var(--vscode-descriptionForeground)}
			.living-docs-rail .rail-item-note{width:100%;padding-left:25px;font:400 11px/1.4 system-ui;color:var(--vscode-descriptionForeground);opacity:.85}
			.living-docs-rail .rail-srcaction{margin-left:auto;flex:none;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);font:500 11px/1 system-ui;cursor:pointer;padding:3px 7px;border-radius:4px;opacity:0}
			.living-docs-rail .rail-item:hover .rail-srcaction,.living-docs-rail .rail-item:focus-within .rail-srcaction{opacity:1}
			.living-docs-rail .rail-srcaction:hover{background:var(--vscode-button-secondaryHoverBackground)}
			.living-docs-rail .rail-import{margin-left:auto;flex:none;border:1px solid oklch(0.55 0.13 255);background:none;color:oklch(0.5 0.13 255);border-radius:6px;padding:4px 9px;font:600 11px/1 system-ui;cursor:pointer;white-space:nowrap}
			.living-docs-rail .rail-import:hover{background:oklch(0.55 0.13 255);color:#fff}
			.living-docs-rail .rail-import:disabled{opacity:.6;cursor:default;background:none;color:var(--vscode-descriptionForeground);border-color:var(--vscode-input-border,#d3d8e0)}
			.living-docs-rail .rail-import-bulk{display:block;width:100%;box-sizing:border-box;margin:2px 0 8px;padding:8px;text-align:center}
			.living-docs-rail .rail-files-tree .rail-tree-actions .rail-item-note{width:auto;padding:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.living-docs-rail .rail-files-tree .rail-tree-actions .rail-srcaction,.living-docs-rail .rail-files-tree .rail-tree-actions .rail-import{margin-left:0}
			.living-docs-rail .rail-files-tree .rail-tree-leaf:hover .rail-srcaction,.living-docs-rail .rail-files-tree .rail-tree-leaf:focus-within .rail-srcaction,.living-docs-rail .rail-files-tree .monaco-list-row:hover .rail-srcaction,.living-docs-rail .rail-files-tree .monaco-list-row:focus-within .rail-srcaction{opacity:1}
		.living-docs-rail .rail-outline{padding:6px 8px;border-radius:6px;font:400 13px/1.3 system-ui;color:var(--vscode-foreground);cursor:pointer}
		.living-docs-rail .rail-outline:hover{background:var(--vscode-list-hoverBackground)}
		.living-docs-rail .rail-outline.lvl-1{font-weight:600}
		.living-docs-rail .rail-outline.lvl-2{padding-left:18px;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-outline.lvl-3{padding-left:30px;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-addctx{display:block;width:100%;box-sizing:border-box;margin:12px 0 4px;border:1px dashed var(--vscode-input-border,#d3d8e0);background:none;color:oklch(0.55 0.13 255);border-radius:8px;padding:9px;font:500 12px/1 system-ui;cursor:pointer;text-align:left}
		.living-docs-rail .rail-addctx:hover{background:var(--vscode-list-hoverBackground);border-style:solid}
		.living-docs-rail .rail-addctx-form{margin:12px 0 4px;border:1px solid var(--vscode-input-border,#e0e6ff);background:var(--vscode-editorWidget-background,#fff);border-radius:9px;padding:9px}
		.living-docs-rail .rail-addctx-kinds{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
		.living-docs-rail .rail-addctx-chip{border:1px solid var(--vscode-input-border,#e0e6ff);background:none;color:var(--vscode-descriptionForeground);border-radius:6px;padding:5px 8px;font:500 11px/1 system-ui;cursor:pointer}
		.living-docs-rail .rail-addctx-chip.active{background:#eef2fb;border-color:oklch(0.55 0.13 255);color:oklch(0.45 0.13 255)}
		.living-docs-rail .rail-addctx-input{width:100%;box-sizing:border-box;resize:vertical;min-height:48px;border:1px solid var(--vscode-input-border,#d8e0fb);background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground);border-radius:7px;padding:7px 9px;font:400 12px/1.45 system-ui;outline:none}
		.living-docs-rail .rail-addctx-actions{display:flex;gap:6px;margin-top:8px}
		.living-docs-rail .rail-addctx-add{flex:1;border:none;border-radius:7px;padding:7px;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/1 system-ui;cursor:pointer}
		.living-docs-rail .rail-addctx-cancel{border:1px solid var(--vscode-input-border,#e0e2e8);border-radius:7px;padding:7px 12px;background:none;color:var(--vscode-descriptionForeground);font:500 12px/1 system-ui;cursor:pointer}
		.living-docs-rail .rail-srcremove{margin-left:6px;flex:none;border:none;background:none;color:var(--vscode-descriptionForeground);font:500 14px/1 system-ui;cursor:pointer;padding:0 3px;border-radius:4px;opacity:.5}
		.living-docs-rail .rail-item:hover .rail-srcremove{opacity:1}
		.living-docs-rail .rail-srcremove:hover{color:oklch(0.55 0.2 25);background:var(--vscode-list-hoverBackground)}
		.living-docs-rail .rail-srccand{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;border:1px solid var(--vscode-input-border,#e0e6ff);background:var(--vscode-input-background,#fff);color:var(--vscode-foreground);border-radius:7px;padding:7px 9px;margin-bottom:5px;font:500 12.5px/1 system-ui;cursor:pointer;text-align:left}
		.living-docs-rail .rail-srccand:hover{background:#eef2fb;border-color:oklch(0.55 0.13 255)}
		`;
		container.appendChild(style);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._body) { this._body.style.height = `${height}px`; }
		// The Files tree fills the panel below the tab strip; re-flow its virtual rows on resize.
		if (this._tab === 'files') { this._layoutFilesTree(); }
	}
}
