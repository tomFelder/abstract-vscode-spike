/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The document editor's mount-once-then-message webview lifecycle, as a PURE reducer (plan 30, track 4,
// the P2-3 debt). `livingDocEditor.ts` hosts one ProseMirror webview whose shell (chrome + the 496 KB PM
// bundle) is set ONCE via setHtml; every later render pushes just the content over postMessage so the live
// editing surface is never torn down (decision 50). That lifecycle is exactly the timing-sensitive code
// that regressed silently with no coverage: a render that arrives before the webview RUNTIME signals ready
// must be HELD and flushed on ready; a model-driven body change must reset the PM doc (pmReset) while the
// user's own typing must NOT; a rail-to-editor focus request must wait until the body (with its inline-diff
// decorations) is live before it scrolls.
//
// This reducer models that state machine with no DOM, no webview and no service, so it is unit-tested
// directly. The editor becomes a thin shell: it holds an `IEditorWebviewState`, feeds each event through
// the matching `apply*` function, and CARRIES OUT the returned effects (setHtml / postMessage / hold).

/** The content one render produces for the webview: the chrome HTML plus the optional PM body + decorations. */
export interface IEditorRenderContent {
	readonly html: string;
	/** The document body as Markdown for the ProseMirror surface, or null when this render carries no PM body. */
	readonly pmMd: string | null;
	readonly pmDeco: unknown;
}

/**
 * The mount-once lifecycle state the editor carries across renders. `initialized` flips on the first render
 * (the shell was set via setHtml); `ready` flips when the webview RUNTIME signals it is listening; `pmBody`
 * is the body the live surface currently holds (so the next render can tell a model-driven change from the
 * user's own typing); `pendingContent` holds a render that raced ahead of ready; `pendingFocusChangeId`
 * holds a rail focus target until the body is live.
 */
export interface IEditorWebviewState {
	readonly initialized: boolean;
	readonly ready: boolean;
	readonly pmBody: string | undefined;
	readonly pendingContent: IEditorRenderContent | undefined;
	readonly pendingFocusChangeId: string | undefined;
	/** An Outline reveal target (heading ordinal) held until the body is live, then scrolled to (issue #181). */
	readonly pendingRevealHeadingIndex: number | undefined;
	/** A Home deep-link reveal target (block ordinal) held until the body is live, then scrolled to (plan 48 H2.3u). */
	readonly pendingRevealBlockIndex: number | undefined;
}

/** The fresh state for a newly-created webview (a new input, before its first render). */
export function initialEditorWebviewState(): IEditorWebviewState {
	return { initialized: false, ready: false, pmBody: undefined, pendingContent: undefined, pendingFocusChangeId: undefined, pendingRevealHeadingIndex: undefined, pendingRevealBlockIndex: undefined };
}

/**
 * Record the body the live surface now holds after the user's OWN typing was saved (a `pmEdit`). The live
 * surface already shows this body, so recording it here suppresses a spurious pmReset on the next
 * (non-typing) render - the user keeps their cursor. Pure: returns the next state, no effects.
 */
export function recordPmBody(state: IEditorWebviewState, pmBody: string): IEditorWebviewState {
	return { ...state, pmBody };
}

/** One side effect the host must carry out: set the shell HTML, post a message, or hold a render. */
export type EditorWebviewEffect =
	| { readonly kind: 'setHtml' }
	| { readonly kind: 'postRender'; readonly html: string; readonly pmMd: string | null; readonly pmDeco: unknown; readonly pmReset: string | undefined }
	| { readonly kind: 'holdPending' }
	| { readonly kind: 'postFocus'; readonly id: string }
	| { readonly kind: 'postRevealHeading'; readonly headingIndex: number }
	| { readonly kind: 'postRevealBlock'; readonly blockIndex: number };

export interface IEditorWebviewStep {
	readonly state: IEditorWebviewState;
	readonly effects: readonly EditorWebviewEffect[];
}

// Whether a fresh PM body differs from the one the live surface holds. A model-driven change (an accepted
// change) differs and resets the surface; the user's own typing was recorded into `pmBody` when it was
// saved, so it never triggers a reset. Trimmed so a trailing-newline-only difference is not a reset.
function pmBodyChanged(pmBody: string | undefined, pmMd: string): boolean {
	return pmBody !== undefined && pmMd.trim() !== pmBody.trim();
}

/**
 * Apply a render. Computes the pmReset (only for a model-driven body change) and returns the effect:
 *   - the FIRST render sets the shell HTML (initialized flips true) and posts nothing more (the RUNTIME
 *     will request the content on ready);
 *   - a later render when the webview is ready posts the content (with pmReset when the body changed);
 *   - a later render before the webview is ready is HELD as `pendingContent` (flushed on ready), so an
 *     update can never be lost to the load race.
 * `pmBody` is always updated to the render's body (or cleared when the render carries no PM body), so the
 * NEXT render's model-vs-typing comparison is against what the surface now holds.
 */
export function applyRender(state: IEditorWebviewState, content: IEditorRenderContent): IEditorWebviewStep {
	// pmReset is computed against the CURRENT pmBody before it is updated to this render's body.
	let pmReset: string | undefined;
	let nextPmBody: string | undefined;
	if (content.pmMd !== null) {
		if (pmBodyChanged(state.pmBody, content.pmMd)) { pmReset = content.pmMd; }
		nextPmBody = content.pmMd;
	} else {
		nextPmBody = undefined;
	}

	// First render: set the shell once. The content rides in on the initial setHtml; the RUNTIME reads the
	// embedded PM body on load and signals ready, at which point any subsequent render is posted.
	if (!state.initialized) {
		return {
			state: { ...state, initialized: true, pmBody: nextPmBody },
			effects: [{ kind: 'setHtml' }],
		};
	}
	if (state.ready) {
		return {
			state: { ...state, pmBody: nextPmBody },
			effects: [{ kind: 'postRender', html: content.html, pmMd: content.pmMd, pmDeco: content.pmDeco, pmReset }],
		};
	}
	// Not ready yet: hold this content and flush it when the RUNTIME signals ready. pmBody still advances so
	// the held render's body is what the next comparison sees once it lands.
	return {
		state: { ...state, pmBody: nextPmBody, pendingContent: content },
		effects: [{ kind: 'holdPending' }],
	};
}

/**
 * Apply the webview RUNTIME's ready signal. Flushes any held render (posting it now that the surface is
 * live) and, once the body is live, reveals a pending rail-to-editor focus target. A ready with nothing
 * pending is a no-op beyond flipping `ready`. The held render is posted with NO pmReset: it is the body the
 * surface is mounting with, not a change to a live surface, so it must not remount what just loaded.
 */
export function applyReady(state: IEditorWebviewState): IEditorWebviewStep {
	const effects: EditorWebviewEffect[] = [];
	if (state.pendingContent) {
		const c = state.pendingContent;
		effects.push({ kind: 'postRender', html: c.html, pmMd: c.pmMd, pmDeco: c.pmDeco, pmReset: undefined });
	}
	// The body (with its inline-diff decorations) is now live; reveal any focus target held before ready.
	if (state.pendingFocusChangeId) {
		effects.push({ kind: 'postFocus', id: state.pendingFocusChangeId });
	}
	// The body's headings are now laid out; scroll to any Outline reveal target held before ready (#181).
	if (state.pendingRevealHeadingIndex !== undefined) {
		effects.push({ kind: 'postRevealHeading', headingIndex: state.pendingRevealHeadingIndex });
	}
	// The body's blocks are now laid out; scroll to any Home deep-link reveal target held before ready (H2.3u).
	if (state.pendingRevealBlockIndex !== undefined) {
		effects.push({ kind: 'postRevealBlock', blockIndex: state.pendingRevealBlockIndex });
	}
	return {
		state: { ...state, ready: true, pendingContent: undefined, pendingFocusChangeId: undefined, pendingRevealHeadingIndex: undefined, pendingRevealBlockIndex: undefined },
		effects,
	};
}

/**
 * Apply a rail-to-editor focus request (plan 19): scroll a change into view. When the webview is already
 * ready the focus is posted immediately; otherwise it is HELD and flushed on ready (the body + its
 * decorations must be live before a change can be scrolled to). Navigate-only - revealing never approves.
 */
export function applyFocusRequest(state: IEditorWebviewState, changeId: string): IEditorWebviewStep {
	if (state.ready) {
		return { state, effects: [{ kind: 'postFocus', id: changeId }] };
	}
	return { state: { ...state, pendingFocusChangeId: changeId }, effects: [] };
}

/**
 * Apply an Outline reveal request (issue #181): scroll the editor's ProseMirror surface to the heading at
 * `headingIndex` (its ordinal among all heading blocks). When the webview is already ready the reveal is
 * posted immediately; otherwise it is HELD and flushed on ready, since the headings must be laid out before
 * one can be scrolled to. Navigate-only, mirroring `applyFocusRequest`.
 */
export function applyRevealHeading(state: IEditorWebviewState, headingIndex: number): IEditorWebviewStep {
	if (state.ready) {
		return { state, effects: [{ kind: 'postRevealHeading', headingIndex }] };
	}
	return { state: { ...state, pendingRevealHeadingIndex: headingIndex }, effects: [] };
}

/**
 * Apply a Home NEEDS-YOU deep-link reveal request (plan 48 H2.3u): scroll the editor's ProseMirror surface to
 * the block at `blockIndex` (its 0-based ordinal in document order, recomputed host-side from the change's
 * durable block id via the address model). When the webview is already ready the reveal is posted
 * immediately; otherwise it is HELD and flushed on ready, since the blocks must be laid out before one can be
 * scrolled to. Navigate-only, mirroring `applyRevealHeading`; the webview treats a negative index as a no-op
 * (a deleted block degraded to "open without scroll", spec section 3.1).
 */
export function applyRevealBlock(state: IEditorWebviewState, blockIndex: number): IEditorWebviewStep {
	if (state.ready) {
		return { state, effects: [{ kind: 'postRevealBlock', blockIndex }] };
	}
	return { state: { ...state, pendingRevealBlockIndex: blockIndex }, effects: [] };
}
