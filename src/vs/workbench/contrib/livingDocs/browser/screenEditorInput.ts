/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ScreenId } from './screenRender.js';

export const SCREEN_EDITOR_ID = 'workbench.editor.livingDocs.screen';

const TITLES: Record<ScreenId, string> = {
	home: 'Home',
	templates: 'Templates',
	knowledge: 'Knowledge',
	agents: 'Agents',
	'project-run': 'Agent Run',
	'review-project': 'Review Project',
	settings: 'Model Access',
	onboarding: localize('livingDocs.screen.onboarding', "Welcome"),
};

// One singleton editor input per Abstract screen (Templates / Knowledge / Agents). The screen
// id is carried in a synthetic resource so the editor service treats each screen as its own editor.
export class ScreenEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.livingDocs.screen';

	private readonly _resource: URI;

	constructor(readonly screen: ScreenId) {
		super();
		this._resource = URI.from({ scheme: 'opportunity-os-screen', path: `/${screen}` });
	}

	override get typeId(): string { return ScreenEditorInput.ID; }
	override get editorId(): string | undefined { return SCREEN_EDITOR_ID; }
	override get resource(): URI { return this._resource; }

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return TITLES[this.screen];
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof ScreenEditorInput && other.screen === this.screen;
	}
}

/**
 * Open a full-width Abstract screen (Home / Templates / ...) as a pinned singleton editor. Because
 * {@link ScreenEditorInput} is a singleton, the editor service may adopt an existing instance for the same screen
 * rather than the one created here; the freshly created input is disposed in that case so it does not leak. Shared
 * by every landing that routes to a screen - the cold-start landing (`StudioStartupContribution`) and the runtime
 * empty-editor landing (`EmptyEditorLandingContribution`) - so the open-and-dispose contract lives in one place.
 */
export async function openScreenEditor(editorService: IEditorService, instantiationService: IInstantiationService, screen: ScreenId): Promise<void> {
	const input = instantiationService.createInstance(ScreenEditorInput, screen);
	const pane = await editorService.openEditor(input, { pinned: true });
	if (pane?.input !== input) {
		input.dispose();
	}
}
