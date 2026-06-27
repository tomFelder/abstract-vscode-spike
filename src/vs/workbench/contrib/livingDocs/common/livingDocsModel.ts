/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
}

export function emptyLock(): ILivingDocLock {
	return { version: LOCK_VERSION, bindings: {}, context: {}, claims: {}, pins: [], audit: [], contextItems: [] };
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
	readonly trigger: IAgentTrigger;
	readonly flow: IAgentFlow;
	readonly policy: AgentPolicy;
	lastRun?: string;
	status: AgentStatus;
}

// One execution of an agent, recorded for the History/observability trace.
export interface IAgentRun {
	readonly agentId: string;
	readonly startedAt: string;
	finishedAt?: string;
	applied: number;        // figures auto-applied
	queued: number;         // candidates queued in the review rail
	blocked?: string;       // the grader flag if the verify gate stopped the run
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
}

export interface IAuditEntry {
	readonly time: string;
	readonly docTitle: string;
	readonly blockId: string;
	readonly action: 'auto-applied' | 'approved' | 'rejected';
	readonly oldText: string;
	readonly newText: string;
	readonly via: 'model' | 'heuristic' | 'api';
}
