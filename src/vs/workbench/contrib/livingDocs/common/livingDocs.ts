/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { AddedContextKind, IAddedContext, IAgentDef, IAgentRun, IAuditEntry, IFreshness, ILivingDoc, ILivingDocLock, IProposedChange, SourceKind } from './livingDocsModel.js';

export const ILivingDocsService = createDecorator<ILivingDocsService>('livingDocsService');

export const REVIEW_RAIL_VIEW_ID = 'workbench.view.livingDocs.review';
export const REVIEW_RAIL_CONTAINER_ID = 'workbench.viewContainer.livingDocs';

export const DOCUMENTS_VIEW_ID = 'workbench.view.livingDocs.documents';
export const DOCUMENTS_CONTAINER_ID = 'workbench.viewContainer.livingDocs.documents';

export const CONTEXT_VIEW_ID = 'workbench.view.livingDocs.context';
export const CONTEXT_CONTAINER_ID = 'workbench.viewContainer.livingDocs.context';

/** The tabs of the Studio right panel. */
export type LivingDocsPanelTab = 'chat' | 'review' | 'history';

/**
 * A lightweight summary of one document for the "Documents" home list. Built by parsing each
 * discovered file without loading its source, so the home can render before any document is opened.
 */
export interface ILivingDocSummary {
	readonly resource: URI;
	readonly title: string;
	readonly isLiving: boolean;
	/** The distinct source kinds (file | api | mcp) the document binds to, for the row chips. */
	readonly sourceKinds: readonly SourceKind[];
	/** Human label for when the document was last synced, e.g. "Week 24" (empty for plain Markdown). */
	readonly lastSynced: string;
	/** Pending meaning-changes for this document (mirrors the Review rail count). */
	readonly pendingCount: number;
}

/**
 * One document Skill's verdict for the Skills rail (spec 5, maker != checker). Financial and
 * Formatting are deterministic and run with no model; Strategy needs a model to test claims against
 * the Knowledge decision stack, so it reports `needs-model` in the model-less build.
 */
export interface ISkillCheck {
	readonly id: 'financial' | 'strategy' | 'formatting';
	readonly name: string;
	readonly blurb: string;
	readonly status: 'pass' | 'flag' | 'needs-model' | 'ready';
	/** Human summary, e.g. "All 6 linked figures reconcile with sources." */
	readonly detail: string;
	/** True when the check can be (re-)run: deterministic locally, or model-backed via the proxy. */
	readonly canRun: boolean;
	/** True when a flagged check has a deterministic one-tap fix that edits the document (e.g. Formatting heading-case). */
	readonly fixable?: boolean;
}

/**
 * One bound figure that moved in a sync: its bind key and the old -> new resolved values. Powers the
 * editor's "Sync across" diff banner (source-peek: edit a source, sync, see which figures changed).
 */
export interface IFigureChange {
	readonly key: string;
	readonly old: string;
	readonly next: string;
}

/**
 * One step the Chat agent took while answering, rendered as a tool-call row in the conversation
 * (e.g. "Read metrics.csv", "Proposed: Commentary rewrite"). `done` steps already happened
 * (a read/analysis); `queued` steps produced a pending change waiting in the Review rail.
 */
export interface IChatStep {
	readonly label: string;
	readonly status: 'done' | 'queued';
}

/**
 * One turn in a document's Chat conversation. User turns carry the parsed `@mention` file names;
 * assistant turns carry the model reply, the tool-call `steps`, and whether the reply was a real
 * model answer or the honest no-model fallback.
 */
export interface IChatMessage {
	readonly role: 'user' | 'assistant';
	readonly content: string;
	readonly mentions?: readonly string[];
	readonly steps?: readonly IChatStep[];
	readonly via?: 'model' | 'fallback';
}

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

	/** Fires when something asks the right panel to focus a tab (e.g. "Ask AI" -> Chat). */
	readonly onDidRequestPanel: Event<LivingDocsPanelTab>;

	/** Reveal the right panel and switch it to the given tab. */
	focusPanel(tab: LivingDocsPanelTab): void;

	// --- per-document views (the editor renders one document by its resource) ---
	getDoc(resource: URI): ILivingDoc | undefined;
	/** The verbatim Markdown source of a document (for the Raw Markdown view). */
	getRawText(resource: URI): string;
	/** The resolved value of each bind key for a document (mirrors the lock's resolved values). */
	getResolved(resource: URI): ReadonlyMap<string, string>;
	/** The document's lock (dependency graph + provenance ledger), if loaded. */
	getLock(resource: URI): ILivingDocLock | undefined;
	/** The cheap always-on staleness signal: which bindings/context changed since last sync/review. */
	getFreshness(resource: URI): IFreshness;
	/** Run the document's Skills as graders over its current state (for the Skills rail). */
	getSkillReport(resource: URI): readonly ISkillCheck[];
	/** Run a single Skill on demand (e.g. the model-backed Strategy grader); caches the verdict. */
	runSkillCheck(resource: URI, id: ISkillCheck['id']): Promise<void>;
	/** Apply a Skill's deterministic fix to the document (e.g. Formatting title-cases the flagged headings). */
	applySkillFix(resource: URI, id: ISkillCheck['id']): Promise<void>;
	/** Re-hash the document's sources and recompute its dirty bits (what the source watcher triggers). */
	checkSources(resource: URI): Promise<void>;
	getStatus(resource: URI): string;
	/** Block ids that were auto-applied in the last refresh (for the green "just updated" highlight). */
	getRecentlyApplied(resource: URI): ReadonlySet<string>;
	/** Pending changes that belong to one document (rendered inline in its editor). */
	getPendingForDoc(resource: URI): readonly IProposedChange[];

	// --- workspace-wide views (the review rail aggregates across documents) ---
	getAllPending(): readonly IProposedChange[];
	getAudit(): readonly IAuditEntry[];

	/** Discover and summarize every Living Document in the workspace (for the "Documents" home). */
	listDocuments(): Promise<readonly ILivingDocSummary[]>;

	/** The registered orchestration agents (for the Agents view). */
	getAgents(): readonly IAgentDef[];

	/** Run an agent now over its flow documents (or the whole workspace if it scopes none). */
	runAgent(agentId: string): Promise<IAgentRun | undefined>;

	/** Create a new blank Living Document from a template in the workspace and return its resource. */
	createDocument(): Promise<URI | undefined>;

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

	/**
	 * The expensive, on-demand impact pass (spec 3.6): read the changed context sources against the
	 * document's prose claims and queue candidate edits (with provenance + confidence) into the review
	 * rail. Figures auto-apply; meaning/influence changes wait for approval. A claim whose anchor no
	 * longer confidently matches the prose surfaces a loud "re-link?" prompt instead of re-attaching.
	 */
	reviewImpact(resource: URI): Promise<void>;

	/** Export a document's current state to a self-contained HTML page and open it. */
	exportDocument(resource: URI): Promise<URI | undefined>;

	/**
	 * Export a document's *resolved* state to a clean, static Markdown file (no bindings, no
	 * {cell} placeholders, live values inlined) and open it. The portable share/Obsidian artefact.
	 */
	exportMarkdown(resource: URI): Promise<URI | undefined>;

	/** Share a document. Interim: live links are not built yet, so this surfaces guidance. */
	shareDocument(resource: URI): void;

	/** Publish a document: snapshot (pin) its sources to current versions for reproducibility. */
	publishDocument(resource: URI): Promise<void>;

	// --- Chat agent (the right-panel Chat tab) ---
	/** The conversation so far for a document (empty until the first message). */
	getChatMessages(resource: URI): readonly IChatMessage[];
	/** The files a `@mention` can attach for a document: its linked sources + context files. */
	getMentionableFiles(resource: URI): readonly string[];
	/** True while a chat reply is in flight for a document (renders the "working" indicator). */
	isChatBusy(resource: URI): boolean;
	/**
	 * Send one user message to the document's Chat agent. Parses `@mentions`, gathers the document
	 * (with resolved figures) plus the mentioned/context sources, and asks the model for a reply that
	 * may also propose prose edits - those queue into the Review rail like any other pending change.
	 * With no model reachable it appends an honest fallback turn and proposes nothing (never fakes a reply).
	 */
	sendChatMessage(resource: URI, text: string): Promise<void>;

	approve(changeId: string): Promise<void>;
	reject(changeId: string): void;

	/** Reveal the source cells behind a block (provenance) for a given document. */
	revealSource(resource: URI, cells: readonly string[]): Promise<void>;

	// --- source-peek + "Sync across" (the comp's signature editing interaction) ---
	/** Open the document's primary file source (e.g. its CSV) beside it, so it can be peeked and edited. */
	openSourceBeside(resource: URI): Promise<void>;
	/** Re-derive this document's bound figures from its current sources, apply them, and return the old -> new diff. */
	syncFromSources(resource: URI): Promise<readonly IFigureChange[]>;
	/** The figure diff from the last syncFromSources for a document (for the editor's "synced" banner). */
	getLastSyncDiff(resource: URI): readonly IFigureChange[];

	// --- typed context (the Context panel's Pasted text / Images / Company knowledge groups) ---
	/** The context the user added by hand (pasted text / images / company knowledge), persisted in the lock. */
	getAddedContext(resource: URI): readonly IAddedContext[];
	/** Add a typed context item to a document (from the Context panel's "Add context") and persist it. */
	addContext(resource: URI, kind: AddedContextKind, text: string): Promise<void>;
}
