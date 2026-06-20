/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuditEntry, IKpiRow, ILivingDoc, IProposedChange } from './livingDocsModel.js';

export const ILivingDocsService = createDecorator<ILivingDocsService>('livingDocsService');

export const REVIEW_RAIL_VIEW_ID = 'workbench.view.livingDocs.review';
export const REVIEW_RAIL_CONTAINER_ID = 'workbench.viewContainer.livingDocs';

/**
 * Holds the active Living Document and drives the core loop:
 *   source change -> agent proposes edits -> figures auto-apply, meaning-changes queue ->
 *   approve/reject -> audit trail.
 *
 * Shared between the document editor (renders the doc + pending diffs) and the review rail
 * (renders pending changes + approve/reject).
 */
export interface ILivingDocsService {
	readonly _serviceBrand: undefined;

	/** Fires whenever the doc, pending changes, audit, or status change. */
	readonly onDidChange: Event<void>;

	getDoc(): ILivingDoc | undefined;
	getPending(): readonly IProposedChange[];
	getAudit(): readonly IAuditEntry[];
	getKpiRows(): readonly IKpiRow[];
	getStatus(): string;
	/** Block ids that were auto-applied in the last refresh (for the green "just updated" highlight). */
	getRecentlyApplied(): ReadonlySet<string>;

	/** Load a .ldoc and open its bound source beside it. */
	loadDocument(resource: URI): Promise<void>;

	/** Re-derive bound blocks from the latest source values. */
	refreshFromSources(): Promise<void>;

	approve(changeId: string): Promise<void>;
	reject(changeId: string): void;

	/** Reveal the source cells behind a block (provenance). */
	revealSource(cells: readonly string[]): Promise<void>;
}
