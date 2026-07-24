/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The cold-start routing decision (plan 42 slice L1, revised by WP-H / map-D2). This is the PURE core of the
// decision the StudioStartupContribution executes when the app opens with no editors restored. Keeping it here
// (no DOM, no service, no wall clock) means the routing contract is unit-tested directly, without driving the
// workbench.
//
// WP-H (issue #261, map-D2): opening a PROJECT lands on Project Home, not the editor. This reconciles two
// ratified decisions that appeared to conflict. Plan 42 L1 made cold start land in the editor, but its actual
// target was killing the Welcome WALKTHROUGH gate - not rejecting Project Home. map-D2 (docs 13 sec C2 "D2/D3
// win"; doc 20 acceptance criteria) says a project opens on Project Home (what ran, what's stale, recent
// files); the editor is one click deeper via a file. The built Project Home already carries the demoted
// walkthrough as a dismissible "See a 90-second demo" banner, so landing there is no longer landing on a
// wizard - L1's real wins (no walkthrough gate, editor never forced) survive. So: a folder open (empty OR
// populated) lands on Project Home; only the no-folder case (no project to show a home for) keeps L1's blank
// untitled document as the editable starting point.

/** The surface the cold start lands on when no editor was restored. */
export const enum StartupRouteKind {
	/** Open Project Home (map-D2): a folder is open, so the project's front door is the landing surface. */
	OpenHome = 'openHome',
	/** No document to open: create a new, blank untitled Markdown document so the cursor lands in editable text. */
	NewUntitledDocument = 'newUntitledDocument',
}

/** Open Project Home - the landing surface when a folder (a project) is open (map-D2). */
export interface IOpenHomeRoute {
	readonly kind: StartupRouteKind.OpenHome;
}

/**
 * A new untitled Markdown document. Reached only when NO folder is open: the untitled doc is the blank surface
 * that also carries the "Open a folder" affordance (never a wizard/walkthrough). `hasFolder` is retained (always
 * false on this route now) so callers keep a stable shape.
 */
export interface INewUntitledRoute {
	readonly kind: StartupRouteKind.NewUntitledDocument;
	readonly hasFolder: boolean;
}

export type StartupRoute = IOpenHomeRoute | INewUntitledRoute;

/**
 * The facts the cold-start routing reads. Just whether a folder (a project) is open - the landing decision no
 * longer depends on the document set, because a project always lands on Project Home (map-D2) and Home itself
 * decides between the empty-project front door and the populated dashboard from the live document set.
 */
export interface IStartupRoutingContext {
	/** True when a folder or multi-root workspace is open (WorkbenchState.FOLDER or .WORKSPACE). */
	readonly hasFolder: boolean;
}

/**
 * Decide where a cold start with no restored editors should land (map-D2, WP-H). A folder open (a project)
 * lands on Project Home - empty OR populated; Home renders the empty-project front door or the populated
 * dashboard from the live document set. No folder open: a blank untitled Markdown doc (nothing to show a
 * project home for). The walkthrough is never a cold-start destination -- it is a dismissible entry point
 * reachable from Home and first-run instead.
 */
export function decideStartupRoute(context: IStartupRoutingContext): StartupRoute {
	if (context.hasFolder) {
		return { kind: StartupRouteKind.OpenHome };
	}
	// No folder: a new untitled Markdown doc so the cursor lands in editable text, with the "Open a folder"
	// affordance one click away on the Home nav item and the tree rail.
	return { kind: StartupRouteKind.NewUntitledDocument, hasFolder: false };
}
