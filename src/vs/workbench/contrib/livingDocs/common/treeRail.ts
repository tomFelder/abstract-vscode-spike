/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { ILivingDoc, SourceKind } from './livingDocsModel.js';
import { sourceKindOf } from './contextGroups.js';

// Pure data shaping for the left tree-rail (the comp's Files / Outline / Search tabs). The Context tab
// reuses `buildContextGroups`; these three helpers cover the rest and are unit-tested independently of
// the DOM view that renders them.

// A per-file action a SOURCES row can offer (issue #131): a spreadsheet workbook or a PDF that is not yet
// wired in but that Abstract CAN turn into a source. `use-xlsx` extracts each sheet to a CSV; `use-pdf`
// extracts the PDF's text as read-only context. Absent on rows that are already sources or cannot be used.
export type TreeRailAction = 'use-xlsx' | 'use-pdf';

export interface ITreeRailItem {
	readonly label: string;
	/** Present for document rows (clicking opens the editor); absent for non-openable source rows. */
	readonly resource?: URI;
	readonly kind: 'doc' | 'source' | 'unsupported';
	/** A document with pending meaning-changes shows the amber dot (mirrors the Review count). */
	readonly pending: boolean;
	/** For source rows, the binding kind (file | api | mcp) - drives the row glyph. */
	readonly sourceKind?: SourceKind;
	/** For an `unsupported` (not-yet-imported) row, the plain-words reason; unset otherwise (plan 37 F10). */
	readonly note?: string;
	/** For a workbook/PDF SOURCES row, the "Use as source" action it offers (issue #131). */
	readonly action?: TreeRailAction;
	/** For an `unsupported` row we CAN convert (a `.docx`, issue #129): the row shows an "Import as document"
	 * door instead of a dead reason. Unset (falsy) for a refused format (.doc, password-protected, ...). */
	readonly importable?: boolean;
}

export interface ITreeRailFolder {
	readonly name: string;
	readonly items: readonly ITreeRailItem[];
	/** Nested subfolders, preserving the on-disk hierarchy (plan 37 F7). Empty for a leaf group. */
	readonly folders: readonly ITreeRailFolder[];
}

export interface ITreeRailDocInput {
	readonly title: string;
	readonly resource: URI;
	readonly pendingCount: number;
	readonly sources: readonly string[];
	/** The document's directory relative to the workspace root ('' = root), '/'-joined (plan 37 F7). */
	readonly folder?: string;
}

// A non-Markdown file discovered in the workspace, classified for the Files tab: a `source` (a CSV / txt /
// image / data file that belongs in the SOURCES section, F9), or `unsupported` - either a `.docx` we can now
// convert (`importable`, issue #129: the row becomes an "Import as document" door), a workbook/PDF that
// offers a "Use as source" `action` (issue #131), or a format we still refuse to mangle (.doc/... marked
// "not yet imported" with a plain-words reason, F10). Anything we should not surface returns undefined.
export function classifyWorkspaceExtra(name: string): { kind: 'source' | 'unsupported'; reason?: string; action?: TreeRailAction; importable?: boolean } | undefined {
	if (!name || name.startsWith('.')) { return undefined; }
	const lower = name.toLowerCase();
	// Markdown documents are the Reports tree's job; system sidecars and the agents registry are not user data.
	if (lower.endsWith('.md')) { return undefined; }
	if (lower.endsWith('.lock.json') || lower === 'agents.json') { return undefined; }
	const dot = lower.lastIndexOf('.');
	const ext = dot >= 0 ? lower.slice(dot + 1) : '';
	if (!ext) { return undefined; }
	if (SOURCE_EXTS.has(ext)) { return { kind: 'source' }; }
	// Spreadsheets + PDFs are usable sources, not dead "not yet imported" rows (issue #131, doc 22 section 4): a
	// workbook offers "Use as source" (sheets -> CSVs), a PDF offers "Use as source" (text -> read-only context).
	const action = SOURCE_ACTIONS[ext];
	if (action) { return { kind: 'source', action }; }
	// `.docx` is the one foreign document format we convert (doc 22 section 2): it offers the import door
	// rather than a dead reason. A password-protected / unparseable .docx is refused at conversion time (the
	// proxy sniffs the bytes), so it drops back to a plain-words refusal there - never a silent mangle here.
	if (ext === 'docx') { return { kind: 'unsupported', importable: true }; }
	const reason = IMPORT_REASONS[ext];
	if (reason) { return { kind: 'unsupported', reason }; }
	return undefined;
}

// Data/source file extensions that belong in the SOURCES section (F9).
const SOURCE_EXTS = new Set(['csv', 'tsv', 'json', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'yaml', 'yml']);

// File types that appear in SOURCES with a "Use as source" action rather than as inert rows (issue #131).
const SOURCE_ACTIONS: Record<string, TreeRailAction> = {
	xls: 'use-xlsx',
	xlsx: 'use-xlsx',
	pdf: 'use-pdf',
};

// Formats we cannot yet interpret on open (F10): never silently skipped - the row is shown marked
// "not yet imported - {reason}" so the user sees the file is there and why it is not opened. `.docx` is
// deliberately absent - it is importable (handled above), not refused.
const IMPORT_REASONS: Record<string, string> = {
	doc: 'Legacy .doc files are not imported yet - open in Word and save as .docx',
	rtf: 'Rich Text documents are not imported yet',
	odt: 'OpenDocument text is not imported yet',
	pages: 'Pages documents are not imported yet',
	ppt: 'Slide decks are not imported yet',
	pptx: 'Slide decks are not imported yet',
	key: 'Keynote decks are not imported yet',
};

interface IMutableFolder {
	readonly name: string;
	readonly items: ITreeRailItem[];
	readonly children: Map<string, IMutableFolder>;
}

/**
 * The Files-tab folder tree. Living documents land under "Reports" with their on-disk subfolder hierarchy
 * preserved (F7 - nested folders are not flattened). The distinct sources the documents bind to, plus any
 * data/source files (CSV/txt/image) discovered in the folder, land under "Sources" (deduped, kind-tagged,
 * F9). Files we cannot yet import (.doc/.docx and kin) land under "Not yet imported" with a plain-words
 * reason (F10). Empty groups are omitted so the rail only shows what the workspace actually has. Pure.
 */
export function buildFileTree(docs: readonly ITreeRailDocInput[], extras: readonly string[] = []): ITreeRailFolder[] {
	const folders: ITreeRailFolder[] = [];

	// --- Reports: the document tree, on-disk hierarchy preserved (F7) ---
	const rootItems: ITreeRailItem[] = [];
	const roots = new Map<string, IMutableFolder>();
	for (const d of [...docs].sort((a, b) => a.title.localeCompare(b.title))) {
		const item: ITreeRailItem = { label: d.title, resource: d.resource, kind: 'doc', pending: d.pendingCount > 0 };
		const segments = (d.folder ?? '').split('/').filter(s => s.length > 0);
		if (!segments.length) { rootItems.push(item); continue; }
		let level = roots;
		let node: IMutableFolder | undefined;
		for (const seg of segments) {
			node = level.get(seg) ?? { name: seg, items: [], children: new Map() };
			level.set(seg, node);
			level = node.children;
		}
		node!.items.push(item);
	}
	const freeze = (level: Map<string, IMutableFolder>): ITreeRailFolder[] =>
		[...level.values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(f => ({ name: f.name, items: f.items, folders: freeze(f.children) }));
	const reportsSubfolders = freeze(roots);
	if (rootItems.length || reportsSubfolders.length) {
		folders.push({ name: 'Reports', items: rootItems, folders: reportsSubfolders });
	}

	// --- Sources: bound sources + discovered data/source files, deduped (F9) ---
	const seen = new Set<string>();
	const sources: ITreeRailItem[] = [];
	// A file source resolves to a real URI alongside the document that references it (sources are
	// folder-scoped, decision 40), so the Files tab can rename/delete it. An api/mcp source has no file
	// to act on, and a discovered "extra" (below) is a bare filename with no owning document, so both
	// carry no resource and their context menu row is inert (gated on `item.resource`).
	const addSource = (label: string, resource?: URI, action?: TreeRailAction) => {
		if (seen.has(label)) { return; }
		seen.add(label);
		sources.push({ label, resource, kind: 'source', pending: false, sourceKind: sourceKindOf(label), ...(action ? { action } : {}) });
	};
	for (const d of docs) {
		for (const s of d.sources) {
			addSource(s, sourceKindOf(s) === 'file' ? joinPath(dirname(d.resource), s) : undefined);
		}
	}

	// --- Not yet imported: unsupported files, never silently dropped (F10) ---
	const seenUnsupported = new Set<string>();
	const unsupported: ITreeRailItem[] = [];
	for (const name of extras) {
		const c = classifyWorkspaceExtra(name);
		if (!c) { continue; }
		if (c.kind === 'source') { addSource(name, undefined, c.action); continue; }
		if (seenUnsupported.has(name)) { continue; }
		seenUnsupported.add(name);
		unsupported.push({ label: name, kind: 'unsupported', pending: false, note: c.reason, importable: c.importable });
	}
	sources.sort((a, b) => a.label.localeCompare(b.label));
	unsupported.sort((a, b) => a.label.localeCompare(b.label));

	if (sources.length) { folders.push({ name: 'Sources', items: sources, folders: [] }); }
	if (unsupported.length) { folders.push({ name: 'Not yet imported', items: unsupported, folders: [] }); }
	return folders;
}

export interface IOutlineEntry {
	readonly text: string;
	readonly level: number;
	/**
	 * The heading's zero-based ordinal among the headings the editor actually RENDERS, in document order. The
	 * ProseMirror surface (prosemirror-markdown / markdown-it over `doc.body`) emits one `<h1..h6>` per
	 * rendered heading, so this index is the anchor the Outline tab uses to scroll the surface to a clicked
	 * heading (issue #181) - `revealHeading` selects the Nth `<hN>` by this index, no drifting text/slug match.
	 */
	readonly headingIndex: number;
}

const BIND_LINK_RE = /\[([^\]]*)\]\(bind:[^)\s]+\)/g;
const FENCE_RE = /^ {0,3}(?<fence>`{3,}|~{3,})/;
const ATX_RE = /^ {0,3}(?<hashes>#{1,6})(?:[ \t]+(?<text>.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(?<underline>=+|-+)[ \t]*$/;
const BLOCKQUOTE_RE = /^ {0,3}(?:> ?)+/;
const BLANK_RE = /^[ \t]*$/;

/** One rendered heading found by scanning the raw body the ProseMirror surface renders. */
interface IScannedHeading {
	readonly level: number;
	/** The heading's raw inline text (ATX body or setext line), before bind-link/whitespace cleanup. */
	readonly text: string;
}

/**
 * Scan the raw Markdown body for the headings the ProseMirror surface (markdown-it / prosemirror-markdown)
 * actually renders as `<h1..h6>`, in document order. This is the SAME set the webview's `revealHeading`
 * scrolls against, so an entry's ordinal in this list lines up 1:1 with the Nth rendered `<hN>` (issue #181).
 *
 * It recognises exactly what CommonMark (markdown-it's default) renders as a heading, and no more:
 *   - ATX headings (`#`..`######`), up to three leading spaces, optional closing `#`s;
 *   - setext headings (a non-blank text line immediately underlined by `===`/`---`);
 *   - headings nested in a blockquote (the `>` markers are stripped, then the line is re-tested).
 * Fenced code blocks (```` ``` ````/`~~~`) are skipped wholesale, since their contents are not parsed as
 * Markdown - matching the surface, so both sides count the same headings and no index can drift.
 *
 * The custom block parser in `livingDocMarkdown.ts` recognised only single-line ATX headings, so its
 * ordinals drifted from the DOM the moment a setext or blockquote-nested heading appeared; deriving the
 * outline from this shared scan kills that two-parser divergence at its source.
 */
function scanRenderedHeadings(body: string): IScannedHeading[] {
	const headings: IScannedHeading[] = [];
	const lines = body.split(/\r?\n/);
	let fence: string | undefined;
	let prevContent: string | undefined;
	for (const rawLine of lines) {
		// Inside a fenced code block, only its matching closing fence ends it; nothing else is a heading.
		if (fence !== undefined) {
			const close = FENCE_RE.exec(rawLine);
			if (close && close.groups!.fence[0] === fence[0] && close.groups!.fence.length >= fence.length) {
				fence = undefined;
			}
			prevContent = undefined;
			continue;
		}
		// A blockquote-nested heading renders too: strip the `>` markers, then judge the inner line.
		const line = rawLine.replace(BLOCKQUOTE_RE, '');

		const openFence = FENCE_RE.exec(line);
		if (openFence) {
			fence = openFence.groups!.fence;
			prevContent = undefined;
			continue;
		}

		const atx = ATX_RE.exec(line);
		if (atx) {
			headings.push({ level: atx.groups!.hashes.length, text: (atx.groups!.text ?? '').trim() });
			prevContent = undefined;
			continue;
		}

		const underline = SETEXT_UNDERLINE_RE.exec(line);
		if (underline && prevContent !== undefined) {
			// A setext heading: the previous content line underlined by `=` (h1) or `-` (h2).
			headings.push({ level: underline.groups!.underline[0] === '=' ? 1 : 2, text: prevContent.trim() });
			prevContent = undefined;
			continue;
		}

		prevContent = BLANK_RE.test(line) ? undefined : line;
	}
	return headings;
}

/**
 * The Outline-tab entries: the document's rendered headings in order, stripped of Markdown/bind syntax.
 * Derived from `doc.body` via the same heading scan the editor surface renders against, so each entry's
 * `headingIndex` is the exact ordinal of its `<hN>` in the DOM the Outline scrolls (issue #181).
 */
export function buildOutline(doc: ILivingDoc | undefined): IOutlineEntry[] {
	if (!doc) { return []; }
	const entries: IOutlineEntry[] = [];
	let headingIndex = 0;
	for (const heading of scanRenderedHeadings(doc.body)) {
		const text = heading.text.replace(BIND_LINK_RE, '$1').trim();
		if (text) { entries.push({ text, level: heading.level, headingIndex }); }
		// Advance for EVERY rendered heading, shown as a row or not, so the index tracks the `<hN>` ordinal.
		headingIndex++;
	}
	return entries;
}

export interface ISearchHit {
	readonly title: string;
	readonly resource: URI;
	readonly snippet: string;
}

export interface ISearchDocInput {
	readonly title: string;
	readonly resource: URI;
	readonly body: string;
}

/**
 * The Search-tab results: documents whose title or body contains the query (case-insensitive), each
 * with a short snippet around the first body match. An empty/blank query returns nothing.
 */
export function searchTreeRail(docs: readonly ISearchDocInput[], query: string): ISearchHit[] {
	const q = query.trim().toLowerCase();
	if (!q) { return []; }
	const hits: ISearchHit[] = [];
	for (const doc of docs) {
		const body = doc.body.replace(BIND_LINK_RE, '$1');
		const idx = body.toLowerCase().indexOf(q);
		const titleMatch = doc.title.toLowerCase().includes(q);
		if (idx < 0 && !titleMatch) { continue; }
		let snippet: string;
		if (idx >= 0) {
			const start = Math.max(0, idx - 24);
			const end = Math.min(body.length, idx + q.length + 36);
			snippet = (start > 0 ? '...' : '') + body.slice(start, end).replace(/\s+/g, ' ').trim() + (end < body.length ? '...' : '');
		} else {
			snippet = doc.title;
		}
		hits.push({ title: doc.title, resource: doc.resource, snippet });
	}
	return hits;
}
