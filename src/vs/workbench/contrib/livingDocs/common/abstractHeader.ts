/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IAbstractHeaderService = createDecorator<IAbstractHeaderService>('abstractHeaderService');

/**
 * The kind of pill shown on the right of the 48px header (plan 43 the-48px-header block).
 *   - `sync` reads as the calm "All sources synced" state (green ok pill).
 *   - `agent-health` reads as the Agents surface's health pill (e.g. "1 agent active").
 * The pill is omitted entirely when `kind` is `none` (a fresh folder has no sources to be "synced":
 * source vocabulary is only truthful once the project has a living surface - plan 42 L3 copy audit).
 */
export const enum HeaderPillKind {
	None = 'none',
	Sync = 'sync',
	AgentHealth = 'agent-health',
}

/** The right-side pill descriptor (plan 43 header). Absent when `kind` is `none`. */
export interface IHeaderPill {
	readonly kind: HeaderPillKind;
	/** The pill label, already localised by the producing surface. */
	readonly label: string;
}

/**
 * The right-side surface action button (plan 43 header): "Open Folder" on Home, "New Template" on
 * Templates, "Add Source" on Knowledge, "Present" on the editor (each with the mock's leading glyph).
 * Absent when the surface has no primary action. Clicking it invokes `run`.
 */
export interface IHeaderAction {
	/** The button label, already localised by the producing surface (glyph included, e.g. "Open Folder"). */
	readonly label: string;
	/** Invoked when the button is clicked. */
	readonly run: () => void;
}

/**
 * The per-surface header content (plan 43 section 3.3). Each surface publishes its own state; the header view
 * reads the latest and re-renders. Every field is optional so a surface only states what it carries.
 */
export interface IAbstractHeaderContent {
	/**
	 * The breadcrumb tail after the workspace name + "/": the current surface or document name (e.g.
	 * "Home", "Weekly Summary"). Empty string renders just the workspace name with no separator.
	 */
	readonly breadcrumb: string;
	/** An optional monospace file-name suffix after the breadcrumb (e.g. "weekly-summary.md"). */
	readonly fileName?: string;
	/** The right-side pill; omit or use `HeaderPillKind.None` for no pill. */
	readonly pill?: IHeaderPill;
	/** The right-side surface action button; omit for no action. */
	readonly action?: IHeaderAction;
	/**
	 * Whether the two rail-toggle buttons are shown. The Editor surface shows both toggles (it has a tree
	 * rail and a right rail); the screen surfaces (Home / Templates / Knowledge / Agents) show neither,
	 * since no rails render on them (plan 43 section 3.3).
	 */
	readonly showRailToggles: boolean;
}

/**
 * The header content service (plan 43 section 3.3, owned by plan 44). The 48px header is one full-width surface
 * (the titlebar part repurposed, decision 170) with a small per-surface content API. Surfaces call
 * `setContent` when they become active or their state changes; the header view subscribes to `onDidChange`
 * and reads `content`. This decouples the single header from the many surfaces that feed it, so later loops
 * (45-49) can push their own state without the header knowing about each surface.
 */
export interface IAbstractHeaderService {
	readonly _serviceBrand: undefined;

	/** Fires whenever the published header content changes. */
	readonly onDidChange: Event<void>;

	/** The current header content. */
	readonly content: IAbstractHeaderContent;

	/** Publish the header content for the now-active surface. */
	setContent(content: IAbstractHeaderContent): void;
}

/** The neutral default the header shows before any surface has published (no doc open yet). */
export const EMPTY_HEADER_CONTENT: IAbstractHeaderContent = {
	breadcrumb: '',
	showRailToggles: false,
};
