/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The pure `[[Wikilink]]` rules (decision 179, plan 52 WP-C): parse, serialise, resolve a name to a
 * document, decide what an unresolved link is, and rank the picker's suggestions.
 *
 * Everything here is DOM-free and dependency-free on purpose, for two reasons:
 *   1. it is unit-tested without a DOM, the house pattern for Markdown-level knowledge;
 *   2. several of these functions are injected VERBATIM into the editor webview's RUNTIME via
 *      `String(fn)` (the same seam `common/livingDocTableEdit.ts` and `common/livingDocWordPaste.ts`
 *      use), so the picker inside the webview and the host run literally the same code. That is why
 *      each injected function is self-contained - no imports, no shared helpers, no class fields -
 *      and why the unit test asserts it.
 */

/** How many suggestions the caret-anchored `[[` picker shows at once. */
export const WIKILINK_PICKER_LIMIT = 8;

/** A wikilink found in Markdown source. `alias` is Obsidian's `[[Target|Shown text]]` form ('' when absent). */
export interface IWikilink {
	readonly target: string;
	readonly alias: string;
	/** The index of the opening `[[` in the scanned text. */
	readonly start: number;
	/** The index just past the closing `]]`. */
	readonly end: number;
}

/**
 * Filter and rank candidate names against a partial query, newest-first by relevance.
 *
 * This is the `@`-mention picker's ranking (`filterMentions` in `browser/reviewRailView.ts`, #178),
 * lifted here unchanged so the `[[` picker reuses the rule rather than inventing a second one: a
 * case-insensitive substring match; a prefix match ranks above a mid-string match, then shorter names,
 * then alphabetical - so "over" surfaces "Overview" before "Handover notes". A parity test pins this
 * function's output to `filterMentions` so the two can never drift apart silently.
 *
 * Self-contained (injected into the webview RUNTIME via `String(fn)`).
 */
export function rankWikilinkTargets(names: readonly string[], query: string, limit: number = WIKILINK_PICKER_LIMIT): string[] {
	const q = query.toLowerCase();
	const scored: { name: string; rank: number }[] = [];
	for (const name of names) {
		const idx = name.toLowerCase().indexOf(q);
		if (idx < 0) { continue; }
		scored.push({ name, rank: idx === 0 ? 0 : 1 });
	}
	scored.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name));
	return scored.slice(0, limit).map(s => s.name);
}

/**
 * The partial `[[` wikilink the caret sits inside, or undefined when it is not in one.
 *
 * The `@`-mention twin (`activeMention`) forbids whitespace in the query, because a mention is a
 * filename token. A document name is prose - "Team Notes", "Q3 Plan" - so spaces must be allowed here,
 * and the run is bounded instead by the things that prove this is NOT an open wikilink: a closing `]]`
 * (already finished), a further `[`, a line break, or a run so long it can only be stray text. Returns
 * the index of the opening `[[` and the query typed after it (empty right after typing `[[`).
 *
 * Self-contained (injected into the webview RUNTIME via `String(fn)`).
 */
export function activeWikilink(text: string, caret: number): { start: number; query: string } | undefined {
	const upto = text.slice(0, caret);
	const open = upto.lastIndexOf('[[');
	if (open < 0) { return undefined; }
	const query = upto.slice(open + 2);
	// 120 chars is far past any real document name; beyond it a stray `[[` earlier in the paragraph would
	// otherwise hold the picker open for the rest of the block.
	if (query.length > 120) { return undefined; }
	if (query.indexOf(']') >= 0 || query.indexOf('[') >= 0 || query.indexOf('\n') >= 0) { return undefined; }
	return { start: open, query };
}

/**
 * The on-disk form of a wikilink: `[[Target]]`, or `[[Target|Alias]]` when an alias is shown. This is
 * the exact text that must reach the Markdown file, which is what keeps it Obsidian-compatible.
 *
 * Self-contained (injected into the webview RUNTIME via `String(fn)`).
 */
export function serializeWikilink(target: string, alias?: string): string {
	const shown = (alias ?? '').trim();
	const to = target.trim();
	return shown && shown !== to ? `[[${to}|${shown}]]` : `[[${to}]]`;
}

/**
 * Normalise a name for matching a wikilink target against a document.
 *
 * Three things are folded away, each for a reason a user will actually hit:
 *   - case and surrounding/inner whitespace, so `[[team notes]]` finds "Team Notes";
 *   - a trailing `.md`, so `[[Team Notes.md]]` (what a paste from a file list gives you) still resolves;
 *   - the characters no filename may carry (`/ \ : * ? " < > |`), because creating `[[Q1/Q2 Review]]`
 *     writes `Q1 Q2 Review.md` (the service's own `_safeStem` rule) - so without this fold the link
 *     that just created a document would still render unresolved.
 *
 * Self-contained (injected into the webview RUNTIME via `String(fn)`).
 */
export function normalizeWikilinkName(name: string): string {
	return String(name || '')
		.trim()
		.replace(/\.md$/i, '')
		.replace(/[\/\\:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Resolve a wikilink target against the workspace's document names, returning the matched name or
 * undefined when no document carries it. Undefined is precisely what makes a link render "unresolved"
 * and turns a click into a create (the Obsidian behaviour).
 *
 * Self-contained (injected into the webview RUNTIME via `String(fn)`); the normalisation is inlined
 * rather than calling `normalizeWikilinkName` for exactly that reason.
 */
export function resolveWikilinkTarget(target: string, documentNames: readonly string[]): string | undefined {
	const norm = (name: string) => String(name || '')
		.trim()
		.replace(/\.md$/i, '')
		.replace(/[\/\\:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
	const want = norm(target);
	if (!want) { return undefined; }
	for (const name of documentNames) {
		if (norm(name) === want) { return name; }
	}
	return undefined;
}

// A wikilink in Markdown source. Deliberately conservative and identical in shape to the bundle's inline
// rule: no nested brackets, no line breaks, a non-empty target.
const WIKILINK_RE = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n|]*))?\]\]/g;

/** Every wikilink in a piece of Markdown, in source order. */
export function parseWikilinks(text: string): IWikilink[] {
	const out: IWikilink[] = [];
	const re = new RegExp(WIKILINK_RE.source, 'g');
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const target = m[1].trim();
		if (!target) { continue; }
		out.push({ target, alias: (m[2] ?? '').trim(), start: m.index, end: m.index + m[0].length });
	}
	return out;
}

/**
 * Collapse every wikilink to the plain text a reader sees - the alias when there is one, otherwise the
 * target. This is the EXPORT rule (md, html, docx, pdf all build from one resolved Markdown string): an
 * exported file is read outside Abstract, where `[[Team Notes]]` is neither a link nor readable prose,
 * so it reads as "Team Notes". Chip markup can never leak, because there is no markup here to leak.
 */
export function wikilinksToPlainText(text: string): string {
	return text.replace(new RegExp(WIKILINK_RE.source, 'g'), (whole, target: string, alias?: string) => {
		const shown = (alias ?? '').trim() || String(target).trim();
		return shown || whole;
	});
}

/**
 * The document names a `[[` picker offers, derived from the mentionable-file list the `@` picker uses:
 * Markdown documents only (a wikilink addresses a document, not a `.csv` source), with the `.md`
 * extension dropped so the inserted link reads `[[Team Notes]]` the way Obsidian writes it. Templates
 * (`*.template.md`) and export artefacts (`*.export.md`) are not documents you link to, so they are out.
 * Sorted and de-duplicated so the picker is stable.
 */
export function documentNamesFromFiles(files: readonly string[]): string[] {
	const out = new Set<string>();
	for (const file of files) {
		if (!/\.md$/i.test(file)) { continue; }
		if (/\.(template|export)\.md$/i.test(file)) { continue; }
		const stem = file.replace(/^.*[\\/]/, '').replace(/\.md$/i, '').trim();
		if (stem) { out.add(stem); }
	}
	return [...out].sort((a, b) => a.localeCompare(b));
}
