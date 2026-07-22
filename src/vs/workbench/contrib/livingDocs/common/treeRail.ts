/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { ILivingDoc, SourceKind } from './livingDocsModel.js';
import { sourceKindOf } from './contextGroups.js';
import { docRailDot, IRailDot, sourceRailDot } from './railStatus.js';

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
	/** The count of pending meaning-changes; drives the doc row's amber count pill (P5.3). 0 = no pill. */
	readonly pendingCount: number;
	/** True for a living document (a source is bound): the doc row carries the LWD chip (P5.3). A living doc
	 * with pending changes shows the pending pill instead - pending wins, never both (P5.3). */
	readonly living: boolean;
	/** The leading status indicator (issue #212): a coloured dot for a document, a grey dash for a
	 * source/unsupported row, with the plain-words reason + count in its hover tooltip. */
	readonly dot: IRailDot;
	/** For source rows, the binding kind (file | api | mcp) - drives the row glyph. */
	readonly sourceKind?: SourceKind;
	/** For an `unsupported` (not-yet-imported) row, the plain-words reason; unset otherwise (plan 37 F10). */
	readonly note?: string;
	/** For a workbook/PDF SOURCES row, the "Use as source" action it offers (issue #131). */
	readonly action?: TreeRailAction;
	/** For an `unsupported` row we CAN convert (a `.docx`, issue #129): the row shows an "Import as document"
	 * door instead of a dead reason. Unset (falsy) for a refused format (.doc, password-protected, ...). */
	readonly importable?: boolean;
	/** True when a template-born document still has no source bound (PN.1): the doc row shows the "bind
	 * sources" nudge, inviting the user to connect its data. Clears once a source binds (the doc goes living). */
	readonly needsSourceBinding?: boolean;
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
	/** True when the document has earned "living" status (a source is bound); drives the LWD chip (P5.3). */
	readonly isLiving?: boolean;
	/** The document's directory relative to the workspace root ('' = root), '/'-joined (plan 37 F7). */
	readonly folder?: string;
	// --- Files-rail status-dot inputs (issue #212), mirroring the ILivingDocSummary fields; the tree computes
	// the doc's leading dot from these via `docRailDot`. All default to 0/false (grey) when the caller omits them. ---
	/** Agent auto-applies newer than the doc's last-viewed anchor (the ACTIVE doc reports 0) -> green band. */
	readonly unseenAgentEdits?: number;
	/** Relink-flagged pending proposals for this document -> red band. */
	readonly relinkCount?: number;
	/** True when a binding/context source has drifted since last sync/review -> red band. */
	readonly stale?: boolean;
	/** True when a whole-project fan-out run failed to reach the model for this document -> red band. */
	readonly fanoutFailed?: boolean;
	/** True when a template-born document still has no source bound (PN.1): the doc row shows the "bind
	 * sources" nudge until a source binds. Defaults to false when the caller omits it. */
	readonly needsSourceBinding?: boolean;
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

// The three mono kind glyphs a SOURCES row shows (P5.6, per the mock): a table/data workbook, a
// transcript/note, or any other reference. Kept as named constants so the glyphs live on one line.
// allow-any-unicode-next-line
const SOURCE_GLYPHS = { table: '⊞', transcript: '◍', reference: '◇' } as const;

/**
 * The mono kind glyph a SOURCES row shows (P5.6, per the mock): a table/data workbook, a transcript/note,
 * or any other reference. Pure - the DOM view renders the returned glyph; the classification reads only the
 * source's file extension so it is unit-testable without a service or the wall clock.
 */
export function sourceKindGlyph(label: string): string {
	const dot = label.lastIndexOf('.');
	const ext = dot >= 0 ? label.slice(dot + 1).toLowerCase() : '';
	if (ext === 'csv' || ext === 'tsv' || ext === 'xls' || ext === 'xlsx' || ext === 'json' || ext === 'yaml' || ext === 'yml') { return SOURCE_GLYPHS.table; }
	if (ext === 'md' || ext === 'txt') { return SOURCE_GLYPHS.transcript; }
	return SOURCE_GLYPHS.reference;
}

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
		const dot = docRailDot({
			pendingCount: d.pendingCount,
			unseenAgentEdits: d.unseenAgentEdits ?? 0,
			relinkCount: d.relinkCount ?? 0,
			stale: d.stale ?? false,
			fanoutFailed: d.fanoutFailed ?? false,
		});
		const item: ITreeRailItem = { label: d.title, resource: d.resource, kind: 'doc', pending: d.pendingCount > 0, pendingCount: d.pendingCount, living: d.isLiving ?? false, dot, needsSourceBinding: d.needsSourceBinding ?? false };
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
		const sourceKind = sourceKindOf(label);
		sources.push({ label, resource, kind: 'source', pending: false, pendingCount: 0, living: false, sourceKind, dot: sourceRailDot('source', sourceKind), ...(action ? { action } : {}) });
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
		unsupported.push({ label: name, kind: 'unsupported', pending: false, pendingCount: 0, living: false, note: c.reason, importable: c.importable, dot: sourceRailDot('unsupported', undefined, c.reason) });
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

/** Id of the collapsed screenshot bucket under Sources; the view seeds this collapsed on first open (issue #171). */
export const ASSETS_FOLDER_ID = 'folder:Sources/Assets';

/** Id of the MRU "Recent" group above Reports (issue #212). Its leaf ids carry a distinct prefix so a document
 * that appears BOTH in Recent and in Reports keeps two collision-free ids (the identityProvider stays unique). */
export const RECENT_FOLDER_ID = 'folder:Recent';

/** The largest number of documents the Recent group ever shows (issue #212); older MRU entries are dropped. */
export const RECENT_GROUP_CAP = 5;

/** Every Assets bucket id present in a node tree, so the view can seed them collapsed on first build (issue #171). */
export function collectAssetsFolderIds(nodes: readonly ITreeRailNode[]): string[] {
	const ids: string[] = [];
	const walk = (node: ITreeRailNode): void => {
		if (node.type !== 'folder') { return; }
		if (node.id === ASSETS_FOLDER_ID) { ids.push(node.id); }
		for (const c of node.children) { walk(c); }
	};
	for (const n of nodes) { walk(n); }
	return ids;
}

/**
 * The node tree the Files tab renders on the VS Code tree widget (issue #171). Reuses `buildFileTree` for
 * the grouping + on-disk hierarchy, then:
 *  - buckets un-bound image/screenshot assets behind one collapsed "Assets" node so ~200 screenshots never
 *    flood the default view (sources that ARE bound to a document stay visible in Sources);
 *  - assigns every node a stable id (path-based for folders) for selection + persisted collapse state.
 * Empty groups are omitted. Pure - the widget wiring lives in the view.
 */
export function buildTreeRailNodes(docs: readonly ITreeRailDocInput[], extras: readonly string[] = [], recentResources: readonly URI[] = []): ITreeRailNode[] {
	const folders = buildFileTree(docs, extras);
	// Sources a document actually binds to stay visible even when they are images (a bound chart PNG is data,
	// not noise); only un-bound loose screenshots are bucketed into the collapsed Assets node (issue #171).
	const boundLabels = new Set<string>();
	for (const d of docs) { for (const s of d.sources) { boundLabels.add(s); } }
	// A leaf's stable identity for the tree's identityProvider (selection reconcile + persisted state). Two
	// documents in the same folder can share a title, so a label-based id would collide and let the tree
	// select/reconcile the wrong row. The on-disk resource is unique, so use it when present; only rows with
	// no backing file (e.g. an api/mcp source) fall back to `kind:label`, which is unique among those rows.
	const leafId = (idPrefix: string, item: ITreeRailItem): string =>
		`${idPrefix}/leaf:${item.resource ? item.resource.toString() : `${item.kind}:${item.label}`}`;
	const toNodes = (group: ITreeRailFolder, idPrefix: string): ITreeRailNode[] => {
		const nodes: ITreeRailNode[] = [];
		for (const sub of group.folders) {
			const id = `${idPrefix}/${sub.name}`;
			nodes.push({ type: 'folder', id, label: sub.name, children: toNodes(sub, id) });
		}
		for (const item of group.items) {
			nodes.push({ type: 'leaf', id: leafId(idPrefix, item), item });
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
			const children: ITreeRailNode[] = visible.map(item => ({ type: 'leaf', id: leafId(id, item), item }));
			if (assets.length) {
				const assetsId = ASSETS_FOLDER_ID;
				children.push({
					type: 'folder',
					id: assetsId,
					label: `Assets (${assets.length})`,
					children: assets.map(item => ({ type: 'leaf', id: leafId(assetsId, item), item })),
				});
			}
			if (children.length) { result.push({ type: 'folder', id, label: group.name, children }); }
			continue;
		}
		result.push({ type: 'folder', id, label: group.name, children: toNodes(group, id) });
	}

	// --- Recent: an MRU shortcut group above Reports (issue #212) ---
	// A collapsible "Recent" group of the most-recently-opened documents, capped at RECENT_GROUP_CAP and shown
	// only when it holds at least two (one recent doc is not worth a whole group). Each row reuses the SAME doc
	// item (so it carries the same status dot) but under the distinct RECENT_FOLDER_ID prefix, so a document that
	// also appears in Reports keeps two collision-free ids. The on-disk hierarchy below is untouched.
	const docItemByResource = new Map<string, ITreeRailItem>();
	for (const d of docs) {
		docItemByResource.set(d.resource.toString(), { label: d.title, resource: d.resource, kind: 'doc', pending: d.pendingCount > 0, pendingCount: d.pendingCount, living: d.isLiving ?? false, dot: docRailDot({ pendingCount: d.pendingCount, unseenAgentEdits: d.unseenAgentEdits ?? 0, relinkCount: d.relinkCount ?? 0, stale: d.stale ?? false, fanoutFailed: d.fanoutFailed ?? false }), needsSourceBinding: d.needsSourceBinding ?? false });
	}
	const recentItems: ITreeRailItem[] = [];
	const seenRecent = new Set<string>();
	for (const resource of recentResources) {
		const key = resource.toString();
		if (seenRecent.has(key)) { continue; }
		const item = docItemByResource.get(key);
		if (!item) { continue; } // a history entry that is not a current folder document is skipped
		seenRecent.add(key);
		recentItems.push(item);
		if (recentItems.length >= RECENT_GROUP_CAP) { break; }
	}
	if (recentItems.length >= 2) {
		const recentChildren: ITreeRailNode[] = recentItems.map(item => ({ type: 'leaf', id: `${RECENT_FOLDER_ID}/leaf:${item.resource!.toString()}`, item }));
		result.unshift({ type: 'folder', id: RECENT_FOLDER_ID, label: 'Recent', children: recentChildren });
	}
	return result;
}

/**
 * Narrow the Files tree to the rows whose label matches `query` (case-insensitive substring), keeping every
 * ancestor folder of a match so the match stays reachable in place - the type-to-filter that folds the old
 * Search tab into Files (P4.2). A blank query returns the tree unchanged. A folder whose own name matches is
 * kept whole (all its rows), so filtering by a folder name reveals that folder's contents.
 *
 * `bodyMatchResources` restores the old Search tab's body-content reach (P4.2): its keys are the
 * `resource.toString()` of documents whose *body text* matched the query (computed by the view via
 * `searchTreeRail`, so the title-OR-body matching lives in exactly one place). A document leaf is kept when
 * its label matches OR its resource is in that set, so a doc findable only by a body phrase still surfaces in
 * the tree (as a plain row - the tree has no inline snippet affordance). Pure - the DOM view feeds it the
 * built node tree and re-renders with the pruned result; no widget state is touched here.
 */
export function filterTreeRailNodes(nodes: readonly ITreeRailNode[], query: string, bodyMatchResources: ReadonlySet<string> = new Set()): ITreeRailNode[] {
	const q = query.trim().toLowerCase();
	if (!q) { return [...nodes]; }
	const prune = (node: ITreeRailNode): ITreeRailNode | undefined => {
		if (node.type === 'leaf') {
			if (node.item.label.toLowerCase().includes(q)) { return node; }
			// A document whose body text matched (per `searchTreeRail`) is kept even though its label does not,
			// so a phrase that only appears in the body still finds the doc - the old Search tab's reach.
			return node.item.resource && bodyMatchResources.has(node.item.resource.toString()) ? node : undefined;
		}
		// A folder whose own name matches is kept whole so its rows stay visible; otherwise keep only the
		// branches that still hold a match, dropping folders that prune down to nothing.
		if (node.label.toLowerCase().includes(q)) { return node; }
		const children = node.children.map(prune).filter((c): c is ITreeRailNode => c !== undefined);
		return children.length ? { ...node, children } : undefined;
	};
	return nodes.map(prune).filter((n): n is ITreeRailNode => n !== undefined);
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
const SETEXT_UNDERLINE_RE = /^(?<indent> *)(?<underline>=+|-+)[ \t]*$/;
const BLOCKQUOTE_RE = /^ {0,3}(?:> ?)+/;
const BLANK_RE = /^[ \t]*$/;
// A single leading list-item marker: an unordered bullet (`-`/`*`/`+`) or an ordered marker (`1.`/`1)`),
// with up to three leading spaces and at least one space before the content. Capturing the whole marker
// prefix gives the item's CONTENT column, which is what a setext underline must reach to still underline
// the item's text (see `scanRenderedHeadings`). One level only - markdown-it renders `- # x` as a heading
// inside the `<li>`, which is the case that shifts the outline; deep nesting is out of scope.
const LIST_MARKER_RE = /^(?<marker> {0,3}(?:[-*+]|\d{1,9}[.)]) +)/;

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
 *   - headings nested in a blockquote (the `>` markers are stripped, then the line is re-tested);
 *   - headings nested in a list item (`- # x`, `1. # x`): the single leading list marker is stripped the
 *     same way `>` is, then the inner line is re-tested. A setext underline that follows must reach the
 *     item's CONTENT column (marker width) - and sit no more than three columns past it - to still
 *     underline the item's text, exactly as markdown-it renders it; a less-indented `===` is a lazy
 *     paragraph continuation (no heading) and a more-indented one is an indented code block (no heading).
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
	// The column at which `prevContent`'s text began (0 for a top-level line, the list marker width for a
	// list item). A following setext underline must sit within [column, column + 3] to underline it.
	let prevContentColumn = 0;
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
		const dequoted = rawLine.replace(BLOCKQUOTE_RE, '');
		// A list-item-nested heading renders too: strip a single leading list marker, then judge the content
		// (markdown-it renders `- # x` / `1. # x` as an `<hN>` inside the `<li>`). The marker width is the
		// item's content column, which a setext underline for this item must reach to still underline it.
		const marker = LIST_MARKER_RE.exec(dequoted);
		const line = marker ? dequoted.slice(marker.groups!.marker.length) : dequoted;
		const column = marker ? marker.groups!.marker.length : 0;

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

		// A setext underline is measured against the blockquote-stripped line (the `>` markers are already
		// gone, so `> Foo` / `> ===` still underlines) but BEFORE the list marker is stripped, so its own
		// indentation can be compared to the underlined content's column: markdown-it treats an underline as
		// setext only when it is indented within [column, column + 3]; less is a lazy paragraph continuation,
		// more is code. (The underline line itself carries no list marker - it is the item's continuation.)
		const underline = SETEXT_UNDERLINE_RE.exec(dequoted);
		if (underline && prevContent !== undefined) {
			const relative = underline.groups!.indent.length - prevContentColumn;
			if (relative >= 0 && relative <= 3) {
				// A setext heading: the previous content line underlined by `=` (h1) or `-` (h2).
				headings.push({ level: underline.groups!.underline[0] === '=' ? 1 : 2, text: prevContent.trim() });
				prevContent = undefined;
				continue;
			}
		}

		if (BLANK_RE.test(line)) {
			prevContent = undefined;
		} else {
			prevContent = line;
			prevContentColumn = column;
		}
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
