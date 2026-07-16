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

// Image / screenshot extensions. These ARE valid sources, but with a real folder open they flood the
// default view (~200 screenshot PNGs in the repo docs folder, issue #171). The tree buckets any asset
// that is not bound to a document behind a single collapsed "Assets" node so it never floods the pane.
const ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);

/** True when `name` is an image/screenshot asset (drives the tree's collapsed "Assets" bucket, issue #171). */
export function isAssetName(name: string): boolean {
	const dot = name.lastIndexOf('.');
	return dot >= 0 && ASSET_EXTS.has(name.slice(dot + 1).toLowerCase());
}

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

// --- The Files-tab tree model (issue #171) ---
// `buildFileTree` above shapes the raw grouping (Reports / Sources / Not-yet-imported, on-disk hierarchy).
// `buildTreeRailNodes` below turns that into the node model the `WorkbenchObjectTree` renders: a `folder`
// node (a group header or a real on-disk directory, collapsible) or a `leaf` node (a document / source /
// unsupported row, carrying the underlying `ITreeRailItem`). Every node has a stable `id` so the tree can
// keep identity (selection, focus, and persisted collapse state) across re-renders. Kept pure and unit-
// tested; the DOM view (`treeRailView.ts`) owns only widget wiring.

/** A collapsible folder in the Files tree: a top-level group (Reports/Sources/...) or a real disk directory. */
export interface ITreeRailFolderNode {
	readonly type: 'folder';
	/** Stable identity for tree selection + persisted collapse state (e.g. "folder:Reports/reports/2025"). */
	readonly id: string;
	readonly label: string;
	readonly children: readonly ITreeRailNode[];
}

/** A leaf row in the Files tree: a document, a source, or a not-yet-imported file. Carries the raw item. */
export interface ITreeRailLeafNode {
	readonly type: 'leaf';
	readonly id: string;
	readonly item: ITreeRailItem;
}

export type ITreeRailNode = ITreeRailFolderNode | ITreeRailLeafNode;

/**
 * The node tree the Files tab renders on the VS Code tree widget (issue #171). Reuses `buildFileTree` for
 * the grouping + on-disk hierarchy, then:
 *  - buckets un-bound image/screenshot assets behind one collapsed "Assets" node so ~200 screenshots never
 *    flood the default view (sources that ARE bound to a document stay visible in Sources);
 *  - assigns every node a stable id (path-based for folders) for selection + persisted collapse state.
 * Empty groups are omitted. Pure - the widget wiring lives in the view.
 */
export function buildTreeRailNodes(docs: readonly ITreeRailDocInput[], extras: readonly string[] = []): ITreeRailNode[] {
	const folders = buildFileTree(docs, extras);
	// Sources a document actually binds to stay visible even when they are images (a bound chart PNG is data,
	// not noise); only un-bound loose screenshots are bucketed into the collapsed Assets node (issue #171).
	const boundLabels = new Set<string>();
	for (const d of docs) { for (const s of d.sources) { boundLabels.add(s); } }
	const toNodes = (group: ITreeRailFolder, idPrefix: string): ITreeRailNode[] => {
		const nodes: ITreeRailNode[] = [];
		for (const sub of group.folders) {
			const id = `${idPrefix}/${sub.name}`;
			nodes.push({ type: 'folder', id, label: sub.name, children: toNodes(sub, id) });
		}
		for (const item of group.items) {
			nodes.push({ type: 'leaf', id: `${idPrefix}/leaf:${item.label}`, item });
		}
		return nodes;
	};
	const result: ITreeRailNode[] = [];
	for (const group of folders) {
		const id = `folder:${group.name}`;
		if (group.name === 'Sources') {
			// Split the flat Sources list: un-bound image assets go behind one collapsed child so the default
			// view is calm; bound sources + all data files (csv/json/txt) stay directly visible.
			const isAsset = (label: string) => isAssetName(label) && !boundLabels.has(label);
			const visible = group.items.filter(i => !isAsset(i.label));
			const assets = group.items.filter(i => isAsset(i.label));
			const children: ITreeRailNode[] = visible.map(item => ({ type: 'leaf', id: `${id}/leaf:${item.label}`, item }));
			if (assets.length) {
				const assetsId = `${id}/Assets`;
				children.push({
					type: 'folder',
					id: assetsId,
					label: `Assets (${assets.length})`,
					children: assets.map(item => ({ type: 'leaf', id: `${assetsId}/leaf:${item.label}`, item })),
				});
			}
			if (children.length) { result.push({ type: 'folder', id, label: group.name, children }); }
			continue;
		}
		result.push({ type: 'folder', id, label: group.name, children: toNodes(group, id) });
	}
	return result;
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
