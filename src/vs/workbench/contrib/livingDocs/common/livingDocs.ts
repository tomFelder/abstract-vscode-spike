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
 * Holds every loaded Living Document and drives the core loop:
 *   source change -> agent proposes edits -> figures auto-apply, meaning-changes queue ->
 *   approve/reject -> audit trail.
 *
 * Documents are addressed by their resource so several can be open at once. A single source
 * change fans out across all bound documents in the workspace. Shared between the document
 * editor (renders one document + its pending diffs) and the review rail (aggregates pending
 * changes across every document).
 */
export interface ILivingDocsService {
	readonly _serviceBrand: undefined;

	/** Fires whenever any document, the pending set, the audit, or a status changes. */
	readonly onDidChange: Event<void>;

	// --- per-document views (the editor renders one document by its resource) ---
	getDoc(resource: URI): ILivingDoc | undefined;
	/** The verbatim Markdown source of a document (for the Raw Markdown view). */
	getRawText(resource: URI): string;
	getKpiRows(resource: URI): readonly IKpiRow[];
	getStatus(resource: URI): string;
	/** Block ids that were auto-applied in the last refresh (for the green "just updated" highlight). */
	getRecentlyApplied(resource: URI): ReadonlySet<string>;
	/** Pending changes that belong to one document (rendered inline in its editor). */
	getPendingForDoc(resource: URI): readonly IProposedChange[];

	// --- workspace-wide views (the review rail aggregates across documents) ---
	getAllPending(): readonly IProposedChange[];
	getAudit(): readonly IAuditEntry[];

	/** Load a document; for a Living Document its bound source is read alongside. */
	loadDocument(resource: URI): Promise<void>;

	/** Persist edited raw Markdown verbatim and reparse the document. */
	saveRawText(resource: URI, text: string): Promise<void>;

	/**
	 * Edit a non-bound prose block in place (WYSIWYG) and persist it. Bound blocks are
	 * driven by their source and cannot be hand-edited; this is a no-op for them.
	 */
	editBlock(resource: URI, blockId: string, text: string): Promise<void>;

	/** Re-derive bound blocks across every bound document from the latest source values. */
	refreshFromSources(): Promise<void>;

	approve(changeId: string): Promise<void>;
	reject(changeId: string): void;

	/** Reveal the source cells behind a block (provenance) for a given document. */
	revealSource(resource: URI, cells: readonly string[]): Promise<void>;
}
