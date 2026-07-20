/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

// The cold-start routing decision (plan 42 slice L1: editor-first cold start). This is the PURE core of the
// decision the StudioStartupContribution executes when the app opens with no editors restored: the app must
// land in the editor with a document open and focused, never on the Welcome walkthrough. Keeping it here (no
// DOM, no service, no wall clock) means the routing contract is unit-tested directly, without driving the
// workbench.

/** The surface the cold start lands on when no editor was restored. */
export const enum StartupRouteKind {
	/** Open an existing document (the most-recently-opened one, else the first document in the folder). */
	OpenDocument = 'openDocument',
	/** No document to open: create a new, blank untitled Markdown document so the cursor lands in editable text. */
	NewUntitledDocument = 'newUntitledDocument',
}

/** An existing document to open (its on-disk resource). */
export interface IOpenDocumentRoute {
	readonly kind: StartupRouteKind.OpenDocument;
	readonly resource: URI;
}

/**
 * A new untitled Markdown document. `hasFolder` distinguishes the two entry cases the slice calls out: with a
 * folder open (but no document yet) the untitled doc is the editable starting point; with no folder the untitled
 * doc is the blank surface that also carries the "Open a folder" affordance (never a wizard/walkthrough).
 */
export interface INewUntitledRoute {
	readonly kind: StartupRouteKind.NewUntitledDocument;
	readonly hasFolder: boolean;
}

export type StartupRoute = IOpenDocumentRoute | INewUntitledRoute;

/**
 * The facts the cold-start routing reads. All are cheap reads the contribution gathers from workbench services:
 * whether a folder is open, the most-recently-opened on-disk file (from the editor history, or undefined), and
 * every Markdown document discovered in the folder (stable-sorted, so "the first document" is deterministic).
 */
export interface IStartupRoutingContext {
	/** True when a folder or multi-root workspace is open (WorkbenchState.FOLDER or .WORKSPACE). */
	readonly hasFolder: boolean;
	/** The most-recently-opened on-disk file from the editor history, or undefined when there is none. */
	readonly lastActiveFile: URI | undefined;
	/** Every Markdown document in the open folder, stable-sorted by title (empty when no folder / no docs). */
	readonly folderDocuments: readonly URI[];
}

/**
 * Decide where a cold start with no restored editors should land (plan 42 slice L1). Precedence, per the slice
 * text: the most-recently-opened document (only if it is one of the folder's Markdown documents), else the first
 * document in the folder, else a new untitled Markdown document with the cursor placed. The walkthrough is never
 * a cold-start destination -- it is a dismissible entry point reachable from Home and first-run instead.
 */
export function decideStartupRoute(context: IStartupRoutingContext): StartupRoute {
	if (context.hasFolder) {
		// Most-recently-opened document: honour it only when it is still one of the folder's discovered Markdown
		// documents, so a stale history entry (a file since deleted, or one outside the folder) never wins.
		if (context.lastActiveFile) {
			const last = context.lastActiveFile.toString();
			const match = context.folderDocuments.find(uri => uri.toString() === last);
			if (match) {
				return { kind: StartupRouteKind.OpenDocument, resource: match };
			}
		}
		// Else the first document in the folder (the list is stable-sorted, so "first" is deterministic).
		if (context.folderDocuments.length > 0) {
			return { kind: StartupRouteKind.OpenDocument, resource: context.folderDocuments[0] };
		}
	}
	// No folder, or a folder with no documents: a new untitled Markdown doc so the cursor lands in editable text.
	return { kind: StartupRouteKind.NewUntitledDocument, hasFolder: context.hasFolder };
}
