/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ISplicePlacement, spliceDoc } from './changeRecord.js';
import { chunkDocBody, extractBindLinks } from './livingDocMarkdown.js';

// The segment list and its deterministic host expansion (issue #381; docs/30-editing-architecture.md
// section 2.1 "the edit representation", section 2.4 `propose_segments`, invariant I6).
//
// This is the module that lets a model change a document without ever owning a position. The planner reads
// the document as ordinal-labelled blocks (`B1`, `B2`, ... - `serialiseBlocks` in `livingDocsAgentTools.ts`)
// and emits a list that accounts for EVERY block exactly once:
//
//   { keep: "B1-B7" }
//   { replace: "B8-B9", echo: ["Our pricing", "Each seat"], content: "..." }
//   { insertAfter: "B14", content: "..." }
//
// The host expands that list here. There is NO apply model in the path, and that is the whole design: a
// kept block is copied out of the base by offset, so it is byte-identical by construction rather than by a
// model's good behaviour (invariant I6). Everything a segment list can express is either "these exact bytes"
// or "this new text instead of those exact bytes", and there is no third case for a character to go missing
// in.
//
// Three rules make a wrong list LOUD rather than quietly destructive, which is the #300/#303/#329 defect
// family stated positively:
//
//  1. **Coverage is total.** Every base block must be claimed by exactly one `keep` or `replace`. A gap is
//     `uncovered-block` and an overlap is `overlapping-range` - both hard validation failures. A list that
//     simply forgot the tail of a document therefore cannot silently delete it.
//  2. **Every `replace` echoes what it claims.** For each block in the range the model repeats that block's
//     opening words, and the host checks the echo against the block AT THAT ORDINAL. An off-by-one range is
//     syntactically perfect and semantically wrong, so nothing else would catch it; here it is
//     `echo-mismatch`, rejected whole, never applied.
//  3. **Bindings survive or the hunk is dropped.** A hunk whose replacement does not carry the base hunk's
//     bind-key multiset with well-formed markup is dropped with a named reason (doc 30 section 2.1), rather
//     than being allowed to dissolve a live figure into prose.
//
// Pure `common/`: no VS Code service, no DOM, no file system, no clock, no randomness. It joins the family
// of pure tested seams beside it (`turnReceipts.ts`, `applyOutcome.ts`, `changeJournal.ts`,
// `changeReconciler.ts`, `livingDocDiffer.ts`) and is driven directly by its own table-driven suite.
//
// FRONTMATTER IS NOT VISIBLE HERE, exactly as in the differ: this module takes BODY text and emits
// body-relative spans. The caller strips frontmatter before calling and re-attaches it with
// `withReplacedBody`, so the `---` block cannot be reached by a path that never sees it.

/** Keep these base blocks exactly as they are. The bytes are copied, never re-emitted. */
export interface IKeepSegment {
	/** `B4`, or `B1-B7` for a run. */
	readonly keep: string;
}

/** Replace these base blocks with `content`. An empty `content` deletes them. */
export interface IReplaceSegment {
	/** `B8`, or `B8-B9` for a run. */
	readonly replace: string;
	/** The opening words of each block in the range, in order - one entry per block. The off-by-one guard. */
	readonly echo: readonly string[];
	/** The Markdown that takes their place. Empty deletes the range. */
	readonly content: string;
}

/** Add brand-new content after this base block. */
export interface IInsertAfterSegment {
	/** A single label, `B14`. */
	readonly insertAfter: string;
	readonly content: string;
}

/** One entry of a segment list. Exactly one of `keep` / `replace` / `insertAfter` is present. */
export type DocSegment = IKeepSegment | IReplaceSegment | IInsertAfterSegment;

/**
 * Why a segment list was rejected WHOLE. Every one of these is a hard validation failure: the list is not
 * partially applied, nothing is queued from it, and the model is told which segment and which label was
 * wrong so its next attempt can be right (invariant I7 - a schema-invalid payload is a failed turn).
 */
export type SegmentViolation =
	/** `segments` was not a non-empty array of objects. */
	| 'not-a-list'
	/** A segment carried none of `keep` / `replace` / `insertAfter`, or more than one, or a wrong type. */
	| 'malformed-segment'
	/** A label was not of the form `B<n>` with n >= 1. */
	| 'bad-label'
	/** A range's end came before its start. */
	| 'bad-range'
	/** A label named a block this document does not have. */
	| 'stale-ordinal'
	/** Two segments claimed the same block, or two inserts named the same block. */
	| 'overlapping-range'
	/** A base block was claimed by no segment. */
	| 'uncovered-block'
	/** A `replace` echo did not match the block at that ordinal - the off-by-one guard firing. */
	| 'echo-mismatch'
	/**
	 * A `replace` echo matched the named block but ALSO another one, so it does not identify a single block:
	 * duplicate headings, two paragraphs that open the same way, or a heading whose text opens the paragraph
	 * beneath it. A prefix that fits two blocks cannot prove the range is not off by one, which is the whole
	 * point of the echo (issue #381 cycle 2; the #300/#303/#329 family). Rejected whole rather than applied to
	 * one of the blocks the model may not have meant.
	 */
	| 'ambiguous-echo'
	/** An `insertAfter` carried nothing to insert. */
	| 'empty-content'
	/**
	 * The composed hunks did not splice back against the base. Unreachable by construction; kept because
	 * "unreachable" is a claim, and a claim about byte-exactness is worth checking rather than asserting.
	 */
	| 'expansion-mismatch';

/** A rejected list: the machine-readable reason, which segment it was, and the words the model reads. */
export interface ISegmentViolation {
	readonly ok: false;
	readonly violation: SegmentViolation;
	/** The 0-based index of the offending segment, when one segment is to blame. */
	readonly segmentIndex?: number;
	/** The plain-words explanation handed to the model. */
	readonly message: string;
}

/** A parsed segment list, or the named reason it is not one. */
export type SegmentParseResult = { readonly ok: true; readonly segments: readonly DocSegment[] } | ISegmentViolation;

/**
 * One mutating segment's hunk against the BASE BODY: where, the exact bytes sitting there, and what takes
 * their place. It extends {@link ISplicePlacement} so persisting it is `{docUri, baseRevision, ...hunk}` and
 * nothing is translated on the way - the same contract the differ's hunks keep.
 *
 * Hunks are DISJOINT and ascending, so any subset of them splices correctly: approving two of five is
 * arithmetic, not a re-diff.
 */
export interface ISegmentHunk extends ISplicePlacement {
	/** The index of the segment that produced this hunk, so a receipt lines up with what the model sent. */
	readonly segmentIndex: number;
	readonly op: 'replace' | 'delete' | 'insert';
	/** The label the model used, echoed back in the receipt so it reads what it wrote. */
	readonly label: string;
	/**
	 * The 0-based base block this hunk is ABOUT: the first block of a replace or delete range, the block an
	 * insertion follows. Carried on the hunk rather than re-derived from `span.start`, which a deletion
	 * deliberately widens back over the blank line above it - so the two would disagree exactly where the
	 * card's address matters most.
	 */
	readonly blockOrdinal: number;
}

/** A successfully expanded segment list. */
export interface ISegmentExpansion {
	readonly ok: true;
	/** The whole proposed body. Kept blocks are byte-identical to the base by construction. */
	readonly body: string;
	/** One hunk per mutating segment, disjoint and ascending. A pure `keep` list produces none. */
	readonly hunks: readonly ISegmentHunk[];
	/** How many base blocks the list kept untouched. */
	readonly keptBlocks: number;
}

export type SegmentExpansionResult = ISegmentExpansion | ISegmentViolation;

/**
 * Why one hunk never became a queued change. The vocabulary is doc 30 section 2.4's, verbatim:
 * `queued(changeId) | dropped(policy | bind-guard | stale-ordinal | out-of-scope | no-op)`. Every drop is
 * NAMED, so a shortfall can never degrade into "some changes did not apply" (invariant I3).
 */
export type SegmentDropReason =
	/** The document is dialled "Never change this doc", so no change is ever created for it. */
	| 'policy'
	/** The document was not in this run's declared scope. */
	| 'out-of-scope'
	/** The hunk's replacement does not carry the base hunk's bind keys with well-formed markup. */
	| 'bind-guard'
	/**
	 * The hunk's ordinal no longer names the block it was written against. Part of doc 30's complete
	 * receipt vocabulary and named by {@link describeSegmentDrop}; in this single-turn tranche a stale label
	 * surfaces earlier, as the whole-list {@link SegmentViolation} of the same name, because a list is expanded
	 * against the very body the model just read. It becomes an individual drop once a hunk can outlive its
	 * read - issue #382's reconciliation and the later rewrite lane.
	 */
	| 'stale-ordinal'
	/** The replacement is byte-identical to what is already there. */
	| 'no-op'
	/**
	 * The host could not turn the change into a reviewable change - the document could not be opened, or the
	 * write to the review queue failed. Never a silent nothing: a host-side failure to record is still a NAMED
	 * outcome the receipt carries, so the reply reconciles it as a failure rather than reading back the model's
	 * success prose over a change that never landed (invariant I1/I3; issue #425).
	 */
	| 'not-recorded';

/** One screened hunk: queue it, or drop it for a named reason. */
export interface ISegmentScreening {
	readonly hunk: ISegmentHunk;
	/** Absent when the hunk should be queued. */
	readonly drop?: SegmentDropReason;
}

/** What became of one mutating segment: a change id, or a named drop. Never a silent nothing. */
export interface ISegmentReceipt {
	readonly segmentIndex: number;
	/** The label the model wrote, so the receipt reads back in the model's own terms. */
	readonly label: string;
	/** Set when the segment became a reviewable change. */
	readonly changeId?: string;
	/** Set when it did not. Exactly one of `changeId` / `reason` is present. */
	readonly reason?: SegmentDropReason;
}

/**
 * The JSON schema the `propose_segments` tool declares for its segment list.
 *
 * Exported as data rather than inlined so the tool definition and this module's validator are written
 * against one description of the shape, and so a test can assert the surface the model is actually told
 * about. The HOST validator below is the enforcement: a provider that ignores or loosens the schema still
 * cannot get a malformed list past `parseSegments`.
 */
export const SEGMENT_LIST_SCHEMA = {
	type: 'array',
	description: 'The whole document as a list of segments, in document order. Every block must be accounted for exactly once by a keep or a replace.',
	items: {
		type: 'object',
		properties: {
			keep: { type: 'string', description: 'Keep these blocks exactly as they are: a label (B4) or a run (B1-B7). Use this for everything you are not changing.' },
			replace: { type: 'string', description: 'Replace these blocks: a label (B8) or a run (B8-B9). Requires echo and content.' },
			echo: { type: 'array', items: { type: 'string' }, description: 'On a replace only: the opening few words of EACH block in the range, in order, one entry per block. It is checked against the document, so an off-by-one range is rejected rather than applied.' },
			insertAfter: { type: 'string', description: 'Add new content after this block: a single label (B14). Requires content.' },
			content: { type: 'string', description: 'The Markdown that takes the place of a replace range, or that is inserted. An empty string on a replace deletes those blocks.' }
		}
	}
} as const;

const LABEL_RE = /^B(?<ordinal>\d+)$/;

function violation(kind: SegmentViolation, message: string, segmentIndex?: number): ISegmentViolation {
	return segmentIndex === undefined
		? { ok: false, violation: kind, message }
		: { ok: false, violation: kind, segmentIndex, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read one segment list off unparsed tool input.
 *
 * Strict on purpose, and strict in one place: a segment carrying two verbs, a label that is not a string, a
 * `replace` with no `echo` - all are rejected here with the segment's index, before a single offset is
 * computed. The alternative, tolerating the shape and guessing at the intent, is how "syntactically valid
 * but semantically wrong" becomes "applied to the wrong paragraph".
 */
export function parseSegments(input: unknown): SegmentParseResult {
	if (!Array.isArray(input) || !input.length) {
		return violation('not-a-list', 'segments must be a non-empty list covering the whole document: one entry per keep range, replace range or insertion.');
	}
	const segments: DocSegment[] = [];
	for (let index = 0; index < input.length; index++) {
		const raw = input[index];
		if (!isRecord(raw)) {
			return violation('malformed-segment', `Segment ${index + 1} is not an object. Each segment is one of {keep}, {replace, echo, content} or {insertAfter, content}.`, index);
		}
		const verbs = (['keep', 'replace', 'insertAfter'] as const).filter(verb => raw[verb] !== undefined);
		if (verbs.length !== 1) {
			return violation('malformed-segment', `Segment ${index + 1} must carry exactly one of keep, replace or insertAfter - it carried ${verbs.length === 0 ? 'none' : verbs.join(' and ')}.`, index);
		}
		const verb = verbs[0];
		const label = raw[verb];
		if (typeof label !== 'string' || !label.trim()) {
			return violation('malformed-segment', `Segment ${index + 1}'s ${verb} must be a block label like B4 or a range like B4-B9.`, index);
		}
		if (verb === 'keep') {
			segments.push({ keep: label.trim() });
			continue;
		}
		const content = raw.content;
		if (typeof content !== 'string') {
			return violation('malformed-segment', `Segment ${index + 1} (${verb} ${label.trim()}) needs a content string.`, index);
		}
		if (verb === 'insertAfter') {
			segments.push({ insertAfter: label.trim(), content });
			continue;
		}
		const echo = raw.echo;
		if (!Array.isArray(echo) || echo.some(entry => typeof entry !== 'string')) {
			return violation('malformed-segment', `Segment ${index + 1} (replace ${label.trim()}) needs echo: the opening few words of each block in the range, in order, as a list of strings.`, index);
		}
		segments.push({ replace: label.trim(), echo: echo.slice() as readonly string[], content });
	}
	return { ok: true, segments };
}

/** Narrow a segment to its verb without a cast at every use site. */
function isKeep(segment: DocSegment): segment is IKeepSegment {
	return (segment as IKeepSegment).keep !== undefined;
}
function isReplace(segment: DocSegment): segment is IReplaceSegment {
	return (segment as IReplaceSegment).replace !== undefined;
}

/**
 * The label a MUTATING segment carries, or `undefined` for a `keep` - which claims nothing and so receipts
 * nothing. Lives here, beside the `DocSegment` type it reads, so a caller (the tool executor) can name a
 * segment without re-implementing the narrowing with its own casts.
 */
export function segmentLabel(segment: DocSegment): string | undefined {
	if (isReplace(segment)) { return segment.replace; }
	return isKeep(segment) ? undefined : segment.insertAfter;
}

/**
 * Normalise a block's text and an echo of it to one comparable form: markdown leaders dropped, whitespace
 * collapsed, case folded. Both sides get the SAME treatment, so a heading echoed with or without its `#`
 * compares equal and a list item echoed with or without its bullet does too. This is deliberately the only
 * fuzziness in the whole module, and it is confined to a check that can only ever REJECT.
 */
function normaliseEcho(text: string): string {
	return text
		.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** A label's 0-based ordinal, or `undefined` when it is not a `B<n>` label at all. */
function ordinalOf(label: string): number | undefined {
	const match = LABEL_RE.exec(label.trim());
	if (!match?.groups) { return undefined; }
	const value = Number(match.groups.ordinal);
	return Number.isInteger(value) && value >= 1 ? value - 1 : undefined;
}

/** The first few words of a block, for naming it back to the model in an echo-mismatch message. */
function openingWords(text: string, words: number = 6): string {
	const parts = text.replace(/\s+/g, ' ').trim().split(' ');
	return parts.length <= words ? parts.join(' ') : `${parts.slice(0, words).join(' ')}...`;
}

interface IRange { readonly from: number; readonly to: number }

function parseRange(label: string, blocks: number, index: number): IRange | ISegmentViolation {
	const parts = label.split('-');
	const from = parts.length <= 2 ? ordinalOf(parts[0]) : undefined;
	const to = parts.length === 2 ? ordinalOf(parts[1]) : from;
	if (from === undefined || to === undefined) {
		return violation('bad-label', `Segment ${index + 1}: ${label} is not a block label. Use B4 for one block or B4-B9 for a run.`, index);
	}
	if (to < from) {
		return violation('bad-range', `Segment ${index + 1}: ${label} ends before it starts.`, index);
	}
	if (to >= blocks) {
		return violation('stale-ordinal', `Segment ${index + 1}: ${label} names a block this document does not have - it has ${blocks} block${blocks === 1 ? '' : 's'}, B1 to B${blocks}. Read the document again and work from the labels it gives you.`, index);
	}
	return { from, to };
}

function isViolation(value: IRange | ISegmentViolation): value is ISegmentViolation {
	return (value as ISegmentViolation).ok === false;
}

/**
 * Expand a segment list against a document body.
 *
 * Deterministic, total, and byte-exact on everything the list keeps: the result is composed by SPLICING the
 * mutating hunks into the base, so every byte outside a hunk - the kept blocks, the blank lines between
 * them, the CRLFs, the trailing newline - is copied from the base rather than re-emitted (invariant I6).
 *
 * `blockViews` is what the model actually READ, block for block, when that differs from the raw body: today
 * `read_document` resolves bind links to their live values, so the echo of a bound block would never match
 * the raw markup. Passing the resolved view keeps the off-by-one guard checking the model against what it
 * was shown; the hunks themselves are always measured against the raw body. When absent, or the wrong
 * length, the raw block text is used - a stricter check, never a looser one.
 */
export function expandSegments(baseBody: string, segments: readonly DocSegment[], options?: { readonly blockViews?: readonly string[] }): SegmentExpansionResult {
	const chunks = chunkDocBody(baseBody);
	if (!chunks.length) {
		return violation('stale-ordinal', 'This document has no blocks to change yet.');
	}
	const views = options?.blockViews?.length === chunks.length ? options.blockViews : undefined;
	const viewOf = (ordinal: number) => views ? views[ordinal] : chunks[ordinal].text;
	// The normalised text of every block, computed once, so the echo can be checked for UNIQUENESS and not
	// just for a prefix touch: an echo that fits two blocks proves nothing about which one the range means.
	const normViews = chunks.map((_chunk, ordinal) => normaliseEcho(viewOf(ordinal)));

	// Which segment claims each base block, so coverage and overlap are decided by counting rather than by
	// comparing ranges pairwise - and so the emission pass below can ask one array which fate a block has.
	const claim = new Array<number>(chunks.length).fill(-1);
	const ranges = new Map<number, IRange>();
	const inserts = new Map<number, { readonly segmentIndex: number; readonly content: string }>();

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (isKeep(segment) || isReplace(segment)) {
			const label = isKeep(segment) ? segment.keep : segment.replace;
			const range = parseRange(label, chunks.length, index);
			if (isViolation(range)) { return range; }
			for (let ordinal = range.from; ordinal <= range.to; ordinal++) {
				if (claim[ordinal] >= 0) {
					return violation('overlapping-range', `Segment ${index + 1} (${label}) claims B${ordinal + 1}, which segment ${claim[ordinal] + 1} already claimed. Each block belongs to exactly one keep or replace.`, index);
				}
				claim[ordinal] = index;
			}
			ranges.set(index, range);
			if (isReplace(segment)) {
				const echoed = checkEcho(segment, range, index, viewOf);
				if (echoed) { return echoed; }
			}
			continue;
		}
		const ordinal = ordinalOf(segment.insertAfter);
		if (ordinal === undefined) {
			return violation('bad-label', `Segment ${index + 1}: ${segment.insertAfter} is not a block label. insertAfter takes a single label like B14.`, index);
		}
		if (ordinal >= chunks.length) {
			return violation('stale-ordinal', `Segment ${index + 1}: ${segment.insertAfter} names a block this document does not have - it has ${chunks.length} block${chunks.length === 1 ? '' : 's'}, B1 to B${chunks.length}.`, index);
		}
		if (!segment.content.trim()) {
			return violation('empty-content', `Segment ${index + 1} (insertAfter ${segment.insertAfter}) has nothing to insert.`, index);
		}
		const already = inserts.get(ordinal);
		if (already) {
			return violation('overlapping-range', `Segment ${index + 1} inserts after ${segment.insertAfter}, and so does segment ${already.segmentIndex + 1}. Put both pieces in one insertAfter so their order is yours to decide, not the host's.`, index);
		}
		inserts.set(ordinal, { segmentIndex: index, content: segment.content });
	}

	for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
		if (claim[ordinal] < 0) {
			return violation('uncovered-block', `B${ordinal + 1} is not accounted for. Every block must appear in exactly one keep or replace - list the whole document, in order, from B1 to B${chunks.length}.`);
		}
	}
	// An insertion inside a replace range has no position to be at: the blocks around it are on their way
	// out. Only the LAST block of a run has a settled edge to insert after.
	for (const [ordinal, insert] of inserts) {
		const range = ranges.get(claim[ordinal])!;
		if (ordinal !== range.to) {
			return violation('overlapping-range', `Segment ${insert.segmentIndex + 1} inserts after B${ordinal + 1}, which is in the middle of the range segment ${claim[ordinal] + 1} claims. Insert after the last block of that range instead, or put the new text in its content.`, insert.segmentIndex);
		}
	}

	// The echo must DISAMBIGUATE, not merely touch (issue #381 cycle 2). Run after the structural checks so a
	// list that is also malformed some other way reports that first. It guards SURVIVORS only: a block that is
	// itself being replaced is on its way out, so it is no target to be misapplied onto and must not count as
	// an ambiguity candidate (issue #381 cycle 3). Without this, an ordinary "rewrite this section" - a heading
	// and the body it opens, in one range - is impossible, because the heading's whole text is a prefix of its
	// body and no echo of it could ever be unique.
	const isReplaced = new Array<boolean>(chunks.length).fill(false);
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (!isReplace(segment)) { continue; }
		const range = ranges.get(index)!;
		for (let ordinal = range.from; ordinal <= range.to; ordinal++) { isReplaced[ordinal] = true; }
	}
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (!isReplace(segment)) { continue; }
		const ambiguous = checkEchoUnique(segment, ranges.get(index)!, index, normViews, isReplaced);
		if (ambiguous) { return ambiguous; }
	}

	// The same off-by-one class, for insertions (issue #420). `insertAfter B7` names a block by ordinal alone;
	// if another SURVIVING block is word-for-word the same, "after B7" does not say which of them, and the new
	// content would land in a section the model may not have meant - silently, since an insert has no echo to
	// check. Reject loudly instead. Only byte-identical survivors are ambiguous here: a block a mere prefix
	// apart is still distinguishable by its own full text, and rejecting those would refuse the ordinary
	// insert-after-a-heading whose text opens the paragraph below it.
	for (const [ordinal, insert] of inserts) {
		for (let other = 0; other < normViews.length; other++) {
			if (other === ordinal || isReplaced[other] || normViews[other] !== normViews[ordinal]) { continue; }
			return violation('ambiguous-echo', `Segment ${insert.segmentIndex + 1} (insertAfter B${ordinal + 1}): B${ordinal + 1} and B${other + 1} are word for word the same, so "after B${ordinal + 1}" does not say which one you mean and nothing was inserted. Only the person can say which section they mean.`, insert.segmentIndex);
		}
	}

	const paragraphBreak = baseBody.includes('\r\n') ? '\r\n\r\n' : '\n\n';
	const hunks: ISegmentHunk[] = [];
	let keptBlocks = 0;

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (isKeep(segment)) {
			const range = ranges.get(index)!;
			keptBlocks += range.to - range.from + 1;
			continue;
		}
		if (isReplace(segment)) {
			const range = ranges.get(index)!;
			if (segment.content.trim()) {
				const span = { start: chunks[range.from].start, end: chunks[range.to].end };
				hunks.push({ segmentIndex: index, op: 'replace', label: segment.replace, blockOrdinal: range.from, span, oldText: baseBody.slice(span.start, span.end), newText: segment.content });
				continue;
			}
			// A deletion takes one of its neighbouring separators with it, so removing a paragraph does not
			// leave behind the blank line it used to sit under. Preferring the one BEFORE keeps the document's
			// trailing newline exactly where it was; the first block has no such neighbour, so it takes the one
			// after instead.
			const span = range.from > 0
				? { start: chunks[range.from - 1].end, end: chunks[range.to].end }
				: { start: chunks[0].start, end: chunks[range.to + 1]?.start ?? chunks[range.to].end };
			hunks.push({ segmentIndex: index, op: 'delete', label: segment.replace, blockOrdinal: range.from, span, oldText: baseBody.slice(span.start, span.end), newText: '' });
			continue;
		}
		const ordinal = ordinalOf(segment.insertAfter)!;
		const at = chunks[ordinal].end;
		hunks.push({ segmentIndex: index, op: 'insert', label: segment.insertAfter, blockOrdinal: ordinal, span: { start: at, end: at }, oldText: '', newText: `${paragraphBreak}${segment.content.trim()}` });
	}

	hunks.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
	const collision = firstCollision(hunks);
	if (collision) { return collision; }
	const spliced = spliceDoc(baseBody, hunks);
	if (!spliced.ok) {
		// Unreachable: every span above is measured off the base this call was given. Named rather than
		// thrown, because a byte-exactness claim that cannot fail loudly is not a claim at all.
		return violation('expansion-mismatch', 'The expansion could not be composed against this document, so nothing was changed.');
	}
	return { ok: true, body: spliced.text, hunks, keptBlocks };
}

/**
 * The last structural check: the composed hunks must be separable, so that ANY SUBSET of them splices
 * correctly and independently. Abutting is fine - a replace that ends exactly where the next one begins
 * splices cleanly either way round - but two hunks that overlap, or that begin at the very same offset, have
 * no unambiguous order, and a store that later approves one of them would be splicing against a base that
 * says something different from what the reviewer read.
 *
 * Only two emissions can reach here: a deletion that reaches back over the blank line above it while a
 * neighbouring deletion reaches forward over the same one, and an insertion positioned exactly where a
 * following deletion starts. Both say the same thing twice, and both are expressible unambiguously as one
 * range - which is what the message asks for.
 */
function firstCollision(hunks: readonly ISegmentHunk[]): ISegmentViolation | undefined {
	for (let i = 1; i < hunks.length; i++) {
		const previous = hunks[i - 1];
		const current = hunks[i];
		if (previous.span.end <= current.span.start && previous.span.start !== current.span.start) { continue; }
		return violation('overlapping-range', `Segments ${previous.segmentIndex + 1} (${previous.label}) and ${current.segmentIndex + 1} (${current.label}) both change the same part of the document, so their order is not decidable. Put neighbouring deletions and insertions in ONE replace range with the text you want left behind as its content.`, current.segmentIndex);
	}
	return undefined;
}

/**
 * The off-by-one guard (doc 30 section 2.1): every block a `replace` claims must actually start with the
 * words the model echoed for it. A range that is one block out is syntactically perfect and semantically
 * wrong, so nothing else in this module could catch it - which is exactly why the echo exists.
 */
function checkEcho(segment: IReplaceSegment, range: IRange, index: number, viewOf: (ordinal: number) => string): ISegmentViolation | undefined {
	const wanted = range.to - range.from + 1;
	if (segment.echo.length !== wanted) {
		return violation('echo-mismatch', `Segment ${index + 1} (replace ${segment.replace}) covers ${wanted} block${wanted === 1 ? '' : 's'} but echoed ${segment.echo.length}. Echo the opening words of every block in the range, in order.`, index);
	}
	for (let offset = 0; offset < wanted; offset++) {
		const echo = normaliseEcho(segment.echo[offset]);
		const ordinal = range.from + offset;
		if (!echo) {
			return violation('echo-mismatch', `Segment ${index + 1} (replace ${segment.replace}): the echo for B${ordinal + 1} is empty. Echo the opening words of the block you are replacing.`, index);
		}
		if (!normaliseEcho(viewOf(ordinal)).startsWith(echo)) {
			return violation('echo-mismatch', `Segment ${index + 1} (replace ${segment.replace}): B${ordinal + 1} does not start with "${segment.echo[offset].trim()}" - it starts with "${openingWords(viewOf(ordinal))}". Your range is off, so nothing was changed. Read the document again and use the labels it gives you.`, index);
		}
	}
	return undefined;
}

/**
 * The DISAMBIGUATION half of the echo guard (issue #381 cycle 2). {@link checkEcho} proves the echo fits the
 * NAMED block; this proves it fits ONLY that block. A `startsWith` on a few normalised words is satisfied by
 * any sibling that opens the same way - two `## Notes` headings, two paragraphs that both begin "We charge",
 * a `## Summary` heading whose text also opens the paragraph beneath it - so without this an off-by-one range
 * passes the basic check and lands on a block the model may not have meant. That is the #300/#303/#329 defect
 * family, and it is why the whole list is rejected here rather than one of the candidates silently chosen.
 *
 * Two shapes of ambiguity, and the model is told which. When another block is word-for-word identical no echo
 * can ever tell them apart, so the model is asked to defer to the person. Otherwise the echo was simply too
 * short, and the model is asked to echo enough of the block to be unique.
 *
 * `isReplaced` marks every block claimed by a replace segment. Such blocks are excluded from the scan: they
 * are all changing, so confusing one for another cannot leave a survivor wrongly clobbered - and requiring an
 * echo to distinguish two blocks that are both on their way out is a demand that is often impossible to meet
 * (issue #381 cycle 3). Only a surviving block - a keep - can be a wrong target worth protecting.
 */
function checkEchoUnique(segment: IReplaceSegment, range: IRange, index: number, normViews: readonly string[], isReplaced: readonly boolean[]): ISegmentViolation | undefined {
	for (let offset = 0; offset < segment.echo.length; offset++) {
		const ordinal = range.from + offset;
		const echo = normaliseEcho(segment.echo[offset]);
		let twin = -1;
		let sharesPrefix = -1;
		for (let other = 0; other < normViews.length; other++) {
			if (other === ordinal || isReplaced[other] || !normViews[other].startsWith(echo)) { continue; }
			if (normViews[other] === normViews[ordinal]) { twin = other; } else if (sharesPrefix < 0) { sharesPrefix = other; }
		}
		if (twin >= 0) {
			return violation('ambiguous-echo', `Segment ${index + 1} (replace ${segment.replace}): B${ordinal + 1} and B${twin + 1} are word for word the same, so no echo can tell them apart and nothing was changed. Only the person can say which one they mean.`, index);
		}
		if (sharesPrefix >= 0) {
			return violation('ambiguous-echo', `Segment ${index + 1} (replace ${segment.replace}): the echo "${segment.echo[offset].trim()}" fits B${ordinal + 1} and B${sharesPrefix + 1} both, so it does not say which block you mean and nothing was changed. Echo enough of B${ordinal + 1} to tell it apart from every other block.`, index);
		}
	}
	return undefined;
}

/** The bind keys in a piece of markup, sorted, so two multisets can be compared element for element. */
function bindKeys(text: string): readonly string[] {
	return extractBindLinks(text).map(link => link.key).sort();
}

/** Whether two sorted bind-key multisets hold exactly the same keys. */
function sameBindKeys(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Screen expanded hunks for the two refusals that are properties of the hunk itself rather than of the run.
 *
 * `bind-guard`: the base hunk's bind-key multiset must survive into the replacement with well-formed markup
 * (doc 30 section 2.1). Today `read_document` shows the model resolved values rather than `[..](bind:key)`
 * markup, so a rewrite of a bound paragraph necessarily loses the link - and losing it silently would break
 * the live figure the whole binding feature exists to guarantee. The hunk is dropped, by name, into the
 * receipt the person reads.
 *
 * `no-op`: the replacement is what is already there. Queuing it would put a card in the review rail with
 * nothing on either side of the diff.
 *
 * A DELETION of a bound block is bind-guarded too, and deliberately: an empty replacement carries none of
 * the base's keys, so doc 30 section 2.1's rule ("survive or the hunk is dropped") drops it rather than let
 * a live figure be removed without a signal beyond a plain deletion. Loosening that to an explicit
 * "delete including its figure" is a policy decision for a later tranche, not something to infer here.
 */
export function screenSegmentHunks(hunks: readonly ISegmentHunk[]): readonly ISegmentScreening[] {
	return hunks.map(hunk => {
		if (hunk.oldText === hunk.newText || (hunk.op === 'replace' && hunk.oldText.trim() === hunk.newText.trim())) {
			return { hunk, drop: 'no-op' as const };
		}
		const before = bindKeys(hunk.oldText);
		if (before.length && !sameBindKeys(before, bindKeys(hunk.newText))) {
			return { hunk, drop: 'bind-guard' as const };
		}
		return { hunk };
	});
}

/**
 * The plain-words clause for one drop, for the ledger the person reads (no leading capital, no full stop).
 * It says what happened to the DOCUMENT rather than what the machine refused, because the reader's question
 * is always "why is that not in my review rail".
 */
export function describeSegmentDrop(reason: SegmentDropReason): string {
	switch (reason) {
		case 'policy':
			return localize('livingDocs.segments.drop.policy', "the document is set never to change");
		case 'out-of-scope':
			return localize('livingDocs.segments.drop.outOfScope', "the document was not one of the ones you attached");
		case 'bind-guard':
			return localize('livingDocs.segments.drop.bindGuard', "it would have replaced a live figure with plain text");
		case 'stale-ordinal':
			return localize('livingDocs.segments.drop.staleOrdinal', "the part of the document it named had moved on");
		case 'no-op':
			return localize('livingDocs.segments.drop.noOp', "it would have changed nothing");
		case 'not-recorded':
			return localize('livingDocs.segments.drop.notRecorded', "it could not be saved to your review queue");
	}
}

// Reported in a fixed order rather than first-seen order, so the same shortfall always reads the same way.
const DROP_ORDER: readonly SegmentDropReason[] = ['policy', 'out-of-scope', 'bind-guard', 'stale-ordinal', 'no-op', 'not-recorded'];

/**
 * The one-line summary of what a set of receipts did, for the run ledger - invariant I3's input, and exactly
 * what issue #382 will reconcile the model's `finish` narration against. Every drop reason present is named;
 * a count is never reported without the reasons behind it.
 */
export function summariseSegmentReceipts(receipts: readonly ISegmentReceipt[]): string {
	const queued = receipts.filter(receipt => receipt.changeId !== undefined).length;
	const dropped = receipts.filter(receipt => receipt.reason !== undefined);
	const parts: string[] = [];
	if (queued) {
		parts.push(queued === 1
			? localize('livingDocs.segments.queued.one', "1 change is waiting for your review")
			: localize('livingDocs.segments.queued.many', "{0} changes are waiting for your review", queued));
	}
	if (dropped.length) {
		const counts = new Map<SegmentDropReason, number>();
		for (const receipt of dropped) { counts.set(receipt.reason!, (counts.get(receipt.reason!) ?? 0) + 1); }
		const reasons = DROP_ORDER.filter(reason => counts.has(reason))
			.map(reason => localize('livingDocs.segments.dropCount', "{0} because {1}", counts.get(reason)!, describeSegmentDrop(reason)))
			.join(', ');
		parts.push(dropped.length === 1
			? localize('livingDocs.segments.dropped.one', "1 was not made: {0}", reasons)
			: localize('livingDocs.segments.dropped.many', "{0} were not made: {1}", dropped.length, reasons));
	}
	return parts.join('. ');
}
