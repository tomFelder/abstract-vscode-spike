/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILivingDocsService, ISkillCheck } from '../common/livingDocs.js';
import { IAuditEntry, IProposedChange } from '../common/livingDocsModel.js';

type PanelTab = 'chat' | 'review' | 'history';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The Studio right panel: the comp's exact Chat / Review / History 3-tab surface. Chat is the agent
// front door; Review shows the real pending meaning-changes (wired to approve/reject) AND the document
// checks (the skill graders, folded in here so the tab strip matches the comp - v3 iter 3); History is
// the version timeline (seeded from the real audit when present). Our own surface -- no core patch.
export class ReviewRailView extends ViewPane {

	private _root: HTMLElement | undefined;
	private _activeTab: PanelTab = 'review';
	private _stylesInjected = false;
	// The unsent composer text, kept across re-renders so a background refresh never eats a draft.
	private _chatDraft = '';
	// The Document-Agents section is relocated to an on-demand disclosure at the bottom of Review (the
	// "Workbench v2" comp drops the always-on panel; the agents stay reachable). Collapsed by default so the
	// Review tab matches the comp; this remembers the open/closed state across re-renders this session.
	private _checksExpanded = false;
	private readonly _renderDisposables = this._register(new DisposableStore());

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IEditorService private readonly _editors: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	// The Review tab grades the active document (the checks section), so re-render when the active
	// editor changes.
	private _activeDoc(): URI | undefined {
		// Chat (and the rail) are available on EVERY open document (decision 48), not just living ones -
		// "living" is a data-binding badge, not a chat gate. The Skills/checks section stays tied to real
		// bindings via getSkillReport (which returns nothing for a plain doc), so a plain doc gets the chat
		// surface + any chat proposals without the source-bound affordances.
		const resource = this._editors.activeEditor?.resource;
		return resource && this._livingDocs.getDoc(resource) ? resource : undefined;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._root = append(container, $('.living-docs-panel'));
		this._root.style.height = '100%';
		this._injectStyles(container);
		this._register(this._livingDocs.onDidChange(() => this._render()));
		this._register(this._livingDocs.onDidRequestPanel(tab => { this._activeTab = tab; this._render(); }));
		this._register(this._editors.onDidActiveEditorChange(() => { if (this._activeTab === 'review' || this._activeTab === 'chat') { this._render(); } }));
		this._render();
	}

	private _render(): void {
		const root = this._root;
		if (!root) { return; }
		this._renderDisposables.clear();
		clearNode(root);

		const pending = this._livingDocs.getAllPending();
		const audit = this._livingDocs.getAudit();

		// --- tab strip ---
		const tabs = append(root, $('div.ldp-tabs'));
		const addTab = (tab: PanelTab, label: string, count?: number) => {
			const el = append(tabs, $(`button.ldp-tab${this._activeTab === tab ? '.active' : ''}`)) as HTMLButtonElement;
			el.textContent = label;
			if (count) {
				const badge = append(el, $('span.ldp-tab-count'));
				badge.textContent = `${count}`;
			}
			this._renderDisposables.add(addDisposableListener(el, 'click', () => {
				if (this._activeTab !== tab) { this._activeTab = tab; this._render(); }
			}));
		};
		addTab('chat', 'Chat');
		addTab('review', 'Review', pending.length);
		addTab('history', 'History');

		// --- content ---
		const content = append(root, $('div.ldp-content'));
		if (this._activeTab === 'chat') {
			this._renderChat(content, pending.length);
		} else if (this._activeTab === 'history') {
			this._renderHistory(content, audit);
		} else {
			this._renderReview(content, pending);
		}
	}

	private _renderReview(content: HTMLElement, pending: readonly IProposedChange[]): void {
		// Group pending changes by the document they belong to.
		const groups = new Map<string, typeof pending[number][]>();
		for (const change of pending) {
			const list = groups.get(change.docTitle) ?? [];
			list.push(change);
			groups.set(change.docTitle, list);
		}

		const status = append(content, $('div.ldr-status'));
		// The empty state used to read "No changes waiting. Open a Living Document and click 'Refresh
		// from sources'." verbatim on EVERY screen and even while a document was already open -- stale,
		// jargon-y, and often plainly false. Make it context-aware: name the open document, or, when none
		// is open, invite the user to open one without the IDE-ish "Refresh from sources" instruction.
		const activeResource = this._activeDoc();
		const activeTitle = activeResource ? this._livingDocs.getDoc(activeResource)?.title : undefined;
		status.textContent = pending.length
			? `${pending.length} change${pending.length > 1 ? 's' : ''} need approval across ${groups.size} document${groups.size > 1 ? 's' : ''}.`
			: activeTitle
				? `No changes waiting on "${activeTitle}".`
				: 'Nothing to review yet. Open a document to see the changes its agents propose.';

		for (const [docTitle, changes] of groups) {
			const group = append(content, $('div.ldr-group'));
			const groupHeader = append(group, $('div.ldr-group-head'));
			groupHeader.textContent = docTitle;
			const count = append(groupHeader, $('span.ldr-group-count'));
			count.textContent = `${changes.length}`;

			for (const change of changes) {
				const card = append(group, $('div.ldr-card'));

				const top = append(card, $('div.ldr-card-top'));
				const name = append(top, $('span.ldr-card-name'));
				name.textContent = change.blockLabel;
				const tag = append(top, $('span.ldr-tag'));
				tag.textContent = 'MEANING CHANGE';

				const diff = append(card, $('div.ldr-diff'));
				const o = append(diff, $('div.ldr-o'));
				o.textContent = change.oldText;
				const n = append(diff, $('div.ldr-n'));
				n.textContent = change.newText;

				const why = append(card, $('div.ldr-why'));
				why.textContent = `Why: ${change.rationale}`;

				const meta = append(card, $('div.ldr-meta'));
				const conf = append(meta, $('span'));
				conf.innerText = `Confidence: ${Math.round(change.confidence * 100)}%`;
				const risk = append(meta, $('span'));
				risk.innerText = 'Risk: narrative';
				const src = append(meta, $('span'));
				src.innerText = `Source: ${change.sourceCells.join(', ') || 'metrics.csv'}`;

				const actions = append(card, $('div.ldr-actions'));
				const approve = append(actions, $('button.ldr-approve')) as HTMLButtonElement;
				approve.textContent = 'Approve & apply';
				this._renderDisposables.add(addDisposableListener(approve, 'click', () => this._livingDocs.approve(change.id)));
				const reject = append(actions, $('button.ldr-reject')) as HTMLButtonElement;
				reject.textContent = 'Reject';
				this._renderDisposables.add(addDisposableListener(reject, 'click', () => this._livingDocs.reject(change.id)));
			}
		}

		// Document agents (the skill graders) are relocated to an on-demand disclosure at the bottom of
		// Review (v4 iter 4): collapsed by default so the Review tab matches the comp, expandable to reach
		// the wired v1 agents (Run / Re-run / Apply fix). The disclosure only shows for a living document.
		this._appendChecks(content);
	}

	private _renderHistory(content: HTMLElement, audit: readonly IAuditEntry[]): void {
		content.innerHTML = historyHtml(audit);
	}

	private _appendChecks(parent: HTMLElement): void {
		const resource = this._activeDoc();
		// No living document open -> no agents affordance (the comp's Review tab shows only review content).
		if (!resource) { return; }
		const report = this._livingDocs.getSkillReport(resource);
		if (!report.length) { return; }
		const title = this._livingDocs.getDoc(resource)?.title;
		const flags = report.filter(s => s.status === 'flag').length;
		const section = append(parent, $('div.ldr-checks'));
		section.innerHTML = checksDisclosureHtml(this._checksExpanded, flags, report, title);
		// The disclosure toggle relocates the agents off the always-on rail. "Run" / "Re-run" re-grade the
		// live document (Strategy calls the model via the proxy); "Apply fix" applies a skill's deterministic
		// edit (Formatting title-cases the flagged headings). All re-render when the service fires onDidChange.
		this._renderDisposables.add(addDisposableListener(section, 'click', e => {
			let el = e.target as HTMLElement | null;
			while (el && el !== section) {
				if (el.getAttribute('data-checks-toggle') !== null) {
					this._checksExpanded = !this._checksExpanded;
					this._render();
					return;
				}
				const fixId = el.getAttribute('data-skill-fix');
				if (fixId) {
					void this._livingDocs.applySkillFix(resource, fixId as ISkillCheck['id']);
					return;
				}
				const id = el.getAttribute('data-skill-run');
				if (id) {
					this._livingDocs.runSkillCheck(resource, id as ISkillCheck['id']);
					return;
				}
				el = el.parentElement;
			}
		}));
	}

	// The Chat tab is a real, model-backed agent surface: a scrolling conversation over the active
	// Living Document plus a live composer with @mention chips. Replies (and any prose edits the agent
	// proposes) come from livingDocsService.sendChatMessage; proposed edits land in the Review rail, so
	// "Approve all / Review each" keep working on them. Built as DOM (the rail is not a webview).
	private _renderChat(content: HTMLElement, pendingCount: number): void {
		const doc = this._activeDoc();
		content.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:0';

		const scroll = append(content, $('div'));
		scroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:16px';

		const messages = doc ? this._livingDocs.getChatMessages(doc) : [];
		if (!doc) {
			this._renderChatEmpty(scroll, 'Open a document in the editor to chat with its agent.');
		} else if (messages.length === 0) {
			this._renderChatEmpty(scroll, 'Ask the agent about this document, or @mention a source to pull it in.');
		} else {
			for (const m of messages) { this._renderChatMessage(scroll, m); }
		}

		if (doc && this._livingDocs.isChatBusy(doc)) {
			// A visibly-alive working state (plan 16 iter 5): a pulsing agent avatar + an animated ellipsis,
			// so the in-flight wait reads as "thinking", not a frozen hang. Pure CSS animation (the rail is
			// DOM, re-rendered on state change) -- no timer to leak.
			const busy = append(scroll, $('div.ldp-busy'));
			const avatar = append(busy, $('span.ldp-busy-avatar'));
			avatar.textContent = '\u273B';
			const label = append(busy, $('span.ldp-busy-label'));
			label.textContent = 'Thinking';
			append(label, $('span.ldp-busy-dots'));
		}

		// The standing approve/reject summary: whenever changes are pending, the agent surfaces the
		// one-tap "Approve all" + "Review each" controls (criterion 2 keeps these wired).
		if (pendingCount > 0) {
			const summary = append(scroll, $('div'));
			summary.style.cssText = 'border:1px solid #e0e6ff;background:#f7f9ff;border-radius:10px;padding:11px 12px';
			const head = append(summary, $('div'));
			head.style.cssText = 'font:600 11.5px/1 system-ui;color:#3a3f49;margin-bottom:9px';
			head.textContent = `${pendingCount} change${pendingCount > 1 ? 's' : ''} waiting on you`;
			const actions = append(summary, $('div'));
			actions.style.cssText = 'display:flex;gap:7px';
			const approveAll = append(actions, $('button')) as HTMLButtonElement;
			approveAll.style.cssText = 'flex:1;border:none;border-radius:8px;padding:9px;background:oklch(0.55 0.13 255);color:#fff;font:600 12.5px/1 system-ui;cursor:pointer';
			approveAll.textContent = 'Approve all';
			this._renderDisposables.add(addDisposableListener(approveAll, 'click', () => {
				// Scope accept-all to the document in view; fall back to every pending change when no doc is active.
				const doc = this._activeDoc();
				if (doc) { void this._livingDocs.approveAll(doc.toString()); }
				else { for (const change of this._livingDocs.getAllPending()) { void this._livingDocs.approve(change.id); } }
			}));
			const reviewEach = append(actions, $('button')) as HTMLButtonElement;
			reviewEach.style.cssText = 'border:1px solid #d8e0fb;border-radius:8px;padding:9px 12px;background:#fff;color:oklch(0.5 0.13 255);font:500 12.5px/1 system-ui;cursor:pointer';
			reviewEach.textContent = 'Review each';
			this._renderDisposables.add(addDisposableListener(reviewEach, 'click', () => { this._activeTab = 'review'; this._render(); }));
		}

		this._renderChatComposer(content, doc);
	}

	private _renderChatEmpty(scroll: HTMLElement, text: string): void {
		const empty = append(scroll, $('div'));
		empty.style.cssText = 'margin:auto 0;text-align:center;font:400 12.5px/1.6 system-ui;color:#a3a8b2;padding:24px 8px';
		empty.textContent = text;
	}

	private _renderChatMessage(scroll: HTMLElement, m: { role: 'user' | 'assistant'; content: string; mentions?: readonly string[]; steps?: readonly { label: string; status: 'done' | 'queued' }[]; via?: 'model' | 'fallback'; proposedIds?: readonly string[] }): void {
		if (m.role === 'user') {
			const wrap = append(scroll, $('div'));
			wrap.style.cssText = 'align-self:flex-end;max-width:88%;display:flex;flex-direction:column;align-items:flex-end;gap:6px';
			if (m.mentions && m.mentions.length) {
				const chips = append(wrap, $('div'));
				chips.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end';
				for (const mention of m.mentions) {
					const chip = append(chips, $('span'));
					chip.style.cssText = 'font:500 10.5px/1 ui-monospace,monospace;color:#5b6dc4;background:#eef1ff;border:1px solid #e0e6ff;border-radius:6px;padding:4px 7px';
					chip.textContent = `@${mention}`;
				}
			}
			const bubble = append(wrap, $('div'));
			bubble.style.cssText = 'background:#eef1f6;border:1px solid #e4e7ee;border-radius:13px 13px 4px 13px;padding:10px 13px;font:400 13.5px/1.55 system-ui;color:#2c2f36;white-space:pre-wrap';
			bubble.textContent = m.content;
			return;
		}

		const row = append(scroll, $('div'));
		row.style.cssText = 'display:flex;gap:9px';
		const avatar = append(row, $('span'));
		avatar.style.cssText = 'flex:none;width:24px;height:24px;border-radius:50%;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/24px system-ui;text-align:center';
		avatar.textContent = '\u273B';
		const col = append(row, $('div'));
		col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:10px';

		if (m.steps && m.steps.length) {
			const card = append(col, $('div'));
			card.style.cssText = 'border:1px solid #eceef2;border-radius:10px;overflow:hidden;background:#fff';
			m.steps.forEach((step, i) => {
				const stepRow = append(card, $('div'));
				const queued = step.status === 'queued';
				stepRow.style.cssText = `display:flex;gap:8px;padding:8px 12px;font:400 11.5px/1.4 ui-monospace,monospace;color:${queued ? '#9a6b16' : '#5d8a66'}${i < m.steps!.length - 1 ? ';border-bottom:1px solid #f4f5f7' : ''}`;
				const glyph = append(stepRow, $('span'));
				glyph.textContent = queued ? '\u2192' : '\u2713';
				const label = append(stepRow, $('span'));
				label.textContent = step.label;
			});
		}

		const body = append(col, $('p'));
		const fallback = m.via === 'fallback';
		body.style.cssText = `margin:0;font:400 13.5px/1.6 system-ui;white-space:pre-wrap;color:${fallback ? '#9a6b16' : '#2c2f36'}${fallback ? ';background:#fdf6e9;border:1px solid #f0e2c4;border-radius:9px;padding:9px 11px' : ''}`;
		body.textContent = m.content;

		// F5: a Copilot/Cursor-style review card per proposal this turn produced. Read the LIVE pending
		// change by id so the card naturally disappears once accepted/rejected (here or in the document).
		if (m.proposedIds && m.proposedIds.length) {
			const live = this._livingDocs.getAllPending().filter(c => m.proposedIds!.includes(c.id));
			for (const change of live) {
				const isInsert = !!change.insert;
				const card = append(col, $('div'));
				card.style.cssText = 'border:1px solid #e4e7ee;border-radius:10px;overflow:hidden;background:#fbfcff';
				const head = append(card, $('div'));
				head.style.cssText = `display:flex;align-items:center;gap:7px;padding:9px 12px 7px;font:600 10.5px/1 ui-monospace,monospace;letter-spacing:.04em;color:${isInsert ? '#1f7a44' : '#9a6b16'}`;
				const tag = append(head, $('span'));
				tag.textContent = isInsert ? '+ NEW CONTENT' : '\u270E EDIT';
				const where = append(head, $('span'));
				where.style.cssText = 'color:#868b95;font-weight:400';
				where.textContent = isInsert ? `after ${change.blockLabel}` : change.blockLabel;
				const preview = append(card, $('div'));
				preview.style.cssText = 'padding:2px 12px 9px;font:400 12.5px/1.5 system-ui;color:#52575f;white-space:pre-wrap;max-height:96px;overflow:hidden';
				preview.textContent = change.newText.length > 240 ? change.newText.slice(0, 240) + '\u2026' : change.newText;
				const actions = append(card, $('div'));
				actions.style.cssText = 'display:flex;gap:7px;padding:9px 12px;border-top:1px solid #eef0f3';
				const approve = append(actions, $('button')) as HTMLButtonElement;
				approve.style.cssText = 'flex:1;border:none;border-radius:7px;padding:8px;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/1 system-ui;cursor:pointer';
				approve.textContent = isInsert ? 'Insert' : 'Apply';
				this._renderDisposables.add(addDisposableListener(approve, 'click', () => void this._livingDocs.approve(change.id)));
				const reject = append(actions, $('button')) as HTMLButtonElement;
				reject.style.cssText = 'border:1px solid #e0e2e8;border-radius:7px;padding:8px 12px;background:#fff;color:#696e78;font:500 12px/1 system-ui;cursor:pointer';
				reject.textContent = 'Reject';
				this._renderDisposables.add(addDisposableListener(reject, 'click', () => this._livingDocs.reject(change.id)));
			}
		}
	}

	private _renderChatComposer(content: HTMLElement, doc: URI | undefined): void {
		const footer = append(content, $('div'));
		footer.style.cssText = 'flex:none;border-top:1px solid #eef0f3;padding:10px 12px;background:#fbfbfc';

		const box = append(footer, $('div'));
		box.style.cssText = 'border:1px solid #e0e2e8;border-radius:11px;background:#fff;padding:8px 9px';

		const input = append(box, $('textarea')) as HTMLTextAreaElement;
		input.placeholder = doc ? 'Ask the agent, or @mention a file\u2026' : 'Open a document to chat\u2026';
		input.value = this._chatDraft;
		input.rows = 2;
		input.disabled = !doc;
		input.style.cssText = 'width:100%;box-sizing:border-box;border:none;outline:none;resize:none;background:transparent;font:400 13px/1.5 system-ui;color:#2c2f36';
		this._renderDisposables.add(addDisposableListener(input, 'input', () => { this._chatDraft = input.value; }));

		const mentions = doc ? this._livingDocs.getMentionableFiles(doc) : [];
		if (mentions.length) {
			const chips = append(box, $('div'));
			chips.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;padding:8px 0 2px';
			const hint = append(chips, $('span'));
			hint.style.cssText = 'font:500 10.5px/1.6 system-ui;color:#bcc0c8';
			hint.textContent = 'Attach:';
			for (const file of mentions) {
				const chip = append(chips, $('button')) as HTMLButtonElement;
				chip.style.cssText = 'font:500 10.5px/1 ui-monospace,monospace;color:#5b6dc4;background:#eef1ff;border:1px solid #e0e6ff;border-radius:6px;padding:4px 7px;cursor:pointer';
				chip.textContent = `@${file}`;
				this._renderDisposables.add(addDisposableListener(chip, 'click', () => {
					const sep = input.value.length && !input.value.endsWith(' ') ? ' ' : '';
					input.value = `${input.value}${sep}@${file} `;
					this._chatDraft = input.value;
					input.focus();
				}));
			}
		}

		const bar = append(box, $('div'));
		bar.style.cssText = 'display:flex;align-items:center;gap:7px;padding-top:8px';
		const model = append(bar, $('span'));
		model.style.cssText = 'font:500 11px/1 system-ui;color:#52575f;background:#f4f5f7;border-radius:7px;padding:6px 9px;display:inline-flex;gap:5px;align-items:center';
		model.textContent = '\u273B Agent';
		const send = append(bar, $('button')) as HTMLButtonElement;
		send.style.cssText = 'margin-left:auto;width:30px;height:30px;border:none;border-radius:8px;background:oklch(0.55 0.13 255);color:#fff;font-size:15px;cursor:pointer';
		send.textContent = '\u2191';
		send.disabled = !doc;

		const submit = () => {
			if (!doc) { return; }
			const text = input.value.trim();
			if (!text) { return; }
			this._chatDraft = '';
			void this._livingDocs.sendChatMessage(doc, text);
		};
		this._renderDisposables.add(addDisposableListener(send, 'click', submit));
		this._renderDisposables.add(addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
		}));

		// Keep the cursor in the composer across the re-render that each message triggers.
		if (doc && !this._livingDocs.isChatBusy(doc)) { input.focus(); }
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-panel{display:flex;flex-direction:column;height:100%;font:13px system-ui;background:#fbfbfc}
		.living-docs-panel .ldp-tabs{display:flex;gap:2px;flex:none;padding:0 4px;border-bottom:1px solid #eef0f3}
		.living-docs-panel .ldp-tab{position:relative;border:none;background:transparent;padding:11px 11px 10px;font:500 12.5px/1 system-ui;color:#868b95;cursor:pointer;display:flex;align-items:center;gap:6px}
		.living-docs-panel .ldp-tab:hover{color:#1a1c20}
		.living-docs-panel .ldp-tab.active{color:#1a1c20;font-weight:600}
		.living-docs-panel .ldp-tab.active::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:oklch(0.55 0.13 255)}
		.living-docs-panel .ldp-tab-count{font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#fff;background:oklch(0.66 0.16 45);border-radius:999px;padding:3px 5px}
		.living-docs-panel .ldp-content{flex:1;overflow-y:auto}
		.living-docs-panel .ldr-content,.living-docs-panel .ldp-content{padding:14px 12px}
		.living-docs-panel .ldr-status{font:400 11.5px/1.5 system-ui;color:#868b95;margin-bottom:14px}
		.living-docs-panel .ldr-group{margin-bottom:16px}
		.living-docs-panel .ldr-group-head{display:flex;align-items:center;gap:8px;font:600 11px/1 system-ui;letter-spacing:.02em;color:#1a1c20;text-transform:uppercase;margin:6px 0 8px}
		.living-docs-panel .ldr-group-count{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#868b95;background:#0001;border-radius:999px;padding:2px 7px}
		.living-docs-panel .ldr-card{border:1px solid #eceef2;border-radius:10px;padding:13px;margin-bottom:12px;background:#fff}
		.living-docs-panel .ldr-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
		.living-docs-panel .ldr-card-name{font:600 12.5px/1 system-ui;color:#1a1c20}
		.living-docs-panel .ldr-tag{font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.04em;color:#b4332f;background:#fdecec;border-radius:999px;padding:4px 7px}
		.living-docs-panel .ldr-diff{border:1px solid #eceef2;border-radius:7px;overflow:hidden;margin-bottom:10px}
		.living-docs-panel .ldr-o{background:#fdecec;color:#7a3a38;text-decoration:line-through;text-decoration-color:rgba(180,51,47,.4);padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-panel .ldr-n{background:#e7f6ec;color:#1f5a36;padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-panel .ldr-why{font:400 12.5px/1.55 system-ui;color:#4a4f6a;background:#f4f6ff;border:1px solid #e2e8ff;border-radius:9px;padding:11px 12px;margin-bottom:16px}
		.living-docs-panel .ldr-meta{display:flex;flex-wrap:wrap;gap:12px;font:600 10px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#868b95;margin-bottom:12px}
		.living-docs-panel .ldr-actions{display:flex;gap:8px}
		.living-docs-panel .ldr-approve{flex:1;border:none;border-radius:8px;padding:11px;background:oklch(0.55 0.13 255);color:#fff;font:600 13px/1 system-ui;cursor:pointer}
		.living-docs-panel .ldr-approve:hover{background:oklch(0.5 0.13 255)}
		.living-docs-panel .ldr-reject{border:1px solid #e0e2e8;border-radius:8px;padding:11px 16px;background:#fff;color:#696e78;font:500 13px/1 system-ui;cursor:pointer}
		.living-docs-panel .ldr-reject:hover{background:#f4f5f7}
		.living-docs-panel .ldr-checks{margin-top:6px;padding-top:16px;border-top:1px solid #eef0f3}
		.living-docs-panel .ldp-busy{display:flex;gap:9px;align-items:center}
		.living-docs-panel .ldp-busy-avatar{flex:none;width:24px;height:24px;border-radius:50%;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/24px system-ui;text-align:center;animation:ldp-pulse 1.4s ease-in-out infinite}
		.living-docs-panel .ldp-busy-label{font:400 13px/1.6 system-ui;color:#a3a8b2}
		.living-docs-panel .ldp-busy-dots::after{content:"";animation:ldp-dots 1.4s steps(4,end) infinite}
		@keyframes ldp-pulse{0%,100%{opacity:1}50%{opacity:.45}}
		@keyframes ldp-dots{0%{content:""}25%{content:"\\2009."}50%{content:"\\2009.."}75%{content:"\\2009..."}100%{content:"\\2009..."}}
		`;
		container.appendChild(style);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._root) {
			this._root.style.height = `${height}px`;
		}
	}
}

// ---- Static comp-faithful bodies (History, and the document-checks section folded into Review).
// Light colours match the registered "Abstract" theme, so hardcoding them here reproduces the
// comp exactly. (Chat is now a live DOM surface in _renderChat, not a static string.) ----

function timelineRow(dot: string, title: string, badge: string, body: string, meta: string, last: boolean): string {
	const connector = last ? '' : `<span style="flex:1;width:2px;background:#e6e8ed"></span>`;
	return `<div style="display:flex;gap:11px"><div style="flex:none;display:flex;flex-direction:column;align-items:center">${dot}${connector}</div>`
		+ `<div style="flex:1;padding-bottom:${last ? '0' : '18px'}"><div style="display:flex;align-items:center;gap:7px"><span style="font:600 12.5px/1 system-ui;color:#1a1c20">${title}</span>${badge}</div>`
		+ `<div style="font:400 12.5px/1.5 system-ui;color:#52575f;margin:5px 0 3px">${body}</div><div style="font:400 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${meta}</div></div></div>`;
}

function historyHtml(audit: readonly IAuditEntry[]): string {
	const dot = (color: string) => `<span style="width:10px;height:10px;border-radius:50%;background:${color}"></span>`;
	const head = `<div style="font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;padding:0 2px 14px">VERSION HISTORY &middot; WEEKLY SUMMARY.MD</div>`;
	// Seed the timeline with the real audit entries when present (most recent first), then the comp's
	// earlier sample versions for context.
	const real = audit.slice().reverse().slice(0, 4).map((e, i, arr) => {
		const verb = e.action === 'rejected' ? 'Rejected' : e.action === 'approved' ? 'Approved' : 'Auto-applied';
		const badge = i === 0 ? `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#1f7a44;background:#e7f6ec;border-radius:999px;padding:3px 6px">CURRENT</span>` : '';
		return timelineRow(dot(i === 0 ? 'oklch(0.55 0.13 255)' : '#cfd3da'), `${verb}`, badge, `${esc(e.docTitle)} / ${esc(e.blockId)}`, `${esc(e.via)} &middot; ${esc(e.time.slice(11, 19))}`, false);
	}).join('');
	const sample = [
		timelineRow(dot('oklch(0.55 0.13 255)'), 'v14', `<span style="font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#1f7a44;background:#e7f6ec;border-radius:999px;padding:3px 6px">CURRENT</span>`, 'Approved commentary rewrite', 'just now &middot; Tom', false),
		timelineRow(dot('#cfd3da'), 'v13', '', 'Auto-refresh: MRR, signups updated', `<span style="color:oklch(0.55 0.13 255)">&#10227;</span> 2m ago &middot; Weekly refresh`, false),
		timelineRow(dot('#cfd3da'), 'v12', '', 'Edited "What to watch"', 'yesterday 18:00 &middot; Tom', false),
		timelineRow(`<span style="font-size:12px;color:oklch(0.66 0.16 45)">&#9733;</span>`, 'v11', `<span style="font:500 9px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:3px 6px">SNAPSHOT</span>`, 'Created from Weekly report template', 'Jun 12 &middot; Tom', true),
	].join('');
	return head + (real || sample);
}

// The on-demand "Document agents" disclosure at the bottom of Review (v4 iter 4): a single calm toggle row
// (so the Review tab matches the "Workbench v2" comp, which dropped the always-on panel) that expands to
// the wired agents. A small flag count rides on the row so an outstanding fix is not hidden.
function checksDisclosureHtml(expanded: boolean, flags: number, report: readonly ISkillCheck[], docTitle: string | undefined): string {
	const chevron = expanded ? '&#9662;' : '&#9656;';
	const flagBadge = (flags > 0 && !expanded)
		? `<span style="margin-left:auto;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:#9a6b16;background:#fdf2dc;border-radius:999px;padding:4px 7px">${flags}</span>`
		: '';
	const toggle = `<button data-checks-toggle style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;border-top:1px solid #eef0f3;margin-top:8px;padding:13px 2px 11px;cursor:pointer;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#a3a8b2;text-transform:uppercase">`
		+ `<span style="color:#bcc0c8;font-size:11px">${chevron}</span>DOCUMENT AGENTS${flagBadge}</button>`;
	return toggle + (expanded ? skillsHtml(report, docTitle) : '');
}

// Skills (document agents) -- the agents that run on this document, on demand or before export.
// Data-driven from the live grader report (spec 5). Financial + Formatting are deterministic verdicts on
// the active document; Strategy reports a needs-model state. "Run"/"Re-run" re-grade. The decorative RUN
// ON EXPORT toggle + Add-skill row match the comp. Rendered only when the disclosure above is expanded.
function skillsHtml(report: readonly ISkillCheck[], docTitle: string | undefined): string {
	if (!report.length) {
		return `<div style="font:400 12.5px/1.6 system-ui;color:#868b95;padding:8px 2px">Open a Living Document to see the Skills that run on it.</div>`;
	}
	const icons: Record<string, { glyph: string; bg: string; fg: string }> = {
		strategy: { glyph: '&#9672;', bg: '#fdf2dc', fg: '#9a6b16' },
		financial: { glyph: '&#8721;', bg: '#e7f3ec', fg: '#217346' },
		formatting: { glyph: '&#182;', bg: '#eef1f6', fg: '#52575f' },
	};
	const badge = (s: ISkillCheck): string => {
		const m: Record<string, { label: string; color: string; bg: string }> = {
			pass: { label: 'PASS', color: '#1f7a44', bg: '#e7f6ec' },
			flag: { label: 'FLAG', color: '#9a6b16', bg: '#fdf2dc' },
			'needs-model': { label: 'NO MODEL', color: '#868b95', bg: '#eef1f6' },
			ready: { label: 'READY', color: 'oklch(0.55 0.13 255)', bg: '#eef2fb' },
		};
		const b = m[s.status];
		return `<span style="margin-left:auto;font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:${b.color};background:${b.bg};border-radius:999px;padding:4px 7px;flex:none">${b.label}</span>`;
	};
	const runBtn = (s: ISkillCheck): string => s.canRun
		? `<button data-skill-run="${s.id}" style="border:1px solid #e0e2e8;border-radius:7px;padding:7px 11px;background:#fff;color:#52575f;font:500 11.5px/1 system-ui;cursor:pointer">${s.status === 'pass' ? 'Re-run' : 'Run'}</button>`
		: '';
	// "Apply fix" appears on a flagged skill that carries a deterministic edit (Formatting heading-case);
	// it is the primary action, so it takes the right-aligned slot with Run beside it.
	const fixBtn = (s: ISkillCheck): string => (s.fixable && s.status === 'flag')
		? `<button data-skill-fix="${s.id}" style="margin-left:auto;border:none;border-radius:7px;padding:7px 11px;background:oklch(0.55 0.13 255);color:#fff;font:600 11.5px/1 system-ui;cursor:pointer">Apply fix</button>`
		: '';
	const card = (s: ISkillCheck): string => {
		const ic = icons[s.id];
		const border = s.status === 'flag' ? '1.5px solid oklch(0.78 0.1 70)' : '1px solid #eceef2';
		const detailColor = s.status === 'flag' ? '#52575f' : '#868b95';
		return `<div style="border:${border};border-radius:11px;overflow:hidden;margin-bottom:11px">`
			+ `<div style="display:flex;align-items:center;gap:9px;padding:11px 13px"><span style="width:28px;height:28px;flex:none;border-radius:8px;background:${ic.bg};color:${ic.fg};font-size:14px;display:flex;align-items:center;justify-content:center">${ic.glyph}</span><div style="min-width:0"><div style="font:600 13px/1.2 system-ui;color:#1a1c20">${esc(s.name)}</div><div style="font:400 11px/1.3 system-ui;color:#868b95">${esc(s.blurb)}</div></div>${badge(s)}</div>`
			+ `<div style="margin:0 13px;border-top:1px solid #f4f5f7;padding:10px 0;display:flex;align-items:center;gap:8px"><span style="flex:1;font:400 12px/1.4 system-ui;color:${detailColor}">${esc(s.detail)}</span>${fixBtn(s)}${runBtn(s)}</div></div>`;
	};
	const sub = docTitle ? `Skills that run on ${esc(docTitle)} &mdash; on demand or before export.` : 'Skills that run on this document.';
	// The "DOCUMENT AGENTS" label lives on the disclosure toggle (checksDisclosureHtml) now, so this body
	// starts straight at the sub-line. The whole body only renders when the disclosure is expanded.
	return `<div style="display:flex;flex-direction:column;padding-top:11px">
	<div style="font:400 11px/1.45 system-ui;color:#a3a8b2;padding:0 2px 14px">${sub}</div>
	${report.map(card).join('')}
	<div style="font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;color:#bcc0c8;padding:0 2px 8px">RUN ON EXPORT</div>
	<div style="display:flex;align-items:center;gap:9px;border:1px solid #eceef2;background:#fff;border-radius:9px;padding:10px 12px;margin-bottom:14px"><span style="font:400 12px/1.4 system-ui;color:#52575f">Formatting + Financial</span><span style="margin-left:auto;width:34px;height:20px;border-radius:999px;background:oklch(0.55 0.13 255);position:relative;flex:none"><span style="position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;background:#fff"></span></span></div>
	<button style="width:100%;border:1px dashed #d4d7de;background:#fff;border-radius:8px;padding:9px;font:500 12px/1 system-ui;color:#868b95;cursor:pointer">&#65291; Add skill from library</button>
</div>`;
}
