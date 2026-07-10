/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILivingDoc, SourceKind } from './livingDocsModel.js';
import { sourceKindOf } from './contextGroups.js';

// Pure data shaping for the left tree-rail (the comp's Files / Outline / Search tabs). The Context tab
// reuses `buildContextGroups`; these three helpers cover the rest and are unit-tested independently of
// the DOM view that renders them.

export interface ITreeRailItem {
	readonly label: string;
	/** Present for document rows (clicking opens the editor); absent for non-openable source rows. */
	readonly resource?: URI;
	readonly kind: 'doc' | 'source';
	/** A document with pending meaning-changes shows the amber dot (mirrors the Review count). */
	readonly pending: boolean;
	/** For source rows, the binding kind (file | api | mcp) - drives the row glyph. */
	readonly sourceKind?: SourceKind;
	/**
	 * A plain-words note shown after the label - e.g. "not yet imported" for a `.doc`/`.docx` the beta does
	 * not convert (walk 1a F10). Present only where the row needs to explain itself; never fabricated.
	 */
	readonly note?: string;
}

export interface ITreeRailFolder {
	readonly name: string;
	/**
	 * The folder's depth in the workspace tree (0 = the Reports/Sources top level; >0 = a nested subfolder),
	 * so the view can indent it and preserve hierarchy rather than flatten it (walk 1a F7).
	 */
	readonly depth: number;
	readonly items: readonly ITreeRailItem[];
}

export interface ITreeRailDocInput {
	readonly title: string;
	readonly resource: URI;
	readonly pendingCount: number;
	readonly sources: readonly string[];
	/**
	 * The document's folder path relative to the workspace root, e.g. `reports/2025` (empty for a root-level
	 * document). Drives the nested-folder hierarchy in the Files tab (walk 1a F7).
	 */
	readonly relativeDir: string;
}

/**
 * A non-Markdown workspace file the tree surfaces rather than drops (walk 1a F9/F10). `data` files (csv,
 * txt, image, json) belong in the Sources section; `unsupported` files (`.doc`/`.docx`) are shown marked
 * "not yet imported" so the beta never silently skips them.
 */
export interface ITreeRailFileInput {
	readonly name: string;
	readonly relativeDir: string;
	readonly kind: 'data' | 'unsupported';
	readonly note?: string;
}

// The path segments of a relative dir ("reports/2025" -> ["reports", "2025"]); "" -> []. A leading/trailing
// slash is tolerated so callers need not normalise.
function dirSegments(relativeDir: string): string[] {
	return relativeDir.split('/').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * The Files-tab folder tree. Living documents land under "Reports", their nested subfolders preserved as
 * indented folder headers (walk 1a F7 - no flattening). Bound sources plus any other non-Markdown files in
 * the workspace land under "Sources" (walk 1a F9); `.doc`/`.docx` are shown marked "not yet imported" rather
 * than dropped (walk 1a F10). Empty groups are omitted so the rail only shows what the workspace actually has.
 */
export function buildWorkspaceTree(docs: readonly ITreeRailDocInput[], files: readonly ITreeRailFileInput[] = []): ITreeRailFolder[] {
	const folders: ITreeRailFolder[] = [];

	// --- Reports: a header per distinct document directory, root first, then nested paths in order. ---
	const byDir = new Map<string, ITreeRailItem[]>();
	for (const d of docs) {
		const dir = dirSegments(d.relativeDir).join('/');
		const item: ITreeRailItem = { label: d.title, resource: d.resource, kind: 'doc', pending: d.pendingCount > 0 };
		const bucket = byDir.get(dir);
		if (bucket) { bucket.push(item); } else { byDir.set(dir, [item]); }
	}
	if (byDir.size) {
		const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b));
		// Root documents first under the "Reports" header; each nested directory gets its own indented header.
		if (byDir.has('')) {
			folders.push({ name: 'Reports', depth: 0, items: sortItems(byDir.get('')!) });
		}
		for (const dir of dirs) {
			if (dir === '') { continue; }
			const segs = dirSegments(dir);
			folders.push({ name: segs[segs.length - 1], depth: segs.length, items: sortItems(byDir.get(dir)!) });
		}
	}

	// --- Sources: deduped bound sources + other data files, then the "not yet imported" unsupported files. ---
	const seen = new Set<string>();
	const sources: ITreeRailItem[] = [];
	for (const d of docs) {
		for (const s of d.sources) {
			if (seen.has(s)) { continue; }
			seen.add(s);
			sources.push({ label: s, kind: 'source', pending: false, sourceKind: sourceKindOf(s) });
		}
	}
	for (const f of files) {
		if (f.kind !== 'data' || seen.has(f.name)) { continue; }
		seen.add(f.name);
		sources.push({ label: f.name, kind: 'source', pending: false, sourceKind: 'file' });
	}
	sources.sort((a, b) => a.label.localeCompare(b.label));

	const unsupported: ITreeRailItem[] = [];
	for (const f of files) {
		if (f.kind !== 'unsupported' || seen.has(f.name)) { continue; }
		seen.add(f.name);
		unsupported.push({ label: f.name, kind: 'source', pending: false, sourceKind: 'file', note: f.note });
	}
	unsupported.sort((a, b) => a.label.localeCompare(b.label));

	const sourceItems = [...sources, ...unsupported];
	if (sourceItems.length) { folders.push({ name: 'Sources', depth: 0, items: sourceItems }); }
	return folders;
}

function sortItems(items: ITreeRailItem[]): ITreeRailItem[] {
	return [...items].sort((a, b) => a.label.localeCompare(b.label));
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
