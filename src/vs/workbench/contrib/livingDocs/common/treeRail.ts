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
// image / data file that belongs in the SOURCES section, F9) or `unsupported` (a .doc/.docx and kin marked
// "not yet imported" with a plain-words reason, F10). Anything we should not surface returns undefined.
export function classifyWorkspaceExtra(name: string): { kind: 'source' | 'unsupported'; reason?: string } | undefined {
	if (!name || name.startsWith('.')) { return undefined; }
	const lower = name.toLowerCase();
	// Markdown documents are the Reports tree's job; system sidecars and the agents registry are not user data.
	if (lower.endsWith('.md')) { return undefined; }
	if (lower.endsWith('.lock.json') || lower === 'agents.json') { return undefined; }
	const dot = lower.lastIndexOf('.');
	const ext = dot >= 0 ? lower.slice(dot + 1) : '';
	if (!ext) { return undefined; }
	if (SOURCE_EXTS.has(ext)) { return { kind: 'source' }; }
	const reason = IMPORT_REASONS[ext];
	if (reason) { return { kind: 'unsupported', reason }; }
	return undefined;
}

// Data/source file extensions that belong in the SOURCES section (F9).
const SOURCE_EXTS = new Set(['csv', 'tsv', 'json', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'yaml', 'yml']);

// Formats we cannot yet interpret on open (F10): never silently skipped - the row is shown marked
// "not yet imported - {reason}" so the user sees the file is there and why it is not opened.
const IMPORT_REASONS: Record<string, string> = {
	doc: 'Word documents are not imported yet',
	docx: 'Word documents are not imported yet',
	rtf: 'Rich Text documents are not imported yet',
	odt: 'OpenDocument text is not imported yet',
	pages: 'Pages documents are not imported yet',
	pdf: 'PDFs are not imported yet',
	xls: 'Spreadsheets are not imported yet',
	xlsx: 'Spreadsheets are not imported yet',
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
	const addSource = (label: string, resource?: URI) => {
		if (seen.has(label)) { return; }
		seen.add(label);
		sources.push({ label, resource, kind: 'source', pending: false, sourceKind: sourceKindOf(label) });
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
		if (c.kind === 'source') { addSource(name); continue; }
		if (seenUnsupported.has(name)) { continue; }
		seenUnsupported.add(name);
		unsupported.push({ label: name, kind: 'unsupported', pending: false, note: c.reason });
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
}

const HEADING_PREFIX_RE = /^#{1,6}\s+/;
const BIND_LINK_RE = /\[([^\]]*)\]\(bind:[^)\s]+\)/g;

/** The Outline-tab entries: the document's headings in order, stripped of Markdown syntax. */
export function buildOutline(doc: ILivingDoc | undefined): IOutlineEntry[] {
	if (!doc) { return []; }
	const entries: IOutlineEntry[] = [];
	for (const block of doc.blocks) {
		if (block.type !== 'heading') { continue; }
		const text = block.text.replace(HEADING_PREFIX_RE, '').replace(BIND_LINK_RE, '$1').trim();
		if (text) { entries.push({ text, level: block.level ?? 1 }); }
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
