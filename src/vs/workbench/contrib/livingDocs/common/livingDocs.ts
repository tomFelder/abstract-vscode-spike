/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFanoutFailedDoc } from './fanoutOutcome.js';
import { AddedContextKind, AgentPolicy, IAddedContext, IAgentDef, IAgentRun, IAgentTrigger, IAuditEntry, IFreshness, ILivingDoc, ILivingDocLock, IProposedChange, ISkillRunSummary, ISnapshotEntry, SnapshotVia, SourceKind } from './livingDocsModel.js';
import { ILedgerInputs } from './livingDocLedger.js';
import { DocAutonomyLevel } from './docPolicy.js';
import { ISourceGrid } from './sourceGrid.js';
import { ITemplateSkeletonRow } from './livingDocMarkdown.js';
import { IFeedbackReport, OnboardingStep } from './onboarding.js';

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
 * A request to reveal the right panel on a given tab, optionally carrying a payload the target tab
 * consumes once it is mounted (e.g. a Review deep link that scrolls to a specific block). The payload
 * is deliberately generic so new deep links can ride the same replay mechanism without a new event.
 *
 * A request is both fired synchronously (for the already-mounted rail) AND recorded as the service's
 * pending request, so a request made before the rail mounts survives the mount: the rail consumes and
 * clears it on subscribe. See `focusPanel` / `consumePendingPanel`.
 */
export interface ILivingDocsPanelRequest {
	readonly tab: LivingDocsPanelTab;
	/** Optional deep-link payload the tab consumes on reveal (e.g. `{ blockId }` for a Review block). */
	readonly payload?: { readonly blockId?: string };
}

/**
 * Which model door is serving the user's calls (plan 35 iter 4). `chatgpt` is the user's own ChatGPT
 * subscription via the OpenAI OAuth backend (not metered); `included` is the founder-funded OpenRouter
 * fallback (metered to a small daily budget); `none` is the built-in heuristic path when no backend is wired.
 */
export type ModelProvider = 'chatgpt' | 'included' | 'none';

/**
 * The truthful state of the model broker, keyed off /healthz (issues #169/#170). `broker-down` = the broker
 * did not answer at all (it is not running / not yet up); `unconfigured` = the broker is up but no backend
 * credential is wired, so the app is on its built-in heuristic path; `budget-paused` = the metered included
 * tier has spent today's fair-usage cap and calls pause; `ready` = a configured backend can serve now. These
 * drive honest, state-specific UI copy so no surface ever claims a model is connected when it is not.
 */
export type ModelReadiness = 'broker-down' | 'unconfigured' | 'budget-paused' | 'ready';

/**
 * The single honest fallback line shown when the model cannot answer (issue #170). The app supervises the
 * broker itself now, so the user is never asked to run a shell script; when the model is genuinely unavailable
 * (broker still starting, or no backend wired) the app can still read the document and its sources, and the
 * Model access screen is where the user fixes it. Kept in one place so every surface speaks the same words.
 */
export const MODEL_UNAVAILABLE_MESSAGE = 'The model is not available right now. Open Model access to connect a model; meanwhile I can still read this document and its sources.';

/**
 * The model provider + usage snapshot the Settings provider step renders (plan 35 iter 4). Read from the
 * broker's /healthz: the active backend, whether the user is signed in to ChatGPT, and - only for the metered
 * `included` tier - today's spend against the daily budget. A subscription (`chatgpt`) tier is the user's own
 * plan, so it carries no daily figure. All real data; never fabricated.
 */
export interface IModelProviderStatus {
	/** The door currently serving calls (see ModelProvider). */
	readonly provider: ModelProvider;
	/** The truthful broker state driving state-specific UI copy (see ModelReadiness). */
	readonly readiness: ModelReadiness;
	/** True when a ChatGPT subscription is signed in (whichever backend is active). */
	readonly signedIn: boolean;
	/** The per-user daily budget in US dollars (the `included` tier's fair-usage cap). */
	readonly dailyBudgetUsd: number;
	/** Today's spend on the metered `included` tier in US dollars; undefined for the subscription tier. */
	readonly dailyTotalUsd?: number;
}

/**
 * The tier a model belongs to for the composer picker's popover grouping (issue #236, plan 47 pin 14):
 * `included` = the founder-funded fallback the user did not pay for; `own-key` = a model the user's own
 * subscription drives. Read from the broker's /models `tier` field, which is additive - an absent tier
 * (an older broker) coerces to `included` so the popover still groups sensibly.
 */
export type ModelTier = 'included' | 'own-key';

/**
 * One model the active backend can drive, for the composer's model picker (issue #179). `id` is the upstream
 * model id the broker sends; `label` is the product-facing name shown in the dropdown (e.g. "Included model",
 * or the ChatGPT tiers "Sol"/"Terra"/"Luna"); `isDefault` marks the backend's fallback, the one a request
 * lands on when it carries no (or a stale) selection; `tier` groups the popover (see ModelTier). Read from
 * the broker's /models endpoint.
 */
export interface IModelOption {
	readonly id: string;
	readonly label: string;
	readonly isDefault: boolean;
	readonly tier: ModelTier;
}

/**
 * The model catalogue for the current backend (issue #179): which backend it is (so the renderer can key its
 * per-backend persisted selection), and the models that backend offers. A single included model for the
 * openrouter tier; the subscription's models for openai-oauth. Empty models means the picker renders nothing.
 */
export interface IModelCatalogue {
	readonly backend: string;
	readonly models: readonly IModelOption[];
}

/**
 * A chat send that hit an unconfigured backend and is held until the user picks a model door (plan 42 slice L2,
 * issue #198). The typed prompt is preserved and replayed against `resource` the moment a door is chosen - across
 * the ChatGPT sign-in round-trip too. Lives here (not in modelAccessGate.ts) so the interface stays one-directional.
 */
export interface IPendingModelPrompt {
	/** The document the send targeted; the prompt is replayed against this resource. */
	readonly resource: URI;
	/** The instruction to re-send once a door is chosen (the real prompt, not the shown text). */
	readonly text: string;
	/** The shown text for the transcript, when it differs from `text` (a substituted brief). */
	readonly displayText?: string;
}

/** The stage of the "Sign in with ChatGPT" flow the Settings step polls (plan 35 iter 2 + 4). */
export type ChatGptSignInStage = 'signed-out' | 'pending' | 'signed-in' | 'error';

/** The result of a sign-in poll: the current stage and, on failure, a plain-words reason. */
export interface IChatGptSignInStatus {
	readonly stage: ChatGptSignInStage;
	readonly error?: string;
}

/**
 * The onboarding survey captured at the provider step (plan 35 iter 4; doc 18 section 2.4). Free-text, plain
 * words: which frontier model the user's daily driver is, which subscriptions they own, and what they make
 * each week. Stored locally as the `model_configured` analytics event's properties (PostHog wiring is plan
 * 36's job - this only registers the shape and records it to the local event log).
 */
export interface IOnboardingSurvey {
	/** "Which frontier model is your daily driver?" (e.g. "ChatGPT", "Claude", "Gemini"). */
	readonly dailyDriverModel: string;
	/** "Which subscriptions do you own?" (free text, e.g. "ChatGPT Plus, Claude Pro"). */
	readonly ownedSubscriptions: string;
	/** "What do you make each week?" (free text describing their weekly output). */
	readonly weeklyOutput: string;
}

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
	/** The document's binding sources (e.g. "metrics.csv", "crm.api"), for the tree-rail Sources folder. */
	readonly sources: readonly string[];
	/** Human label for when the document was last synced, e.g. "Week 24" (empty for plain Markdown). */
	readonly lastSynced: string;
	/** Pending meaning-changes for this document (mirrors the Review rail count). */
	readonly pendingCount: number;
	/** The document's directory relative to the workspace root ('' = root), '/'-joined; drives the
	 * tree-rail's folder hierarchy so nested subfolders are not flattened (plan 37 F7). */
	readonly folder: string;
	// --- Files-rail status dot inputs (issue #212): the cheap change signals the rail's dot reads. ---
	/** Agent auto-applies newer than this doc's last-viewed anchor; the ACTIVE doc always reports 0 -> green band. */
	readonly unseenAgentEdits: number;
	/** Relink-flagged pending proposals for this document (the claim anchor no longer matches) -> red band. */
	readonly relinkCount: number;
	/** True when a binding/context source has drifted since last sync/review (freshness dirty) -> red band. A
	 * never-loaded document reports false (freshness only computes on load) - a truthful, partial signal (#212). */
	readonly stale: boolean;
	/** True when a whole-project fan-out run failed to reach the model for this document -> red band. */
	readonly fanoutFailed: boolean;
	/**
	 * True when a document born from a template still has no source bound (`fromTemplate && !isLiving`): the
	 * "bind sources" nudge on its tree row (PN.1) invites the user to connect its data. Clears the moment a
	 * source is bound (the document becomes living). Routed cross-lane from 48-c (#233) - Use duplicates a
	 * template with binds emptied to slots, and the new doc's row carries this nudge until a source binds.
	 */
	readonly needsSourceBinding: boolean;
}

/**
 * The outcome of a docx import (issue #129, doc 22 section 2). On success `ok` is true, `resource` is the
 * created `.md` beside the untouched original, and `kept`/`dropped` are the plain-words fidelity phrases the
 * summary card shows. On refusal `ok` is false and `reason` names why (password-protected / legacy / could
 * not be read); the original stays in the tree's "not yet imported" state, never mangled. Real data only.
 */
export interface IImportOutcome {
	readonly ok: boolean;
	readonly resource?: URI;
	readonly reason?: string;
	readonly kept?: readonly string[];
	readonly dropped?: readonly string[];
}

/**
 * One document that depends on a file targeted by a rename/delete (docs 20 section 1d / map-D6): the
 * dependent document's resource and display title, for the delete warning's "these documents depend on
 * it" list. A projection over the folder's frontmatter `sources:`/`context:` - the file's own document
 * is never its own dependent.
 */
export interface IFileOpDependent {
	readonly resource: URI;
	readonly title: string;
}

/**
 * One proposed move in a Tidy plan (doc 22 section 5, the P2 folder conventions). The agent PROPOSES,
 * the human disposes: each item is an individually reviewable move through the review grammar, applied
 * only on approve. `reason` is the plain-words, mechanical justification (a superseded name, a loose data
 * file, an imported original) - "outdated" is always a stated suggestion, never a silent assumption.
 * `dependents` are the documents that reference the moved file; when non-empty the apply re-points their
 * bindings in the same atomic op (the move's "bindings survive" promise), and the UI warns and lists them
 * exactly like a map-D6 delete before proceeding - never blocking.
 */
export interface ITidyPlanItem {
	/** The file's current location on disk. */
	readonly fromResource: URI;
	/** The proposed destination (inside a convention folder, created on demand at apply time). */
	readonly toResource: URI;
	/** The current name for the review row, e.g. "Board Note -old.md". */
	readonly fromLabel: string;
	/** The destination as a project-relative path for the review row, e.g. "archive/Board Note -old.md". */
	readonly toLabel: string;
	/** The plain-words reason this move is proposed (the human decides on this evidence). */
	readonly reason: string;
	/** Documents that reference the moved file; their bindings are re-pointed in the same atomic move. */
	readonly dependents: readonly IFileOpDependent[];
}

/**
 * One document that draws on a source (plan 29, iter 1): the dependent document plus the exact bind keys
 * it resolves from that source (empty for a context/influence-only dependency). Powers the Knowledge
 * screen's per-source detail drawer (the documents + keys behind a source, with jump-to-doc).
 */
export interface ISourceUsage {
	readonly doc: URI;
	/** The dependent document's display title, for the drawer row + jump-to-doc label. */
	readonly title: string;
	/** The bind keys this document resolves from the source (e.g. "metrics.mrr"); empty for context-only use. */
	readonly keys: readonly string[];
	/** True when this document uses the source as influence/context (frontmatter `context:`) rather than a value binding. */
	readonly context: boolean;
}

/**
 * One source in the project's real source registry (plan 29, D29-A): a projection over every project
 * document's declared `sources:`/`context:` and its lock, folded by source identity. Real data only -
 * `syncedAt` and `fresh` come from the lock's recorded hashes/timestamps (undefined `syncedAt` = referenced
 * but never synced, the honest idle state); `usedBy` is the dependency fan-in across the folder.
 */
export interface ISourceInfo {
	/** The source's durable identity as authored in frontmatter (e.g. "metrics.csv" or the API URL). */
	readonly id: string;
	readonly kind: SourceKind;
	/** The display label: the file name for a file source, the host for an api source. */
	readonly label: string;
	/** The most recent lock sync/review time across every dependent document, or undefined when never synced. */
	readonly syncedAt: string | undefined;
	/** True when the current source value still matches every dependent lock's recorded hash (nothing stale). */
	readonly fresh: boolean;
	/**
	 * The source's on-disk resource for a `file` source in the open folder (K2.6: a row click opens it as a
	 * product tab via `openSourceTab`). Undefined for an `api`/`mcp` source or a file with no local counterpart
	 * (there is nothing to open as a tab); the row is then non-navigable.
	 */
	readonly resource?: URI;
	/**
	 * True when the user marked this source's staleness "as expected" (K3.1): a per-workspace acknowledgement
	 * that calms the row to context-grey honestly (the drift is known and accepted), without ever auto-fixing.
	 */
	readonly markedExpected?: boolean;
	/** The documents that depend on this source, each with the bind keys it resolves. */
	readonly usedBy: readonly ISourceUsage[];
}

/**
 * One template discovered in the project (plan 28, D28-A): a `*.template.md` file - ordinary Markdown
 * with `template: true` frontmatter - that seeds new documents. Built by parsing the file without loading
 * its sources, so the Templates screen can render its card (name, description, slot/source counts) before
 * any generation runs. `body` is the template's Markdown body (headings + bind links + `{{slot}}` hints),
 * carried so a generation can compose its skeleton and model brief from the same parsed value.
 */
export interface ITemplateInfo {
	readonly uri: URI;
	/** The template's `name:` frontmatter (falls back to the derived title), the card title. */
	readonly name: string;
	/** The template's `description:` frontmatter, the card subtitle (empty when none was authored). */
	readonly description: string;
	/** The template's declared value sources (frontmatter `sources:`), pre-ticked in the generate sheet. */
	readonly sources: readonly string[];
	/** The template's Markdown body after the frontmatter (headings, bind links, `{{slot}}` hints). */
	readonly body: string;
}

/**
 * A template as the v2 gallery card renders it (plan 48 T2): its `ITemplateInfo` plus the two facts the card
 * needs that are computed from the real folder - the honest usage count (how many documents in the open
 * folder were born from this template, via `template: <name>` provenance) and the parsed skeleton-thumbnail
 * rows (grey prose bars + accent-tint bind-slot chips, derived from the template's own doc so the thumbnail
 * literally shows where live data lands). `bindSlots` is the total data-bound positions ({{slot}} + inline
 * binds). All three are real: `usageCount` counts lineage, never a hardcoded N; a template used by nothing
 * honestly reports 0.
 */
export interface ITemplateCard extends ITemplateInfo {
	/** Bind slots: the `{{slot}}` prompts plus inline `bind:` links - the data-bound positions in the doc. */
	readonly bindSlots: number;
	/** How many documents in the open folder were generated from this template (lineage; honest 0 when none). */
	readonly usageCount: number;
	/** The skeleton-thumbnail rows derived from the template's parsed doc (grey prose + accent-tint slots). */
	readonly skeleton: readonly ITemplateSkeletonRow[];
}

/**
 * One document in a chat's *working set* - the edit targets a multi-document instruction fans out
 * across (plan 18, decision 60). Distinct from a document's `sources` (data bindings it reads from):
 * the working set is "the documents this instruction should change". Rendered as a chip in the composer.
 */
export interface IWorkingSetDoc {
	readonly resource: URI;
	readonly title: string;
}

/**
 * The result of a read-only whole-project question from the Project Home composer (F15 / journey 1w). The
 * `answer` is plain-words prose (never JSON, never a proposal); `citations` are the real project document /
 * source names actually consulted, so the answer is auditable and never grounded in a fabricated reference.
 * `via` is `model` for a real model answer, `fallback` for the honest no-model / no-document guidance turn.
 */
export interface IProjectAnswer {
	readonly answer: string;
	readonly citations: readonly string[];
	readonly via: 'model' | 'fallback';
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

/** One bound key shown in the in-surface source-peek pane (the comp's "Sync across" source panel). */
export interface ISourcePeekRow {
	readonly key: string;
	readonly value: string;
	/** True when this key is the one the clicked provenance dot points at (highlighted in the pane). */
	readonly selected: boolean;
	/** The live source value now ("now"), when it has drifted from the applied `value` ("then"): the source
	 * changed since the figure was last synced. Unset when the value still matches (plan 37 F13). */
	readonly current?: string;
}

/**
 * The raw response payload behind a non-file (api/mcp) bound value (plan 29, iter 4): the real JSON / MCP
 * tool result the value was extracted from, so source-peek shows the actual payload instead of pretending
 * to be a CSV file. `field` is the extracted key/field, highlighted in the rendered payload.
 */
export interface ISourcePayload {
	/** The source origin label, e.g. "api.example.com" or "demo.query". */
	readonly source: string;
	/** The raw response text (pretty-printed JSON for api; the MCP tool text for mcp). */
	readonly raw: string;
	/** The field/key that was extracted from the payload (highlighted in the view). */
	readonly field: string;
	/** The source kind, for the pane's label ("API response" / "MCP result"). */
	readonly kind: SourceKind;
}

/**
 * The data behind a product-tab source viewer (plan 45 pin 7 / P7.4): a source FILE read by its own resource
 * for the grid-glyph source tab, independent of any one document's bindings. `grid` is the parsed CSV rows (latest
 * highlighted, the same grid the drawer shows) when the file is a CSV; `text` is the raw file text for a
 * non-CSV source; `name` is the file name shown as the tab label and the viewer heading.
 */
export interface ISourceViewerData {
	readonly name: string;
	readonly grid?: ISourceGrid;
	readonly text: string;
}

/**
 * The data behind the in-surface source-peek pane. The pane renders inside the one document surface
 * (never a second editor group) - this is the v2 replacement for the SIDE_GROUP source open.
 */
export interface ISourcePeek {
	/** The primary file source's name (e.g. "metrics.csv"). */
	readonly source: string;
	readonly rows: readonly ISourcePeekRow[];
	/** Titles of living documents that also reference this source. */
	readonly referencedBy: readonly string[];
	/** The source's raw CSV grid (the comp shows the actual rows, latest highlighted), when available. */
	readonly grid?: ISourceGrid;
	/** For a clicked api/mcp bound value: the real response payload with the extracted field (plan 29 iter 4). */
	readonly payload?: ISourcePayload;
	/**
	 * The pin label when the document was published and this source is frozen to a version (plan 32 iter 4):
	 * "pinned at v <short-hash> of <date>". Absent when the document is not published / this source is not
	 * pinned, so an unpublished document's source-peek shows nothing extra. Real data only - from the lock's pins.
	 */
	readonly pinnedLabel?: string;
	/**
	 * When the peeked CSV was EXTRACTED from a spreadsheet workbook (issue #131, doc 22 section 4), the provenance
	 * hop the drawer shows above the CSV row: figure → CSV row → extracted from `Budget.xlsx · Sheet "FY26"`
	 * → synced-at. Absent for a hand-authored CSV. Real data only - read from the extraction manifest.
	 */
	readonly workbook?: IWorkbookProvenance;
}

/**
 * The workbook → sheet provenance hop for a CSV that Abstract extracted from a spreadsheet (issue #131).
 * Recorded in the extraction manifest (`data/<workbook>/.abstract-source.json`) so the provenance chain
 * survives on disk as a plain file (P6) and a re-open can rebuild it without re-parsing the workbook.
 */
export interface IWorkbookProvenance {
	/** The originating workbook's file name, e.g. "Budget.xlsx". */
	readonly workbook: string;
	/** The sheet the CSV came from, e.g. "FY26". */
	readonly sheet: string;
	/** The last extraction time (ISO), shown as "synced N h ago". */
	readonly syncedAt: string;
	/** Any NAMED limitations for this sheet (merged headers, pivot layout), surfaced verbatim - never a silent misread. */
	readonly warnings: readonly string[];
}

/** The outcome of extracting one sheet of a workbook to a CSV (issue #131). */
export interface IExtractedSheet {
	readonly name: string;
	/** The written CSV's file name under `data/<workbook>/` (e.g. "FY26.csv"). */
	readonly fileName: string;
	/** The extracted CSV's workspace-relative path (e.g. "data/Budget/FY26.csv"), for binding + provenance. */
	readonly relativePath: string;
	readonly rows: number;
	readonly cols: number;
	readonly warnings: readonly string[];
}

/**
 * The result of "Use as source" on a spreadsheet workbook (issue #131, doc 22 section 4). On success each sheet
 * became a clean CSV under `data/<workbook>/`; the workbook is now watched and re-extracts on change. On
 * failure the workbook was left untouched and `reason` names why (P6: the original is never destroyed).
 */
export interface IWorkbookUseResult {
	readonly ok: boolean;
	readonly sheets: readonly IExtractedSheet[];
	readonly reason?: string;
}

/**
 * The result of "Use as source" on a PDF (issue #131, doc 22 section 4 - PDFs are read-only CONTEXT, never value
 * bindings). On success the PDF became a `context` edge on the target document and its extracted text is
 * stored as knowledge. An image-only/scanned or password-protected PDF NAMES itself unreadable (`ok:false`
 * + `reason`) rather than yielding empty context, and no dead edge is created.
 */
export interface IPdfContextResult {
	readonly ok: boolean;
	readonly pages: number;
	readonly reason?: string;
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
	// The underlying instruction actually sent to the model when it differs from the shown `content`
	// (a template generation shows the user plain-words progress but drives the model with the full
	// template brief, so the internal brief never leaks into the rail; plan 37 F4). Retry re-runs this.
	readonly prompt?: string;
	readonly mentions?: readonly string[];
	readonly steps?: readonly IChatStep[];
	readonly via?: 'model' | 'fallback';
	// Ids of the pending changes this assistant turn proposed (edits and/or insertions), so the Chat
	// rail can render a Copilot/Cursor-style review card per proposal tied to the turn. The card reads
	// the live pending change by id, so it disappears once approved/rejected.
	readonly proposedIds?: readonly string[];
	// True when the user cancelled this reply mid-stream (plan 27, decision D27-B): the prose streamed so
	// far is kept as an honest, muted "stopped" turn and any proposal JSON is discarded (never queued).
	readonly stopped?: boolean;
	// True when the model call genuinely failed (not a cancel): the rail renders an honest error turn with
	// an inline Retry that re-sends the same user message (plan 27 iter 3). Distinct from the no-model /
	// no-document fallbacks, which are honest guidance the user cannot usefully retry.
	readonly failed?: boolean;
	// The documents a whole-project / working-set fan-out could not reach the model for (F14, issue #123).
	// When present, the rail renders a NAMED error listing these documents (never a silent "no changes") plus
	// a "Retry failed" affordance that re-runs ONLY these documents via `retryFailedDocs`. Proposals that DID
	// land in the same run are still rendered alongside the error (a partial success), so this coexists with
	// `proposedIds` and is distinct from `failed` (which is a whole-turn failure with no proposals).
	readonly failedDocs?: readonly IFanoutFailedDoc[];
	// True when a fan-out paused mid-run on the spent daily budget (map-D15; doc 18 section 2.1): the content
	// is the plain-words cap message, proposals already queued stay reviewable, and the run screen marks the
	// not-yet-run documents skipped (they never ran) - NOT failed, and NOT a "no change" all-clear (F14 item 3).
	readonly paused?: boolean;
}

/** The in-flight streaming turn for a document: the prose accumulated so far + the tool steps as they settle. */
export interface IStreamingChat {
	readonly text: string;
	readonly steps: readonly IChatStep[];
}

/**
 * The progress of a whole-project fan-out that was packed into context-bounded batches (plan 30, track 3,
 * D30-B). The fan-out sends the working set in `batchCount` batches; `batchIndex` is the 1-based batch
 * currently running (0 before the first). The project-run command strip reads this to show `batch K of M`,
 * and `oversizeDocIds` marks the documents too large for the run so their swarm tiles read the honest
 * "too large for this run" state rather than being silently dropped. Absent when a run sent a single batch
 * with no oversize documents (the common small-scale case), so nothing extra is shown then.
 */
export interface IFanoutProgress {
	/** The 1-based index of the batch currently running (0 before the first batch starts). */
	readonly batchIndex: number;
	/** The total number of batches the working set was packed into. */
	readonly batchCount: number;
	/** The docIds (resource strings) of documents too large for the budget - never sent, reported honestly. */
	readonly oversizeDocIds: readonly string[];
	/**
	 * The docIds (resource strings) of documents the model could not be reached/errored for (F14, issue #123).
	 * The run screen reads these so a failed document's tile shows a named "model unreachable" state, never a
	 * silent "no change" all-clear. Empty when every document the run reached was processed.
	 */
	readonly failedDocIds: readonly string[];
}

/**
 * One bound source in the Properties panel's BOUND SOURCES list (plan 45 pin 12): a source file plus the count
 * of bind keys drawing from it and those keys (so a click opens the source drawer at them). Truthful from the
 * lock's binding graph.
 */
export interface IBoundSourceSummary {
	readonly source: string;
	readonly count: number;
	readonly keys: readonly string[];
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

	/**
	 * Fires when something asks the right panel to focus a tab (e.g. "Ask AI" -> Chat). This is the
	 * already-mounted path: if the rail is not yet mounted when the request is made the event is lost,
	 * so `focusPanel` ALSO records the request as `consumePendingPanel`'s pending state for replay.
	 */
	readonly onDidRequestPanel: Event<ILivingDocsPanelRequest>;

	/**
	 * Fires as a chat reply streams (plan 27 iter 3): the argument is the document whose live turn grew a
	 * delta or a tool step. The rail appends to the live turn without a full re-render, so the composer's
	 * caret and the scroll position survive token-by-token growth. `onDidChange` still fires once at the
	 * start and once at the end of a reply (busy on/off); this event carries the in-between deltas.
	 */
	readonly onDidStreamChat: Event<URI>;

	/**
	 * Fires when a surface (the review rail) asks the editor to scroll to and highlight one pending
	 * change's inline diff - the rail-to-editor navigation (plan 19, E-A). `docId` is the change's
	 * document; the editor pane showing that document reveals the change by id. Navigate-only: this never
	 * approves - approval happens wherever the user then acts (rail or editor).
	 */
	readonly onDidRequestFocusChange: Event<{ readonly docId: string; readonly changeId: string }>;

	/**
	 * Fires when the Outline tab asks the editor to scroll to one of the open document's headings (issue
	 * #181). `docId` is the document; `headingIndex` is the heading's zero-based ordinal among all heading
	 * blocks in document order, which the editor's ProseMirror surface reveals by scrolling to that `<hN>`.
	 * Navigate-only, mirroring `onDidRequestFocusChange`.
	 */
	readonly onDidRequestRevealHeading: Event<{ readonly docId: string; readonly headingIndex: number }>;

	/**
	 * Fires when a Home NEEDS-YOU card deep-links into its document (plan 48 H2.3u). `docId` is the document;
	 * `blockIndex` is the addressed block's zero-based ordinal in document order (recomputed from the durable
	 * block id via the address model), which the editor's ProseMirror surface reveals by scrolling to that
	 * top-level block. A block that was deleted degrades to `-1` (the webview no-ops the scroll, spec section 3.1).
	 */
	readonly onDidRequestRevealBlock: Event<{ readonly docId: string; readonly blockIndex: number }>;

	/**
	 * Fires when "Add to chat" (docs 20 section 1d, the 1m entry) attaches a file to the active
	 * document's chat: the argument is the file name to seed as an `@mention` in the chat composer.
	 * The review rail listens and appends the mention to its draft; `focusPanel('chat')` reveals the tab.
	 */
	readonly onDidRequestChatAttach: Event<string>;

	/**
	 * Fires when a document is asked to open its Present flow (pin 6's "Present" menu item). The argument is
	 * the document's id; the editor showing THAT document opens its Present modal (the same flow the header's
	 * Present action drives). The caller opens the document first, so the request lands on a live editor.
	 * Navigate-only, mirroring `onDidRequestRevealHeading` - it never mutates the document.
	 */
	readonly onDidRequestPresent: Event<{ readonly docId: string }>;

	/**
	 * Fires when the review rail's own calm collapse control (the header chevron) is activated. The
	 * RailVisibilityContribution listens: it hides the auxiliary-bar part AND records the user's manual
	 * `collapsed` choice so the quiet shell is restored and remembered across the next entry / restart.
	 * This is the ONLY user gesture that records a manual choice; every `focusPanel`-driven reveal is a
	 * peek (plan 42 slice L4).
	 */
	readonly onDidRequestCollapseReviewRail: Event<void>;

	/**
	 * Reveal the right panel and switch it to the given tab, optionally carrying a deep-link payload.
	 *
	 * Fires `onDidRequestPanel` synchronously (the already-mounted rail switches immediately) AND records
	 * the request as the pending panel, so a request made before the rail mounts is not lost: the rail
	 * consumes it via `consumePendingPanel` on mount. Recording the latest request overwrites any prior
	 * un-consumed one (last request wins).
	 */
	focusPanel(tab: LivingDocsPanelTab, payload?: ILivingDocsPanelRequest['payload']): void;

	/**
	 * Consume-and-clear the pending panel request recorded by `focusPanel`. The review rail calls this
	 * once when it mounts/subscribes so a `focusPanel` fired before the rail existed (e.g. "View history"
	 * on a not-yet-open document) still lands on the right tab. Returns `undefined` when nothing is
	 * pending; the request is cleared on read so it is replayed at most once.
	 */
	consumePendingPanel(): ILivingDocsPanelRequest | undefined;

	/**
	 * Collapse the review rail from its own calm collapse control and record it as the user's manual
	 * `collapsed` choice (plan 42 slice L4). Fires `onDidRequestCollapseReviewRail`.
	 */
	collapseReviewRail(): void;

	/** Ask the editor showing a change's document to scroll to and highlight that change's inline diff. */
	focusChange(changeId: string): void;

	/** Ask the editor showing this document to scroll to the heading at `headingIndex` (Outline tab, #181). */
	revealHeading(resource: URI, headingIndex: number): void;

	/**
	 * Navigate-only scroll to a block addressed by its durable `blockId` (the address model, spec section 3.1),
	 * WITHOUT switching the rail's own tab. Clicking a "Line N" citation on a Review card or a chat meaning-change
	 * card (pin 13.5) opens the block's document and asks its editor to scroll to that block. The id is resolved to
	 * the block's current ordinal at reveal time, so a document that changed since the citation was rendered still
	 * scrolls to the right block; a deleted block (resolve returns undefined) opens the document without a scroll and
	 * never errors. Rides the same reveal-block webview seam as `reviewBlock`, but never approves and never re-tabs.
	 */
	revealBlockAddress(resource: URI, blockId: string): Promise<void>;

	/**
	 * Open a document and trigger its Present flow (pin 6's "Present" menu item). Opens the document (so the
	 * editor is live), then fires `onDidRequestPresent` for that document; the editor showing it opens the same
	 * Present modal the header's Present action drives. No new present logic - it routes to the existing flow.
	 */
	requestPresent(resource: URI): Promise<void>;

	/**
	 * Deep-link a Home NEEDS-YOU card into its document (plan 48 H2.3u): open the document, open the Review
	 * tab, and scroll to the block addressed by `blockId` (resolved to its current ordinal via the address
	 * model). A missing/deleted block opens the doc + Review tab without a scroll (spec section 3.1). Navigate-only.
	 */
	reviewBlock(resource: URI, blockId?: string): Promise<void>;

	// --- model access: provider picker + survey (plan 35 iter 4) ---
	/**
	 * Whether the agent model is reachable (the proxy answers /healthz and the model is not disabled). Used by
	 * the startup router (F15 / journey 1w, map-D2): a first run with NO model connected lands on the Model
	 * Access step, but once a model is reachable - or on any later launch - opening the project leads with Home.
	 */
	isModelReachable(): Promise<boolean>;
	/** The current model door + usage snapshot for the Settings provider step (reads the proxy's /healthz). */
	getModelProviderStatus(): Promise<IModelProviderStatus>;
	/**
	 * Register a mounted consumer's interest in the live provider status (issue #236, the D1 down->up recovery).
	 * While at least one consumer is watching AND the broker is down, the service re-probes /healthz on a low
	 * frequency so a recovered broker returns the control to green mid-session - the settled-status flicker fix
	 * otherwise serves `broker-down` from cache without ever re-probing while idle. Dispose to unwatch on unmount;
	 * ref-counted, so the background probe runs only while watched and stops on the last unwatch (no orphan timer).
	 */
	watchProviderStatus(): IDisposable;
	/**
	 * The models the active backend can drive, for the composer's picker (issue #179). Cached per backend and
	 * fetched cheaply from the broker's /models (on backend change or first read, never on every healthz poll).
	 * Returns an empty catalogue when the broker is unreachable; the composer degrades to no picker, never errors.
	 */
	getModelCatalogue(): Promise<IModelCatalogue>;
	/** The id of the model currently selected for the active backend (its default until the user picks one). */
	getSelectedModelId(): Promise<string | undefined>;
	/** Persist the user's model choice for the active backend (issue #179); subsequent calls carry it. */
	setSelectedModelId(modelId: string): Promise<void>;
	/** Begin "Sign in with ChatGPT": returns the authorize URL to open in a browser (or undefined on failure). */
	startChatGptSignIn(): Promise<string | undefined>;
	/** Poll the sign-in flow's stage while the Settings step waits for the browser round-trip to complete. */
	pollChatGptSignIn(): Promise<IChatGptSignInStatus>;
	/** Clean sign-out: forget the stored ChatGPT token bundle. */
	signOutChatGpt(): Promise<void>;
	/** Record the onboarding survey locally as the `model_configured` event (plan 36 wires it to PostHog). */
	submitOnboardingSurvey(survey: IOnboardingSurvey): Promise<void>;

	// --- Plan 42 slice L2: the inline first-AI-use model-access choice (issue #198) ---
	// No model/account decision on the entry path; the first send with no backend configured HOLDS the typed
	// prompt and the rail renders the sign-in vs included-model choice inline. Picking a door replays the exact
	// prompt so the original request proceeds - across the ChatGPT sign-in round-trip too.
	/** The prompt held for `resource` at the first-AI-use moment (an unconfigured backend), or undefined. */
	getPendingModelPrompt(resource: URI): IPendingModelPrompt | undefined;
	/** Drop the held first-use prompt for `resource` without replaying it (the user dismissed the choice). */
	dismissModelChoice(resource: URI): void;
	/** Choose "Use the included model" at first use: select the included tier, then replay the held prompt. */
	chooseIncludedModelAndReplay(resource: URI): Promise<void>;
	/** Begin "Sign in with ChatGPT" from the rail's first-use choice; returns the authorize URL to open. */
	startSignInForChat(): Promise<string | undefined>;
	/** After the ChatGPT sign-in round-trip lands signed-in, replay the prompt held for `resource`. */
	completeSignInAndReplay(resource: URI): Promise<void>;

	// --- D26 onboarding funnel + feedback verb (doc 20 section D26; doc 15 section 2.1; doc 18 sections 2.4/2.5) ---
	// Consent + capture are the analytics service's job (IAnalyticsService, already on this base): every event
	// below routes through it, so a declined/unset consent silently no-ops. The methods here are the onboarding
	// surface's seam into that service plus the feedback verb's founder-log side.
	/** Record one T5 onboarding funnel step (`onboarding_step`); a no-op unless analytics consent is enabled. */
	recordOnboardingStep(step: OnboardingStep): void;
	/** Clear the application-scoped state of the active onboarding walkthrough. */
	endOnboardingWalkthrough(): void;
	/**
	 * The feedback verb (doc 18 section 2.5): flag an applied change as "this was wrong". Captures the
	 * `this_was_wrong_reported` event (a hashed ref id only -- no prose) through the analytics service, writes
	 * a founder-visible local log line (which keeps the plain-words comment), AND persists the flag onto the
	 * matching audit row (keyed by `changeRef` = the row's ISO time) so it survives relaunch and the row cannot
	 * be re-flagged forever (issue #258). Never blocks; best-effort.
	 */
	reportChangeWrong(report: IFeedbackReport): Promise<void>;
	/**
	 * The "See it work" path (doc 20 section D26 step 2): write the bundled demo CSV + demo Living Document
	 * into the open folder, open it, and sync its figures from the CSV so the provenance peek (wow one) and
	 * the prompted iteration (wow two) are both real. Returns the demo document's URI, or undefined when no
	 * folder is open (the honest no-folder seam).
	 */
	generateDemoReport(): Promise<URI | undefined>;

	// --- per-document views (the editor renders one document by its resource) ---
	getDoc(resource: URI): ILivingDoc | undefined;
	/** The verbatim Markdown source of a document (for the Raw Markdown view). */
	getRawText(resource: URI): string;
	/** The resolved value of each bind key for a document (mirrors the lock's resolved values). */
	getResolved(resource: URI): ReadonlyMap<string, string>;
	/**
	 * The last freshness recompute's live re-resolved value per bind key (the "now" of the F13 then-vs-now
	 * peek), distinct from `getResolved` (the applied "then"). Undefined until the first recompute; a stale
	 * api/mcp key absent from the map (the live fetch was unavailable) drives the peek's fallback naming.
	 */
	getCurrentValues(resource: URI): ReadonlyMap<string, string> | undefined;
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
	/**
	 * Run one Skill across every project document (plan 32 iter 3, the P3 gap): fans the skill grade over the
	 * folder's living documents and returns the per-document summary the Agents run strip renders. Skills stay
	 * single-doc units; the orchestrator does the fanning. Real data only - a non-living doc or a model-less
	 * model-backed skill is honestly skipped.
	 */
	runSkillAcrossProject(id: ISkillCheck['id'], skillName: string): Promise<ISkillRunSummary>;
	/** Re-hash the document's sources and recompute its dirty bits (what the source watcher triggers). */
	checkSources(resource: URI): Promise<void>;
	getStatus(resource: URI): string;
	/** Block ids that were auto-applied in the last refresh (for the green "just updated" highlight). */
	getRecentlyApplied(resource: URI): ReadonlySet<string>;
	/** Pending changes that belong to one document (rendered inline in its editor). */
	getPendingForDoc(resource: URI): readonly IProposedChange[];
	/**
	 * The canonical `docId` this document's pending changes are keyed under (or `undefined` when it has
	 * none). Bulk-approve callers route `approveAll` through this - the proposals' own id - so a URI-form
	 * drift between the open editor's resource and the queued proposals can never silently no-op (#253).
	 */
	pendingDocIdFor(resource: URI): string | undefined;

	// --- Properties panel (plan 45 pin 12) - frontmatter read/write + truthful lock reads ---
	/** The document's created/updated times, read from the file's own stat (undefined when unknown). */
	getDocTimes(resource: URI): Promise<{ readonly created?: number; readonly updated?: number }>;
	/** The document's bound sources grouped from the lock, with truthful per-source bind counts + keys. */
	getBoundSources(resource: URI): readonly IBoundSourceSummary[];
	/** The document's autonomy policy, coerced from frontmatter onto the shared three-tier grammar (#122 F11). */
	getDocPolicy(resource: URI): DocAutonomyLevel;
	/** Write the document's autonomy policy to its frontmatter `policy:` on disk (#122 F11). */
	setDocPolicy(resource: URI, policy: DocAutonomyLevel): Promise<void>;
	/** Write the document's plain-language status to its frontmatter `status:` on disk (empty clears it). */
	setDocStatus(resource: URI, status: string): Promise<void>;
	/** Write the document's title to its frontmatter `title:` on disk (empty clears it). */
	setDocTitle(resource: URI, title: string): Promise<void>;
	/** Add or remove one tag on the document's frontmatter `tags:` list on disk. */
	setDocTag(resource: URI, tag: string, add: boolean): Promise<void>;

	// --- workspace-wide views (the review rail aggregates across documents) ---
	getAllPending(): readonly IProposedChange[];
	getAudit(): readonly IAuditEntry[];
	/**
	 * The Agents activity ledger's read-model inputs (plan 49-c A3): the real event streams the History tab and
	 * the editor's trust chips already read - each loaded document's lock audit (carried with its doc identity +
	 * current block order) and the agent run log (with each run's agent name) - plus the live pending meaning
	 * changes (the WAITING rows). A pure read: it never mutates the orchestrator or any lock. The pure
	 * `buildActivityLedger` fold turns these into the flat chronological ledger the Agents screen renders.
	 */
	getActivityLedgerInputs(): ILedgerInputs;

	/** Discover and summarize every Living Document in the workspace (for the "Documents" home). */
	listDocuments(): Promise<readonly ILivingDocSummary[]>;

	/** The workspace's non-Markdown files (basenames): data/source files for the tree-rail SOURCES section
	 * and files we cannot yet import (.doc/.docx) for the "Not yet imported" section (plan 37 F9/F10). */
	listWorkspaceExtras(): Promise<readonly string[]>;

	/**
	 * Resolve a workspace-extra basename (as listed by `listWorkspaceExtras`) back to its file URI, so a
	 * tree-rail action (e.g. "Use as source" on a workbook/PDF) can act on the real file (issue #131).
	 * Returns the first match in the folder, or undefined when the name is not found.
	 */
	resolveWorkspaceExtra(name: string): Promise<URI | undefined>;

	/**
	 * "Use as source" on a spreadsheet workbook (issue #131, doc 22 section 4): extract each sheet to a clean CSV
	 * under `data/<workbook>/`, write the extraction manifest, and WATCH the workbook so a change re-extracts
	 * the sheets and flags dependent documents through the normal staleness machinery. The workbook stays on
	 * disk untouched (P6). Extraction runs in the node/proxy layer, never the renderer.
	 */
	useXlsxAsSource(workbook: URI): Promise<IWorkbookUseResult>;

	/**
	 * "Use as source" on a PDF (issue #131, doc 22 section 4): extract its text in the node/proxy layer and, when
	 * readable, register the PDF as a read-only `context` edge on `doc` (framing, never value bindings) with
	 * its extracted text stored as knowledge. A scanned/image-only or password-protected PDF names itself
	 * unreadable and no edge is created. The PDF stays on disk and is watched like any context source.
	 */
	usePdfAsSource(pdf: URI, doc: URI): Promise<IPdfContextResult>;

	/**
	 * Import a `.docx` file (by its workspace basename) into a Living Document (issue #129, doc 22 section 2).
	 * Converts it to Markdown through the node/proxy pipeline (mammoth -> HTML -> GFM), writes `<Name>.md`
	 * BESIDE the untouched original with `imported` provenance (from + sourceHash + the kept/dropped summary)
	 * in its lock, lifts embedded images to `assets/<Name>/` with relative references, opens the new document,
	 * and surfaces the plain-words kept/dropped summary card. A password-protected / legacy / unparseable file
	 * is refused with a plain-words reason and left untouched in the "not yet imported" state - never a silent
	 * mangle. Returns the outcome; undefined when no folder is open or the named file is gone.
	 */
	importDocx(name: string): Promise<IImportOutcome | undefined>;

	/** Discover and parse every `*.template.md` in the workspace (for the Templates screen; plan 28). */
	listTemplates(): Promise<readonly ITemplateInfo[]>;

	/**
	 * The v2 Templates gallery model (plan 48 T2): every template plus its real usage count (documents in
	 * the open folder born from it, via `template: <name>` provenance) and its parsed skeleton-thumbnail rows.
	 * Additive over `listTemplates` (which stays the birth-sheet source): one folder walk both discovers the
	 * templates and tallies lineage, so the card meta ("N bind slots · used N×") is honest, never fabricated.
	 */
	listTemplateGallery(): Promise<readonly ITemplateCard[]>;

	/**
	 * The project's real source registry (plan 29, D29-A): every source referenced by a document in the
	 * folder (frontmatter `sources:`/`context:`), folded by source identity with its freshness, last-sync
	 * time and the documents that depend on it. A pure projection over the locks + the dependency graph -
	 * no new persistence. Sorted by label; the honest empty state (no sources) returns an empty list.
	 */
	listSources(): Promise<readonly ISourceInfo[]>;

	/**
	 * Re-sync one source's dependent documents through the existing sync machinery (K3.1 "Re-sync"): resolves
	 * the source's dependent bound documents and runs the standard `refreshFromSources` pass over them, so the
	 * drift is reconciled through the ordinary approval + audit path (warn-never-auto-fix; nothing bespoke).
	 * A no-op for a source that has no local counterpart / no dependents.
	 */
	resyncSource(sourceId: string): Promise<void>;

	/**
	 * Mark a source's staleness "as expected" (K3.1), or clear the mark. Persisted per-workspace via the
	 * storage service: a marked source is calmed to context-grey in the registry (the drift is acknowledged)
	 * without ever auto-fixing it. Fires `onDidChange` so the Knowledge surface re-projects.
	 */
	setSourceExpected(sourceId: string, expected: boolean): Promise<void>;

	/**
	 * Create a new blank template file (`untitled.template.md`) seeded with a commented example and open it.
	 * Returns the new resource, or undefined when no folder is open. (plan 28, iter 2)
	 */
	createTemplate(): Promise<URI | undefined>;

	/**
	 * Use a template (plan 48 T2.4): DUPLICATE it into the open folder as a new document with its binds emptied
	 * to `{{slot}}` placeholders, then open it. A pure duplication (no model call, no review proposals): the
	 * pattern's structure lands as a plain document recording `template: <name>` provenance and declaring no
	 * sources, so it reports `needsSourceBinding` (the tree-row "bind sources" nudge) until a source is bound.
	 * Returns the new resource, or undefined when no folder is open / the template is unreadable.
	 */
	useTemplate(templateUri: URI): Promise<URI | undefined>;

	/**
	 * Save the ACTIVE document as a template (plan 48 T2.5). Keeps the active document's body but empties its
	 * binds to `{{slot}}` placeholders and writes it with `template: true` + `name:` frontmatter into the
	 * workspace `.abstract/templates/<name>.template.md` store, so the new template appears in the grid (T2.6
	 * discovery). A no-op (with a plain-words nudge) when no document is active. Returns the new resource.
	 */
	saveActiveDocAsTemplate(): Promise<URI | undefined>;

	/**
	 * Generate a draft document from a template (plan 28, iter 3). Writes `<docName>.md` as the template's
	 * static skeleton (headings + verbatim bind links; the H1 becomes the document name; slots stripped),
	 * records `template: <name>` provenance, opens it, then drives the EXISTING chat path with a composed
	 * instruction so the prose arrives as reviewable insertion proposals - never written directly. With no
	 * model reachable the skeleton is still created and a status line explains the draft needs the model.
	 * Returns the new resource, or undefined when no folder is open / the template is unreadable.
	 */
	generateFromTemplate(templateUri: URI, docName: string, note: string): Promise<URI | undefined>;

	/**
	 * Draft a new document FROM SELECTED SOURCES (F17, journey 1b's third birth). Writes `<docName>.md` as a
	 * bare skeleton that declares the picked sources (csv/json under `sources:` so figures bind, md/txt under
	 * `context:` as knowledge), opens it, then drives the EXISTING chat path so the draft arrives as reviewable
	 * insertion proposals with provenance - never silently written prose. With no model reachable the skeleton
	 * is still created and a status line explains the draft needs the model (honest, never fake content).
	 * Returns the new resource, or undefined when no folder is open.
	 */
	generateFromSources(sources: readonly string[], docName: string, note: string): Promise<URI | undefined>;

	/**
	 * Grow a new template FROM EXAMPLE DOCUMENTS (F18, journey 1x). Validates the picked set (3-10; fewer or
	 * more is refused with a plain-words reason), writes a real `<name>.template.md` skeleton (skill.md shape:
	 * description + structure + recurring figures + tone + success examples) that records the examples so the
	 * analysis can read them, opens it (it joins the + New picker at once), then drives the EXISTING chat path
	 * so the agent NAMES the commonalities through the review grammar - reviewable, never silent. With no model
	 * reachable the skeleton is still created and a status line names the error - never rendered as "no
	 * commonalities". Returns the new resource, or undefined when no folder is open / the set is invalid.
	 */
	generateTemplateFromExamples(examples: readonly string[], templateName: string): Promise<URI | undefined>;

	/** The registered orchestration agents (for the Agents view). */
	getAgents(): readonly IAgentDef[];

	/** The persisted run log, newest-first (Agents-screen run log + Home; plan 32 iter 2, D32-A). */
	getAgentRuns(): readonly IAgentRun[];

	/** The persisted run log for ONE agent, newest-first (the detail drawer's run log; plan 32 iter 3). */
	getAgentRunsForAgent(agentId: string): readonly IAgentRun[];

	// --- Agents-screen detail drawer registry edits (plan 32 iter 3): create / duplicate / pause / inline
	// policy + trigger edits. Each persists to `agents.json` and fires onDidChange so the screen re-renders. ---
	/** Create a new agent (draft-only, manual trigger by default); the drawer then edits it inline. */
	createAgent(): Promise<void>;
	/** Duplicate an existing agent as a fresh "(copy)" with its own id and no run history. */
	duplicateAgent(agentId: string): Promise<void>;
	/** Pause / resume an agent: the scheduler skips a paused agent; a manual Run now is still honoured. */
	setAgentDisabled(agentId: string, disabled: boolean): Promise<void>;
	/** Set an agent's policy inline (the three-level select). */
	setAgentPolicy(agentId: string, policy: AgentPolicy): Promise<void>;
	/** Set an agent's trigger inline (the cron day/time picker or heartbeat-hours field). */
	setAgentTrigger(agentId: string, trigger: IAgentTrigger): Promise<void>;

	/**
	 * The most recent agent run that FAILED and is still the latest for its agent, for the Home attention line
	 * (plan 32 iter 2). Undefined when the newest run of every agent succeeded - truthful automation: a run
	 * that did not fail says nothing.
	 */
	getLatestAgentFailure(): IAgentRun | undefined;

	/** Run an agent now over its flow documents (or the whole workspace if it scopes none). */
	runAgent(agentId: string): Promise<IAgentRun | undefined>;

	/** The name of the currently open workspace folder (the "project"), or undefined when none is open. */
	getWorkspaceFolderName(): string | undefined;

	/**
	 * The truthful DISPLAY name of the open project folder (plan 33, L5), or undefined when none is open.
	 * Same as the folder name except it resolves the web/memfs "mount" stub to the sample's own name when
	 * the folder ships an `.abstract-name` marker. Use this for user-facing project labels (Home, crumb, tiles).
	 */
	getProjectDisplayName(): string | undefined;

	/** Prompt for and open a local folder as the workspace (the on-ramp; FSA on web, native dialog on desktop). */
	openFolder(beforeOpen?: () => void | Promise<void>): Promise<boolean>;

	/**
	 * Create a new blank Living Document and return its resource. With a `name` the file is born titled
	 * (`<name>.md`); with none it stays `Untitled.md` (decision 56's zero-ceremony, name-on-first-save path).
	 */
	createDocument(name?: string): Promise<URI | undefined>;

	// --- provenance-safe file operations (docs 20 section 1d / map-D6): the Files-tab context menu ---

	/**
	 * The documents that depend on a file through their frontmatter `sources:`/`context:` - the
	 * warn-and-list behind delete (map-D6). A projection over the discovered folder (loaded + on-disk),
	 * excluding the file's own document. Empty when nothing depends on it.
	 */
	getFileDependents(resource: URI): Promise<readonly IFileOpDependent[]>;

	/**
	 * Rename a file, moving its `.lock.json` sidecar with it ATOMICALLY (both move or neither) and
	 * rewriting any dependent document's provenance references (frontmatter + lock source paths) so
	 * bindings and audit stay intact. Shows an Undo toast on success and a named error on failure (a
	 * clashing target name never half-applies). `newBaseName` is the new name without its extension.
	 */
	renameFile(resource: URI, newBaseName: string): Promise<void>;

	/**
	 * Delete a file and its `.lock.json` sidecar, orphaning dependents gracefully (map-D6): dependents
	 * keep their last cached values, flagged stale, never blocked or broken. Shows an Undo toast that
	 * restores the file (and sidecar). Closes the file's editor if it is open.
	 */
	deleteFile(resource: URI): Promise<void>;

	/** Attach a file to the active document's chat as an `@mention` (docs 20 section 1d, the 1m entry). */
	attachToChat(resource: URI): void;

	/**
	 * Duplicate a document AND its `.lock.json` sidecar under a distinct, non-colliding name (pin 6 / P6.4).
	 * The copy carries the same bound provenance (its sidecar is copied verbatim), so it opens as a living
	 * document straight away. Opens the new copy. Returns the new document's resource, or undefined on failure.
	 * The new document has no dependents, so nothing needs re-pointing (unlike `moveFile`).
	 */
	duplicateFile(resource: URI): Promise<URI | undefined>;

	/**
	 * Move a document AND its `.lock.json` sidecar together into another folder (pin 6 / P6.4), re-pointing
	 * every dependent document's provenance references (frontmatter `sources:`/`context:` + lock source paths)
	 * so bindings survive the move - the same atomic, re-pointing machinery `applyTidyMoves` uses, for one file
	 * to a chosen destination folder. `targetFolder` is the destination directory; the file keeps its name. A
	 * clashing target is refused with a named error (nothing half-applies). Shows an Undo toast on success.
	 */
	moveFile(resource: URI, targetFolder: URI): Promise<void>;

	// --- the Tidy verb (doc 22 section 5): propose folder-convention moves through the review grammar ---

	/**
	 * Build the Tidy move plan for the open project (doc 22 section 5): a deterministic, model-free set of
	 * proposed moves into the soft convention folders (`data/`, `assets/`, `templates/`, `archive/`,
	 * `archive/originals/`, `working-files/`), each with a stated mechanical reason. Conservative by design -
	 * only root files, only clear signals; an already-tidy project returns an empty plan (nothing to tidy).
	 * Nothing moves here: this only proposes.
	 */
	buildTidyPlan(): Promise<readonly ITidyPlanItem[]>;

	/**
	 * Apply a set of APPROVED Tidy moves (doc 22 section 5, requires F16). Each move is atomic on the lock
	 * (document + `.lock.json` sidecar together or neither), creates its destination folder on demand,
	 * re-points every dependent lock's `source` path in the same operation so bindings survive, and refuses
	 * a clashing destination with a named error (nothing half-applies). Shows one sticky Undo toast that
	 * inverts every applied move. The caller passes only the items the human approved.
	 */
	applyTidyMoves(items: readonly ITidyPlanItem[]): Promise<void>;

	/** The folder's data files (csv/json) not already bound to the document, for the Add-source picker. */
	getSourceCandidates(resource: URI): Promise<readonly string[]>;

	/**
	 * The project folder's data files (csv/json), for the Knowledge screen's project-level Add-source picker
	 * (plan 29, iter 2). Not doc-scoped - the user picks the target document in the sheet. Excludes lock
	 * sidecars and the agents registry (they are not user data sources). Empty when no folder is open.
	 */
	getFolderDataFiles(): Promise<readonly string[]>;

	/**
	 * The project folder's document files (md/txt at the root), for the "From sources..." knowledge picker
	 * (F17) and the from-examples template wizard's example picker (F18). Excludes `*.template.md`, generated
	 * `*.export.md`/`*.source.md` views and lock sidecars. Empty when no folder is open. (See getFolderDataFiles
	 * for the csv/json data files.)
	 */
	getFolderDocFiles(): Promise<readonly string[]>;

	/** Bind a source file to a document by writing its frontmatter `sources:` list (no hand-editing). */
	addSource(resource: URI, source: string): Promise<void>;

	/** Unbind a source from a document by removing it from the frontmatter `sources:` list. */
	removeSource(resource: URI, source: string): Promise<void>;

	/** Folder files (md/csv/json) not already referenced or bound, for the Add-context-file picker. */
	getContextCandidates(resource: URI): Promise<readonly string[]>;

	/** Reference a real folder file from a document by adding it to the frontmatter `context:` list. */
	addContextFile(resource: URI, file: string): Promise<void>;

	/** Remove a referenced file from a document's frontmatter `context:` list. */
	removeContextFile(resource: URI, file: string): Promise<void>;

	/** Load a document; for a Living Document its bound source is read alongside. */
	loadDocument(resource: URI): Promise<void>;

	/**
	 * Persist edited raw Markdown verbatim and reparse the document. Pass `{ silent: true }` to skip
	 * the change event so a live editing surface (e.g. the ProseMirror editor) is not forced to
	 * re-render and lose its cursor while the user is still typing.
	 */
	saveRawText(resource: URI, text: string, options?: { readonly silent?: boolean }): Promise<void>;

	/**
	 * Edit a non-bound prose block in place (WYSIWYG) and persist it. Bound blocks are
	 * driven by their source and cannot be hand-edited; this is a no-op for them.
	 */
	editBlock(resource: URI, blockId: string, text: string): Promise<void>;

	/**
	 * Re-derive bound blocks across bound documents from the latest source values (plan 30, track 1).
	 * With no argument this is the project-wide refresh: it scopes to the documents whose sources' hashes
	 * actually changed (a cheap hash check first), so an unchanged folder does no derivation work. Pass a
	 * `resource` to scope to a single document (the doc toolbar's Refresh) plus the documents that share a
	 * changed source with it. Shared sources are read once per pass (a CSV bound by 20 docs is read once).
	 */
	refreshFromSources(resource?: URI): Promise<void>;

	/**
	 * The expensive, on-demand impact pass (spec 3.6): read the changed context sources against the
	 * document's prose claims and queue candidate edits (with provenance + confidence) into the review
	 * rail. Figures auto-apply; meaning/influence changes wait for approval. A claim whose anchor no
	 * longer confidently matches the prose surfaces a loud "re-link?" prompt instead of re-attaching.
	 */
	reviewImpact(resource: URI): Promise<void>;

	/**
	 * The before-export gate's current verdict (plan 32 iter 4), so the export/present flow can SHOW it -
	 * no silent block. `pass:true` = clean; `pass:false` carries the one-line grader `flag` the export sheet
	 * renders alongside "Export anyway" (audited override) and "Fix first" (jump to the flag).
	 */
	previewExportGate(resource: URI): { readonly pass: boolean; readonly flag?: string };

	/**
	 * Export a document's current state to a self-contained HTML page and open it. `force` proceeds PAST a
	 * failed before-export gate ("Export anyway"), auditing the override (plan 32 iter 4) - never silent.
	 */
	exportDocument(resource: URI, force?: boolean): Promise<URI | undefined>;

	/**
	 * Export a document's *resolved* state to a clean, static Markdown file (no bindings, no
	 * {cell} placeholders, live values inlined) and open it. The portable share/Obsidian artefact.
	 * `force` proceeds past a failed before-export gate, auditing the override (plan 32 iter 4).
	 */
	exportMarkdown(resource: URI, force?: boolean): Promise<URI | undefined>;

	/**
	 * Export a document's *resolved* state to a clean `.docx` (issue #130), mapped to Word's built-in styles
	 * with bound values inlined and no Abstract chrome. The conversion runs in the node/proxy layer (doc 22
	 * section 3); a failed before-export gate is honoured exactly like the other exports (`force` = "Export anyway",
	 * audited). Returns the written file, or `undefined` if the proxy is unreachable (surfaced honestly).
	 */
	exportDocx(resource: URI, force?: boolean): Promise<URI | undefined>;

	/**
	 * Export a document's self-contained HTML page to `.pdf` (issue #130) via the desktop build's
	 * print-to-PDF (doc 22 section 3). Desktop-only: on the web dev harness the native host is absent and this
	 * surfaces an honest message. `force` proceeds past a failed before-export gate, auditing the override.
	 */
	exportPdf(resource: URI, force?: boolean): Promise<URI | undefined>;

	/**
	 * Persist a pasted/dropped image (issue #141) beside `resource` under `assets/<doc-basename>/` (the #129
	 * import layout). The name is sanitised (safe chars, extension derived from `mime` when absent) and
	 * de-duplicated against the folder. Returns the document-relative path (`assets/<doc-basename>/<file>`) the
	 * editor writes into the Markdown as `![alt](assets/...)`.
	 */
	saveImageAsset(resource: URI, name: string, bytes: VSBuffer, mime?: string): Promise<string>;

	/**
	 * Read an image referenced by a document-relative `src` (e.g. `assets/Probe/logo.png`, `logo.png`) back as
	 * a `data:` URI so the webview can display it (it cannot load a path relative to the document). Oversized
	 * (>10 MB) or unreadable/missing files resolve with `{ error: true }` so the editor shows a visible broken
	 * state rather than a silent gap.
	 */
	readImageAsset(resource: URI, src: string): Promise<{ readonly dataUri?: string; readonly error?: boolean }>;

	/** Share a document by copying its resolved, binding-free Markdown to the clipboard. */
	shareDocument(resource: URI): Promise<void>;

	/**
	 * Publish a document: snapshot (pin) its sources to current versions for reproducibility. `force`
	 * publishes PAST a failed before-export gate, auditing the override (plan 32 iter 4) - never silent.
	 */
	publishDocument(resource: URI, force?: boolean): Promise<void>;

	// --- versions / snapshots (plan 26 iter 2: the trust spine) ---
	/** The document's saved versions, newest first (empty until the first snapshot). */
	getSnapshots(resource: URI): readonly ISnapshotEntry[];
	/**
	 * Take a snapshot of the document's current body under a label. Auto-called on a refresh/agent run
	 * that applied changes, on a bulk approve, and on publish; also the manual "Save Version" action.
	 * Capped at {@link SNAPSHOT_CAP} with oldest-eviction. `body` defaults to the current on-disk text;
	 * callers that snapshot a pre-change state (e.g. before a refresh writes the new body) pass it.
	 */
	saveSnapshot(resource: URI, label: string, via: SnapshotVia, body?: string): Promise<void>;
	/**
	 * Restore an earlier version through the one approve path: any pending changes are rejected first,
	 * the snapshot body is written back, an audit entry (`approved`, via `restore`) is recorded, and
	 * freshness is recomputed so bindings that are now stale re-flag (which is correct and visible).
	 */
	restoreSnapshot(resource: URI, snapshotId: string): Promise<void>;

	// --- Chat agent (the right-panel Chat tab) ---
	/** The conversation so far for a document (empty until the first message). */
	getChatMessages(resource: URI): readonly IChatMessage[];
	/** The files a `@mention` can attach for a document: its linked sources + context files. */
	getMentionableFiles(resource: URI): readonly string[];
	/** True while a chat reply is in flight for a document (renders the "working" indicator). */
	isChatBusy(resource: URI): boolean;
	/**
	 * The in-flight streaming turn for a document (plan 27 iter 3): the prose streamed so far + the tool
	 * steps that have settled, or `undefined` when no reply is streaming. The rail renders this as a live
	 * assistant turn and reads its `text` for the salvage when the user stops.
	 */
	getStreamingChat(resource: URI): IStreamingChat | undefined;
	/**
	 * The batch progress of an in-flight (or the last) whole-project fan-out for a document (plan 30,
	 * track 3, D30-B): which batch of how many is running, and which documents were too large for the
	 * budget. Undefined when the fan-out ran as a single batch with no oversize documents, so the run
	 * screen shows nothing extra in the common small-scale case. Read by the project-run command strip.
	 */
	getFanoutProgress(resource: URI): IFanoutProgress | undefined;
	/**
	 * Send one user message to the document's Chat agent. Parses `@mentions`, gathers the document
	 * (with resolved figures) plus the mentioned/context sources, and asks the model for a reply that
	 * may also propose prose edits - those queue into the Review rail like any other pending change.
	 * With no model reachable it appends an honest fallback turn and proposes nothing (never fakes a reply).
	 */
	sendChatMessage(resource: URI, text: string, displayText?: string): Promise<void>;
	/**
	 * Answer a READ-ONLY, whole-project question for the Project Home composer (F15 / journey 1w, map-D24:
	 * "asking a question answers read-only with citations"). Reads every project document (figures resolved)
	 * plus their sources and asks the model for a plain-words answer - it NEVER queues a proposal or mutates a
	 * document. `citations` are the real document/source names actually consulted (never fabricated); with no
	 * model reachable it returns an honest fallback answer and no citations. A change request routes to the
	 * run/task surface instead of here (the caller classifies the intent).
	 */
	askProjectQuestion(question: string): Promise<IProjectAnswer>;
	/**
	 * Cancel the in-flight chat reply for a document (plan 27). Aborts the streaming model call; the prose
	 * streamed so far is kept as a muted "stopped" turn and any proposal JSON is discarded (decision D27-B).
	 * A no-op when no reply is in flight.
	 */
	cancelChat(resource: URI): void;
	/**
	 * Re-run the last user message after a failed reply (plan 27 iter 3). Drops the failed assistant turn so
	 * the retry replaces it (never duplicating the user turn) and delivers a fresh reply. A no-op while a
	 * reply is in flight or when the last turn is not a failed assistant turn.
	 */
	retryChat(resource: URI): void;
	/**
	 * Re-run ONLY the documents a fan-out failed to reach the model for (F14, issue #123). Reads the failed
	 * documents off the last assistant turn's `failedDocs`, drops that turn, and re-delivers the same user
	 * instruction restricted to just those documents - so a surgical retry never re-touches the documents that
	 * already succeeded. A no-op while a reply is in flight or when the last turn carries no failed documents.
	 */
	retryFailedDocs(resource: URI): void;

	// --- working set (plan 18: the documents a chat instruction edits across; decisions 60-62) ---
	/** The documents in the chat's working set (edit targets), keyed by the active document. */
	getWorkingSet(resource: URI): readonly IWorkingSetDoc[];
	/** Add documents to the chat's working set (de-duplicated by resource; titles resolved on add). */
	addToWorkingSet(resource: URI, docs: readonly URI[]): Promise<void>;
	/** Add every Markdown document in the workspace folder to the working set (the "Add folder" affordance). */
	addFolderToWorkingSet(resource: URI): Promise<void>;
	/** Remove one document from the chat's working set. */
	removeFromWorkingSet(resource: URI, doc: URI): void;
	/** The folder documents not already in the working set, for the "Add documents…" picker. */
	getWorkingSetCandidates(resource: URI): Promise<readonly IWorkingSetDoc[]>;

	/**
	 * Tweak (amend-before-approve, plan 31 iter 3, D31-B): mutate a pending change's proposed `newText` in
	 * place so the reviewer can hand-edit the agent's words before approving. Fires `onDidChange` so every
	 * surface re-renders the amended proposal as still-pending; the subsequent {@link approve} records the
	 * audit `via: 'tweaked'`. A no-op for an unknown id, a `figure` change (figures come from sources and are
	 * not hand-editable - the affordance hides for them), an empty amendment, or one that matches the current
	 * text. No new persist path: the amended text lands through the same {@link approve} serialisation.
	 */
	amendChange(changeId: string, newText: string): void;

	approve(changeId: string): Promise<void>;
	/** Accept every pending change for a document at once (the comp's "accept all"). */
	approveAll(docId: string): Promise<void>;
	/** Accept every pending change across every document at once (the chat-level "Accept all"). */
	approveAllPending(): Promise<void>;
	/** Discard one pending change. `reason` is the reviewer's optional plain-words note, recorded on the audit row. */
	reject(changeId: string, reason?: string): Promise<void>;
	/** Discard every pending change for one document at once (the per-document "Reject all"). */
	rejectAll(docId: string): Promise<void>;
	/** Discard every pending change across every document at once (the chat-level "Reject all"). */
	rejectAllPending(): Promise<void>;

	// --- source-peek + "Sync across" (the comp's signature editing interaction) ---
	/**
	 * The in-surface source-peek data for a document: the bound keys + resolved values, with the cells
	 * behind the clicked provenance dot marked `selected`, plus the documents that reference the source.
	 * Returns `undefined` for a non-living / unloaded document. Pure read - opens NO editor group (the v2
	 * replacement for the abrasive SIDE_GROUP source open; the pane renders inside the one document surface).
	 */
	getSourcePeek(resource: URI, cells: readonly string[]): ISourcePeek | undefined;
	/**
	 * Read a source file for the product-tab source viewer (spec 43 section 3.2, plan 45 pin 7 / P7.4). Unlike
	 * `getSourcePeek` (which is doc-scoped and folds in bind provenance), this reads a source FILE by its own
	 * resource so it can back a source-viewer editor tab opened from the tree SOURCES rows (or, plan 49, the
	 * Knowledge table). Returns the parsed CSV grid when the file is a CSV, the raw text otherwise, and the file
	 * name - or `undefined` when the file cannot be read (a moved/renamed source degrades to no tab, never an
	 * error). Pure read; opens NO editor group.
	 */
	readSourceViewer(resource: URI): Promise<ISourceViewerData | undefined>;
	/**
	 * Open a source FILE as a product tab (spec 43 section 3.2, plan 45 pin 7 / P7.4). The source opens as a
	 * lightweight source-viewer input on the SAME tab strip as the document in the active editor group (never a
	 * second group) - the grid-glyph source tab. Used by the tree SOURCES rows and (plan 49) the Knowledge table.
	 */
	openSourceTab(resource: URI): Promise<void>;
	/**
	 * Open a document to the right (spec 43 section 3.2, pin 6's ONE sanctioned split). Creates a second editor
	 * group beside the active one and opens the document there; the second group gets its own product-tab row
	 * (pin 7 / P7.8). Closing the last tab in that group closes the group (no blank group). The context-menu item
	 * that calls this ships in plan 46; this is the group-side support plan 45 owns.
	 */
	openToTheRight(resource: URI): Promise<void>;
	/**
	 * Record that the user peeked a source's provenance (plan 36: the provenance_peeked funnel event). `mode`
	 * distinguishes a click-through on a provenance dot from opening the source pane via the toolbar. Analytics
	 * only - counts the interaction, never the source or its values; a no-op unless the user consented.
	 */
	notePeek(mode: 'click-through' | 'toolbar'): void;

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
