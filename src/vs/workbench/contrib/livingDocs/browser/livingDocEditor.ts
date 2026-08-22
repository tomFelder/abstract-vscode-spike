/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { decodeBase64 } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ILivingDocsService, runBulkVerb } from '../common/livingDocs.js';
import { HeaderPillKind, IAbstractHeaderService } from '../common/abstractHeader.js';
import { localize } from '../../../../nls.js';
import { IBulkScope, nextPendingDocId } from '../common/livingDocsModel.js';
import { buildFigureProvenance } from '../common/livingDocPmDecorations.js';
import { documentDisplayTitle, parseLivingDoc, withReplacedBody } from '../common/livingDocMarkdown.js';
import { applyFocusRequest, applyReady, applyRender, applyRevealBlock, applyRevealHeading, EditorWebviewEffect, IEditorWebviewState, initialEditorWebviewState, recordPmBody } from '../common/editorWebviewProtocol.js';
import { AbstractTabStrip, createTabStripStyle } from './abstractTabStrip.js';
import { LivingDocEditorInput } from './livingDocEditorInput.js';
import { ILivingDocRenderInput, IPresentState, IPropertiesRenderState, LivingDocViewMode, PresentChoice, renderLivingDocContent, renderLivingDocHtml } from './livingDocRender.js';
import { renderPropertiesPanel } from './propertiesPanelRender.js';
import { coerceDocPolicy } from '../common/docPolicy.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { advanceOnboardingOnPeek } from './onboardingWalkthrough.js';
import { wordPasteNotice } from '../common/livingDocWordPaste.js';
import { documentNamesFromFiles, resolveWikilinkTarget } from '../common/wikilinks.js';

export class LivingDocEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDoc';

	private _container: HTMLElement | undefined;
	// The product-tab strip (pin 7): Abstract's own DOM in the pane host, above the webview (never inside it,
	// which would flicker on doc switch). The webview mounts into `_webviewHost` below the strip so the strip is
	// a native, non-flickering row. Bound to this pane's group; disposed with the pane.
	private _tabStrip: AbstractTabStrip | undefined;
	private _webviewHost: HTMLElement | undefined;
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
	// A Cmd+F that arrived before the webview RUNTIME was listening (plan 52 WP-E). The find widget lives
	// inside the webview, so a `findOpen` posted into a not-yet-ready frame would be dropped silently and the
	// chord would look broken; hold it here instead and flush it on `lwdReady`, the same hold-until-ready rule
	// the render/focus effects in `editorWebviewProtocol.ts` follow.
	private _pendingFindOpen = false;
	private readonly _inputDisposables = this._register(new DisposableStore());
	// The Properties panel's open state for the CURRENT document (plan 45 pin 12). Read from the storage service
	// on setInput (per-doc key `livingDocs.v2.props.<docId>`), so opening the same doc later restores the panel.
	private _propsOpen = false;
	// The document's created/updated times (from the file stat), fetched async and cached so the pure render can
	// read them synchronously. Refreshed on setInput and after a frontmatter write (which touches mtime).
	private _docTimes: { readonly created?: number; readonly updated?: number } = {};
	// Every document name in the workspace, for the `[[` picker and the resolved/unresolved chip (plan 52
	// WP-C). The webview cannot scan the folder, so the host holds the list and pushes it in. Cached on the
	// pane rather than recomputed per render: `_render` runs on every keystroke-driven save, and this is a
	// bounded folder scan. It survives a document switch (the set is workspace-wide, not per-document).
	private _docNames: readonly string[] = [];
	// Coalesces the rescan behind the service's change event, which fires on every 300ms autosave. The tree
	// rail already rescans on every one of those with no delay at all, so this is strictly the cheaper caller.
	private readonly _docNamesScan = this._register(new RunOnceScheduler(() => void this._refreshDocNames(), 750));

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IEditorService private readonly _editorService: IEditorService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IInstantiationService private readonly _instantiation: IInstantiationService,
		@IAbstractHeaderService private readonly _header: IAbstractHeaderService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@INotificationService private readonly _notification: INotificationService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
	) {
		super(LivingDocEditor.ID, group, telemetryService, themeService, _storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = $('.living-doc-editor');
		this._container.style.height = '100%';
		this._container.style.width = '100%';
		this._container.style.display = 'flex';
		this._container.style.flexDirection = 'column';
		// The product-tab strip sits in the pane HOST DOM, above the webview (pin 7 / P7.1) - a native row that
		// never flickers on doc switch. The webview mounts into `_webviewHost` (flex:1) below it. The strip is
		// bound to this pane's group and mirrors it live via its own listeners, so an "Open to the right", a
		// close, or a programmatic open all repaint it.
		parent.appendChild(createTabStripStyle());
		this._tabStrip = this._register(new AbstractTabStrip(this.group, this._livingDocs, this._storageService, this._contextMenuService, this._editorService, this._dialogService, this._quickInputService));
		this._container.appendChild(this._tabStrip.element);
		this._webviewHost = $('.living-doc-webview-host');
		this._webviewHost.style.flex = '1';
		this._webviewHost.style.minHeight = '0';
		this._webviewHost.style.position = 'relative';
		this._container.appendChild(this._webviewHost);
		parent.appendChild(this._container);
	}

	override async setInput(input: LivingDocEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._mode = 'pm';
		this._present = { open: false, choice: 'html' };
		this._sourcePeek = undefined;
		this._resource = input.resource;
		// Restore the Properties panel's open state for this document (plan 45 pin 12 / P12.6, persistence key
		// spec 43 section 3.5). Per-doc so a panel opened on doc A does not force it open on doc B.
		this._propsOpen = this._storageService.getBoolean(this._propsStorageKey(input.resource), StorageScope.WORKSPACE, false);
		this._docTimes = {};
		// Dispose the previous input's webview (registered to `_inputDisposables`) and build a fresh one.
		this._inputDisposables.clear();
		this._proto = initialEditorWebviewState();
		// A find held for the PREVIOUS document must not open on this one.
		this._pendingFindOpen = false;
		this._createWebview();
		// This webview is the only thing that can see whether a pending change really mounted an inline widget, and
		// what it reports is true only while it is alive and showing THIS document. So the report is retired with it
		// (plan 52 WP-A1 fix 2, #301): registered on `_inputDisposables`, which is cleared by `clearInput` - the
		// workbench calls that when the pane stops showing an input, and again before every `setInput` - and disposed
		// with the pane. The resource is captured rather than read from `this._resource` at teardown time, because by
		// then `_resource` may already name the document that replaced this one.
		const reportedResource = input.resource;
		this._inputDisposables.add(toDisposable(() => this._livingDocs.clearInlineWidgets(reportedResource)));
		this._inputDisposables.add(this._livingDocs.onDidChange(() => {
			this._render();
			// A document may have been created, renamed or deleted, which changes which wikilinks resolve.
			this._docNamesScan.schedule();
		}));
		// Rail-to-editor navigation: when a change for THIS document is asked to be focused, scroll to it.
		this._inputDisposables.add(this._livingDocs.onDidRequestFocusChange(e => {
			if (this._resource && e.docId === this._resource.toString()) {
				this._runProto(applyFocusRequest(this._proto, e.changeId));
			}
		}));
		// Outline-to-editor navigation (issue #181): clicking a heading scrolls this surface to it.
		this._inputDisposables.add(this._livingDocs.onDidRequestRevealHeading(e => {
			if (this._resource && e.docId === this._resource.toString()) {
				this._runProto(applyRevealHeading(this._proto, e.headingIndex));
			}
		}));
		// Tree menu "Present" (pin 6): the context menu opened this document and asks it to open its Present
		// flow - the same modal the header's Present action drives. Navigate-only, mirroring revealHeading.
		this._inputDisposables.add(this._livingDocs.onDidRequestPresent(e => {
			if (this._resource && e.docId === this._resource.toString()) {
				this._openPresent();
			}
		}));
		// Home-to-editor deep link (plan 48 H2.3u): a NEEDS-YOU card scrolls this surface to the addressed block.
		this._inputDisposables.add(this._livingDocs.onDidRequestRevealBlock(e => {
			if (this._resource && e.docId === this._resource.toString()) {
				this._runProto(applyRevealBlock(this._proto, e.blockIndex));
			}
		}));
		await this._livingDocs.loadDocument(input.resource);
		// Awaited before the first paint so a wikilink is never shown as unresolved for a document that does
		// exist - a wrong "this does not exist yet" is exactly the kind of fabricated state this product must
		// not show, even for one frame.
		await this._refreshDocNames();
		this._render();
		// The created/updated times come from the file stat (async); fetch after the first render and re-render
		// when they arrive so the panel shows truthful dates without blocking the editor's first paint.
		void this._refreshDocTimes(input.resource);
	}

	// The pane has stopped showing a document (its tab was closed, its group emptied, or another input is about to
	// take the pane). Tear the input's surface down here rather than waiting for the next `setInput`, so the moment
	// there is nobody observing this document is the moment its inline-widget report is retired (plan 52 WP-A1 fix
	// 2, #301). Leaving the webview mounted-but-unwatched is what let a closed document keep answering "the widget
	// is there" for a file that had since changed on disk, which stranded the reader who followed a chat pointer.
	//
	// `_webview` and `_resource` are dropped with it: both are guarded at every use (`_render`, `_runProto` and each
	// `_onMessage` branch all return early without them), so a late message from the dying webview is ignored rather
	// than attributed to a document this pane no longer shows.
	override clearInput(): void {
		this._inputDisposables.clear();
		this._webview = undefined;
		this._resource = undefined;
		super.clearInput();
	}

	// The per-doc storage key for the Properties panel's open state (spec 43 section 3.5, WORKSPACE scope).
	private _propsStorageKey(resource: URI): string {
		return `livingDocs.v2.props.${resource.toString()}`;
	}

	// Run a frontmatter write for the current document, then refresh its stat times (a disk write bumps the
	// mtime, so the panel's UPDATED date must re-read). The write itself fires onDidChange, which re-renders.
	private async _writeThenRefreshTimes(write: (resource: URI) => Promise<void>): Promise<void> {
		const resource = this._resource;
		if (!resource) { return; }
		await write(resource);
		await this._refreshDocTimes(resource);
	}

	// The document names the `[[` picker offers and the chips resolve against (plan 52 WP-C). Identity is the
	// FILE STEM, not the display title: that is what Obsidian links by, and it is what `createDocument(name)`
	// writes, so a link that creates a document resolves to it immediately afterwards. Pushed to the webview
	// only when the set actually changed, so the common case (a save that created nothing) posts nothing.
	private async _refreshDocNames(): Promise<void> {
		const docs = await this._livingDocs.listDocuments();
		const names = documentNamesFromFiles(docs.map(d => basename(d.resource)));
		if (names.length === this._docNames.length && names.every((n, i) => n === this._docNames[i])) { return; }
		this._docNames = names;
		void this._webview?.postMessage({ type: 'lwdDocs', names });
	}

	// Resolve a document name to its file, using the SAME pure rule the chips and the picker use, so what the
	// reader saw marked "resolved" is exactly what opens.
	private async _resolveWikilinkResource(target: string): Promise<URI | undefined> {
		const docs = await this._livingDocs.listDocuments();
		const byName = new Map<string, URI>();
		for (const doc of docs) {
			const stem = documentNamesFromFiles([basename(doc.resource)])[0];
			if (stem && !byName.has(stem)) { byName.set(stem, doc.resource); }
		}
		const match = resolveWikilinkTarget(target, [...byName.keys()]);
		return match ? byName.get(match) : undefined;
	}

	// Follow a wikilink: open the document it names, or create it when nothing carries that name. Opened in
	// this pane's own group so a split layout navigates the pane the click came from, matching "Next document".
	private async _openWikilink(target: string): Promise<void> {
		const resource = await this._resolveWikilinkResource(target);
		if (resource) {
			await this._editorService.openEditor({ resource }, this.group);
			return;
		}
		// `createDocument` writes `<name>.md` (stripping path-hostile characters) and opens it, so the reader
		// lands in the document they just willed into existence. The rescan makes the link that created it
		// resolve from then on.
		await this._livingDocs.createDocument(target);
		await this._refreshDocNames();
	}

	// Fetch the document's created/updated times from the file stat and re-render if they changed. Guarded on
	// the resource so a stale async result from a previous input is dropped.
	private async _refreshDocTimes(resource: URI): Promise<void> {
		const times = await this._livingDocs.getDocTimes(resource);
		if (this._resource?.toString() !== resource.toString()) { return; }
		if (times.created === this._docTimes.created && times.updated === this._docTimes.updated) { return; }
		this._docTimes = times;
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
		if (!this._webviewHost) {
			return;
		}
		const webview = this._webviewService.createWebviewElement({
			options: {},
			contentOptions: { allowScripts: true },
			title: 'Living Document',
			extension: undefined,
		});
		webview.mountTo(this._webviewHost, this.window);
		this._inputDisposables.add(webview.onMessage(e => this._onMessage(e.message)));
		this._inputDisposables.add(webview);
		this._webview = webview;
	}

	// The resource whose pending changes the doc-scoped bulk actions operate on (#253). Prefer this pane's
	// own `_resource`, but fall back to the group's active-editor resource when `_resource` has no pending
	// changes of its own - the chat rail queues proposals against the group's active-editor resource, so on
	// the rare occasion those two identities drift the active editor is the authoritative one and must not be
	// stranded. Returns undefined only when neither identity is available.
	private _resourceForPending(): URI | undefined {
		if (this._resource && this._livingDocs.getPendingForDoc(this._resource).length > 0) {
			return this._resource;
		}
		const active = this.group.activeEditor?.resource;
		if (active && this._livingDocs.getPendingForDoc(active).length > 0) {
			return active;
		}
		return this._resource;
	}

	/**
	 * Run a bulk verb through the ONE bulk path (docs/30 invariant I4): capture the ids with their sentence,
	 * confirm, then apply exactly those ids. The pane never derives a set of its own.
	 */
	private async _runBulk(scope: IBulkScope): Promise<void> {
		await runBulkVerb(this._livingDocs, this._dialogService, scope);
	}

	/**
	 * Editing the document PINS its preview tab (plan 52 WP-F) - the same rule VS Code applies when an editor
	 * becomes dirty. Core does that automatically (`onDidChangeEditorDirty` -> `pinEditor` in editorGroupView),
	 * but a living document is never dirty: `LivingDocEditorInput` is Readonly and every edit is written straight
	 * to disk by the service, so no dirty event ever fires for it. We therefore make core's OWN call explicitly on
	 * the paths that change the document's content. Pinning an already-pinned editor is a no-op in the group model,
	 * so this is safe to call on every keystroke-driven save.
	 */
	private _pinOnEdit(): void {
		if (this.input) { this.group.pinEditor(this.input); }
	}

	private _onMessage(message: { type?: string; cells?: string[]; mode?: string; text?: string; blockId?: string; id?: string; choice?: string; scope?: string; name?: string; mime?: string; b64?: string; reqId?: string; src?: string; policy?: string; title?: string; status?: string; tag?: string; add?: boolean; html?: string; requested?: string[]; mounted?: string[]; target?: string }): void {
		switch (message?.type) {
			case 'lwdReady':
				// The webview RUNTIME has loaded and is listening; the reducer flushes any held render + focus.
				this._runProto(applyReady(this._proto));
				// ... and a Cmd+F that raced the load now has a widget to open.
				if (this._pendingFindOpen) {
					this._pendingFindOpen = false;
					this.openFind();
				}
				break;
			case 'pmWidgets':
				// The live surface reported which pending changes it ACTUALLY mounted an inline widget for (plan 52
				// WP-A1 fix 1, #301). The host cannot see inside the webview, so without this report the chat
				// transcript's change pointers had to PREDICT whether a widget would appear - and a wrong prediction
				// sent the reader to a block showing nothing at all. Recorded on the service so the review rail can
				// read it. Safe to attribute to `this._resource`: the webview is created fresh per input (see
				// `_createWebview`) with `_resource` already set, and the previous webview's message listener is
				// disposed with the previous input, so a report can never arrive from another document.
				if (this._resource && Array.isArray(message.requested) && Array.isArray(message.mounted)) {
					this._livingDocs.reportInlineWidgets(this._resource, message.requested, message.mounted);
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
					this._proto = recordPmBody(this._proto, parseLivingDoc(text).body);
					void this._livingDocs.saveRawText(this._resource, text, { silent: true });
					this._pinOnEdit();
				}
				break;
			case 'wordPaste':
				// A Word/Office clipboard payload was just pasted into the live surface (issue #256). The structure
				// itself is rebuilt in the webview (headings kept as blocks, tables as GFM, lists nested); here we
				// weigh the honesty notice using the SAME converter the docx import uses, and raise a quiet toast
				// ONLY when something was genuinely dropped (tracked-change marks, comments). A lossless paste says
				// nothing - the notice is a contract, not noise.
				if (typeof message.html === 'string') {
					const notice = wordPasteNotice(message.html);
					if (notice) {
						this._notification.notify({ severity: Severity.Info, message: localize('livingDocs.wordPasteNotice', "Pasted from Word: {0}", notice) });
					}
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
				// with "Export anyway" + "Fix first" rather than silently blocking the export write. Shared with
				// the header's Present action (plan 44-b).
				this._openPresent();
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
				if (typeof message.id === 'string') { void this._livingDocs.reject(message.id); }
				break;
			case 'amendApprove':
				// Tweak (plan 31 iter 3): the reviewer hand-edited the proposed text, then Save & Approve. Amend
				// the pending change then approve it through the one approve path (no parallel apply route).
				if (typeof message.id === 'string' && typeof message.text === 'string') {
					const id = message.id;
					// Sequenced: the amend stacks a revision in the change store and the approve must read it, so
					// firing both without awaiting would race the approve against its own new text.
					void this._livingDocs.amendChange(id, message.text).then(() => this._livingDocs.approve(id));
				}
				break;
			case 'approveAllDoc': {
				// Editor action bar: accept every pending change in THIS document at once (plan 19 iter 4).
				// Scope the capture by the proposals' OWN docId (#253) - never a re-derived
				// `this._resource.toString()`. `_resource` can drift from the docId the proposals were queued
				// under (the chat rail queues them against the GROUP's active-editor resource, which is not
				// guaranteed to be the same URI instance this pane last set), which used to make the bulk verb
				// filter to an empty set and silently no-op - no dialog, no apply. `_resourceForPending` falls
				// back to the group's active-editor resource so a drifted `_resource` cannot strand the pending
				// changes the user is looking at. The capture then makes the confirmed set and the applied set
				// the same object by construction (docs/30 invariant I4).
				const resource = this._resourceForPending();
				const docId = resource && this._livingDocs.pendingDocIdFor(resource);
				if (docId) {
					void this._runBulk({ verb: 'approve', docId });
				}
				break;
			}
			case 'approveAllEverywhere':
				// Editor action bar: accept every pending change across ALL documents (plan 19 iter 5).
				void this._runBulk({ verb: 'approve' });
				break;
			case 'nextDoc':
				// Editor action bar: step the editor pane to the next document that still has pending changes.
				this._openNextChangedDoc();
				break;
			case 'openWikilink':
				// A [[wikilink]] chip was followed. A target that names an existing document opens it; one that
				// names nothing CREATES that document and opens it, which is Obsidian's behaviour and the whole
				// point of an unresolved link being clickable rather than inert.
				if (typeof message.target === 'string') { void this._openWikilink(message.target); }
				break;
			case 'openProject':
				// The breadcrumb's clickable project segment (issue #174): navigate back to the project view -
				// the Home screen, which lists the workspace's documents and recent activity. Opened through
				// IEditorService (revealIfOpened) so an already-open Home is reused rather than duplicated.
				void this._editorService.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'home'), { pinned: true, revealIfOpened: true });
				break;
			case 'askAi':
				this._livingDocs.focusPanel('chat');
				break;
			case 'toggleProperties':
				// Toggle the Properties panel and persist its open state per-doc (plan 45 pin 8/12).
				if (this._resource) {
					this._propsOpen = !this._propsOpen;
					this._storageService.store(this._propsStorageKey(this._resource), this._propsOpen, StorageScope.WORKSPACE, StorageTarget.USER);
					this._render();
				}
				break;
			case 'setDocPolicy':
				// AGENT POLICY edit (#122 F11): write the doc's frontmatter policy on disk. onDidChange re-renders.
				if (this._resource && typeof message.policy === 'string') {
					const policy = coerceDocPolicy(message.policy);
					void this._writeThenRefreshTimes(resource => this._livingDocs.setDocPolicy(resource, policy));
				}
				break;
			case 'setDocTitle':
				if (this._resource && typeof message.title === 'string') {
					const title = message.title;
					void this._writeThenRefreshTimes(resource => this._livingDocs.setDocTitle(resource, title));
				}
				break;
			case 'setDocStatus':
				if (this._resource && typeof message.status === 'string') {
					const status = message.status;
					void this._writeThenRefreshTimes(resource => this._livingDocs.setDocStatus(resource, status));
				}
				break;
			case 'setDocTag':
				if (this._resource && typeof message.tag === 'string' && typeof message.add === 'boolean') {
					const tag = message.tag;
					const add = message.add;
					void this._writeThenRefreshTimes(resource => this._livingDocs.setDocTag(resource, tag, add));
				}
				break;
			case 'export':
				if (this._resource) { void this._livingDocs.exportDocument(this._resource); }
				break;
			case 'exportMd':
				if (this._resource) { void this._livingDocs.exportMarkdown(this._resource); }
				break;
			case 'share':
				if (this._resource) { void this._livingDocs.shareDocument(this._resource); }
				break;
			case 'reveal':
				// Clicking (or keyboard-activating) a bound figure or provenance dot opens the in-surface source
				// pane focused on those cells - the wedge's provenance door (#254).
				this._sourcePeek = { cells: Array.isArray(message.cells) ? message.cells : [], synced: false, syncedCount: 0 };
				this._livingDocs.notePeek('click-through');
				this._notePeekForOnboarding();
				this._render();
				break;
			case 'openSource':
				// The "Source" toolbar button opens the in-surface source pane (no cell focus).
				this._sourcePeek = { cells: [], synced: false, syncedCount: 0 };
				this._livingDocs.notePeek('toolbar');
				this._notePeekForOnboarding();
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
					this._pinOnEdit();
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
				this._pinOnEdit();
				break;
		}
	}

	// The Present/export CTA maps each real destination onto the export Abstract actually writes:
	// "Web page" -> self-contained HTML; "Markdown" -> clean resolved Markdown; "PDF" -> desktop print-to-PDF
	// of that HTML; "Word" -> a .docx mapped to Word's built-in styles (doc 22 section 3). The cloud/spreadsheet
	// destinations stay "Soon" and non-selectable, so only these four reach here.
	private async _runPresent(force: boolean): Promise<void> {
		if (!this._resource) { return; }
		switch (this._present.choice) {
			case 'markdown':
				await this._livingDocs.exportMarkdown(this._resource, force);
				break;
			case 'pdf':
				await this._livingDocs.exportPdf(this._resource, force);
				break;
			case 'docx':
				await this._livingDocs.exportDocx(this._resource, force);
				break;
			default:
				// 'html' (and any defensive fallthrough) -> the self-contained HTML page.
				await this._livingDocs.exportDocument(this._resource, force);
				break;
		}
		this._present = { ...this._present, open: false };
		this._render();
	}

	// D26 wow one (#255): a real provenance peek on the demo document advances the persisted onboarding step
	// (provenance-peek -> first-diff) so the re-entered onboarding card shows wow one complete only because it
	// actually happened. The matching `provenance-peek` funnel event is recorded separately at this same peek
	// (LivingDocsService.notePeek), so the card and events.log agree. A no-op outside a walkthrough or off the
	// demo document (see advanceOnboardingOnPeek). The onboarding card is displaced by the demo document during
	// the walkthrough, so it re-reads the persisted step when it is next re-entered from Home - no event needed.
	private _notePeekForOnboarding(): void {
		advanceOnboardingOnPeek(this._storageService, this._resource?.toString());
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
			? buildFigureProvenance(lock, new Set(this._livingDocs.getFreshness(resource).staleBindings), this._livingDocs.getCurrentValues(resource))
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
			// The editor breadcrumb (issue #174): the clickable project segment is the opened workspace
			// folder's display name, and the grey file-name segment is the document resource's basename, so the
			// bar reads `project / title  file.md` instead of the static brand/type crumb. The workspace folder
			// name comes from the workspace service (the same source the rest of the contrib uses for the
			// project root); it is undefined when no folder is open, in which case the render falls back to the
			// brand crumb.
			projectName: this._workspace.getWorkspace().folders[0]?.name,
			fileName: basename(resource),
			properties: this._buildProperties(resource),
			// The workspace's document names, so the shell's first paint already knows which wikilinks resolve
			// (plan 52 WP-C); refreshed afterwards by `lwdDocs` messages rather than on every render.
			docNames: this._docNames,
		};
		this._publishHeader(input);
		const content = renderLivingDocContent(input);
		// The mount-once lifecycle (first-render setHtml, pmReset only on a model-driven body change,
		// hold-until-ready) is decided by the pure reducer; this shell just carries out its effects. The
		// setHtml effect needs the FULL shell HTML, built here on demand so the reducer stays DOM-free.
		this._runProto(applyRender(this._proto, content), () => renderLivingDocHtml(input));
	}

	// Build the Properties panel's render state (plan 45 pin 12): the toolbar button and the inset panel appear
	// only in PM mode on a real document. The panel's HTML is built here (host-side) from the service's truthful
	// reads - the panel renderer stays a pure `(model) -> html`. Its own content is built even when the panel is
	// closed so the toolbar Properties button reflects the open state without a second render.
	private _buildProperties(resource: URI): IPropertiesRenderState | undefined {
		const doc = this._livingDocs.getDoc(resource);
		if (!doc || this._mode !== 'pm') { return undefined; }
		const html = renderPropertiesPanel({
			docId: resource.toString(),
			title: doc.frontmatterTitle ?? '',
			displayTitle: documentDisplayTitle(doc, basename(resource)),
			status: doc.status ?? '',
			tags: doc.tags ?? [],
			created: this._docTimes.created,
			updated: this._docTimes.updated,
			boundSources: this._livingDocs.getBoundSources(resource),
			policy: this._livingDocs.getDocPolicy(resource),
		});
		return { open: this._propsOpen, html };
	}

	// (plan 44-b PH.2/PH.3) Publish this document's content to the one global Abstract header (the repurposed
	// title bar): the breadcrumb tail is the document title with its file name suffix; the sync pill reads
	// "All sources synced" for a living document (a pending proposal is surfaced by the right-toggle badge,
	// not here); the action is Present; the editor surface shows both rail toggles. The pill is omitted for a
	// plain Markdown doc (no sources to be synced) - the shell stays truthful before the first source use.
	private _publishHeader(input: ILivingDocRenderInput): void {
		const isLiving = !!input.doc?.isLiving;
		this._header.setContent({
			breadcrumb: input.doc?.title ?? '',
			fileName: input.fileName,
			pill: isLiving
				? { kind: HeaderPillKind.Sync, label: localize("livingDocs.header.allSynced", "All sources synced") }
				: undefined,
			action: (input.doc && this._mode === 'pm')
				// allow-any-unicode-next-line
				? { label: localize("livingDocs.header.present", "↗ Present"), run: () => this._openPresent() }
				: undefined,
			showRailToggles: true,
		});
	}

	// The header's Present action mirrors the in-webview `presentOpen` message: compute the before-export
	// gate and open the modal (plan 44-b - the Present button moved from the per-doc top bar to the header).
	private _openPresent(): void {
		this._present = { ...this._present, open: true, gate: this._resource ? this._livingDocs.previewExportGate(this._resource) : undefined };
		this._render();
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
				case 'postRevealHeading':
					void this._webview.postMessage({ type: 'revealHeading', headingIndex: effect.headingIndex });
					break;
				case 'postRevealBlock':
					void this._webview.postMessage({ type: 'revealBlock', blockIndex: effect.blockIndex });
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

	/**
	 * Open the in-document find widget (plan 52 WP-E). Called by the `livingDocs.editor.find` action when
	 * Cmd+F is pressed with the pane focused but the caret OUTSIDE the document iframe (the tab strip, a rail,
	 * the header). When the caret is already inside the document the webview answers the chord itself, without
	 * a round trip - so this path exists only to make the chord work from everywhere the pane can be focused.
	 * Focus is forwarded into the iframe first, since the widget's input lives in there.
	 */
	openFind(): void {
		if (!this._webview) { return; }
		if (!this._proto.ready) { this._pendingFindOpen = true; return; }
		this._webview.focus();
		void this._webview.postMessage({ type: 'findOpen' });
	}
}
