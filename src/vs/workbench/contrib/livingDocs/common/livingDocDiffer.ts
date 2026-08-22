/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeClass, deriveChangeClass, ISplicePlacement, spliceDoc } from './changeRecord.js';
import { chunkDocBody, IBodyChunk, jaccardOfTokens, similarityTokens } from './livingDocMarkdown.js';
import { IPmDiffSegment, wordDiffSegments } from './livingDocPmDecorations.js';

// The local differ (docs/30 section 2.1, stage 1): ONE deterministic block-granularity alignment from
// (baseBody, proposedBody), compiled into the hunks the change store persists.
//
// This is the module that ends the three-matchers era. Today an edit's target is resolved by string
// matching three separate times - queue-time fuzzy similarity, apply-time `indexOf`, render-time text
// equality - each failing differently and silently (the #303 / #329 / #300 defect families). Here the
// alignment is computed ONCE, against the base text, and everything downstream reads offsets off it.
//
// THE CONTRACT, and the reason this file is worth its length: `spliceDoc(base, diff.hunks)` reproduces
// `proposed` BYTE-EXACTLY, always - every base character, every blank line, every CRLF, every trailing
// newline. That is invariant I6's foundation, and it is obtained BY CONSTRUCTION rather than by checking
// afterwards: the base is partitioned into consecutive regions, and each region is either byte-identical
// to its proposed counterpart (no hunk) or replaced by that counterpart (one hunk, narrowed to the lines
// that actually differ). There is no third case, so there is nowhere for a character to go missing. The
// result is verified once before it is returned anyway, and a failure degrades to a whole-body rewrite
// rather than to a plausible-looking wrong answer (see `wholeBodyFallback`).
//
// A second property falls out of the same construction and matters just as much for review: the hunks are
// DISJOINT and ascending, so ANY SUBSET of them splices correctly too. Approving three of seven hunks is
// arithmetic, not a re-diff.
//
// FRONTMATTER IS NOT VISIBLE HERE. The differ takes body text and emits body-relative spans - the same
// coordinate space `IChangeAnchor.baseRevision` hashes. The caller strips frontmatter before calling and
// re-attaches it with `withReplacedBody` (`livingDocMarkdown.ts`), which quarantines the live serialiser
// data-loss bug: frontmatter fields the parser reads (including `fromTemplate`) can never be dropped by a
// path that never sees them.
//
// Pure: no DOM, no service, no file system, no clock, no randomness. Same inputs, same output, forever.

/**
 * The block kinds the ALIGNMENT distinguishes. Deliberately richer than the document model's
 * `LivingDocBlockType` (`heading | paragraph | table`), because pairing needs to know that a fenced code
 * block is not a paragraph and that a list is not free prose - while the model's type drives rendering and
 * is not this module's to widen.
 */
export type DiffBlockKind = 'heading' | 'list' | 'table' | 'code' | 'paragraph';

/** How the alignment arrived at a hunk. Provenance for the reviewer, never a control signal. */
export type DiffPairing =
	/** A 1:1 block pair whose content changed. */
	| 'modified'
	/** One base block became two proposed blocks. */
	| 'split'
	/** Two base blocks became one proposed block. */
	| 'merge'
	/** Proposed blocks with no base counterpart. */
	| 'insert'
	/** Base blocks with no proposed counterpart. */
	| 'delete'
	/** An unpaired run on BOTH sides - too dissimilar to pair - or two adjacent hunks folded into one. */
	| 'substitute'
	/** Only the whitespace between blocks moved (a blank line added or removed). */
	| 'seam'
	/** The whole-body degradation. See {@link IAlignmentStats.wholeBodyFallback}. */
	| 'whole';

/** What a hunk does to the base text, derived from its own texts so the two can never disagree. */
export type DiffHunkOp = 'replace' | 'insert' | 'delete';

/** The base and proposed block ordinals (0-based, in chunk order) a hunk covers. */
export interface IDiffBlockOrdinals {
	readonly base: readonly number[];
	readonly proposed: readonly number[];
}

/**
 * One hunk: a half-open span of the BASE BODY, the exact text sitting there, and the text that replaces it.
 *
 * It extends {@link ISplicePlacement} on purpose - that is the store's anchor shape minus the document
 * identity, so persisting a hunk is `{docUri, baseRevision, ...hunk}` and nothing is translated on the way.
 */
export interface IDocDiffHunk extends ISplicePlacement {
	readonly op: DiffHunkOp;
	readonly pairing: DiffPairing;
	/**
	 * The word-grain diff of `oldText` -> `newText`, from the shipped `wordDiffSegments`. DISPLAY grain, not
	 * splice grain: it splits on whitespace and rejoins with single spaces, so it does not round-trip. The
	 * splice always reads `oldText`/`newText`.
	 */
	readonly segments: readonly IPmDiffSegment[];
	readonly blockOrdinals: IDiffBlockOrdinals;
}

/** What the alignment saw. `changeClass` is derived from this; the reviewer's header sentence reads off it. */
export interface IAlignmentStats {
	readonly baseBlocks: number;
	readonly proposedBlocks: number;
	/** Base blocks pinned by the unique-content anchor pass. */
	readonly anchoredBlocks: number;
	/** Base blocks the alignment carried through byte-identically - the blocks a reviewer never sees. */
	readonly unchangedBlocks: number;
	/** Base blocks paired to a CHANGED counterpart, including the base side of a split or merge. */
	readonly pairedBlocks: number;
	/** Base blocks that changed at all (paired-and-different, substituted, or deleted). */
	readonly changedBlocks: number;
	readonly insertedBlocks: number;
	readonly deletedBlocks: number;
	/**
	 * The changed-character count the class is derived from: per hunk, `max(span width, newText length)`.
	 * Identical to what {@link deriveChangeClass} counts, so the ratio shown and the class decided can never
	 * come apart.
	 */
	readonly changedChars: number;
	readonly baseChars: number;
	/** `changedChars / max(baseChars, 1)`. At or above 0.6 the class is `rewrite` (docs/30 section 2.1). */
	readonly changedRatio: number;
	/**
	 * True when the alignment was discarded and the whole body emitted as one hunk. Two causes, both named
	 * rather than silent: the base and proposed bodies share no structure worth aligning at the guarded
	 * size (see `MAX_ALIGNMENT_CELLS`), or - the case that must never happen - the composed hunks failed
	 * their own splice check, in which case the correct whole-body rewrite is emitted instead of a
	 * plausible-looking wrong answer.
	 */
	readonly wholeBodyFallback: boolean;
}

/** One deterministic alignment of a document body, compiled. */
export interface IDocDiff {
	/** Disjoint and ascending by `span.start`. Any subset splices correctly. */
	readonly hunks: readonly IDocDiffHunk[];
	readonly stats: IAlignmentStats;
	readonly changeClass: ChangeClass;
}

/**
 * The minimum Jaccard token overlap at which two blocks of the same kind are read as the same block,
 * modified. Below it they are a deletion and an insertion, which is the honest reading: nothing about the
 * text says they are related. Deliberately low - the anchor pass has already pinned everything identical,
 * so this only ever runs between anchors, where the candidate set is small and the prior is strong.
 */
const PAIR_MIN_SIMILARITY = 0.34;

/**
 * The minimum overlap at which one block is read as having SPLIT into two (or two as having MERGED into
 * one). Higher than the pairing bar because the claim is stronger: it asserts that the concatenation is
 * substantially the same prose, not merely a related neighbour.
 */
const SPLIT_MIN_SIMILARITY = 0.5;

/**
 * The most base-block x proposed-block cells the gap aligner will fill. Past it the gap is emitted as one
 * substitution: a document with hundreds of unanchored blocks on both sides has been rewritten, and paying
 * quadratic time to discover that is worse than saying it. A bound, not a heuristic.
 */
const MAX_ALIGNMENT_CELLS = 250_000;

/**
 * The most old-word x new-word cells the word-grain diff will fill. `wordDiffSegments` allocates a full LCS
 * matrix, so an unbounded call on a whole-document rewrite is an out-of-memory bug waiting for a big enough
 * document. Past the bound the hunk carries a single WAS/NOW pair instead - which is exactly what the
 * review surface renders past the ~60% threshold anyway (docs/30 requirement 4).
 */
const MAX_WORD_DIFF_CELLS = 1_000_000;

const HEADING_RE = /^#{1,6}\s+/;
const LIST_MARKER_RE = /^\s*([-*+]|\d+[.)])\s+/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HIGH_SURROGATE_START = 0xD800;
const HIGH_SURROGATE_END = 0xDBFF;

/** A chunk plus everything the alignment needs to reason about it. */
interface IDiffBlock extends IBodyChunk {
	readonly ordinal: number;
	readonly kind: DiffBlockKind;
}

/** One alignment decision: these base blocks correspond to these proposed blocks. Monotone in both. */
interface IAlignmentMatch {
	readonly base: readonly number[];
	readonly proposed: readonly number[];
	readonly pairing: DiffPairing;
}

/**
 * The alignment kind of a block. Only ever used to decide what may pair with what, so it stays coarse: the
 * question is "could these plausibly be the same block, edited", not "how does this render".
 */
function classifyDiffBlock(text: string): DiffBlockKind {
	const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
	if (FENCE_RE.test(lines[0])) { return 'code'; }
	const filled = lines.filter(l => l.trim().length > 0);
	if (filled.length === 1 && HEADING_RE.test(filled[0])) { return 'heading'; }
	if (filled.length > 0 && filled.every(l => l.trim().startsWith('|'))) { return 'table'; }
	if (filled.length > 0 && LIST_MARKER_RE.test(filled[0])) { return 'list'; }
	return 'paragraph';
}

function toDiffBlocks(body: string): IDiffBlock[] {
	return chunkDocBody(body).map((chunk, ordinal) => ({ ...chunk, ordinal, kind: classifyDiffBlock(chunk.text) }));
}

/**
 * The indices of the longest strictly increasing subsequence of `values`. Used to drop crossing anchors:
 * anchors are collected in base order, so keeping the longest increasing run of PROPOSED indices is exactly
 * "keep the largest set of anchors that do not cross". Patience sorting, so the choice is deterministic.
 */
function longestIncreasingSubsequence(values: readonly number[]): number[] {
	const tails: number[] = [];
	const parent: number[] = new Array<number>(values.length).fill(-1);
	for (let i = 0; i < values.length; i++) {
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (values[tails[mid]] < values[i]) { lo = mid + 1; } else { hi = mid; }
		}
		if (lo > 0) { parent[i] = tails[lo - 1]; }
		tails[lo] = i;
	}
	const out: number[] = [];
	let k = tails.length > 0 ? tails[tails.length - 1] : -1;
	while (k >= 0) { out.push(k); k = parent[k]; }
	return out.reverse();
}

/**
 * Pass 1: the unique-content anchor pass. A block whose exact text occurs EXACTLY ONCE on each side pins
 * the alignment there. Uniqueness is the whole point - it is what stops two identical `## Notes` sections
 * from cross-pairing, because neither is unique and so neither anchors. Crossing anchors are then dropped
 * by keeping the longest non-crossing run, which keeps the alignment monotone (a moved block is a delete
 * plus an insert, never a reorder the splice would have to unpick).
 */
function findAnchors(base: readonly IDiffBlock[], proposed: readonly IDiffBlock[]): { base: number; proposed: number }[] {
	const count = (blocks: readonly IDiffBlock[]) => {
		const seen = new Map<string, number[]>();
		for (const block of blocks) {
			const at = seen.get(block.text);
			if (at) { at.push(block.ordinal); } else { seen.set(block.text, [block.ordinal]); }
		}
		return seen;
	};
	const inBase = count(base);
	const inProposed = count(proposed);
	const candidates: { base: number; proposed: number }[] = [];
	for (const [text, baseAt] of inBase) {
		const proposedAt = inProposed.get(text);
		if (baseAt.length === 1 && proposedAt && proposedAt.length === 1) {
			candidates.push({ base: baseAt[0], proposed: proposedAt[0] });
		}
	}
	candidates.sort((a, b) => a.base - b.base);
	return longestIncreasingSubsequence(candidates.map(c => c.proposed)).map(i => candidates[i]);
}

/** The similarity of a run of blocks read as one piece of prose. */
function runText(blocks: readonly IDiffBlock[], from: number, to: number): string {
	const parts: string[] = [];
	for (let i = from; i < to; i++) { parts.push(blocks[i].text); }
	return parts.join('\n\n');
}

/**
 * Passes 2 and 3, run as one optimal decision rather than two greedy ones: inside a gap between anchors,
 * find the monotone alignment maximising total similarity, where a step may pair 1:1 (modified), 1:2
 * (split), 2:1 (merge), or skip a block on either side (insert / delete).
 *
 * Running them together rather than in sequence matters: a paragraph that split into two scores 1.0 as a
 * split and about 0.5 as a 1:1 pair against its better half, so a greedy 1:1 pass would take the 0.5 and
 * leave the other half looking like an unrelated insertion. The DP simply prefers the better reading.
 *
 * Ties are broken by a fixed preference order (pair, split, merge, skip base, skip proposed) so the same
 * inputs always produce the same alignment.
 */
function alignGap(base: readonly IDiffBlock[], proposed: readonly IDiffBlock[], b0: number, b1: number, p0: number, p1: number): IAlignmentMatch[] {
	const n = b1 - b0;
	const m = p1 - p0;
	if (n === 0 || m === 0) { return []; }
	if (n * m > MAX_ALIGNMENT_CELLS) { return []; }

	// A gap holding exactly one block on each side of the same kind is unambiguous: whatever the token
	// overlap says, the reviewer is looking at one block that became another. This is what makes a heading
	// rename read as a rename ("## Risks" -> "## Open questions" shares no tokens at all) rather than as a
	// heading vanishing and an unrelated one appearing.
	if (n === 1 && m === 1 && base[b0].kind === proposed[p0].kind) {
		return [{ base: [base[b0].ordinal], proposed: [proposed[p0].ordinal], pairing: 'modified' }];
	}

	// Tokenise each block ONCE. The table below asks for a pair score in up to three ways per cell and reads
	// `canPair` on top of that, so tokenising inside the comparison re-scans the same prose O(n*m) times -
	// close to a second of blocking work at the cell cap, and this alignment now runs on the approve path
	// (the invariant I6 post-check) where a person is waiting. Hoisting the scan out is a contained fix: the
	// scores are identical, only the number of times each block is read changes.
	const blockTokens = new Map<IDiffBlock, ReadonlySet<string>>();
	const tokensOf = (block: IDiffBlock) => {
		let tokens = blockTokens.get(block);
		if (!tokens) { tokens = similarityTokens(block.text); blockTokens.set(block, tokens); }
		return tokens;
	};
	// Run token sets (a block plus its successor, read as one piece of prose) are memoised on their first
	// index, which is what the split/merge steps ask for and nothing else needs.
	const runTokens = new Map<string, ReadonlySet<string>>();
	const runTokensOf = (blocks: readonly IDiffBlock[], from: number, key: string) => {
		let tokens = runTokens.get(key);
		if (!tokens) { tokens = similarityTokens(runText(blocks, from, from + 2)); runTokens.set(key, tokens); }
		return tokens;
	};

	const canPair = (i: number, j: number) =>
		base[i].kind === proposed[j].kind && jaccardOfTokens(tokensOf(base[i]), tokensOf(proposed[j])) >= PAIR_MIN_SIMILARITY;
	const pairScore = (i: number, j: number) => jaccardOfTokens(tokensOf(base[i]), tokensOf(proposed[j]));
	const splitScore = (i: number, j: number) => jaccardOfTokens(tokensOf(base[i]), runTokensOf(proposed, j, `p${j}`));
	const mergeScore = (i: number, j: number) => jaccardOfTokens(runTokensOf(base, i, `b${i}`), tokensOf(proposed[j]));
	const splitKindsOk = (i: number, j: number) => base[i].kind === proposed[j].kind && base[i].kind === proposed[j + 1].kind;
	const mergeKindsOk = (i: number, j: number) => base[i].kind === proposed[j].kind && base[i + 1].kind === proposed[j].kind;

	// dp[i][j] = the best total score for aligning base[b0+i..b1) with proposed[p0+j..p1).
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	type Step = 'pair' | 'split' | 'merge' | 'skipBase' | 'skipProposed';
	const step: Step[][] = Array.from({ length: n + 1 }, () => new Array<Step>(m + 1).fill('skipBase'));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const bi = b0 + i;
			const pj = p0 + j;
			let best = dp[i + 1][j];
			let chosen: Step = 'skipBase';
			const consider = (score: number, candidate: Step) => {
				if (score > best) { best = score; chosen = candidate; }
			};
			// Preference order on a tie: a pairing reading beats a structural one, which beats dropping a
			// block. `consider` only replaces on a STRICT improvement, so the first candidate offered wins.
			if (canPair(bi, pj)) { consider(pairScore(bi, pj) + dp[i + 1][j + 1], 'pair'); }
			if (j + 1 < m && splitKindsOk(bi, pj) && splitScore(bi, pj) >= SPLIT_MIN_SIMILARITY) {
				consider(splitScore(bi, pj) + dp[i + 1][j + 2], 'split');
			}
			if (i + 1 < n && mergeKindsOk(bi, pj) && mergeScore(bi, pj) >= SPLIT_MIN_SIMILARITY) {
				consider(mergeScore(bi, pj) + dp[i + 2][j + 1], 'merge');
			}
			consider(dp[i][j + 1], 'skipProposed');
			dp[i][j] = best;
			step[i][j] = chosen;
		}
	}

	const matches: IAlignmentMatch[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		switch (step[i][j]) {
			case 'pair':
				matches.push({ base: [base[b0 + i].ordinal], proposed: [proposed[p0 + j].ordinal], pairing: 'modified' });
				i++; j++;
				break;
			case 'split':
				matches.push({ base: [base[b0 + i].ordinal], proposed: [proposed[p0 + j].ordinal, proposed[p0 + j + 1].ordinal], pairing: 'split' });
				i++; j += 2;
				break;
			case 'merge':
				matches.push({ base: [base[b0 + i].ordinal, base[b0 + i + 1].ordinal], proposed: [proposed[p0 + j].ordinal], pairing: 'merge' });
				i += 2; j++;
				break;
			case 'skipProposed':
				j++;
				break;
			default:
				i++;
				break;
		}
	}
	return matches;
}

/** The full alignment: anchors first, then the gaps between them (and the runs before the first / after the last). */
function align(base: readonly IDiffBlock[], proposed: readonly IDiffBlock[]): { matches: IAlignmentMatch[]; anchors: number } {
	const anchors = findAnchors(base, proposed);
	const matches: IAlignmentMatch[] = [];
	let b = 0;
	let p = 0;
	for (const anchor of anchors) {
		matches.push(...alignGap(base, proposed, b, anchor.base, p, anchor.proposed));
		matches.push({ base: [anchor.base], proposed: [anchor.proposed], pairing: 'modified' });
		b = anchor.base + 1;
		p = anchor.proposed + 1;
	}
	matches.push(...alignGap(base, proposed, b, base.length, p, proposed.length));
	return { matches, anchors: anchors.length };
}

/**
 * Narrow a region to the part that actually differs, cutting only on LINE boundaries. This is what turns a
 * "the gap between these two blocks changed" region into a recognisable insertion (empty `oldText`) or
 * deletion (empty `newText`) instead of a replacement that quietly restates the blank lines around it.
 *
 * Line-aligned on purpose. Trimming to the last common CHARACTER would tighten "the cat sat" -> "the dog
 * sat" to "c" -> "d", which is a worse anchor and an unreadable diff, and could cut between the halves of a
 * surrogate pair. Cutting at newlines can do neither.
 */
function trimToChangedLines(oldText: string, newText: string): { readonly prefix: number; readonly suffix: number } {
	const limit = Math.min(oldText.length, newText.length);
	let prefix = 0;
	while (prefix < limit && oldText[prefix] === newText[prefix]) { prefix++; }
	// Guarded: `lastIndexOf` CLAMPS a negative `fromIndex` to 0 and can therefore report a match at index 0
	// for an empty common prefix, which would trim a line that the two texts do not share at all.
	if (prefix > 0) {
		const lastNewline = oldText.lastIndexOf('\n', prefix - 1);
		prefix = lastNewline < 0 ? 0 : lastNewline + 1;
	}

	let suffix = 0;
	const room = limit - prefix;
	while (suffix < room && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) { suffix++; }
	// Back the suffix off to a line start. The start of the string counts as one, which is what lets a change
	// that only ADDS a prefix ("Done." -> "New.\n\nDone.") read as an insertion rather than a replacement.
	while (suffix > 0 && suffix < oldText.length && oldText[oldText.length - suffix - 1] !== '\n') { suffix--; }
	return { prefix, suffix };
}

/** True when `index` sits between the two halves of a surrogate pair in `text`. */
function splitsSurrogatePair(text: string, index: number): boolean {
	if (index <= 0 || index >= text.length) { return false; }
	const before = text.charCodeAt(index - 1);
	return before >= HIGH_SURROGATE_START && before <= HIGH_SURROGATE_END;
}

/** The word-grain segments for a hunk, bounded so a whole-document rewrite cannot allocate its way to death. */
function segmentsFor(oldText: string, newText: string): IPmDiffSegment[] {
	const oldWords = oldText.split(/\s+/).filter(Boolean).length;
	const newWords = newText.split(/\s+/).filter(Boolean).length;
	if (oldWords * newWords > MAX_WORD_DIFF_CELLS) {
		const segments: IPmDiffSegment[] = [];
		if (oldText.length > 0) { segments.push({ t: 'del', text: oldText }); }
		if (newText.length > 0) { segments.push({ t: 'ins', text: newText }); }
		return segments;
	}
	return wordDiffSegments(oldText, newText).segments;
}

function makeHunk(baseBody: string, from: number, to: number, newText: string, pairing: DiffPairing, ordinals: IDiffBlockOrdinals): IDocDiffHunk | undefined {
	const oldText = baseBody.slice(from, to);
	if (oldText === newText) { return undefined; }
	// A split and a merge are claims ABOUT a block boundary, so their spans keep both blocks whole. Trimming
	// a merge to its changed lines would reduce "these two paragraphs became one" to "this paragraph gained a
	// space", which is arithmetically the same edit and a useless thing to show a reviewer.
	const { prefix, suffix } = pairing === 'split' || pairing === 'merge' ? { prefix: 0, suffix: 0 } : trimToChangedLines(oldText, newText);
	const start = from + prefix;
	const end = to - suffix;
	const trimmedOld = baseBody.slice(start, end);
	const trimmedNew = newText.slice(prefix, newText.length - suffix);
	// Defensive: the trim must never cut a code point in half, and must never trim a real difference away to
	// nothing. Neither can happen - it only ever cuts after a newline, and the scans stop at the first
	// difference - but a future edit to `trimToChangedLines` that forgets either would corrupt text silently,
	// so the untrimmed region is the fallback rather than a comment asking to be believed.
	if (trimmedOld === trimmedNew || splitsSurrogatePair(baseBody, start) || splitsSurrogatePair(baseBody, end)) {
		return { span: { start: from, end: to }, oldText, newText, op: opFor(oldText, newText), pairing, segments: segmentsFor(oldText, newText), blockOrdinals: ordinals };
	}
	return {
		span: { start, end },
		oldText: trimmedOld,
		newText: trimmedNew,
		op: opFor(trimmedOld, trimmedNew),
		pairing,
		segments: segmentsFor(trimmedOld, trimmedNew),
		blockOrdinals: ordinals,
	};
}

function opFor(oldText: string, newText: string): DiffHunkOp {
	if (oldText.length === 0) { return 'insert'; }
	if (newText.length === 0) { return 'delete'; }
	return 'replace';
}

/** The pairing that describes an unmatched region, from what sits on each side of it. */
function regionPairing(deleted: number, inserted: number): DiffPairing {
	if (deleted > 0 && inserted > 0) { return 'substitute'; }
	if (deleted > 0) { return 'delete'; }
	if (inserted > 0) { return 'insert'; }
	return 'seam';
}

/**
 * Fold any two hunks that begin at the same offset into one.
 *
 * This is not tidying - it is what keeps the splice well defined. `spliceDoc` applies hunks in DESCENDING
 * start order so an earlier write cannot shift a later anchor, and that argument holds for disjoint spans
 * with DISTINCT starts. Two hunks sharing a start (which happens when an insertion trims to a zero-width
 * point that lands exactly where the next changed block begins) would be applied in an order that puts the
 * inserted text on the wrong side of the replacement. Folding them removes the ambiguity at the source
 * rather than asking the splice to guess.
 */
function foldCollidingHunks(hunks: readonly IDocDiffHunk[]): IDocDiffHunk[] {
	const folded: IDocDiffHunk[] = [];
	for (const hunk of hunks) {
		const previous = folded[folded.length - 1];
		if (!previous || previous.span.start !== hunk.span.start) {
			folded.push(hunk);
			continue;
		}
		// Only a zero-width hunk can share a start with the one after it, so `previous` contributes text and
		// no span: the fold is `previous.newText` prepended to `hunk`.
		const newText = previous.newText + hunk.newText;
		folded[folded.length - 1] = {
			span: hunk.span,
			oldText: hunk.oldText,
			newText,
			op: opFor(hunk.oldText, newText),
			pairing: previous.pairing === hunk.pairing ? hunk.pairing : 'substitute',
			segments: segmentsFor(hunk.oldText, newText),
			blockOrdinals: {
				base: [...previous.blockOrdinals.base, ...hunk.blockOrdinals.base],
				proposed: [...previous.blockOrdinals.proposed, ...hunk.blockOrdinals.proposed],
			},
		};
	}
	return folded;
}

function wholeBodyHunk(baseBody: string, proposedBody: string, base: readonly IDiffBlock[], proposed: readonly IDiffBlock[]): IDocDiffHunk[] {
	const hunk = makeHunk(baseBody, 0, baseBody.length, proposedBody, 'whole', {
		base: base.map(b => b.ordinal),
		proposed: proposed.map(b => b.ordinal),
	});
	return hunk ? [hunk] : [];
}

/**
 * Compute the one alignment of a document body and compile it into hunks.
 *
 * `baseBody` and `proposedBody` are BODY text - frontmatter has already been taken off and is re-attached
 * by the caller. The returned spans are offsets into `baseBody`; the `baseRevision` hash that makes them
 * provable is the caller's to stamp, because only the caller knows which document this is.
 */
export function diffDocBody(baseBody: string, proposedBody: string): IDocDiff {
	const base = toDiffBlocks(baseBody);
	const proposed = toDiffBlocks(proposedBody);
	const { matches, anchors } = align(base, proposed);

	const hunks: IDocDiffHunk[] = [];
	let unchangedBlocks = 0;
	let pairedBlocks = 0;
	let changedBlocks = 0;
	let insertedBlocks = 0;
	let deletedBlocks = 0;

	// Walk the base and the proposed body in lockstep. Everything between two consecutive matches is one
	// region; everything a match covers is another. Together they partition the base with no gaps and no
	// overlaps, which is the whole splice guarantee.
	let baseCursor = 0;
	let proposedCursor = 0;
	let baseBlock = 0;
	let proposedBlock = 0;

	const emitRegion = (baseTo: number, proposedTo: number, baseBlockTo: number, proposedBlockTo: number) => {
		const deleted: number[] = [];
		for (let i = baseBlock; i < baseBlockTo; i++) { deleted.push(base[i].ordinal); }
		const inserted: number[] = [];
		for (let j = proposedBlock; j < proposedBlockTo; j++) { inserted.push(proposed[j].ordinal); }
		const hunk = makeHunk(baseBody, baseCursor, baseTo, proposedBody.slice(proposedCursor, proposedTo), regionPairing(deleted.length, inserted.length), { base: deleted, proposed: inserted });
		if (hunk) {
			hunks.push(hunk);
			changedBlocks += deleted.length;
			deletedBlocks += deleted.length;
			insertedBlocks += inserted.length;
		}
		baseCursor = baseTo;
		proposedCursor = proposedTo;
		baseBlock = baseBlockTo;
		proposedBlock = proposedBlockTo;
	};

	for (const match of matches) {
		const firstBase = match.base[0];
		const lastBase = match.base[match.base.length - 1];
		const firstProposed = match.proposed[0];
		const lastProposed = match.proposed[match.proposed.length - 1];
		emitRegion(base[firstBase].start, proposed[firstProposed].start, firstBase, firstProposed);

		const oldText = baseBody.slice(base[firstBase].start, base[lastBase].end);
		const newText = proposedBody.slice(proposed[firstProposed].start, proposed[lastProposed].end);
		if (oldText === newText) {
			unchangedBlocks += match.base.length;
		} else {
			pairedBlocks += match.base.length;
			changedBlocks += match.base.length;
			const hunk = makeHunk(baseBody, base[firstBase].start, base[lastBase].end, newText, match.pairing, { base: [...match.base], proposed: [...match.proposed] });
			if (hunk) { hunks.push(hunk); }
		}
		baseCursor = base[lastBase].end;
		proposedCursor = proposed[lastProposed].end;
		baseBlock = lastBase + 1;
		proposedBlock = lastProposed + 1;
	}
	emitRegion(baseBody.length, proposedBody.length, base.length, proposed.length);

	const composed = foldCollidingHunks(hunks);

	// The contract, checked once. A pass costs one string comparison; a miss would otherwise be a silent
	// data-loss bug shaped exactly like the ones this module exists to end.
	const spliced = spliceDoc(baseBody, composed);
	const exact = spliced.ok && spliced.text === proposedBody;
	const finalHunks = exact ? composed : wholeBodyHunk(baseBody, proposedBody, base, proposed);

	const changedChars = finalHunks.reduce((sum, h) => sum + Math.max(h.span.end - h.span.start, h.newText.length), 0);
	return {
		hunks: finalHunks,
		stats: {
			baseBlocks: base.length,
			proposedBlocks: proposed.length,
			anchoredBlocks: exact ? anchors : 0,
			unchangedBlocks: exact ? unchangedBlocks : 0,
			pairedBlocks: exact ? pairedBlocks : 0,
			changedBlocks: exact ? changedBlocks : base.length,
			insertedBlocks: exact ? insertedBlocks : proposed.length,
			deletedBlocks: exact ? deletedBlocks : base.length,
			changedChars,
			baseChars: baseBody.length,
			changedRatio: changedChars / Math.max(baseBody.length, 1),
			wholeBodyFallback: !exact,
		},
		changeClass: deriveChangeClass(finalHunks, baseBody.length),
	};
}

/** Why a landed write did not read back as the change that was approved. Named, never a bare boolean. */
export type ChangedRegionFailure =
	/** The document changed somewhere no approved hunk describes: untouched content was NOT untouched. */
	| 'unapproved-change'
	/** An approved hunk describes a region the document does not show as changed at all. */
	| 'missing-change';

/** The verdict of {@link verifyChangedRegions}. Closed, so "it passed" cannot be confused with "it ran". */
export type IChangedRegionCheck = { readonly ok: true } | { readonly ok: false; readonly reason: ChangedRegionFailure };

/**
 * Invariant I6's post-check: re-derive what changed between two bodies and prove it is what was approved.
 *
 * This runs AFTER a write has been read back and its hash compared to the expectation the intent declared,
 * and it is deliberately a SECOND, independently-derived witness rather than a restatement of the first.
 * The hash check asks "did the bytes I computed reach the disk"; it is answered with arithmetic the splice
 * itself produced, so it cannot catch a splice that was wrong in the first place. This one asks a different
 * question - "reading only the two documents, is the difference between them the difference the reviewer
 * agreed to?" - and it is answered by the same alignment the reviewer's cards were built from, with no
 * memory of the splice at all. Two witnesses that share no arithmetic is the whole point.
 *
 * The test is stated at the differ's own resolution, which is block-grained: an approved anchor may cover
 * one list item while the hunk that reports it covers the whole list. So the rule is INTERSECTION, not
 * containment - every changed region must be spoken for by an approved anchor, and every approved anchor
 * that actually changes something must show up as a changed region. A hunk sitting in prose no anchor names
 * is the failure this exists to make impossible, and it is exactly what a lossy serialiser in the write
 * path produces.
 */
export function verifyChangedRegions(baseBody: string, observedBody: string, approved: readonly ISplicePlacement[]): IChangedRegionCheck {
	const hunks = diffDocBody(baseBody, observedBody).hunks;
	// A no-op anchor (the text it proposes is the text already there) legitimately produces no hunk, so it
	// is excluded from the coverage half rather than being reported as a change that went missing.
	const effective = approved.filter(a => a.newText !== a.oldText);
	/**
	 * Whether two placements describe the same region of the base.
	 *
	 * Overlap is the ordinary case. The other one is a SEAM: an insertion has a zero-width span, and the blank
	 * line between two blocks is a real interval, so an approve that anchors at the end of one block and an
	 * alignment that attributes the same insertion to the start of the next are describing one region through
	 * two equally correct addresses. Whitespace is the only thing allowed to sit between them, and two regions
	 * of PROSE are never separated by whitespace alone - so this cannot quietly bridge a changed paragraph to
	 * an approved hunk somewhere else in the document, which is the whole thing the check exists to catch.
	 */
	const sameRegion = (a: ISplicePlacement, b: ISplicePlacement) => {
		const [first, second] = a.span.start <= b.span.start ? [a, b] : [b, a];
		return second.span.start <= first.span.end || baseBody.slice(first.span.end, second.span.start).trim() === '';
	};
	for (const hunk of hunks) {
		if (!effective.some(a => sameRegion(hunk, a))) {
			return { ok: false, reason: 'unapproved-change' };
		}
	}
	for (const anchor of effective) {
		if (!hunks.some(h => sameRegion(h, anchor))) {
			return { ok: false, reason: 'missing-change' };
		}
	}
	return { ok: true };
}
