/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ChatMessageRole, IChatMessage, ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { ILivingDocsService } from '../common/livingDocs.js';
import { ChangeKind, IAuditEntry, IKpiRow, ILivingDoc, IProposedChange } from '../common/livingDocsModel.js';

interface ICsvRow {
	week: number;
	date: string;
	mrr: number;
	signups: number;
	churn: number;
	active: number;
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
const pct = (a: number, b: number) => `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%`;

export class LivingDocsService extends Disposable implements ILivingDocsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _docUri: URI | undefined;
	private _csvUri: URI | undefined;
	private _doc: ILivingDoc | undefined;
	private _rows: ICsvRow[] = [];
	private _pending: IProposedChange[] = [];
	private _audit: IAuditEntry[] = [];
	private _via = new Map<string, 'model' | 'heuristic'>();
	private _recent = new Set<string>();
	private _status = 'No document';

	constructor(
		@IFileService private readonly _files: IFileService,
		@IEditorService private readonly _editors: IEditorService,
		@ILanguageModelsService private readonly _lm: ILanguageModelsService,
		@INotificationService private readonly _notify: INotificationService,
		@ILogService private readonly _log: ILogService,
	) {
		super();
	}

	getDoc(): ILivingDoc | undefined { return this._doc; }
	getPending(): readonly IProposedChange[] { return this._pending; }
	getAudit(): readonly IAuditEntry[] { return this._audit; }
	getStatus(): string { return this._status; }
	getRecentlyApplied(): ReadonlySet<string> { return this._recent; }

	getKpiRows(): readonly IKpiRow[] {
		if (!this._doc) { return []; }
		const curr = this._rows.find(r => r.week === this._doc!.syncedWeek);
		const prev = this._rows.find(r => r.week === this._doc!.syncedWeek - 1);
		if (!curr || !prev) { return []; }
		const churnDelta = (curr.churn - prev.churn).toFixed(1);
		return [
			{ metric: 'MRR', prev: `$${k(prev.mrr)}`, curr: `$${k(curr.mrr)}`, delta: pct(prev.mrr, curr.mrr), positive: curr.mrr >= prev.mrr },
			{ metric: 'New signups', prev: `${prev.signups}`, curr: `${curr.signups}`, delta: pct(prev.signups, curr.signups), positive: curr.signups >= prev.signups },
			{ metric: 'Churn', prev: `${prev.churn}%`, curr: `${curr.churn}%`, delta: `${curr.churn > prev.churn ? '+' : ''}${churnDelta}pt`, positive: curr.churn <= prev.churn },
			{ metric: 'Active workspaces', prev: `${prev.active}`, curr: `${curr.active}`, delta: `+${curr.active - prev.active}`, positive: curr.active >= prev.active },
		];
	}

	async loadDocument(resource: URI): Promise<void> {
		this._docUri = resource;
		this._pending = [];
		this._audit = [];
		this._via.clear();
		this._recent.clear();
		try {
			const raw = (await this._files.readFile(resource)).value.toString();
			this._doc = JSON.parse(raw) as ILivingDoc;
		} catch (e) {
			this._log.error('[livingDocs] failed to parse document', e);
			this._doc = undefined;
			this._status = 'Could not open document';
			this._onDidChange.fire();
			return;
		}
		const sourceName = this._doc.blocks.find(b => b.binding)?.binding?.source ?? 'metrics.csv';
		this._csvUri = joinPath(dirname(resource), sourceName);
		await this._loadCsv();
		this._status = 'All sources synced';
		// Open the bound source beside the document (the "source pane").
		try {
			await this._editors.openEditor({ resource: this._csvUri, options: { pinned: true, preserveFocus: true } }, SIDE_GROUP);
		} catch (e) {
			this._log.warn('[livingDocs] could not open source pane', e);
		}
		this._onDidChange.fire();
	}

	private async _loadCsv(): Promise<void> {
		this._rows = [];
		if (!this._csvUri) { return; }
		try {
			const text = (await this._files.readFile(this._csvUri)).value.toString();
			const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
			for (let i = 1; i < lines.length; i++) {
				const c = lines[i].split(',');
				this._rows.push({
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
	}

	async refreshFromSources(): Promise<void> {
		const doc = this._doc;
		if (!doc || !this._csvUri) { return; }
		await this._loadCsv();
		if (this._rows.length < 2) { return; }
		this._recent = new Set<string>();

		const latest = this._rows.reduce((a, b) => (b.week > a.week ? b : a));
		const prev = this._rows.find(r => r.week === latest.week - 1);
		if (!prev) { return; }
		const deltaPct = Math.round(((latest.mrr - prev.mrr) / prev.mrr) * 100);

		// 1) Figure paragraph — deterministic numbers, low risk, auto-applies.
		const fig = doc.blocks.find(b => b.id === 'p-highlights');
		const figureText = `Revenue grew ${deltaPct}% week-on-week to $${k(latest.mrr)} MRR, on ${latest.signups} new signups. Churn eased to ${latest.churn}%.`;
		if (fig && fig.text !== figureText) {
			this._audit.push(this._entry(fig.id, 'auto-applied', fig.text ?? '', figureText, 'heuristic'));
			fig.text = figureText;
			this._recent.add(fig.id);
		}

		// 2) KPI table tracks the synced week — also a figure-only update, auto-applies.
		if (doc.syncedWeek !== latest.week) { this._recent.add('kpi-table'); }
		doc.syncedWeek = latest.week;
		doc.subtitle = `Week ${latest.week} · ${latest.date} — bound to metrics.csv`;

		// 3) Commentary — narrative. Ask the model to rewrite + classify; fall back to a heuristic.
		const com = doc.blocks.find(b => b.id === 'p-commentary');
		if (com && com.text) {
			const proposal = await this._proposeCommentary(deltaPct, prev.mrr, latest.mrr, com.text);
			this._status = proposal.via === 'model'
				? 'Synced - commentary rewritten by model'
				: 'Synced - commentary by built-in heuristic (no model available)';
			if (proposal.newText !== com.text) {
				const change: IProposedChange = {
					id: generateUuid(),
					blockId: com.id,
					oldText: com.text,
					newText: proposal.newText,
					kind: proposal.kind,
					confidence: proposal.confidence,
					rationale: proposal.rationale,
					sourceCells: com.binding?.cells ?? [],
				};
				if (change.kind === 'figure') {
					// Not a meaning change — auto-apply.
					com.text = change.newText;
					this._recent.add(com.id);
					this._audit.push(this._entry(com.id, 'auto-applied', change.oldText, change.newText, proposal.via));
				} else {
					// Meaning change — queue for one-click approval.
					this._via.set(change.id, proposal.via);
					this._pending = [change, ...this._pending.filter(c => c.blockId !== com.id)];
				}
			}
		}

		this._onDidChange.fire();
	}

	private async _proposeCommentary(deltaPct: number, mrrPrev: number, mrrNow: number, current: string): Promise<{ newText: string; kind: ChangeKind; confidence: number; rationale: string; via: 'model' | 'heuristic' }> {
		try {
			const models = await this._lm.selectLanguageModels({});
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

	async approve(changeId: string): Promise<void> {
		const change = this._pending.find(c => c.id === changeId);
		if (!change || !this._doc) { return; }
		const block = this._doc.blocks.find(b => b.id === change.blockId);
		if (block) { block.text = change.newText; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		this._audit.push(this._entry(change.blockId, 'approved', change.oldText, change.newText, this._via.get(changeId) ?? 'model'));
		this._status = 'Change approved - applied to document';
		await this._persist();
		this._onDidChange.fire();
	}

	reject(changeId: string): void {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		this._audit.push(this._entry(change.blockId, 'rejected', change.oldText, change.newText, this._via.get(changeId) ?? 'model'));
		this._status = 'Change rejected - document left unchanged';
		void this._persist();
		this._onDidChange.fire();
	}

	async revealSource(cells: readonly string[]): Promise<void> {
		if (!this._csvUri) { return; }
		try {
			await this._editors.openEditor({ resource: this._csvUri, options: { pinned: true } }, SIDE_GROUP);
			this._notify.info(`Provenance: this text is bound to ${cells.join(', ')} in metrics.csv (week ${this._doc?.syncedWeek}).`);
		} catch {
			// ignore
		}
	}

	private _entry(blockId: string, action: IAuditEntry['action'], oldText: string, newText: string, via: 'model' | 'heuristic'): IAuditEntry {
		return { time: new Date().toISOString(), blockId, action, oldText, newText, via };
	}

	private async _persist(): Promise<void> {
		if (!this._docUri || !this._doc) { return; }
		try {
			await this._files.writeFile(this._docUri, VSBuffer.fromString(JSON.stringify(this._doc, null, 2)));
			const auditUri = joinPath(dirname(this._docUri), 'Weekly Summary.audit.json');
			await this._files.writeFile(auditUri, VSBuffer.fromString(JSON.stringify(this._audit, null, 2)));
		} catch (e) {
			this._log.warn('[livingDocs] persist failed', e);
		}
	}
}
