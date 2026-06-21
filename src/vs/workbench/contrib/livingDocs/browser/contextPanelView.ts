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
import { ILivingDocsService } from '../common/livingDocs.js';

// The Context panel (spec 3.5): for the active Living Document, list its `context:` (influence)
// sources with a freshness status - current / changed-since-review - driven by the always-on dirty
// bits (Item 3). Whole-document granularity; section/claim-level edges are deferred.
export class ContextPanelView extends ViewPane {

	private _body: HTMLElement | undefined;
	private _stylesInjected = false;
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
		this._body = append(container, $('.living-docs-context'));
		this._body.style.overflowY = 'auto';
		this._body.style.height = '100%';
		this._injectStyles(container);
		// Re-render when the active document changes or any source freshness updates.
		this._register(this._editors.onDidActiveEditorChange(() => this._render()));
		this._register(this._livingDocs.onDidChange(() => this._render()));
		this._render();
	}

	private _activeDoc(): URI | undefined {
		const resource = this._editors.activeEditor?.resource;
		return resource && this._livingDocs.getDoc(resource)?.isLiving ? resource : undefined;
	}

	private _render(): void {
		const body = this._body;
		if (!body) { return; }
		this._renderDisposables.clear();
		clearNode(body);

		const resource = this._activeDoc();
		const doc = resource ? this._livingDocs.getDoc(resource) : undefined;
		if (!resource || !doc) {
			const empty = append(body, $('div.ldc-empty'));
			empty.textContent = 'Open a Living Document to see the sources that inform it.';
			return;
		}

		const stale = new Set(this._livingDocs.getFreshness(resource).staleContext);

		const section = append(body, $('div.ldc-section'));
		const label = append(section, $('div.ldc-label'));
		label.textContent = 'Context';
		const sub = append(section, $('div.ldc-sub'));
		sub.textContent = 'Sources that shape this document.';

		if (!doc.context.length) {
			const none = append(body, $('div.ldc-empty'));
			none.textContent = 'No context sources yet.';
			return;
		}

		const list = append(body, $('div.ldc-list'));
		let anyChanged = false;
		for (const file of doc.context) {
			const changed = stale.has(file);
			anyChanged = anyChanged || changed;
			const row = append(list, $('div.ldc-row'));
			const status = append(row, $(`span.ldc-status.${changed ? 'ldc-warn' : 'ldc-ok'}`));
			// Unicode escapes keep the source ASCII-only: U+26A0 warning sign / U+2713 check mark.
			status.textContent = changed ? '\u26A0' : '\u2713';
			const name = append(row, $('span.ldc-name'));
			name.textContent = file;
			const tag = append(row, $('span.ldc-tag'));
			tag.textContent = changed ? 'changed since review' : 'current';
		}

		// "Review impact" runs the expensive on-demand pass; emphasized when a source has changed.
		const review = append(body, $('button.ldc-review')) as HTMLButtonElement;
		review.textContent = anyChanged ? 'Review impact' : 'Review impact (up to date)';
		review.classList.toggle('ldc-review-warn', anyChanged);
		this._renderDisposables.add(addDisposableListener(review, 'click', () => void this._livingDocs.reviewImpact(resource)));
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-context{padding:12px}
		.living-docs-context .ldc-empty{font:400 12px/1.5 system-ui;color:var(--vscode-descriptionForeground);padding:10px 2px}
		.living-docs-context .ldc-section{margin:0 0 10px}
		.living-docs-context .ldc-label{font:600 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--vscode-descriptionForeground)}
		.living-docs-context .ldc-sub{font:400 11.5px/1.4 system-ui;color:var(--vscode-descriptionForeground);margin-top:5px}
		.living-docs-context .ldc-list{display:flex;flex-direction:column;gap:6px}
		.living-docs-context .ldc-row{display:flex;align-items:center;gap:9px;border:1px solid var(--vscode-widget-border,#e9eaee);border-radius:9px;padding:9px 11px;background:var(--vscode-editorWidget-background)}
		.living-docs-context .ldc-status{flex:none;width:16px;text-align:center;font-size:12px}
		.living-docs-context .ldc-ok{color:oklch(0.6 0.13 150)}
		.living-docs-context .ldc-warn{color:oklch(0.66 0.16 45)}
		.living-docs-context .ldc-name{flex:1;min-width:0;font:500 12.5px/1.3 system-ui;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.living-docs-context .ldc-tag{font:500 10px/1 system-ui;color:var(--vscode-descriptionForeground)}
		.living-docs-context .ldc-review{width:100%;margin-top:12px;border:1px solid var(--vscode-widget-border,#e9eaee);border-radius:8px;padding:9px 11px;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);font:600 12px/1 system-ui;cursor:pointer}
		.living-docs-context .ldc-review:hover{background:var(--vscode-list-hoverBackground)}
		.living-docs-context .ldc-review-warn{border-color:oklch(0.66 0.16 45);color:#9a6b16;background:#fdf2dc}
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
