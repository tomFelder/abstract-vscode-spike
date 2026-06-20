/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ILivingDocsService } from '../common/livingDocs.js';
import { LivingDocEditorInput } from './livingDocEditorInput.js';
import { LivingDocViewMode, renderLivingDocHtml } from './livingDocRender.js';

export class LivingDocEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDoc';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	private _mode: LivingDocViewMode = 'rendered';
	private _resource: URI | undefined;
	private readonly _inputDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
	) {
		super(LivingDocEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = $('.living-doc-editor');
		this._container.style.height = '100%';
		this._container.style.width = '100%';
		parent.appendChild(this._container);
	}

	override async setInput(input: LivingDocEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._ensureWebview();
		this._mode = 'rendered';
		this._resource = input.resource;
		this._inputDisposables.clear();
		this._inputDisposables.add(this._livingDocs.onDidChange(() => this._render()));
		await this._livingDocs.loadDocument(input.resource);
		this._render();
	}

	private _ensureWebview(): void {
		if (this._webview || !this._container) {
			return;
		}
		this._webview = this._register(this._webviewService.createWebviewElement({
			options: {},
			contentOptions: { allowScripts: true },
			title: 'Living Document',
			extension: undefined,
		}));
		this._webview.mountTo(this._container, this.window);
		this._register(this._webview.onMessage(e => this._onMessage(e.message)));
	}

	private _onMessage(message: { type?: string; cells?: string[]; mode?: string; text?: string; blockId?: string }): void {
		switch (message?.type) {
			case 'refresh':
				void this._livingDocs.refreshFromSources();
				break;
			case 'export':
				if (this._resource) { void this._livingDocs.exportDocument(this._resource); }
				break;
			case 'exportMd':
				if (this._resource) { void this._livingDocs.exportMarkdown(this._resource); }
				break;
			case 'reveal':
				if (this._resource && Array.isArray(message.cells)) { void this._livingDocs.revealSource(this._resource, message.cells); }
				break;
			case 'edit':
				if (this._resource && typeof message.blockId === 'string' && typeof message.text === 'string') {
					void this._livingDocs.editBlock(this._resource, message.blockId, message.text);
				}
				break;
			case 'setMode':
				if (message.mode === 'raw' || message.mode === 'rendered') {
					this._mode = message.mode;
					this._render();
				}
				break;
			case 'applyRaw':
				void this._applyRaw(typeof message.text === 'string' ? message.text : '');
				break;
		}
	}

	private async _applyRaw(text: string): Promise<void> {
		if (!this._resource) { return; }
		this._mode = 'rendered';
		await this._livingDocs.saveRawText(this._resource, text);
		// saveRawText fires onDidChange, but render again in case nothing changed.
		this._render();
	}

	private _render(): void {
		const resource = this._resource;
		if (!resource) { return; }
		this._webview?.setHtml(renderLivingDocHtml({
			doc: this._livingDocs.getDoc(resource),
			pending: this._livingDocs.getPendingForDoc(resource),
			kpiRows: this._livingDocs.getKpiRows(resource),
			status: this._livingDocs.getStatus(resource),
			recent: this._livingDocs.getRecentlyApplied(resource),
			mode: this._mode,
			rawText: this._livingDocs.getRawText(resource),
		}));
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
