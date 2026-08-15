/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { FONT, HAIRLINE, INDIGO, INK, PAPER, TRACKING, TYPE } from '../common/abstractTokens.js';
import { ISourceGrid } from '../common/sourceGrid.js';
import { ILivingDocsService, ISourceViewerData } from '../common/livingDocs.js';
import { AbstractTabStrip, createTabStripStyle } from './abstractTabStrip.js';
import { LivingDocSourceInput } from './livingDocSourceInput.js';

/**
 * The source-viewer editor pane (spec 43 section 3.2, plan 45 pin 7 / P7.4). Opening a source from the tree
 * SOURCES rows (or, plan 49, the Knowledge table) opens a `LivingDocSourceInput` here as a product tab on the
 * SAME strip as the document - a grid-glyph source tab showing the source grid. It renders the shared product-tab strip
 * in the pane host (so the strip is continuous whether the active tab is a document or a source) plus the
 * source's CSV grid (the same grid the bottom drawer shows). It is a distinct pane from LivingDocEditor purely
 * so a source and a document can each own their editor input in the same group; the strip below is shared.
 */
export class LivingDocSourceEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDocSource';

	private _container: HTMLElement | undefined;
	private _tabStrip: AbstractTabStrip | undefined;
	private _viewerHost: HTMLElement | undefined;
	private _resource: URI | undefined;
	private readonly _inputDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IEditorService private readonly _editorService: IEditorService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
	) {
		super(LivingDocSourceEditor.ID, group, telemetryService, themeService, _storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = $('.living-doc-source-editor');
		this._container.style.height = '100%';
		this._container.style.width = '100%';
		// The shared product-tab strip sits in the pane host DOM, above the source viewer (mirrors the document
		// editor's layout so the strip reads as one continuous row across a document<->source tab switch).
		this._tabStrip = this._register(new AbstractTabStrip(this.group, this._livingDocs, this._storageService, this._contextMenuService, this._editorService, this._dialogService, this._quickInputService));
		this._container.appendChild(this._tabStrip.element);
		this._viewerHost = append(this._container, $('.lwd-source-viewer'));
		parent.appendChild(this._container);
		parent.appendChild(createTabStripStyle());
		parent.appendChild(SOURCE_VIEWER_STYLE.cloneNode(true));
	}

	override async setInput(input: LivingDocSourceInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._resource = input.resource;
		this._inputDisposables.clear();
		// The tab strip mirrors the group live via its own listeners; re-render once here so opening this source
		// paints the strip with the source tab active immediately.
		this._tabStrip?.render();
		const data = await this._livingDocs.readSourceViewer(input.resource);
		if (token.isCancellationRequested || this._resource?.toString() !== input.resource.toString()) { return; }
		this._renderViewer(data, input.resource);
	}

	private _renderViewer(data: ISourceViewerData | undefined, resource: URI): void {
		const host = this._viewerHost;
		if (!host) { return; }
		clearNode(host);
		const name = data?.name ?? basename(resource);
		const head = append(host, $('.lwd-source-head'));
		const glyph = append(head, $('span.lwd-source-glyph'));
		// allow-any-unicode-next-line
		glyph.textContent = '⊞';
		glyph.setAttribute('aria-hidden', 'true');
		append(head, $('span.lwd-source-name')).textContent = name;
		if (!data) {
			append(host, $('.lwd-source-empty')).textContent = localize('livingDocs.source.unreadable', "This source could not be read. It may have been moved or renamed.");
			return;
		}
		if (data.grid) {
			this._renderGrid(host, data.grid);
		} else {
			append(host, $('pre.lwd-source-text')).textContent = data.text;
		}
	}

	/** Render the CSV grid with the latest (bound) row highlighted - the same grid the bottom drawer shows. */
	private _renderGrid(host: HTMLElement, grid: ISourceGrid): void {
		const meta = append(host, $('.lwd-source-meta'));
		meta.textContent = localize('livingDocs.source.latestRow', "latest row applies");
		const table = append(host, $('table.lwd-source-grid'));
		const thead = append(table, $('thead'));
		const hr = append(thead, $('tr'));
		for (const h of grid.headers) {
			append(hr, $('th')).textContent = h;
		}
		const tbody = append(table, $('tbody'));
		grid.rows.forEach((row, i) => {
			const tr = append(tbody, $(i === grid.latestIndex ? 'tr.sel' : 'tr'));
			for (const cell of row) {
				append(tr, $('td')).textContent = cell;
			}
		});
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}

// The source-viewer styles, mounted once per pane (cloned) so the native grid reads with the drawer's grid
// typography (mono numbers, hairline dividers, the accent-tinted latest row).
const SOURCE_VIEWER_STYLE = (() => {
	const style = document.createElement('style');
	style.textContent = `
.living-doc-source-editor{display:flex;flex-direction:column;background:${PAPER.card}}
.lwd-source-viewer{flex:1;min-height:0;overflow:auto;padding:20px 28px}
.lwd-source-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.lwd-source-glyph{font:400 14px/1 ${FONT.mono};color:${INDIGO.base}}
.lwd-source-name{font:${TYPE.uiBodyStrong};color:${INK.heading}}
/* "latest row applies" is a section label, so it takes the ladder's mono 11 / .14em step. */
.lwd-source-meta{font:${TYPE.sectionLabel};letter-spacing:${TRACKING.sectionLabel};text-transform:uppercase;color:${INK.meta};margin:0 0 10px}
.lwd-source-empty{font:${TYPE.uiBody};color:${INK.secondary};margin-top:14px}
/* The grid and the raw-text dump are provenance facts (cells, file contents), so they are mono at the ladder's
provenance step - never the sans UI body. */
.lwd-source-text{font:400 12px/1.6 ${FONT.mono};color:${INK.bodySoft};white-space:pre-wrap;margin:8px 0 0}
table.lwd-source-grid{border-collapse:collapse;font:${TYPE.provenance};color:${INK.body}}
table.lwd-source-grid th{text-align:left;font-weight:600;color:${INK.secondary};padding:7px 14px;border-bottom:1px solid ${HAIRLINE.strong};white-space:nowrap}
table.lwd-source-grid td{padding:7px 14px;border-bottom:1px solid ${HAIRLINE.soft};white-space:nowrap}
/* The bound row is a SELECTED row, which is the one job the flat indigo tint has outside a diff span. */
table.lwd-source-grid tr.sel td{background:${INDIGO.tint};color:${INK.heading}}
`;
	return style;
})();
