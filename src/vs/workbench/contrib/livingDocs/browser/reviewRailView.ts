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

export const REVIEW_RAIL_VIEW_ID = 'workbench.view.livingDocs.review';
export const REVIEW_RAIL_CONTAINER_ID = 'workbench.viewContainer.livingDocs';

export class ReviewRailView extends ViewPane {

	private _body: HTMLElement | undefined;
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
		this._body = append(container, $('.living-docs-review'));
		this._body.style.overflowY = 'auto';
		this._body.style.height = '100%';
		this._body.style.padding = '12px';
		this._body.style.font = '13px system-ui';
		this._injectStyles(container);
		this._register(this._livingDocs.onDidChange(() => this._render()));
		this._render();
	}

	private _render(): void {
		const body = this._body;
		if (!body) { return; }
		this._renderDisposables.clear();
		clearNode(body);

		const pending = this._livingDocs.getPending();
		const audit = this._livingDocs.getAudit();

		const header = append(body, $('div.ldr-header'));
		header.textContent = pending.length ? `${pending.length} change${pending.length > 1 ? 's' : ''} need approval` : 'Review';
		if (pending.length) {
			const badge = append(header, $('span.ldr-badge'));
			badge.textContent = `${pending.length} pending`;
		}

		const status = append(body, $('div.ldr-status'));
		status.textContent = this._livingDocs.getStatus();

		if (!pending.length) {
			const empty = append(body, $('div.ldr-empty'));
			empty.textContent = 'No changes waiting. Open Weekly Summary.ldoc and click "Refresh from sources".';
		}

		for (const change of pending) {
			const card = append(body, $('div.ldr-card'));

			const top = append(card, $('div.ldr-card-top'));
			const name = append(top, $('span.ldr-card-name'));
			name.textContent = change.blockId === 'p-commentary' ? 'Weekly Summary · Commentary' : change.blockId;
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

		if (audit.length) {
			const auditTitle = append(body, $('div.ldr-audit-title'));
			auditTitle.textContent = `AUDIT TRAIL · ${audit.length}`;
			for (const e of audit.slice().reverse()) {
				const row = append(body, $('div.ldr-audit'));
				const verb = e.action === 'rejected' ? 'rejected' : e.action === 'approved' ? 'approved' : 'auto-applied';
				row.textContent = `${verb} - ${e.blockId} - via ${e.via} - ${e.time.slice(11, 19)}`;
			}
		}
	}

	private _injectStyles(container: HTMLElement): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = document.createElement('style');
		style.textContent = `
		.living-docs-review .ldr-header{display:flex;align-items:center;gap:8px;font:600 14px/1.2 system-ui;color:var(--vscode-foreground);margin-bottom:6px}
		.living-docs-review .ldr-badge{font:600 10px/1 monospace;color:#fff;background:oklch(0.65 0.16 45);border-radius:999px;padding:3px 7px}
		.living-docs-review .ldr-status{font:400 11.5px/1.4 system-ui;color:var(--vscode-descriptionForeground);margin-bottom:14px}
		.living-docs-review .ldr-empty{font:400 12px/1.5 system-ui;color:var(--vscode-descriptionForeground);padding:8px 2px}
		.living-docs-review .ldr-card{border:1px solid var(--vscode-widget-border,#3334);border-radius:10px;padding:13px;margin-bottom:12px;background:var(--vscode-editorWidget-background)}
		.living-docs-review .ldr-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
		.living-docs-review .ldr-card-name{font:600 12.5px/1 system-ui;color:var(--vscode-foreground)}
		.living-docs-review .ldr-tag{font:600 9px/1 monospace;color:#b4332f;background:#fdecec;border-radius:999px;padding:4px 7px}
		.living-docs-review .ldr-diff{border:1px solid var(--vscode-widget-border,#3334);border-radius:7px;overflow:hidden;margin-bottom:10px}
		.living-docs-review .ldr-o{background:#fdecec;color:#7a3a38;text-decoration:line-through;padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-review .ldr-n{background:#e7f6ec;color:#1f5a36;padding:8px 10px;font:400 12.5px/1.45 system-ui}
		.living-docs-review .ldr-why{display:flex;gap:6px;font:400 11.5px/1.5 system-ui;color:var(--vscode-descriptionForeground);background:var(--vscode-textBlockQuote-background,#0001);border-radius:7px;padding:8px 10px;margin-bottom:10px}
		.living-docs-review .ldr-meta{display:flex;flex-wrap:wrap;gap:12px;font:600 10px/1.4 monospace;color:var(--vscode-descriptionForeground);margin-bottom:12px}
		.living-docs-review .ldr-actions{display:flex;gap:8px}
		.living-docs-review .ldr-approve{flex:1;border:none;border-radius:8px;padding:9px;background:oklch(0.55 0.13 255);color:#fff;font:600 12px/1 system-ui;cursor:pointer}
		.living-docs-review .ldr-reject{border:1px solid var(--vscode-widget-border,#3335);border-radius:8px;padding:9px 14px;background:transparent;color:var(--vscode-foreground);font:500 12px/1 system-ui;cursor:pointer}
		.living-docs-review .ldr-audit-title{font:600 9.5px/1 monospace;letter-spacing:.08em;color:var(--vscode-descriptionForeground);margin:18px 0 8px}
		.living-docs-review .ldr-audit{font:400 10.5px/1.6 monospace;color:var(--vscode-descriptionForeground)}
		`;
		container.appendChild(style);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._body) {
			this._body.style.height = `${height}px`;
		}
	}
}
