/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { HeaderPillKind, IAbstractHeaderService } from '../common/abstractHeader.js';
import { ILivingDocsService } from '../common/livingDocs.js';

/** The two stock part-toggle commands the rail buttons invoke (43 section 3.5 / plan 44 P2.2). */
const TOGGLE_TREE_RAIL_COMMAND = 'workbench.action.toggleSidebarVisibility';
const TOGGLE_RIGHT_RAIL_COMMAND = 'workbench.action.toggleAuxiliaryBar';

/**
 * A panel glyph with one half filled to indicate which side the toggle collapses (plan 44 P2.1). The
 * mock draws these as inline SVGs; we mirror them exactly so the header reads identically. `side` picks
 * the filled bar's edge - `left` fills the near bar (tree rail), `right` fills the far bar (right rail).
 */
function railGlyph(side: 'left' | 'right'): SVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('fill', 'none');
	const frame = document.createElementNS(ns, 'rect');
	frame.setAttribute('x', '1.5');
	frame.setAttribute('y', '2.5');
	frame.setAttribute('width', '13');
	frame.setAttribute('height', '11');
	frame.setAttribute('rx', '2');
	frame.setAttribute('stroke', 'currentColor');
	svg.appendChild(frame);
	const bar = document.createElementNS(ns, 'rect');
	bar.setAttribute('x', side === 'left' ? '3' : '9.5');
	bar.setAttribute('y', '4');
	bar.setAttribute('width', '3.5');
	bar.setAttribute('height', '8');
	bar.setAttribute('rx', '1');
	bar.setAttribute('fill', 'currentColor');
	svg.appendChild(bar);
	return svg;
}

/**
 * The 48px Abstract header (plan 44 pins 1/2 + the header block; decision 170: the titlebar part is
 * repurposed, not a new part). This contribution renders the header DOM into the titlebar part's
 * container - an ADDITIVE contribution that only reaches the part container via
 * IWorkbenchLayoutService.getContainer (the same route as ActiveNavChipContribution), so it takes no core
 * patch beyond the one sanctioned titlebar-height seam (V2-2). The stock titlebar content (command
 * centre, action toolbars, window title) is hidden by studio.css `.abstract-header` rules; our overlay
 * paints the header on top.
 *
 * Layout, left -> right, exactly mirroring the mock:
 *   [left rail toggle] [logo "A"] [workspace] / [breadcrumb] (file)  ...  [pill] [action] [avatar] [right rail toggle]
 *
 * The breadcrumb / pill / action come from IAbstractHeaderService (each surface publishes its own via
 * setContent). The rail toggles are only shown when the active surface has rails (the editor); the badge
 * dot on the right toggle rides pending proposals (P2.5, replacing the old force-open).
 */
export class AbstractHeaderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livingDocs.abstractHeader';

	// The header root and the pieces we re-render on content / pending change, held so a re-render
	// replaces rather than accumulates. The whole header is torn down + rebuilt only if the titlebar
	// container is (re)created; content changes only refresh the dynamic regions.
	private readonly _headerStore = this._register(new MutableDisposable<DisposableStore>());
	private _header: HTMLElement | undefined;
	private _workspaceEl: HTMLElement | undefined;
	private _breadcrumbTail: HTMLElement | undefined;
	private _fileName: HTMLElement | undefined;
	private _pill: HTMLElement | undefined;
	private _action: HTMLElement | undefined;
	private _actionStore = this._register(new MutableDisposable<DisposableStore>());
	private _leftToggle: HTMLElement | undefined;
	private _rightToggle: HTMLElement | undefined;
	private _rightBadge: HTMLElement | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IAbstractHeaderService private readonly _headerService: IAbstractHeaderService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@ICommandService private readonly _commandService: ICommandService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this._build();
		// The titlebar part is created before AfterRestored, so the container exists by now; still guard
		// and rebuild on part-visibility flips (a settings change could hide/show the titlebar) so the
		// header re-attaches to a freshly created container.
		this._register(this._layoutService.onDidChangePartVisibility(e => {
			if (e.partId === Parts.TITLEBAR_PART) {
				this._build();
			}
		}));
		this._register(this._headerService.onDidChange(() => this._renderContent()));
		// The right toggle's amber badge tracks the workspace pending set (P2.5): any change to the pending
		// or resolved set updates whether the dot shows while the right rail is collapsed.
		this._register(this._livingDocs.onDidChange(() => this._updateBadge()));
		this._register(this._layoutService.onDidChangePartVisibility(e => {
			if (e.partId === Parts.AUXILIARYBAR_PART) {
				this._updateBadge();
			}
		}));
	}

	private _build(): void {
		const container = this._layoutService.getContainer(mainWindow, Parts.TITLEBAR_PART);
		if (!container) {
			this._headerStore.clear();
			this._header = undefined;
			return;
		}
		if (this._header?.isConnected) {
			return;
		}
		const store = new DisposableStore();

		const header = append(container, $('.abstract-header'));
		store.add({ dispose: () => header.remove() });

		// --- left rail toggle (far left) ---
		const leftToggle = append(header, $('button.abstract-header-toggle.left', { 'aria-label': localize("livingDocs.header.toggleTreeRail", "Collapse Tree Rail") }));
		leftToggle.appendChild(railGlyph('left'));
		// allow-any-unicode-next-line
		store.add(this._hoverService.setupDelayedHover(leftToggle, () => ({ content: localize("livingDocs.header.toggleTreeRailHint", "Collapse Tree Rail (⌘\\)") })));
		store.add(addDisposableListener(leftToggle, 'click', () => this._commandService.executeCommand(TOGGLE_TREE_RAIL_COMMAND)));
		this._leftToggle = leftToggle;

		// --- brand cluster: logo + workspace + / + breadcrumb + file ---
		const brand = append(header, $('.abstract-header-brand'));
		const logo = append(brand, $('.abstract-header-logo'));
		logo.textContent = 'A';
		this._workspaceEl = append(brand, $('.abstract-header-workspace'));
		this._workspaceEl.textContent = this._workspaceName();
		const sep = append(brand, $('.abstract-header-sep'));
		sep.textContent = '/';
		this._breadcrumbTail = append(brand, $('.abstract-header-crumb'));
		this._fileName = append(brand, $('.abstract-header-file'));

		// --- flex spacer ---
		append(header, $('.abstract-header-spacer'));

		// --- right cluster: pill + action + avatar + right toggle ---
		this._pill = append(header, $('.abstract-header-pill'));
		this._action = append(header, $('.abstract-header-action'));
		const avatar = append(header, $('.abstract-header-avatar'));
		avatar.textContent = 'TS';

		const rightToggle = append(header, $('button.abstract-header-toggle.right', { 'aria-label': localize("livingDocs.header.toggleRightRail", "Collapse Right Rail") }));
		rightToggle.appendChild(railGlyph('right'));
		this._rightBadge = append(rightToggle, $('.abstract-header-badge'));
		// allow-any-unicode-next-line
		store.add(this._hoverService.setupDelayedHover(rightToggle, () => ({ content: localize("livingDocs.header.toggleRightRailHint", "Collapse Right Rail (⌘⇧\\)") })));
		store.add(addDisposableListener(rightToggle, 'click', () => this._commandService.executeCommand(TOGGLE_RIGHT_RAIL_COMMAND)));
		this._rightToggle = rightToggle;

		this._header = header;
		this._headerStore.value = store;
		this._renderContent();
		this._updateBadge();
	}

	private _workspaceName(): string {
		// The workspace/project display name, truthful (falls back to the folder name; never fabricated).
		return this._livingDocs.getProjectDisplayName() ?? 'Abstract';
	}

	private _renderContent(): void {
		if (!this._header) {
			return;
		}
		const content = this._headerService.content;

		// Workspace name can change if the project marker resolves later; keep it current.
		if (this._workspaceEl) {
			this._workspaceEl.textContent = this._workspaceName();
		}

		if (this._breadcrumbTail) {
			this._breadcrumbTail.textContent = content.breadcrumb;
		}
		if (this._fileName) {
			this._fileName.textContent = content.fileName ?? '';
			this._fileName.style.display = content.fileName ? '' : 'none';
		}

		// Pill: sync (ok) / agent-health (ok) / none. Both truthful pills share the ok treatment; the
		// producing surface decides whether to show one at all (a fresh folder omits the sync pill).
		if (this._pill) {
			const kind = content.pill?.kind ?? HeaderPillKind.None;
			if (kind === HeaderPillKind.None || !content.pill) {
				this._pill.style.display = 'none';
				clearNode(this._pill);
			} else {
				this._pill.style.display = '';
				clearNode(this._pill);
				append(this._pill, $('.abstract-header-pill-dot'));
				const label = append(this._pill, $('span'));
				label.textContent = content.pill.label;
			}
		}

		// Action button: label + click handler, or hidden when the surface has no primary action.
		if (this._action) {
			this._actionStore.clear();
			if (!content.action) {
				this._action.style.display = 'none';
				this._action.textContent = '';
			} else {
				this._action.style.display = '';
				this._action.textContent = content.action.label;
				const store = new DisposableStore();
				const run = content.action.run;
				store.add(addDisposableListener(this._action, 'click', () => run()));
				this._actionStore.value = store;
			}
		}

		// Rail toggles are shown only on a surface that has rails (the editor); screens hide them.
		const showToggles = content.showRailToggles;
		if (this._leftToggle) {
			this._leftToggle.style.display = showToggles ? '' : 'none';
		}
		if (this._rightToggle) {
			this._rightToggle.style.display = showToggles ? '' : 'none';
		}
	}

	// (P2.5) With the right rail collapsed and >=1 pending proposal, an 8px amber dot rides the right
	// toggle; it clears when the rail opens. This replaces the old trust-grammar force-open of the rail:
	// the pending proposal is surfaced quietly on the toggle instead of yanking the rail open.
	private _updateBadge(): void {
		if (!this._rightBadge) {
			return;
		}
		const rightRailVisible = this._layoutService.isVisible(Parts.AUXILIARYBAR_PART, mainWindow);
		const hasPending = this._livingDocs.getAllPending().length > 0;
		const showTogglesOnSurface = this._headerService.content.showRailToggles;
		this._rightBadge.style.display = (!rightRailVisible && hasPending && showTogglesOnSurface) ? '' : 'none';
	}
}
