/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Tidy verb's plan builder (doc 22 section 5, the P2 folder conventions). Pure heuristics in,
// a move plan out - no DOM, no fs, no model. "Outdated" is never assumed: every proposed move carries
// a stated, mechanical reason (a superseded name, a data file loose at the root, an imported original)
// so the human decides on evidence, not on a guess. The service turns a folder inventory into the
// `ITidyInventoryItem` list and wires each `ITidyMove` through the F16 atomic move machinery; this
// module is unit-tested in isolation against fixture inventories.
//
// The stance is CONSERVATIVE (doc 22: never move a file silently, never enforce a convention). Only
// files at the project ROOT are considered - a file already inside a convention folder is left alone -
// and a bound source that lives where its lock points is never proposed. When nothing qualifies the
// plan is honestly empty ("nothing to tidy"), never a fabricated row to look busy.

// The soft convention folders (doc 22 section 5). Created on demand by the apply step, never up front.
export const TIDY_DATA = 'data';
export const TIDY_ASSETS = 'assets';
export const TIDY_TEMPLATES = 'templates';
export const TIDY_ARCHIVE = 'archive';
export const TIDY_ARCHIVE_ORIGINALS = 'archive/originals';
export const TIDY_WORKING_FILES = 'working-files';

// "No edits in N weeks" is the staleness floor for archiving a superseded-looking document: recent files
// are never archived even when their name looks old (they may be in active use). Four weeks is a month of
// no touches - conservative enough that a live document is never swept away.
export const TIDY_DEFAULT_STALE_WEEKS = 4;

// One file discovered at the project root, with the mechanical signals the heuristics read. The service
// builds this from its folder scan (name + mtime), the dependency graph (`referencedBy`), and the import
// provenance in the locks (`isImportedOriginal`). Files inside convention folders are not listed here.
export interface ITidyInventoryItem {
	/** The file's basename, e.g. "Board Note -old.md" or "metrics.csv". */
	readonly name: string;
	/** The file's directory relative to the project root ('' = the root itself). Only '' is tidied. */
	readonly folder: string;
	/** Last-modified time in epoch ms; 0/undefined = unknown, treated as "not stale" (never archived). */
	readonly mtimeMs?: number;
	/** How many OTHER documents reference this file via frontmatter `sources:`/`context:` (inbound refs). */
	readonly referencedBy: number;
	/** True when this file is the untouched original of an imported document (a lock's `imported.from`). */
	readonly isImportedOriginal?: boolean;
}

// One proposed move: a source path, a destination path, and the plain-words reason the human reviews.
// Paths are project-root-relative and '/'-joined, so they read as an obviously-sensible folder to a
// non-Abstract user in Finder/Explorer (P6).
export interface ITidyMove {
	readonly from: string;
	readonly to: string;
	readonly reason: string;
}

export interface ITidyPlan {
	readonly moves: readonly ITidyMove[];
}

export interface ITidyPlanOptions {
	/** "now" in epoch ms, for the no-edits-in-N-weeks staleness compare. */
	readonly nowMs: number;
	/** The staleness floor for archiving; defaults to {@link TIDY_DEFAULT_STALE_WEEKS}. */
	readonly staleWeeks?: number;
}

// Data-file extensions that belong under `data/` (doc 22 section 4: CSV is canonical, xlsx is watched).
const DATA_EXTS = new Set(['csv', 'tsv', 'xlsx', 'xls']);
// Image extensions that belong under `assets/`.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);

// A name that MARKS ITSELF as an old version - superseded regardless of whether a newer sibling is present
// (an "-old" or "backup" file names its own obsolescence). Terminal/explicit markers only; the softer
// signals (copy / vN / draft) need a newer sibling to corroborate them (below).
const EXPLICIT_OLD = /(^|[\s._-])(old|superseded|deprecated|previous|backup|bak)([\s._)-]|$)/i;
// The softer supersession markers: a copy, a numbered duplicate, a version token, or a draft. On their own
// these are ambiguous (a lone "Report v2" is just the current report), so a move is proposed only when a
// NEWER sibling in the same family exists to corroborate the signal.
const COPY_MARKER = /(^|[\s._-])copy([\s._-]|$)|\(\d+\)/i;
const VERSION_MARKER = /(^|[\s._-])v(\d+)\b/i;
const DRAFT_MARKER = /(^|[\s._-])(draft|wip)([\s._-]|$)/i;
// Scratch / thinking documents that belong under `working-files/`. Deliberately TIGHT (doc 22: "be
// conservative; when in doubt, don't propose") - "notes" and "todo" are left out because "Meeting Notes"
// is a real deliverable, not scratch.
const SCRATCH_MARKER = /(^|[\s._-])(scratch|wip|thinking|brainstorm)([\s._-]|$)/i;

function extOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isMarkdown(name: string): boolean {
	return /\.md$/i.test(name);
}

function isTemplate(name: string): boolean {
	return /\.template\.md$/i.test(name);
}

function docStem(name: string): string {
	return name.replace(/\.md$/i, '');
}

function hasWeakMarker(stem: string): boolean {
	return COPY_MARKER.test(stem) || VERSION_MARKER.test(stem) || DRAFT_MARKER.test(stem);
}

// The numeric version of a stem for "which sibling is newer": a `vN` token, else a `(N)` numbered-copy
// suffix, else 0. Higher = newer within a family.
function versionOf(stem: string): number {
	const v = stem.match(VERSION_MARKER);
	if (v) { return parseInt(v[2], 10); }
	const n = stem.match(/\((\d+)\)/);
	return n ? parseInt(n[1], 10) : 0;
}

// The family key groups the variants of one document (its "base" name) so a newer sibling can be found:
// version tokens, numbered-copy suffixes, and the copy/draft/final/old words are stripped to a bare stem.
function familyKey(stem: string): string {
	return stem.toLowerCase()
		.replace(/\(\d+\)/g, ' ')
		.replace(/(^|[\s._-])v\d+\b/g, ' ')
		.replace(/\bcopy of\b/g, ' ')
		.replace(/(^|[\s._-])copy([\s._-]|$)/g, ' ')
		.replace(/(^|[\s._-])(draft|wip|final)([\s._-]|$)/g, ' ')
		.replace(/(^|[\s._-])(old|superseded|deprecated|previous|backup|bak)([\s._)-]|$)/g, ' ')
		.replace(/[\s._-]+/g, ' ')
		.trim();
}

interface IFamilyMember {
	readonly name: string;
	readonly stem: string;
	readonly version: number;
	readonly weak: boolean;
}

// Group the root Markdown documents (never templates) into families and pick each family's "current"
// member (the winner). A non-weak name beats any weak name; among equals the higher version wins; ties
// break alphabetically for determinism. Returns the winner's filename per family so a superseded member's
// reason can NAME what supersedes it.
function familyWinners(items: readonly ITidyInventoryItem[]): Map<string, IFamilyMember> {
	const families = new Map<string, IFamilyMember[]>();
	for (const item of items) {
		if (item.folder !== '' || !isMarkdown(item.name) || isTemplate(item.name)) { continue; }
		const stem = docStem(item.name);
		const member: IFamilyMember = { name: item.name, stem, version: versionOf(stem), weak: hasWeakMarker(stem) };
		const key = familyKey(stem);
		const list = families.get(key);
		if (list) { list.push(member); } else { families.set(key, [member]); }
	}
	const winners = new Map<string, IFamilyMember>();
	for (const [key, members] of families) {
		const winner = [...members].sort((a, b) =>
			(Number(a.weak) - Number(b.weak)) || (b.version - a.version) || a.name.localeCompare(b.name))[0];
		winners.set(key, winner);
	}
	return winners;
}

// The archive reason for a Markdown document, or undefined when it should not be archived. Gated on the
// staleness floor AND no inbound references (doc 22: "no edits in N weeks AND no inbound references") - a
// recent or still-referenced document is never archived, however old its name looks. The reason names its
// evidence: either the self-marking "-old" name, or the specific newer sibling that supersedes it.
function archiveReason(item: ITidyInventoryItem, winners: Map<string, IFamilyMember>, staleWeeks: number, nowMs: number): string | undefined {
	if (item.referencedBy > 0) { return undefined; }
	const stem = docStem(item.name);
	const ageMs = nowMs - (item.mtimeMs ?? 0);
	const stale = !!item.mtimeMs && ageMs >= staleWeeks * 7 * 24 * 60 * 60 * 1000;
	if (!stale) { return undefined; }
	if (EXPLICIT_OLD.test(stem)) {
		return `the name marks it as an old version, it has not been edited in ${staleWeeks} weeks, and nothing references it`;
	}
	if (hasWeakMarker(stem)) {
		const winner = winners.get(familyKey(stem));
		if (winner && winner.name !== item.name) {
			return `it looks superseded by "${winner.name}", it has not been edited in ${staleWeeks} weeks, and nothing references it`;
		}
	}
	return undefined;
}

/**
 * Build the Tidy move plan from a root-file inventory (doc 22 section 5). Deterministic and model-free:
 * every move has a mechanical reason. The heuristics, in priority order per file (first match wins):
 *
 *   1. an imported document's untouched ORIGINAL -> `archive/originals/`
 *   2. a `*.template.md` loose at the root       -> `templates/`
 *   3. a superseded-looking, stale, unreferenced Markdown doc -> `archive/`
 *   4. a scratch/thinking note that nothing references        -> `working-files/`
 *   5. an unreferenced data file (csv/tsv/xls/xlsx)           -> `data/`
 *   6. an unreferenced image                                  -> `assets/`
 *
 * Only root files are considered; anything already in a sensible place, bound, or ambiguous is left out.
 * Moves are sorted by destination then name so the plan reads stably.
 */
export function buildTidyPlan(items: readonly ITidyInventoryItem[], options: ITidyPlanOptions): ITidyPlan {
	const staleWeeks = options.staleWeeks ?? TIDY_DEFAULT_STALE_WEEKS;
	const winners = familyWinners(items);
	const moves: ITidyMove[] = [];

	const propose = (item: ITidyInventoryItem, folder: string, reason: string) => {
		moves.push({ from: item.name, to: `${folder}/${item.name}`, reason });
	};

	for (const item of items) {
		if (item.folder !== '') { continue; } // only the project root is tidied.
		const ext = extOf(item.name);

		// 1. Imported originals: the untouched foreign file behind an imported document (doc 22 section 2 step 5).
		if (item.isImportedOriginal) {
			propose(item, TIDY_ARCHIVE_ORIGINALS, 'the original of an imported document, now that a Markdown copy exists');
			continue;
		}

		// 2. Templates loose at the root belong under templates/ (the plan-28 convention).
		if (isTemplate(item.name)) {
			propose(item, TIDY_TEMPLATES, 'a template kept outside the templates folder');
			continue;
		}

		if (isMarkdown(item.name)) {
			// 3. Superseded, stale, unreferenced documents -> archive/ (proposed, never assumed).
			const archive = archiveReason(item, winners, staleWeeks, options.nowMs);
			if (archive) { propose(item, TIDY_ARCHIVE, archive); continue; }
			// 4. Scratch / thinking notes that nothing references -> working-files/.
			if (item.referencedBy === 0 && SCRATCH_MARKER.test(docStem(item.name))) {
				propose(item, TIDY_WORKING_FILES, 'a scratch working note that nothing references');
			}
			continue;
		}

		// 5. Loose data files -> data/. A bound data file that lives where its lock points is left alone
		//    (moving it is churn and its binding already resolves); only unreferenced data files are proposed.
		if (DATA_EXTS.has(ext)) {
			if (item.referencedBy === 0) { propose(item, TIDY_DATA, 'a data file sitting at the project root'); }
			continue;
		}

		// 6. Loose images -> assets/. Unreferenced only (a bound image reference must not be broken).
		if (IMAGE_EXTS.has(ext)) {
			if (item.referencedBy === 0) { propose(item, TIDY_ASSETS, 'an image sitting at the project root'); }
			continue;
		}
	}

	// Sort by destination then source, comparing lower-cased code points so the order is deterministic
	// across locales (a plain alphabetical group-by-folder reading, stable for the review list).
	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	moves.sort((a, b) => cmp(a.to.toLowerCase(), b.to.toLowerCase()) || cmp(a.from.toLowerCase(), b.from.toLowerCase()));
	return { moves };
}
