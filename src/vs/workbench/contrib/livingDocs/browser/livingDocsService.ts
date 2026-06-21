/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ILivingDocsService, ILivingDocSummary, LivingDocsPanelTab, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { extractBindLinks, parseLivingDoc, reconcileBindLinks, serializeLivingDoc } from '../common/livingDocMarkdown.js';
import { renderExportHtml, renderExportMarkdown } from './livingDocRender.js';
import { IAuditEntry, ILivingDoc, IProposedChange, SourceKind } from '../common/livingDocsModel.js';

// A resolved value for one bind key, plus the source hash it was read from. The lock file (Item 2)
// will persist these; in Item 1 they are re-derived from the sources on each load/refresh.
interface IResolved {
	readonly value: string;
	readonly sourceHash: string;
}

// Everything we hold for one open or discovered document.
interface IDocState {
	readonly uri: URI;
	doc: ILivingDoc;
	rawText: string;
	resolved: Map<string, IResolved>;   // bind key -> resolved value (+ source hash)
	recent: Set<string>;                // block ids changed in the last resolve (for the highlight)
	status: string;
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
const pct = (a: number, b: number) => `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%`;

// A tiny, order-independent string hash (FNV-1a) for cheap source-change detection. Not crypto.
function hashString(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

// Classify a frontmatter source string into a source kind for the home-row chips.
function sourceKind(source: string): SourceKind {
	return /^https?:\/\//.test(source) ? 'api' : 'file';
}

// The alias a bind key uses for a source file: "metrics.csv" -> "metrics", "market-research.md" ->
// "market-research". Bind keys are "<alias>.<field>" (with an optional ".<qualifier>").
function sourceAlias(source: string): string {
	const name = source.split('/').pop() ?? source;
	return name.replace(/\.[^.]+$/, '');
}

// The "New document" starting point: clean Markdown the user owns. It becomes a Living Document once
// a source is connected (a `sources:`/`context:` entry or a bind link appears). Authored as a single
// left-aligned template literal so source indentation stays tab-only.
const NEW_DOCUMENT_TEMPLATE = `---
title: Untitled document
---

## Overview

Write your document here. Connect a source to start binding live figures.
`;

export class LivingDocsService extends Disposable implements ILivingDocsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidRequestPanel = this._register(new Emitter<LivingDocsPanelTab>());
	readonly onDidRequestPanel: Event<LivingDocsPanelTab> = this._onDidRequestPanel.event;

	private readonly _docs = new Map<string, IDocState>();
	private _pending: IProposedChange[] = [];
	private _audit: IAuditEntry[] = [];

	constructor(
		@IFileService private readonly _files: IFileService,
		@IEditorService private readonly _editors: IEditorService,
		@IViewsService private readonly _views: IViewsService,
		@ILanguageModelsService _lm: ILanguageModelsService,
		@IConfigurationService _config: IConfigurationService,
		@INotificationService private readonly _notify: INotificationService,
		@ILogService private readonly _log: ILogService,
		@IRequestService private readonly _request: IRequestService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
	) {
		super();
	}

	// --- per-document views ---

	getDoc(resource: URI): ILivingDoc | undefined { return this._docs.get(resource.toString())?.doc; }
	getRawText(resource: URI): string { return this._docs.get(resource.toString())?.rawText ?? ''; }
	getStatus(resource: URI): string { return this._docs.get(resource.toString())?.status ?? 'No document'; }
	getRecentlyApplied(resource: URI): ReadonlySet<string> { return this._docs.get(resource.toString())?.recent ?? new Set<string>(); }
	getResolved(resource: URI): ReadonlyMap<string, string> {
		const out = new Map<string, string>();
		const state = this._docs.get(resource.toString());
		if (state) { for (const [key, r] of state.resolved) { out.set(key, r.value); } }
		return out;
	}
	getPendingForDoc(resource: URI): readonly IProposedChange[] {
		const id = resource.toString();
		return this._pending.filter(c => c.docId === id);
	}

	// --- workspace-wide views ---

	getAllPending(): readonly IProposedChange[] { return this._pending; }
	getAudit(): readonly IAuditEntry[] { return this._audit; }

	focusPanel(tab: LivingDocsPanelTab): void {
		this._onDidRequestPanel.fire(tab);
		// Reveal the right panel; take focus only for Chat so the user can type straight away.
		this._views.openView(REVIEW_RAIL_VIEW_ID, tab === 'chat').catch(e => this._log.warn('[livingDocs] focusPanel failed', e));
	}

	// --- the "Documents" home ---

	async listDocuments(): Promise<readonly ILivingDocSummary[]> {
		const found = new Map<string, URI>();
		// Always include documents already loaded (e.g. the open editor), even if discovery misses them.
		for (const state of this._docs.values()) {
			if (state.doc.isLiving) { found.set(state.uri.toString(), state.uri); }
		}
		// Scan each workspace folder for Living Documents so the home renders before anything is opened.
		for (const folder of this._workspace.getWorkspace().folders) {
			await this._collectLivingDocs(folder.uri, found, 0);
		}
		const summaries: ILivingDocSummary[] = [];
		for (const uri of found.values()) {
			const summary = await this._summarize(uri);
			if (summary) { summaries.push(summary); }
		}
		summaries.sort((a, b) => a.title.localeCompare(b.title));
		return summaries;
	}

	async createDocument(): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) {
			this._notify.info('Open a folder to create a document.');
			return undefined;
		}
		const target = await this._uniqueDocUri(folder.uri);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(NEW_DOCUMENT_TEMPLATE));
			await this._editors.openEditor({ resource: target, options: { pinned: true } });
			this._onDidChange.fire();
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] create document failed', e);
			return undefined;
		}
	}

	// Recursively collect Living Documents (clean `.md` with bind links / dependency frontmatter, or a
	// sibling lock) under a folder, skipping hidden and dependency directories. Bounded in depth so a
	// large workspace can never make the home hang.
	private async _collectLivingDocs(dir: URI, found: Map<string, URI>, depth: number): Promise<void> {
		if (depth > 4) { return; }
		let children;
		try {
			children = (await this._files.resolve(dir)).children ?? [];
		} catch (e) {
			this._log.trace('[livingDocs] documents scan skipped', e instanceof Error ? e.message : String(e));
			return;
		}
		for (const child of children) {
			const name = basename(child.resource);
			if (child.isDirectory) {
				if (name.startsWith('.') || name === 'node_modules' || name === 'out') { continue; }
				await this._collectLivingDocs(child.resource, found, depth + 1);
			} else if (await this._isLivingDocFile(child.resource)) {
				found.set(child.resource.toString(), child.resource);
			}
		}
	}

	// A `.md` is a Living Document when its content declares sources/context or carries bind links, or
	// when a sibling `<doc>.lock.json` exists. Generated `.export.md` / `.source.md` views are skipped.
	private async _isLivingDocFile(resource: URI): Promise<boolean> {
		const path = resource.path;
		if (!path.endsWith('.md') || path.endsWith('.export.md') || path.endsWith('.source.md')) { return false; }
		try {
			const text = (await this._files.readFile(resource)).value.toString();
			return parseLivingDoc(text).isLiving;
		} catch {
			return false;
		}
	}

	private async _summarize(uri: URI): Promise<ILivingDocSummary | undefined> {
		try {
			const raw = (await this._files.readFile(uri)).value.toString();
			const doc = parseLivingDoc(raw);
			const kinds = new Set<SourceKind>();
			for (const source of doc.sources) { kinds.add(sourceKind(source)); }
			const id = uri.toString();
			const bound = doc.blocks.reduce((n, b) => n + b.binds.length, 0);
			return {
				resource: uri,
				title: doc.title,
				isLiving: doc.isLiving,
				sourceKinds: [...kinds],
				lastSynced: doc.context.length ? `${doc.context.length} context` : (bound ? `${bound} bound` : ''),
				pendingCount: this._pending.filter(c => c.docId === id).length,
			};
		} catch (e) {
			this._log.trace('[livingDocs] summarize skipped', e instanceof Error ? e.message : String(e));
			return undefined;
		}
	}

	private async _uniqueDocUri(folder: URI): Promise<URI> {
		const existing = new Set<string>();
		try {
			for (const child of (await this._files.resolve(folder)).children ?? []) {
				existing.add(basename(child.resource));
			}
		} catch {
			// An unreadable folder just means no collisions to avoid.
		}
		let name = 'Untitled.md';
		for (let n = 2; existing.has(name); n++) {
			name = `Untitled ${n}.md`;
		}
		return joinPath(folder, name);
	}

	// --- loading ---

	async loadDocument(resource: URI): Promise<void> {
		const state = await this._loadState(resource);
		if (state) {
			// Resolve bind links from the sources so the rendered doc can show current values. Load is
			// read-only: the on-disk cache is reconciled at render time (lock wins) and persisted only
			// on an explicit refresh/save.
			await this._resolveSources(state);
			state.recent = new Set<string>();
		}
		this._onDidChange.fire();
	}

	private async _loadState(resource: URI): Promise<IDocState | undefined> {
		let rawText: string;
		let doc: ILivingDoc;
		try {
			rawText = (await this._files.readFile(resource)).value.toString();
			doc = parseLivingDoc(rawText);
		} catch (e) {
			this._log.error('[livingDocs] failed to parse document', e);
			this._docs.delete(resource.toString());
			return undefined;
		}
		const state: IDocState = {
			uri: resource,
			doc,
			rawText,
			resolved: new Map<string, IResolved>(),
			recent: this._docs.get(resource.toString())?.recent ?? new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
		};
		this._docs.set(resource.toString(), state);
		return state;
	}

	// Read every `sources:` file and build the bind-key -> resolved value map. A CSV produces the
	// latest row's columns (plus `.prev` / `.delta` qualifiers); an api/JSON source produces its
	// top-level fields. Influence (`context:`) sources are not value-resolved here (see Item 5).
	private async _resolveSources(state: IDocState): Promise<void> {
		const resolved = new Map<string, IResolved>();
		for (const source of state.doc.sources) {
			const alias = sourceAlias(source);
			if (sourceKind(source) === 'api') {
				await this._resolveApiSource(state, source, alias, resolved);
				continue;
			}
			const uri = joinPath(dirname(state.uri), source);
			let text: string;
			try {
				text = (await this._files.readFile(uri)).value.toString();
			} catch (e) {
				this._log.warn('[livingDocs] source unreadable', source, e instanceof Error ? e.message : String(e));
				continue;
			}
			if (source.endsWith('.csv')) {
				this._resolveCsv(text, alias, resolved);
			}
		}
		state.resolved = resolved;
	}

	private _resolveCsv(text: string, alias: string, resolved: Map<string, IResolved>): void {
		const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
		if (lines.length < 2) { return; }
		const cols = lines[0].split(',').map(c => c.trim());
		const rows = lines.slice(1).map(l => l.split(','));
		const latest = rows[rows.length - 1];
		const prev = rows.length >= 2 ? rows[rows.length - 2] : undefined;
		const hash = hashString(lines[lines.length - 1]);
		for (let i = 0; i < cols.length; i++) {
			const col = cols[i];
			const cur = (latest[i] ?? '').trim();
			resolved.set(`${alias}.${col}`, { value: this._formatCell(col, cur), sourceHash: hash });
			if (prev) {
				const pv = (prev[i] ?? '').trim();
				resolved.set(`${alias}.${col}.prev`, { value: this._formatCell(col, pv), sourceHash: hash });
				const delta = this._deltaCell(col, pv, cur);
				if (delta) { resolved.set(`${alias}.${col}.delta`, { value: delta, sourceHash: hash }); }
			}
		}
	}

	// Spike-specific presentation for the sample metrics schema: currency in $k, churn as a percent,
	// everything else as-is. A real build would carry formatting hints in the source connector.
	private _formatCell(col: string, value: string): string {
		const n = Number(value);
		if (col === 'mrr' && !isNaN(n)) { return `$${k(n)}`; }
		if (col === 'churn' && !isNaN(n)) { return `${value}%`; }
		return value;
	}

	private _deltaCell(col: string, prev: string, cur: string): string | undefined {
		const a = Number(prev), b = Number(cur);
		if (isNaN(a) || isNaN(b)) { return undefined; }
		if (col === 'churn') { return `${b >= a ? '+' : ''}${(b - a).toFixed(1)}pt`; }
		if (col === 'mrr' || col === 'signups' || col === 'active') { return pct(a, b); }
		return undefined;
	}

	private async _resolveApiSource(state: IDocState, url: string, alias: string, resolved: Map<string, IResolved>): Promise<void> {
		try {
			const context = await this._request.request({ type: 'GET', url, callSite: 'livingDocs.apiSource' }, CancellationToken.None);
			const json = await asJson<Record<string, unknown>>(context);
			if (!json) { return; }
			const hash = hashString(JSON.stringify(json));
			for (const key of Object.keys(json)) {
				const value = json[key];
				const text = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
				resolved.set(`${alias}.${key}`, { value: text, sourceHash: hash });
			}
		} catch (e) {
			this._log.warn('[livingDocs] api source failed', e instanceof Error ? e.message : String(e));
		}
	}

	// Reconcile each block's visible bind-link cache to the resolved values (value bindings are
	// figures -> auto-apply), auditing and flagging each block whose value moved. Mutates the in-memory
	// doc; the caller persists. Used on an explicit refresh - render-time reconciliation is read-only.
	private _reconcile(state: IDocState): void {
		const resolved = this.getResolved(state.uri);
		for (const block of state.doc.blocks) {
			if (block.binds.length === 0) { continue; }
			const next = reconcileBindLinks(block.text, resolved);
			if (next === block.text) { continue; }
			this._audit.push(this._entry(state.doc.title, block.id, 'auto-applied', block.text, next, 'heuristic'));
			block.text = next;
			block.binds = extractBindLinks(next);
			state.recent.add(block.id);
		}
	}

	async saveRawText(resource: URI, text: string): Promise<void> {
		const id = resource.toString();
		const doc = parseLivingDoc(text);
		const state: IDocState = {
			uri: resource,
			doc,
			rawText: text,
			resolved: new Map<string, IResolved>(),
			recent: new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
		};
		try {
			await this._files.writeFile(resource, VSBuffer.fromString(text));
		} catch (e) {
			this._log.warn('[livingDocs] raw save failed', e);
		}
		this._docs.set(id, state);
		await this._resolveSources(state);
		this._onDidChange.fire();
	}

	async exportDocument(resource: URI): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const html = renderExportHtml(state.doc, this.getResolved(resource));
		const stem = basename(resource).replace(/\.md$/, '');
		const target = joinPath(dirname(resource), `${stem}.export.html`);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(html));
			await this._editors.openEditor({ resource: target, options: { pinned: true } }, SIDE_GROUP);
			this._notify.info(`Exported "${state.doc.title}" to ${basename(target)}.`);
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] export failed', e);
			return undefined;
		}
	}

	async exportMarkdown(resource: URI): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const markdown = renderExportMarkdown(state.doc, this.getResolved(resource));
		const stem = basename(resource).replace(/\.md$/, '');
		const target = joinPath(dirname(resource), `${stem}.export.md`);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(markdown));
			await this._editors.openEditor({ resource: target, options: { pinned: true } }, SIDE_GROUP);
			this._notify.info(`Exported "${state.doc.title}" to ${basename(target)}.`);
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] markdown export failed', e);
			return undefined;
		}
	}

	shareDocument(resource: URI): void {
		// Live shareable links aren't built yet; point the user at the portable export for now.
		this._notify.info('A live shareable link is coming soon. Use Download to send a Markdown copy in the meantime.');
	}

	async editBlock(resource: URI, blockId: string, text: string): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === blockId);
		// Only non-bound prose/headings are hand-editable; bound blocks stay driven by their source.
		if (!block || block.binds.length > 0) { return; }
		const next = text.trim();
		if (block.text === next) { return; }
		block.text = next;
		await this._persist(state);
		this._onDidChange.fire();
	}

	// --- the fan-out refresh ---

	async refreshFromSources(): Promise<void> {
		// Re-derive every bound document in the workspace, not just the open one.
		const uris = await this._discoverLivingDocUris();
		let derived = 0;
		for (const uri of uris) {
			let state = this._docs.get(uri.toString());
			if (!state) { state = await this._loadState(uri); }
			if (!state || !state.doc.isLiving) { continue; }
			state.recent = new Set<string>();
			await this._resolveSources(state);
			this._reconcile(state);
			if (state.recent.size) { await this._persist(state); }
			derived++;
		}

		for (const state of this._docs.values()) {
			if (state.doc.isLiving) { state.status = `${derived} document${derived === 1 ? '' : 's'} synced`; }
		}
		this._onDidChange.fire();
	}

	// --- approve / reject (the review rail; populated by the Review-impact pass in Item 5) ---

	async approve(changeId: string): Promise<void> {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		const state = this._docs.get(change.docId);
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === change.blockId);
		if (block) { block.text = change.newText; block.binds = extractBindLinks(change.newText); }
		this._pending = this._pending.filter(c => c.id !== changeId);
		this._audit.push(this._entry(change.docTitle, change.blockId, 'approved', change.oldText, change.newText, 'model'));
		state.status = `Change approved - applied to ${change.docTitle}`;
		await this._persist(state);
		this._onDidChange.fire();
	}

	reject(changeId: string): void {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		this._audit.push(this._entry(change.docTitle, change.blockId, 'rejected', change.oldText, change.newText, 'model'));
		const state = this._docs.get(change.docId);
		if (state) {
			state.status = `Change rejected - ${change.docTitle} left unchanged`;
		}
		this._onDidChange.fire();
	}

	async revealSource(resource: URI, cells: readonly string[]): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		// Open a clean, styled source view side-by-side: each bound key with its resolved value, and
		// the documents that reference these sources (an interim toward the full hi-fi source pane).
		const md = this._renderSourceMarkdown(state, cells);
		const source = state.doc.sources[0] ?? 'source';
		const stem = sourceAlias(source);
		const target = joinPath(dirname(resource), `${stem}.source.md`);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(md));
			await this._editors.openEditor({ resource: target, options: { pinned: true } }, SIDE_GROUP);
		} catch (e) {
			this._log.warn('[livingDocs] reveal source failed', e);
		}
	}

	private _renderSourceMarkdown(state: IDocState, cells: readonly string[]): string {
		const selected = new Set(cells);
		const rows = [...state.resolved.entries()].map(([key, r]) => {
			const mark = selected.has(key) ? `**${key}**` : key;
			const value = selected.has(key) ? `**${r.value}**` : r.value;
			return `| ${mark} | ${value} |`;
		}).join('\n');
		const referencedBy = [...this._docs.values()]
			.filter(s => s.doc.isLiving && s.doc.sources.some(src => state.doc.sources.includes(src)))
			.map(s => s.doc.title);
		const refs = referencedBy.length ? `## Referenced by\n\n${referencedBy.map(t => `- ${t}`).join('\n')}` : '';
		const sources = state.doc.sources.join(', ') || 'sources';
		return [
			`# ${sources}`,
			`Live sources for "${state.doc.title}". Bound keys for the selected text are emphasized.`,
			'',
			`| Key | Resolved |\n| --- | --- |\n${rows}`,
			'',
			refs,
		].join('\n').replace(/\n+$/, '\n');
	}

	// --- discovery + persistence ---

	private async _discoverLivingDocUris(): Promise<URI[]> {
		const found = new Map<string, URI>();
		// Always include documents already loaded (e.g. the open editor).
		for (const state of this._docs.values()) { found.set(state.uri.toString(), state.uri); }
		// Scan the directory of each loaded document for sibling Living Documents.
		const dirs = new Map<string, URI>();
		for (const state of this._docs.values()) {
			const dir = dirname(state.uri);
			dirs.set(dir.toString(), dir);
		}
		for (const dir of dirs.values()) {
			try {
				const stat = await this._files.resolve(dir);
				for (const child of stat.children ?? []) {
					if (!child.isDirectory && await this._isLivingDocFile(child.resource)) {
						found.set(child.resource.toString(), child.resource);
					}
				}
			} catch (e) {
				// Directory listing is unavailable (e.g. in unit tests); the loaded set still applies.
				this._log.trace('[livingDocs] directory scan skipped', e instanceof Error ? e.message : String(e));
			}
		}
		return [...found.values()];
	}

	private _entry(docTitle: string, blockId: string, action: IAuditEntry['action'], oldText: string, newText: string, via: IAuditEntry['via']): IAuditEntry {
		return { time: new Date().toISOString(), docTitle, blockId, action, oldText, newText, via };
	}

	private async _persist(state: IDocState): Promise<void> {
		try {
			const serialized = serializeLivingDoc(state.doc);
			state.rawText = serialized;
			await this._files.writeFile(state.uri, VSBuffer.fromString(serialized));
		} catch (e) {
			this._log.warn('[livingDocs] persist failed', e);
		}
	}
}
