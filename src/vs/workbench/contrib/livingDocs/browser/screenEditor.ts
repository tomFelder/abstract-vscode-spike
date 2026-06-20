/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ILivingDocsService } from '../common/livingDocs.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { IScreenState, renderScreenHtml, ScreenId } from './screenRender.js';

// Webview editor that hosts one Opportunity OS screen (Templates / Knowledge / Agents) in the
// editor area. The screen's small interactive state (Knowledge scope, agent canvas, run state)
// lives here and re-renders the webview, mirroring the comp; cross-surface actions are routed to
// the living-docs service / editor service.
export class ScreenEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDocs.screen';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	private _screen: ScreenId = 'templates';
	private _state: IScreenState = { knScope: 'org', agentOpen: false, ranWf: false };

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IEditorService private readonly _editors: IEditorService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
	) {
		super(ScreenEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = $('.living-docs-screen');
		this._container.style.height = '100%';
		this._container.style.width = '100%';
		parent.appendChild(this._container);
	}

	override async setInput(input: ScreenEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._ensureWebview();
		this._screen = input.screen;
		// Reset per-screen state on (re)open so each visit starts from the comp's default view.
		this._state = { knScope: 'org', agentOpen: false, ranWf: false };
		this._render();
	}

	private _ensureWebview(): void {
		if (this._webview || !this._container) {
			return;
		}
		this._webview = this._register(this._webviewService.createWebviewElement({
			options: {},
			contentOptions: { allowScripts: true },
			title: 'Opportunity OS',
			extension: undefined,
		}));
		this._webview.mountTo(this._container, this.window);
		this._register(this._webview.onMessage(e => this._onMessage(e.message)));
	}

	private _onMessage(message: { type?: string }): void {
		switch (message?.type) {
			case 'setKnOrg':
				this._state = { ...this._state, knScope: 'org' };
				this._render();
				break;
			case 'setKnProject':
				this._state = { ...this._state, knScope: 'project' };
				this._render();
				break;
			case 'openAgent':
				this._state = { ...this._state, agentOpen: true, ranWf: false };
				this._render();
				break;
			case 'closeAgent':
				this._state = { ...this._state, agentOpen: false, ranWf: false };
				this._render();
				break;
			case 'runWf':
				this._state = { ...this._state, ranWf: true };
				this._render();
				break;
			case 'goReview':
				this._livingDocs.focusPanel('review');
				break;
			case 'present':
				void this._openFirstDocument();
				break;
		}
	}

	// Templates "Export" lands the user on a real document, where the Present/export modal lives.
	private async _openFirstDocument(): Promise<void> {
		const docs = await this._livingDocs.listDocuments();
		const living = docs.find(d => d.isLiving) ?? docs[0];
		if (living) {
			await this._editors.openEditor({ resource: living.resource, options: { pinned: true } });
		}
	}

	private _render(): void {
		this._webview?.setHtml(renderScreenHtml(this._screen, this._state));
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
