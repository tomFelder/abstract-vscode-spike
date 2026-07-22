/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInputCapabilities, IEditorSerializer, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export const LIVING_DOC_SOURCE_EDITOR_ID = 'workbench.editor.livingDocSource';

/**
 * A lightweight source-viewer editor input (spec 43 section 3.2, plan 45 pin 7 / P7.4). Opening a source from
 * the tree SOURCES rows (or, plan 49, the Knowledge table) opens this input as a product tab on the SAME strip
 * as the document - a grid-glyph source tab showing the source grid. It is a sibling of `LivingDocEditorInput` in the
 * same pane family, so both render their own product-tab strip from the shared group model; the source input
 * never opens a second editor group. Readonly + singleton so the same source never opens twice in a group.
 */
export class LivingDocSourceInput extends EditorInput {

	static readonly ID = 'workbench.input.livingDocSource';

	constructor(private readonly _resource: URI) {
		super();
	}

	override get typeId(): string { return LivingDocSourceInput.ID; }
	override get editorId(): string | undefined { return LIVING_DOC_SOURCE_EDITOR_ID; }
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
		return other instanceof LivingDocSourceInput && isEqual(other.resource, this._resource);
	}
}

/**
 * Serialises a source-viewer tab so it restores on reload (plan 45 pin 7 / P7.7). A source tab is a typed
 * input with no editor-resolver (unlike documents, restored by their `*.md` resource), so without this the
 * workbench would drop source tabs across a window reload. Only the resource is stored; the grid/text are
 * re-read live from disk on deserialize (`readSourceViewer`), so a re-synced source never restores stale data.
 */
export class LivingDocSourceInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(editor: LivingDocSourceInput): string {
		return JSON.stringify({ resource: editor.resource.toString() });
	}

	deserialize(_instantiationService: IInstantiationService, serialized: string): LivingDocSourceInput | undefined {
		try {
			const { resource } = JSON.parse(serialized) as { resource: string };
			return typeof resource === 'string' ? new LivingDocSourceInput(URI.parse(resource)) : undefined;
		} catch {
			return undefined;
		}
	}
}
