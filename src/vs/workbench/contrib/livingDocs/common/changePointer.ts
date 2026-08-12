/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveBlockLine } from './livingDocAddress.js';
import { anchorNormalize, editAnchorSource, wordDiffSegments } from './livingDocPmDecorations.js';
import { ILivingDoc, IProposedChange } from './livingDocsModel.js';

// The chat transcript's CHANGE POINTER (plan 52 WP-A1, issue #301).
//
// The problem this model exists to solve: one pending proposal used to be rendered twice, with two competing
// live controls. The document mounted the full inline widget - kind chip, confidence, rationale, the red/green
// diff, the "Line N" address and Edit / Approve changes / Reject - and the chat rail simultaneously repeated
// the whole proposed sentence verbatim underneath its own Apply / Reject. Two live controls for one change is
// what made the surface read as untrustworthy: which one is the real change, and what happens if they
// disagree? The document owns the controls now, and the transcript keeps only a POINTER: enough to know a
// change landed and where, never enough to be a second copy of it.
//
// A pointer therefore carries no prose. It carries the change's identity, its address, and its size - and a
// ROUTE, which is the interesting part. See `changePointerRoute` below.

/**
 * Where clicking a pointer takes the reader.
 *
 * - `document`: the change has an inline widget, so the pointer scrolls the document to it and flashes it.
 *   The widget is then the single place the change is read and approved.
 * - `review`: the change has NO inline widget (issue #300 - a proposal whose target block is a bullet list,
 *   a table, a heading or any block whose Markdown carries syntax renders no diff in the document). Sending
 *   the reader to a block that shows them nothing would trade a trust problem for a correctness one, so the
 *   pointer reveals the change in the Review tab instead, which already renders the full red/green diff and
 *   Approve & apply / Reject. The document still scrolls and flashes underneath.
 */
export type ChangePointerRoute = 'document' | 'review';

/**
 * Everything the transcript needs to draw one pointer and act on a click. Deliberately structural: the labels
 * are composed (and localised) by the view, so this model stays a pure, DOM-free, language-free description.
 */
export interface IChangePointer {
	readonly changeId: string;
	readonly docId: string;
	/** The durable block id, resolved to a display line at render time and re-resolved at click time. */
	readonly blockId: string;
	/** True for a generative insertion ("new content after X"), false for an in-place edit. */
	readonly insert: boolean;
	/** True for a `meaning` change, which reads in the attention tone; a `figure` change reads calm. */
	readonly attention: boolean;
	/** The human block label the change already carries, e.g. "Commentary" or "Colour tokens". */
	readonly blockLabel: string;
	/** The current 1-based display line, or undefined when the block is gone or the document is not loaded. */
	readonly line?: number;
	/** Inserted word runs, matching the count the inline widget prints. Absent for an insertion. */
	readonly added?: number;
	/** Deleted word runs, matching the count the inline widget prints. Absent for an insertion. */
	readonly removed?: number;
	readonly route: ChangePointerRoute;
}

// A block's raw Markdown carries syntax the reader never sees: list markers, blockquote and heading marks,
// table pipes, code fences, emphasis runs, link brackets, raw HTML. The ProseMirror node the decoration must
// match reports the RENDERED text, with all of that stripped. So an anchor built from raw Markdown can only
// ever match when the block's Markdown has no syntax left in it once bind links are baked down.
const MARKDOWN_SYNTAX = /^\s*([-*+]|\d+[.)]|>|#{1,6})\s|[`*_~[\]|]|<[a-z/]/i;

/**
 * Will the document actually mount an inline diff widget for this change?
 *
 * The decoration layer places a widget by matching its anchor - the block's raw Markdown, whitespace
 * collapsed - against a live ProseMirror node's `textContent`. That match succeeds for plain prose and fails
 * for every block whose Markdown carries syntax, because the rendered node text no longer contains it. This
 * is the mechanism behind issue #300: a bullet-list target anchors on `- Ink \`#14161A\`` while the node
 * reports `Ink #14161A`, so nothing mounts and the document shows only a gutter marker.
 *
 * Rather than model Markdown rendering (which would be a second, drifting implementation of the parser), this
 * asks the narrower question the anchor actually turns on: is the anchor free of Markdown syntax? The error is
 * deliberately one-sided. A false `false` - prose containing a stray `_` or `*` that markdown-it would leave
 * alone - routes the reader to Review, where the change is fully readable and actionable; nothing is lost. A
 * false `true` would strand them on a block showing nothing, so the predicate never guesses in that direction.
 *
 * An insertion is always `true`: it anchors after a heading block (or the document end) and mounts its own
 * all-additions widget, which the pre-build walk confirmed renders.
 */
export function changeRendersInline(doc: ILivingDoc, change: IProposedChange): boolean {
	if (change.insert) { return true; }
	// A change whose target block is gone has nothing to decorate (and nothing to scroll to).
	if (!doc.blocks.some(block => block.id === change.blockId)) { return false; }
	const anchor = anchorNormalize(editAnchorSource(change));
	return anchor.length > 0 && !MARKDOWN_SYNTAX.test(anchor);
}

/**
 * Where a pointer's click should land. Pure, and separated from `buildChangePointer` so the view can
 * re-resolve the route at CLICK time against a document that may only have been loaded by the click itself -
 * a pointer rendered while its document was closed still lands on the right surface.
 *
 * A document that is not loaded resolves to `review`, the surface that is legible no matter what the
 * renderer does with the block. Better to over-serve the review card than to strand the reader.
 */
export function changePointerRoute(doc: ILivingDoc | undefined, change: IProposedChange): ChangePointerRoute {
	if (!doc) { return 'review'; }
	return changeRendersInline(doc, change) ? 'document' : 'review';
}

/**
 * Build the pointer for one pending change. `doc` is the change's own document (not the active one), which
 * may be undefined when that document is not loaded - the address then has no line, exactly as the Review
 * card's address citation already degrades.
 */
export function buildChangePointer(change: IProposedChange, doc: ILivingDoc | undefined): IChangePointer {
	const line = doc ? resolveBlockLine(doc, change.blockId) : undefined;
	const insert = !!change.insert;
	// The same word-run counts the inline widget prints, so the pointer and the widget never disagree about
	// how big the change is. An insertion has no `oldText` to diff, so it carries no counts at all rather
	// than a meaningless "+1 -0".
	const diff = insert ? undefined : wordDiffSegments(editAnchorSource(change), change.newText);
	return {
		changeId: change.id,
		docId: change.docId,
		blockId: change.blockId,
		insert,
		attention: change.kind === 'meaning',
		blockLabel: change.blockLabel,
		...(typeof line === 'number' ? { line } : {}),
		...(diff ? { added: diff.added, removed: diff.removed } : {}),
		route: changePointerRoute(doc, change),
	};
}

/**
 * Build the pointers for one assistant turn: the ids that turn proposed, narrowed to the changes that are
 * STILL pending, in the order the live pending set holds them. A change approved or rejected anywhere - the
 * inline widget, the Review tab, Accept all - drops out of `pending` and so drops out of the transcript,
 * which is what keeps the turn honest about what is still open.
 */
export function buildTurnPointers(proposedIds: readonly string[], pending: readonly IProposedChange[], docFor: (docId: string) => ILivingDoc | undefined): IChangePointer[] {
	const wanted = new Set(proposedIds);
	return pending.filter(change => wanted.has(change.id)).map(change => buildChangePointer(change, docFor(change.docId)));
}
