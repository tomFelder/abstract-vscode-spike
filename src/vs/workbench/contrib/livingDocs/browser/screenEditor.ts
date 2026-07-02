/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { IAgentRun, summariseProjectRun } from '../common/livingDocsModel.js';
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
import { AgentFilter, IProjectRunScreenState, IRecentProject, renderScreenHtml, ScreenId } from './screenRender.js';

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
	// Project-run (C4): the live/last whole-project fan-out state, or undefined for the truthful idle
	// state. The run-kick sets this (23.3); the swarm summary + live working overlay are recomputed at
	// render time from the service (`summariseProjectRun` + `isChatBusy`) so tiles update as the run runs.
	projectRun?: IProjectRunScreenState;
	// The document the whole-project chat is anchored on (the working set + chat key). Held so each
	// re-render can read the live `isChatBusy(anchor)` and the pending set to refresh the swarm.
	projectRunAnchor?: URI;
	// The project's documents at run-kick time (id + title), used to build every swarm tile so a doc the
	// run did not touch still renders as a `no change` tile. Fetched once when the run is kicked.
	projectRunDocs?: readonly { readonly docId: string; readonly docTitle: string }[];
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
			// Agents entry point (D23-B): "Run across the project" opens the project-run screen live.
			// The whole-project chat fan-out that populates the swarm is kicked in 23.3 (TODO below);
			// opening the screen from Agents works live now, landing on the truthful idle state.
			case 'runProject':
				void this._openProjectRun();
				break;
			// Project-run screen idle-state affordance: jump to the Agents screen (the run entry point).
			case 'goAgents':
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'agents'), { pinned: true });
				break;
			// Project-run bottom bar: "Review across the project" routes to the Review rail as the
			// interim target. TODO(plan-24): retarget to the cross-document review surface once it lands.
			case 'reviewProject':
				this._livingDocs.focusPanel('review');
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

	// D23-B entry point: open the project-run screen (C4) via the SAME open-screen path every other
	// Abstract screen uses (a singleton ScreenEditorInput opened through the editor service). Iter 2
	// lands on the truthful idle state; the whole-project chat fan-out that fills the swarm is 23.3.
	private async _openProjectRun(instruction?: string, source?: string): Promise<void> {
		// Open the screen first (idle) so the user lands immediately, then kick the run and let the
		// onDidChange listener re-render the live swarm as the fan-out proceeds and settles.
		await this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'project-run'), { pinned: true });
		await this._kickProjectRun(instruction, source);
	}

	// Kick the whole-project chat fan-out (D23-A/#77): the whole-project run IS the chat working-set path.
	// Pick an anchor document, load it (sendChatMessage requires a loaded anchor state), add every folder
	// document to that anchor's working set, then send ONE instruction so `_chatRespondMulti` fans it out
	// across the project in a single model call. The run is in flight while `isChatBusy(anchor)` is true;
	// the finally block of `sendChatMessage` fires onDidChange, which re-renders and settles the swarm.
	private async _kickProjectRun(instruction?: string, source?: string): Promise<void> {
		const docs = await this._livingDocs.listDocuments();
		if (docs.length === 0) { return; }
		const runInstruction = instruction ?? 'Extract the decisions from the 3 March security review and apply the required changes across every affected policy.';
		// The anchor is any project document (the chat key + working-set owner); the first one is fine. Load
		// it first so its folder files are scanned - `getMentionableFiles` needs the loaded state (so the
		// transcript source is resolvable) and `sendChatMessage` requires a loaded anchor to fan out.
		const anchor = docs[0].resource;
		await this._livingDocs.loadDocument(anchor);
		await this._livingDocs.addFolderToWorkingSet(anchor);
		// Default to the real security-review transcript source when the caller named none (the Agents
		// "Run across the project" action passes none today). Resolved against the loaded anchor's
		// mentionable folder files - never fabricated: undefined when the project ships no such source.
		const mentionable = new Set(this._livingDocs.getMentionableFiles(anchor));
		const runSource = source ?? [...mentionable].find(f => /review/i.test(f) && /\.txt$/i.test(f));
		// Reference the transcript by @mention so the fan-out reads it as a shared source (only when the
		// source is a real mentionable folder file - never invent a mention the model cannot resolve).
		const sent = runSource && mentionable.has(runSource) ? `${runInstruction} @${runSource}` : runInstruction;
		this._state = {
			...this._state,
			projectRunAnchor: anchor,
			projectRunDocs: docs.map(d => ({ docId: d.resource.toString(), docTitle: d.title })),
			projectRun: { instruction: runInstruction, source: runSource, inFlight: true },
		};
		this._render();
		// Fire-and-await the fan-out; the finally block flips isChatBusy off and fires onDidChange -> re-render.
		await this._livingDocs.sendChatMessage(anchor, sent);
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
		this._webview?.setHtml(renderScreenHtml(this._screen, {
			...this._state,
			projectRun: this._projectRunState(),
			agents: this._livingDocs.getAgents(),
			hasFolder: !!folderName,
			folderName,
		}));
	}

	// Recompute the project-run screen state from the LIVE service each render, so the swarm grid, the
	// progress bar and the bottom-bar totals track the fan-out as it runs and settles. The tiles + totals
	// come from the pure `summariseProjectRun(projectDocs, getAllPending())` selector; the `working`
	// overlay is every project document while `isChatBusy(anchor)` is true (the whole-project fan-out is a
	// single model call, so the whole swarm is in flight together), and empty once the run settles.
	private _projectRunState(): IProjectRunScreenState | undefined {
		const run = this._state.projectRun;
		if (!run) { return undefined; }
		const anchor = this._state.projectRunAnchor;
		const inFlight = !!anchor && this._livingDocs.isChatBusy(anchor);
		const docs = this._state.projectRunDocs ?? [];
		const summary = summariseProjectRun(docs, this._livingDocs.getAllPending());
		const working = inFlight ? docs.map(d => d.docId) : [];
		return { ...run, inFlight, summary, working };
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
