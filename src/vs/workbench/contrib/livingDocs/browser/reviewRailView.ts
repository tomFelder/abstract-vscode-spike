/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
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
import { ILivingDocsService } from '../common/livingDocs.js';
import { IAuditEntry, IProposedChange } from '../common/livingDocsModel.js';

type PanelTab = 'chat' | 'review' | 'history';

// The Studio right panel: a Chat / Review / History tabbed surface matching the Workbench hi-fi.
// Review shows pending meaning-changes (the working feature); History shows the audit trail; Chat
// is a styled placeholder for the agent surface that lands in a later phase.
export class ReviewRailView extends ViewPane {

	private _root: HTMLElement | undefined;
	private _activeTab: PanelTab = 'review';
	private _stylesInjected = false;
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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._root = append(container, $('.living-docs-panel'));
		this._root.style.height = '100%';
		this._injectStyles(container);
		this._register(this._livingDocs.onDidChange(() => this._render()));
		this._register(this._livingDocs.onDidRequestPanel(tab => { this._activeTab = tab; this._render(); }));
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
			this._renderChat(content);
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
		status.textContent = pending.length
			? `${pending.length} change${pending.length > 1 ? 's' : ''} need approval across ${groups.size} document${groups.size > 1 ? 's' : ''}.`
			: 'No changes waiting. Open a Living Document and click "Refresh from sources".';

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
	}

	private _renderHistory(content: HTMLElement, audit: readonly IAuditEntry[]): void {
		if (!audit.length) {
			const empty = append(content, $('div.ldp-empty'));
			empty.textContent = 'No history yet. Approved, rejected, and auto-applied changes will appear here.';
			return;
		}
		for (const e of audit.slice().reverse()) {
			const row = append(content, $('div.ldr-audit'));
			const verb = e.action === 'rejected' ? 'rejected' : e.action === 'approved' ? 'approved' : 'auto-applied';
			row.textContent = `${verb} - ${e.docTitle} / ${e.blockId} - via ${e.via} - ${e.time.slice(11, 19)}`;
		}
	}

	private _renderChat(content: HTMLElement): void {
		const empty = append(content, $('div.ldp-empty'));
		const title = append(empty, $('div.ldp-empty-title'));
		title.textContent = 'Chat';
		const body = append(empty, $('div.ldp-empty-body'));
		body.textContent = 'Ask the document agent to draft sections, connect sources, or explain a change. Coming in a later phase.';
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-panel{display:flex;flex-direction:column;height:100%;font:13px system-ui}
		.living-docs-panel .ldp-tabs{display:flex;gap:2px;flex:none;padding:0 8px;border-bottom:1px solid var(--vscode-widget-border,#e9eaee)}
		.living-docs-panel .ldp-tab{position:relative;border:none;background:transparent;padding:11px 12px 10px;font:600 12px/1 system-ui;color:var(--vscode-descriptionForeground);cursor:pointer;display:flex;align-items:center;gap:6px}
		.living-docs-panel .ldp-tab:hover{color:var(--vscode-foreground)}
		.living-docs-panel .ldp-tab.active{color:var(--vscode-foreground)}
		.living-docs-panel .ldp-tab.active::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:oklch(0.55 0.13 255)}
		.living-docs-panel .ldp-tab-count{font:600 9.5px/1 'JetBrains Mono',ui-monospace,monospace;color:#fff;background:oklch(0.66 0.16 45);border-radius:999px;padding:3px 6px}
		.living-docs-panel .ldp-content{flex:1;overflow-y:auto;padding:14px 12px}
		.living-docs-panel .ldp-empty{padding:8px 2px}
		.living-docs-panel .ldp-empty-title{font:600 13px/1 system-ui;color:var(--vscode-foreground);margin-bottom:8px}
		.living-docs-panel .ldp-empty-body{font:400 12px/1.6 system-ui;color:var(--vscode-descriptionForeground)}
		.living-docs-panel .ldr-status{font:400 11.5px/1.5 system-ui;color:var(--vscode-descriptionForeground);margin-bottom:14px}
		.living-docs-panel .ldr-group{margin-bottom:16px}
		.living-docs-panel .ldr-group-head{display:flex;align-items:center;gap:8px;font:600 11px/1 system-ui;letter-spacing:.02em;color:var(--vscode-foreground);text-transform:uppercase;margin:6px 0 8px}
		.living-docs-panel .ldr-group-count{font:600 10px/1 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground);background:var(--vscode-badge-background,#0002);border-radius:999px;padding:2px 7px}
		.living-docs-panel .ldr-card{border:1px solid var(--vscode-widget-border,#e9eaee);border-radius:10px;padding:13px;margin-bottom:12px;background:var(--vscode-editorWidget-background)}
		.living-docs-panel .ldr-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
		.living-docs-panel .ldr-card-name{font:600 12.5px/1 system-ui;color:var(--vscode-foreground)}
		.living-docs-panel .ldr-tag{font:600 9px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.04em;color:#b4332f;background:#fdecec;border-radius:999px;padding:4px 7px}
		.living-docs-panel .ldr-diff{border:1px solid var(--vscode-widget-border,#e9eaee);border-radius:7px;overflow:hidden;margin-bottom:10px}
		.living-docs-panel .ldr-o{background:#fdecec;color:#7a3a38;text-decoration:line-through;text-decoration-color:rgba(180,51,47,.4);padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-panel .ldr-n{background:#e7f6ec;color:#1f5a36;padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-panel .ldr-why{font:400 11.5px/1.5 system-ui;color:var(--vscode-descriptionForeground);background:var(--vscode-textBlockQuote-background,#f4f5f7);border-radius:7px;padding:8px 10px;margin-bottom:10px}
		.living-docs-panel .ldr-meta{display:flex;flex-wrap:wrap;gap:12px;font:600 10px/1.4 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground);margin-bottom:12px}
		.living-docs-panel .ldr-actions{display:flex;gap:8px}
		.living-docs-panel .ldr-approve{flex:1;border:none;border-radius:8px;padding:9px;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/1 system-ui;cursor:pointer}
		.living-docs-panel .ldr-approve:hover{background:oklch(0.5 0.13 255)}
		.living-docs-panel .ldr-reject{border:1px solid var(--vscode-widget-border,#e0e2e8);border-radius:8px;padding:9px 14px;background:transparent;color:var(--vscode-foreground);font:500 12px/1 system-ui;cursor:pointer}
		.living-docs-panel .ldr-reject:hover{background:var(--vscode-list-hoverBackground)}
		.living-docs-panel .ldr-audit{font:400 10.5px/1.7 'JetBrains Mono',ui-monospace,monospace;color:var(--vscode-descriptionForeground)}
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
