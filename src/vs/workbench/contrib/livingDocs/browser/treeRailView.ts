/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { buildContextGroups } from '../common/contextGroups.js';
import { AddedContextKind } from '../common/livingDocsModel.js';
import { ILivingDocsService, ILivingDocSummary } from '../common/livingDocs.js';
import { buildFileTree, buildOutline, ITreeRailItem, searchTreeRail } from '../common/treeRail.js';

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
	private _ctxKind: AddedContextKind = 'pasted';
	private _ctxDraft = '';
	// Context-tab "Add source" picker state (R5): folder data files offered when the picker is open.
	private _srcAdding = false;
	private _srcCandidates: readonly string[] = [];
	private readonly _renderDisposables = this._register(new DisposableStore());

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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
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

	private _activeResource(): URI | undefined {
		const resource = this._editors.activeEditor?.resource;
		return resource && this._livingDocs.getDoc(resource)?.isLiving ? resource : undefined;
	}

	private async _render(): Promise<void> {
		const root = this._body;
		if (!root) { return; }
		const token = ++this._renderToken;
		const documents = await this._livingDocs.listDocuments();
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
			case 'files': this._renderFiles(panel, documents); break;
			case 'context': this._renderContext(panel); break;
			case 'outline': this._renderOutline(panel); break;
			case 'search': this._renderSearch(panel, documents); break;
		}
	}

	private _renderFiles(panel: HTMLElement, documents: readonly ILivingDocSummary[]): void {
		const folders = buildFileTree(documents.map(d => ({ title: d.title, resource: d.resource, pendingCount: d.pendingCount, sources: d.sources })));
		if (!folders.length) {
			append(panel, $('div.rail-empty')).textContent = 'No documents yet.';
			return;
		}
		for (const folder of folders) {
			append(panel, $('div.rail-folder')).textContent = folder.name;
			for (const item of folder.items) {
				this._renderFileItem(panel, item);
			}
		}
	}

	private _renderFileItem(panel: HTMLElement, item: ITreeRailItem): void {
		const row = append(panel, $(`div.rail-item.rail-item-${item.kind}`));
		const glyph = item.kind === 'doc' ? '\u25A3' : (item.sourceKind === 'api' ? '\u21C4' : (item.sourceKind === 'mcp' ? '\u25F7' : '\u229E'));
		append(row, $('span.rail-item-glyph')).textContent = glyph;
		append(row, $('span.rail-item-label')).textContent = item.label;
		if (item.pending) { append(row, $('span.rail-item-dot')); }
		if (item.resource) {
			const resource = item.resource;
			row.setAttribute('role', 'button');
			row.tabIndex = 0;
			const open = () => void this._editors.openEditor({ resource, options: { pinned: true } });
			this._renderDisposables.add(addDisposableListener(row, 'click', open));
			this._renderDisposables.add(addDisposableListener(row, 'keydown', e => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
			}));
		}
	}

	private _renderContext(panel: HTMLElement): void {
		const resource = this._activeResource();
		const doc = resource ? this._livingDocs.getDoc(resource) : undefined;
		if (!resource || !doc) {
			append(panel, $('div.rail-empty')).textContent = 'Open a document to see its context.';
			return;
		}
		const groups = buildContextGroups(doc, this._livingDocs.getFreshness(resource), this._livingDocs.getAddedContext(resource));
		if (!groups.length) {
			append(panel, $('div.rail-empty')).textContent = 'No linked context yet.';
		}
		for (const group of groups) {
			append(panel, $('div.rail-folder')).textContent = `${group.label.toUpperCase()} \u00B7 ${group.items.length}`;
			const isLinkedSources = group.label === 'Linked sources';
			for (const ci of group.items) {
				const row = append(panel, $('div.rail-item'));
				append(row, $('span.rail-item-label')).textContent = ci.name;
				if (ci.detail) { append(row, $('span.rail-item-detail')).textContent = ci.detail; }
				// Each linked source carries an unbind (x) - removing it rewrites the frontmatter (R5).
				if (isLinkedSources) {
					const name = ci.name;
					const remove = append(row, $('button.rail-srcremove')) as HTMLButtonElement;
					remove.textContent = '\u00D7';
					remove.title = 'Remove source';
					this._renderDisposables.add(addDisposableListener(remove, 'click', e => { e.stopPropagation(); void this._livingDocs.removeSource(resource, name); }));
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
			this._renderDisposables.add(addDisposableListener(add, 'click', () => { this._ctxAdding = true; void this._render(); }));
			return;
		}

		const form = append(panel, $('div.rail-addctx-form'));
		const kinds: { kind: AddedContextKind; label: string }[] = [
			{ kind: 'pasted', label: 'Pasted text' },
			{ kind: 'image', label: 'Image' },
			{ kind: 'knowledge', label: 'Company knowledge' },
		];
		const chips = append(form, $('div.rail-addctx-kinds'));
		for (const k of kinds) {
			const chip = append(chips, $(`button.rail-addctx-chip${this._ctxKind === k.kind ? '.active' : ''}`)) as HTMLButtonElement;
			chip.textContent = k.label;
			this._renderDisposables.add(addDisposableListener(chip, 'click', () => { this._ctxKind = k.kind; void this._render(); }));
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
			if (!text) { return; }
			this._ctxAdding = false;
			this._ctxDraft = '';
			await this._livingDocs.addContext(resource, this._ctxKind, text);
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
		const resource = this._activeResource();
		const doc = resource ? this._livingDocs.getDoc(resource) : undefined;
		const entries = buildOutline(doc);
		if (!entries.length) {
			append(panel, $('div.rail-empty')).textContent = 'Open a document to see its outline.';
			return;
		}
		for (const e of entries) {
			const row = append(panel, $(`div.rail-outline.lvl-${Math.min(e.level, 3)}`));
			row.textContent = e.text;
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
		.living-docs-rail .rail-outline{padding:6px 8px;border-radius:6px;font:400 13px/1.3 system-ui;color:var(--vscode-foreground);cursor:default}
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
	}
}
