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
import { IPresentState, LivingDocViewMode, PresentChoice, renderLivingDocHtml, ShareScope } from './livingDocRender.js';

export class LivingDocEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDoc';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	private _mode: LivingDocViewMode = 'rendered';
	private _resource: URI | undefined;
	private _present: IPresentState = { open: false, choice: 'gdoc', scope: 'internal' };
	// In-surface source-peek state (the comp's "Sync across" pane). Held on the editor, NOT opened as a
	// second editor group - this is the v2 fix for the split-pane / blank-pane abrasion.
	private _sourcePeek: { cells: readonly string[]; synced: boolean; syncedCount: number } | undefined;
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
		this._present = { open: false, choice: 'gdoc', scope: 'internal' };
		this._sourcePeek = undefined;
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

	private _onMessage(message: { type?: string; cells?: string[]; mode?: string; text?: string; blockId?: string; id?: string; choice?: string; scope?: string }): void {
		switch (message?.type) {
			case 'pmEdit':
				// The ProseMirror editing surface (plain Markdown docs) serialized its current state back
				// to Markdown. Persist it to disk silently so the live editor keeps its cursor (no remount).
				if (this._resource && typeof message.text === 'string') {
					void this._livingDocs.saveRawText(this._resource, message.text, { silent: true });
				}
				break;
			case 'refresh':
				void this._livingDocs.refreshFromSources();
				break;
			case 'presentOpen':
				this._present = { ...this._present, open: true };
				this._render();
				break;
			case 'presentClose':
				this._present = { ...this._present, open: false };
				this._render();
				break;
			case 'presentChoice':
				if (typeof message.choice === 'string') {
					this._present = { ...this._present, choice: message.choice as PresentChoice };
					this._render();
				}
				break;
			case 'presentScope':
				if (typeof message.scope === 'string') {
					this._present = { ...this._present, scope: message.scope as ShareScope };
					this._render();
				}
				break;
			case 'presentCta':
				void this._runPresent();
				break;
			case 'approve':
				if (typeof message.id === 'string') { void this._livingDocs.approve(message.id); }
				break;
			case 'reject':
				if (typeof message.id === 'string') { this._livingDocs.reject(message.id); }
				break;
			case 'askAi':
				this._livingDocs.focusPanel('chat');
				break;
			case 'export':
				if (this._resource) { void this._livingDocs.exportDocument(this._resource); }
				break;
			case 'exportMd':
				if (this._resource) { void this._livingDocs.exportMarkdown(this._resource); }
				break;
			case 'share':
				if (this._resource) { this._livingDocs.shareDocument(this._resource); }
				break;
			case 'reveal':
				// Clicking a provenance dot opens the in-surface source pane focused on those cells.
				this._sourcePeek = { cells: Array.isArray(message.cells) ? message.cells : [], synced: false, syncedCount: 0 };
				this._render();
				break;
			case 'openSource':
				// The "Source" toolbar button opens the in-surface source pane (no cell focus).
				this._sourcePeek = { cells: [], synced: false, syncedCount: 0 };
				this._render();
				break;
			case 'closeSource':
				this._sourcePeek = undefined;
				this._render();
				break;
			case 'sync':
				if (this._resource) { void this._sync(); }
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

	// The Present/export CTA maps each destination onto the export the spike actually produces:
	// the hosted web page reuses the self-contained HTML export; the file/doc destinations produce
	// the clean resolved Markdown. Then the modal closes.
	private async _runPresent(): Promise<void> {
		if (!this._resource) { return; }
		if (this._present.choice === 'site') {
			await this._livingDocs.exportDocument(this._resource);
		} else {
			await this._livingDocs.exportMarkdown(this._resource);
		}
		this._present = { ...this._present, open: false };
		this._render();
	}

	// "Sync across": re-derive the doc's figures, then mark the in-surface pane as synced so it shows
	// the green confirmation (the comp's "N changes synced" state on the divider circle).
	private async _sync(): Promise<void> {
		if (!this._resource) { return; }
		const changes = await this._livingDocs.syncFromSources(this._resource);
		if (this._sourcePeek) {
			this._sourcePeek = { ...this._sourcePeek, synced: true, syncedCount: changes.length };
		}
		this._render();
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
		const peek = this._sourcePeek;
		const sourcePeek = peek
			? (() => {
				const data = this._livingDocs.getSourcePeek(resource, peek.cells);
				return data ? { ...data, synced: peek.synced, syncedCount: peek.syncedCount } : undefined;
			})()
			: undefined;
		this._webview?.setHtml(renderLivingDocHtml({
			doc: this._livingDocs.getDoc(resource),
			pending: this._livingDocs.getPendingForDoc(resource),
			resolved: this._livingDocs.getResolved(resource),
			dirty: this._livingDocs.getFreshness(resource).dirty,
			status: this._livingDocs.getStatus(resource),
			recent: this._livingDocs.getRecentlyApplied(resource),
			mode: this._mode,
			rawText: this._livingDocs.getRawText(resource),
			present: this._present,
			syncDiff: this._livingDocs.getLastSyncDiff(resource),
			sourcePeek,
		}));
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
