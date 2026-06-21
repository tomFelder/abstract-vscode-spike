/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ChatMessageRole, IChatMessage, ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ILivingDocsService, ILivingDocSummary, LivingDocsPanelTab, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { extractBindLinks, parseLivingDoc, reconcileBindLinks, serializeLivingDoc } from '../common/livingDocMarkdown.js';
import { renderExportHtml, renderExportMarkdown } from './livingDocRender.js';
import { ILockStore, SidecarLockStore } from './livingDocLockStore.js';
import { AgentOrchestrator, IAgentRunContext } from './agentOrchestrator.js';
import { WorkspaceAgentStore } from './agentStore.js';
import { AgentPolicy, emptyLock, IAgentDef, IAuditEntry, IBindingEntry, IFreshness, ILivingDoc, ILivingDocLock, IProposedChange, SourceKind } from '../common/livingDocsModel.js';

// One freshly-read source value for a bind key, before it is written into the lock.
interface IResolution {
	readonly value: string;
	readonly sourceHash: string;
	readonly source: string;        // human-ish origin, e.g. "metrics.csv#mrr"
}

// Everything we hold for one open or discovered document.
interface IDocState {
	readonly uri: URI;
	doc: ILivingDoc;
	rawText: string;
	lock: ILivingDocLock;           // the source of truth for resolved values + freshness
	recent: Set<string>;            // block ids changed in the last refresh (for the highlight)
	staleBindings: Set<string>;     // dirty bits: bind keys whose source changed since last sync
	staleContext: Set<string>;      // dirty bits: context files changed since last review
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

function tokenize(s: string): string[] {
	return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// Token-overlap (Jaccard) similarity of two strings, 0..1. Used to relocate a prose claim against the
// current text - deterministic, no model. 1 = identical token sets, 0 = nothing in common.
function similarity(a: string, b: string): number {
	const ta = new Set(tokenize(a));
	const tb = new Set(tokenize(b));
	if (ta.size === 0 || tb.size === 0) { return 0; }
	let inter = 0;
	for (const t of ta) { if (tb.has(t)) { inter++; } }
	return inter / (ta.size + tb.size - inter);
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
	private readonly _lockStore: ILockStore;
	// The orchestration engine: agent registry + dependency-graph event-bus (+ triggers/policy/verify).
	private readonly _orchestrator: AgentOrchestrator;
	// Correlated source watchers, one store per loaded document. Disposed/recreated on reload, and
	// all torn down when the service is disposed.
	private readonly _watchers = new Map<string, IDisposable>();

	constructor(
		@IFileService private readonly _files: IFileService,
		@IEditorService private readonly _editors: IEditorService,
		@IViewsService private readonly _views: IViewsService,
		@ILanguageModelsService private readonly _lm: ILanguageModelsService,
		@IConfigurationService private readonly _config: IConfigurationService,
		@INotificationService private readonly _notify: INotificationService,
		@ILogService private readonly _log: ILogService,
		@IRequestService private readonly _request: IRequestService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
	) {
		super();
		this._lockStore = new SidecarLockStore(this._files);
		const folder = this._workspace.getWorkspace().folders[0]?.uri ?? URI.file('/');
		this._orchestrator = this._register(new AgentOrchestrator(
			this._files, this._log, new WorkspaceAgentStore(this._files, folder), () => this._discoverLivingDocUris()));
		// Surface orchestration state changes (dirty queue, agent status) through the service event.
		this._register(this._orchestrator.onDidChange(() => this._onDidChange.fire()));
		this._orchestrator.setRunner((agent, context) => this._runAgent(agent, context));
		void this._orchestrator.ensureLoaded().then(() => this._orchestrator.start());
		this._register(toDisposable(() => {
			for (const w of this._watchers.values()) { w.dispose(); }
			this._watchers.clear();
		}));
	}

	/** The orchestration engine (agent registry, graph event-bus, triggers, policy, verify gate). */
	get orchestrator(): AgentOrchestrator { return this._orchestrator; }

	getAgents(): readonly IAgentDef[] { return this._orchestrator.getAgents(); }

	// --- per-document views ---

	getDoc(resource: URI): ILivingDoc | undefined { return this._docs.get(resource.toString())?.doc; }
	getRawText(resource: URI): string { return this._docs.get(resource.toString())?.rawText ?? ''; }
	getStatus(resource: URI): string { return this._docs.get(resource.toString())?.status ?? 'No document'; }
	getRecentlyApplied(resource: URI): ReadonlySet<string> { return this._docs.get(resource.toString())?.recent ?? new Set<string>(); }
	getResolved(resource: URI): ReadonlyMap<string, string> {
		// The lock is the source of truth for resolved values.
		const out = new Map<string, string>();
		const state = this._docs.get(resource.toString());
		if (state) { for (const key of Object.keys(state.lock.bindings)) { out.set(key, state.lock.bindings[key].resolved); } }
		return out;
	}
	getLock(resource: URI): ILivingDocLock | undefined { return this._docs.get(resource.toString())?.lock; }
	getFreshness(resource: URI): IFreshness {
		const state = this._docs.get(resource.toString());
		const staleBindings = state ? [...state.staleBindings] : [];
		const staleContext = state ? [...state.staleContext] : [];
		return { staleBindings, staleContext, dirty: staleBindings.length > 0 || staleContext.length > 0 };
	}
	getPendingForDoc(resource: URI): readonly IProposedChange[] {
		const id = resource.toString();
		return this._pending.filter(c => c.docId === id);
	}

	// --- workspace-wide views ---

	getAllPending(): readonly IProposedChange[] { return this._pending; }
	getAudit(): readonly IAuditEntry[] {
		// The audit is folded into each document's lock; aggregate across the loaded documents.
		return [...this._docs.values()].flatMap(s => s.lock.audit);
	}

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

	// A `.md` is a Living Document when its content declares sources/context or carries bind links.
	// Generated `.export.md` / `.source.md` views are skipped.
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
			// First open with no lock yet: bootstrap it from the sources (the initial sync). Otherwise
			// the lock is authoritative - load is read-only and the cache reconciles to it at render.
			await this._bootstrapLock(state);
			state.recent = new Set<string>();
			// Cheap, always-on staleness: hash the sources now and watch them for later changes.
			await this._recomputeFreshness(state);
			this._watchSources(state);
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
		const lock = (await this._lockStore.read(resource)) ?? emptyLock();
		const state: IDocState = {
			uri: resource,
			doc,
			rawText,
			lock,
			recent: this._docs.get(resource.toString())?.recent ?? new Set<string>(),
			staleBindings: new Set<string>(),
			staleContext: new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
		};
		this._docs.set(resource.toString(), state);
		return state;
	}

	// When a doc carries bind keys with no lock entry yet (a brand-new or never-synced doc), resolve
	// them once from the sources and write the initial lock. Existing lock entries are left untouched
	// so the lock stays the source of truth across opens.
	private async _bootstrapLock(state: IDocState): Promise<void> {
		const keys = new Set<string>();
		for (const block of state.doc.blocks) { for (const b of block.binds) { keys.add(b.key); } }
		const missingBinding = [...keys].some(key => !Object.prototype.hasOwnProperty.call(state.lock.bindings, key));
		const missingContext = state.doc.context.some(file => !Object.prototype.hasOwnProperty.call(state.lock.context, file));
		if (!missingBinding && !missingContext) { return; }

		const resolution = await this._resolveCurrent(state);
		let changed = false;
		for (const key of keys) {
			if (Object.prototype.hasOwnProperty.call(state.lock.bindings, key)) { continue; }
			const r = resolution.get(key);
			if (!r) { continue; }
			state.lock.bindings[key] = this._bindingEntry(r);
			changed = true;
		}
		// Seed each context source as reviewed-at-current so it reads as current until it next changes.
		for (const file of state.doc.context) {
			if (Object.prototype.hasOwnProperty.call(state.lock.context, file)) { continue; }
			state.lock.context[file] = { reviewedHash: await this._hashContext(state, file), reviewedAt: new Date().toISOString(), scope: 'document' };
			changed = true;
		}
		if (changed) {
			try {
				await this._lockStore.write(state.uri, state.lock);
			} catch (e) {
				this._log.warn('[livingDocs] lock bootstrap write failed', e);
			}
		}
	}

	// --- staleness detection (cheap, always-on): the dirty bit (spec 3.4) ---

	async checkSources(resource: URI): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		await this._recomputeFreshness(state);
		this._onDidChange.fire();
	}

	// Re-hash every source and flip the dirty bits. Value bindings compare the source value's hash to
	// the lock's; context sources compare to the lock's reviewedHash. No prose is touched, no model is
	// called - this is the always-on layer.
	private async _recomputeFreshness(state: IDocState): Promise<void> {
		const staleBindings = new Set<string>();
		const staleContext = new Set<string>();
		if (state.doc.isLiving) {
			const resolution = await this._resolveCurrent(state);
			for (const key of Object.keys(state.lock.bindings)) {
				const cur = resolution.get(key);
				if (cur && cur.sourceHash !== state.lock.bindings[key].sourceHash) { staleBindings.add(key); }
			}
			for (const file of state.doc.context) {
				const entry = state.lock.context[file];
				const hash = await this._hashContext(state, file);
				if (!entry || entry.reviewedHash !== hash) { staleContext.add(file); }
			}
		}
		state.staleBindings = staleBindings;
		state.staleContext = staleContext;
		if (state.doc.isLiving) {
			state.status = (staleBindings.size || staleContext.size) ? 'Sources changed - may be affected' : 'All sources synced';
		}
	}

	private async _hashContext(state: IDocState, file: string): Promise<string> {
		if (sourceKind(file) === 'api') { return ''; }
		try {
			const text = (await this._files.readFile(joinPath(dirname(state.uri), file))).value.toString();
			return hashString(text);
		} catch (e) {
			this._log.trace('[livingDocs] context unreadable', file, e instanceof Error ? e.message : String(e));
			return '';
		}
	}

	// Watch each file source + context source with a correlated watcher so a source change flips the
	// dirty bit on its own (the always-on layer). Recreated per load; best-effort (no-op where the
	// platform has no watcher, e.g. unit tests).
	private _watchSources(state: IDocState): void {
		const id = state.uri.toString();
		this._watchers.get(id)?.dispose();
		this._watchers.delete(id);
		if (typeof this._files.createWatcher !== 'function') { return; }
		const store = new DisposableStore();
		const targets: URI[] = [];
		for (const source of state.doc.sources) {
			if (sourceKind(source) === 'file') { targets.push(joinPath(dirname(state.uri), source)); }
		}
		for (const file of state.doc.context) {
			if (sourceKind(file) === 'file') { targets.push(joinPath(dirname(state.uri), file)); }
		}
		for (const target of targets) {
			try {
				const watcher = store.add(this._files.createWatcher(target, { recursive: false, excludes: [] }));
				const sourcePath = target.path;
				store.add(watcher.onDidChange(() => {
					// Per-document freshness recompute + the workspace-wide graph propagation / event agents.
					void this.checkSources(state.uri);
					void this._orchestrator.onSourceChanged(sourcePath);
				}));
			} catch (e) {
				this._log.trace('[livingDocs] watch failed', e instanceof Error ? e.message : String(e));
			}
		}
		this._watchers.set(id, store);
	}

	private _bindingEntry(r: IResolution): IBindingEntry {
		return { resolved: r.value, source: r.source, sourceHash: r.sourceHash, syncedAt: new Date().toISOString(), appliedBy: 'agent', kind: 'figure' };
	}

	// Read every `sources:` file and build the bind-key -> freshly-resolved value map. A CSV produces
	// the latest row's columns (plus `.prev` / `.delta` qualifiers); an api/JSON source produces its
	// top-level fields. Influence (`context:`) sources are not value-resolved here (see Item 5).
	private async _resolveCurrent(state: IDocState): Promise<Map<string, IResolution>> {
		const resolved = new Map<string, IResolution>();
		for (const source of state.doc.sources) {
			const alias = sourceAlias(source);
			if (sourceKind(source) === 'api') {
				await this._resolveApiSource(source, alias, resolved);
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
				this._resolveCsv(text, source, alias, resolved);
			}
		}
		return resolved;
	}

	private _resolveCsv(text: string, source: string, alias: string, resolved: Map<string, IResolution>): void {
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
			resolved.set(`${alias}.${col}`, { value: this._formatCell(col, cur), sourceHash: hash, source: `${source}#${col}` });
			if (prev) {
				const pv = (prev[i] ?? '').trim();
				resolved.set(`${alias}.${col}.prev`, { value: this._formatCell(col, pv), sourceHash: hash, source: `${source}#${col}` });
				const delta = this._deltaCell(col, pv, cur);
				if (delta) { resolved.set(`${alias}.${col}.delta`, { value: delta, sourceHash: hash, source: `${source}#${col}` }); }
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

	private async _resolveApiSource(url: string, alias: string, resolved: Map<string, IResolution>): Promise<void> {
		try {
			const context = await this._request.request({ type: 'GET', url, callSite: 'livingDocs.apiSource' }, CancellationToken.None);
			const json = await asJson<Record<string, unknown>>(context);
			if (!json) { return; }
			const hash = hashString(JSON.stringify(json));
			for (const key of Object.keys(json)) {
				const value = json[key];
				const text = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
				resolved.set(`${alias}.${key}`, { value: text, sourceHash: hash, source: `${url}#${key}` });
			}
		} catch (e) {
			this._log.warn('[livingDocs] api source failed', e instanceof Error ? e.message : String(e));
		}
	}

	// Resolve the current source values into the lock (update each binding's resolved/sourceHash/
	// syncedAt). No prose is touched.
	private async _resolveIntoLock(state: IDocState): Promise<void> {
		const resolution = await this._resolveCurrent(state);
		for (const [key, r] of resolution) {
			state.lock.bindings[key] = this._bindingEntry(r);
		}
	}

	// The figure changes a re-sync would make: each bound block whose visible cache no longer matches the
	// lock's resolved values. Computed without mutating the document, so the policy router can apply,
	// queue, or draft them.
	private _figureReconciles(state: IDocState): { blockId: string; oldText: string; newText: string }[] {
		const resolved = this.getResolved(state.uri);
		const changes: { blockId: string; oldText: string; newText: string }[] = [];
		for (const block of state.doc.blocks) {
			if (block.binds.length === 0) { continue; }
			const next = reconcileBindLinks(block.text, resolved);
			if (next !== block.text) { changes.push({ blockId: block.id, oldText: block.text, newText: next }); }
		}
		return changes;
	}

	private _applyFigure(state: IDocState, change: { blockId: string; oldText: string; newText: string }): void {
		const block = state.doc.blocks.find(b => b.id === change.blockId);
		if (!block) { return; }
		state.lock.audit.push(this._entry(block.id, 'auto-applied', change.oldText, change.newText, 'heuristic'));
		block.text = change.newText;
		block.binds = extractBindLinks(change.newText);
		state.recent.add(block.id);
	}

	// Re-sync the lock from the current sources and auto-apply every figure (the manual "Refresh from
	// sources" path; figures are deterministic and low-risk). Caller persists.
	private async _syncLock(state: IDocState): Promise<void> {
		await this._resolveIntoLock(state);
		for (const change of this._figureReconciles(state)) { this._applyFigure(state, change); }
	}

	// Route a document's figure changes by the agent's policy (spec 4.2): auto-figures applies silently
	// (audited); ask-before-apply queues a pending change; draft-only queues a draft and never lands.
	// Returns how many were applied vs queued. Caller persists when something applied.
	private async _runFiguresByPolicy(state: IDocState, policy: AgentPolicy): Promise<{ applied: number; queued: number }> {
		await this._resolveIntoLock(state);
		const changes = this._figureReconciles(state);
		let applied = 0;
		let queued = 0;
		for (const change of changes) {
			if (policy === 'auto-figures') {
				this._applyFigure(state, change);
				applied++;
				continue;
			}
			// ask-before-apply / draft-only: queue for the rail without touching the doc.
			const block = state.doc.blocks.find(b => b.id === change.blockId);
			this._pending = this._pending.filter(c => !(c.docId === state.uri.toString() && c.blockId === change.blockId));
			this._pending.push({
				id: generateUuid(),
				docId: state.uri.toString(),
				docTitle: state.doc.title,
				blockId: change.blockId,
				blockLabel: block ? this._blockLabel(state.doc, change.blockId) : change.blockId,
				oldText: change.oldText,
				newText: change.newText,
				kind: 'figure',
				confidence: 1,
				rationale: 'Source value changed; figure update prepared.',
				sourceCells: block ? block.binds.map(b => b.key) : [],
				via: 'heuristic',
				draft: policy === 'draft-only',
			});
			queued++;
		}
		return { applied, queued };
	}

	async saveRawText(resource: URI, text: string): Promise<void> {
		const id = resource.toString();
		const doc = parseLivingDoc(text);
		const lock = this._docs.get(id)?.lock ?? (await this._lockStore.read(resource)) ?? emptyLock();
		const state: IDocState = {
			uri: resource,
			doc,
			rawText: text,
			lock,
			recent: new Set<string>(),
			staleBindings: new Set<string>(),
			staleContext: new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
		};
		try {
			await this._files.writeFile(resource, VSBuffer.fromString(text));
		} catch (e) {
			this._log.warn('[livingDocs] raw save failed', e);
		}
		this._docs.set(id, state);
		await this._bootstrapLock(state);
		await this._recomputeFreshness(state);
		this._watchSources(state);
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
			await this._syncLock(state);
			await this._persist(state);
			// The value bindings are now in sync, so their dirty bits clear (context stays stale until
			// a Review-impact pass, Item 5).
			await this._recomputeFreshness(state);
			derived++;
		}

		for (const state of this._docs.values()) {
			if (state.doc.isLiving) { state.status = `${derived} document${derived === 1 ? '' : 's'} synced`; }
		}
		this._onDidChange.fire();
	}

	// "Run now": run an agent over its flow documents (or the whole workspace if it scopes none).
	async runAgent(agentId: string): Promise<void> {
		await this._orchestrator.ensureLoaded();
		const agent = this._orchestrator.getAgent(agentId);
		if (!agent) { return; }
		const docs = agent.flow.docs.length ? agent.flow.docs.map(d => URI.parse(d)) : await this._discoverLivingDocUris();
		await this._orchestrator.runAgent(agentId, 'manual', docs);
	}

	// The orchestration host: how an agent does its work once a trigger fires. Event agents only flag
	// along the graph (propagation already ran); lifecycle hooks fire from the document lifecycle
	// (Item 5). Everything else re-derives each in-scope document and routes its figure changes through
	// the per-edge policy (auto-apply / queue / draft). Meaning/influence + the verify gate land in Item 4.
	private async _runAgent(agent: IAgentDef, context: IAgentRunContext): Promise<void> {
		if (agent.trigger.kind === 'event' || agent.trigger.kind === 'lifecycle') { return; }
		for (const uri of context.docs) {
			const state = this._docs.get(uri.toString()) ?? await this._loadState(uri);
			if (!state || !state.doc.isLiving) { continue; }
			state.recent = new Set<string>();
			const { applied } = await this._runFiguresByPolicy(state, agent.policy);
			if (applied) { await this._persist(state); } else { await this._lockStore.write(state.uri, state.lock).catch(e => this._log.warn('[livingDocs] lock write failed', e)); }
			await this._recomputeFreshness(state);
			// The heartbeat drains each doc it processed from the dirty queue.
			if (agent.trigger.kind === 'heartbeat') { this._orchestrator.clearDirty(uri); }
		}
		this._onDidChange.fire();
	}

	// --- the Review-impact pass (expensive, on-demand): spec 3.6 ---

	// Above this similarity a claim's anchor is taken to still point at the right prose; below it the
	// pass fails loudly with a re-link prompt rather than re-attaching to the wrong sentence.
	private static readonly _CLAIM_CONFIDENT = 0.5;

	async reviewImpact(resource: URI): Promise<void> {
		const id = resource.toString();
		const state = this._docs.get(id);
		if (!state || !state.doc.isLiving) { return; }

		// Review the changed context sources (or all of them if nothing is flagged dirty yet).
		const freshness = this.getFreshness(resource);
		const contextFiles = freshness.staleContext.length ? [...freshness.staleContext] : [...state.doc.context];
		const diff = await this._readContext(state, contextFiles);
		const modelAvailable = await this._hasModel();

		// Re-running the pass replaces this document's earlier impact candidates so it stays idempotent.
		this._pending = this._pending.filter(c => c.docId !== id);

		for (const target of this._claimTargets(state)) {
			if (target.relink) {
				// Guardrail 2: a low-confidence anchor match fails loudly - ask to re-link, never re-attach.
				this._pending.push(this._relinkPrompt(state, target, contextFiles));
				this._notify.info(`This commentary is bound to ${contextFiles.join(', ') || 'a source'} - re-link?`);
				continue;
			}
			const block = state.doc.blocks.find(b => b.id === target.blockId);
			if (!block) { continue; }
			const proposal = await this._proposeImpact(diff, contextFiles, block.text, modelAvailable);
			if (proposal.newText === block.text) { continue; }
			const change: IProposedChange = {
				id: generateUuid(),
				docId: id,
				docTitle: state.doc.title,
				blockId: block.id,
				blockLabel: this._blockLabel(state.doc, block.id),
				oldText: block.text,
				newText: proposal.newText,
				kind: proposal.kind,
				confidence: proposal.confidence,
				rationale: proposal.rationale,
				sourceCells: [],
				claimId: target.claimId,
				contextReviewed: contextFiles,
				via: proposal.via,
			};
			if (proposal.kind === 'figure') {
				// Confidence-gated routing (guardrail 4): figure-class ripples may auto-stage.
				if (block) { block.text = proposal.newText; block.binds = extractBindLinks(proposal.newText); state.recent.add(block.id); }
				state.lock.audit.push(this._entry(block.id, 'auto-applied', change.oldText, change.newText, proposal.via));
			} else {
				// Meaning/influence changes wait for approval in the review rail (no eager rewrites).
				this._pending.push(change);
			}
		}

		const queued = this._pending.filter(c => c.docId === id).length;
		state.status = modelAvailable
			? `${queued} impact ${queued === 1 ? 'change' : 'changes'} to review`
			: 'No model available - showing heuristic suggestions';
		await this._persist(state);
		this._onDidChange.fire();
		try {
			await this._views.openView(REVIEW_RAIL_VIEW_ID, false);
		} catch (e) {
			this._log.warn('[livingDocs] could not reveal review rail', e);
		}
	}

	// The prose targets the impact pass should consider: authored lock claims (relocated by fuzzy
	// match on their anchor), or - when none are authored - each non-bound prose paragraph as an
	// implicit influence target.
	private _claimTargets(state: IDocState): { claimId?: string; blockId?: string; relink?: boolean }[] {
		const claimIds = Object.keys(state.lock.claims);
		if (claimIds.length) {
			return claimIds.map(claimId => {
				const best = this._relocateClaim(state.doc, state.lock.claims[claimId].anchor);
				const relink = best.score < LivingDocsService._CLAIM_CONFIDENT;
				return { claimId, blockId: best.blockId, relink };
			});
		}
		return state.doc.blocks.filter(b => b.type === 'paragraph' && b.binds.length === 0).map(b => ({ blockId: b.id }));
	}

	// Relocate a claim by fuzzy-matching its stored anchor against the current prose (the file may have
	// moved/edited). Token-overlap similarity - deterministic, no model.
	private _relocateClaim(doc: ILivingDoc, anchor: string): { blockId: string | undefined; score: number } {
		let best: { blockId: string | undefined; score: number } = { blockId: undefined, score: 0 };
		for (const block of doc.blocks) {
			if (block.type === 'heading') { continue; }
			const score = similarity(anchor, block.text);
			if (score > best.score) { best = { blockId: block.id, score }; }
		}
		return best;
	}

	private _relinkPrompt(state: IDocState, target: { claimId?: string; blockId?: string }, contextFiles: string[]): IProposedChange {
		const claim = target.claimId ? state.lock.claims[target.claimId] : undefined;
		const best = target.blockId ? state.doc.blocks.find(b => b.id === target.blockId) : undefined;
		return {
			id: generateUuid(),
			docId: state.uri.toString(),
			docTitle: state.doc.title,
			blockId: target.blockId ?? '',
			blockLabel: 'Re-link claim',
			oldText: claim?.anchor ?? '',
			newText: best?.text ?? '',
			kind: 'meaning',
			confidence: 0,
			rationale: `This commentary is bound to ${contextFiles.join(', ') || 'a source'} but its anchor no longer matches the prose - re-link?`,
			sourceCells: [],
			claimId: target.claimId,
			contextReviewed: contextFiles,
			via: 'heuristic',
			relink: true,
		};
	}

	private async _hasModel(): Promise<boolean> {
		if (this._config.getValue<boolean>('livingDocs.useModel') === false) { return false; }
		try {
			const preferred = this._config.getValue<string>('livingDocs.commentaryModel');
			const models = await this._lm.selectLanguageModels(preferred ? { id: preferred } : {});
			return models.length > 0;
		} catch {
			return false;
		}
	}

	private async _proposeImpact(diff: string, contextFiles: string[], oldText: string, modelAvailable: boolean): Promise<{ newText: string; kind: 'figure' | 'meaning'; confidence: number; rationale: string; via: 'model' | 'heuristic' }> {
		if (modelAvailable) {
			try {
				return await this._modelImpact(diff, contextFiles, oldText);
			} catch (e) {
				this._log.info('[livingDocs] model impact failed, using heuristic', e instanceof Error ? e.message : String(e));
			}
		}
		return this._heuristicImpact(diff, contextFiles, oldText);
	}

	private async _modelImpact(diff: string, contextFiles: string[], oldText: string): Promise<{ newText: string; kind: 'figure' | 'meaning'; confidence: number; rationale: string; via: 'model' }> {
		const preferred = this._config.getValue<string>('livingDocs.commentaryModel');
		const models = await this._lm.selectLanguageModels(preferred ? { id: preferred } : {});
		if (!models.length) { throw new Error('no language models available'); }
		const system = 'You revise one sentence of business commentary so it stays consistent with a changed source. '
			+ 'Reply with ONLY a JSON object: {"newText": string, "kind": "figure" | "meaning", "confidence": number, "rationale": string}. '
			+ 'Use kind="meaning" when the qualitative framing should change; otherwise kind="figure" and return newText unchanged.';
		const user = `The source(s) ${contextFiles.join(', ')} now read:\n"""${diff}"""\nCurrent commentary: "${oldText}". Revise it if the framing should change.`;
		const messages: IChatMessage[] = [
			{ role: ChatMessageRole.System, content: [{ type: 'text', value: system }] },
			{ role: ChatMessageRole.User, content: [{ type: 'text', value: user }] },
		];
		const response = await this._lm.sendChatRequest(models[0], undefined, messages, {}, CancellationToken.None);
		let text = '';
		for await (const part of response.stream) {
			if (Array.isArray(part)) {
				for (const p of part) { if (p.type === 'text') { text += p.value; } }
			} else if (part.type === 'text') {
				text += part.value;
			}
		}
		await response.result;
		const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
		return {
			newText: String(json.newText ?? oldText),
			kind: json.kind === 'meaning' ? 'meaning' : 'figure',
			confidence: typeof json.confidence === 'number' ? json.confidence : 0.8,
			rationale: String(json.rationale ?? ''),
			via: 'model',
		};
	}

	// The no-model path is a VISIBLE, conservative suggestion (not a silent degrade): it surfaces the
	// salient change and proposes a clearly-heuristic addition for the user to approve or reject.
	private _heuristicImpact(diff: string, contextFiles: string[], oldText: string): { newText: string; kind: 'meaning'; confidence: number; rationale: string; via: 'heuristic' } {
		const salient = diff.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).pop() ?? '';
		const note = salient ? ` In light of an update to ${contextFiles.join(', ')} ("${salient}"), revisit whether this still holds.` : ` ${contextFiles.join(', ')} changed since last review - revisit this.`;
		return {
			newText: `${oldText}${note}`,
			kind: 'meaning',
			confidence: 0.5,
			rationale: `Heuristic suggestion (no model available): ${contextFiles.join(', ')} changed since last review.`,
			via: 'heuristic',
		};
	}

	private async _readContext(state: IDocState, files: string[]): Promise<string> {
		const parts: string[] = [];
		for (const file of files) {
			if (sourceKind(file) === 'api') { continue; }
			try {
				parts.push((await this._files.readFile(joinPath(dirname(state.uri), file))).value.toString());
			} catch {
				// An unreadable context source contributes nothing to the diff.
			}
		}
		return parts.join('\n\n');
	}

	private _blockLabel(doc: ILivingDoc, blockId: string): string {
		let heading = '';
		for (const b of doc.blocks) {
			if (b.type === 'heading') { heading = b.text; }
			if (b.id === blockId) { return heading || blockId; }
		}
		return blockId;
	}

	// --- approve / reject (the review rail) ---

	async approve(changeId: string): Promise<void> {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		const state = this._docs.get(change.docId);
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === change.blockId);
		// A re-link prompt re-anchors the claim to the current best-match prose without rewriting it;
		// a normal impact change applies its rewrite to the block.
		if (block && !change.relink) { block.text = change.newText; block.binds = extractBindLinks(change.newText); state.recent.add(block.id); }
		if (change.claimId) {
			const prior = state.lock.claims[change.claimId];
			state.lock.claims[change.claimId] = {
				anchor: change.relink ? (block?.text ?? prior?.anchor ?? '') : change.newText,
				boundTo: prior?.boundTo ?? change.contextReviewed ?? [],
				kind: 'meaning',
				state: 'applied',
			};
		}
		this._pending = this._pending.filter(c => c.id !== changeId);
		state.lock.audit.push(this._entry(change.blockId, 'approved', change.oldText, change.newText, change.via ?? 'model'));
		await this._markContextReviewed(state, change.contextReviewed);
		state.status = `Change approved - applied to ${change.docTitle}`;
		await this._persist(state);
		await this._recomputeFreshness(state);
		this._onDidChange.fire();
	}

	reject(changeId: string): void {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		const state = this._docs.get(change.docId);
		if (state) {
			state.lock.audit.push(this._entry(change.blockId, 'rejected', change.oldText, change.newText, change.via ?? 'model'));
			state.status = `Change rejected - ${change.docTitle} left unchanged`;
			// Rejecting still counts as reviewing the changed context, so the flag clears.
			void this._markContextReviewed(state, change.contextReviewed)
				.then(() => this._recomputeFreshness(state))
				.then(() => this._onDidChange.fire())
				.catch(e => this._log.warn('[livingDocs] reject follow-up failed', e));
		}
		this._onDidChange.fire();
	}

	// Mark each reviewed context source as reviewed-at-current in the lock so its stale flag clears.
	private async _markContextReviewed(state: IDocState, files: readonly string[] | undefined): Promise<void> {
		if (!files?.length) { return; }
		for (const file of files) {
			state.lock.context[file] = { reviewedHash: await this._hashContext(state, file), reviewedAt: new Date().toISOString(), scope: 'document' };
		}
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
		const rows = Object.keys(state.lock.bindings).map(key => {
			const value = state.lock.bindings[key].resolved;
			const markedKey = selected.has(key) ? `**${key}**` : key;
			const markedValue = selected.has(key) ? `**${value}**` : value;
			return `| ${markedKey} | ${markedValue} |`;
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

	private _entry(blockId: string, action: IAuditEntry['action'], oldText: string, newText: string, via: IAuditEntry['via']): IAuditEntry {
		const docTitle = [...this._docs.values()].find(s => s.doc.blocks.some(b => b.id === blockId))?.doc.title ?? '';
		return { time: new Date().toISOString(), docTitle, blockId, action, oldText, newText, via };
	}

	// Persist the document (.md) and its lock together - the pair is one logical unit.
	private async _persist(state: IDocState): Promise<void> {
		try {
			const serialized = serializeLivingDoc(state.doc);
			state.rawText = serialized;
			await this._files.writeFile(state.uri, VSBuffer.fromString(serialized));
			await this._lockStore.write(state.uri, state.lock);
		} catch (e) {
			this._log.warn('[livingDocs] persist failed', e);
		}
	}
}
