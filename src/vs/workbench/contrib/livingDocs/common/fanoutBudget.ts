/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Fan-out context budgeting (plan 30, track 3, D30-B). The plan-18 whole-project fan-out (decision 62)
// sent EVERY working-set document body in one model call, so a 50-doc folder silently overflowed the
// model's context window - it either truncated or 400'd. This pure module packs the working set into
// context-bounded BATCHES so the fan-out never over-fills a single call, and flags a document that is
// too large for the budget on its OWN rather than dropping it silently (the plan-23 honesty rule).
//
// No file system, no service, no model - just deterministic arithmetic over item sizes, so the packing
// and the oversize decision are unit-tested directly and reused by the service's fan-out composer.

/**
 * Estimate the token cost of a string. `chars / 4` is the plan's stated heuristic (D30-B) - adequate
 * for budgeting, and deliberately NOT a real tokeniser (which would drag a dependency into a pure
 * common module for no correctness gain, since the budget carries its own safety margin). Rounds up so
 * a short non-empty string never estimates zero tokens. An empty string is zero.
 */
export function estimateTokens(text: string): number {
	if (!text) { return 0; }
	return Math.ceil(text.length / 4);
}

/** One document to pack into the fan-out: a stable id, its title (for the keyed reply) and its body. */
export interface IFanoutDoc {
	readonly id: string;
	readonly title: string;
	/** The serialized document body the model is shown - its estimated token cost drives the packing. */
	readonly body: string;
}

/** One packed batch: the documents that fit within the budget together, in their original order. */
export interface IFanoutBatch {
	readonly docs: readonly IFanoutDoc[];
	/** The summed estimated token cost of this batch's document bodies (informational; <= perDocBudget). */
	readonly tokens: number;
}

export interface IFanoutPlan {
	/** The batches to send, in order. Empty when every document was oversize (or there were none). */
	readonly batches: readonly IFanoutBatch[];
	/**
	 * Documents that alone exceed the whole per-document budget: they are NEVER packed into a batch (they
	 * would overflow the call by themselves). Surfaced to the UI as an honest "too large for this run"
	 * state rather than being silently dropped or silently truncated.
	 */
	readonly oversize: readonly IFanoutDoc[];
	/** The number of batches, for the "batch K of M" progress label. */
	readonly batchCount: number;
}

/**
 * Pack the working set into context-bounded batches (D30-B).
 *
 * `contextBudget` is the total token budget for one call's DOCUMENT payload - the model's context window
 * minus the prompt scaffold minus a safety margin, supplied by the caller (the configurable
 * `livingDocs.fanoutContextBudget`, default 24k). `promptOverhead` is the estimated fixed cost of the
 * system prompt + shared sources + transcript that rides in EVERY call, so the space actually available
 * for document bodies in one batch is `contextBudget - promptOverhead` (floored at a small minimum so a
 * large overhead can never produce a zero/negative budget that packs nothing).
 *
 * Documents are packed greedily in order: each is added to the current batch while it still fits; when it
 * would overflow, the current batch closes and a fresh one opens. A document whose OWN body exceeds the
 * per-document budget is set aside as `oversize` (it cannot fit any batch) - it is reported, never sent.
 * Order is preserved and every non-oversize document appears in EXACTLY one batch, so a later merge of the
 * per-batch keyed replies can never double-count or drop a document (the plan's uniqueness-by-construction
 * requirement).
 */
export function planFanoutBatches(docs: readonly IFanoutDoc[], contextBudget: number, promptOverhead: number = 0): IFanoutPlan {
	// The space for document bodies in one batch, after the fixed per-call overhead. Never below a small
	// floor so a mis-sized overhead can't wipe the budget out entirely.
	const perDocBudget = Math.max(512, contextBudget - Math.max(0, promptOverhead));
	const batches: IFanoutBatch[] = [];
	const oversize: IFanoutDoc[] = [];
	let current: IFanoutDoc[] = [];
	let currentTokens = 0;
	const flush = () => {
		if (current.length) {
			batches.push({ docs: current, tokens: currentTokens });
			current = [];
			currentTokens = 0;
		}
	};
	for (const doc of docs) {
		const cost = estimateTokens(doc.body);
		// A document larger than the whole per-document budget cannot fit ANY batch - set it aside honestly.
		if (cost > perDocBudget) { oversize.push(doc); continue; }
		// Adding it would overflow the current batch: close the batch and start a new one with this document.
		if (current.length && currentTokens + cost > perDocBudget) { flush(); }
		current.push(doc);
		currentTokens += cost;
	}
	flush();
	return { batches, oversize, batchCount: batches.length };
}
