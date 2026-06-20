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
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ChatMessageRole, IChatMessage, ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ILivingDocsService, ILivingDocSummary, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { parseLivingDoc, serializeLivingDoc } from '../common/livingDocMarkdown.js';
import { renderExportHtml, renderExportMarkdown } from './livingDocRender.js';
import { ChangeKind, IAuditEntry, IKpiRow, ILivingDoc, IProposedChange, SourceKind } from '../common/livingDocsModel.js';

interface ICsvRow {
	week: number;
	date: string;
	mrr: number;
	signups: number;
	churn: number;
	active: number;
}

// Everything we hold for one open or discovered document.
interface IDocState {
	readonly uri: URI;
	doc: ILivingDoc;
	rawText: string;
	csvUri: URI | undefined;
	rows: ICsvRow[];
	recent: Set<string>;
	status: string;
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
const pct = (a: number, b: number) => `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%`;

// The "New document" starting point: a minimal Living Document with one heading and editable prose.
// Authored as a single left-aligned template literal so source indentation stays tab-only.
const NEW_DOCUMENT_TEMPLATE = `---
livingDoc: true
title: Untitled document
subtitle: New document
---

## Overview

Write your document here. Connect a source to start binding live figures.
`;

function blockLabel(doc: ILivingDoc, blockId: string): string {
	// The nearest preceding heading is the human-friendly section name for a block.
	let heading = '';
	for (const b of doc.blocks) {
		if (b.type === 'heading') { heading = b.text ?? ''; }
		if (b.id === blockId) { return heading || blockId; }
	}
	return blockId;
}

export class LivingDocsService extends Disposable implements ILivingDocsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _docs = new Map<string, IDocState>();
	private _pending: IProposedChange[] = [];
	private _audit: IAuditEntry[] = [];
	private _via = new Map<string, 'model' | 'heuristic'>();

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
	}

	// --- per-document views ---

	getDoc(resource: URI): ILivingDoc | undefined { return this._docs.get(resource.toString())?.doc; }
	getRawText(resource: URI): string { return this._docs.get(resource.toString())?.rawText ?? ''; }
	getStatus(resource: URI): string { return this._docs.get(resource.toString())?.status ?? 'No document'; }
	getRecentlyApplied(resource: URI): ReadonlySet<string> { return this._docs.get(resource.toString())?.recent ?? new Set<string>(); }
	getPendingForDoc(resource: URI): readonly IProposedChange[] {
		const id = resource.toString();
		return this._pending.filter(c => c.docId === id);
	}

	getKpiRows(resource: URI): readonly IKpiRow[] {
		const state = this._docs.get(resource.toString());
		if (!state) { return []; }
		const curr = state.rows.find(r => r.week === state.doc.syncedWeek);
		const prev = state.rows.find(r => r.week === state.doc.syncedWeek - 1);
		if (!curr || !prev) { return []; }
		const churnDelta = (curr.churn - prev.churn).toFixed(1);
		return [
			{ metric: 'MRR', prev: `$${k(prev.mrr)}`, curr: `$${k(curr.mrr)}`, delta: pct(prev.mrr, curr.mrr), positive: curr.mrr >= prev.mrr },
			{ metric: 'New signups', prev: `${prev.signups}`, curr: `${curr.signups}`, delta: pct(prev.signups, curr.signups), positive: curr.signups >= prev.signups },
			{ metric: 'Churn', prev: `${prev.churn}%`, curr: `${curr.churn}%`, delta: `${curr.churn > prev.churn ? '+' : ''}${churnDelta}pt`, positive: curr.churn <= prev.churn },
			{ metric: 'Active workspaces', prev: `${prev.active}`, curr: `${curr.active}`, delta: `+${curr.active - prev.active}`, positive: curr.active >= prev.active },
		];
	}

	// --- workspace-wide views ---

	getAllPending(): readonly IProposedChange[] { return this._pending; }
	getAudit(): readonly IAuditEntry[] { return this._audit; }

	// --- the "Documents" home ---

	async listDocuments(): Promise<readonly ILivingDocSummary[]> {
		const found = new Map<string, URI>();
		// Always include documents already loaded (e.g. the open editor), even if discovery misses them.
		for (const state of this._docs.values()) {
			if (state.uri.path.endsWith('.living.md')) { found.set(state.uri.toString(), state.uri); }
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

	// Recursively collect *.living.md under a folder, skipping hidden and dependency directories.
	// Bounded in depth so a large workspace can never make the home hang.
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
			} else if (child.resource.path.endsWith('.living.md')) {
				found.set(child.resource.toString(), child.resource);
			}
		}
	}

	private async _summarize(uri: URI): Promise<ILivingDocSummary | undefined> {
		try {
			const raw = (await this._files.readFile(uri)).value.toString();
			const doc = parseLivingDoc(raw);
			const kinds = new Set<SourceKind>();
			for (const block of doc.blocks) {
				if (block.binding) { kinds.add(block.binding.sourceKind); }
			}
			const id = uri.toString();
			return {
				resource: uri,
				title: doc.title,
				isLiving: doc.isLiving,
				sourceKinds: [...kinds],
				lastSynced: doc.isLiving && doc.syncedWeek ? `Week ${doc.syncedWeek}` : '',
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
		let name = 'Untitled.living.md';
		for (let n = 2; existing.has(name); n++) {
			name = `Untitled ${n}.living.md`;
		}
		return joinPath(folder, name);
	}

	// --- loading ---

	async loadDocument(resource: URI): Promise<void> {
		const state = await this._loadState(resource);
		if (state) {
			// Clear stale highlights from a previous refresh when a document is (re)opened.
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
			csvUri: doc.isLiving ? joinPath(dirname(resource), doc.source) : undefined,
			rows: [],
			recent: this._docs.get(resource.toString())?.recent ?? new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
		};
		if (state.csvUri) {
			state.rows = await this._loadCsv(state.csvUri);
		}
		this._docs.set(resource.toString(), state);
		return state;
	}

	private async _loadCsv(csvUri: URI): Promise<ICsvRow[]> {
		const rows: ICsvRow[] = [];
		try {
			const text = (await this._files.readFile(csvUri)).value.toString();
			const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
			for (let i = 1; i < lines.length; i++) {
				const c = lines[i].split(',');
				rows.push({
					week: parseInt(c[0], 10),
					date: c[1],
					mrr: parseInt(c[2], 10),
					signups: parseInt(c[3], 10),
					churn: parseFloat(c[4]),
					active: parseInt(c[5], 10),
				});
			}
		} catch (e) {
			this._log.error('[livingDocs] failed to read source', e);
		}
		return rows;
	}

	async saveRawText(resource: URI, text: string): Promise<void> {
		const id = resource.toString();
		const doc = parseLivingDoc(text);
		const state: IDocState = {
			uri: resource,
			doc,
			rawText: text,
			csvUri: doc.isLiving ? joinPath(dirname(resource), doc.source) : undefined,
			rows: [],
			recent: new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
		};
		try {
			await this._files.writeFile(resource, VSBuffer.fromString(text));
		} catch (e) {
			this._log.warn('[livingDocs] raw save failed', e);
		}
		if (state.csvUri) {
			state.rows = await this._loadCsv(state.csvUri);
		}
		this._docs.set(id, state);
		this._onDidChange.fire();
	}

	async exportDocument(resource: URI): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const html = renderExportHtml(state.doc, this.getKpiRows(resource));
		const stem = basename(resource).replace(/\.living\.md$/, '').replace(/\.md$/, '');
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
		const markdown = renderExportMarkdown(state.doc, this.getKpiRows(resource));
		const stem = basename(resource).replace(/\.living\.md$/, '').replace(/\.md$/, '');
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

	async editBlock(resource: URI, blockId: string, text: string): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === blockId);
		// Only non-bound prose is hand-editable; bound blocks stay driven by their source.
		if (!block || block.binding || block.type === 'kpiTable') { return; }
		const next = text.trim();
		if ((block.text ?? '') === next) { return; }
		block.text = next;
		await this._persist(state);
		this._onDidChange.fire();
	}

	// --- the fan-out refresh ---

	async refreshFromSources(): Promise<void> {
		// Re-derive every bound document in the workspace, not just the open one.
		const uris = await this._discoverLivingDocUris();
		this._pending = [];

		let derived = 0;
		for (const uri of uris) {
			let state = this._docs.get(uri.toString());
			if (!state) { state = await this._loadState(uri); }
			if (!state || !state.doc.isLiving || !state.csvUri) { continue; }
			state.rows = await this._loadCsv(state.csvUri);
			await this._deriveDoc(state);
			derived++;
		}

		const docsWithChanges = new Set(this._pending.map(c => c.docId)).size;
		const summary = this._pending.length
			? `${this._pending.length} change${this._pending.length > 1 ? 's' : ''} across ${docsWithChanges} document${docsWithChanges > 1 ? 's' : ''} need approval`
			: `${derived} document${derived === 1 ? '' : 's'} synced`;
		for (const state of this._docs.values()) {
			if (state.doc.isLiving) { state.status = summary; }
		}

		this._onDidChange.fire();

		if (this._pending.length) {
			try {
				await this._views.openView(REVIEW_RAIL_VIEW_ID, false);
			} catch (e) {
				this._log.warn('[livingDocs] could not reveal review rail', e);
			}
		}
	}

	private async _deriveDoc(state: IDocState): Promise<void> {
		const doc = state.doc;
		state.recent = new Set<string>();

		// 0) Live API/MCP figure blocks -> fetch and substitute, independent of the CSV source.
		await this._deriveLiveBlocks(state);

		if (state.rows.length < 2) {
			if (state.recent.size) { await this._persist(state); }
			return;
		}

		const latest = state.rows.reduce((a, b) => (b.week > a.week ? b : a));
		const prev = state.rows.find(r => r.week === latest.week - 1);
		if (!prev) {
			if (state.recent.size) { await this._persist(state); }
			return;
		}
		const deltaPct = Math.round(((latest.mrr - prev.mrr) / prev.mrr) * 100);

		// 1) The KPI table and synced week are pure figures -> auto-apply.
		if (doc.syncedWeek !== latest.week) {
			if (doc.blocks.some(b => b.type === 'kpiTable')) { state.recent.add('kpi-table'); }
			doc.syncedWeek = latest.week;
			doc.subtitle = `Week ${latest.week} - ${latest.date} - bound to ${doc.source}`;
		}

		// 2) The highlights figure paragraph -> deterministic numbers, low risk, auto-applies.
		const fig = doc.blocks.find(b => b.id === 'p-highlights');
		if (fig) {
			const figureText = `Revenue grew ${deltaPct}% week-on-week to $${k(latest.mrr)} MRR, on ${latest.signups} new signups. Churn eased to ${latest.churn}%.`;
			if (fig.text !== figureText) {
				this._audit.push(this._entry(doc.title, fig.id, 'auto-applied', fig.text ?? '', figureText, 'heuristic'));
				fig.text = figureText;
				state.recent.add(fig.id);
			}
		}

		// 3) Narrative blocks -> ask the model to rewrite + classify; queue meaning-changes.
		for (const block of doc.blocks) {
			if (block.type !== 'paragraph' || block.kind !== 'narrative' || !block.text) { continue; }
			const proposal = await this._proposeCommentary(deltaPct, prev.mrr, latest.mrr, block.text);
			if (proposal.newText === block.text) { continue; }
			const change: IProposedChange = {
				id: generateUuid(),
				docId: state.uri.toString(),
				docTitle: doc.title,
				blockId: block.id,
				blockLabel: blockLabel(doc, block.id),
				oldText: block.text,
				newText: proposal.newText,
				kind: proposal.kind,
				confidence: proposal.confidence,
				rationale: proposal.rationale,
				sourceCells: block.binding?.cells ?? [],
			};
			if (change.kind === 'figure') {
				// Not a meaning change -> auto-apply.
				block.text = change.newText;
				state.recent.add(block.id);
				this._audit.push(this._entry(doc.title, block.id, 'auto-applied', change.oldText, change.newText, proposal.via));
			} else {
				// Meaning change -> queue for one-click approval.
				this._via.set(change.id, proposal.via);
				this._pending.push(change);
			}
		}

		// Persist auto-applied figures so each document's file reflects the synced state.
		if (state.recent.size) {
			await this._persist(state);
		}
	}

	// Fetch live API (and, when wired, MCP) sources and substitute their values into the
	// {cell} placeholders of the bound block. These are figures -> auto-apply.
	private async _deriveLiveBlocks(state: IDocState): Promise<void> {
		const doc = state.doc;
		for (const block of doc.blocks) {
			const binding = block.binding;
			if (block.type !== 'paragraph' || !binding) { continue; }
			const template = block.template ?? block.text ?? '';
			let data: Record<string, unknown> | undefined;
			if (binding.sourceKind === 'api' && binding.url) {
				data = await this._resolveApi(binding.url);
			} else if (binding.sourceKind === 'mcp') {
				// MCP tool sources resolve through the language-model tools service once an MCP
				// server is connected; until then the authored template is left in place.
				this._log.info('[livingDocs] mcp source not yet wired; leaving template', binding.tool ?? '');
				continue;
			} else {
				continue;
			}
			if (!data) { continue; }
			const next = this._fillTemplate(template, data, binding.cells);
			if (next !== block.text) {
				this._audit.push(this._entry(doc.title, block.id, 'auto-applied', block.text ?? '', next, 'api'));
				block.text = next;
				state.recent.add(block.id);
			}
		}
	}

	private async _resolveApi(url: string): Promise<Record<string, unknown> | undefined> {
		try {
			const context = await this._request.request({ type: 'GET', url, callSite: 'livingDocs.apiSource' }, CancellationToken.None);
			const json = await asJson<Record<string, unknown>>(context);
			return json ?? undefined;
		} catch (e) {
			this._log.warn('[livingDocs] api source failed', e instanceof Error ? e.message : String(e));
			return undefined;
		}
	}

	private _fillTemplate(template: string, data: Record<string, unknown>, cells: readonly string[]): string {
		let out = template;
		for (const cell of cells) {
			if (!Object.prototype.hasOwnProperty.call(data, cell)) { continue; }
			const value = data[cell];
			const text = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
			out = out.split(`{${cell}}`).join(text);
		}
		return out;
	}

	private async _proposeCommentary(deltaPct: number, mrrPrev: number, mrrNow: number, current: string): Promise<{ newText: string; kind: ChangeKind; confidence: number; rationale: string; via: 'model' | 'heuristic'; model?: string }> {
		try {
			if (this._config.getValue<boolean>('livingDocs.useModel') === false) {
				throw new Error('model disabled by setting');
			}
			const preferred = this._config.getValue<string>('livingDocs.commentaryModel');
			const models = await this._lm.selectLanguageModels(preferred ? { id: preferred } : {});
			if (!models.length) { throw new Error('no language models available'); }
			const system = 'You revise one sentence of business commentary inside a living report. '
				+ 'Reply with ONLY a JSON object, no prose, of the form '
				+ '{"newText": string, "kind": "figure" | "meaning", "confidence": number, "rationale": string}. '
				+ 'Set kind="meaning" when the qualitative character of growth changed (e.g. from steady to accelerating); '
				+ 'otherwise set kind="figure" and return newText unchanged.';
			const user = `MRR grew ${deltaPct}% week-on-week (from $${k(mrrPrev)} to $${k(mrrNow)}). `
				+ `Current commentary: "${current}". Revise it to match the new growth.`;
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
				newText: String(json.newText ?? current),
				kind: json.kind === 'meaning' ? 'meaning' : 'figure',
				confidence: typeof json.confidence === 'number' ? json.confidence : 0.85,
				rationale: String(json.rationale ?? ''),
				via: 'model',
				model: models[0],
			};
		} catch (e) {
			this._log.info('[livingDocs] model unavailable, using heuristic', e instanceof Error ? e.message : String(e));
			if (deltaPct >= 15) {
				return {
					newText: 'Growth accelerated sharply this week - the fastest pace this quarter.',
					kind: 'meaning',
					confidence: 0.93,
					rationale: `MRR delta rose to +${deltaPct}%, crossing the "accelerating" threshold, so "steady" is no longer accurate.`,
					via: 'heuristic',
				};
			}
			return { newText: current, kind: 'figure', confidence: 0.99, rationale: 'No material change in the character of growth.', via: 'heuristic' };
		}
	}

	// --- approve / reject ---

	async approve(changeId: string): Promise<void> {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		const state = this._docs.get(change.docId);
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === change.blockId);
		if (block) { block.text = change.newText; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		this._audit.push(this._entry(change.docTitle, change.blockId, 'approved', change.oldText, change.newText, this._via.get(changeId) ?? 'model'));
		state.status = `Change approved - applied to ${change.docTitle}`;
		await this._persist(state);
		this._onDidChange.fire();
	}

	reject(changeId: string): void {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		this._audit.push(this._entry(change.docTitle, change.blockId, 'rejected', change.oldText, change.newText, this._via.get(changeId) ?? 'model'));
		const state = this._docs.get(change.docId);
		if (state) {
			state.status = `Change rejected - ${change.docTitle} left unchanged`;
			void this._persist(state);
		}
		this._onDidChange.fire();
	}

	async revealSource(resource: URI, cells: readonly string[]): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state || !state.csvUri) { return; }
		// Header is line 1; data rows follow in file order, so the synced-week row is at its index + 2.
		const idx = state.rows.findIndex(r => r.week === state.doc.syncedWeek);
		const line = idx >= 0 ? idx + 2 : 1;
		try {
			await this._editors.openEditor({
				resource: state.csvUri,
				options: {
					pinned: true,
					selection: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
				},
			}, SIDE_GROUP);
			const what = cells.length ? cells.join(', ') : 'the source';
			this._notify.info(`Provenance: this text is bound to ${what} in ${state.doc.source} (week ${state.doc.syncedWeek}).`);
		} catch (e) {
			this._log.warn('[livingDocs] reveal source failed', e);
		}
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
					if (!child.isDirectory && child.resource.path.endsWith('.living.md')) {
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
			const stem = basename(state.uri).replace(/\.living\.md$/, '').replace(/\.md$/, '');
			const auditUri = joinPath(dirname(state.uri), `${stem}.audit.json`);
			const docAudit = this._audit.filter(e => e.docTitle === state.doc.title);
			await this._files.writeFile(auditUri, VSBuffer.fromString(JSON.stringify(docAudit, null, 2)));
		} catch (e) {
			this._log.warn('[livingDocs] persist failed', e);
		}
	}
}
