/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, isHTMLElement } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { IAction, Separator, toAction } from '../../../../base/common/actions.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IAnchor } from '../../../../base/browser/ui/contextview/contextview.js';
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
import { buildContextGroups } from '../common/contextGroups.js';
import { AddedContextKind } from '../common/livingDocsModel.js';
import { ILivingDocsService, ILivingDocSummary } from '../common/livingDocs.js';
import { buildOutline, buildTreeRailNodes, collectAssetsFolderIds, ITreeRailItem, ITreeRailLeafNode, ITreeRailNode, searchTreeRail, TreeRailAction } from '../common/treeRail.js';
import { TreeRailAccessibilityProvider, TreeRailDelegate, TreeRailFolderRenderer, TreeRailLeafRenderer } from './treeRailFilesTree.js';

type TreeRailTab = 'files' | 'context' | 'outline' | 'search';

const TABS: readonly { id: TreeRailTab; label: string; glyph: string }[] = [
	{ id: 'files', label: 'Files', glyph: '\u{1F5C2}' },
	{ id: 'context', label: 'Context', glyph: '\u25C9' },
	{ id: 'outline', label: 'Outline', glyph: '\u2630' },
	{ id: 'search', label: 'Search', glyph: '\u2315' },
];

// The comp's single left tree-rail: one sidebar view with Files / Context / Outline / Search tabs and a
// folder tree, replacing the spike-era activity-bar-per-view split (Documents + Context were separate
// containers). DOM-rendered like DocumentsView. ADDITIVE-CONTRIBUTION (merge-tax ledger).
export class TreeRailView extends ViewPane {

	private _body: HTMLElement | undefined;
	private _stylesInjected = false;
	private _renderToken = 0;
	private _tab: TreeRailTab = 'files';
	private _query = '';
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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._collapsedFolders = this._readCollapsedFolders();
	}

	// Persisted (workspace-scoped) collapse state for the Files tree, keyed by folder node id so expansion
	// survives restart (issue #171). Owned by this view - no reaching into another component's storage keys.
	private static readonly COLLAPSED_STORAGE_KEY = 'livingDocs.treeRail.filesCollapsed';
	// One-time flag: the Assets bucket defaults to collapsed on first open (so ~400 screenshots never flood the
	// tree, issue #171), but after that it behaves like any other folder - user expand/collapse persists. The
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

	// The one-time default: on the first Files render for a workspace, mark every Assets bucket collapsed so the
	// screenshot flood never appears (issue #171 acceptance). Guarded by a persisted seed flag so it fires once;
	// thereafter the user's expand/collapse of Assets persists like any other folder via onDidChangeCollapseState.
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
		this._body = append(container, $('.living-docs-rail'));
		this._body.style.height = '100%';
		this._body.style.display = 'flex';
		this._body.style.flexDirection = 'column';
		// Context/Outline track the active document; Files/Search track the document set.
		this._register(this._editors.onDidActiveEditorChange(() => void this._render()));
		this._register(this._livingDocs.onDidChange(() => void this._render()));
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

	private async _render(): Promise<void> {
		const root = this._body;
		if (!root) { return; }
		const token = ++this._renderToken;
		const documents = await this._livingDocs.listDocuments();
		// The Files tab also lists non-Markdown files (SOURCES + "Not yet imported"); other tabs skip the scan.
		const extras = this._tab === 'files' ? await this._livingDocs.listWorkspaceExtras() : [];
		if (token !== this._renderToken || !this._body) { return; }
		this._renderDisposables.clear();
		clearNode(root);

		// Tab strip.
		const tabs = append(root, $('div.rail-tabs'));
		for (const t of TABS) {
			const btn = append(tabs, $(`button.rail-tab${this._tab === t.id ? '.active' : ''}`)) as HTMLButtonElement;
			append(btn, $('span.rail-tab-glyph')).textContent = t.glyph;
			append(btn, document.createTextNode(t.label));
			this._renderDisposables.add(addDisposableListener(btn, 'click', () => {
				if (this._tab !== t.id) { this._tab = t.id; void this._render(); }
			}));
		}

		const panel = append(root, $('div.rail-panel'));
		switch (this._tab) {
			case 'files': this._renderFiles(panel, documents, extras); break;
			case 'context': this._renderContext(panel); break;
			case 'outline': this._renderOutline(panel); break;
			case 'search': this._renderSearch(panel, documents); break;
		}
	}

	// The Files tab (issue #171): a real collapsible file tree on the VS Code tree widget. The widget is
	// created once and re-parented into the freshly-rendered panel on every re-render, so its focus, keyboard
	// state and selection survive the onDidChange/onDidActiveEditorChange re-renders that drive this rail.
	private _renderFiles(panel: HTMLElement, documents: readonly ILivingDocSummary[], extras: readonly string[]): void {
		const nodes = buildTreeRailNodes(
			documents.map(d => ({ title: d.title, resource: d.resource, pendingCount: d.pendingCount, sources: d.sources, folder: d.folder })),
			extras,
		);
		if (!nodes.length) {
			append(panel, $('div.rail-empty')).textContent = 'No documents yet.';
			return;
		}
		// First open of this workspace: seed the Assets bucket(s) collapsed so the screenshot flood never renders.
		// One-time only - after this the bucket persists whatever the user chooses, like every other folder.
		this._seedAssetsCollapsed(nodes);
		panel.classList.add('rail-panel-files');

		// The bulk-import banner (doc 22 section 2, the 2b moment): when several Word documents are waiting,
		// offer to import them all at once - "I found N Word documents - import them?". A banner above the tree.
		const importable = this._collectImportable(nodes);
		if (importable.length > 1) { this._renderBulkImport(panel, importable); }

		this._ensureFilesTree();
		const tree = this._filesTree!;
		const container = this._filesTreeContainer!;
		append(panel, container);

		// Per-leaf action listeners (import / use-as-source) are owned by the renderer's per-row template store,
		// cleared when a row is recycled or disposed - so a rebuild never leaks the previous generation.
		tree.setChildren(null, nodes.map(n => this._toTreeElement(n)));
		this._layoutFilesTree();
		this._highlightActiveDoc();
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
				new TreeRailLeafRenderer({ renderLeafActions: (node, host) => this._renderLeafActions(node, host) }),
			],
			{
				accessibilityProvider: new TreeRailAccessibilityProvider(),
				identityProvider: { getId: (e: ITreeRailNode) => e.id },
				expandOnlyOnTwistieClick: false,
				overrideStyles: { listBackground: 'sideBar.background' },
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

		// Selecting a document opens it (click or keyboard Enter, both funnel through onDidOpen).
		this._register(tree.onDidOpen(e => {
			const el = e.element;
			if (el?.type === 'leaf' && el.item.kind === 'doc' && el.item.resource) {
				void this._editors.openEditor({ resource: el.item.resource, options: { pinned: true, preserveFocus: e.browserEvent?.type === 'keydown' ? false : true } });
			}
		}));

		// The provenance-safe file menu (docs 20 section 1d): Rename / Delete / Add to chat on real-file rows.
		this._register(tree.onContextMenu(e => {
			const el = e.element;
			if (el?.type === 'leaf' && el.item.resource) {
				// The tree's anchor is the row element (right-click) or a mouse position (keyboard menu key).
				const anchor = isHTMLElement(e.anchor) ? e.anchor : { x: e.anchor.posx, y: e.anchor.posy };
				this._showFileMenu(anchor, el.item.resource, el.item.label);
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
	private _highlightActiveDoc(): void {
		const tree = this._filesTree;
		if (!tree) { return; }
		const resource = this._editors.activeEditor?.resource;
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
		tree.reveal(match);
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
	// "Use as source" button, the pending dot, or the not-yet-imported note. The tree renderer calls this on
	// every (re)render of a row and disposes the returned store when the row is recycled - so listeners are
	// scoped to the row's lifetime, not this view's. Open + context-menu are handled by the tree widget.
	private _renderLeafActions(node: ITreeRailLeafNode, host: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		const item = node.item;
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
		if (item.pending) { append(host, $('span.rail-item-dot')); }
		return store;
	}

	// The Files-tab context menu (docs 20 section 1d, the 1m entry): the minimal-v1 provenance-safe ops.
	// Rename and Delete route through the service, which moves the lock sidecar atomically. A rename succeeds
	// silently (plan 42 L5 - no ceremony on plain human edits); delete keeps its Undo toast as the safety net
	// for a destructive op, and the warn-and-list on delete (map-D6) is the confirm dialog below.
	private _showFileMenu(anchor: HTMLElement | IAnchor, resource: URI, label: string): void {
		const actions: IAction[] = [
			toAction({ id: 'livingDocs.file.rename', label: 'Rename\u2026', run: () => void this._renameFile(resource) }),
			toAction({ id: 'livingDocs.file.delete', label: 'Delete\u2026', run: () => void this._deleteFile(resource, label) }),
			new Separator(),
			toAction({ id: 'livingDocs.file.addToChat', label: 'Add to chat', run: () => this._livingDocs.attachToChat(resource) }),
		];
		this.contextMenuService.showContextMenu({ getAnchor: () => anchor, getActions: () => actions });
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

	private async _renameFile(resource: URI): Promise<void> {
		const current = basename(resource);
		const dot = current.lastIndexOf('.');
		const stem = dot >= 0 ? current.slice(0, dot) : current;
		const next = await this._quickInput.input({ prompt: 'Rename file', value: stem, valueSelection: [0, stem.length] });
		if (next === undefined) { return; } // cancelled
		const trimmed = next.trim();
		if (!trimmed || trimmed === stem) { return; }
		await this._livingDocs.renameFile(resource, trimmed);
	}

	// map-D6: delete warns and LISTS the dependent documents; on proceed the service orphans them
	// gracefully (their cached values survive, flagged stale) and offers Undo - the delete never blocks.
	private async _deleteFile(resource: URI, label: string): Promise<void> {
		const dependents = await this._livingDocs.getFileDependents(resource);
		const message = dependents.length
			? `Delete "${label}"? ${dependents.length} document${dependents.length === 1 ? '' : 's'} depend on it.`
			: `Delete "${label}"?`;
		const detail = dependents.length
			? `These documents will keep their last cached values, flagged as stale (not broken):\n${dependents.map(d => `\u2022 ${d.title}`).join('\n')}\n\nYou can undo this.`
			: 'You can undo this.';
		const { confirmed } = await this._dialogService.confirm({ type: 'warning', message, detail, primaryButton: 'Delete' });
		if (!confirmed) { return; }
		await this._livingDocs.deleteFile(resource);
	}

	private _renderContext(panel: HTMLElement): void {
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

	private _renderSearch(panel: HTMLElement, documents: readonly ILivingDocSummary[]): void {
		const input = append(panel, $('input.rail-search')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = 'Search documents\u2026';
		input.value = this._query;
		const results = append(panel, $('div.rail-results'));
		const run = () => {
			clearNode(results);
			const docs = documents
				.map(d => ({ title: d.title, resource: d.resource, body: this._livingDocs.getDoc(d.resource)?.body ?? '' }))
				.filter(d => d.body || true);
			const hits = searchTreeRail(docs, this._query);
			if (!this._query.trim()) { return; }
			append(results, $('div.rail-results-count')).textContent = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
			for (const hit of hits) {
				const resource = hit.resource;
				const row = append(results, $('div.rail-item'));
				row.setAttribute('role', 'button');
				row.tabIndex = 0;
				append(row, $('span.rail-item-label')).textContent = hit.title;
				append(row, $('div.rail-item-snippet')).textContent = hit.snippet;
				const open = () => void this._editors.openEditor({ resource, options: { pinned: true } });
				this._renderDisposables.add(addDisposableListener(row, 'click', open));
			}
		};
		this._renderDisposables.add(addDisposableListener(input, 'input', () => { this._query = input.value; run(); }));
		run();
		// Restore focus so typing isn't interrupted by a re-render from onDidChange.
		if (this._query) { input.focus(); input.setSelectionRange(this._query.length, this._query.length); }
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-rail .rail-tabs{flex:none;display:flex;align-items:stretch;border-bottom:1px solid var(--vscode-widget-border,#eef0f3);padding:0 2px}
		.living-docs-rail .rail-tab{border:none;background:none;cursor:pointer;padding:8px 8px;display:flex;align-items:center;gap:5px;font:500 11.5px/1 system-ui;color:var(--vscode-descriptionForeground);border-bottom:2px solid transparent}
		.living-docs-rail .rail-tab:hover{color:var(--vscode-foreground)}
		.living-docs-rail .rail-tab.active{color:var(--vscode-foreground);border-bottom-color:oklch(0.55 0.13 255)}
		.living-docs-rail .rail-tab-glyph{font-size:12px}
		.living-docs-rail .rail-panel{flex:1;overflow-y:auto;padding:10px 8px}
		.living-docs-rail .rail-panel.rail-panel-files{display:flex;flex-direction:column;overflow:hidden;padding:6px 4px}
		.living-docs-rail .rail-files-tree{flex:1;min-height:0}
		.living-docs-rail .rail-files-tree .rail-tree-folder{display:flex;align-items:center;height:100%;min-width:0}
		.living-docs-rail .rail-files-tree .rail-tree-folder-label{font:600 11px/1 system-ui;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.living-docs-rail .rail-files-tree .rail-tree-leaf{display:flex;align-items:center;gap:7px;height:100%;min-width:0;font:400 13px/1.3 system-ui;color:var(--vscode-foreground)}
		.living-docs-rail .rail-files-tree .rail-tree-leaf-source .rail-item-label{color:var(--vscode-descriptionForeground);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}
		.living-docs-rail .rail-files-tree .rail-tree-leaf-source .rail-item-glyph{color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-files-tree .rail-tree-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none}
		.living-docs-rail .rail-empty{font:400 12px/1.5 system-ui;color:var(--vscode-descriptionForeground);padding:8px 6px}
		.living-docs-rail .rail-folder{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:var(--vscode-descriptionForeground);text-transform:uppercase;padding:10px 6px 6px}
		.living-docs-rail .rail-item{display:flex;align-items:center;gap:7px;padding:6px 8px 6px 18px;border-radius:6px;font:400 13px/1.3 system-ui;color:var(--vscode-foreground);cursor:default}
		.living-docs-rail .rail-item[role=button]{cursor:pointer}
		.living-docs-rail .rail-item[role=button]:hover{background:var(--vscode-list-hoverBackground)}
		.living-docs-rail .rail-item-source{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-item-glyph{color:oklch(0.55 0.13 255);flex:none}
		.living-docs-rail .rail-item-source .rail-item-glyph{color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-item-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.living-docs-rail .rail-item-detail{margin-left:auto;font:400 10px/1 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-item-dot{margin-left:auto;width:6px;height:6px;border-radius:50%;background:oklch(0.66 0.16 45);flex:none}
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
			.living-docs-rail .rail-files-tree .rail-tree-actions .rail-item-dot{margin-left:0}
		.living-docs-rail .rail-outline{padding:6px 8px;border-radius:6px;font:400 13px/1.3 system-ui;color:var(--vscode-foreground);cursor:pointer}
		.living-docs-rail .rail-outline:hover{background:var(--vscode-list-hoverBackground)}
		.living-docs-rail .rail-outline.lvl-1{font-weight:600}
		.living-docs-rail .rail-outline.lvl-2{padding-left:18px;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-outline.lvl-3{padding-left:30px;color:var(--vscode-descriptionForeground)}
		.living-docs-rail .rail-search{width:100%;box-sizing:border-box;border:1px solid var(--vscode-input-border,#d8e0fb);background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground);border-radius:8px;padding:8px 10px;font:400 12.5px/1 system-ui;outline:none;margin-bottom:6px}
		.living-docs-rail .rail-results-count{font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground);padding:4px 6px 8px}
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
