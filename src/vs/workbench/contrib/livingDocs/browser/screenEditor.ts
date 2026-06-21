/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IAgentRun } from '../common/livingDocsModel.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
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
import { AgentFilter, renderScreenHtml, ScreenId } from './screenRender.js';

// The editor's interactive state; the live agent registry is injected at render time.
interface IScreenEditorState {
	knScope: 'org' | 'project';
	openAgentId?: string;
	filter: AgentFilter;
	lastRun?: IAgentRun;
}

// Webview editor that hosts one Opportunity OS screen (Templates / Knowledge / Agents) in the
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
		this._inputDisposables.clear();
		// Re-render when agent status / the registry changes (e.g. a run completes or a trigger fires).
		this._inputDisposables.add(this._livingDocs.onDidChange(() => this._render()));
		this._mountWebview();
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
			title: 'Opportunity OS',
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
		// Inject the live agent registry at render time so the Agents view always reflects current state.
		this._webview?.setHtml(renderScreenHtml(this._screen, { ...this._state, agents: this._livingDocs.getAgents() }));
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
