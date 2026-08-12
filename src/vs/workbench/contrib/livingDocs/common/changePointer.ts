/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveBlockLine } from './livingDocAddress.js';
import { editAnchorSource, wordDiffSegments } from './livingDocPmDecorations.js';
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
 * Where clicking a pointer takes the reader, and - just as importantly - how sure we are.
 *
 * - `document`: the document's live surface has REPORTED an inline widget for this change, so the pointer
 *   scrolls to it and flashes it. The widget is then the single place the change is read and approved.
 * - `review`: the surface reported and this change was NOT among the widgets it mounted (issue #300 - a
 *   proposal whose target block is a list, a table cell, a heading or any block whose Markdown carries
 *   syntax mounts nothing at all). Sending the reader to a block that shows them nothing would trade a
 *   trust problem for a correctness one, so the pointer reveals the change in the Review tab instead,
 *   which renders the full red/green diff and Approve & apply / Reject.
 * - `unknown`: the document has never reported - it has not been opened in this session, so nothing has
 *   looked. The pointer says nothing about where it will land; the click opens the document, waits for the
 *   report, and only then chooses between the two routes above.
 */
export type ChangePointerRoute = 'document' | 'review' | 'unknown';

/**
 * What one document's live editing surface last OBSERVED about its own inline widgets.
 *
 * This replaces a host-side prediction. The first cut of this package guessed, from the change's Markdown,
 * whether the webview would mount a widget - and argued the guess was safely one-sided. It was not: a
 * validator found whole block classes the guess called `document` that mount nothing, and those pointers
 * landed the reader on empty space. The document is an out-of-process iframe and the anchoring rule lives in
 * a vendored ProseMirror bundle, so the only honest answer comes from asking the surface what it did.
 *
 * Both halves are needed, and this is the subtle part. A change id missing from `mounted` alone proves
 * nothing: the report is a snapshot, and a proposal that arrived after it was taken is missing simply because
 * it did not exist yet. Only a change the surface was ASKED to decorate and did not is evidence of anything.
 */
export interface IInlineWidgetReport {
	/** The change ids the surface was asked to decorate on its last pass (the decoration spec's own ids). */
	readonly requested: ReadonlySet<string>;
	/** The subset of those it actually mounted a live, reachable widget for. */
	readonly mounted: ReadonlySet<string>;
}

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

/**
 * Where a pointer's click should land, read straight off the observation. Pure, and separated from
 * `buildChangePointer` so the view can re-read it at CLICK time - a pointer drawn while its document was
 * closed carries `unknown`, and the click is what opens the document and produces the report.
 *
 * There is deliberately no fallback rule here, and no reasoning about the change's text. An absent report is
 * reported as absent (`unknown`) rather than being resolved to a guess, because a guess is exactly what this
 * function used to be and exactly what stranded readers.
 */
export function changePointerRoute(report: IInlineWidgetReport | undefined, changeId: string): ChangePointerRoute {
	if (!coversChange(report, changeId)) {
		// No report, or one that predates this change (it was proposed after the last decoration pass). Nobody has
		// looked at it yet, and saying "review" here would flash a wrong badge onto every brand-new proposal.
		return 'unknown';
	}
	// Asked for and not mounted: the surface tried and there is nothing there. This is the #300 case.
	return report!.mounted.has(changeId) ? 'document' : 'review';
}

/**
 * Whether this report says anything at all about this change - i.e. whether the surface was ASKED to decorate it
 * (and so either mounted a widget or demonstrably did not). A report that does not cover a change is not a "no":
 * it is silence, and the caller must wait rather than act on it. Shared by the route above and by the pointer
 * click, so "the report answers this question" means one thing in both places.
 */
export function coversChange(report: IInlineWidgetReport | undefined, changeId: string): boolean {
	return !!report && (report.mounted.has(changeId) || report.requested.has(changeId));
}

/**
 * Build the pointer for one pending change. `doc` is the change's own document (not the active one), which
 * may be undefined when that document is not loaded - the address then has no line, exactly as the Review
 * card's address citation already degrades. `report` is that document's last widget report, or undefined
 * when it has never reported.
 */
export function buildChangePointer(change: IProposedChange, doc: ILivingDoc | undefined, report: IInlineWidgetReport | undefined): IChangePointer {
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
		route: changePointerRoute(report, change.id),
	};
}

/**
 * Build the pointers for one assistant turn: the ids that turn proposed, narrowed to the changes that are
 * STILL pending, in the order the live pending set holds them. A change approved or rejected anywhere - the
 * inline widget, the Review tab, Accept all - drops out of `pending` and so drops out of the transcript,
 * which is what keeps the turn honest about what is still open.
 *
 * `docFor` and `widgetsFor` are both looked up per change because one turn can propose across documents, and
 * each document reports for itself.
 */
export function buildTurnPointers(proposedIds: readonly string[], pending: readonly IProposedChange[], docFor: (docId: string) => ILivingDoc | undefined, reportFor: (docId: string) => IInlineWidgetReport | undefined): IChangePointer[] {
	const wanted = new Set(proposedIds);
	return pending.filter(change => wanted.has(change.id)).map(change => buildChangePointer(change, docFor(change.docId), reportFor(change.docId)));
}
