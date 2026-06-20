/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
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
import { ILivingDocsService, ILivingDocSummary } from '../common/livingDocs.js';

// The "Documents" home: lists the workspace's Living Documents as documents (not files), so the
// product reads as a word processor rather than an IDE. Replaces the file Explorer in the sidebar.
export class DocumentsView extends ViewPane {

	private _body: HTMLElement | undefined;
	private _stylesInjected = false;
	private _renderToken = 0;
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
		this._body = append(container, $('.living-docs-home'));
		this._body.style.overflowY = 'auto';
		this._body.style.height = '100%';
		this._injectStyles(container);
		this._register(this._livingDocs.onDidChange(() => void this._render()));
		void this._render();
	}

	private async _render(): Promise<void> {
		const body = this._body;
		if (!body) { return; }
		const token = ++this._renderToken;
		const documents = await this._livingDocs.listDocuments();
		// A newer render started while we were listing -> drop this stale result.
		if (token !== this._renderToken || !this._body) { return; }
		this._renderDisposables.clear();
		clearNode(body);

		// The container header already reads "Documents"; the body just needs the create affordance.
		const head = append(body, $('div.ldh-head'));
		const newBtn = append(head, $('button.ldh-new')) as HTMLButtonElement;
		newBtn.textContent = '+ New document';
		this._renderDisposables.add(addDisposableListener(newBtn, 'click', () => void this._livingDocs.createDocument()));

		if (!documents.length) {
			const empty = append(body, $('div.ldh-empty'));
			empty.textContent = 'No documents yet. Create one to get started.';
			return;
		}

		const list = append(body, $('div.ldh-list'));
		for (const doc of documents) {
			this._renderRow(list, doc);
		}
	}

	private _renderRow(list: HTMLElement, doc: ILivingDocSummary): void {
		const row = append(list, $('div.ldh-row'));
		row.setAttribute('role', 'button');
		row.tabIndex = 0;
		const open = () => void this._editors.openEditor({ resource: doc.resource, options: { pinned: true } });
		this._renderDisposables.add(addDisposableListener(row, 'click', open));
		this._renderDisposables.add(addDisposableListener(row, 'keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
		}));

		const title = append(row, $('div.ldh-row-title'));
		title.textContent = doc.title;

		const meta = append(row, $('div.ldh-row-meta'));
		for (const kind of doc.sourceKinds) {
			const chip = append(meta, $(`span.ldh-chip.ldh-chip-${kind}`));
			chip.textContent = kind;
		}
		if (doc.lastSynced) {
			const synced = append(meta, $('span.ldh-synced'));
			synced.textContent = doc.lastSynced;
		}
		if (doc.pendingCount) {
			const badge = append(meta, $('span.ldh-pending'));
			badge.textContent = `${doc.pendingCount} pending`;
		}
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		// Accent + diff hues match the Workbench hi-fi; structural colors use theme variables.
		style.textContent = `
		.living-docs-home{padding:12px 12px}
		.living-docs-home .ldh-head{margin:0 0 12px}
		.living-docs-home .ldh-new{width:100%;border:none;border-radius:8px;padding:9px 11px;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/1 system-ui;cursor:pointer}
		.living-docs-home .ldh-new:hover{background:oklch(0.5 0.13 255)}
		.living-docs-home .ldh-empty{font:400 12px/1.5 system-ui;color:var(--vscode-descriptionForeground);padding:10px 2px}
		.living-docs-home .ldh-list{display:flex;flex-direction:column;gap:6px}
		.living-docs-home .ldh-row{border:1px solid var(--vscode-widget-border,#e9eaee);border-radius:10px;padding:11px 12px;cursor:pointer;background:var(--vscode-editorWidget-background)}
		.living-docs-home .ldh-row:hover{border-color:oklch(0.55 0.13 255);background:var(--vscode-list-hoverBackground)}
		.living-docs-home .ldh-row:focus{outline:none;border-color:oklch(0.55 0.13 255);box-shadow:0 0 0 1px oklch(0.55 0.13 255)}
		.living-docs-home .ldh-row-title{font:600 13px/1.3 system-ui;color:var(--vscode-foreground);margin-bottom:7px}
		.living-docs-home .ldh-row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
		.living-docs-home .ldh-chip{font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.04em;border-radius:999px;padding:3px 7px;color:#52575f;background:#eef0f3}
		.living-docs-home .ldh-chip-api{color:#1f5a36;background:#e7f6ec}
		.living-docs-home .ldh-chip-mcp{color:#5b4ba8;background:#eef1ff}
		.living-docs-home .ldh-synced{font:500 10.5px/1 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground)}
		.living-docs-home .ldh-pending{font:600 10px/1 system-ui;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:3px 8px}
		`;
		container.appendChild(style);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._body) {
			this._body.style.height = `${height}px`;
		}
	}
}
