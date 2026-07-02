/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { IAgentRun } from '../common/livingDocsModel.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ILivingDocSummary, ILivingDocsService } from '../common/livingDocs.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { AgentFilter, IRecentProject, renderScreenHtml, ScreenId } from './screenRender.js';

// The editor's interactive state; the live agent registry is injected at render time.
interface IScreenEditorState {
	knScope: 'org' | 'project';
	openAgentId?: string;
	filter: AgentFilter;
	lastRun?: IAgentRun;
	// Home: the documents discovered in the open folder (fetched async; the folder name is read live at render).
	docs?: readonly ILivingDocSummary[];
	// Home: recently-opened folders from the workbench history (D22-A); fetched async alongside docs.
	recentFolders?: readonly IRecentProject[];
}

// Webview editor that hosts one Abstract screen (Templates / Knowledge / Agents) in the
// editor area. The screen's small interactive state (Knowledge scope, agent canvas, run state)
// lives here and re-renders the webview, mirroring the comp; cross-surface actions are routed to
// the living-docs service / editor service.
export class ScreenEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDocs.screen';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	private _screen: ScreenId = 'templates';
	private _state: IScreenEditorState = { knScope: 'org', filter: 'all' };
	private readonly _inputDisposables = this._register(new DisposableStore());
	// Holds the current webview. The iframe reloads (blank) whenever this pane is hidden by another
	// editor in the group and later re-shown (DOM re-parent), and the low-level webview does not
	// re-apply its HTML, so we recreate it fresh each time the pane becomes visible.
	private readonly _webviewStore = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IEditorService private readonly _editors: IEditorService,
		@IInstantiationService private readonly _instantiation: IInstantiationService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IWorkspacesService private readonly _workspaces: IWorkspacesService,
		@IHostService private readonly _host: IHostService,
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
		this._screen = input.screen;
		// Reset per-screen state on (re)open so each visit starts from the default view.
		this._state = { knScope: 'org', filter: 'all' };
		// Home reflects the open folder: fetch its documents + recent folders before the first render so there is no flash.
		if (this._screen === 'home') {
			const [docs, recentFolders] = await Promise.all([
				this._livingDocs.listDocuments(),
				this._fetchRecentFolders(),
			]);
			this._state = { ...this._state, docs, recentFolders };
		}
		this._inputDisposables.clear();
		// Re-render when agent status / the document set changes (e.g. a run completes, a doc is created).
		this._inputDisposables.add(this._livingDocs.onDidChange(() => this._onDidChange()));
		this._mountWebview();
	}

	// A document or agent changed: re-fetch the Home document list (so a new/removed doc shows), else re-render.
	private _onDidChange(): void {
		if (this._screen === 'home') {
			void this._refreshHome();
		} else {
			this._render();
		}
	}

	private async _refreshHome(): Promise<void> {
		const [docs, recentFolders] = await Promise.all([
			this._livingDocs.listDocuments(),
			this._fetchRecentFolders(),
		]);
		this._state = { ...this._state, docs, recentFolders };
		this._render();
	}

	// Fetch the workbench recently-opened folder list for the ALL PROJECTS grid (D22-A). Maps each
	// IRecentFolder to a plain { name, folderUri } object that the renderer can serialize safely into
	// HTML without holding a live URI reference inside a pure render function.
	// Name resolution order: (1) the stored human label (set when VSCode knows a display name),
	// (2) the last non-empty path segment of the folderUri (e.g. "/Users/tom/brief" -> "brief"),
	// (3) basename() from the resource module. Entries that produce only a single letter or an
	// empty name after this are skipped - they are FSA mount stubs with no useful display name.
	private async _fetchRecentFolders(): Promise<readonly IRecentProject[]> {
		try {
			const { workspaces } = await this._workspaces.getRecentlyOpened();
			return workspaces
				.filter(isRecentFolder)
				.map(r => {
					const segments = r.folderUri.path.split('/').filter(Boolean);
					const lastName = segments[segments.length - 1] ?? '';
					const name = r.label ?? (lastName.length > 1 ? lastName : basename(r.folderUri));
					return { name, folderUri: r.folderUri.toString() };
				})
				.filter(r => r.name.length > 1);
		} catch {
			return [];
		}
	}

	// Recreate the webview fresh and render the current screen into it. Called on setInput and whenever
	// the pane becomes visible, so a screen reopened after a document editor was active is never blank.
	private _mountWebview(): void {
		if (!this._container) {
			return;
		}
		const store = new DisposableStore();
		const webview = store.add(this._webviewService.createWebviewElement({
			options: {},
			contentOptions: { allowScripts: true },
			title: 'Abstract',
			extension: undefined,
		}));
		this._container.replaceChildren();
		webview.mountTo(this._container, this.window);
		store.add(webview.onMessage(e => this._onMessage(e.message)));
		this._webview = webview;
		this._webviewStore.value = store;
		this._render();
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (visible) {
			this._mountWebview();
		}
	}

	private _onMessage(message: { type?: string; arg?: string }): void {
		switch (message?.type) {
			case 'setKnOrg':
				this._state = { ...this._state, knScope: 'org' };
				this._render();
				break;
			case 'setKnProject':
				this._state = { ...this._state, knScope: 'project' };
				this._render();
				break;
			case 'setFilter':
				this._state = { ...this._state, filter: (message.arg as AgentFilter) ?? 'all' };
				this._render();
				break;
			case 'openAgent':
				this._state = { ...this._state, openAgentId: message.arg, lastRun: undefined };
				this._render();
				break;
			case 'closeAgent':
				this._state = { ...this._state, openAgentId: undefined, lastRun: undefined };
				this._render();
				break;
			case 'runWf':
				if (message.arg) { void this._runAgent(message.arg); }
				break;
			case 'goReview':
				this._livingDocs.focusPanel('review');
				break;
			case 'goEditor':
			case 'present':
				void this._openFirstDocument();
				break;
			case 'goTemplates':
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'templates'), { pinned: true });
				break;
			case 'openFolder':
				void this._livingDocs.openFolder();
				break;
			case 'newDocument':
				void this._livingDocs.createDocument();
				break;
			case 'openDoc':
				if (message.arg) { void this._editors.openEditor({ resource: URI.parse(message.arg), options: { pinned: true } }); }
				break;
			// Home ALL PROJECTS: the current folder tile focuses its first document (it is already open).
			case 'openFirstDoc':
				void this._openFirstDocument();
				break;
			// Home ALL PROJECTS: re-open a recently-used folder as the workspace (D22-A).
			case 'openRecentFolder':
				if (message.arg) {
					void this._host.openWindow([{ folderUri: URI.parse(message.arg) }], { forceReuseWindow: true });
				}
				break;
		}
	}

	// "Run now": execute the agent end-to-end, show its run on the canvas, and reveal the review rail
	// when it queued anything for approval.
	private async _runAgent(agentId: string): Promise<void> {
		const run = await this._livingDocs.runAgent(agentId);
		this._state = { ...this._state, lastRun: run };
		this._render();
		if (run && run.queued > 0) { this._livingDocs.focusPanel('review'); }
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
		// Inject the live agent registry + the open-folder state at render time so Home/Agents reflect current state.
		const folderName = this._livingDocs.getWorkspaceFolderName();
		this._webview?.setHtml(renderScreenHtml(this._screen, { ...this._state, agents: this._livingDocs.getAgents(), hasFolder: !!folderName, folderName }));
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
