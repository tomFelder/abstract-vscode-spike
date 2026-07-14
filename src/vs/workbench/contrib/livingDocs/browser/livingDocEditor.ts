/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { decodeBase64 } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ILivingDocsService } from '../common/livingDocs.js';
import { bulkApproveConfirm, nextPendingDocId } from '../common/livingDocsModel.js';
import { buildFigureProvenance } from '../common/livingDocPmDecorations.js';
import { parseLivingDoc, withReplacedBody } from '../common/livingDocMarkdown.js';
import { applyFocusRequest, applyReady, applyRender, EditorWebviewEffect, IEditorWebviewState, initialEditorWebviewState, recordPmBody } from '../common/editorWebviewProtocol.js';
import { LivingDocEditorInput } from './livingDocEditorInput.js';
import { ILivingDocRenderInput, IPresentState, LivingDocViewMode, PresentChoice, renderLivingDocContent, renderLivingDocHtml } from './livingDocRender.js';

export class LivingDocEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDoc';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	// PM is the single editing surface for every document (plan 15 iter 5): a doc opens in ProseMirror.
	private _mode: LivingDocViewMode = 'pm';
	private _resource: URI | undefined;
	private _present: IPresentState = { open: false, choice: 'html' };
	// In-surface source-peek state (the comp's "Sync across" pane). Held on the editor, NOT opened as a
	// second editor group - this is the v2 fix for the split-pane / blank-pane abrasion.
	private _sourcePeek: { cells: readonly string[]; synced: boolean; syncedCount: number } | undefined;
	// Mount-once-then-message (plan 15 iter 2, decision 50): the shell is set via setHtml ONCE; thereafter
	// content goes over postMessage. The whole lifecycle (first-render setHtml, hold-render-until-ready +
	// flush, pmReset only on a model-driven body change, focus-after-navigate) is a PURE reducer extracted
	// to `common/editorWebviewProtocol.ts` (plan 30, track 4); this class holds its state and carries out the
	// effects. Reset per input in setInput.
	private _proto: IEditorWebviewState = initialEditorWebviewState();
	private readonly _inputDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IEditorService private readonly _editorService: IEditorService,
		@IDialogService private readonly _dialogService: IDialogService,
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
		this._mode = 'pm';
		this._present = { open: false, choice: 'html' };
		this._sourcePeek = undefined;
		this._resource = input.resource;
		// Dispose the previous input's webview (registered to `_inputDisposables`) and build a fresh one.
		this._inputDisposables.clear();
		this._proto = initialEditorWebviewState();
		this._createWebview();
		this._inputDisposables.add(this._livingDocs.onDidChange(() => this._render()));
		// Rail-to-editor navigation: when a change for THIS document is asked to be focused, scroll to it.
		this._inputDisposables.add(this._livingDocs.onDidRequestFocusChange(e => {
			if (this._resource && e.docId === this._resource.toString()) {
				this._runProto(applyFocusRequest(this._proto, e.changeId));
			}
		}));
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

	// Bulk-approve safety net (plan 31 iter 4): confirm before applying a bulk approve whose set contains any
	// meaning change. Figures-only bulk approves stay one-click. The confirm mentions the pre-approve snapshot
	// (plan 26's autosnapshot on bulk approve is real) so the reviewer knows it is restorable. Runs `apply`
	// only after the user confirms (or when no confirm was needed).
	private async _confirmBulkApprove(changes: readonly { readonly kind: 'figure' | 'meaning' }[], apply: () => Promise<void>): Promise<void> {
		const confirm = bulkApproveConfirm(changes, true);
		if (confirm.needed) {
			const { confirmed } = await this._dialogService.confirm({ message: confirm.message, primaryButton: 'Approve all' });
			if (!confirmed) { return; }
		}
		await apply();
	}

	private _onMessage(message: { type?: string; cells?: string[]; mode?: string; text?: string; blockId?: string; id?: string; choice?: string; scope?: string; name?: string; mime?: string; b64?: string; reqId?: string; src?: string }): void {
		switch (message?.type) {
			case 'lwdReady':
				// The webview RUNTIME has loaded and is listening; the reducer flushes any held render + focus.
				this._runProto(applyReady(this._proto));
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
					this._proto = recordPmBody(this._proto, parseLivingDoc(text).body);
					void this._livingDocs.saveRawText(this._resource, text, { silent: true });
				}
				break;
			case 'imageFile':
				// A pasted/dropped image File (issue #141): write it beside the document as an asset and reply
				// with its doc-relative path so the webview inserts the image node at the caret.
				if (this._resource && typeof message.name === 'string' && typeof message.b64 === 'string') {
					void this._saveImageFile(message.reqId, this._resource, message.name, message.mime, message.b64);
				}
				break;
			case 'resolveImg':
				// The webview found a relative <img> src it cannot load itself; read it back as a data URI so the
				// image displays while the PM doc keeps the relative path (a missing file replies with an error flag).
				if (this._resource && typeof message.src === 'string') {
					void this._resolveImage(message.reqId, this._resource, message.src);
				}
				break;
			case 'refresh':
				// The doc toolbar Refresh scopes to THIS document (plan 30, track 1): it re-derives the open
				// document plus the co-dependents of any source that actually changed, not the whole folder.
				void this._livingDocs.refreshFromSources(this._resource);
				break;
			case 'presentOpen':
				// Compute the before-export gate as the modal opens (plan 32 iter 4), so a failed grader is SHOWN
				// with "Export anyway" + "Fix first" rather than silently blocking the export write.
				this._present = { ...this._present, open: true, gate: this._resource ? this._livingDocs.previewExportGate(this._resource) : undefined };
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
			case 'presentCta':
				void this._runPresent(false);
				break;
			// "Export anyway" past a failed gate (plan 32 iter 4): proceed with force so the override is audited.
			case 'presentCtaForce':
				void this._runPresent(true);
				break;
			// "Fix first": close the modal and jump to the flagged block so the user can reconcile it. The
			// financial gate flags on the unresolved bound blocks, so focusing the first bound block is the jump.
			case 'presentFixFirst':
				this._present = { ...this._present, open: false };
				this._render();
				this._focusFirstBoundBlock();
				break;
			case 'approve':
				if (typeof message.id === 'string') { void this._livingDocs.approve(message.id); }
				break;
			case 'reject':
				if (typeof message.id === 'string') { this._livingDocs.reject(message.id); }
				break;
			case 'amendApprove':
				// Tweak (plan 31 iter 3): the reviewer hand-edited the proposed text, then Save & Approve. Amend
				// the pending change then approve it through the one approve path (no parallel apply route).
				if (typeof message.id === 'string' && typeof message.text === 'string') {
					const id = message.id;
					this._livingDocs.amendChange(id, message.text);
					void this._livingDocs.approve(id);
				}
				break;
			case 'approveAllDoc':
				// Editor action bar: accept every pending change in THIS document at once (plan 19 iter 4).
				if (this._resource) {
					const docId = this._resource.toString();
					void this._confirmBulkApprove(this._livingDocs.getPendingForDoc(this._resource), () => this._livingDocs.approveAll(docId));
				}
				break;
			case 'approveAllEverywhere':
				// Editor action bar: accept every pending change across ALL documents (plan 19 iter 5).
				void this._confirmBulkApprove(this._livingDocs.getAllPending(), () => this._livingDocs.approveAllPending());
				break;
			case 'nextDoc':
				// Editor action bar: step the editor pane to the next document that still has pending changes.
				this._openNextChangedDoc();
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
				this._livingDocs.notePeek('click-through');
				this._render();
				break;
			case 'openSource':
				// The "Source" toolbar button opens the in-surface source pane (no cell focus).
				this._sourcePeek = { cells: [], synced: false, syncedCount: 0 };
				this._livingDocs.notePeek('toolbar');
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
				if (message.mode === 'raw' || message.mode === 'pm') {
					this._mode = message.mode;
					this._render();
				}
				break;
			case 'applyRaw':
				void this._applyRaw(typeof message.text === 'string' ? message.text : '');
				break;
		}
	}

	// The Present/export CTA maps each real destination onto the export Abstract actually writes:
	// "Web page" -> the self-contained HTML export; "Markdown" -> the clean resolved Markdown. The
	// native-format / cloud destinations are "Soon" and non-selectable, so only these two reach here.
	private async _runPresent(force: boolean): Promise<void> {
		if (!this._resource) { return; }
		if (this._present.choice === 'markdown') {
			await this._livingDocs.exportMarkdown(this._resource, force);
		} else {
			// 'html' (and any defensive fallthrough) -> the self-contained HTML page.
			await this._livingDocs.exportDocument(this._resource, force);
		}
		this._present = { ...this._present, open: false };
		this._render();
	}

	// "Fix first" (plan 32 iter 4): jump to the block the gate flagged. The Financial gate flags on the
	// bound blocks whose figures do not reconcile, so open the in-surface source pane on the first bound
	// block's keys - the reconciliation UI - rather than a dead scroll. A no-op if the doc has no bound block.
	private _focusFirstBoundBlock(): void {
		if (!this._resource) { return; }
		const doc = this._livingDocs.getDoc(this._resource);
		const bound = doc?.blocks.find(b => b.binds.length > 0);
		if (!bound) { return; }
		this._sourcePeek = { cells: bound.binds.map(b => b.key), synced: false, syncedCount: 0 };
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

	// Write a pasted/dropped image beside the document (issue #141) and post its doc-relative path back so the
	// webview inserts the image node at the caret. The alt text defaults to the file's stem (no extension).
	private async _saveImageFile(reqId: string | undefined, resource: URI, name: string, mime: string | undefined, b64: string): Promise<void> {
		try {
			const bytes = decodeBase64(b64);
			const relPath = await this._livingDocs.saveImageAsset(resource, name, bytes, mime);
			const alt = (name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
			void this._webview?.postMessage({ type: 'imageSaved', reqId, relPath, alt });
		} catch (e) {
			// A failed asset write should not wedge the paste flow silently; the webview simply gets no insert.
		}
	}

	// Resolve a relative image src to a data URI so it displays in the webview (which cannot load a path
	// relative to the document). A missing/oversized file replies with an error flag so the webview can show a
	// visible broken state rather than a silent gap.
	private async _resolveImage(reqId: string | undefined, resource: URI, src: string): Promise<void> {
		const result = await this._livingDocs.readImageAsset(resource, src);
		void this._webview?.postMessage({ type: 'imageResolved', reqId, src, dataUri: result.dataUri });
	}

	private async _applyRaw(text: string): Promise<void> {
		if (!this._resource) { return; }
		this._mode = 'pm';
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
		// The next document (other than this one) with pending changes drives the action bar's "Next
		// document" button - shown only when there is somewhere to advance to (plan 19 iter 4).
		const allPending = this._livingDocs.getAllPending();
		const nextId = nextPendingDocId(allPending, resource.toString());
		const nextChangedDocTitle = nextId ? allPending.find(c => c.docId === nextId)?.docTitle : undefined;
		// Per-key provenance for the figure/gutter hover tooltip (plan 29 iter 3): fold this document's lock
		// bindings + its live staleness set into { source, location, synced, fresh }. Empty when the document
		// is not living / has no lock, so the tooltip stays silent on a plain Markdown doc.
		const lock = this._livingDocs.getLock(resource);
		const provenance = lock
			? buildFigureProvenance(lock, new Set(this._livingDocs.getFreshness(resource).staleBindings))
			: [];
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
			nextChangedDocTitle,
			totalPendingCount: allPending.length,
			provenance,
			snapshotCount: this._livingDocs.getSnapshots(resource).length,
			// The web build's workspace mount is an in-memory / memfs provider whose writes are lost on a
			// page reload (issue #121 / decision 162): mark the render ephemeral so the toolbar states that
			// plainly rather than claiming a durable "Saved". Electron's disk-backed provider persists, so
			// `isWeb` is false there and the normal Saved chip stands. There is no file-provider capability
			// flag for "survives reload", so the build type is the honest signal for this contract.
			ephemeral: isWeb,
		};
		const content = renderLivingDocContent(input);
		// The mount-once lifecycle (first-render setHtml, pmReset only on a model-driven body change,
		// hold-until-ready) is decided by the pure reducer; this shell just carries out its effects. The
		// setHtml effect needs the FULL shell HTML, built here on demand so the reducer stays DOM-free.
		this._runProto(applyRender(this._proto, content), () => renderLivingDocHtml(input));
	}

	// Advance the mount-once lifecycle state and carry out the reducer's effects against the live webview.
	// `shellHtml` is a lazy builder for the first-render setHtml (only called for the setHtml effect).
	private _runProto(step: { state: IEditorWebviewState; effects: readonly EditorWebviewEffect[] }, shellHtml?: () => string): void {
		this._proto = step.state;
		if (!this._webview) { return; }
		for (const effect of step.effects) {
			switch (effect.kind) {
				case 'setHtml':
					this._webview.setHtml(shellHtml ? shellHtml() : '');
					break;
				case 'postRender':
					void this._webview.postMessage({ type: 'lwdRender', html: effect.html, pmMd: effect.pmMd, pmDeco: effect.pmDeco, pmReset: effect.pmReset });
					break;
				case 'postFocus':
					void this._webview.postMessage({ type: 'focusChange', id: effect.id });
					break;
				case 'holdPending':
					// The render is held in the reducer state; nothing to post until the RUNTIME signals ready.
					break;
			}
		}
	}

	// Editor action bar "Next document with changes": advance the pane to the next document that still has
	// pending changes (cycling), so the whole multi-doc review can be driven from the document surface.
	private _openNextChangedDoc(): void {
		if (!this._resource) { return; }
		const nextId = nextPendingDocId(this._livingDocs.getAllPending(), this._resource.toString());
		// Open in this pane's own group so a split layout advances the document the action came from,
		// rather than falling back to whichever group happens to be active.
		if (nextId) { void this._editorService.openEditor({ resource: URI.parse(nextId) }, this.group); }
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}

	// plan 16 iter 3 (decision 56): when the editor pane is focused (e.g. right after `openEditor` for a
	// freshly-created doc), forward focus into the webview iframe so the in-iframe ProseMirror view's own
	// `focus()` (called on mount) actually lands the caret -- "one click -> cursor ready". Without this the
	// base pane focuses its container DOM, the iframe never gets browser focus, and the caret stays out of PM.
	override focus(): void {
		super.focus();
		this._webview?.focus();
	}
}
