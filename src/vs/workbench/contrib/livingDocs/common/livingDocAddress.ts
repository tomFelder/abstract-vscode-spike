/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { chunkDocBody } from './livingDocMarkdown.js';
import { ILivingDoc, IProposedChange } from './livingDocsModel.js';

// The shared line-address model (spec 43 section 3.1, owner: plan 45 / PR-a; consumers: plans 47, 48, 49).
//
// The contract in one paragraph: one address per Markdown block, following the D1 wrap rule (a block that
// wraps over several visual rows is still ONE address). Persistent references (chat history, ledger entries,
// proposal records) carry the block's durable `id` - NEVER a printed number, which is display-only and
// recomputed from the current document every render. `computeBlockAddresses` maps the doc's blocks to their
// 1-based line numbers in document order; `resolveBlockLine` turns a persisted block id back into its current
// number, or `undefined` when that block is gone - a deep link to a deleted block degrades to the document
// (no scroll) and never errors. `addressLabel` renders the human "Line N" string used verbatim by the gutter,
// the inline proposal widget, the rail cards, Home cards and the Agents activity ledger, so every surface
// speaks one address vocabulary.

/** One block's display address: its durable id plus the 1-based line number shown this render. */
export interface IBlockAddress {
	readonly id: string;
	readonly line: number;
}

/** The provenance tone a block's gutter number carries (spec pin 9): quiet idle, accent bound, attention pending. */
export type BlockAddressTone = 'idle' | 'bound' | 'pending';

/**
 * One block's full display descriptor for the numbered gutter: its address, its provenance tone, and the bind
 * keys it carries (for the hover source-peek). Emitted in document order so the webview can zip it 1:1 with
 * the ProseMirror node order without any text matching.
 */
export interface IBlockGutterEntry {
	readonly id: string;
	readonly line: number;
	readonly tone: BlockAddressTone;
	readonly keys: readonly string[];
	/** True when this bound block changed since the last sync (drives the recency flash). */
	readonly recent: boolean;
}

/**
 * Compute the display address (1-based line number, document order) for every block in the document. The
 * number is the block's ordinal, following the D1 wrap rule - one address per Markdown block, never per
 * wrapped visual row. Computed fresh at render time; nothing here is persisted.
 */
export function computeBlockAddresses(doc: ILivingDoc): IBlockAddress[] {
	return doc.blocks.map((block, index) => ({ id: block.id, line: index + 1 }));
}

/**
 * Resolve a persisted block id back to its current display line, or `undefined` when the block no longer
 * exists in the document. Callers deep-linking by address MUST treat `undefined` as "open the document
 * without scrolling" - a link whose block was deleted degrades gracefully and never throws.
 */
export function resolveBlockLine(doc: ILivingDoc, blockId: string): number | undefined {
	const index = doc.blocks.findIndex(block => block.id === blockId);
	return index < 0 ? undefined : index + 1;
}

/** The human address string ("Line 6") cited by the gutter, proposal widgets, rail cards and the ledger. */
export function addressLabel(line: number): string {
	return `Line ${line}`;
}

/**
 * The 0-based ORDINAL of the block a change targets - the block's position in document order, which is the
 * same coordinate the webview counts top-level ProseMirror nodes in (both come from `chunkDocBody`). This is
 * the address the decoration layer mounts on (docs/30 section 4.3), replacing anchor-text equality: text is
 * not an address, and a change whose block was edited after it was proposed - or whose block is a list, whose
 * rendered text never equals the item-scoped anchor - used to fail to mount silently (the #300 class).
 *
 * Two ways in, in order of trust:
 *
 *  1. `blockId`, when it addresses exactly ONE block. This is the overwhelming case and stays right across
 *     text drift: a non-heading block's id is its ordinal (`b-3`), so editing its prose does not move it.
 *  2. the change's `{start, end}` span in the base revision's body, when the id addresses NO block (a heading
 *     whose text was edited re-slugs, so `h-old-title` is gone) or MORE THAN ONE (two `## Notes` headings both
 *     slug to `h-notes` - the collision recorded in docs/30 section 1). The span is only consulted when the
 *     body still chunks to the same number of blocks the document was parsed into, which is the cheap,
 *     honest test that the two coordinate systems still agree.
 *
 * Returns undefined when neither can address a block; callers must treat that as "do not mount", never as 0.
 */
export function resolveBlockOrdinal(doc: ILivingDoc, change: Pick<IProposedChange, 'blockId' | 'span'>): number | undefined {
	let found = -1;
	let ambiguous = false;
	for (let i = 0; i < doc.blocks.length; i++) {
		if (doc.blocks[i].id !== change.blockId) { continue; }
		if (found >= 0) { ambiguous = true; break; }
		found = i;
	}
	if (found >= 0 && !ambiguous) { return found; }

	const span = change.span;
	if (!span) { return found >= 0 ? found : undefined; }
	const chunks = chunkDocBody(doc.body);
	if (chunks.length !== doc.blocks.length) { return found >= 0 ? found : undefined; }
	const at = chunks.findIndex(chunk => span.start >= chunk.start && span.start < chunk.end);
	return at >= 0 ? at : (found >= 0 ? found : undefined);
}

/**
 * Build the ordered per-block gutter entries the numbered rail renders: every block gets a number; a block
 * carrying bind links reads as `bound`; a block under a pending (non-insert) meaning-change reads as
 * `pending` (pending outranks bound so a source-bound block being edited shows the attention tone). `recent`
 * flags a bound block that changed since the last sync. Emitted in document order so the webview zips it 1:1
 * with the ProseMirror node order.
 */
export function buildBlockGutterEntries(doc: ILivingDoc, pending: readonly IProposedChange[], recent: ReadonlySet<string>): IBlockGutterEntry[] {
	// Which block ids carry a pending, in-place (non-insert) change: those blocks read as `pending`.
	const pendingBlockIds = new Set<string>();
	for (const change of pending) {
		if (!change.insert && change.blockId) {
			pendingBlockIds.add(change.blockId);
		}
	}
	return doc.blocks.map((block, index) => {
		const keys = block.binds.map(bind => bind.key);
		const tone: BlockAddressTone = pendingBlockIds.has(block.id) ? 'pending' : (keys.length > 0 ? 'bound' : 'idle');
		return { id: block.id, line: index + 1, tone, keys, recent: recent.has(block.id) };
	});
}
