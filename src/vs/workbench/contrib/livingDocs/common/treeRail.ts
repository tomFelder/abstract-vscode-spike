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
}

export interface ITreeRailFolder {
	readonly name: string;
	readonly items: readonly ITreeRailItem[];
}

export interface ITreeRailDocInput {
	readonly title: string;
	readonly resource: URI;
	readonly pendingCount: number;
	readonly sources: readonly string[];
}

/**
 * The Files-tab folder tree. Living documents land under "Reports"; the distinct sources they bind to
 * land under "Sources" (deduped, kind-tagged). Empty folders are omitted so the rail only shows what
 * the workspace actually has.
 */
export function buildFileTree(docs: readonly ITreeRailDocInput[]): ITreeRailFolder[] {
	const reports: ITreeRailItem[] = [...docs]
		.sort((a, b) => a.title.localeCompare(b.title))
		.map(d => ({ label: d.title, resource: d.resource, kind: 'doc' as const, pending: d.pendingCount > 0 }));

	const seen = new Set<string>();
	const sources: ITreeRailItem[] = [];
	for (const d of docs) {
		for (const s of d.sources) {
			if (seen.has(s)) { continue; }
			seen.add(s);
			sources.push({ label: s, kind: 'source', pending: false, sourceKind: sourceKindOf(s) });
		}
	}
	sources.sort((a, b) => a.label.localeCompare(b.label));

	const folders: ITreeRailFolder[] = [];
	if (reports.length) { folders.push({ name: 'Reports', items: reports }); }
	if (sources.length) { folders.push({ name: 'Sources', items: sources }); }
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
