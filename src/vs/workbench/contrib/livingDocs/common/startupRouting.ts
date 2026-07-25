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
// populated) lands on Project Home.
//
// WP-I (issue #260, leak 5 - the shell de-IDE floor): the NO-FOLDER case now ALSO lands on Project Home, not a
// bare untitled document. A new window / Cmd+Shift+N opens with no folder, and the old blank-untitled route
// produced the bare broken editor the audit flagged (a lone line-number "1", an empty "Abstract /" breadcrumb,
// no tree/tabs), which a writer could only recover from by finding Home -> "Open a folder". Home already renders
// the no-folder front door ("Open a folder to start working." with an "Open a Folder" button - screenRenderHome.ts),
// so routing the no-folder cold start to Home turns that dead-end into the intended front door. There is no longer
// a cold-start route that lands on a blank untitled document.

/** The surface the cold start lands on when no editor was restored. */
export const enum StartupRouteKind {
	/**
	 * Open Project Home: the cold-start landing surface. With a folder (map-D2) it is the project's front door
	 * (what ran, what's stale, recent files); with no folder (WP-I / issue #260 leak 5) it is Home's no-folder
	 * front door ("Open a folder to start working."). Either way the writer lands on a real surface, never on a
	 * bare untitled editor.
	 */
	OpenHome = 'openHome',
}

/** Open Project Home - the cold-start landing surface, folder or not (map-D2 + WP-I). */
export interface IOpenHomeRoute {
	readonly kind: StartupRouteKind.OpenHome;
	/** True when a folder / multi-root workspace is open. Home renders its front door differently for each. */
	readonly hasFolder: boolean;
}

export type StartupRoute = IOpenHomeRoute;

/**
 * The facts the cold-start routing reads. Just whether a folder (a project) is open - the landing decision no
 * longer depends on the document set, because the cold start always lands on Project Home and Home itself
 * decides what to render: the no-folder front door, the empty-project front door, or the populated dashboard.
 */
export interface IStartupRoutingContext {
	/** True when a folder or multi-root workspace is open (WorkbenchState.FOLDER or .WORKSPACE). */
	readonly hasFolder: boolean;
}

/**
 * Decide where a cold start with no restored editors should land (map-D2, WP-H, WP-I). It always lands on Project
 * Home: with a folder, Home renders the empty-project front door or the populated dashboard from the live document
 * set; with no folder (a new window / Cmd+Shift+N), Home renders its "Open a folder to start working." front door
 * instead of the old bare untitled editor (issue #260 leak 5). The walkthrough is never a cold-start destination --
 * it is a dismissible entry point reachable from Home and first-run instead.
 */
export function decideStartupRoute(context: IStartupRoutingContext): StartupRoute {
	return { kind: StartupRouteKind.OpenHome, hasFolder: context.hasFolder };
}
