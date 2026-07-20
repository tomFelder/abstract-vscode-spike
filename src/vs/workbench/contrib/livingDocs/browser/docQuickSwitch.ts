/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { ILivingDocsService } from '../common/livingDocs.js';

// The Cmd/Ctrl+P document switcher (issue #212): a Files-first quick pick of every document in the open folder,
// ranked most-recently-used first. The core patch stripped Cmd+P from `workbench.action.quickOpen` (Seam 4) and
// the calm-shell chord neutralisation does not claim it, so this is a free chord a livingDocs-owned keybinding
// rule can bind with NO core patch. This module holds the pure-ish handler (it only reaches services through the
// accessor, mirroring `openEditorNavTarget`) so the contribution's keybinding registration stays a thin wiring line.

interface IDocPickItem extends IQuickPickItem {
	readonly resource: URI;
}

/**
 * Open the document switcher and, on a pick, open the chosen document (issue #212). Documents are ranked
 * MRU-first by walking `IHistoryService.getHistory()` (the same recency signal the Editor nav launcher uses),
 * then the remaining documents alphabetically, so the most likely target sits at the top and Enter opens it.
 * Opening routes through `IEditorService.openEditor` (never editorGroups) so revealIfOpened and the editor
 * resolver's Living Document mapping both apply.
 */
export async function openDocQuickSwitch(accessor: ServicesAccessor): Promise<void> {
	const quickInput = accessor.get(IQuickInputService);
	const history = accessor.get(IHistoryService);
	const editors = accessor.get(IEditorService);
	const livingDocs = accessor.get(ILivingDocsService);

	const docs = await livingDocs.listDocuments();
	if (!docs.length) { return; }

	// MRU ranking: history order first (most-recent editor activations), then the rest alphabetically. A doc's
	// recency rank is its first position in the history walk; docs never in history sort after all ranked ones.
	const rankByResource = new Map<string, number>();
	let rank = 0;
	for (const entry of history.getHistory()) {
		const resource = entry.resource;
		if (!resource) { continue; }
		const key = resource.toString();
		if (!rankByResource.has(key) && docs.some(d => isEqual(d.resource, resource))) {
			rankByResource.set(key, rank++);
		}
	}
	const ordered = [...docs].sort((a, b) => {
		const ra = rankByResource.has(a.resource.toString()) ? rankByResource.get(a.resource.toString())! : Number.MAX_SAFE_INTEGER;
		const rb = rankByResource.has(b.resource.toString()) ? rankByResource.get(b.resource.toString())! : Number.MAX_SAFE_INTEGER;
		return ra !== rb ? ra - rb : a.title.localeCompare(b.title);
	});

	const items: IDocPickItem[] = ordered.map(d => ({
		label: d.title,
		// The folder path (when nested) as the muted description, so two same-titled docs in different folders read apart.
		description: d.folder || undefined,
		resource: d.resource,
	}));

	const picked = await quickInput.pick(items, {
		placeHolder: localize("livingDocs.quickSwitch.placeholder", "Go to document"),
		matchOnDescription: true,
	});
	if (!picked) { return; }
	await editors.openEditor({ resource: picked.resource, options: { pinned: true, revealIfOpened: true } });
}
