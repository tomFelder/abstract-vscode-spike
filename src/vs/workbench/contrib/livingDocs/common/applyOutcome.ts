/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

// The CLOSED result of applying an approved edit to a block (docs/30 invariant I1; kills issue #329).
//
// `applyBlockEdit` used to return a bare `string`, and its fail-soft path returned the block's text back
// UNCHANGED. That is indistinguishable from success by construction: an edit whose anchor had moved on since
// the proposal was queued returned exactly what a successful whole-block no-op edit returns, so `approve()`
// could not tell the two apart and recorded `approved` for a document it had not touched. The user got a
// cleared review rail, an approval in the audit trail and History, and a file on disk that still said the old
// thing - the single worst trust breach in the product, because it is a LIE the system tells confidently.
//
// The fix is a type, not a check: silence is made unrepresentable. Every apply primitive returns either a
// landed result carrying the text it produced, or a failure carrying a NAMED reason. A caller cannot read the
// text without first proving the apply landed, so a failure cannot be mistaken for a no-op ever again.
//
// This module is pure - no DOM, no service, no file system - so the contract and its plain-words copy are
// unit-tested directly and shared by the markdown primitive, the service's approve path and the review rail.

/**
 * Why an approved edit could not be applied. Each value is a distinct, explainable failure the surfaces can
 * NAME, so a refusal never degrades into a silent no-op or a generic "something went wrong".
 */
export type BlockApplyFailure =
	/** The block the change was anchored to is no longer in the document (deleted, or replaced wholesale). */
	| 'block-gone'
	/** The block is still there, but the exact text the change was written against is not in it any more. */
	| 'anchor-miss';

/** The apply landed: `text` is the block's new content, and only this shape carries text at all. */
export interface IBlockApplyLanded {
	readonly landed: true;
	readonly text: string;
}

/** The apply did NOT land: nothing was written, and `reason` names why in machine-readable terms. */
export interface IBlockApplyFailed {
	readonly landed: false;
	readonly reason: BlockApplyFailure;
}

/** The discriminated outcome of one apply. Narrow on `landed` before reaching for `text`. */
export type BlockApplyResult = IBlockApplyLanded | IBlockApplyFailed;

/** Build the landed result for `text`. */
export function blockApplyLanded(text: string): IBlockApplyLanded {
	return { landed: true, text };
}

/** Build the failed result for `reason`. */
export function blockApplyFailed(reason: BlockApplyFailure): IBlockApplyFailed {
	return { landed: false, reason };
}

/**
 * The plain-words clause explaining one failure, for composing into a sentence (no leading capital, no full
 * stop). It says what happened to the DOCUMENT, not what the machine did - the reader's question is always
 * "why did my approval not land", and the honest answer is that the text moved on since the agent wrote it.
 */
export function describeApplyFailure(reason: BlockApplyFailure): string {
	switch (reason) {
		case 'block-gone':
			return localize('livingDocs.apply.reason.blockGone', "the part of the document it was written for is no longer there");
		case 'anchor-miss':
			return localize('livingDocs.apply.reason.anchorMiss', "the text it was written for has changed since it was proposed");
	}
}

/**
 * The review rail's line on a change whose approval could not be applied. It states the three facts the
 * reader needs in order: it did not land, why, and that the change is still theirs to decide.
 */
export function applyFailureRailNote(reason: BlockApplyFailure): string {
	return localize('livingDocs.apply.railNote', "This change was not applied - {0}. Nothing was written to the document, and the change is still waiting on your call.", describeApplyFailure(reason));
}

/** The document's status line after an approval failed to apply: names the document and the reason. */
export function applyFailureStatus(docTitle: string, reason: BlockApplyFailure): string {
	return localize('livingDocs.apply.status', "Change could not be applied - {0} is unchanged because {1}", docTitle, describeApplyFailure(reason));
}
