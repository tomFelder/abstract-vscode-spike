/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { BlockApplyFailure } from './applyOutcome.js';

// Living Documents - research spike data model (clean-file + lock-file format, spec 08).
//
// A document is ~99% pure Markdown the user owns. Where a value is bound to a source, the author
// (or agent) writes a bind link inline - a real Markdown link with a `bind:` scheme:
//
//   Revenue grew [18%](bind:metrics.mrr.delta) week-on-week to [$48.6k](bind:metrics.mrr) MRR.
//
// The bind link IS the anchor (no line numbers, no slugged ids that drift). The visible link text
// is a rendered cache of the resolved value, so the file reads correctly standalone and an LLM sees
// both the value and its origin. The companion `<doc>.lock.json` is the source of truth for resolved
// values + freshness; on render/save the visible cache is reconciled to the lock (lock wins).

// Where a source draws its data from.
//   file -> a sibling file in the workspace (e.g. metrics.csv)
//   api  -> a live HTTP JSON endpoint (e.g. a CRM or product metrics API)
//   mcp  -> a tool exposed over MCP / the language-model tools service
export type SourceKind = 'file' | 'api' | 'mcp';

// One inline bind-link occurrence found in the prose: [value](bind:key).
//   key   -> the binding identity, e.g. "metrics.mrr" or "metrics.mrr.delta". This is the anchor.
//   value -> the visible (rendered-cache) link text at parse time.
export interface IBindLink {
	readonly key: string;
	readonly value: string;
}

export type LivingDocBlockType = 'heading' | 'paragraph' | 'table';

// A block is one top-level Markdown element, used only for rendering + review correlation. Block
// ids are content/ordinal-derived render keys, NOT persistence keys: the bind link's `key` is the
// durable anchor (spec 3.7 - identity-keyed, never text-position-keyed).
export interface ILivingDocBlock {
	readonly id: string;
	readonly type: LivingDocBlockType;
	text: string;                       // raw Markdown for this block, including inline bind links
	readonly level?: number;            // heading level (1-6) for `heading` blocks
	binds: IBindLink[];                 // bind links found in this block (cache of the parse)
}

export interface ILivingDoc {
	// The DERIVED display title: the frontmatter `title:` if authored, else the first H1, else 'Untitled'.
	// Used for cards/labels. NOT what gets serialized -- see `frontmatterTitle`.
	title: string;
	// The AUTHORED frontmatter `title:` ('' if the file had none). Serialization emits only this, never the
	// derived `title` above, so a plain Markdown file the user wrote never gains an injected `title:` block
	// when an accepted chat edit re-serializes it (plan 16 iter 4). Optional so hand-built test docs default
	// to "no authored title".
	readonly frontmatterTitle?: string;
	subtitle: string;
	readonly sources: string[];         // frontmatter `sources:` (value-binding sources)
	readonly context: string[];         // frontmatter `context:` (influence sources)
	readonly blocks: ILivingDocBlock[];
	// True when the file declares sources/context in frontmatter or carries bind links. Plain
	// Markdown (READMEs, notes) renders generically instead. The service additionally treats a
	// `.md` with a sibling `<doc>.lock.json` as living.
	readonly isLiving: boolean;
	// Clean Markdown body after the frontmatter, used to render plain documents and as the raw
	// editing view. Reconstructable from `blocks`.
	readonly body: string;
	// True when the file's frontmatter declares `template: true` (plan 28, D28-A): a `*.template.md` file
	// that seeds new documents rather than being a report itself. Templates are excluded from the document
	// list and shown only on the Templates screen. Optional so hand-built test docs default to a non-template.
	readonly isTemplate?: boolean;
	// A template's human `name:` (falls back to the derived title), shown as the template card title.
	readonly templateName?: string;
	// A template's `description:` frontmatter, shown as the template card subtitle.
	readonly templateDescription?: string;
	// The originating template's name, recorded on a GENERATED document as `template: <name>` provenance
	// so the audit trail reads "Created from <name> template" (empty on hand-authored documents).
	readonly fromTemplate?: string;
	// The document's plain-language status (frontmatter `status:`), surfaced as the Properties STATUS chip
	// (plan 45 pin 12). Empty on a doc that never authored one; edits write back to frontmatter on disk.
	readonly status?: string;
	// The document's tags (frontmatter `tags:` block list), shown as the Properties TAGS chips (plan 45 pin 12).
	readonly tags?: string[];
	// The per-document autonomy policy string (frontmatter `policy:`), read/coerced through `docPolicy.ts` into
	// the shared three-tier grammar (plan 45 pin 12 / #122 F11). Empty on a doc that never opted in; the reader
	// sees the safe default until they choose.
	readonly policy?: string;
}

// figure  -> low risk, auto-applies
// meaning -> changes the meaning, waits for one-click approval
export type ChangeKind = 'figure' | 'meaning';

// The cheap, always-on staleness signal for one document (spec 3.4). Value bindings are stale when
// their source's current hash no longer matches the lock; context sources are stale when changed
// since last review. Computed without any model calls.
export interface IFreshness {
	readonly staleBindings: readonly string[];  // bind keys whose source value changed since last sync
	readonly staleContext: readonly string[];   // context files changed since last review
	readonly dirty: boolean;                     // true when anything is stale ("may be affected")
}

// --- the lock file (<doc>.lock.json) - the dependency graph + provenance ledger (spec 3.3) ---
// The lock is the source of truth for resolved values and freshness. It is generated/maintained by
// the app and is rebuildable from the sources; the `.md` carries only the visible (cached) values.

export const LOCK_VERSION = 1;

// One exact value edge: a bind key (token) resolved from a source cell.
export interface IBindingEntry {
	readonly resolved: string;          // the value at last sync (what the .md cache reconciles to)
	readonly source: string;            // human-ish origin, e.g. "metrics.csv#mrr"
	readonly sourceHash: string;        // hash of the source value at last sync (freshness compare)
	readonly syncedAt: string;
	readonly appliedBy: 'agent' | 'user';
	readonly kind: ChangeKind;
}

// One influence edge: a source that shapes the framing of the prose (1:many, judged by a model).
export interface IContextEntry {
	readonly reviewedHash: string;      // hash of the source at last review
	readonly reviewedAt: string;
	readonly scope: 'document';         // v1: whole-doc; later: section/claim
}

// Prose bound to sources, anchored by its sentence text (relocated by fuzzy match on re-derive).
export interface IClaimEntry {
	readonly anchor: string;            // sentence text + surrounding context
	readonly boundTo: readonly string[];// bind keys / context files this claim draws on
	readonly kind: ChangeKind;
	readonly state: 'applied' | 'pending';
}

// Reserved: freeze a published doc to a source version so later changes don't rewrite history.
export interface IPin {
	readonly source: string;
	readonly version: string;
}

// Context the user adds by hand (not a frontmatter file source): a pasted note, an image, or a piece
// of company knowledge. Stored in the lock (not the clean .md) so the file stays portable. `pasted`
// and `knowledge` carry their text in `detail`; `image` carries its path/URL in `label`.
export type AddedContextKind = 'pasted' | 'image' | 'knowledge';

export interface IAddedContext {
	readonly kind: AddedContextKind;
	readonly label: string;
	readonly detail?: string;
}

// What caused a snapshot to be taken (plan 26, D26-B): an agent/refresh run that applied at least one
// change, a bulk approve, a publish, or a user's manual "Save Version" action. It labels the version
// row in the History tab and lets restore explain provenance.
export type SnapshotVia = 'refresh' | 'bulk-approve' | 'publish' | 'manual';

// A named, restorable version of the document body (plan 26 iter 2). The body is the full serialised
// Markdown at the moment of the snapshot; `auditIndex` is the length of the audit trail at that moment,
// so the History tab can group the changes that happened since each version. Lives in the lock so the
// `.md` stays the canonical document: deleting the lock loses history but never the document.
export interface ISnapshotEntry {
	readonly id: string;
	readonly label: string;
	readonly at: string;
	readonly via: SnapshotVia;
	readonly body: string;
	readonly auditIndex: number;
	// How many source versions this snapshot pinned (plan 32 iter 4): set only on a `publish` snapshot, so the
	// History row can render the real pin count ("pinned 3 source versions") beside the SNAPSHOT badge instead
	// of the comp's mock. Absent on non-publish snapshots and on older locks (they read as no pins recorded).
	readonly pinnedSources?: number;
}

// Snapshots are capped with oldest-eviction so the lock never grows without bound (D26-A); at ~1-5 KB
// each for beachhead docs, 50 versions is well under a megabyte.
export const SNAPSHOT_CAP = 50;

// Provenance-from-birth for a document that was IMPORTED from a foreign format (doc 22 section 2, issue
// #129): the original file is never destroyed, so the lock records where the `.md` came from - the source
// filename, a hash of the original bytes (identity/staleness compare), when it was imported, and the
// plain-words kept/dropped fidelity summary the import card showed. Absent on a hand-authored document.
export interface IImportProvenance {
	// The original file's name beside the imported document, e.g. "Weekly Summary.docx" (never deleted).
	readonly from: string;
	// A hash of the original file's bytes at import time (the same FNV-1a the binding freshness uses).
	readonly sourceHash: string;
	readonly importedAt: string;
	// The plain-words fidelity summary (doc 22 section 2): what the conversion kept and what it dropped,
	// so the provenance stays honest long after the import card is gone. Each entry is one plain phrase.
	readonly kept: readonly string[];
	readonly dropped: readonly string[];
}

export interface ILivingDocLock {
	version: number;
	bindings: Record<string, IBindingEntry>;
	context: Record<string, IContextEntry>;
	claims: Record<string, IClaimEntry>;
	pins: IPin[];
	// The provenance audit, folded in from the old `.audit.json` sidecar so the lock is the single
	// durable home for a document's dependency graph + history.
	audit: IAuditEntry[];
	// User-added context (pasted text / images / company knowledge), kept here so the clean .md stays
	// just prose + frontmatter file sources.
	contextItems: IAddedContext[];
	// Named, restorable versions of the body (plan 26 iter 2). Additive field: absent on older locks =
	// no versions yet; LOCK_VERSION stays 1.
	snapshots: ISnapshotEntry[];
	// Import provenance (issue #129): set only on a document born from a foreign-format import; absent on a
	// hand-authored / template-grown document. Additive field, so older locks read as "not imported".
	imported?: IImportProvenance;
}

export function emptyLock(): ILivingDocLock {
	return { version: LOCK_VERSION, bindings: {}, context: {}, claims: {}, pins: [], audit: [], contextItems: [], snapshots: [] };
}

// --- orchestration: agents, triggers, policy, runs (spec 09) ---
// Triggers wake the loop; the dependency graph decides what is affected; the review rail is where
// output lands. An agent decouples those three: when it runs (trigger), what it touches (flow), and
// how its output is gated (policy). Persisted as workspace external state (`agents.json`), behind the
// same read/write seam as the lock.

export type AgentTriggerKind = 'event' | 'cron' | 'heartbeat' | 'lifecycle' | 'manual';
export type LifecycleHook = 'before-export' | 'on-publish' | 'on-open';

export interface IAgentTrigger {
	readonly kind: AgentTriggerKind;
	readonly source?: string;       // event: the source/folder path whose change wakes the agent ('*' = any)
	readonly cron?: string;         // cron: a simple schedule, e.g. "Mon 09:00"
	readonly everyHours?: number;   // heartbeat: cadence in hours
	readonly lifecycle?: LifecycleHook; // lifecycle: which document moment fires it
}

// The per-edge safety dial (spec 4.2): figures may apply silently; prose waits for approval; the
// heartbeat only ever drafts.
export type AgentPolicy = 'auto-figures' | 'ask-before-apply' | 'draft-only';

export type AgentStatus = 'idle' | 'running' | 'needs-approval' | 'blocked' | 'error';

// The source -> document edges the agent operates over (its slice of the dependency graph).
export interface IAgentFlow {
	readonly sources: readonly string[];
	readonly docs: readonly string[];
}

export interface IAgentDef {
	readonly id: string;
	readonly name: string;
	trigger: IAgentTrigger;
	readonly flow: IAgentFlow;
	policy: AgentPolicy;
	lastRun?: string;
	status: AgentStatus;
	// Paused (plan 32 iter 3): a disabled agent stays in the registry and its history but the scheduler
	// skips it - a due cron/heartbeat/event tick never fires a disabled agent. Default absent (= enabled);
	// only ever set true so an older persisted registry with no flag reads as enabled. A manual "Run now"
	// on the detail drawer is deliberately still honoured (the user explicitly asked), the scheduler is not.
	disabled?: boolean;
}

// One execution of an agent, recorded for the History/observability trace and the Agents-screen run log
// (D32-A, decision 150). Persisted in `agents.json` (no new file) so the run history survives a reload;
// the last 50 runs are kept (AGENT_RUN_CAP), oldest evicted.
export interface IAgentRun {
	readonly agentId: string;
	readonly startedAt: string;
	finishedAt?: string;
	applied: number;        // figures auto-applied
	queued: number;         // candidates queued in the review rail
	blocked?: string;       // the grader flag if the verify gate stopped the run
	// Which trigger kind fired this run (cron / heartbeat / event / manual), shown as the "via" column
	// of the run log. Optional so older persisted runs (no `via`) still parse.
	via?: AgentTriggerKind;
	// How many documents the run processed (the run-log "N docs" outcome count). Distinct from applied/
	// queued (per-change counts): a run can touch several docs and change none.
	docsTouched?: number;
	// Documents the run failed on (its runner threw). 0 on a clean run; >0 with `error` set on a failure.
	failed?: number;
	// The failure string when the run errored (the run-log failure line + the Home attention line). Absent
	// on a clean run - truthful automation: a run that did not fail says nothing (spec 09; plan 32 iter 2).
	error?: string;
	// A run that was NOT started because a previous run of the same agent was still in flight (spec 09 section 3
	// overlap rule, plan 32 iter 2): recorded so runs never silently stack. `applied`/`queued` are 0 and the
	// run-log renders it as "skipped (still running)". Absent on a run that actually executed.
	skippedReason?: 'still-running';
}

// The run log is capped with oldest-eviction so `agents.json` never grows without bound (D32-A,
// decision 150): the last 50 runs across all agents, shown newest-first on the Agents screen.
export const AGENT_RUN_CAP = 50;

/**
 * One document's result in a cross-project skill run (plan 32 iter 3, the P3 gap): the skill grade run over
 * every folder document through the plan-23 fan-out surface. `status` mirrors the per-document `ISkillCheck`
 * verdict for the run's skill (`pass` / `flag`), and `detail` carries the grader's one-line reason so the run
 * strip reads the true finding per document (never a fabricated summary). Real data only - a document the run
 * could not grade (not living, or a model-backed skill with no model) is honestly `skipped`.
 */
export type SkillRunDocStatus = 'pass' | 'flag' | 'skipped';

export interface ISkillRunDocResult {
	readonly docId: string;
	readonly docTitle: string;
	readonly status: SkillRunDocStatus;
	readonly detail: string;
}

/**
 * The whole-project skill-run summary (plan 32 iter 3): every folder document's grade for one skill, plus the
 * flagged/passed/skipped tallies. Pure so the run strip and its tests derive from the same real per-doc results.
 */
export interface ISkillRunSummary {
	readonly skillId: 'financial' | 'strategy' | 'formatting';
	readonly skillName: string;
	readonly results: readonly ISkillRunDocResult[];
	readonly flagged: number;
	readonly passed: number;
	readonly skipped: number;
}

export function summariseSkillRun(skillId: ISkillRunSummary['skillId'], skillName: string, results: readonly ISkillRunDocResult[]): ISkillRunSummary {
	return {
		skillId,
		skillName,
		results,
		flagged: results.filter(r => r.status === 'flag').length,
		passed: results.filter(r => r.status === 'pass').length,
		skipped: results.filter(r => r.status === 'skipped').length,
	};
}

// One document's dirty bits in the workspace queue, split by edge kind (the heartbeat drains this).
export interface IDirtyEntry {
	readonly value: string[];       // changed value-binding source paths
	readonly influence: string[];   // changed influence/context source paths
}

export interface IProposedChange {
	readonly id: string;
	readonly docId: string;         // URI string of the document this change belongs to
	readonly docTitle: string;      // human label for grouping in the review rail
	readonly blockId: string;
	readonly blockLabel: string;    // human label for the block, e.g. "Commentary"
	readonly oldText: string;
	readonly newText: string;
	readonly kind: ChangeKind;
	readonly confidence: number;    // 0..1
	readonly rationale: string;
	readonly sourceCells: readonly string[];
	// The SOURCE GROUNDING for a project-wide fan-out change (plan 23.4, decision #77): the verbatim
	// decision line the change was derived from (`sourceQuote`) and its line number in the attached
	// source (`sourceLine`), where determinable. Both are OPTIONAL - a change with no grounding (a
	// non-fan-out edit, or a model reply that omitted them) leaves them undefined. `sourceLine` is only
	// ever a REAL line (the model's number or a verified lookup of the quote), never fabricated.
	readonly sourceQuote?: string;
	readonly sourceLine?: number;
	// Set by the Review-impact pass (Item 5): which lock claim this edit re-anchors, the context
	// sources it reviews (so approval can mark them reviewed), and whether the model/heuristic produced
	// it. `relink` marks a loud-failure prompt: the claim's anchor no longer confidently matches the
	// prose, so the user is asked to re-link rather than the edit silently re-attaching.
	readonly claimId?: string;
	readonly contextReviewed?: readonly string[];
	readonly via?: 'model' | 'heuristic';
	readonly relink?: boolean;
	// A draft prepared proactively by a `draft-only` agent (e.g. the Freshness sweep): it waits in the
	// rail like any pending change but is flagged as never-auto-landed.
	readonly draft?: boolean;
	// A generative insertion (Chat "make me a list"): `newText` is brand-new content (no `oldText` to
	// diff against) inserted after `afterBlockId` (empty = end of document). Approve splices a new block
	// into the document rather than rewriting an existing one; the inline diff renders it all-additions.
	readonly insert?: boolean;
	readonly afterBlockId?: string;
	// The reviewer hand-edited the agent's proposed `newText` before approving (Tweak, plan 31 iter 3,
	// D31-B). Set by `amendChange`; the subsequent approve records the audit `via: 'tweaked'` so the trail
	// shows a human modified the agent's words - a trust signal, not bookkeeping.
	readonly tweaked?: boolean;
	// The reviewer APPROVED this change and the apply could not land (docs/30 invariant I1, issue #329): the
	// document moved on between the proposal and the approval. The change deliberately STAYS pending - it was
	// never applied, so it is still the reviewer's call - and carries the named reason so the review rail can
	// say what happened instead of clearing the card as though the edit had landed.
	readonly applyFailure?: BlockApplyFailure;
	// The store anchor's half-open `[start, end)` character range in the base revision's body (docs/30
	// section 4.3). Structurally the store's `IChangeSpan`, restated here rather than imported so the model
	// stays the leaf of the common layer (`changeRecord.ts` imports THIS file). It is the tie-breaker the
	// address model falls back to when `blockId` cannot address a block on its own - the id is gone (a
	// heading whose text was edited re-slugs) or it is ambiguous (two `## Notes` headings both slug to
	// `h-notes`). Undefined on a change that was never measured against a body.
	readonly span?: { readonly start: number; readonly end: number };
}

/**
 * The distinct documents with pending changes, ordered by where each one's FIRST pending change appears.
 * The ring both step-through walks travel; a document with nothing pending is simply never in it, which is
 * what makes "skip the clean documents" a property of the data rather than a filter someone has to remember.
 */
function pendingDocOrder(pending: readonly IProposedChange[]): string[] {
	const order: string[] = [];
	for (const c of pending) { if (!order.includes(c.docId)) { order.push(c.docId); } }
	return order;
}

/**
 * Step one place around the pending-document ring from `currentDocId`. `step` is +1 forwards, -1 backwards.
 * Returns undefined when there is nowhere else to go (no other document has pending changes). A current
 * document that is NOT itself in the ring (it is already clear) enters at the near end for the direction
 * asked: forwards lands on the first changed document, backwards on the last.
 */
function stepPendingDocId(pending: readonly IProposedChange[], currentDocId: string, step: 1 | -1): string | undefined {
	const order = pendingDocOrder(pending);
	const others = order.filter(id => id !== currentDocId);
	if (others.length === 0) { return undefined; }
	const idx = order.indexOf(currentDocId);
	if (idx < 0) { return step === 1 ? others[0] : others[others.length - 1]; }
	const n = order.length;
	for (let i = 1; i <= n; i++) {
		const cand = order[((idx + step * i) % n + n) % n];
		if (cand !== currentDocId) { return cand; }
	}
	return undefined;
}

/**
 * The next document (other than the current one) that still has pending changes, for the editor's
 * "Next document with changes" step-through (plan 19 iter 4). Distinct doc ids are ordered by where
 * their first pending change appears; the walk cycles forward from the current document so repeated
 * presses round-robin through every changed doc. Returns undefined when the current document is the only
 * one with pending changes (nowhere else to advance). Pure so it can be unit-tested directly.
 */
export function nextPendingDocId(pending: readonly IProposedChange[], currentDocId: string): string | undefined {
	return stepPendingDocId(pending, currentDocId, 1);
}

/**
 * The PREVIOUS document with pending changes - the exact inverse of {@link nextPendingDocId} (docs/30
 * section 4.3). Review is not monotonic: a reviewer who steps past a document, or who wants to re-read the
 * decision they just made, has to be able to walk back, and until now the contrib had no backward symbol at
 * all. Same ring, same wrap, same "clean documents are not in it" rule - only the direction differs.
 */
export function previousPendingDocId(pending: readonly IProposedChange[], currentDocId: string): string | undefined {
	return stepPendingDocId(pending, currentDocId, -1);
}

/**
 * One document tile in the project-wide fan-out swarm grid (plan 23, C4). A completed run aggregates
 * the service's pending changes by document into `changed` (N pending) or `no-change` (nothing queued).
 * The live `working` (spinner) state is set by the orchestrator while a document is still being
 * processed and is layered on top of this aggregation by the caller - the pure selector below only
 * distinguishes changed vs no-change, which is all `getAllPending()` can tell after a run.
 */
// `skipped` (plan 27 iter 4): a document the fan-out never settled a result for because the user stopped
// the run. The whole-project run is a single model call, so a mid-flight Stop means every not-yet-changed
// document is honestly `skipped` (it never produced a change), while any document that already had a change
// keeps it. Truthful per-tile state, matching plan 23's honesty rule.
// `oversize` (plan 30, track 3, D30-B): a document too large for the fan-out's context budget - it was
// NEVER sent to the model (it would overflow the call by itself), so its tile reads the honest "too large
// for this run" state rather than a silent drop or a "no change" that never happened.
// `failed` (F14, issue #123): a document the model could not be reached/errored for during the run. It WAS
// sent (or would have been) but the model call failed, so its tile reads a named "model unreachable" state -
// NEVER a silent "no change" (which would falsely claim it ran and found nothing: the F14 trust breach).
// `policy` (issue #257): a document dialled "Never change this doc" that the run left untouched by the human's
// own choice. Its tile reads a truthful "left alone (policy: never)" state, NEVER a silent "no change" - the
// dial was honoured and the run says so.
export type ProjectRunDocStatus = 'changed' | 'no-change' | 'working' | 'skipped' | 'oversize' | 'failed' | 'policy';

export interface IProjectRunDocTile {
	readonly docId: string;
	readonly docTitle: string;
	readonly status: ProjectRunDocStatus;
	readonly changeCount: number;
}

/**
 * The whole-project fan-out summary (plan 23, C4): one tile per project document plus the bottom-bar
 * totals, derived purely from the run's pending changes grouped by document. `docs` is the full set of
 * project documents (id + title) so documents the run did not touch still render as `no-change` tiles;
 * `pending` is `ILivingDocsService.getAllPending()`. Tiles preserve the order of `docs`. Pure so it can
 * be unit-tested directly and reused by the screen renderer.
 */
export interface IProjectRunSummary {
	readonly tiles: readonly IProjectRunDocTile[];
	readonly totalChanges: number;      // pending changes across every document
	readonly changedDocs: number;       // documents with at least one pending change
	readonly unchangedDocs: number;     // documents with no pending change (0 when the run was stopped)
	readonly skippedDocs: number;       // documents the stopped run never settled (plan 27 iter 4)
	readonly oversizeDocs: number;      // documents too large for the fan-out budget (plan 30, track 3)
	readonly failedDocs: number;        // documents the model could not be reached for (F14, issue #123)
	readonly policyDocs: number;        // documents left alone by "Never change this doc" (issue #257)
}

// `stopped` (plan 27 iter 4): the run was cancelled mid-flight, so a document with no pending change is
// honestly `skipped` (it never got to run) rather than `no-change` (it ran and produced nothing).
// `oversizeDocIds` (plan 30, track 3, D30-B): the documents too large for the fan-out's context budget -
// they were never sent, so their tile is honestly `oversize` regardless of stop state (they take priority
// over `changed`/`skipped`/`no-change` because "too large to run" is the true reason they produced nothing).
// `failedDocIds` (F14, issue #123): the documents the model could not be reached/errored for during the run.
// Their tile is honestly `failed` (a model outage, not a no-change) - it takes priority over `changed`/
// `skipped`/`no-change` for the same reason as `oversize`, but yields to `oversize` (a document too large to
// send never reached the model at all, so "too large" is the more precise reason it produced nothing).
export function summariseProjectRun(
	docs: readonly { readonly docId: string; readonly docTitle: string }[],
	pending: readonly IProposedChange[],
	stopped = false,
	oversizeDocIds: readonly string[] = [],
	failedDocIds: readonly string[] = [],
	skippedByPolicyDocIds: readonly string[] = [],
): IProjectRunSummary {
	const counts = new Map<string, number>();
	for (const c of pending) { counts.set(c.docId, (counts.get(c.docId) ?? 0) + 1); }
	const oversize = new Set(oversizeDocIds);
	const failed = new Set(failedDocIds);
	const policy = new Set(skippedByPolicyDocIds);
	const tiles: IProjectRunDocTile[] = docs.map(d => {
		const changeCount = counts.get(d.docId) ?? 0;
		// A "Never change this doc" document is flagged `policy` above everything else (issue #257): the human
		// dialled it off, so it was never sent and can carry no change - its tile must say so, not read `no
		// change`. An oversize document is honestly flagged even if it also shows no change: it never ran, so its
		// tile must not read `no change` (which claims it ran and found nothing) nor `skipped` (a stop). A
		// failed document (model unreachable) is likewise flagged over a false `no change` - the F14 fix.
		const status: ProjectRunDocStatus = policy.has(d.docId)
			? 'policy'
			: oversize.has(d.docId)
				? 'oversize'
				: failed.has(d.docId)
					? 'failed'
					: changeCount > 0 ? 'changed' : (stopped ? 'skipped' : 'no-change');
		return { docId: d.docId, docTitle: d.docTitle, status, changeCount };
	});
	const changedDocs = tiles.filter(t => t.status === 'changed').length;
	const skippedDocs = tiles.filter(t => t.status === 'skipped').length;
	const oversizeDocs = tiles.filter(t => t.status === 'oversize').length;
	const failedDocs = tiles.filter(t => t.status === 'failed').length;
	const policyDocs = tiles.filter(t => t.status === 'policy').length;
	// Count only changes attributable to a document in this project's tile set, so totalChanges
	// always equals the sum of the tile counts. A pending change whose docId is not in `docs`
	// (a stale snapshot / a doc removed mid-run) has no tile and must not inflate the bottom-bar total.
	const totalChanges = tiles.reduce((sum, t) => sum + t.changeCount, 0);
	return {
		tiles,
		totalChanges,
		changedDocs,
		unchangedDocs: tiles.length - changedDocs - skippedDocs - oversizeDocs - failedDocs - policyDocs,
		skippedDocs,
		oversizeDocs,
		failedDocs,
		policyDocs,
	};
}

/**
 * One "decision understood" in the C4 decisions column (plan 23.4). A decision groups the pending
 * changes that share a source grounding: the verbatim decision `quote`, its `sourceLine` in the source
 * where known (omitted when the model gave a quote but no line - NEVER fabricated), the number of
 * distinct documents that decision affects (`docsAffected`), and the raw change count. `grounded` is
 * true when the group was keyed on a real source quote/line; false when the run produced no source
 * grounding and the changes were grouped honestly by their free-text rationale instead (the degraded
 * state - the card then shows no source-line chip).
 */
export interface IDecisionGroup {
	readonly quote: string;
	readonly sourceLine?: number;
	readonly docsAffected: number;
	readonly changeCount: number;
	readonly grounded: boolean;
}

/**
 * Group the pending changes into decisions for the C4 "decisions understood" column. Changes are
 * grouped by their source line when present, else by their verbatim quote, else - when no change in the
 * run carries any source grounding - honestly by their free-text rationale (marked `grounded:false` so
 * the renderer omits the source-line chip rather than fabricate one). Groups preserve first-appearance
 * order; `docsAffected` counts distinct documents (a doc with several changes from one decision counts
 * once). Pure so it can be unit-tested directly and reused by the screen renderer.
 */
export function groupDecisions(pending: readonly IProposedChange[]): IDecisionGroup[] {
	const order: string[] = [];
	const groups = new Map<string, { quote: string; sourceLine?: number; docs: Set<string>; changeCount: number; grounded: boolean }>();
	for (const c of pending) {
		const quote = c.sourceQuote?.trim();
		const grounded = !!quote;
		// Key on the real line when the model supplied one, else the quote text, else the rationale
		// (the honest degrade). Distinct decisions with the same quote but different lines stay separate.
		const key = typeof c.sourceLine === 'number'
			? `line:${c.sourceLine}`
			: (quote ? `quote:${quote.toLowerCase()}` : `rationale:${(c.rationale || '').trim().toLowerCase()}`);
		const label = grounded ? quote! : (c.rationale || '').trim();
		let group = groups.get(key);
		if (!group) {
			group = { quote: label, sourceLine: typeof c.sourceLine === 'number' ? c.sourceLine : undefined, docs: new Set(), changeCount: 0, grounded };
			groups.set(key, group);
			order.push(key);
		}
		group.docs.add(c.docId);
		group.changeCount++;
	}
	return order.map(key => {
		const g = groups.get(key)!;
		const out: { quote: string; sourceLine?: number; docsAffected: number; changeCount: number; grounded: boolean } = {
			quote: g.quote,
			docsAffected: g.docs.size,
			changeCount: g.changeCount,
			grounded: g.grounded,
		};
		if (typeof g.sourceLine === 'number') { out.sourceLine = g.sourceLine; }
		return out;
	});
}

/**
 * The confidence a change carries in the cross-document review surface (plan 24, C5), mapped to the two
 * comp states: `high` renders a filled-dot "High" (`ok`/accent tokens) and `inferred` renders a half-dot "Inferred"
 * (`attention` tokens - "needs your eyes").
 *
 * D24-A - confidence mapping rule: a `meaning` change with `confidence < 0.8` is `inferred`; every other
 * change (any `figure` change, or a `meaning` change with `confidence >= 0.8`) is `high`. Figure changes
 * are deterministic source substitutions so they are always `high`; a meaning change is a rewrite of
 * prose, so only a confident one reads as `high` and a low-confidence one is flagged for the writer's eyes.
 */
export type ReviewConfidence = 'high' | 'inferred';

export function reviewConfidence(change: Pick<IProposedChange, 'kind' | 'confidence'>): ReviewConfidence {
	return change.kind === 'meaning' && change.confidence < 0.8 ? 'inferred' : 'high';
}

/**
 * The self-explaining framing every review surface renders for one proposal (plan 31 iter 2): the kind tag,
 * the truthful confidence chip, the model's rationale (empty when it gave none - surfaces then show nothing,
 * never "AI suggested this" filler), and a source chip. Built once here so the inline widget, the review rail
 * and the cross-document cards read identically for the same change. Confidence follows {@link reviewConfidence}
 * (D24-A) so the framing never disagrees with the cross-doc chip that already ships.
 */
export interface IReviewFraming {
	/** 'MEANING CHANGE · needs your call' for a meaning change; 'FIGURE' for a figure. */
	readonly kindLabel: string;
	/** True for a meaning change (attention tokens); false for a figure (ok tokens). */
	readonly kindAttention: boolean;
	readonly confidence: ReviewConfidence;
	/** The confidence chip label (High / Inferred), matching the cross-doc chip glyphs. */
	readonly confidenceLabel: string;
	/** The model's rationale, trimmed; '' when the model supplied none (the surface then omits the line). */
	readonly rationale: string;
	/** 'metrics.csv · line 12' when a real source line is known, else the bare source, else '' (never fabricated). */
	readonly sourceLabel: string;
}

export function reviewFraming(change: Pick<IProposedChange, 'kind' | 'confidence' | 'rationale' | 'sourceLine'>, source: string): IReviewFraming {
	const confidence = reviewConfidence(change);
	const kindAttention = change.kind === 'meaning';
	const src = (source || '').trim();
	const hasLine = typeof change.sourceLine === 'number';
	return {
		kindLabel: kindAttention ? 'MEANING CHANGE · needs your call' : 'FIGURE',
		kindAttention,
		confidence,
		// allow-any-unicode-next-line
		confidenceLabel: confidence === 'high' ? '● High' : '◐ Inferred',
		rationale: (change.rationale || '').trim(),
		sourceLabel: src ? (hasLine ? `${src} · line ${change.sourceLine}` : src) : '',
	};
}

/**
 * Which pending change a single-change keyboard chord acts on (plan 52 A2).
 *
 * A chord has no pointer, so it needs a rule the reader can predict before pressing the key. The rule is
 * "the next one you would reach anyway": the FIRST change still pending for the document, in the order the
 * surfaces already draw them (the inline widgets down the page, the Review cards down the rail). So Accept
 * pressed twice accepts the top two, and the reader never has to guess which of five proposals the key hit.
 *
 * Deliberately NOT "the change nearest the caret": the writing surface is a webview and the caret is often
 * nowhere near a proposal (it can be in the chat composer, or absent entirely after a fan-out), which would
 * make the same key mean different things on different presses. Returns `undefined` for an empty set, which
 * is what makes the chord a safe no-op when there is nothing to accept.
 *
 * Pure so it is unit-tested directly.
 */
export function chordTargetChange<T extends Pick<IProposedChange, 'id'>>(pending: readonly T[]): T | undefined {
	return pending.length ? pending[0] : undefined;
}

// --- the ONE bulk path (docs/30 section 5, invariant I4; issues #334 / #305) ---
//
// A bulk verb is the widest gesture in the product: one click moves work the reviewer will not read again.
// The invariant that makes it safe is structural, not procedural - a bulk verb operates on an IMMUTABLE id
// snapshot captured together with the sentence the user confirmed, and the applied set may only ever SHRINK
// from that snapshot, never grow. Everything below exists to make the alternative impossible to write: there
// is no query-based `approveAll(docId)` for a call site to re-derive a set from at apply time, and the
// eligibility rule lives in exactly one function (`buildBulkSet`) rather than being restated per surface.

/** The two bulk verbs. Comment is not one: it never resolves a change. */
export type BulkVerb = 'approve' | 'reject';

/**
 * Which pending changes one bulk verb addresses.
 *
 * `docId` restricts the capture to a single document (the per-document "Approve all"); omitting it captures
 * the EVERYWHERE shapes - the rail foot, the editor bar's "Approve everywhere", the chat-level verbs - which
 * span the whole working set.
 *
 * `kind` restricts it further to one class of change. Exactly one surface needs this today - the rail's
 * FIGURES card, which groups a document's low-risk value updates into a single decision - and it is a real
 * scope rather than a convenience: without it that card would have to hand-build its own id list, which is
 * how it came to be the one bulk verb in the product carrying its own (implicit, and wrong past ten) confirm
 * rule. A scope is what lets it inherit the policy instead of restating it.
 */
export interface IBulkScope {
	readonly verb: BulkVerb;
	readonly docId?: string;
	readonly kind?: ChangeKind;
}

/**
 * Why some in-scope pending changes were left OUT of a captured set, and how many. Named in the confirm
 * sentence rather than silently dropped (docs/30 section 4.5): "Approve 9 changes? 1 needing attention is
 * not included." A reviewer who is told what is excluded can go and deal with it; one who is not simply
 * believes the rail is empty.
 */
export interface IBulkExclusion {
	readonly reason: 'needs-attention' | 'in-discussion';
	readonly count: number;
}

/**
 * An immutable bulk set: the ids the verb will act on, captured WITH the sentence that describes them.
 *
 * The pairing is the whole point. Because the sentence is derived from the same snapshot that is handed to
 * `approveByIds` / `rejectByIds`, the dialog can never describe a set different from the one that gets
 * applied - which is exactly what #334 was: a confirm counted at click time, an apply re-queried after the
 * user had spent seconds reading it, and any change the agent queued in between silently swept up.
 */
export interface IBulkSet {
	readonly verb: BulkVerb;
	/** The immutable id snapshot, in the order the surfaces already draw the changes. */
	readonly ids: readonly string[];
	/** How many documents the captured ids span. Past one the sentence names it, and the verb always confirms. */
	readonly docCount: number;
	readonly excluded: readonly IBulkExclusion[];
	/** Whether the verb must raise a confirm dialog. Also decides whether its label carries an ellipsis. */
	readonly confirmNeeded: boolean;
	/** The confirm sentence. Empty when no confirm is needed. */
	readonly sentence: string;
	/** Title-style label for the confirm dialog's primary button. */
	readonly primaryButton: string;
}

/** Past this many decisions in one gesture, a bulk verb confirms whatever the set is made of. */
export const BULK_CONFIRM_THRESHOLD = 10;

/**
 * What a bulk verb needs to know about one queued change to judge it. Deliberately structural rather than
 * `IProposedChange` itself: the persisted change store (docs/30 section 5) holds richer records of its own,
 * and must be able to reuse this ONE eligibility rule by projecting onto this shape rather than restating
 * the policy against its own type - which is exactly how the rule came to be stated five different ways.
 */
export type IBulkCandidate = Pick<IProposedChange, 'id' | 'docId' | 'kind' | 'applyFailure'> & {
	/** True when the change is under discussion. A change being talked about is never swept by a bulk verb. */
	readonly hasOpenThread?: boolean;
	/**
	 * True when the change is not pending for a reason `applyFailure` cannot express. The persisted change
	 * store carries four distinct non-pending states, only one of which is an apply failure, so it says so
	 * here rather than restating them all as anchor misses.
	 */
	readonly needsAttention?: boolean;
};

/**
 * Bulk eligibility, in ONE place (docs/30 section 4.5). The change must be genuinely pending, and it must
 * not be under discussion. A change whose approve could not be applied (R2 / invariant I1) stays in the
 * queue flagged `applyFailure` - it is `needs-attention`, not pending, so a bulk verb must not sweep it up.
 * A change with an open comment thread is excluded for the same structural reason (docs/30 section 1.5): a
 * bulk sweep must never resolve something a person is mid-conversation about. Both are NAMED exclusions in
 * the confirm sentence rather than silent drops.
 */
function isBulkEligible(change: Pick<IBulkCandidate, 'applyFailure' | 'hasOpenThread' | 'needsAttention'>): boolean {
	return change.applyFailure === undefined && !change.needsAttention && !change.hasOpenThread;
}

/**
 * Capture a bulk set: filter the pending queue to the scope, drop the ineligible (counting them as named
 * exclusions), and write the confirm sentence for exactly what is left.
 *
 * The confirm policy, coherent across every level (docs/30 sections 4.4 / 4.5):
 *  - REJECT always confirms. Discarding an agent's work is not recoverable from the rail.
 *  - Any EVERYWHERE-scoped verb confirms, including the chat-level ones - a set the reviewer cannot see the
 *    edges of is never one-click.
 *  - Any set spanning more than one document confirms, whatever it is made of.
 *  - Any set larger than {@link BULK_CONFIRM_THRESHOLD} confirms, whatever it is made of.
 *  - Any set containing a `meaning` change confirms (the shipped plan-31 safety net).
 * Which leaves exactly one one-click case: a small, single-document, figures-only approve. The auto-apply
 * class does not deserve friction; everything else does.
 *
 * Pure, so the policy and the sentence are unit-tested directly rather than through a dialog.
 */
export function buildBulkSet(scope: IBulkScope, pending: readonly IBulkCandidate[]): IBulkSet {
	const inDoc = scope.docId === undefined ? pending : pending.filter(c => c.docId === scope.docId);
	const inScope = scope.kind === undefined ? inDoc : inDoc.filter(c => c.kind === scope.kind);
	const eligible = inScope.filter(isBulkEligible);
	const ids = eligible.map(c => c.id);
	const docCount = new Set(eligible.map(c => c.docId)).size;
	const attention = inScope.filter(c => c.applyFailure !== undefined || c.needsAttention).length;
	const discussed = inScope.filter(c => c.applyFailure === undefined && !c.needsAttention && c.hasOpenThread).length;
	const excluded: IBulkExclusion[] = [];
	if (attention > 0) { excluded.push({ reason: 'needs-attention', count: attention }); }
	if (discussed > 0) { excluded.push({ reason: 'in-discussion', count: discussed }); }
	const meaning = eligible.filter(c => c.kind === 'meaning').length;
	const confirmNeeded = ids.length > 0 && (
		scope.verb === 'reject'
		|| scope.docId === undefined
		|| docCount > 1
		|| ids.length > BULK_CONFIRM_THRESHOLD
		|| meaning > 0
	);
	return {
		verb: scope.verb,
		ids,
		docCount,
		excluded,
		confirmNeeded,
		sentence: confirmNeeded ? bulkSentence(scope.verb, ids.length, docCount, excluded) : '',
		primaryButton: scope.verb === 'approve'
			? localize('livingDocs.bulk.approveButton', "Approve All")
			: localize('livingDocs.bulk.rejectButton', "Reject All"),
	};
}

/**
 * The confirm sentence: what is being decided, what is being left out, and what the reviewer can do
 * afterwards. Counts trade in ONE currency - decisions (docs/30 section 4.4) - so the number in the sentence
 * is the number of ids in the set, never a group count or a block count.
 */
function bulkSentence(verb: BulkVerb, count: number, docCount: number, excluded: readonly IBulkExclusion[]): string {
	const parts: string[] = [];
	if (verb === 'approve') {
		parts.push(docCount > 1
			? localize('livingDocs.bulk.approveAcross', "Approve {0} changes across {1} documents?", count, docCount)
			: count === 1
				? localize('livingDocs.bulk.approveOne', "Approve 1 change?")
				: localize('livingDocs.bulk.approveMany', "Approve {0} changes?", count));
	} else {
		parts.push(docCount > 1
			? localize('livingDocs.bulk.rejectAcross', "Reject {0} changes across {1} documents?", count, docCount)
			: count === 1
				? localize('livingDocs.bulk.rejectOne', "Reject 1 change?")
				: localize('livingDocs.bulk.rejectMany', "Reject {0} changes?", count));
	}
	for (const exclusion of excluded) {
		if (exclusion.reason === 'in-discussion') {
			parts.push(exclusion.count === 1
				? localize('livingDocs.bulk.discussedOne', "1 change you are discussing is not included.")
				: localize('livingDocs.bulk.discussedMany', "{0} changes you are discussing are not included.", exclusion.count));
			continue;
		}
		parts.push(exclusion.count === 1
			? localize('livingDocs.bulk.excludedOne', "1 change needing attention is not included.")
			: localize('livingDocs.bulk.excludedMany', "{0} changes needing attention are not included.", exclusion.count));
	}
	// Both tails are promises the engine keeps: `approveByIds` snapshots every affected document before the
	// batch (plan 26), and a reject never touches a document body.
	parts.push(verb === 'approve'
		? localize('livingDocs.bulk.approveTail', "A version snapshot is taken first, so you can restore.")
		: localize('livingDocs.bulk.rejectTail', "The documents are left unchanged."));
	return parts.join(' ');
}

/**
 * The in-surface label for a bulk verb. The trailing ellipsis is not decoration: it is the promise that a
 * dialog follows, so it appears if and only if this exact set would raise one. Deriving it from the same
 * captured set that drives the click is what keeps the promise honest as the queue changes underneath.
 */
export function bulkVerbLabel(set: Pick<IBulkSet, 'verb' | 'confirmNeeded' | 'ids'>): string {
	if (set.verb === 'approve') {
		return set.confirmNeeded
			? localize('livingDocs.bulk.approveLabelConfirm', "Approve all {0}…", set.ids.length)
			: localize('livingDocs.bulk.approveLabel', "Approve all {0}", set.ids.length);
	}
	return set.confirmNeeded
		? localize('livingDocs.bulk.rejectLabelConfirm', "Reject all…")
		: localize('livingDocs.bulk.rejectLabel', "Reject all");
}

/** Why one captured id was NOT acted on. Applied sets shrink for exactly these three reasons and no others. */
export type BulkSkipReason =
	/** It left the queue between capture and apply - someone decided it, or a restore cleared it. */
	| 'decided-elsewhere'
	/** It is in the queue but no longer eligible (a failed apply flipped it to needs-attention). */
	| 'needs-attention'
	/** The apply itself did not land (invariant I1): the document had moved on under the change. */
	| 'apply-failed';

/** One captured id the bulk verb did not act on, named so the reviewer sees what was left behind. */
export interface IBulkSkip {
	readonly id: string;
	/** Human address ("Weekly Update - Commentary"), or empty when the change had already left the queue. */
	readonly label: string;
	readonly reason: BulkSkipReason;
}

/**
 * The closed result of a bulk apply (the bulk sibling of R2's per-change apply result). `applied.length +
 * skipped.length === captured` always holds, which is the machine-checkable form of "the applied set may
 * shrink, never grow".
 */
export interface IBulkApplyResult {
	readonly verb: BulkVerb;
	readonly captured: number;
	readonly applied: readonly string[];
	readonly skipped: readonly IBulkSkip[];
}

/** The human address of a change, for a skip report the reviewer can act on. */
export function bulkChangeLabel(change: Pick<IProposedChange, 'docTitle' | 'blockLabel'>): string {
	return localize('livingDocs.bulk.changeLabel', "{0} - {1}", change.docTitle, change.blockLabel);
}

/**
 * The plain-words report for a bulk apply that shrank. Empty when nothing was skipped - silence is the
 * correct output for a bulk verb that did exactly what its sentence said.
 */
export function describeBulkSkips(result: IBulkApplyResult): string {
	if (!result.skipped.length) { return ''; }
	const head = result.skipped.length === 1
		? localize('livingDocs.bulk.skippedOne', "1 of {0} changes was not applied.", result.captured)
		: localize('livingDocs.bulk.skippedMany', "{0} of {1} changes were not applied.", result.skipped.length, result.captured);
	const named = result.skipped.filter(s => s.label).map(s => s.label);
	return named.length ? `${head} ${localize('livingDocs.bulk.skippedNames', "Still waiting on you: {0}.", named.join(', '))}` : head;
}

/**
 * One document group in the cross-document review doc-nav rail (plan 24, C5). Groups the pending changes
 * by their document, preserving first-appearance order, and carries the count so the rail header
 * (`N docs . M changes`), the progress bar and each doc row derive from one pass over the real pending set.
 * Pure so it can be unit-tested directly and reused by the screen renderer.
 */
export interface IReviewDocGroup {
	readonly docId: string;
	readonly docTitle: string;
	readonly changes: readonly IProposedChange[];
}

export function groupPendingByDoc(pending: readonly IProposedChange[]): IReviewDocGroup[] {
	const order: string[] = [];
	const groups = new Map<string, { docTitle: string; changes: IProposedChange[] }>();
	for (const c of pending) {
		let group = groups.get(c.docId);
		if (!group) {
			group = { docTitle: c.docTitle, changes: [] };
			groups.set(c.docId, group);
			order.push(c.docId);
		}
		group.changes.push(c);
	}
	return order.map(docId => {
		const g = groups.get(docId)!;
		return { docId, docTitle: g.docTitle, changes: g.changes };
	});
}

export interface IReviewedDoc {
	readonly docId: string;
	readonly title: string;
}

/**
 * The documents reviewed THIS session (cross-document review, C5, plan 24): a document that was seen with
 * pending changes and now has none. `seen` is the running map of every doc id -> human title that has
 * carried a pending change while the review screen was open (the editor records the title at first sight
 * so the reviewed row shows the human title, not the raw docId URI). `pendingDocIds` is the set of doc ids
 * that still have pending changes right now. A seen doc no longer pending is reviewed. Ordered by the
 * insertion order of `seen` so the reviewed list is stable across re-renders. Pure so it can be
 * unit-tested and reused by the screen renderer.
 */
export function reviewedDocsFromSeen(seen: ReadonlyMap<string, string>, pendingDocIds: ReadonlySet<string>): IReviewedDoc[] {
	const reviewed: IReviewedDoc[] = [];
	for (const [docId, title] of seen) {
		if (!pendingDocIds.has(docId)) { reviewed.push({ docId, title }); }
	}
	return reviewed;
}

export interface IAuditEntry {
	readonly time: string;
	readonly docTitle: string;
	readonly blockId: string;
	// 'external-overwrite-kept' records that the file changed on disk outside Abstract while the document was
	// open and the reviewer chose "Keep my version", so the next persist knowingly overwrote the external edit
	// (issue #133, the external-edit floor). The decision is on the record like any other applied change.
	// 'apply-failed' records an approval that could NOT be applied because the document had moved on since the
	// proposal (docs/30 invariant I1, issue #329). It is the row that used to be written as 'approved' over a
	// document nothing had happened to; NOTHING was written to the file, and the change is still pending.
	readonly action: 'auto-applied' | 'approved' | 'rejected' | 'external-overwrite-kept' | 'apply-failed';
	readonly oldText: string;
	readonly newText: string;
	// 'restore' records a snapshot restore: the body was replaced with an earlier saved version through
	// the one approve path, so the change is on the record like any other applied edit (plan 26 iter 2).
	// 'tweaked' records that the reviewer hand-edited the agent's proposed text before approving (plan 31
	// iter 3, D31-B): the applied `newText` is the human's amendment, not the agent's original.
	// 'override' records that the user exported/published a document PAST a failed before-export gate (plan 32
	// iter 4): the gate is never a silent block and never a silent override - the override is on the record.
	readonly via: 'model' | 'heuristic' | 'api' | 'restore' | 'tweaked' | 'override';
	// The reviewer's optional plain-words reason for a rejection (1f frame-3: "the optional reason becomes
	// context for the next derivation"). Recorded on the audit row so it survives relaunch and shows in
	// History. On an 'apply-failed' row it carries the named reason the apply could not land (I1) rather than
	// a human's note; absent on the other actions.
	reason?: string;
	// A "this was wrong" flag against an APPLIED change (doc 18 section 2.5). Written here so the flag survives
	// relaunch and the History row renders flagged (not an infinitely re-flaggable button). The analytics event
	// and founder log are fired separately by reportChangeWrong; only the flag state lives on the row. `at` is
	// the ISO time the flag was raised; `comment` keeps the reviewer's optional note for the on-disk record.
	wrong?: { at: string; comment?: string };
}
