/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator, toAction } from '../../../../base/common/actions.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILivingDocsService, ILivingDocSummary } from '../common/livingDocs.js';

// THE document context menu (spec 43 pin 6 / P6.1), in ONE place. Two surfaces raise it: a right-click on a
// Files-rail document row (`treeRailView.ts`) and a right-click on a product tab (`abstractTabStrip.ts`, plan 52
// WP-F). Both call `createDocumentMenuActions` with the resource they were raised on, so the tab menu operates on
// the RIGHT-CLICKED tab's document rather than the active one, and the two menus can never drift apart. Every
// item routes to an EXISTING flow or an additive service method - nothing here re-implements a file operation.
//
// The two rail-local items (Rename, which is an edit-in-place on the tree row, and Bind Sources, which reveals the
// Context tab's picker) route through the additive service request seams `requestRenameDocument` /
// `requestBindSources`. Those follow the fork's established "ask the surface that owns the UI" pattern - the same
// shape as `requestPresent` / `onDidRequestPresent` - so the tab strip needs no reference to the rail.

/** The menu class the restyled native context menu is skinned against (`getMenuClassName`). */
export const DOCUMENT_MENU_CLASS_NAME = 'livingDocs-doc-menu';

/** The services the document menu's actions need. Constructor-injected by each caller and passed in whole. */
export interface IDocumentMenuServices {
	readonly editorService: IEditorService;
	readonly livingDocs: ILivingDocsService;
	readonly dialogService: IDialogService;
	readonly quickInputService: IQuickInputService;
}

/**
 * The full right-click menu on a document (pin 6 / P6.1): four groups in order - Open / Open to the right ·
 * Rename… / Duplicate / Move to… · Bind sources… / View history / Present · Delete.
 *
 * `includeOpen` drops the leading "Open" entry for the tab-strip caller, where the document is open by
 * definition. Delete stays the LAST entry in every variant, because the injected skin paints the menu's last
 * action-item row removed-ink (see `createDocumentMenuStyle`).
 */
export function createDocumentMenuActions(services: IDocumentMenuServices, resource: URI, label: string, options?: { readonly includeOpen?: boolean }): IAction[] {
	const actions: IAction[] = [];
	if (options?.includeOpen !== false) {
		actions.push(toAction({ id: 'livingDocs.file.open', label: localize('livingDocs.menu.open', "Open"), run: () => void services.editorService.openEditor({ resource, options: { pinned: true } }) }));
	}
	actions.push(
		toAction({ id: 'livingDocs.file.openRight', label: localize('livingDocs.menu.openRight', "Open to the Right"), run: () => void services.livingDocs.openToTheRight(resource) }),
		new Separator(),
		toAction({ id: 'livingDocs.file.rename', label: localize('livingDocs.menu.rename', "Rename…"), run: () => void services.livingDocs.requestRenameDocument(resource) }),
		toAction({ id: 'livingDocs.file.duplicate', label: localize('livingDocs.menu.duplicate', "Duplicate"), run: () => void services.livingDocs.duplicateFile(resource) }),
		toAction({ id: 'livingDocs.file.move', label: localize('livingDocs.menu.move', "Move to…"), run: () => void moveDocument(services, resource, label) }),
		new Separator(),
		toAction({ id: 'livingDocs.file.bind', label: localize('livingDocs.menu.bind', "Bind Sources…"), run: () => void services.livingDocs.requestBindSources(resource) }),
		toAction({ id: 'livingDocs.file.history', label: localize('livingDocs.menu.history', "View History"), run: () => void viewHistory(services, resource) }),
		toAction({ id: 'livingDocs.file.present', label: localize('livingDocs.menu.present', "Present"), run: () => void services.livingDocs.requestPresent(resource) }),
		new Separator(),
		// Delete is the LAST entry (P6.6): the injected stylesheet paints the menu's last action-item row
		// removed-ink `#B5514B` with a `#FBEEEE` hover. It routes to the confirming, dependents-warning service delete.
		toAction({ id: 'livingDocs.file.delete', label: localize('livingDocs.menu.delete', "Delete…"), run: () => void deleteDocument(services, resource, label) }),
	);
	return actions;
}

/**
 * A source / non-document row keeps the lighter provenance-safe menu (it has no living-doc affordances):
 * rename, Add to Chat, delete. Delete stays the LAST entry so the removed-ink skin lands.
 */
export function createSourceMenuActions(services: IDocumentMenuServices, resource: URI, label: string): IAction[] {
	return [
		toAction({ id: 'livingDocs.file.rename', label: localize('livingDocs.menu.rename', "Rename…"), run: () => void services.livingDocs.requestRenameDocument(resource) }),
		toAction({ id: 'livingDocs.file.addToChat', label: localize('livingDocs.menu.addToChat', "Add to Chat"), run: () => services.livingDocs.attachToChat(resource) }),
		new Separator(),
		toAction({ id: 'livingDocs.file.delete', label: localize('livingDocs.menu.delete', "Delete…"), run: () => void deleteDocument(services, resource, label) }),
	];
}

// "View history" (P6.5): open the document, then reveal the right rail's History tab (the existing flow).
async function viewHistory(services: IDocumentMenuServices, resource: URI): Promise<void> {
	await services.editorService.openEditor({ resource, options: { pinned: true } });
	services.livingDocs.focusPanel('history');
}

// "Move to…" (P6.4): pick a destination folder, then move the document + its sidecar and re-point dependents
// through the additive service `moveFile`. The picker offers the project's folders (existing + convention),
// so the user chooses a real destination without hand-typing a path.
async function moveDocument(services: IDocumentMenuServices, resource: URI, label: string): Promise<void> {
	const targets = await moveTargets(services, resource);
	if (!targets.length) {
		await services.dialogService.info(localize('livingDocs.move.noFolders', "No other folders"), localize('livingDocs.move.noFoldersDetail', "There is nowhere to move \"{0}\" to yet. Create a folder first.", label));
		return;
	}
	const pick = await services.quickInputService.pick(
		targets.map(t => ({ label: t.label, folder: t.folder })),
		{ placeHolder: localize('livingDocs.move.pick', "Move \"{0}\" to which folder?", label) },
	);
	if (!pick) { return; } // cancelled
	await services.livingDocs.moveFile(resource, pick.folder);
}

// The destination folders offered by "Move to…": the project's existing subfolders (from the discovered doc
// set) plus the soft convention folders, minus the file's own current folder. Each carries its target URI.
// The project root is derived from the discovered documents (a doc's dir minus its relative `folder`), so no
// new service seam is needed - the summaries already carry every doc's resource and its folder-relative path.
async function moveTargets(services: IDocumentMenuServices, resource: URI): Promise<readonly { label: string; folder: URI }[]> {
	const documents = await services.livingDocs.listDocuments();
	const root = deriveProjectRoot(documents);
	if (!root) { return []; }
	const currentDir = dirname(resource).toString();
	const rels = new Set<string>(['', 'data', 'assets', 'templates', 'archive', 'working-files']);
	for (const d of documents) {
		if (d.folder) { rels.add(d.folder); }
	}
	const out: { label: string; folder: URI }[] = [];
	for (const rel of [...rels].sort((a, b) => a.localeCompare(b))) {
		const folder = rel ? joinPath(root, ...rel.split('/')) : root;
		if (folder.toString() === currentDir) { continue; } // never offer the file's own folder
		out.push({ label: rel ? rel : localize('livingDocs.move.projectRoot', "Project root"), folder });
	}
	return out;
}

// Derive the project root from the discovered documents without a new service seam: a document's directory
// minus its `folder`-relative segments is the workspace root. Any document resolves it (they all share one
// root); a root-level document's directory IS the root. Undefined when no document is discovered.
function deriveProjectRoot(documents: readonly ILivingDocSummary[]): URI | undefined {
	for (const d of documents) {
		let dir = dirname(d.resource);
		const segments = (d.folder ?? '').split('/').filter(s => s.length > 0);
		for (let i = 0; i < segments.length; i++) { dir = dirname(dir); }
		return dir;
	}
	return undefined;
}

// map-D6: delete warns and LISTS the dependent documents; on proceed the service orphans them
// gracefully (their cached values survive, flagged stale) and offers Undo - the delete never blocks.
//
// Every user-visible string here goes through `localize` with `{0}` placeholders, never concatenation. The
// singular and plural dependent counts are SEPARATE keys rather than an inlined `document${n === 1 ? '' : 's'}`:
// `localize` has no plural form, and pluralising by string surgery cannot be translated (many languages have
// more than two forms, and several put the count elsewhere in the sentence). The dependents' titles are the one
// thing still joined in code - that is a DATA list, not a sentence, so it is built here and handed to the
// translated sentence as a placeholder.
async function deleteDocument(services: IDocumentMenuServices, resource: URI, label: string): Promise<void> {
	const dependents = await services.livingDocs.getFileDependents(resource);
	const message = dependents.length === 0
		? localize('livingDocs.delete.message', "Delete \"{0}\"?", label)
		: dependents.length === 1
			? localize('livingDocs.delete.messageOne', "Delete \"{0}\"? 1 document depends on it.", label)
			: localize('livingDocs.delete.messageMany', "Delete \"{0}\"? {1} documents depend on it.", label, dependents.length);
	const undoNote = localize('livingDocs.delete.undo', "You can undo this.");
	const detail = dependents.length === 0
		? undoNote
		: localize(
			'livingDocs.delete.detail',
			"These documents will keep their last cached values, flagged as stale (not broken):\n{0}\n\n{1}",
			dependents.map(d => `• ${d.title}`).join('\n'),
			undoNote,
		);
	const { confirmed } = await services.dialogService.confirm({
		type: 'warning',
		message,
		detail,
		primaryButton: localize('livingDocs.delete.confirmButton', "Delete"),
	});
	if (!confirmed) { return; }
	await services.livingDocs.deleteFile(resource);
}

/**
 * The restyled native context menu's stylesheet (P6.7 / P6.1 / P6.6): a document-scoped sheet keyed to this
 * loop's menu class (`getMenuClassName` -> the `.monaco-menu-container.livingDocs-doc-menu` overlay, which renders
 * OUTSIDE the raising view's DOM subtree, so a view-scoped sheet cannot reach it). This restyles the EXISTING
 * native menu - no parallel menu implementation - to the mock's 208px popover / radius 12 / 30px rows / hairline
 * dividers / popover shadow, and paints the Delete row `#B5514B` with a `#FBEEEE` hover. Scoped to our menu class
 * so no other menu is affected; `studio.css` is untouched.
 *
 * Returned rather than injected so each owner appends it to its own `ownerDocument.head` and disposes its own
 * copy - the same shape as `createTabStripStyle()`. Two owners mounting identical sheets is harmless, and it
 * means one owner's disposal can never strip the other's menu skin.
 */
export function createDocumentMenuStyle(): HTMLStyleElement {
	const style = document.createElement('style');
	const SCOPE = `.monaco-menu-container.${DOCUMENT_MENU_CLASS_NAME}`;
	style.textContent = `
	/* radius pinned !important to beat roundedCorners.css's cornerRadius-large tier on the menu surfaces. */
	${SCOPE}{border-radius:12px !important;box-shadow:0 12px 32px -8px rgba(20,22,28,.24),0 0 0 1px #E9EAEE;overflow:hidden}
	${SCOPE} .monaco-menu{border-radius:12px !important;background:#FBFCFD;overflow:hidden}
	${SCOPE} .monaco-menu .monaco-action-bar.vertical{padding:6px;width:208px;box-sizing:border-box;border-radius:12px !important}
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-item{margin:0}
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-menu-item{height:30px;border-radius:8px;padding:0 10px}
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-label{font:400 13px/30px system-ui;color:#26292F}
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-item.focused .action-menu-item,
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-menu-item:hover{background:#F1F2F6}
	/* Hairline dividers between the groups (a separator row is a thin rule, not a tall gap). */
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-item.disabled.action-label.separator,
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-label.separator{margin:5px 8px;padding:0;border-bottom:1px solid #EEF0F3}
	/* Delete (P6.6): removed-ink #B5514B, hover bg #FBEEEE. The native context menu only applies an action's
	 * class to icon items, so the Delete row is targeted structurally instead - it is always the last
	 * action-item in this menu (see createDocumentMenuActions / createSourceMenuActions, where Delete is final). */
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-item:last-child .action-label{color:#B5514B}
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-item:last-child.focused .action-menu-item,
	${SCOPE} .monaco-menu .monaco-action-bar.vertical .action-item:last-child .action-menu-item:hover{background:#FBEEEE}
	`;
	return style;
}
