/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export const LIVING_DOC_EDITOR_ID = 'workbench.editor.livingDoc';

export class LivingDocEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.livingDoc';

	constructor(private readonly _resource: URI) {
		super();
	}

	override get typeId(): string { return LivingDocEditorInput.ID; }
	override get editorId(): string | undefined { return LIVING_DOC_EDITOR_ID; }
	override get resource(): URI { return this._resource; }

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return basename(this._resource);
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof LivingDocEditorInput && isEqual(other.resource, this._resource);
	}
}
