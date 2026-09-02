/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { openScreenEditor } from './screenEditorInput.js';

/**
 * Land the writer on Project Home whenever the editor area runs empty at runtime (issue #299 / ticket #388). This
 * is the empty-state branch for a tab close: closing the last open tab - by the product tab strip's ×, a
 * middle-click, Cmd+W, or "Close All" - leaves the editor group with no input, and this fork's editor part has no
 * styled empty-editor watermark, so the group fell through to a bare blank pane (the report's "featureless white
 * rectangle") with no visible way back.
 *
 * It is the RUNTIME twin of {@link StudioStartupContribution}'s cold-start branch (`editors.length === 0` -> open
 * Home): where that handles "no editor was restored on launch", this handles "the last editor was just closed".
 * Routing both to Project Home means the editor area is never a dead end - the writer always lands on a defined
 * surface (the project's front door, with the left nav, recents, and New-document actions one click away). Placing
 * it here, watching the assembled editor service, catches EVERY close path rather than only the tab strip's own
 * gestures, so the same blank pane cannot return through Cmd+W or the command palette.
 */
export class EmptyEditorLandingContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livingDocs.emptyEditorLanding';

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		// React to transitions to empty (a close), never the initial state: at cold start StudioStartupContribution
		// owns the empty-on-launch case, and onDidActiveEditorChange does not fire for the initial state, so the two
		// never double-open Home.
		this._register(this._editorService.onDidActiveEditorChange(() => this._onActiveEditorChange()));
	}

	private _onActiveEditorChange(): void {
		// A window close / reload tears every editor down on its way out. Never re-open Home then: a late open could
		// be serialised into the restored working set and resurrect Home next launch over the document the writer had
		// open. Once shutdown begins, this branch is inert.
		if (this._lifecycleService.willShutdown) {
			return;
		}
		if (this._editorService.editors.length !== 0) {
			return;
		}
		void this._landOnHome();
	}

	private async _landOnHome(): Promise<void> {
		// Re-check across the await: a deep-link or a fresh open may have arrived, or shutdown may have begun, while
		// we were scheduling.
		if (this._lifecycleService.willShutdown || this._editorService.editors.length !== 0) {
			return;
		}
		await openScreenEditor(this._editorService, this._instantiationService, 'home');
	}
}
