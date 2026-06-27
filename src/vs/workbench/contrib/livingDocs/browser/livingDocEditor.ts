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
import { parseLivingDoc, withReplacedBody } from '../common/livingDocMarkdown.js';
import { LivingDocEditorInput } from './livingDocEditorInput.js';
import { ILivingDocContent, ILivingDocRenderInput, IPresentState, LivingDocViewMode, PresentChoice, renderLivingDocContent, renderLivingDocHtml, ShareScope } from './livingDocRender.js';

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
	// Mount-once-then-message (plan 15 iter 2): the shell is set via setHtml ONCE; thereafter content goes
	// over postMessage. `_webviewReady` flips when the webview RUNTIME signals 'lwdReady'; a render that
	// arrives before then is held in `_pendingContent` and flushed on ready (so updates can't be lost to a
	// load race).
	private _webviewInitialized = false;
	private _webviewReady = false;
	private _pendingContent: ILivingDocContent | undefined;
	// The body the live ProseMirror surface currently holds. A render whose fresh body differs (a
	// model-driven change such as an accepted proposal - NOT the user's own typing, which is saved silently
	// and never re-renders) resets the PM doc to disk truth via `pmReset` (plan 15 iter 4).
	private _pmBody: string | undefined;
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
		this._mode = 'rendered';
		this._present = { open: false, choice: 'gdoc', scope: 'internal' };
		this._sourcePeek = undefined;
		this._resource = input.resource;
		// Dispose the previous input's webview (registered to `_inputDisposables`) and build a fresh one.
		this._inputDisposables.clear();
		this._webviewInitialized = false;
		this._webviewReady = false;
		this._pendingContent = undefined;
		this._pmBody = undefined;
		this._createWebview();
		this._inputDisposables.add(this._livingDocs.onDidChange(() => this._render()));
		await this._livingDocs.loadDocument(input.resource);
		this._render();
	}

	// A fresh webview element is created for every input rather than reused across opens. Reusing one
	// element across a hide/show cycle (close a doc, then reopen it in the same pooled editor pane) left
	// the reused iframe blank when re-fed the large inline ProseMirror bundle via setHtml; a brand-new
	// element reliably loads its content. Within a single webview the shell (incl. the bundle) is set once
	// and updated via postMessage (mount-once-then-message), so the bundle is inlined only on this first
	// setHtml. Owned by `_inputDisposables` so the previous webview is torn down on the next input and on
	// editor disposal.
	private _createWebview(): void {
		if (!this._container) {
			return;
		}
		const webview = this._webviewService.createWebviewElement({
			options: {},
			contentOptions: { allowScripts: true },
			title: 'Living Document',
			extension: undefined,
		});
		webview.mountTo(this._container, this.window);
		this._inputDisposables.add(webview.onMessage(e => this._onMessage(e.message)));
		this._inputDisposables.add(webview);
		this._webview = webview;
	}

	private _onMessage(message: { type?: string; cells?: string[]; mode?: string; text?: string; blockId?: string; id?: string; choice?: string; scope?: string }): void {
		switch (message?.type) {
			case 'lwdReady':
				// The webview RUNTIME has loaded and is listening; flush any update that raced the load.
				this._webviewReady = true;
				if (this._pendingContent) {
					void this._webview?.postMessage({ type: 'lwdRender', html: this._pendingContent.html, pmMd: this._pendingContent.pmMd, pmDeco: this._pendingContent.pmDeco });
					this._pendingContent = undefined;
				}
				break;
			case 'pmEdit':
				// The ProseMirror editing surface serialized its current state back to Markdown. Persist it
				// silently so the live editor keeps its cursor (no remount). ProseMirror round-trips only the
				// BODY, so for a living doc re-attach the existing frontmatter (`sources:`/`context:`) - else a
				// PM edit would strip what makes it a living document (plan 15 iter 3).
				if (this._resource && typeof message.text === 'string') {
					const doc = this._livingDocs.getDoc(this._resource);
					const text = doc?.isLiving
						? withReplacedBody(this._livingDocs.getRawText(this._resource), message.text)
						: message.text;
					// The live surface already holds this body, so record it to suppress a spurious pmReset on
					// the next (non-typing) render.
					this._pmBody = parseLivingDoc(text).body;
					void this._livingDocs.saveRawText(this._resource, text, { silent: true });
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
				if (message.mode === 'raw' || message.mode === 'rendered' || message.mode === 'pm') {
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
		if (!resource || !this._webview) { return; }
		const peek = this._sourcePeek;
		const sourcePeek = peek
			? (() => {
				const data = this._livingDocs.getSourcePeek(resource, peek.cells);
				return data ? { ...data, synced: peek.synced, syncedCount: peek.syncedCount } : undefined;
			})()
			: undefined;
		const input: ILivingDocRenderInput = {
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
		};
		const content = renderLivingDocContent(input);
		// Reset the live PM doc only when the fresh body changed from a model-driven source (an accepted
		// proposal). The user's own typing is saved silently (no re-render) and already recorded in `_pmBody`,
		// so it never triggers a reset; chrome-only renders (a modal, the source drawer) keep the same body.
		let pmReset: string | undefined;
		if (content.pmMd !== null) {
			if (this._pmBody !== undefined && content.pmMd.trim() !== this._pmBody.trim()) {
				pmReset = content.pmMd;
			}
			this._pmBody = content.pmMd;
		} else {
			this._pmBody = undefined;
		}

		// First render builds the full shell (chrome + bundle + RUNTIME) via setHtml; every later render
		// pushes just the content as an 'lwdRender' message so the live ProseMirror view is never torn down.
		if (!this._webviewInitialized) {
			this._webview.setHtml(renderLivingDocHtml(input));
			this._webviewInitialized = true;
			return;
		}
		if (this._webviewReady) {
			void this._webview.postMessage({ type: 'lwdRender', html: content.html, pmMd: content.pmMd, pmDeco: content.pmDeco, pmReset });
		} else {
			this._pendingContent = content;
		}
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
