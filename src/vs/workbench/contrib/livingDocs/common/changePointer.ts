/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { resolveBlockLine } from './livingDocAddress.js';
import { editAnchorSource, wordDiffSegments } from './livingDocPmDecorations.js';
import { ILivingDoc, IProposedChange } from './livingDocsModel.js';

// The chat transcript's CHANGE POINTER (plan 52 WP-A1, issue #301).
//
// The problem this model exists to solve: one pending change used to be rendered twice, with two competing
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
 *   change whose target block is a list, a table cell, a heading or any block whose Markdown carries
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
 * nothing: the report is a snapshot, and a change that arrived after it was taken is missing simply because
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
	const answer = inlineWidgetAnswer(report, changeId);
	if (answer === undefined) {
		// No report, one that predates this change (it was proposed after the last decoration pass), or one that
		// has been retired because the surface stopped watching. Nobody has looked at it, and saying "review" here
		// would flash a wrong badge onto every brand-new change.
		return 'unknown';
	}
	// Asked for and not mounted: the surface tried and there is nothing there. This is the #300 case.
	return answer ? 'document' : 'review';
}

/**
 * What this report says about this change, as three distinct states rather than two:
 *
 * - `true`  - the surface mounted an inline widget for it, so the document can show it;
 * - `false` - the surface was ASKED to decorate it and demonstrably did not (the #300 case);
 * - `undefined` - the report says nothing about this change at all, which is SILENCE, not a "no".
 *
 * The third state is the one that matters and the one the first cut of this package lacked. Silence is what a
 * change proposed since the last decoration pass looks like, and it is also what a RETIRED report looks like
 * (`clearInlineWidgets`, when the surface that made a report stops watching the content it described). Neither
 * is grounds to act: the caller must wait for a real observation, and if none comes, send the reader to Review,
 * which can render any change. Defined once here so the route marker in the transcript and the decision the
 * click makes are literally the same rule (plan 52 WP-A1 fix 2, #301).
 */
export function inlineWidgetAnswer(report: IInlineWidgetReport | undefined, changeId: string): boolean | undefined {
	if (!report) { return undefined; }
	if (report.mounted.has(changeId)) { return true; }
	return report.requested.has(changeId) ? false : undefined;
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

/** What a RESTORED turn's changes became: the chip's short marker, and one sentence naming the outcome. */
export interface IRestoredChangeNote {
	/** The short marker: the outcome itself when the whole turn shares one, otherwise the neutral record mark. */
	readonly tag: string;
	/** One complete sentence. Never assembled from fragments - word order is not the same in every language. */
	readonly text: string;
	/** True only when every change was approved: the one outcome that reads as landed rather than as a record. */
	readonly applied: boolean;
}

/**
 * What a RESTORED assistant turn should say about the changes it proposed (#312 fix round 2).
 *
 * A restored turn has no live pointers - pending changes die with the process - so this is the whole of what
 * the reader gets. The first cut printed ONE sentence for every restored change: *"Changes waiting for
 * review are cleared when the workspace closes, so it is not open any more."* That sentence is true of a
 * change nobody reviewed and FALSE of one the user approved - which is on disk, and in the History tab three
 * inches away. Telling someone their approved edit evaporated is worse than saying nothing: a reader
 * re-reading a restored chat to check what they agreed to is actively misdirected by it.
 *
 * So the outcome is recorded when it happens and spoken here. `approved` and `rejected` are clamped against
 * `proposed` rather than trusted, and whatever is left over is the honest remainder: proposed, never reviewed,
 * and therefore genuinely cleared when the workspace closed - the only case the original sentence described.
 *
 * Pure and DOM-free, like everything else in this module, so every one of these sentences is unit-tested
 * rather than read off a screenshot.
 */
export function describeRestoredChanges(proposed: number | undefined, approved: number | undefined, rejected: number | undefined): IRestoredChangeNote | undefined {
	const total = Math.max(0, Math.floor(proposed ?? 0));
	if (!total) { return undefined; }
	const yes = Math.min(total, Math.max(0, Math.floor(approved ?? 0)));
	const no = Math.min(total - yes, Math.max(0, Math.floor(rejected ?? 0)));
	const unreviewed = total - yes - no;
	const past = localize('livingDocs.chat.restored.tag.past', "PAST");

	if (yes === total) {
		return {
			tag: localize('livingDocs.chat.restored.tag.approved', "APPROVED"),
			applied: true,
			text: total === 1
				? localize('livingDocs.chat.restored.approvedOne', "Proposed 1 change. You approved it, so it is in the document - the History tab has the record.")
				: localize('livingDocs.chat.restored.approvedAll', "Proposed {0} changes. You approved them all, so they are in the document - the History tab has the record.", total),
		};
	}
	if (no === total) {
		return {
			tag: localize('livingDocs.chat.restored.tag.rejected', "REJECTED"),
			applied: false,
			text: total === 1
				? localize('livingDocs.chat.restored.rejectedOne', "Proposed 1 change. You rejected it, so the document was left unchanged.")
				: localize('livingDocs.chat.restored.rejectedAll', "Proposed {0} changes. You rejected them all, so the document was left unchanged.", total),
		};
	}
	if (unreviewed === total) {
		// The only case the original sentence was ever right about, kept close to its wording.
		return {
			tag: past,
			applied: false,
			text: total === 1
				? localize('livingDocs.chat.restored.openOne', "Proposed 1 change. It was never approved or rejected, and changes waiting for review are cleared when the workspace closes.")
				: localize('livingDocs.chat.restored.openMany', "Proposed {0} changes. They were never approved or rejected, and changes waiting for review are cleared when the workspace closes.", total),
		};
	}
	// A turn whose changes went different ways. The parts are named as counts rather than as clauses with verbs
	// in them, so one sentence covers "1 approved" and "4 approved" without a plural form per number.
	if (!unreviewed) {
		return { tag: past, applied: false, text: localize('livingDocs.chat.restored.mixed', "Proposed {0} changes - {1} approved, {2} rejected.", total, yes, no) };
	}
	if (!no) {
		return { tag: past, applied: false, text: localize('livingDocs.chat.restored.mixedApproved', "Proposed {0} changes - {1} approved, {2} never reviewed before the workspace closed.", total, yes, unreviewed) };
	}
	if (!yes) {
		return { tag: past, applied: false, text: localize('livingDocs.chat.restored.mixedRejected', "Proposed {0} changes - {1} rejected, {2} never reviewed before the workspace closed.", total, no, unreviewed) };
	}
	return { tag: past, applied: false, text: localize('livingDocs.chat.restored.mixedAll', "Proposed {0} changes - {1} approved, {2} rejected, {3} never reviewed before the workspace closed.", total, yes, no, unreviewed) };
}
