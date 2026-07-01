/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILivingDoc, IProposedChange } from './livingDocsModel.js';

// One run of a word-level diff: equal text kept, deleted text (red), or inserted text (green).
export interface IPmDiffSegment {
	readonly t: 'eq' | 'del' | 'ins';
	readonly text: string;
}

// A pending meaning-change over an existing block, anchored by the block's current text so the bundle can
// locate the matching ProseMirror node and render the word diff + accept/reject controls over it.
export interface IPmEditDecoration {
	readonly id: string;
	readonly anchorText: string;
	readonly segments: readonly IPmDiffSegment[];
	readonly added: number;
	readonly removed: number;
	readonly source: string;
	readonly confidence: number;
}

// A generative insertion, anchored after the heading block it follows (or `null` = end of document).
export interface IPmInsertDecoration {
	readonly id: string;
	readonly afterText: string | null;
	readonly newText: string;
	readonly blockLabel: string;
	readonly confidence: number;
}

// A provenance gutter marker beside a source-bound block, keyed by the block's bind keys.
export interface IPmGutterMarker {
	readonly keys: readonly string[];
	readonly recent: boolean;
}

// The full serializable decoration spec sent to the webview; the bundle resolves the text anchors into
// ProseMirror positions and builds the DecorationSet from it.
export interface IPmDecorationSpec {
	readonly edits: readonly IPmEditDecoration[];
	readonly inserts: readonly IPmInsertDecoration[];
	readonly gutters: readonly IPmGutterMarker[];
}

const BIND_LINK_RE = /\[([^\]]*)\]\(bind:([^)\s]+)\)/g;
function bindToValue(text: string): string {
	return text.replace(BIND_LINK_RE, '$1');
}

// The decoration bundle places an inline diff/insert by EXACT match of its anchor against the live
// ProseMirror node's `textContent`. Source prose is wrapped one-sentence-per-line (house style), but
// CommonMark renders those soft wraps as single spaces, so the node text is single-spaced. Collapse the
// anchor's internal whitespace to match - otherwise a wrapped paragraph never decorates and the change
// shows only in the review rail (the plan-19 baseline bug). Kept here, next to where anchors are built, so
// the host stays the single source of anchor truth (no offline PM-bundle rebuild needed).
function anchorNormalize(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** Word-level diff of `oldText` -> `newText` merged into eq/del/ins runs, with the run counts. */
export function wordDiffSegments(oldText: string, newText: string): { segments: IPmDiffSegment[]; added: number; removed: number } {
	const a = oldText.split(/\s+/).filter(Boolean);
	const b = newText.split(/\s+/).filter(Boolean);
	const n = a.length, m = b.length;
	// LCS table, then a backtrack into per-word eq/del/ins operations.
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	type Op = { t: 'eq' | 'del' | 'ins'; w: string };
	const ops: Op[] = [];
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) { ops.push({ t: 'eq', w: a[i] }); i++; j++; }
		else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', w: a[i] }); i++; }
		else { ops.push({ t: 'ins', w: b[j] }); j++; }
	}
	while (i < n) { ops.push({ t: 'del', w: a[i++] }); }
	while (j < m) { ops.push({ t: 'ins', w: b[j++] }); }

	// Merge consecutive ops of the same kind into runs; count the del/ins runs for the control row.
	const segments: IPmDiffSegment[] = [];
	let added = 0, removed = 0, k = 0;
	while (k < ops.length) {
		const t = ops[k].t;
		const words: string[] = [];
		while (k < ops.length && ops[k].t === t) { words.push(ops[k].w); k++; }
		segments.push({ t, text: words.join(' ') });
		if (t === 'del') { removed++; }
		else if (t === 'ins') { added++; }
	}
	return { segments, added, removed };
}

/** Map the pending proposals + document into a serializable ProseMirror decoration spec. */
export function buildPmDecorationSpec(doc: ILivingDoc, pending: readonly IProposedChange[], recent: ReadonlySet<string>): IPmDecorationSpec {
	const source = doc.sources.concat(doc.context).join(', ');
	const edits: IPmEditDecoration[] = [];
	const inserts: IPmInsertDecoration[] = [];

	for (const change of pending) {
		if (change.insert) {
			// A generative insertion lands after its anchor block (a heading), or at the end when unanchored.
			const anchor = change.afterBlockId ? doc.blocks.find(b => b.id === change.afterBlockId) : undefined;
			inserts.push({
				id: change.id,
				afterText: anchor ? anchorNormalize(anchor.text) : null,
				newText: change.newText,
				blockLabel: change.blockLabel,
				confidence: change.confidence,
			});
			continue;
		}
		// A meaning-change: anchor on the block's current (resolved) text so the bundle can find the node.
		const diff = wordDiffSegments(bindToValue(change.oldText), bindToValue(change.newText));
		edits.push({
			id: change.id,
			anchorText: anchorNormalize(bindToValue(change.oldText)),
			segments: diff.segments,
			added: diff.added,
			removed: diff.removed,
			source,
			confidence: change.confidence,
		});
	}

	// Every source-bound block gets a provenance gutter marker; a recently-applied block flashes.
	const gutters: IPmGutterMarker[] = [];
	for (const block of doc.blocks) {
		if (block.binds.length > 0) {
			gutters.push({ keys: block.binds.map(b => b.key), recent: recent.has(block.id) });
		}
	}

	return { edits, inserts, gutters };
}
