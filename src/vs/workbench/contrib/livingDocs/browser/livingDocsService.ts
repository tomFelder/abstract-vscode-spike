/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { Limiter } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { asJson, asText, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IChatGptSignInStatus, IChatMessage, IChatStep, IFanoutProgress, IFigureChange, ILivingDocsService, ILivingDocSummary, IModelProviderStatus, IOnboardingSurvey, ISkillCheck, ISourceInfo, ISourcePayload, ISourcePeek, ISourcePeekRow, ISourceUsage, ITemplateInfo, IWorkingSetDoc, IWorkspaceFile, LivingDocsPanelTab, ModelProvider, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { applyBlockEdit, buildTemplateSkeleton, composeTemplateInstruction, extractBindLinks, extractStreamingReply, findQuoteLine, listItems, parseChatResponse, parseLivingDoc, parseMultiChatResponse, reconcileBindLinks, scopeBlockEdit, serializeLivingDoc, titleForDocument, withFrontmatterList } from '../common/livingDocMarkdown.js';
import { estimateTokens, IFanoutDoc, planFanoutBatches } from '../common/fanoutBudget.js';
import { parseSseChunk } from '../common/livingDocSse.js';
import { renderExportHtml, renderExportMarkdown } from './livingDocRender.js';
import { ILockStore, SidecarLockStore } from './livingDocLockStore.js';
import { AgentOrchestrator, IAgentRunContext, IAgentRunResult } from './agentOrchestrator.js';
import { IClock, RealClock } from './clock.js';
import { WorkspaceAgentStore } from './agentStore.js';
import { AddedContextKind, AgentPolicy, DEFAULT_DOC_POLICY, emptyLock, IAddedContext, IAgentDef, IAgentRun, IAgentTrigger, IAuditEntry, IBindingEntry, IFreshness, ILivingDoc, ILivingDocBlock, ILivingDocLock, IProposedChange, ISkillRunDocResult, ISkillRunSummary, ISnapshotEntry, SNAPSHOT_CAP, SkillRunDocStatus, SnapshotVia, SourceKind, summariseSkillRun } from '../common/livingDocsModel.js';
import { buildSourceGrid } from '../common/sourceGrid.js';
import { projectDisplayName } from '../common/projectDisplayName.js';

// The verdict from one Skill acting as a grader in the verify gate (maker != checker, spec 5).
interface IGradeResult {
	readonly pass: boolean;
	readonly flag?: string;
}

// One freshly-read source value for a bind key, before it is written into the lock.
interface IResolution {
	readonly value: string;
	readonly sourceHash: string;
	readonly source: string;        // human-ish origin, e.g. "metrics.csv#mrr"
}

// A single refresh/agent pass over many documents (plan 30, tracks 1 + 2). It caches each source read
// for the LIFETIME OF THE PASS so a CSV bound by 20 documents is read once, not 20 times, and a remote
// resolution shared across documents runs once. `fileBodies` caches raw file text by its absolute URI
// string; `resolutions` caches a source's resolved bind-key map by the source's frontmatter identity.
// Created per pass by the refresh/agent entry points and discarded when the pass ends (never long-lived),
// so it can never serve a stale value across passes - it only collapses duplicate reads WITHIN one pass.
// The caches store the in-flight PROMISE, not the resolved value, so concurrent documents that read the
// same shared source within one pass await a single read rather than racing to launch N identical reads.
interface IRefreshPass {
	readonly fileBodies: Map<string, Promise<string>>;
	readonly resolutions: Map<string, Promise<Map<string, IResolution>>>;
}

function newRefreshPass(): IRefreshPass {
	return { fileBodies: new Map(), resolutions: new Map() };
}

// Everything we hold for one open or discovered document.
interface IDocState {
	readonly uri: URI;
	doc: ILivingDoc;
	rawText: string;
	lock: ILivingDocLock;           // the source of truth for resolved values + freshness
	recent: Set<string>;            // block ids changed in the last refresh (for the highlight)
	staleBindings: Set<string>;     // dirty bits: bind keys whose source changed since last sync
	staleContext: Set<string>;      // dirty bits: context files changed since last review
	status: string;
	folderFiles: readonly string[]; // real md/csv/json siblings in the doc's folder (for @mention + pickers)
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
const pct = (a: number, b: number) => `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%`;

// A tiny, order-independent string hash (FNV-1a) for cheap source-change detection. Not crypto.
function hashString(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

// Classify a frontmatter source string into a source kind for the home-row chips.
function sourceKind(source: string): SourceKind {
	return /^https?:\/\//.test(source) ? 'api' : 'file';
}

// An `api` frontmatter source may name a proxy-side secret so an authenticated endpoint resolves without the
// credential ever reaching the renderer (plan 29, iter 4, D29-C): `https://crm.example.com/data auth=crm-token`.
// The URL is the source identity (label/hash); `auth` (when present) is only the secret NAME - the value lives
// in the proxy. Splitting is done here so the rest of the service (and the Knowledge registry) sees a clean URL.
function parseApiSpec(source: string): { url: string; auth?: string } {
	const m = /^(.*?)\s+auth=(\S+)\s*$/.exec(source);
	return m ? { url: m[1].trim(), auth: m[2] } : { url: source.trim() };
}

// An inline `mcp` binding is a bind key of the shape `<name>@mcp:<server>.<tool>/<field>` (D29-B), e.g.
// `pipeline@mcp:demo.query/total`. Parse the server/tool/field so the proxy can spawn the server and call the
// tool; a key without the `@mcp:` marker is a plain file/api binding and returns undefined (resolved as before).
function parseMcpKey(key: string): { server: string; tool: string; field: string } | undefined {
	const at = key.indexOf('@mcp:');
	if (at < 0) { return undefined; }
	const spec = key.slice(at + '@mcp:'.length);
	const slash = spec.indexOf('/');
	const target = slash >= 0 ? spec.slice(0, slash) : spec;
	const field = slash >= 0 ? spec.slice(slash + 1) : '';
	const dot = target.indexOf('.');
	if (dot < 0) { return undefined; }
	return { server: target.slice(0, dot), tool: target.slice(dot + 1), field };
}

// The single freshness compare (spec 3.4), shared by the per-document dirty-bit recompute and the source
// registry projection (plan 29, iter 1): a resolved source value is fresh when its current hash still
// matches the hash the lock recorded at last sync. A value we can no longer resolve (undefined) is not
// counted stale here - the caller decides how an unreadable source is presented.
function bindingIsFresh(current: IResolution | undefined, entry: IBindingEntry): boolean {
	return !current || current.sourceHash === entry.sourceHash;
}

// Model-backed features (Review-impact rewrites, the Strategy grader, chat) call the model through a local
// proxy (scripts/lwd-anthropic-proxy.js) so no credential ever reaches the renderer (decision 14). The
// proxy authenticates against a pluggable backend (plan 35: the founder-funded OpenRouter fallback now, the
// user's own ChatGPT subscription via OpenAI OAuth next) and speaks the Anthropic Messages shape back, so
// the renderer/service are backend-agnostic. These are the request defaults; the base URL is configurable
// via livingDocs.modelProxyUrl.
const DEFAULT_PROXY_URL = 'http://localhost:8090';
const DEFAULT_MODEL = 'claude-opus-4-8';
const MODEL_MAX_TOKENS = 1024;

// The plain-words message the proxy returns when the day's included usage is spent on the founder-funded
// fallback (plan 35 iter 3; doc 18 section 2.1). Used as the fallback default when the proxy omits its own
// prose, so the renderer always shows honest words (P5) rather than an error.
const INCLUDED_USAGE_SPENT_MESSAGE = "You've used today's included usage - picks up tomorrow, or sign in with ChatGPT for unlimited.";

// A model call that the proxy paused because the day's included usage is spent (stop_reason "pause"). It is
// NOT a failure: the caller keeps any prose the proxy returned (the plain-words cap message), queues no
// proposals, and - inside an agent run - pauses the run via D15 with proposals kept, resuming at day rollover.
class ModelPausedError extends Error {
	constructor(message: string) {
		super(message || INCLUDED_USAGE_SPENT_MESSAGE);
		this.name = 'ModelPausedError';
	}
}
function isModelPausedError(e: unknown): e is ModelPausedError {
	return e instanceof ModelPausedError;
}
// How long a model-availability probe result is trusted before re-checking (so starting the proxy
// mid-session is picked up without re-probing on every render).
const MODEL_PROBE_TTL_MS = 30_000;

// Bounded concurrency (plan 30, track 2, D30-A): how many source fetches and model calls may be in
// flight at once within a refresh/agent run. Local file reads are cheap and stay unlimited (they hit the
// per-pass cache); the limits protect the network/model, which is where the real cost and the rate limit
// live. A per-host cooldown suppresses an identical remote fetch repeated within the window (unauthenticated
// GitHub is 60 req/h/IP - a per-source cooldown is correctness, not polish; doc 04).
const SOURCE_FETCH_CONCURRENCY = 4;
const MODEL_CALL_CONCURRENCY = 2;
const SOURCE_COOLDOWN_MS = 30_000;

// The alias a bind key uses for a source file: "metrics.csv" -> "metrics", "market-research.md" ->
// "market-research". Bind keys are "<alias>.<field>" (with an optional ".<qualifier>").
function sourceAlias(source: string): string {
	const name = source.split('/').pop() ?? source;
	return name.replace(/\.[^.]+$/, '');
}

// The human display label for a source in the Knowledge registry (plan 29): a file source shows its name
// (already the frontmatter value, e.g. "metrics.csv"); an api source shows its host (e.g. "api.example.com"),
// falling back to the raw URL when it does not parse.
function sourceLabel(id: string, kind: SourceKind): string {
	if (kind !== 'api') { return id; }
	try { return new URL(id).host || id; } catch { return id; }
}

function tokenize(s: string): string[] {
	return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// Token-overlap (Jaccard) similarity of two strings, 0..1. Used to relocate a prose claim against the
// current text - deterministic, no model. 1 = identical token sets, 0 = nothing in common.
function similarity(a: string, b: string): number {
	const ta = new Set(tokenize(a));
	const tb = new Set(tokenize(b));
	if (ta.size === 0 || tb.size === 0) { return 0; }
	let inter = 0;
	for (const t of ta) { if (tb.has(t)) { inter++; } }
	return inter / (ta.size + tb.size - inter);
}

// The "New document" starting point (plan 16 iter 3, decision 56): a BLANK writing surface, not an
// IDE boilerplate template. A new doc is clean Markdown the user owns -- no injected `title:`
// frontmatter and no "## Overview / Write your document here" placeholder, so opening it reads as
// "just start writing" (the editor focuses the first line on mount). It becomes a Living Document the
// moment a source is connected (a `sources:`/`context:` entry or a bind link). A single trailing
// newline (not a 0-byte file) gives ProseMirror one empty paragraph to land the caret in.
const NEW_DOCUMENT_TEMPLATE = `\n`;

// The seed content for New Template (plan 28, iter 2). A template is honest Markdown: `template: true`
// frontmatter plus a human name/description, a declared source, and a body showing the two authoring
// devices - a `{{slot:hint}}` the model fills from the sources at generation time, and a `bind:` link
// that copies through verbatim so a generated document is born bound. HTML-comment lines explain each
// device without appearing in the generated draft (the skeleton strips them). Australian English.
const NEW_TEMPLATE_TEMPLATE = [
	'---',
	'template: true',
	'name: Untitled Template',
	'description: Describe what this template produces and when to use it.',
	'sources:',
	'  - metrics.csv',
	'---',
	'',
	'# {{slot:document title}}',
	'',
	'<!-- A {{slot:hint}} is filled from the sources when a draft is generated. -->',
	'',
	'## Summary',
	'',
	'<!-- Write the instruction for this section as prose; the model reads it as the brief. -->',
	'Summarise the latest figures and call out anything notable this period.',
	'',
	'## Numbers',
	'',
	'<!-- A bind: link copies through verbatim, so the generated document is born bound to its source. -->',
	'MRR is [pending](bind:metrics.mrr) on [pending](bind:metrics.signups) new signups.',
	'',
].join('\n');


export class LivingDocsService extends Disposable implements ILivingDocsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidRequestPanel = this._register(new Emitter<LivingDocsPanelTab>());
	readonly onDidRequestPanel: Event<LivingDocsPanelTab> = this._onDidRequestPanel.event;

	// Fires per delta / tool step while a chat reply streams (plan 27 iter 3), so the rail appends to the
	// live turn without a full re-render (preserving the composer caret + scroll). Carries the document URI.
	private readonly _onDidStreamChat = this._register(new Emitter<URI>());
	readonly onDidStreamChat: Event<URI> = this._onDidStreamChat.event;

	private readonly _onDidRequestFocusChange = this._register(new Emitter<{ docId: string; changeId: string }>());
	readonly onDidRequestFocusChange: Event<{ docId: string; changeId: string }> = this._onDidRequestFocusChange.event;

	private readonly _docs = new Map<string, IDocState>();
	// Raw source text by `${docUri}::${source}`, cached during resolution so getSourcePeek (sync) can
	// build the comp's raw CSV grid for the in-surface source-peek pane.
	private readonly _rawSourceCache = new Map<string, string>();
	// The raw response payload per resolved non-file bind key (plan 29, iter 4): the MCP tool result or the
	// api JSON, cached during resolution so source-peek can show the real payload with the extracted field
	// highlighted (closing the "provenance falls back to the CSV" gap for api/mcp kinds).
	private readonly _payloadRawCache = new Map<string, string>();
	private _pending: IProposedChange[] = [];
	private readonly _lockStore: ILockStore;
	// The orchestration engine: agent registry + dependency-graph event-bus (+ triggers/policy/verify).
	private readonly _orchestrator: AgentOrchestrator;
	// Correlated source watchers, one store per loaded document. Disposed/recreated on reload, and
	// all torn down when the service is disposed.
	private readonly _watchers = new Map<string, IDisposable>();

	// Cached "is the model proxy reachable?" so the synchronous Skills report can show the right
	// Strategy state; refreshed on a short TTL and reused while a probe is in flight.
	private _modelAvailable = false;
	private _modelProbedAt = 0;
	private _modelProbe: Promise<boolean> | undefined;
	// The latest model-backed Strategy verdict per document, surfaced in the Skills rail after a Run.
	private readonly _strategyGrades = new Map<string, IGradeResult>();
	// The Chat conversation per document (the right-panel Chat tab) and the in-flight set for the
	// "working" indicator. Kept in the service so the rail survives re-renders and tab switches.
	private readonly _chats = new Map<string, IChatMessage[]>();
	private readonly _chatBusy = new Set<string>();
	// The cancellation source for each document's in-flight streaming reply (plan 27), keyed like _chats.
	// Present only while a reply streams; cancelChat cancels it, sendChatMessage disposes it in its finally.
	private readonly _chatCancellers = new Map<string, CancellationTokenSource>();
	// The in-flight streaming turn per document (plan 27 iter 3): the prose accumulated so far + the tool
	// steps as they settle, so the rail can render a live assistant turn and the salvage on cancel reads it.
	// Present only while a reply streams (set at the start of _deliverChatReply, cleared in its finally).
	private readonly _chatStreaming = new Map<string, { text: string; steps: IChatStep[] }>();
	// The chat's working set (plan 18): the documents one instruction fans out across, keyed by the
	// active document the chat belongs to (mirrors the per-document _chats keying). Empty by default,
	// so with no set added the chat stays single-doc (decision 61).
	private readonly _workingSets = new Map<string, IWorkingSetDoc[]>();
	// The live batch progress of each document's whole-project fan-out (plan 30, track 3, D30-B): which
	// batch of how many is running, and which docs were too large for the budget. Keyed like _chats. Set as
	// the fan-out packs + runs, cleared with the streaming turn in _deliverChatReply's finally.
	private readonly _fanoutProgress = new Map<string, IFanoutProgress>();
	// The figure diff from each document's last "Sync across", for the editor's synced banner.
	private readonly _lastSyncDiff = new Map<string, IFigureChange[]>();

	// Bounded concurrency for a refresh/agent run (plan 30, track 2, D30-A). The source limiter caps
	// concurrent REMOTE (api/mcp) fetches; the model limiter caps concurrent model calls. Both are created
	// once and reused across runs; disposed with the service. Local file reads bypass them (cheap + cached).
	private readonly _sourceLimiter = this._register(new Limiter<Map<string, IResolution>>(SOURCE_FETCH_CONCURRENCY));
	private readonly _modelLimiter = this._register(new Limiter<string>(MODEL_CALL_CONCURRENCY));
	// Per-host cooldown: the last time (clock ms) we fetched each remote host, so an identical fetch within
	// SOURCE_COOLDOWN_MS is suppressed (the last resolved value is reused). Keyed by host, workspace-wide.
	private readonly _hostCooldown = new Map<string, number>();
	// The clock behind the per-host cooldown (plan 30 uses the IClock seam for deterministic tests). A
	// RealClock in production; tests swap a fake clock via {@link setClock} right after construction so the
	// cooldown window can be advanced deterministically. Not a DI service (the orchestrator's clock is the
	// same plain seam), so it stays off the constructor to keep the service's DI signature clean.
	private _clock: IClock = new RealClock();

	// (plan 33 iter 2, L5) The contents of the folder's `.abstract-name` marker, if it ships one. Read once
	// at startup + on folder change and cached so `getWorkspaceFolderName()` can stay synchronous. Only ever
	// used to override a web/memfs mount-stub folder label ("mount"/"static"); a real folder shows its real
	// basename. `undefined` = not read yet / no marker.
	private _projectNameMarker: string | undefined;

	constructor(
		@IFileService private readonly _files: IFileService,
		@IEditorService private readonly _editors: IEditorService,
		@IViewsService private readonly _views: IViewsService,
		@IConfigurationService private readonly _config: IConfigurationService,
		@INotificationService private readonly _notify: INotificationService,
		@ILogService private readonly _log: ILogService,
		@IRequestService private readonly _request: IRequestService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IFileDialogService private readonly _fileDialog: IFileDialogService,
		@IHostService private readonly _host: IHostService,
	) {
		super();
		this._lockStore = new SidecarLockStore(this._files);
		const folder = this._workspace.getWorkspace().folders[0]?.uri ?? URI.file('/');
		this._orchestrator = this._register(new AgentOrchestrator(
			this._files, this._log, new WorkspaceAgentStore(this._files, folder), () => this._discoverLivingDocUris()));
		// Surface orchestration state changes (dirty queue, agent status) through the service event.
		this._register(this._orchestrator.onDidChange(() => this._onDidChange.fire()));
		this._orchestrator.setRunner((agent, context) => this._runAgent(agent, context));
		void this._orchestrator.ensureLoaded().then(() => this._orchestrator.start());
		this._register(toDisposable(() => {
			for (const w of this._watchers.values()) { w.dispose(); }
			this._watchers.clear();
		}));
		// Probe the model proxy once at startup so the Skills rail reflects model availability without
		// waiting for the first model call. Failures are swallowed (the no-model fallback stays intact).
		void this._probeModel();
		// (plan 33 iter 2, L5) Read the folder's `.abstract-name` marker once at startup + whenever the open
		// folder changes, so the project name resolves truthfully even under the web/memfs "mount" label.
		void this._readProjectNameMarker();
		this._register(this._workspace.onDidChangeWorkspaceFolders(() => void this._readProjectNameMarker()));
		// (debt: sample root mount) In the web build the workspace folder's file-system provider (memfs /
		// vscode-test-web) can register AFTER this service constructs. The startup read above then fails with
		// no-provider, and because `onDidChangeWorkspaceFolders` never fires for a folder that was already
		// open at startup, the marker would never be retried - stranding the sample ROOT on its "mount" stub
		// (and the first documents scan on "0 docs"). Re-read once the folder's provider becomes available so
		// the root resolves its `.abstract-name` truthfully; the read's `onDidChange` also refreshes the Home
		// document list, so a scan that raced the provider is retried too.
		this._register(this._files.onDidChangeFileSystemProviderRegistrations(e => {
			const folder = this._workspace.getWorkspace().folders[0]?.uri;
			if (folder && e.added && e.scheme === folder.scheme) {
				void this._readProjectNameMarker();
			}
		}));
	}

	// Read the `.abstract-name` marker in the open folder, if any, into the cache. A missing/unreadable
	// marker leaves the cache undefined (the folder then shows its real name/basename - never fabricated).
	private async _readProjectNameMarker(): Promise<void> {
		const folder = this._workspace.getWorkspace().folders[0]?.uri;
		if (!folder) { this._projectNameMarker = undefined; return; }
		try {
			const content = (await this._files.readFile(joinPath(folder, '.abstract-name'))).value.toString();
			this._projectNameMarker = content;
		} catch {
			this._projectNameMarker = undefined;
		}
		// A late marker read should refresh any open Home/crumb.
		this._onDidChange.fire();
	}

	/** The orchestration engine (agent registry, graph event-bus, triggers, policy, verify gate). */
	get orchestrator(): AgentOrchestrator { return this._orchestrator; }

	getAgents(): readonly IAgentDef[] { return this._orchestrator.getAgents(); }
	getAgentRuns(): readonly IAgentRun[] { return this._orchestrator.getRuns(); }
	getAgentRunsForAgent(agentId: string): readonly IAgentRun[] { return this._orchestrator.getRunsForAgent(agentId); }
	getLatestAgentFailure(): IAgentRun | undefined { return this._orchestrator.getLatestFailure(); }

	// Agents-screen detail drawer registry edits (plan 32 iter 3): thin pass-throughs to the orchestrator,
	// which persists to `agents.json` and fires onDidChange so the screen re-renders.
	async createAgent(): Promise<void> { await this._orchestrator.createAgent(); }
	async duplicateAgent(agentId: string): Promise<void> { await this._orchestrator.duplicateAgent(agentId); }
	async setAgentDisabled(agentId: string, disabled: boolean): Promise<void> { await this._orchestrator.setAgentDisabled(agentId, disabled); }
	async setAgentPolicy(agentId: string, policy: AgentPolicy): Promise<void> { await this._orchestrator.setAgentPolicy(agentId, policy); }
	async setAgentTrigger(agentId: string, trigger: IAgentTrigger): Promise<void> { await this._orchestrator.setAgentTrigger(agentId, trigger); }

	// --- per-document views ---

	getDoc(resource: URI): ILivingDoc | undefined { return this._docs.get(resource.toString())?.doc; }
	getRawText(resource: URI): string { return this._docs.get(resource.toString())?.rawText ?? ''; }
	getStatus(resource: URI): string { return this._docs.get(resource.toString())?.status ?? 'No document'; }
	getRecentlyApplied(resource: URI): ReadonlySet<string> { return this._docs.get(resource.toString())?.recent ?? new Set<string>(); }
	getResolved(resource: URI): ReadonlyMap<string, string> {
		// The lock is the source of truth for resolved values.
		const out = new Map<string, string>();
		const state = this._docs.get(resource.toString());
		if (state) { for (const key of Object.keys(state.lock.bindings)) { out.set(key, state.lock.bindings[key].resolved); } }
		return out;
	}
	getLock(resource: URI): ILivingDocLock | undefined { return this._docs.get(resource.toString())?.lock; }

	// The per-document autonomy policy (1g, walk F11): the human-dialled setting stored in the lock. Absent =
	// the "auto-figures" default (figures auto-apply, meaning-changes wait). Reuses the AgentPolicy vocabulary
	// so the doc-header dial and the Agents policy control are one control, not two (P2).
	getDocPolicy(resource: URI): AgentPolicy { return this._docs.get(resource.toString())?.lock.policy ?? DEFAULT_DOC_POLICY; }

	async setDocPolicy(resource: URI, policy: AgentPolicy): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		state.lock.policy = policy;
		// Persist to the lock so the choice survives a reload and travels with the file (couples to 1d rename).
		await this._lockStore.write(state.uri, state.lock);
		this._onDidChange.fire();
	}

	getFreshness(resource: URI): IFreshness {
		const state = this._docs.get(resource.toString());
		const staleBindings = state ? [...state.staleBindings] : [];
		const staleContext = state ? [...state.staleContext] : [];
		return { staleBindings, staleContext, dirty: staleBindings.length > 0 || staleContext.length > 0 };
	}
	getPendingForDoc(resource: URI): readonly IProposedChange[] {
		const id = resource.toString();
		return this._pending.filter(c => c.docId === id);
	}

	// Run the document's Skills as deterministic graders over its current state (spec 5). Financial =
	// every bound figure resolves to a source value; Formatting = headings follow title-case house
	// style; Strategy needs a model so it reports a needs-model state in the model-less build.
	getSkillReport(resource: URI): readonly ISkillCheck[] {
		const state = this._docs.get(resource.toString());
		if (!state || !state.doc.isLiving) { return []; }
		const resolved = this.getResolved(resource);

		const keys = new Set<string>();
		for (const block of state.doc.blocks) { for (const link of block.binds) { keys.add(link.key); } }
		const total = keys.size;
		const unresolved = [...keys].filter(k => !resolved.has(k));
		const financial: ISkillCheck = unresolved.length === 0
			? { id: 'financial', name: 'Financial agent', blurb: 'Validates figures in reports & quotes', status: 'pass', detail: `All ${total} linked figure${total === 1 ? '' : 's'} reconcile with sources.`, canRun: true }
			: { id: 'financial', name: 'Financial agent', blurb: 'Validates figures in reports & quotes', status: 'flag', detail: `${unresolved.length} of ${total} figures do not reconcile: ${unresolved.join(', ')}.`, canRun: true };

		const fixes = state.doc.blocks.filter(b => b.type === 'heading' && (b.level ?? 0) >= 2 && !LivingDocsService._isTitleCase(b.text)).length;
		const formatting: ISkillCheck = fixes === 0
			? { id: 'formatting', name: 'Formatting agent', blurb: 'Checks house style before export', status: 'pass', detail: 'All headings follow house style.', canRun: true }
			: { id: 'formatting', name: 'Formatting agent', blurb: 'Checks house style before export', status: 'flag', detail: `${fixes} heading-case fix${fixes === 1 ? '' : 'es'} suggested.`, canRun: true, fixable: true };

		// Strategy is model-backed: NO MODEL when the proxy is unreachable; otherwise READY until run,
		// then the cached PASS/FLAG verdict from runSkillCheck.
		const blurb = 'Tests claims against strategy & OKRs';
		const grade = this._strategyGrades.get(resource.toString());
		let strategy: ISkillCheck;
		if (!this._modelAvailable) {
			strategy = { id: 'strategy', name: 'Strategy agent', blurb, status: 'needs-model', detail: 'Connect a model to test claims against the decision stack.', canRun: false };
		} else if (!grade) {
			strategy = { id: 'strategy', name: 'Strategy agent', blurb, status: 'ready', detail: 'Run to test this document\'s claims against the decision stack.', canRun: true };
		} else if (grade.pass) {
			strategy = { id: 'strategy', name: 'Strategy agent', blurb, status: 'pass', detail: 'Claims are consistent with the decision stack.', canRun: true };
		} else {
			strategy = { id: 'strategy', name: 'Strategy agent', blurb, status: 'flag', detail: grade.flag ?? 'A claim conflicts with the decision stack.', canRun: true };
		}

		return [strategy, financial, formatting];
	}

	// Run a Skill on demand from the rail. The model-backed Strategy grader runs against the document's
	// claims + decision stack and caches its verdict; Financial/Formatting are deterministic and simply
	// recompute on the next render (the fired event triggers it).
	async runSkillCheck(resource: URI, id: ISkillCheck['id']): Promise<void> {
		if (id === 'strategy') {
			const state = this._docs.get(resource.toString());
			if (state) {
				try {
					const grade = await this._gradeStrategy(state, []);
					this._strategyGrades.set(resource.toString(), grade);
				} catch (e) {
					// The day's included usage is spent (plan 35 iter 3): an on-demand grade cannot run right now.
					// Keep the honest pass (never a false FLAG) and tell the user in plain words - no crash.
					if (isModelPausedError(e)) { this._notify.info(e.message); }
					else { throw e; }
				}
			}
		}
		this._onDidChange.fire();
	}

	// Apply a Skill's deterministic fix to the document (spec 5, the Apply-fix half of criterion 3).
	// Formatting title-cases every flagged heading in place, audits each, and persists once; the grader
	// then re-derives to PASS. A no-op for skills with no deterministic fix or nothing to fix.
	async applySkillFix(resource: URI, id: ISkillCheck['id']): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state || !state.doc.isLiving) { return; }
		let fixed = 0;
		if (id === 'formatting') {
			for (const block of state.doc.blocks) {
				if (block.type !== 'heading' || (block.level ?? 0) < 2 || LivingDocsService._isTitleCase(block.text)) { continue; }
				const next = LivingDocsService._toTitleCase(block.text);
				if (next === block.text) { continue; }
				state.lock.audit.push(this._entry(block.id, 'approved', block.text, next, 'heuristic'));
				block.text = next;
				state.recent.add(block.id);
				fixed++;
			}
		}
		if (!fixed) { return; }
		state.status = `Formatting fix applied - ${fixed} heading${fixed === 1 ? '' : 's'} title-cased`;
		await this._persist(state);
		this._onDidChange.fire();
	}

	// Run a Skill across every project document (plan 32 iter 3, the P3 gap): fan the skill grade over the
	// folder's living documents through the orchestrator's fan surface, and return a per-document summary the
	// Agents screen renders as a run strip. Skills stay single-doc units - the orchestrator does the fanning.
	// Real data only: a non-living document, or a model-backed skill with no model, is honestly `skipped`
	// (never a fabricated pass). The model-backed Strategy grade runs per document (its verdict caches).
	async runSkillAcrossProject(id: ISkillCheck['id'], skillName: string): Promise<ISkillRunSummary> {
		const uris = await this._discoverLivingDocUris();
		const results: ISkillRunDocResult[] = [];
		for (const uri of uris) {
			const state = this._docs.get(uri.toString()) ?? await this._loadState(uri);
			if (!state || !state.doc.isLiving) { continue; }
			// A model-backed skill needs its per-document grade run first so the report reflects the live verdict.
			if (id === 'strategy') { await this.runSkillCheck(uri, 'strategy'); }
			const check = this.getSkillReport(uri).find(c => c.id === id);
			const status: SkillRunDocStatus = !check
				? 'skipped'
				: check.status === 'flag' ? 'flag' : check.status === 'pass' ? 'pass' : 'skipped';
			results.push({ docId: uri.toString(), docTitle: state.doc.title, status, detail: check?.detail ?? 'Not gradeable for this document.' });
		}
		this._onDidChange.fire();
		return summariseSkillRun(id, skillName, results);
	}

	// House style: title-case headings. A heading passes when every significant word (the first word,
	// and any word that is not a minor word) is capitalized. Deterministic - no model.
	private static readonly _MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'to', 'by', 'in', 'on', 'at', 'as', 'is', 'with']);
	private static _isTitleCase(text: string): boolean {
		const words = text.trim().split(/\s+/);
		return words.every((word, i) => {
			const letters = word.replace(/[^A-Za-z].*$/, '');
			if (!letters) { return true; }
			if (i !== 0 && LivingDocsService._MINOR_WORDS.has(letters.toLowerCase())) { return true; }
			return letters[0] === letters[0].toUpperCase();
		});
	}

	// Rewrite a heading to house style: capitalize the first letter of every significant word, lower-case
	// minor words (except the first). Only the leading letter is touched, so acronyms (MRR, OKRs) survive.
	private static _toTitleCase(text: string): string {
		return text.trim().split(/\s+/).map((word, i) => {
			const letters = word.replace(/[^A-Za-z].*$/, '');
			if (i !== 0 && letters && LivingDocsService._MINOR_WORDS.has(letters.toLowerCase())) { return word.toLowerCase(); }
			return word.replace(/[A-Za-z]/, c => c.toUpperCase());
		}).join(' ');
	}

	// --- workspace-wide views ---

	getAllPending(): readonly IProposedChange[] { return this._pending; }
	getAudit(): readonly IAuditEntry[] {
		// The audit is folded into each document's lock; aggregate across the loaded documents.
		return [...this._docs.values()].flatMap(s => s.lock.audit);
	}

	focusPanel(tab: LivingDocsPanelTab): void {
		this._onDidRequestPanel.fire(tab);
		// Reveal the right panel; take focus only for Chat so the user can type straight away.
		this._views.openView(REVIEW_RAIL_VIEW_ID, tab === 'chat').catch(e => this._log.warn('[livingDocs] focusPanel failed', e));
	}

	focusChange(changeId: string): void {
		// Look up the change's document so the editor pane showing it can scroll to the right inline diff.
		// A stale id (already approved/rejected) is a no-op - nothing to focus.
		const change = this.getAllPending().find(c => c.id === changeId);
		if (change) {
			this._onDidRequestFocusChange.fire({ docId: change.docId, changeId });
		}
	}

	// --- the "Documents" home ---

	async listDocuments(): Promise<readonly ILivingDocSummary[]> {
		const found = new Map<string, URI>();
		// Always include documents already loaded (e.g. the open editor), even if discovery misses them.
		for (const state of this._docs.values()) {
			found.set(state.uri.toString(), state.uri);
		}
		// Scan each workspace folder for every Markdown document so the home reflects the real folder
		// (the folder IS the project); living vs plain is carried per-summary for the badge.
		for (const folder of this._workspace.getWorkspace().folders) {
			await this._collectDocs(folder.uri, found, 0);
		}
		const summaries: ILivingDocSummary[] = [];
		for (const uri of found.values()) {
			const summary = await this._summarize(uri);
			if (summary) { summaries.push(summary); }
		}
		summaries.sort((a, b) => a.title.localeCompare(b.title));
		return summaries;
	}

	// --- templates (plan 28) ---

	// Discover and parse every `*.template.md` in the open folder (plan 28, D28-A). Piggybacks on the same
	// bounded folder scan `listDocuments` uses (a shared `_collect` walk), so templates and documents are
	// found by one traversal contract; templates are simply the `.template.md` branch. Each is parsed with
	// the SAME `parseLivingDoc` frontmatter parser (no second parser) into an ITemplateInfo card model.
	// Sorted by name so the screen order is stable; an unreadable/malformed file is skipped, never faked.
	async listTemplates(): Promise<readonly ITemplateInfo[]> {
		const found = new Map<string, URI>();
		for (const folder of this._workspace.getWorkspace().folders) {
			await this._collectTemplates(folder.uri, found, 0);
		}
		const templates: ITemplateInfo[] = [];
		for (const uri of found.values()) {
			try {
				const raw = (await this._files.readFile(uri)).value.toString();
				const doc = parseLivingDoc(raw);
				if (!doc.isTemplate) { continue; } // a `.template.md` with no `template: true` is not a template
				templates.push({
					uri,
					name: doc.templateName ?? doc.title,
					description: doc.templateDescription ?? '',
					sources: doc.sources,
					body: doc.body,
				});
			} catch (e) {
				this._log.trace('[livingDocs] template parse skipped', e instanceof Error ? e.message : String(e));
			}
		}
		templates.sort((a, b) => a.name.localeCompare(b.name));
		return templates;
	}

	// --- the source registry (plan 29, iter 1): the Knowledge screen's real source library ---

	// The project's source registry (D29-A): a pure projection over every project document's declared
	// `sources:`/`context:` and its lock, folded by source identity. Discovers documents exactly as
	// `listDocuments` does (loaded + on-disk, so the screen reflects the real folder even before anything is
	// opened), then for each living document reads its lock + current source values to answer, per source:
	// which documents depend on it (+ the bind keys they resolve), when it was last synced, and whether it is
	// still fresh. No new persistence - `syncedAt`/`fresh` come straight from the recorded lock hashes.
	async listSources(): Promise<readonly ISourceInfo[]> {
		const found = new Map<string, URI>();
		for (const state of this._docs.values()) { found.set(state.uri.toString(), state.uri); }
		for (const folder of this._workspace.getWorkspace().folders) {
			await this._collectDocs(folder.uri, found, 0);
		}
		// source id -> the accumulating registry row.
		interface IRegistryRow {
			kind: SourceKind;
			label: string;
			syncedAt: string | undefined;
			fresh: boolean;
			usedBy: Map<string, { doc: URI; title: string; keys: Set<string>; context: boolean }>;
		}
		const acc = new Map<string, IRegistryRow>();
		const ensure = (id: string, kind: SourceKind): IRegistryRow => {
			let row = acc.get(id);
			if (!row) { row = { kind, label: sourceLabel(id, kind), syncedAt: undefined, fresh: true, usedBy: new Map() }; acc.set(id, row); }
			return row;
		};
		for (const uri of found.values()) {
			const projection = await this._sourceProjection(uri);
			if (!projection) { continue; }
			const { doc, lock, resolution, contextHashes, title } = projection;
			const docId = uri.toString();
			// Every bind key the document actually authors, so `usedBy` keys are the real dependency (not
			// every column the source happens to expose).
			const docKeys = new Set<string>();
			for (const block of doc.blocks) { for (const b of block.binds) { docKeys.add(b.key); } }
			// Value sources (frontmatter `sources:`): a source's keys are the document's bind keys under the
			// source's alias ("metrics.csv" -> alias "metrics" -> keys "metrics.*").
			for (const source of doc.sources) {
				const kind = sourceKind(source);
				const alias = sourceAlias(source);
				const row = ensure(source, kind);
				const keys = [...docKeys].filter(k => k.split('.')[0] === alias);
				const usage = { doc: uri, title, keys: new Set(keys), context: false };
				row.usedBy.set(docId, usage);
				// Fold freshness + last-sync from the lock for exactly this document's keys.
				for (const key of keys) {
					const entry = lock.bindings[key];
					if (!entry) { continue; }
					if (!bindingIsFresh(resolution.get(key), entry)) { row.fresh = false; }
					if (!row.syncedAt || entry.syncedAt > row.syncedAt) { row.syncedAt = entry.syncedAt; }
				}
			}
			// Context sources (frontmatter `context:`): influence edges - no bind keys; freshness compares the
			// current source hash to the lock's reviewedHash, last-sync is the reviewedAt.
			for (const file of doc.context) {
				const kind = sourceKind(file);
				const row = ensure(file, kind);
				const existing = row.usedBy.get(docId);
				if (existing) { existing.context = true; } else { row.usedBy.set(docId, { doc: uri, title, keys: new Set(), context: true }); }
				const entry = lock.context[file];
				if (entry) {
					if (contextHashes.get(file) !== entry.reviewedHash) { row.fresh = false; }
					if (!row.syncedAt || entry.reviewedAt > row.syncedAt) { row.syncedAt = entry.reviewedAt; }
				}
			}
		}
		const sources: ISourceInfo[] = [];
		for (const [id, row] of acc) {
			const usedBy: ISourceUsage[] = [...row.usedBy.values()]
				.map(u => ({ doc: u.doc, title: u.title, keys: [...u.keys].sort((a, b) => a.localeCompare(b)), context: u.context }))
				.sort((a, b) => a.title.localeCompare(b.title));
			sources.push({ id, kind: row.kind, label: row.label, syncedAt: row.syncedAt, fresh: row.fresh, usedBy });
		}
		sources.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
		return sources;
	}

	// Read one document's projection for the source registry: its parsed doc, its lock (from the loaded state
	// or the sidecar), the freshly-resolved value of every bind key, and the current hash of every context
	// file - all without mutating the loaded-document map or writing anything. Returns undefined for an
	// unreadable or non-living document (it contributes no sources).
	private async _sourceProjection(uri: URI): Promise<{ doc: ILivingDoc; title: string; lock: ILivingDocLock; resolution: Map<string, IResolution>; contextHashes: Map<string, string> } | undefined> {
		const id = uri.toString();
		let state = this._docs.get(id);
		if (!state) {
			let rawText: string;
			try {
				rawText = (await this._files.readFile(uri)).value.toString();
			} catch (e) {
				this._log.trace('[livingDocs] source projection unreadable', e instanceof Error ? e.message : String(e));
				return undefined;
			}
			const doc = parseLivingDoc(rawText);
			if (!doc.isLiving) { return undefined; }
			const lock = (await this._lockStore.read(uri)) ?? emptyLock();
			state = { uri, doc, rawText, lock, recent: new Set(), staleBindings: new Set(), staleContext: new Set(), status: '', folderFiles: [] };
		}
		if (!state.doc.isLiving) { return undefined; }
		const resolution = await this._resolveCurrent(state);
		const contextHashes = new Map<string, string>();
		for (const file of state.doc.context) { contextHashes.set(file, await this._hashContext(state, file)); }
		return { doc: state.doc, title: state.doc.title, lock: state.lock, resolution, contextHashes };
	}

	// Recursively collect every `*.template.md` under a folder, mirroring `_collectDocs`' bounded, hidden-dir
	// skipping walk (the folder is the project; templates may live anywhere, e.g. under `templates/`).
	private async _collectTemplates(dir: URI, found: Map<string, URI>, depth: number): Promise<void> {
		if (depth > 4) { return; }
		let children;
		try {
			children = (await this._files.resolve(dir)).children ?? [];
		} catch (e) {
			this._log.trace('[livingDocs] templates scan skipped', e instanceof Error ? e.message : String(e));
			return;
		}
		for (const child of children) {
			const name = basename(child.resource);
			if (child.isDirectory) {
				if (name.startsWith('.') || name === 'node_modules' || name === 'out') { continue; }
				await this._collectTemplates(child.resource, found, depth + 1);
			} else if (this._isTemplateFile(child.resource)) {
				found.set(child.resource.toString(), child.resource);
			}
		}
	}

	// New Template (plan 28, iter 2): write an `untitled.template.md` (uniquified) seeded with the commented
	// example and open it in the normal editor - it is just Markdown, so it round-trips on disk with no new
	// format. Fires onDidChange so an open Templates screen refreshes its card grid.
	async createTemplate(): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) {
			this._notify.info('Open a folder to create a template.');
			return undefined;
		}
		const target = await this._uniqueTemplateUri(folder.uri);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(NEW_TEMPLATE_TEMPLATE));
			await this._editors.openEditor({ resource: target, options: { pinned: true } });
			this._onDidChange.fire();
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] create template failed', e);
			return undefined;
		}
	}

	// Pick a non-colliding `untitled.template.md` name in the folder (mirrors `_uniqueDocUri`).
	private async _uniqueTemplateUri(folder: URI): Promise<URI> {
		const existing = new Set<string>();
		try {
			for (const child of (await this._files.resolve(folder)).children ?? []) {
				existing.add(basename(child.resource));
			}
		} catch {
			// An unreadable folder just means no collisions to avoid.
		}
		let name = 'untitled.template.md';
		for (let n = 2; existing.has(name); n++) {
			name = `untitled ${n}.template.md`;
		}
		return joinPath(folder, name);
	}

	getWorkspaceFolderName(): string | undefined {
		return this._workspace.getWorkspace().folders[0]?.name;
	}

	// (plan 33 iter 2, L5) The truthful project display name for Home, the topbar crumb and the ALL PROJECTS
	// current-folder tile. In the web build the workbench labels the memfs mount "mount" (a mount-point
	// artefact, not a project name); `projectDisplayName` overrides that ONLY when the sample ships an
	// `.abstract-name` marker (cached in `_projectNameMarker`), and otherwise shows the real folder
	// name/basename. Synchronous (reads the pre-read marker cache) so the renderer can call it inline.
	getProjectDisplayName(): string | undefined {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder?.uri) { return undefined; }
		return projectDisplayName({
			folderName: folder.name,
			basename: basename(folder.uri),
			markerContent: this._projectNameMarker,
		});
	}

	// The data files (csv/json) sitting alongside the document that are not already bound and are not lock
	// sidecars - the choices the Add-source picker offers (sources are scoped to the folder; decision #40).
	async getSourceCandidates(resource: URI): Promise<readonly string[]> {
		const state = this._docs.get(resource.toString());
		if (!state) { return []; }
		const bound = new Set(state.doc.sources);
		let children;
		try {
			children = (await this._files.resolve(dirname(resource))).children ?? [];
		} catch {
			return [];
		}
		return children
			.filter(c => !c.isDirectory)
			.map(c => basename(c.resource))
			// Exclude system json (lock sidecars + the agents registry) - they are not user data sources.
			.filter(name => /\.(csv|json)$/i.test(name) && !/\.lock\.json$/i.test(name) && name !== 'agents.json' && !bound.has(name))
			.sort((a, b) => a.localeCompare(b));
	}

	// The project folder's data files (csv/json) for the Knowledge Add-source picker (plan 29, iter 2).
	// Scans the workspace folder root (the samples are flat); excludes lock sidecars + the agents registry.
	async getFolderDataFiles(): Promise<readonly string[]> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) { return []; }
		let children;
		try {
			children = (await this._files.resolve(folder.uri)).children ?? [];
		} catch {
			return [];
		}
		return children
			.filter(c => !c.isDirectory)
			.map(c => basename(c.resource))
			.filter(name => /\.(csv|json)$/i.test(name) && !/\.lock\.json$/i.test(name) && name !== 'agents.json')
			.sort((a, b) => a.localeCompare(b));
	}

	async addSource(resource: URI, source: string): Promise<void> {
		await this._rewriteSources(resource, source, true);
	}

	async removeSource(resource: URI, source: string): Promise<void> {
		await this._rewriteSources(resource, source, false);
	}

	// The real folder documents not already referenced (context) or bound (sources) - the Add-context-file
	// picker's choices (referencing a real file in the project; R6).
	async getContextCandidates(resource: URI): Promise<readonly string[]> {
		const state = this._docs.get(resource.toString());
		if (!state) { return []; }
		const taken = new Set([...state.doc.sources, ...state.doc.context]);
		return state.folderFiles.filter(name => !taken.has(name));
	}

	async addContextFile(resource: URI, file: string): Promise<void> {
		await this._rewriteList(resource, 'context', file, true);
	}

	async removeContextFile(resource: URI, file: string): Promise<void> {
		await this._rewriteList(resource, 'context', file, false);
	}

	// The md/csv/json siblings of a document, excluding itself, lock/agents system files and generated views.
	private async _scanFolderDocs(uri: URI): Promise<string[]> {
		let children;
		try {
			children = (await this._files.resolve(dirname(uri))).children ?? [];
		} catch {
			return [];
		}
		const self = basename(uri);
		return children
			.filter(c => !c.isDirectory)
			.map(c => basename(c.resource))
			.filter(name => /\.(md|csv|json|txt)$/i.test(name) && !/\.lock\.json$/i.test(name) && name !== 'agents.json' && !/\.(export|source)\.md$/i.test(name) && name !== self)
			.sort((a, b) => a.localeCompare(b));
	}

	// Add/remove a source by rewriting only the frontmatter `sources:` list; saveRawText persists, reparses,
	// and re-resolves (so the binding is live and source-peek shows the grid) and fires the change event.
	private async _rewriteSources(resource: URI, source: string, add: boolean): Promise<void> {
		await this._rewriteList(resource, 'sources', source, add);
	}

	// Add/remove a value in a frontmatter list (sources or context) by rewriting only the frontmatter;
	// saveRawText persists, reparses, and re-resolves (live binding + source-peek) and fires the change.
	private async _rewriteList(resource: URI, key: 'sources' | 'context', value: string, add: boolean): Promise<void> {
		const raw = this.getRawText(resource);
		if (!raw) { return; }
		const next = withFrontmatterList(raw, key, value, add);
		if (next === raw) { return; }
		await this.saveRawText(resource, next);
	}

	// The on-ramp: prompt for a local folder and open it as the workspace. `showOpenDialog` uses the
	// browser File System Access picker on web (real-disk, via the html file-system provider) and the
	// native dialog on desktop; `openWindow` reloads the workbench with the picked folder as the workspace.
	async openFolder(): Promise<void> {
		const picked = await this._fileDialog.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: 'Open Folder' });
		if (picked && picked.length) {
			await this._host.openWindow([{ folderUri: picked[0] }], { forceReuseWindow: true });
		}
	}

	async createDocument(name?: string): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) {
			this._notify.info('Open a folder to create a document.');
			return undefined;
		}
		// A provided name is born titled (`<name>.md`); an empty name keeps decision 56's `Untitled.md`
		// name-on-first-save escape hatch. Path-hostile characters are stripped so the name is a safe stem.
		const stem = LivingDocsService._safeStem(name);
		const target = await this._uniqueDocUri(folder.uri, stem || 'Untitled');
		// F3 (walk 1b): name-first birth must hold for a blank document, not only templates. When the user
		// typed a name, seed the file with that name as its H1 so the document is genuinely born titled - the
		// editor and every list show the typed name, not "Untitled". A nameless blank keeps the empty seed.
		const seed = name && name.trim() ? `# ${name.trim()}\n` : NEW_DOCUMENT_TEMPLATE;
		try {
			await this._files.writeFile(target, VSBuffer.fromString(seed));
			await this._editors.openEditor({ resource: target, options: { pinned: true } });
			this._onDidChange.fire();
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] create document failed', e);
			return undefined;
		}
	}

	// Reduce a free-text document name to a safe filename stem: drop path separators and characters no OS
	// allows in a name, collapse whitespace. An empty result signals "no name" (the caller keeps Untitled).
	private static _safeStem(name: string | undefined): string {
		return (name ?? '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
	}

	// Generate a draft document from a template (plan 28, iter 3): write the static skeleton (headings +
	// verbatim bind links + `template:` provenance), open it, then drive the SAME chat path every generation
	// uses so the prose lands as reviewable insertion proposals (decision 17) - no new approve/apply path.
	// With no model reachable the skeleton is still created and a status line explains it needs the model
	// (honest empty state, never fake prose). Returns the new document's URI.
	async generateFromTemplate(templateUri: URI, docName: string, note: string): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) {
			this._notify.info('Open a folder to create a document.');
			return undefined;
		}
		let template: ILivingDoc;
		try {
			template = parseLivingDoc((await this._files.readFile(templateUri)).value.toString());
		} catch (e) {
			this._log.warn('[livingDocs] template unreadable for generation', e);
			this._notify.info('That template could not be read.');
			return undefined;
		}
		const templateName = template.templateName || basename(templateUri).replace(/\.template\.md$/, '');
		const requested = LivingDocsService._safeStem(docName) || LivingDocsService._safeStem(templateName) || 'Untitled';
		const skeleton = buildTemplateSkeleton(template.body, requested, templateName, template.sources);
		const target = await this._uniqueDocUri(folder.uri, requested);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(skeleton));
			await this._editors.openEditor({ resource: target, options: { pinned: true } });
		} catch (e) {
			this._log.warn('[livingDocs] generate skeleton write failed', e);
			return undefined;
		}
		// Load so the skeleton's copied binds resolve on disk and the doc has state to chat over.
		await this.loadDocument(target);
		if (!await this._hasModel()) {
			// Honest no-model state: the skeleton is real and bound, but the prose draft needs the model.
			const state = this._docs.get(target.toString());
			if (state) { state.status = 'Draft skeleton created - connect a model to fill it from the sources'; }
			this._notify.info(`Created "${requested}" from the ${templateName} template. Start the local model proxy to draft its prose.`);
			this._onDidChange.fire();
			return target;
		}
		// Drive the existing generative chat path with the composed brief: the model's output arrives as
		// insertion proposals in the review rail, exactly like any chat generation. The rail shows a plain-words
		// user turn (F4) - the internal brief drives the model but is never dumped into the transcript.
		const instruction = composeTemplateInstruction(templateName, template.body, requested, note ?? '');
		const shown = localize('livingDocs.draftFromTemplate', "Draft this document from the {0} template.", templateName);
		await this.sendChatMessage(target, instruction, shown);
		return target;
	}

	// Recursively collect every Markdown document under a folder (the folder is the project), skipping
	// hidden and dependency directories. Bounded in depth so a large workspace can never make the home hang.
	private async _collectDocs(dir: URI, found: Map<string, URI>, depth: number): Promise<void> {
		if (depth > 4) { return; }
		let children;
		try {
			children = (await this._files.resolve(dir)).children ?? [];
		} catch (e) {
			this._log.trace('[livingDocs] documents scan skipped', e instanceof Error ? e.message : String(e));
			return;
		}
		for (const child of children) {
			const name = basename(child.resource);
			if (child.isDirectory) {
				if (name.startsWith('.') || name === 'node_modules' || name === 'out') { continue; }
				await this._collectDocs(child.resource, found, depth + 1);
			} else if (this._isDocFile(child.resource)) {
				found.set(child.resource.toString(), child.resource);
			}
		}
	}

	// A document is any `.md` file; generated `.export.md` / `.source.md` views are skipped, and template
	// files (`*.template.md`, plan 28 D28-A) are excluded so they never appear in the Reports list, the
	// tree-rail or the Home documents grid - they show only on the Templates screen (but stay on disk).
	// Whether a document is "living" (declares sources/context or carries bind links) is resolved
	// per-summary for the badge.
	private _isDocFile(resource: URI): boolean {
		const path = resource.path;
		return path.endsWith('.md') && !path.endsWith('.export.md') && !path.endsWith('.source.md') && !path.endsWith('.template.md');
	}

	// A template file is any `*.template.md` (plan 28, D28-A). Discovered anywhere in the folder (including
	// a `templates/` subfolder); parsed for the Templates screen but never listed as a Report.
	private _isTemplateFile(resource: URI): boolean {
		return resource.path.endsWith('.template.md');
	}

	// A `.md` is a Living Document when its content declares sources/context or carries bind links.
	// Generated `.export.md` / `.source.md` views are skipped.
	private async _isLivingDocFile(resource: URI): Promise<boolean> {
		const path = resource.path;
		if (!path.endsWith('.md') || path.endsWith('.export.md') || path.endsWith('.source.md')) { return false; }
		try {
			const text = (await this._files.readFile(resource)).value.toString();
			return parseLivingDoc(text).isLiving;
		} catch {
			return false;
		}
	}

	private async _summarize(uri: URI): Promise<ILivingDocSummary | undefined> {
		try {
			const raw = (await this._files.readFile(uri)).value.toString();
			const doc = parseLivingDoc(raw);
			const kinds = new Set<SourceKind>();
			for (const source of doc.sources) { kinds.add(sourceKind(source)); }
			const id = uri.toString();
			const bound = doc.blocks.reduce((n, b) => n + b.binds.length, 0);
			return {
				resource: uri,
				// A document with no frontmatter title and no usable H1 parses to the bare "Untitled" default,
				// which erases which file the row is. Fall back to the filename stem so an odd/blank-heading
				// Markdown file still names itself in every list (walk 1a F8).
				title: titleForDocument(doc, uri),
				isLiving: doc.isLiving,
				sourceKinds: [...kinds],
				sources: doc.sources,
				lastSynced: doc.context.length ? `${doc.context.length} context` : (bound ? `${bound} bound` : ''),
				pendingCount: this._pending.filter(c => c.docId === id).length,
				relativeDir: this._relativeDir(uri),
			};
		} catch (e) {
			this._log.trace('[livingDocs] summarize skipped', e instanceof Error ? e.message : String(e));
			return undefined;
		}
	}

	// The folder path of a file relative to its workspace root (e.g. `reports/2025`; "" at the root), so the
	// tree-rail preserves subfolder hierarchy (walk 1a F7). Falls back to "" when no root contains the file.
	private _relativeDir(uri: URI): string {
		for (const folder of this._workspace.getWorkspace().folders) {
			const root = folder.uri.path.replace(/\/+$/, '');
			const path = uri.path;
			if (path === root || path.startsWith(root + '/')) {
				const rest = path.slice(root.length + 1);
				const slash = rest.lastIndexOf('/');
				return slash < 0 ? '' : rest.slice(0, slash);
			}
		}
		return '';
	}

	// The non-Markdown files in the workspace, for the tree-rail Sources section (walk 1a F9/F10). A shared
	// bounded walk (mirrors `_collectDocs`) classifies each: data files (csv/txt/json/images) are bindable
	// sources; `.doc`/`.docx` are unsupported and shown "not yet imported" so the beta never silently skips
	// them (migration is founder-led for beta, doc 18 §3). Markdown, templates and generated views are the
	// document surface (`listDocuments`) and are excluded here.
	async listWorkspaceFiles(): Promise<readonly IWorkspaceFile[]> {
		const found = new Map<string, URI>();
		for (const folder of this._workspace.getWorkspace().folders) {
			await this._collectNonDocFiles(folder.uri, found, 0);
		}
		const files: IWorkspaceFile[] = [];
		for (const uri of found.values()) {
			const name = basename(uri);
			const unsupported = /\.docx?$/i.test(name);
			files.push({
				name,
				relativeDir: this._relativeDir(uri),
				kind: unsupported ? 'unsupported' : 'data',
				note: unsupported ? localize('livingDocs.notYetImported', "not yet imported") : undefined,
			});
		}
		files.sort((a, b) => a.name.localeCompare(b.name));
		return files;
	}

	private async _collectNonDocFiles(dir: URI, found: Map<string, URI>, depth: number): Promise<void> {
		if (depth > 4) { return; }
		let children;
		try {
			children = (await this._files.resolve(dir)).children ?? [];
		} catch (e) {
			this._log.trace('[livingDocs] non-doc scan skipped', e instanceof Error ? e.message : String(e));
			return;
		}
		for (const child of children) {
			const name = basename(child.resource);
			if (child.isDirectory) {
				if (name.startsWith('.') || name === 'node_modules' || name === 'out') { continue; }
				await this._collectNonDocFiles(child.resource, found, depth + 1);
			} else if (this._isNonDocFile(child.resource)) {
				found.set(child.resource.toString(), child.resource);
			}
		}
	}

	// A file the tree-rail's Sources section shows: any non-Markdown file except the app's own sidecars
	// (`.lock.json`) and hidden/dotfiles. `.doc`/`.docx` are included (marked unsupported by the caller).
	private _isNonDocFile(resource: URI): boolean {
		const name = basename(resource);
		if (name.startsWith('.')) { return false; }
		if (name.endsWith('.lock.json')) { return false; }
		const path = resource.path;
		if (path.endsWith('.md')) { return false; } // documents/templates/generated views are the doc surface
		return true;
	}

	private async _uniqueDocUri(folder: URI, stem: string = 'Untitled'): Promise<URI> {
		const existing = new Set<string>();
		try {
			for (const child of (await this._files.resolve(folder)).children ?? []) {
				existing.add(basename(child.resource));
			}
		} catch {
			// An unreadable folder just means no collisions to avoid.
		}
		let name = `${stem}.md`;
		for (let n = 2; existing.has(name); n++) {
			name = `${stem} ${n}.md`;
		}
		return joinPath(folder, name);
	}

	// --- loading ---

	async loadDocument(resource: URI): Promise<void> {
		const state = await this._loadState(resource);
		if (state) {
			// First open with no lock yet: bootstrap it from the sources (the initial sync). Otherwise
			// the lock is authoritative - load is read-only and the cache reconciles to it at render.
			await this._bootstrapLock(state);
			state.recent = new Set<string>();
			// On-open freshness hook (spec 7): hash the sources now so the Context panel's flag is current
			// without a manual refresh, then watch them for later changes.
			await this._recomputeFreshness(state);
			this._watchSources(state);
		}
		this._onDidChange.fire();
	}

	private async _loadState(resource: URI): Promise<IDocState | undefined> {
		let rawText: string;
		let doc: ILivingDoc;
		try {
			rawText = (await this._files.readFile(resource)).value.toString();
			doc = parseLivingDoc(rawText);
		} catch (e) {
			this._log.error('[livingDocs] failed to parse document', e);
			this._docs.delete(resource.toString());
			return undefined;
		}
		const lock = (await this._lockStore.read(resource)) ?? emptyLock();
		const state: IDocState = {
			uri: resource,
			doc,
			rawText,
			lock,
			recent: this._docs.get(resource.toString())?.recent ?? new Set<string>(),
			staleBindings: new Set<string>(),
			staleContext: new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
			folderFiles: [],
		};
		this._docs.set(resource.toString(), state);
		state.folderFiles = await this._scanFolderDocs(resource);
		if (doc.isLiving) { await this._resolveSubtitle(state); }
		return state;
	}

	// When a doc carries bind keys with no lock entry yet (a brand-new or never-synced doc), resolve
	// them once from the sources and write the initial lock. Existing lock entries are left untouched
	// so the lock stays the source of truth across opens.
	private async _bootstrapLock(state: IDocState): Promise<void> {
		const keys = new Set<string>();
		for (const block of state.doc.blocks) { for (const b of block.binds) { keys.add(b.key); } }
		const missingBinding = [...keys].some(key => !Object.prototype.hasOwnProperty.call(state.lock.bindings, key));
		const missingContext = state.doc.context.some(file => !Object.prototype.hasOwnProperty.call(state.lock.context, file));
		if (!missingBinding && !missingContext) { return; }

		const resolution = await this._resolveCurrent(state);
		let changed = false;
		for (const key of keys) {
			if (Object.prototype.hasOwnProperty.call(state.lock.bindings, key)) { continue; }
			const r = resolution.get(key);
			if (!r) { continue; }
			state.lock.bindings[key] = this._bindingEntry(r);
			changed = true;
		}
		// Seed each context source as reviewed-at-current so it reads as current until it next changes.
		for (const file of state.doc.context) {
			if (Object.prototype.hasOwnProperty.call(state.lock.context, file)) { continue; }
			state.lock.context[file] = { reviewedHash: await this._hashContext(state, file), reviewedAt: new Date().toISOString(), scope: 'document' };
			changed = true;
		}
		if (changed) {
			try {
				await this._lockStore.write(state.uri, state.lock);
			} catch (e) {
				this._log.warn('[livingDocs] lock bootstrap write failed', e);
			}
		}
	}

	// --- staleness detection (cheap, always-on): the dirty bit (spec 3.4) ---

	async checkSources(resource: URI): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		await this._recomputeFreshness(state);
		this._onDidChange.fire();
	}

	// Re-hash every source and flip the dirty bits. Value bindings compare the source value's hash to
	// the lock's; context sources compare to the lock's reviewedHash. No prose is touched, no model is
	// called - this is the always-on layer.
	private async _recomputeFreshness(state: IDocState, pass?: IRefreshPass): Promise<void> {
		const staleBindings = new Set<string>();
		const staleContext = new Set<string>();
		if (state.doc.isLiving) {
			const resolution = await this._resolveCurrent(state, pass);
			for (const key of Object.keys(state.lock.bindings)) {
				const cur = resolution.get(key);
				if (cur && !bindingIsFresh(cur, state.lock.bindings[key])) { staleBindings.add(key); }
			}
			for (const file of state.doc.context) {
				const entry = state.lock.context[file];
				const hash = await this._hashContext(state, file, pass);
				if (!entry || entry.reviewedHash !== hash) { staleContext.add(file); }
			}
		}
		state.staleBindings = staleBindings;
		state.staleContext = staleContext;
		if (state.doc.isLiving) {
			state.status = (staleBindings.size || staleContext.size) ? 'Sources changed - may be affected' : 'All sources synced';
		}
	}

	private async _hashContext(state: IDocState, file: string, pass?: IRefreshPass): Promise<string> {
		if (sourceKind(file) === 'api') { return ''; }
		try {
			const text = await this._readSourceFile(joinPath(dirname(state.uri), file), pass);
			return hashString(text);
		} catch (e) {
			this._log.trace('[livingDocs] context unreadable', file, e instanceof Error ? e.message : String(e));
			return '';
		}
	}

	// Watch each file source + context source with a correlated watcher so a source change flips the
	// dirty bit on its own (the always-on layer). Recreated per load; best-effort (no-op where the
	// platform has no watcher, e.g. unit tests).
	private _watchSources(state: IDocState): void {
		const id = state.uri.toString();
		this._watchers.get(id)?.dispose();
		this._watchers.delete(id);
		if (typeof this._files.createWatcher !== 'function') { return; }
		const store = new DisposableStore();
		const targets: URI[] = [];
		for (const source of state.doc.sources) {
			if (sourceKind(source) === 'file') { targets.push(joinPath(dirname(state.uri), source)); }
		}
		for (const file of state.doc.context) {
			if (sourceKind(file) === 'file') { targets.push(joinPath(dirname(state.uri), file)); }
		}
		for (const target of targets) {
			try {
				const watcher = store.add(this._files.createWatcher(target, { recursive: false, excludes: [] }));
				const sourcePath = target.path;
				store.add(watcher.onDidChange(() => {
					// Per-document freshness recompute + the workspace-wide graph propagation / event agents.
					void this.checkSources(state.uri);
					void this._orchestrator.onSourceChanged(sourcePath);
				}));
			} catch (e) {
				this._log.trace('[livingDocs] watch failed', e instanceof Error ? e.message : String(e));
			}
		}
		this._watchers.set(id, store);
	}

	private _bindingEntry(r: IResolution): IBindingEntry {
		return { resolved: r.value, source: r.source, sourceHash: r.sourceHash, syncedAt: new Date().toISOString(), appliedBy: 'agent', kind: 'figure' };
	}

	// Read every `sources:` file and build the bind-key -> freshly-resolved value map. A CSV produces
	// the latest row's columns (plus `.prev` / `.delta` qualifiers); an api/JSON source produces its
	// top-level fields. Influence (`context:`) sources are not value-resolved here (see Item 5).
	//
	// `pass` (plan 30, tracks 1 + 2) collapses duplicate work WITHIN one refresh/agent pass: a shared CSV
	// bound by many documents is read once (file-body cache), a shared remote source is resolved once
	// (per-source resolution cache), and a repeat remote fetch inside the per-host cooldown window is
	// suppressed. With no `pass` (single-document paths, source-peek, subtitle) behaviour is byte-identical
	// to before - every source is read fresh, exactly as it was.
	private async _resolveCurrent(state: IDocState, pass?: IRefreshPass): Promise<Map<string, IResolution>> {
		const resolved = new Map<string, IResolution>();
		// Inline `mcp` bindings (bind:key@mcp:server.tool/field, D29-B) resolve through the proxy, which owns the
		// server process + credentials (decision 14) - the web build cannot spawn, so the proxy does the spawning
		// and the same code path works on web and desktop. A server that is down leaves the key unresolved (the
		// binding flags stale, the document still renders) rather than throwing.
		for (const block of state.doc.blocks) {
			for (const bind of block.binds) {
				const mcp = parseMcpKey(bind.key);
				if (mcp) {
					const sub = await this._resolveSourceCached(pass, `mcp:${bind.key}`, async () => {
						const m = new Map<string, IResolution>();
						await this._resolveMcpSource(bind.key, mcp, m);
						return m;
					}, undefined);
					for (const [k, v] of sub) { resolved.set(k, v); }
				}
			}
		}
		for (const source of state.doc.sources) {
			if (sourceKind(source) === 'api') {
				// Strip any ` auth=<name>` marker before deriving the alias/URL, so an authenticated source's
				// bind keys (metrics.arr) and identity are the clean URL, not the credential spec.
				const spec = parseApiSpec(source);
				const sub = await this._resolveSourceCached(pass, `api:${spec.url}`, async () => {
					const m = new Map<string, IResolution>();
					await this._resolveApiSource(spec.url, sourceAlias(spec.url), m, spec.auth);
					return m;
				}, spec.url);
				for (const [k, v] of sub) { resolved.set(k, v); }
				continue;
			}
			const alias = sourceAlias(source);
			const uri = joinPath(dirname(state.uri), source);
			let text: string;
			try {
				text = await this._readSourceFile(uri, pass);
			} catch (e) {
				this._log.warn('[livingDocs] source unreadable', source, e instanceof Error ? e.message : String(e));
				continue;
			}
			// Cache the raw source text so the in-surface source-peek pane can show the comp's actual
			// CSV grid (built synchronously in getSourcePeek, which runs during a webview render).
			this._rawSourceCache.set(`${state.uri.toString()}::${source}`, text);
			if (source.endsWith('.csv')) {
				this._resolveCsv(text, source, alias, resolved);
			}
		}
		return resolved;
	}

	// Read one local source file, served from the pass's file-body cache when present (plan 30, track 1):
	// a CSV bound by 20 documents is read from disk once per pass, not 20 times. Without a pass every read
	// hits the file service, exactly as before.
	private async _readSourceFile(uri: URI, pass?: IRefreshPass): Promise<string> {
		if (!pass) { return (await this._files.readFile(uri)).value.toString(); }
		const key = uri.toString();
		let inFlight = pass.fileBodies.get(key);
		if (!inFlight) {
			inFlight = this._files.readFile(uri).then(f => f.value.toString());
			pass.fileBodies.set(key, inFlight);
		}
		return inFlight;
	}

	// Resolve one REMOTE (api/mcp) source into its bind-key map, served from the pass cache when a prior
	// document in the same pass already resolved it (plan 30, tracks 1 + 2). The fetch runs through the
	// source-fetch limiter (bounded concurrency, D30-A) and honours the per-host cooldown: an identical
	// host fetched within SOURCE_COOLDOWN_MS is not re-fetched - the cached resolution (or an empty map) is
	// reused. Without a pass the source is resolved directly (single-document paths keep their old behaviour).
	private async _resolveSourceCached(
		pass: IRefreshPass | undefined,
		cacheKey: string,
		resolve: () => Promise<Map<string, IResolution>>,
		httpUrl: string | undefined,
	): Promise<Map<string, IResolution>> {
		if (!pass) { return resolve(); }
		const cached = pass.resolutions.get(cacheKey);
		if (cached) { return cached; }
		const host = httpUrl ? this._hostOf(httpUrl) : undefined;
		if (host !== undefined) {
			const last = this._hostCooldown.get(host);
			if (last !== undefined && this._clock.now() - last < SOURCE_COOLDOWN_MS) {
				// Cooling down: skip the identical remote fetch and reuse an empty map (its bind keys keep
				// their last-known lock values; freshness is unchanged). Cached so it is a single decision.
				const empty = Promise.resolve(new Map<string, IResolution>());
				pass.resolutions.set(cacheKey, empty);
				return empty;
			}
		}
		// Cache the in-flight promise BEFORE awaiting so concurrent documents sharing this source await one
		// fetch, not N. The fetch runs through the source-fetch limiter (bounded concurrency, D30-A).
		const inFlight = this._sourceLimiter.queue(async () => {
			const m = await resolve();
			if (host !== undefined) { this._hostCooldown.set(host, this._clock.now()); }
			return m;
		});
		pass.resolutions.set(cacheKey, inFlight);
		return inFlight;
	}

	private _hostOf(url: string): string {
		try { return new URL(url).host || url; } catch { return url; }
	}

	// The doc subtitle tracks the resolved period: when it reads "Week N", N is refreshed from the
	// primary source's latest `week` value, so a sync that advances the source advances the subtitle too.
	private async _resolveSubtitle(state: IDocState, pass?: IRefreshPass): Promise<void> {
		const m = /^Week\s+(\d+)(.*)$/i.exec(state.doc.subtitle);
		if (!m || !state.doc.sources.length) { return; }
		let week: string | undefined;
		try {
			const resolution = await this._resolveCurrent(state, pass);
			for (const [key, r] of resolution) {
				if (/(^|\.)week$/.test(key)) { week = r.value.trim(); break; }
			}
		} catch {
			return;
		}
		if (week && /^\d+$/.test(week) && week !== m[1]) {
			state.doc.subtitle = `Week ${week}${m[2]}`;
		}
	}

	private _resolveCsv(text: string, source: string, alias: string, resolved: Map<string, IResolution>): void {
		const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
		if (lines.length < 2) { return; }
		const cols = lines[0].split(',').map(c => c.trim());
		const rows = lines.slice(1).map(l => l.split(','));
		const latest = rows[rows.length - 1];
		const prev = rows.length >= 2 ? rows[rows.length - 2] : undefined;
		const hash = hashString(lines[lines.length - 1]);
		for (let i = 0; i < cols.length; i++) {
			const col = cols[i];
			const cur = (latest[i] ?? '').trim();
			resolved.set(`${alias}.${col}`, { value: this._formatCell(col, cur), sourceHash: hash, source: `${source}#${col}` });
			if (prev) {
				const pv = (prev[i] ?? '').trim();
				resolved.set(`${alias}.${col}.prev`, { value: this._formatCell(col, pv), sourceHash: hash, source: `${source}#${col}` });
				const delta = this._deltaCell(col, pv, cur);
				if (delta) { resolved.set(`${alias}.${col}.delta`, { value: delta, sourceHash: hash, source: `${source}#${col}` }); }
			}
		}
	}

	// Spike-specific presentation for the sample metrics schema: currency in $k, churn as a percent,
	// everything else as-is. A real build would carry formatting hints in the source connector.
	private _formatCell(col: string, value: string): string {
		const n = Number(value);
		if (col === 'mrr' && !isNaN(n)) { return `$${k(n)}`; }
		if (col === 'churn' && !isNaN(n)) { return `${value}%`; }
		return value;
	}

	private _deltaCell(col: string, prev: string, cur: string): string | undefined {
		const a = Number(prev), b = Number(cur);
		if (isNaN(a) || isNaN(b)) { return undefined; }
		if (col === 'churn') { return `${b >= a ? '+' : ''}${(b - a).toFixed(1)}pt`; }
		if (col === 'mrr' || col === 'signups' || col === 'active') { return pct(a, b); }
		return undefined;
	}

	private async _resolveApiSource(url: string, alias: string, resolved: Map<string, IResolution>, auth?: string): Promise<void> {
		try {
			// An authenticated source is fetched THROUGH the proxy (POST /proxy/fetch), which injects the named
			// secret's Bearer header server-side (plan 29, iter 4) - the renderer only ever names the secret, never
			// holds it. An unauthenticated source keeps the original direct IRequestService GET (byte-identical).
			const json = auth
				? await this._proxyFetchJson(url, auth)
				: await asJson<Record<string, unknown>>(await this._request.request({ type: 'GET', url, callSite: 'livingDocs.apiSource' }, CancellationToken.None));
			if (!json) { return; }
			const hash = hashString(JSON.stringify(json));
			// Cache the pretty-printed payload so source-peek can show the real api response (field highlighted).
			const pretty = JSON.stringify(json, null, 2);
			for (const key of Object.keys(json)) {
				const value = json[key];
				const text = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
				resolved.set(`${alias}.${key}`, { value: text, sourceHash: hash, source: `${url}#${key}` });
				this._payloadRawCache.set(`${alias}.${key}`, pretty);
			}
		} catch (e) {
			this._log.warn('[livingDocs] api source failed', e instanceof Error ? e.message : String(e));
		}
	}

	// Fetch an authenticated JSON endpoint through the proxy so the credential never reaches the renderer
	// (plan 29, iter 4). The proxy reads the named secret from ~/.abstract/secrets.json and injects the header.
	private async _proxyFetchJson(url: string, auth: string): Promise<Record<string, unknown> | null> {
		const context = await this._request.request({
			type: 'POST',
			url: `${this._proxyUrl()}/proxy/fetch`,
			headers: { 'content-type': 'application/json' },
			data: JSON.stringify({ url, auth }),
			callSite: 'livingDocs.apiSourceAuth',
		}, CancellationToken.None);
		return asJson<Record<string, unknown>>(context);
	}

	// Resolve one inline `mcp` binding through the proxy's /mcp/resolve route (plan 29, iter 4). The proxy
	// spawns/reuses the configured MCP server (stdio JSON-RPC) and extracts the requested field; a failure
	// (server down, unknown tool, timeout) leaves the key unresolved so the binding flags stale and the
	// document still renders - never an error toast. The lock's `source` records the mcp origin for provenance.
	private async _resolveMcpSource(fullKey: string, mcp: { server: string; tool: string; field: string }, resolved: Map<string, IResolution>): Promise<void> {
		try {
			const context = await this._request.request({
				type: 'POST',
				url: `${this._proxyUrl()}/mcp/resolve`,
				headers: { 'content-type': 'application/json' },
				data: JSON.stringify({ server: mcp.server, tool: mcp.tool, args: {}, field: mcp.field }),
				callSite: 'livingDocs.mcpSource',
			}, CancellationToken.None);
			const json = await asJson<{ value?: string; raw?: string; error?: { message?: string } }>(context);
			if (!json || json.error || typeof json.value !== 'string' || json.value.length === 0) {
				this._log.warn('[livingDocs] mcp source unresolved', fullKey, json?.error?.message ?? '');
				return;
			}
			// Cache the raw MCP payload so source-peek can show the real response with the field highlighted
			// (closing the "falls back to the CSV" gap for non-file kinds).
			this._payloadRawCache.set(fullKey, json.raw ?? json.value);
			const origin = `${mcp.server}.${mcp.tool}#${mcp.field}`;
			resolved.set(fullKey, { value: json.value, sourceHash: hashString(json.raw ?? json.value), source: origin });
		} catch (e) {
			this._log.warn('[livingDocs] mcp source failed', fullKey, e instanceof Error ? e.message : String(e));
		}
	}

	// Resolve the current source values into the lock (update each binding's resolved/sourceHash/
	// syncedAt). No prose is touched. `pass` shares source reads across documents in one refresh (plan 30).
	private async _resolveIntoLock(state: IDocState, pass?: IRefreshPass): Promise<void> {
		const resolution = await this._resolveCurrent(state, pass);
		for (const [key, r] of resolution) {
			state.lock.bindings[key] = this._bindingEntry(r);
		}
	}

	// The figure changes a re-sync would make: each bound block whose visible cache no longer matches the
	// lock's resolved values. Computed without mutating the document, so the policy router can apply,
	// queue, or draft them.
	private _figureReconciles(state: IDocState): { blockId: string; oldText: string; newText: string }[] {
		const resolved = this.getResolved(state.uri);
		const changes: { blockId: string; oldText: string; newText: string }[] = [];
		for (const block of state.doc.blocks) {
			if (block.binds.length === 0) { continue; }
			const next = reconcileBindLinks(block.text, resolved);
			if (next !== block.text) { changes.push({ blockId: block.id, oldText: block.text, newText: next }); }
		}
		return changes;
	}

	private _applyFigure(state: IDocState, change: { blockId: string; oldText: string; newText: string }): void {
		const block = state.doc.blocks.find(b => b.id === change.blockId);
		if (!block) { return; }
		state.lock.audit.push(this._entry(block.id, 'auto-applied', change.oldText, change.newText, 'heuristic'));
		block.text = change.newText;
		block.binds = extractBindLinks(change.newText);
		state.recent.add(block.id);
	}

	// Re-sync the lock from the current sources and auto-apply every figure (the manual "Refresh from
	// sources" path; figures are deterministic and low-risk). Caller persists. `pass` shares source reads
	// across the documents of one refresh (plan 30, track 1).
	private async _syncLock(state: IDocState, pass?: IRefreshPass): Promise<void> {
		await this._resolveIntoLock(state, pass);
		for (const change of this._figureReconciles(state)) { this._applyFigure(state, change); }
	}

	// The verify gate (spec 5, maker != checker): run the document's Skills as graders before apply.
	// Deterministic Financial runs first and cheap (figures must reconcile to the lock/source); Strategy
	// (claims vs the Knowledge decision stack) and Formatting (house style) may use a model - in the
	// no-model spike they pass. A failed grader stops the run before anything lands.
	private async _verifyGate(state: IDocState, changes: { blockId: string; oldText: string; newText: string }[]): Promise<IGradeResult> {
		const financial = this._gradeFinancial(state, changes);
		if (!financial.pass) { return financial; }
		const strategy = await this._gradeStrategy(state, changes);
		if (!strategy.pass) { return strategy; }
		return this._gradeFormatting(state, changes);
	}

	// Deterministic: every bound value in the text must reconcile to a resolved lock/source value. A
	// missing source value (unresolved key) fails the gate; a merely-stale cache does not (that is
	// staleness, reconciled at render). The reconciled text always carries the lock value, so this is
	// the meaningful check on both the run path and the before-export gate.
	private _gradeFinancial(state: IDocState, changes: { blockId: string; oldText: string; newText: string }[]): IGradeResult {
		for (const change of changes) {
			for (const link of extractBindLinks(change.newText)) {
				if (!state.lock.bindings[link.key]) {
					return { pass: false, flag: `Financial: "${link.key}" has no source value - it does not reconcile.` };
				}
			}
		}
		return { pass: true };
	}

	// Model-backed strategy grader (spec 5, maker != checker): do the claims being asserted contradict
	// the document's Knowledge/decision-stack context (its `context` sources)? Returns the honest pass
	// when no model is reachable, on error, or on a refusal, so the verify gate never blocks on the
	// proxy being down. With changes, it grades those; without, the document's current prose claims.
	private async _gradeStrategy(state: IDocState, changes: { blockId: string; newText?: string }[]): Promise<IGradeResult> {
		if (!await this._hasModel()) { return { pass: true }; }
		const claims = changes.length
			? changes.map(c => (c.newText ?? '').trim()).filter(t => t.length > 0)
			: this._strategyClaims(state);
		const decisionStack = (await this._readContext(state, state.doc.context)).trim();
		if (!claims.length || !decisionStack) { return { pass: true }; }
		try {
			const system = 'You are a strategy reviewer. Decide whether any of the document\'s claims contradict or are clearly unsupported by the decision stack (the team\'s strategy, OKRs, and market context). '
				+ 'Reply with ONLY a JSON object: {"pass": boolean, "flag": string}. Set pass=false ONLY for a clear contradiction, with a one-sentence reason starting with "Strategy: " in flag. When in doubt, pass.';
			const user = `Decision stack:\n"""${decisionStack}"""\n\nClaims:\n${claims.map(c => `- ${c}`).join('\n')}`;
			const text = await this._callModel(system, user);
			const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { pass?: boolean; flag?: string };
			if (json.pass === false) {
				const flag = (typeof json.flag === 'string' && json.flag.trim()) ? json.flag.trim() : 'Strategy: a claim conflicts with the decision stack.';
				return { pass: false, flag };
			}
			return { pass: true };
		} catch (e) {
			// A spent daily budget must PAUSE the run (D15), not silently pass the gate: let it bubble to the
			// caller. The on-demand Skills path catches it separately (a paused grade shows NO MODEL, not a crash).
			if (isModelPausedError(e)) { throw e; }
			this._log.info('[livingDocs] strategy grade failed, passing', e instanceof Error ? e.message : String(e));
			return { pass: true };
		}
	}

	// The prose claims the Strategy grader checks: the document's non-empty paragraph text.
	private _strategyClaims(state: IDocState): string[] {
		return state.doc.blocks.filter(b => b.type === 'paragraph' && b.text.trim().length > 0).map(b => b.text.trim());
	}

	private _gradeFormatting(_state: IDocState, _changes: { blockId: string }[]): IGradeResult {
		return { pass: true };
	}

	// Route a document's figure changes by the agent's policy (spec 4.2), after the verify gate. The
	// gate runs between rewrite and apply: a failed grader blocks the whole run (nothing applied or
	// queued) and surfaces the flag (spec 5). auto-figures applies silently (audited); ask-before-apply
	// queues a pending change; draft-only queues a draft and never lands.
	private async _runFiguresByPolicy(state: IDocState, policy: AgentPolicy, pass?: IRefreshPass): Promise<{ applied: number; queued: number; blocked?: string }> {
		await this._resolveIntoLock(state, pass);
		const changes = this._figureReconciles(state);
		if (changes.length) {
			const gate = await this._verifyGate(state, changes);
			if (!gate.pass) {
				state.status = `Blocked at the verify gate - ${gate.flag}`;
				this._notify.info(gate.flag ?? 'Blocked at the verify gate.');
				return { applied: 0, queued: 0, blocked: gate.flag };
			}
		}
		let applied = 0;
		let queued = 0;
		for (const change of changes) {
			if (policy === 'auto-figures') {
				this._applyFigure(state, change);
				applied++;
				continue;
			}
			// ask-before-apply / draft-only: queue for the rail without touching the doc.
			const block = state.doc.blocks.find(b => b.id === change.blockId);
			this._pending = this._pending.filter(c => !(c.docId === state.uri.toString() && c.blockId === change.blockId));
			this._pending.push({
				id: generateUuid(),
				docId: state.uri.toString(),
				docTitle: state.doc.title,
				blockId: change.blockId,
				blockLabel: block ? this._blockLabel(state.doc, change.blockId) : change.blockId,
				oldText: change.oldText,
				newText: change.newText,
				kind: 'figure',
				confidence: 1,
				rationale: 'Source value changed; figure update prepared.',
				sourceCells: block ? block.binds.map(b => b.key) : [],
				via: 'heuristic',
				draft: policy === 'draft-only',
			});
			queued++;
		}
		return { applied, queued };
	}

	async saveRawText(resource: URI, text: string, options?: { readonly silent?: boolean }): Promise<void> {
		const id = resource.toString();
		const doc = parseLivingDoc(text);
		const lock = this._docs.get(id)?.lock ?? (await this._lockStore.read(resource)) ?? emptyLock();
		const state: IDocState = {
			uri: resource,
			doc,
			rawText: text,
			lock,
			recent: new Set<string>(),
			staleBindings: new Set<string>(),
			staleContext: new Set<string>(),
			status: doc.isLiving ? 'All sources synced' : 'Markdown',
			folderFiles: this._docs.get(id)?.folderFiles ?? [],
		};
		try {
			await this._files.writeFile(resource, VSBuffer.fromString(text));
		} catch (e) {
			this._log.warn('[livingDocs] raw save failed', e);
		}
		this._docs.set(id, state);
		await this._bootstrapLock(state);
		await this._recomputeFreshness(state);
		this._watchSources(state);
		// Silent saves (live ProseMirror typing) persist to disk + refresh state but do NOT fire the
		// change event, so the editor does not re-render the webview and remount the editor mid-keystroke.
		if (!options?.silent) {
			this._onDidChange.fire();
		}
	}

	// --- document-lifecycle hooks (spec 3, 7) ---

	// The before-export gate: the whole document's figures must reconcile (Financial) before it can
	// leave the system. Returns the flag when export should be blocked.
	private _beforeExportGate(state: IDocState): IGradeResult {
		const current = state.doc.blocks
			.filter(b => b.binds.length > 0)
			.map(b => ({ blockId: b.id, oldText: b.text, newText: b.text }));
		return this._gradeFinancial(state, current);
	}

	// The before-export gate's current verdict, surfaced so the export/present flow can SHOW it (plan 32 iter 4):
	// no silent blocks. `pass:true` = clean to export; `pass:false` with `flag` = the one-line grader reason the
	// export sheet renders alongside "Export anyway" (audited override) and "Fix first" (jumps to the flag).
	previewExportGate(resource: URI): IGradeResult {
		const state = this._docs.get(resource.toString());
		if (!state) { return { pass: true }; }
		return this._beforeExportGate(state);
	}

	// Record on the audit that the user exported/published PAST a failed gate (plan 32 iter 4): the override is
	// never silent - it lands as an `override`-via audit entry so the trail shows a human chose to proceed.
	private _auditGateOverride(state: IDocState, action: 'export' | 'publish', flag: string): void {
		state.lock.audit.push(this._entry(state.doc.blocks[0]?.id ?? '', 'auto-applied', '', `${action} overridden past gate - ${flag}`, 'override'));
	}

	// On-publish snapshot: pin the document to the current source versions (hashes) so a published doc
	// stays reproducible even as sources move on (spec 7; uses the pins[] field reserved in plan 06).
	async publishDocument(resource: URI, force = false): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		const gate = this._beforeExportGate(state);
		if (!gate.pass) {
			// No silent block, no silent override (plan 32 iter 4): without `force` the caller surfaced the gate
			// and the user chose not to proceed; with `force` the user chose "Publish anyway" and it is audited.
			if (!force) { this._notify.info(`Cannot publish - ${gate.flag}`); return; }
			this._auditGateOverride(state, 'publish', gate.flag ?? 'grader flagged');
		}
		const versions = new Map<string, string>();
		for (const key of Object.keys(state.lock.bindings)) {
			const binding = state.lock.bindings[key];
			const source = binding.source.split('#')[0];
			versions.set(source, binding.sourceHash);
		}
		const at = new Date().toISOString();
		state.lock.pins = [...versions].map(([source, version]) => ({ source, version }));
		state.lock.audit.push(this._entry(state.doc.blocks[0]?.id ?? '', 'auto-applied', '', `published ${at}`, 'heuristic'));
		await this._lockStore.write(state.uri, state.lock);
		// Publishing is a milestone: snapshot the published body so it is a restorable version, carrying the
		// real pin count so the History SNAPSHOT row can name the pinned source versions (plan 32 iter 4).
		await this.saveSnapshot(resource, 'Published', 'publish', undefined, state.lock.pins.length);
		this._notify.info(`Published "${state.doc.title}" - pinned to ${state.lock.pins.length} source version${state.lock.pins.length === 1 ? '' : 's'}.`);
		this._onDidChange.fire();
	}

	// --- versions / snapshots (plan 26 iter 2) ---

	getSnapshots(resource: URI): readonly ISnapshotEntry[] {
		const snapshots = this._docs.get(resource.toString())?.lock.snapshots ?? [];
		// Newest first for the History tab; the lock keeps them in creation order.
		return [...snapshots].reverse();
	}

	// Take a snapshot of the document's body under a label. Capped at SNAPSHOT_CAP with oldest-eviction
	// so the lock never grows without bound (D26-A). The body is verbatim Markdown (defaults to the
	// current on-disk text; callers that snapshot a pre-change state pass it explicitly); `auditIndex`
	// is the audit length now, so the History tab can group later changes.
	async saveSnapshot(resource: URI, label: string, via: SnapshotVia, body?: string, pinnedSources?: number): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		const entry: ISnapshotEntry = {
			id: generateUuid(),
			label,
			at: new Date().toISOString(),
			via,
			body: body ?? state.rawText,
			auditIndex: state.lock.audit.length,
			// The publish pin count (plan 32 iter 4) so the History SNAPSHOT row names the pinned versions. Only
			// recorded when a real count was passed (a publish); undefined stays off the entry for other snapshots.
			...(typeof pinnedSources === 'number' ? { pinnedSources } : {}),
		};
		state.lock.snapshots.push(entry);
		while (state.lock.snapshots.length > SNAPSHOT_CAP) {
			state.lock.snapshots.shift();
		}
		await this._lockStore.write(state.uri, state.lock);
		this._onDidChange.fire();
	}

	// Restore an earlier version through the one approve path (no bypass write): reject any pending
	// changes first, write the snapshot body back, record it on the audit as an applied change, then
	// recompute freshness so bindings that are now stale re-flag (correct and visible - the restored
	// figures may be behind the current sources).
	async restoreSnapshot(resource: URI, snapshotId: string): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		const snapshot = state.lock.snapshots.find(s => s.id === snapshotId);
		if (!snapshot) { return; }
		const oldBody = state.rawText;
		if (oldBody === snapshot.body) {
			// Nothing to restore (already the current body); do not write a no-op audit entry.
			return;
		}
		// Reject any pending changes for this document first - restoring resets the body, so unreviewed
		// proposals against the old body no longer apply.
		await this.rejectAll(resource.toString());
		// Write the snapshot body back through the existing persist path (parse -> disk -> lock).
		state.doc = parseLivingDoc(snapshot.body);
		state.rawText = snapshot.body;
		state.status = `Restored "${snapshot.label}"`;
		state.lock.audit.push(this._entry(state.doc.blocks[0]?.id ?? '', 'approved', oldBody, snapshot.body, 'restore'));
		await this._persist(state);
		await this._recomputeFreshness(state);
		this._notify.info(`Restored "${state.doc.title}" to "${snapshot.label}".`);
		this._onDidChange.fire();
	}

	async exportDocument(resource: URI, force = false): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const gate = this._beforeExportGate(state);
		if (!gate.pass) {
			// The export sheet surfaces the gate (plan 32 iter 4); without `force` a failed gate blocks, with
			// `force` ("Export anyway") it proceeds and the override is audited - never a silent either way.
			if (!force) { this._notify.info(`Export blocked - ${gate.flag}`); return undefined; }
			this._auditGateOverride(state, 'export', gate.flag ?? 'grader flagged');
			await this._lockStore.write(state.uri, state.lock).catch(e => this._log.warn('[livingDocs] override audit write failed', e));
		}
		const html = renderExportHtml(state.doc, this.getResolved(resource));
		const stem = basename(resource).replace(/\.md$/, '');
		const target = joinPath(dirname(resource), `${stem}.export.html`);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(html));
			await this._editors.openEditor({ resource: target, options: { pinned: true } }, SIDE_GROUP);
			this._notify.info(`Exported "${state.doc.title}" to ${basename(target)}.`);
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] export failed', e);
			return undefined;
		}
	}

	async exportMarkdown(resource: URI, force = false): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const gate = this._beforeExportGate(state);
		if (!gate.pass) {
			if (!force) { this._notify.info(`Export blocked - ${gate.flag}`); return undefined; }
			this._auditGateOverride(state, 'export', gate.flag ?? 'grader flagged');
			await this._lockStore.write(state.uri, state.lock).catch(e => this._log.warn('[livingDocs] override audit write failed', e));
		}
		const markdown = renderExportMarkdown(state.doc, this.getResolved(resource));
		const stem = basename(resource).replace(/\.md$/, '');
		const target = joinPath(dirname(resource), `${stem}.export.md`);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(markdown));
			await this._editors.openEditor({ resource: target, options: { pinned: true } }, SIDE_GROUP);
			this._notify.info(`Exported "${state.doc.title}" to ${basename(target)}.`);
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] markdown export failed', e);
			return undefined;
		}
	}

	shareDocument(resource: URI): void {
		// Live shareable links aren't built yet; point the user at the portable export for now.
		this._notify.info('A live shareable link is coming soon. Use Download to send a Markdown copy in the meantime.');
	}

	async editBlock(resource: URI, blockId: string, text: string): Promise<void> {
		const state = this._docs.get(resource.toString());
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === blockId);
		// Only non-bound prose/headings are hand-editable; bound blocks stay driven by their source.
		if (!block || block.binds.length > 0) { return; }
		const next = text.trim();
		if (block.text === next) { return; }
		block.text = next;
		await this._persist(state);
		this._onDidChange.fire();
	}

	// --- the fan-out refresh ---

	// Test seam (plan 30, track 2): swap the clock the per-host cooldown reads, so a test can advance the
	// 30 s window deterministically without wall-clock waits. Production always keeps the RealClock.
	setClock(clock: IClock): void { this._clock = clock; }

	async refreshFromSources(resource?: URI): Promise<void> {
		// One pass shares every source read + remote resolution across the documents it derives (plan 30,
		// track 1): a CSV bound by 20 documents is read once here, not 20 times.
		const pass = newRefreshPass();

		// Resolve the candidate document set: a scoped refresh starts from the one document; a project
		// refresh starts from every discovered bound document.
		const candidates = resource
			? [resource, ...await this._sharedSourceSiblings(resource, pass)]
			: await this._discoverLivingDocUris();

		// Changed-source-only scoping (plan 30, track 1): only re-derive documents whose bindings are
		// actually stale (the cheap hash check, already implemented in _recomputeFreshness), or that have
		// never been synced yet (a bind key with no lock entry). A folder whose sources have not moved and
		// is already synced does no derivation work. A single-document scope always includes the target
		// document itself (an explicit Refresh should re-sync it even when nothing looks stale).
		// Load the candidate states (cheap; dedups into _docs), then recompute their freshness CONCURRENTLY.
		// The freshness check re-reads sources through the same shared pass + limiters, so an api-backed check
		// no longer serialises one fetch at a time - the bounded concurrency applies to the pre-check too.
		const states: IDocState[] = [];
		for (const uri of candidates) {
			let state = this._docs.get(uri.toString());
			if (!state) { state = await this._loadState(uri); }
			if (state && state.doc.isLiving) { states.push(state); }
		}
		await Promise.all(states.map(state => this._recomputeFreshness(state, pass)));

		// Changed-source-only scoping (plan 30, track 1): only re-derive documents whose bindings are
		// actually stale (the cheap hash check, already implemented in _recomputeFreshness), or that have
		// never been synced yet (a bind key with no lock entry). A folder whose sources have not moved and
		// is already synced does no derivation work. A single-document scope always includes the target
		// document itself (an explicit Refresh should re-sync it even when nothing looks stale).
		const affected: IDocState[] = [];
		for (const state of states) {
			const isTarget = !!resource && state.uri.toString() === resource.toString();
			// Re-derive when: this is the explicitly-refreshed document; a source hash actually moved; a bind
			// key was never synced; OR the visible figures no longer match the lock's resolved values (the lock
			// is fresh vs the source but the prose cache is stale - e.g. a doc authored at an older value whose
			// lock bootstrapped to the current one on open). The last check preserves the pre-plan-30 behaviour
			// that a manual Refresh always reconciles the visible cache to the resolved values.
			if (isTarget || state.staleBindings.size > 0 || this._hasUnsyncedBind(state) || this._figureReconciles(state).length > 0) {
				affected.push(state);
			}
		}

		// Derive the affected documents concurrently (plan 30, track 2, D30-A). The documents kick off
		// together; the bounded concurrency lives ONE level down, inside each derive: remote source fetches
		// are gated by the source-fetch limiter (at most SOURCE_FETCH_CONCURRENCY in flight workspace-wide)
		// and model calls by the model limiter (2). Gating here at the document level too would deadlock,
		// because a document holding a slot then awaits a nested fetch on the same limiter. Each document's
		// derive is independent, so a rejecting fetch/model call inside one document fails only that document
		// (others complete); the shared pass keeps source reads deduplicated even under concurrency.
		let derived = 0;
		await Promise.all(affected.map(async state => {
			try {
				await this._deriveDocument(state, pass);
				derived++;
			} catch (e) {
				this._log.warn('[livingDocs] refresh failed for document', state.uri.toString(), e instanceof Error ? e.message : String(e));
			}
		}));

		for (const state of this._docs.values()) {
			if (state.doc.isLiving) { state.status = `${derived} document${derived === 1 ? '' : 's'} synced`; }
		}
		this._onDidChange.fire();
	}

	// True when the document declares a bind key the lock has never resolved (a never-synced doc). Such a
	// document must derive on the next refresh even when nothing looks "stale" (there is no prior hash to
	// compare against), so its figures land the first time round - the changed-source scope never drops it.
	private _hasUnsyncedBind(state: IDocState): boolean {
		for (const block of state.doc.blocks) {
			for (const b of block.binds) {
				if (!Object.prototype.hasOwnProperty.call(state.lock.bindings, b.key)) { return true; }
			}
		}
		return false;
	}

	// Derive one document within a refresh pass: re-sync its figures from the (shared-cached) sources,
	// snapshot the pre-change body once if a figure actually moved (D26-B), persist, and re-flag freshness.
	// Extracted so the refresh loop can run it through the concurrency limiter (plan 30, track 2).
	private async _deriveDocument(state: IDocState, pass: IRefreshPass): Promise<void> {
		// Snapshot the pre-refresh body BEFORE syncing writes the new one, but only keep it if the sync
		// actually re-derived a figure (D26-B: one snapshot per run that applied a change). A no-op refresh
		// leaves no version. `saveSnapshot` reads `state.rawText`, so capture here.
		const beforeBody = state.rawText;
		const changes = await this._syncLockWithDiff(state, pass);
		const afterBody = serializeLivingDoc(state.doc);
		if (changes.length && beforeBody !== afterBody) {
			await this.saveSnapshot(state.uri, 'Before refresh', 'refresh', beforeBody);
		}
		await this._persist(state);
		// The value bindings are now in sync, so their dirty bits clear (context stays stale until a
		// Review-impact pass, Item 5).
		await this._recomputeFreshness(state, pass);
	}

	// The documents that share a CHANGED source with `resource` (plan 30, track 1): the orchestrator's
	// reverse edges give the docs bound to each source; we keep only those whose target document's sources
	// actually moved, so a scoped Refresh fans out exactly to the co-dependents of what changed (never the
	// whole folder). The target document itself is added by the caller.
	private async _sharedSourceSiblings(resource: URI, pass: IRefreshPass): Promise<URI[]> {
		let state = this._docs.get(resource.toString());
		if (!state) { state = await this._loadState(resource); }
		if (!state || !state.doc.isLiving) { return []; }
		await this._recomputeFreshness(state, pass);
		// A source is "changed" for this document when one of its bind keys is stale. Map stale keys back to
		// their source alias, then walk the reverse edges to the other documents bound to those sources.
		const changedAliases = new Set<string>();
		for (const key of state.staleBindings) { changedAliases.add(key.split('.')[0]); }
		if (changedAliases.size === 0) { return []; }
		const siblings: URI[] = [];
		const seen = new Set<string>([resource.toString()]);
		for (const source of state.doc.sources) {
			const alias = sourceKind(source) === 'api' ? sourceAlias(parseApiSpec(source).url) : sourceAlias(source);
			if (!changedAliases.has(alias)) { continue; }
			for (const uri of await this._orchestrator.docsBoundToSource(source)) {
				if (seen.has(uri.toString())) { continue; }
				seen.add(uri.toString());
				siblings.push(uri);
			}
		}
		return siblings;
	}

	// "Run now": run an agent over its flow documents (or the whole workspace if it scopes none).
	async runAgent(agentId: string): Promise<IAgentRun | undefined> {
		await this._orchestrator.ensureLoaded();
		const agent = this._orchestrator.getAgent(agentId);
		if (!agent) { return undefined; }
		const docs = agent.flow.docs.length ? agent.flow.docs.map(d => URI.parse(d)) : await this._discoverLivingDocUris();
		return this._orchestrator.runAgent(agentId, 'manual', docs);
	}

	// The orchestration host: how an agent does its work once a trigger fires. Lifecycle hooks fire from the
	// document lifecycle (Item 5) and do no re-derive here. EVERY other trigger - cron, heartbeat, manual AND
	// event (plan 32 iter 1) - re-derives each in-scope document and routes its figure changes through the
	// verify gate then the per-edge policy (auto-apply / queue / draft). The event path is what makes a live
	// source edit ripple across the graph without a manual Refresh: propagation dirties the co-dependent docs,
	// the event agent's policy then decides whether their figures auto-apply (auto-figures) or queue (draft-only).
	private async _runAgent(agent: IAgentDef, context: IAgentRunContext): Promise<IAgentRunResult> {
		if (agent.trigger.kind === 'lifecycle') { return { applied: 0, queued: 0, docsTouched: 0 }; }
		let applied = 0;
		let queued = 0;
		let skipped = 0;
		let touched = 0;
		let blocked: string | undefined;
		const docs = context.docs;
		// One shared pass across the run's documents (plan 30, track 1): a source bound by many of the run's
		// documents is read/resolved once. The document loop stays SEQUENTIAL to preserve the plan-27 per-run
		// Stop contract (a Stop leaves every remaining document unprocessed and honestly skipped, in order);
		// the bounded concurrency lives inside each document's resolve (remote fetch / model-call limiters).
		const pass = newRefreshPass();
		for (let i = 0; i < docs.length; i++) {
			// A per-run Stop leaves every remaining document unprocessed and honestly skipped (plan 27 iter 4);
			// documents already processed keep whatever they applied/queued (reviewable work, not partial writes).
			if (context.token?.isCancellationRequested) { skipped = docs.length - i; break; }
			const uri = docs[i];
			const state = this._docs.get(uri.toString()) ?? await this._loadState(uri);
			if (!state || !state.doc.isLiving) { continue; }
			state.recent = new Set<string>();
			// Snapshot the doc's dirty keys BEFORE the awaited reconcile (plan 32 iter 2 fix, finding 1): a
			// concurrent source-watcher event can interleave during `_runFiguresByPolicy` and re-mark this doc
			// dirty; clearing only the snapshotted keys afterwards leaves that freshly-added bit for the heartbeat
			// to drain, instead of a blanket clear dropping it. Copied so a later propagate cannot mutate it.
			const dirtyBefore = this._orchestrator.getDirty(uri);
			const snapshot = dirtyBefore ? { value: [...dirtyBefore.value], influence: [...dirtyBefore.influence] } : undefined;
			let result: { applied: number; queued: number; blocked?: string };
			try {
				result = await this._runFiguresByPolicy(state, agent.policy, pass);
			} catch (e) {
				// The day's included usage is spent mid-run (plan 35 iter 3; doc 18 section 2.1): PAUSE the run via
				// D15 rather than dying or half-applying. This document and every remaining one are left unprocessed
				// and honestly skipped (in order); everything already applied/queued stays reviewable, and the run
				// resumes on its own at day rollover. The composer shows the plain-words message via `blocked`.
				if (isModelPausedError(e)) { blocked = e.message; skipped = docs.length - i; this._notify.info(e.message); break; }
				throw e;
			}
			applied += result.applied;
			queued += result.queued;
			touched++;
			if (result.blocked) { blocked = result.blocked; }
			if (result.applied) { await this._persist(state); } else { await this._lockStore.write(state.uri, state.lock).catch(e => this._log.warn('[livingDocs] lock write failed', e)); }
			await this._recomputeFreshness(state, pass);
			// A queue-draining trigger (heartbeat) or the event agent that just processed this doc clears the
			// dirty keys it reconciled: the value bindings are now reconciled/queued, so the sweep must not
			// re-flag them. Only the snapshotted keys clear, so an interleaved concurrent dirty survives.
			if (snapshot && (agent.trigger.kind === 'heartbeat' || agent.trigger.kind === 'event')) { this._orchestrator.clearDirtyKeys(uri, snapshot); }
		}
		this._onDidChange.fire();
		return { applied, queued, blocked, skipped, docsTouched: touched };
	}

	// --- the Review-impact pass (expensive, on-demand): spec 3.6 ---

	// Above this similarity a claim's anchor is taken to still point at the right prose; below it the
	// pass fails loudly with a re-link prompt rather than re-attaching to the wrong sentence.
	private static readonly _CLAIM_CONFIDENT = 0.5;

	async reviewImpact(resource: URI): Promise<void> {
		const id = resource.toString();
		const state = this._docs.get(id);
		if (!state || !state.doc.isLiving) { return; }

		// Review the changed context sources (or all of them if nothing is flagged dirty yet).
		const freshness = this.getFreshness(resource);
		const contextFiles = freshness.staleContext.length ? [...freshness.staleContext] : [...state.doc.context];
		const diff = await this._readContext(state, contextFiles);
		const modelAvailable = await this._hasModel();

		// Re-running the pass replaces this document's earlier impact candidates so it stays idempotent.
		this._pending = this._pending.filter(c => c.docId !== id);

		for (const target of this._claimTargets(state)) {
			if (target.relink) {
				// Guardrail 2: a low-confidence anchor match fails loudly - ask to re-link, never re-attach.
				this._pending.push(this._relinkPrompt(state, target, contextFiles));
				this._notify.info(`This commentary is bound to ${contextFiles.join(', ') || 'a source'} - re-link?`);
				continue;
			}
			const block = state.doc.blocks.find(b => b.id === target.blockId);
			if (!block) { continue; }
			const proposal = await this._proposeImpact(diff, contextFiles, block.text, modelAvailable);
			if (proposal.newText === block.text) { continue; }
			const change: IProposedChange = {
				id: generateUuid(),
				docId: id,
				docTitle: state.doc.title,
				blockId: block.id,
				blockLabel: this._blockLabel(state.doc, block.id),
				oldText: block.text,
				newText: proposal.newText,
				kind: proposal.kind,
				confidence: proposal.confidence,
				rationale: proposal.rationale,
				sourceCells: [],
				claimId: target.claimId,
				contextReviewed: contextFiles,
				via: proposal.via,
			};
			if (proposal.kind === 'figure') {
				// Confidence-gated routing (guardrail 4): figure-class ripples may auto-stage.
				if (block) { block.text = proposal.newText; block.binds = extractBindLinks(proposal.newText); state.recent.add(block.id); }
				state.lock.audit.push(this._entry(block.id, 'auto-applied', change.oldText, change.newText, proposal.via));
			} else {
				// Meaning/influence changes wait for approval in the review rail (no eager rewrites).
				this._pending.push(change);
			}
		}

		const queued = this._pending.filter(c => c.docId === id).length;
		state.status = modelAvailable
			? `${queued} impact ${queued === 1 ? 'change' : 'changes'} to review`
			: 'No model available - showing heuristic suggestions';
		await this._persist(state);
		this._onDidChange.fire();
		try {
			await this._views.openView(REVIEW_RAIL_VIEW_ID, false);
		} catch (e) {
			this._log.warn('[livingDocs] could not reveal review rail', e);
		}
	}

	// The prose targets the impact pass should consider: authored lock claims (relocated by fuzzy
	// match on their anchor), or - when none are authored - each non-bound prose paragraph as an
	// implicit influence target.
	private _claimTargets(state: IDocState): { claimId?: string; blockId?: string; relink?: boolean }[] {
		const claimIds = Object.keys(state.lock.claims);
		if (claimIds.length) {
			return claimIds.map(claimId => {
				const best = this._relocateClaim(state.doc, state.lock.claims[claimId].anchor);
				const relink = best.score < LivingDocsService._CLAIM_CONFIDENT;
				return { claimId, blockId: best.blockId, relink };
			});
		}
		return state.doc.blocks.filter(b => b.type === 'paragraph' && b.binds.length === 0).map(b => ({ blockId: b.id }));
	}

	// Relocate a claim by fuzzy-matching its stored anchor against the current prose (the file may have
	// moved/edited). Token-overlap similarity - deterministic, no model.
	private _relocateClaim(doc: ILivingDoc, anchor: string): { blockId: string | undefined; score: number } {
		let best: { blockId: string | undefined; score: number } = { blockId: undefined, score: 0 };
		for (const block of doc.blocks) {
			if (block.type === 'heading') { continue; }
			const score = similarity(anchor, block.text);
			if (score > best.score) { best = { blockId: block.id, score }; }
		}
		return best;
	}

	private _relinkPrompt(state: IDocState, target: { claimId?: string; blockId?: string }, contextFiles: string[]): IProposedChange {
		const claim = target.claimId ? state.lock.claims[target.claimId] : undefined;
		const best = target.blockId ? state.doc.blocks.find(b => b.id === target.blockId) : undefined;
		return {
			id: generateUuid(),
			docId: state.uri.toString(),
			docTitle: state.doc.title,
			blockId: target.blockId ?? '',
			blockLabel: 'Re-link claim',
			oldText: claim?.anchor ?? '',
			newText: best?.text ?? '',
			kind: 'meaning',
			confidence: 0,
			rationale: `This commentary is bound to ${contextFiles.join(', ') || 'a source'} but its anchor no longer matches the prose - re-link?`,
			sourceCells: [],
			claimId: target.claimId,
			contextReviewed: contextFiles,
			via: 'heuristic',
			relink: true,
		};
	}

	// --- model access: provider picker + survey (plan 35 iter 4) ---
	// All model credentials live in the proxy (decision 14); the renderer only reads status + drives the flow
	// through the proxy's HTTP routes. Every failure degrades to a safe default (the heuristic path) rather than
	// surfacing an error - the Settings step must never dead-end.

	// Read the active model door + usage from the proxy's /healthz. `ok` gates whether a backend is actually
	// serving (a signed-out ChatGPT tier or a key-less included tier reports ok:false -> provider 'none', the
	// built-in heuristic path). Today's spend is only meaningful for the metered `included` tier.
	async getModelProviderStatus(): Promise<IModelProviderStatus> {
		const fallback: IModelProviderStatus = { provider: 'none', signedIn: false, dailyBudgetUsd: 0 };
		try {
			const context = await this._request.request({ type: 'GET', url: `${this._proxyUrl()}/healthz`, callSite: 'livingDocs.providerStatus', disableCache: true }, CancellationToken.None);
			const json = await asJson<{ ok?: boolean; backend?: string; meters?: boolean; signedIn?: boolean; dailyBudgetUsd?: number; dailyTotalUsd?: number }>(context);
			if (!json) { return fallback; }
			const signedIn = json.signedIn === true;
			let provider: ModelProvider = 'none';
			if (json.ok === true) { provider = json.backend === 'openai-oauth' ? 'chatgpt' : 'included'; }
			return {
				provider,
				signedIn,
				dailyBudgetUsd: typeof json.dailyBudgetUsd === 'number' ? json.dailyBudgetUsd : 0,
				dailyTotalUsd: json.meters === true && typeof json.dailyTotalUsd === 'number' ? json.dailyTotalUsd : undefined,
			};
		} catch {
			return fallback;
		}
	}

	async startChatGptSignIn(): Promise<string | undefined> {
		try {
			const context = await this._request.request({ type: 'GET', url: `${this._proxyUrl()}/auth/openai/start`, callSite: 'livingDocs.signInStart', disableCache: true }, CancellationToken.None);
			const json = await asJson<{ authorizeUrl?: string }>(context);
			return json?.authorizeUrl;
		} catch (e) {
			this._log.warn('[livingDocs] ChatGPT sign-in start failed', e instanceof Error ? e.message : String(e));
			return undefined;
		}
	}

	async pollChatGptSignIn(): Promise<IChatGptSignInStatus> {
		try {
			const context = await this._request.request({ type: 'GET', url: `${this._proxyUrl()}/auth/openai/status`, callSite: 'livingDocs.signInStatus', disableCache: true }, CancellationToken.None);
			const json = await asJson<{ status?: string; error?: string }>(context);
			const stage = json?.status === 'signed-in' ? 'signed-in'
				: json?.status === 'pending' ? 'pending'
					: json?.status === 'error' ? 'error' : 'signed-out';
			// A newly-signed-in ChatGPT tier changes what the app can do; refresh model-backed UI once.
			if (stage === 'signed-in') { void this._probeModel(); this._onDidChange.fire(); }
			return { stage, error: json?.error };
		} catch {
			return { stage: 'signed-out' };
		}
	}

	async signOutChatGpt(): Promise<void> {
		try {
			await this._request.request({ type: 'POST', url: `${this._proxyUrl()}/auth/openai/signout`, headers: { 'content-type': 'application/json' }, data: '{}', callSite: 'livingDocs.signOut' }, CancellationToken.None);
			void this._probeModel();
			this._onDidChange.fire();
		} catch (e) {
			this._log.warn('[livingDocs] ChatGPT sign-out failed', e instanceof Error ? e.message : String(e));
		}
	}

	// Record the onboarding survey as the local `model_configured` event (doc 18 section 2.4). The proxy owns
	// the analytics audit sink (~/.abstract/events.log, alongside model-spend.log) so every event lands in one
	// place for plan 36's PostHog wiring; a failure is best-effort (the survey never blocks onboarding).
	async submitOnboardingSurvey(survey: IOnboardingSurvey): Promise<void> {
		try {
			const body = JSON.stringify({
				event: 'model_configured',
				daily_driver_model: survey.dailyDriverModel,
				owned_subscriptions: survey.ownedSubscriptions,
				weekly_output: survey.weeklyOutput,
			});
			await this._request.request({ type: 'POST', url: `${this._proxyUrl()}/event`, headers: { 'content-type': 'application/json' }, data: body, callSite: 'livingDocs.modelConfigured' }, CancellationToken.None);
		} catch (e) {
			this._log.warn('[livingDocs] model_configured event failed', e instanceof Error ? e.message : String(e));
		}
	}

	// The local OAuth proxy base URL (coerced - config stubs may return non-strings), trailing slash trimmed.
	private _proxyUrl(): string {
		const raw = this._config.getValue<string>('livingDocs.modelProxyUrl');
		const url = (typeof raw === 'string' && raw.length > 0) ? raw : DEFAULT_PROXY_URL;
		return url.replace(/\/+$/, '');
	}

	private _modelName(): string {
		const preferred = this._config.getValue<string>('livingDocs.commentaryModel');
		return (typeof preferred === 'string' && preferred.length > 0) ? preferred : DEFAULT_MODEL;
	}

	private async _hasModel(): Promise<boolean> {
		if (this._config.getValue<boolean>('livingDocs.useModel') === false) { return false; }
		return this._probeModel();
	}

	// Probe the proxy's /healthz once per TTL (reusing an in-flight probe) and cache the result so the
	// synchronous Skills report can read it. A change in availability fires onDidChange to refresh the UI.
	private async _probeModel(): Promise<boolean> {
		const now = Date.now();
		if (this._modelProbe && (now - this._modelProbedAt) < MODEL_PROBE_TTL_MS) {
			return this._modelProbe;
		}
		this._modelProbedAt = now;
		this._modelProbe = (async () => {
			let ok = false;
			try {
				const context = await this._request.request({ type: 'GET', url: `${this._proxyUrl()}/healthz`, callSite: 'livingDocs.modelProbe', disableCache: true }, CancellationToken.None);
				const json = await asJson<{ ok?: boolean }>(context);
				ok = !!json && json.ok === true;
			} catch {
				ok = false;
			}
			if (ok !== this._modelAvailable) {
				this._modelAvailable = ok;
				this._onDidChange.fire();
			}
			return ok;
		})();
		return this._modelProbe;
	}

	// POST one short request to the proxy and return the assistant text. Throws on a refusal or any
	// transport/parse error so the caller falls back to the deterministic path. Opus 4.8 request shape:
	// adaptive thinking, low effort, no sampling params (those 400). The credential stays in the proxy.
	// Call the model, retrying ONCE on a transient failure (plan 16 iter 5, decision 58). The OpenRouter
	// backend intermittently errors or returns an empty/refusal body on larger follow-ups; a single silent
	// retry recovers most of those before the caller's honest fallback ever shows. A refusal is NOT retried
	// (it would just refuse again). Only a genuine second failure propagates.
	private async _callModel(system: string, user: string): Promise<string> {
		// Bounded model concurrency (plan 30, track 2, D30-A): at most MODEL_CALL_CONCURRENCY buffered model
		// calls run at once, so a fan-out that grades/rewrites many documents never opens an unbounded burst
		// of proxy requests. The single silent retry (decision 58) stays inside the gated task.
		return this._modelLimiter.queue(async () => {
			try {
				return await this._callModelOnce(system, user);
			} catch (e) {
				if (e instanceof Error && e.message === 'model refused the request') { throw e; }
				// A paused call (spent daily budget) is not transient - retrying just pauses again; propagate it.
				if (isModelPausedError(e)) { throw e; }
				this._log.info('[livingDocs] model call failed, retrying once', e instanceof Error ? e.message : String(e));
				return await this._callModelOnce(system, user);
			}
		});
	}

	private async _callModelOnce(system: string, user: string): Promise<string> {
		const body = JSON.stringify({
			model: this._modelName(),
			max_tokens: MODEL_MAX_TOKENS,
			thinking: { type: 'adaptive' },
			output_config: { effort: 'low' },
			system,
			messages: [{ role: 'user', content: user }],
		});
		const context = await this._request.request({
			type: 'POST',
			url: `${this._proxyUrl()}/v1/messages`,
			headers: { 'content-type': 'application/json' },
			data: body,
			callSite: 'livingDocs.model',
		}, CancellationToken.None);
		const raw = await asText(context);
		if (!raw) { throw new Error('empty model response'); }
		const json = JSON.parse(raw) as { stop_reason?: string; content?: { type: string; text?: string }[]; error?: { message?: string } };
		if (json.error) { throw new Error(json.error.message ?? 'model proxy error'); }
		if (json.stop_reason === 'refusal') { throw new Error('model refused the request'); }
		const text = (json.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
		// The proxy paused this call because the day's included usage is spent (plan 35 iter 3): surface the
		// plain-words prose it returned as a ModelPausedError so callers keep it, queue no proposals, and pause.
		if (json.stop_reason === 'pause') { throw new ModelPausedError(text.trim() || INCLUDED_USAGE_SPENT_MESSAGE); }
		if (!text.trim()) { throw new Error('model returned no text'); }
		return text;
	}

	// Streaming variant of the model call (plan 27, decision D27-A). POSTs with `stream: true` and reads
	// the proxy's SSE response with a `fetch` + `ReadableStream` reader (the request service does not expose
	// a stream), accumulating and emitting each `content_block_delta` text as it arrives; resolves with the
	// full text so the EXISTING end-of-stream parse (parseChatResponse) is unchanged - proposals are only
	// ever committed from the complete response, never from a partial. On `token` cancellation the fetch is
	// aborted and a distinguishable CancellationError is thrown so the caller can salvage the streamed prose
	// (D27-B) rather than treating it as a failure. The credential stays in the proxy (decision 14).
	private async _callModelStream(system: string, user: string, onDelta: (text: string) => void, token: CancellationToken): Promise<string> {
		const controller = new AbortController();
		const sub = token.onCancellationRequested(() => controller.abort());
		try {
			if (token.isCancellationRequested) { throw new CancellationError(); }
			const body = JSON.stringify({
				model: this._modelName(),
				max_tokens: MODEL_MAX_TOKENS,
				thinking: { type: 'adaptive' },
				output_config: { effort: 'low' },
				stream: true,
				system,
				messages: [{ role: 'user', content: user }],
			});
			const response = await fetch(`${this._proxyUrl()}/v1/messages`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
				signal: controller.signal,
			});
			if (!response.ok || !response.body) { throw new Error(`model proxy http ${response.status}`); }
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let full = '';
			let paused = false;
			while (true) {
				const { done, value } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				const result = parseSseChunk(buffer);
				buffer = result.remainder;
				for (const delta of result.deltas) {
					full += delta;
					onDelta(delta);
				}
				if (result.paused) { paused = true; }
				if (result.done) { break; }
			}
			if (token.isCancellationRequested) { throw new CancellationError(); }
			// The proxy paused mid-stream because the day's included usage is spent (plan 35 iter 3): the plain-
			// words cap prose has already streamed to the composer; raise ModelPausedError so no proposals parse.
			if (paused) { throw new ModelPausedError(full.trim() || INCLUDED_USAGE_SPENT_MESSAGE); }
			if (!full.trim()) { throw new Error('model returned no text'); }
			return full;
		} catch (e) {
			// An aborted fetch (name 'AbortError') or a cancelled token both mean the user stopped the reply.
			if (token.isCancellationRequested || (e instanceof Error && e.name === 'AbortError')) { throw new CancellationError(); }
			throw e;
		} finally {
			sub.dispose();
		}
	}

	// The chat model-call ladder (plan 27 iter 2): stream first; on a NON-cancel stream failure fall back once
	// to the buffered _callModel (which itself keeps the decision-58 single silent retry); a genuine failure
	// there propagates to the caller's honest heuristic fallback. Cancellation is re-thrown untouched so the
	// streamed prose can be salvaged (D27-B) rather than being retried or masked as an error.
	private async _chatModelCall(system: string, user: string, onDelta: (text: string) => void, token: CancellationToken): Promise<string> {
		try {
			return await this._callModelStream(system, user, onDelta, token);
		} catch (e) {
			if (isCancellationError(e)) { throw e; }
			// A pause (spent daily budget) is not a stream failure to retry - the buffered path would just pause
			// again and charge nothing extra; propagate it so the caller shows the plain-words cap turn.
			if (isModelPausedError(e)) { throw e; }
			this._log.info('[livingDocs] streaming chat call failed, falling back to buffered call', e instanceof Error ? e.message : String(e));
			return await this._callModel(system, user);
		}
	}

	private async _proposeImpact(diff: string, contextFiles: string[], oldText: string, modelAvailable: boolean): Promise<{ newText: string; kind: 'figure' | 'meaning'; confidence: number; rationale: string; via: 'model' | 'heuristic' }> {
		if (modelAvailable) {
			try {
				return await this._modelImpact(diff, contextFiles, oldText);
			} catch (e) {
				this._log.info('[livingDocs] model impact failed, using heuristic', e instanceof Error ? e.message : String(e));
			}
		}
		return this._heuristicImpact(diff, contextFiles, oldText);
	}

	private async _modelImpact(diff: string, contextFiles: string[], oldText: string): Promise<{ newText: string; kind: 'figure' | 'meaning'; confidence: number; rationale: string; via: 'model' }> {
		const system = 'You revise one sentence of business commentary so it stays consistent with a changed source. '
			+ 'Reply with ONLY a JSON object: {"newText": string, "kind": "figure" | "meaning", "confidence": number, "rationale": string}. '
			+ 'Use kind="meaning" when the qualitative framing should change; otherwise kind="figure" and return newText unchanged.';
		const user = `The source(s) ${contextFiles.join(', ')} now read:\n"""${diff}"""\nCurrent commentary: "${oldText}". Revise it if the framing should change.`;
		const text = await this._callModel(system, user);
		const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
		return {
			newText: String(json.newText ?? oldText),
			kind: json.kind === 'meaning' ? 'meaning' : 'figure',
			confidence: typeof json.confidence === 'number' ? json.confidence : 0.8,
			rationale: String(json.rationale ?? ''),
			via: 'model',
		};
	}

	// The no-model path is a VISIBLE, conservative suggestion (not a silent degrade): it surfaces the
	// salient change and proposes a clearly-heuristic addition for the user to approve or reject.
	private _heuristicImpact(diff: string, contextFiles: string[], oldText: string): { newText: string; kind: 'meaning'; confidence: number; rationale: string; via: 'heuristic' } {
		const salient = diff.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).pop() ?? '';
		const note = salient ? ` In light of an update to ${contextFiles.join(', ')} ("${salient}"), revisit whether this still holds.` : ` ${contextFiles.join(', ')} changed since last review - revisit this.`;
		return {
			newText: `${oldText}${note}`,
			kind: 'meaning',
			confidence: 0.5,
			rationale: `Heuristic suggestion (no model available): ${contextFiles.join(', ')} changed since last review.`,
			via: 'heuristic',
		};
	}

	private async _readContext(state: IDocState, files: string[]): Promise<string> {
		const parts: string[] = [];
		for (const file of files) {
			if (sourceKind(file) === 'api') { continue; }
			try {
				parts.push((await this._files.readFile(joinPath(dirname(state.uri), file))).value.toString());
			} catch {
				// An unreadable context source contributes nothing to the diff.
			}
		}
		return parts.join('\n\n');
	}

	private _blockLabel(doc: ILivingDoc, blockId: string): string {
		let heading = '';
		for (const b of doc.blocks) {
			if (b.type === 'heading') { heading = b.text; }
			if (b.id === blockId) { return heading || blockId; }
		}
		return blockId;
	}

	// --- Chat agent (the right-panel Chat tab) ---

	getChatMessages(resource: URI): readonly IChatMessage[] {
		return this._chats.get(resource.toString()) ?? [];
	}

	// --- working set (plan 18): the documents a chat instruction edits across ---

	getWorkingSet(resource: URI): readonly IWorkingSetDoc[] {
		return this._workingSets.get(resource.toString()) ?? [];
	}

	async addToWorkingSet(resource: URI, docs: readonly URI[]): Promise<void> {
		const id = resource.toString();
		const set = this._workingSets.get(id) ?? [];
		const known = new Set(set.map(d => d.resource.toString()));
		let added = false;
		for (const doc of docs) {
			if (known.has(doc.toString())) { continue; }
			// Resolve a human title for the chip: the loaded doc's title, else a parsed summary, else the file name.
			const title = this.getDoc(doc)?.title ?? (await this._summarize(doc))?.title ?? basename(doc);
			set.push({ resource: doc, title });
			known.add(doc.toString());
			added = true;
		}
		if (added) {
			this._workingSets.set(id, set);
			this._onDidChange.fire();
		}
	}

	async addFolderToWorkingSet(resource: URI): Promise<void> {
		const docs = await this.listDocuments();
		await this.addToWorkingSet(resource, docs.map(d => d.resource));
	}

	removeFromWorkingSet(resource: URI, doc: URI): void {
		const id = resource.toString();
		const set = this._workingSets.get(id);
		if (!set) { return; }
		const next = set.filter(d => d.resource.toString() !== doc.toString());
		if (next.length === set.length) { return; }
		this._workingSets.set(id, next);
		this._onDidChange.fire();
	}

	// Empty an anchor's working set (plan 37, F14): used before a scoped retry rebuilds the set from just the
	// documents a model outage never reached, so the fan-out re-runs surgically over the failed docs alone.
	clearWorkingSet(resource: URI): void {
		const id = resource.toString();
		if (!this._workingSets.has(id)) { return; }
		this._workingSets.delete(id);
		this._onDidChange.fire();
	}

	async getWorkingSetCandidates(resource: URI): Promise<readonly IWorkingSetDoc[]> {
		const inSet = new Set(this.getWorkingSet(resource).map(d => d.resource.toString()));
		const docs = await this.listDocuments();
		return docs.filter(d => !inSet.has(d.resource.toString())).map(d => ({ resource: d.resource, title: d.title }));
	}

	getMentionableFiles(resource: URI): readonly string[] {
		const state = this._docs.get(resource.toString());
		if (!state) { return []; }
		// Declared sources/context PLUS the real folder documents - so @mention can reference any folder file,
		// not only frontmatter-declared ones (R6).
		const out = new Set<string>([...state.doc.sources, ...state.doc.context, ...state.folderFiles]);
		return [...out].sort((a, b) => a.localeCompare(b));
	}

	isChatBusy(resource: URI): boolean {
		return this._chatBusy.has(resource.toString());
	}

	async sendChatMessage(resource: URI, text: string, displayText?: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) { return; }
		const id = resource.toString();
		const history = this._chats.get(id) ?? [];
		this._chats.set(id, history);

		const mentions = this._parseMentions(resource, trimmed);
		// F4 (walk 1b): the visible user turn is `displayText` when the caller supplies a plain-words summary
		// (e.g. template generation), so the internal brief/prompt is never dumped verbatim into the rail (P5).
		// The full `trimmed` instruction still drives the model; only the transcript entry is the human line.
		const shown = displayText?.trim() || trimmed;
		history.push({ role: 'user', content: shown, mentions: mentions.length ? mentions : undefined });
		await this._deliverChatReply(resource, trimmed, mentions);
	}

	getStreamingChat(resource: URI): { readonly text: string; readonly steps: readonly IChatStep[] } | undefined {
		return this._chatStreaming.get(resource.toString());
	}

	getFanoutProgress(resource: URI): IFanoutProgress | undefined {
		return this._fanoutProgress.get(resource.toString());
	}

	retryChat(resource: URI): void {
		const id = resource.toString();
		const history = this._chats.get(id);
		// Never retry while a reply is in flight, or when there is nothing to retry.
		if (!history || !history.length || this._chatBusy.has(id)) { return; }
		// Drop the failed assistant turn(s) so the retry REPLACES them (the user turn is kept and re-run - no
		// duplicate user message). Only retry a genuinely failed turn; a stopped / guidance turn is left alone.
		if (history[history.length - 1].role !== 'assistant' || !history[history.length - 1].failed) { return; }
		while (history.length && history[history.length - 1].role === 'assistant') { history.pop(); }
		const last = history[history.length - 1];
		if (!last || last.role !== 'user') { return; }
		const mentions = last.mentions ? [...last.mentions] : this._parseMentions(resource, last.content);
		void this._deliverChatReply(resource, last.content, mentions);
	}

	// The shared chat-turn delivery (plan 27 iters 2-3): sets busy, opens a per-document cancellation source,
	// streams the reply into a live turn (onDelta appends prose, onStep appends tool steps as they settle),
	// then pushes the final assistant turn. A cancel keeps the salvaged prose as a muted "stopped" turn
	// (D27-B); a genuine failure pushes a "failed" turn the rail offers Retry on. The user turn is already the
	// last history entry (pushed by sendChatMessage, or kept by retryChat), so the transcript reads correctly.
	private async _deliverChatReply(resource: URI, trimmed: string, mentions: string[]): Promise<void> {
		const id = resource.toString();
		const history = this._chats.get(id) ?? [];
		this._chats.set(id, history);
		this._chatBusy.add(id);
		// One cancellation source per in-flight reply (plan 27); cancelChat cancels it, this method disposes it.
		const cancellers = this._chatCancellers;
		cancellers.get(id)?.dispose();
		const cts = new CancellationTokenSource();
		cancellers.set(id, cts);
		// The live turn the rail renders while the reply streams; the salvage on cancel reads its `text`.
		const streaming = { text: '', steps: [] as IChatStep[] };
		this._chatStreaming.set(id, streaming);
		// Accumulate the raw model text but SHOW the human `reply` prose, so the live turn reads as words
		// rather than the raw `{"reply":"..."}` envelope (plan 27 iter 3). The end-of-stream parse still runs
		// over the complete raw text (returned by _callModelStream), so the proposal contract is unchanged.
		let rawStream = '';
		const onDelta = (delta: string) => { rawStream += delta; streaming.text = extractStreamingReply(rawStream); this._onDidStreamChat.fire(resource); };
		const onStep = (step: IChatStep) => { streaming.steps.push(step); this._onDidStreamChat.fire(resource); };
		this._onDidChange.fire();

		try {
			// Chat is available on EVERY open document (decision 48): "living" is just a data-binding badge,
			// not a chat gate. A plain doc simply has no sources/figures, so the agent answers from the prose
			// alone and can still generate/insert/revise content. Only an unopened doc has no state to chat over.
			const state = this._docs.get(id);
			if (!state) {
				history.push({ role: 'assistant', via: 'fallback', content: 'Open a document in the editor to chat about it - I answer using the document and its sources.' });
				return;
			}
			if (!await this._hasModel()) {
				history.push({ role: 'assistant', via: 'fallback', content: 'The agent model is not reachable. Start the local proxy (scripts/lwd-anthropic-proxy.sh) and I can answer using this document and its sources.' });
				return;
			}
			// A working set fans the instruction across every doc in one model call (plan 18, decision 62);
			// with no set the chat stays single-doc against the active document (decision 61).
			const workingSet = this.getWorkingSet(resource);
			const reply = workingSet.length
				? await this._chatRespondMulti(state, trimmed, mentions, workingSet, onDelta, onStep, cts.token)
				: await this._chatRespond(state, trimmed, mentions, onDelta, onStep, cts.token);
			history.push(reply);
		} catch (e) {
			// A cancel is NOT a failure: keep the prose streamed so far as a muted "stopped" turn and queue no
			// proposals (they are only ever committed from the complete response). Everything else is honest error.
			if (isCancellationError(e)) {
				const salvage = streaming.text.trim();
				history.push({ role: 'assistant', via: 'model', content: salvage, stopped: true });
			} else if (isModelPausedError(e)) {
				// The day's included usage is spent (plan 35 iter 3): show the plain-words cap message as a calm
				// turn - NOT a failure, NOT retryable (retrying just pauses again), and queue no proposals. It
				// resumes on its own at day rollover, or immediately once the user signs in with ChatGPT.
				history.push({ role: 'assistant', via: 'fallback', content: e.message });
			} else {
				this._log.info('[livingDocs] chat failed, honest fallback', e instanceof Error ? e.message : String(e));
				// A genuine model error offers Retry (plan 27 iter 3): the rail re-sends this same user message.
				history.push({ role: 'assistant', via: 'fallback', failed: true, content: 'The model call failed.' });
			}
		} finally {
			cts.dispose();
			if (cancellers.get(id) === cts) { cancellers.delete(id); }
			this._chatStreaming.delete(id);
			this._chatBusy.delete(id);
			this._onDidChange.fire();
		}
	}

	cancelChat(resource: URI): void {
		this._chatCancellers.get(resource.toString())?.cancel();
	}

	// Build the model prompt from the document (figures resolved) + the @mentioned and context sources,
	// ask for a reply plus optional prose edits, render tool-steps, and queue any edits into the rail.
	private async _chatRespond(state: IDocState, text: string, mentions: string[], onDelta: (text: string) => void, onStep: (step: IChatStep) => void, token: CancellationToken): Promise<IChatMessage> {
		const docText = this._serializeDocForChat(state);
		const sourceFiles = mentions.length ? mentions : [...state.doc.sources, ...state.doc.context];
		const sources = await this._readContext(state, sourceFiles);
		const headings = state.doc.blocks.filter(b => b.type === 'heading').map(b => b.text);
		const system = 'You are the agent inside a Living Document editor, holding one continuing conversation about the open document. '
			+ 'Use the prior turns for context - a follow-up like "change a couple of them" refers to content you proposed earlier, applied over the CURRENT document shown below. '
			+ 'You can (a) rewrite existing prose paragraphs and (b) GENERATE new content to insert (lists, a new section). Never touch bound figures. '
			+ 'Reply with ONLY a JSON object: {"reply": string, '
			+ '"edits": [{"heading": string, "oldText": string, "newText": string, "rationale": string}], '
			+ '"inserts": [{"afterHeading": string, "newText": string, "rationale": string}]}. '
			+ 'Use "edits" to rewrite an existing paragraph (oldText must quote the current prose). Use "inserts" to add NEW content: newText is Markdown (e.g. a numbered or bulleted list) placed after the named heading (empty afterHeading = end of the document). '
			+ 'Propose changes only when the user asks to write, generate or revise; otherwise return empty arrays. Keep reply concise.';
		const transcript = this._chatTranscript(state.uri);
		const user = `Document "${state.doc.title}" (${state.doc.subtitle}):\n${docText}\n\nHeadings: ${headings.join(' | ') || '(none)'}\n\nSources (${sourceFiles.join(', ') || 'none'}):\n"""${sources}"""\n\n${transcript}User: ${text}`;
		const raw = await this._chatModelCall(system, user, onDelta, token);
		// Tolerant parse (plan 16 iter 5): a non-JSON / truncated / prose-wrapped reply degrades to a plain
		// chat answer instead of throwing (which used to surface as a false "the agent model errored").
		const json = parseChatResponse(raw);

		const steps: IChatStep[] = [];
		const proposedIds: string[] = [];
		// Emit each tool step to the live turn as it settles (plan 27 iter 3), as well as collecting it for
		// the final message - so the rail shows the steps appearing rather than all at once at stream end.
		const addStep = (step: IChatStep) => { steps.push(step); onStep(step); };
		if (sourceFiles.length) { addStep({ label: `Read ${sourceFiles.join(', ')}`, status: 'done' }); }
		for (const edit of json.edits) {
			const queued = this._queueChatEdit(state, edit);
			if (queued) { addStep({ label: `Proposed edit: ${queued.label}`, status: 'queued' }); proposedIds.push(queued.id); }
		}
		for (const insert of json.inserts) {
			const queued = this._queueChatInsert(state, insert);
			if (queued) { addStep({ label: `Proposed new content after ${queued.label}`, status: 'queued' }); proposedIds.push(queued.id); }
		}
		// What the bubble shows: the model's reply when it gave one; nothing when proposals carry the meaning
		// (their cards speak); otherwise a neutral honest line. `parseChatResponse` already routed a non-JSON
		// plain-text answer into `reply`, so a truthy `reply` is always real prose -- we NEVER surface the raw
		// JSON envelope (a parsed-but-empty reply used to leak `{"reply":"",...}` into the chat).
		const content = json.reply || (proposedIds.length ? '' : 'I do not have anything to add on that.');
		return {
			role: 'assistant', via: 'model', content,
			steps: steps.length ? steps : undefined,
			proposedIds: proposedIds.length ? proposedIds : undefined,
		};
	}

	// Fan one instruction across the whole working set in a SINGLE model call (plan 18, decision 62). The
	// model is shown every target document (figures resolved) and asked for a per-document edit map; each
	// doc's edits/inserts are routed into the existing proposal queue tagged with that doc's id, so the
	// Review rail's per-document grouping + approve/reject loop is reused unchanged. Plain and living docs
	// flow through the same path (decision 63).
	private async _chatRespondMulti(active: IDocState, text: string, mentions: string[], workingSet: readonly IWorkingSetDoc[], onDelta: (text: string) => void, onStep: (step: IChatStep) => void, token: CancellationToken): Promise<IChatMessage> {
		// Ensure every target document is loaded so it can be serialized for the prompt and edited.
		for (const wsDoc of workingSet) {
			if (!this._docs.get(wsDoc.resource.toString())) { await this.loadDocument(wsDoc.resource); }
		}
		const states = workingSet
			.map(ws => this._docs.get(ws.resource.toString()))
			.filter((s): s is IDocState => !!s);

		const sourceFiles = mentions.length ? mentions : [...active.doc.sources, ...active.doc.context];
		const sources = await this._readContext(active, sourceFiles);

		const system = 'You are the agent inside a Living Document editor. The user has selected a WORKING SET of documents and given ONE instruction to apply across ALL of them. '
			+ 'Apply the instruction to every document where it is relevant; a document that needs no change simply gets empty arrays. Never touch bound figures. '
			+ 'GROUND every change in a specific decision from the attached source: for each edit and insert, include "sourceQuote" (a short VERBATIM sentence copied from the attached source that this change implements) and "sourceLine" (the 1-based line number of that sentence in the attached source, if the source shows numbered lines). '
			+ 'Reply with ONLY a JSON object: {"reply": string, "docs": [{"doc": string, '
			+ '"edits": [{"heading": string, "oldText": string, "newText": string, "rationale": string, "sourceQuote": string, "sourceLine": number}], '
			+ '"inserts": [{"afterHeading": string, "newText": string, "rationale": string, "sourceQuote": string, "sourceLine": number}]}]}. '
			+ 'The "doc" field MUST be the exact document title shown below. Use "edits" to rewrite an existing paragraph (oldText must quote the current prose). Use "inserts" to add NEW content after the named heading (empty afterHeading = end of that document). Keep reply concise.';
		const transcript = this._chatTranscript(active.uri);

		// D30-B: pack the working set into context-bounded batches instead of sending every document body in
		// one over-large call. Serialize each document once (the body the model is shown), estimate the fixed
		// per-call overhead (system + shared sources + transcript, which ride EVERY batch), and let the pure
		// planner split the docs into batches that fit the configured budget - flagging any single document
		// too large for the budget as `oversize` (reported honestly, never sent, never truncated).
		const sectionFor = (s: IDocState) => {
			const headings = s.doc.blocks.filter(b => b.type === 'heading').map(b => b.text);
			return `### Document: "${s.doc.title}"\n${this._serializeDocForChat(s)}\nHeadings: ${headings.join(' | ') || '(none)'}`;
		};
		const stateByTitle = new Map(states.map(s => [s.doc.title.trim().toLowerCase(), s]));
		const fanoutDocs: IFanoutDoc[] = states.map(s => ({ id: s.uri.toString(), title: s.doc.title, body: sectionFor(s) }));
		const budget = this._fanoutContextBudget();
		// Everything that is NOT a document body but still consumed by every call, so a batch's usable space is
		// budget - overhead. The `Working set (N documents):` scaffold + the `Shared sources ...` framing are
		// small and folded into the transcript estimate here.
		const overhead = estimateTokens(system) + estimateTokens(sources) + estimateTokens(transcript) + estimateTokens(text) + 64;
		const plan = planFanoutBatches(fanoutDocs, budget, overhead);

		const steps: IChatStep[] = [];
		const proposedIds: string[] = [];
		const addStep = (step: IChatStep) => { steps.push(step); onStep(step); };
		if (sourceFiles.length) { addStep({ label: `Read ${sourceFiles.join(', ')}`, status: 'done' }); }

		// Publish the fan-out's batch progress so the project-run command strip can show `batch K of M` and
		// the oversize documents' tiles read the honest "too large for this run" state. Keyed on the anchor
		// (this chat's own document), overwritten each batch, and kept after the run settles so a completed
		// swarm still shows which documents were too large. Fires onDidChange so the run screen re-renders.
		const anchorId = active.uri.toString();
		const oversizeDocIds = plan.oversize.map(d => d.id);
		const publishProgress = (batchIndex: number) => {
			this._fanoutProgress.set(anchorId, { batchIndex, batchCount: plan.batchCount, oversizeDocIds });
			this._onDidChange.fire();
		};
		publishProgress(0);
		// Announce every oversize document up front (plan-23 honesty rule): a document larger than the whole
		// budget is NEVER sent - its tile/step says so rather than the run silently dropping it.
		for (const doc of plan.oversize) {
			addStep({ label: `${doc.title}: too large for this run`, status: 'queued' });
		}

		let anyReply = '';
		// Run the batches in order. Each doc appears in exactly ONE batch (uniqueness by construction), so the
		// per-batch keyed replies simply concatenate into the pending queue with no double-count or drop. The
		// first batch STREAMS its prose into the live turn (onDelta); later batches use the buffered call (no
		// delta) so the live turn is not scrambled by interleaved prose - their steps still settle live. The
		// buffered `_callModel` is bounded by the plan-30 track-2 model limiter.
		for (let b = 0; b < plan.batches.length; b++) {
			if (token.isCancellationRequested) { throw new CancellationError(); }
			const batch = plan.batches[b];
			publishProgress(b + 1);
			if (plan.batchCount > 1) { addStep({ label: `Batch ${b + 1} of ${plan.batchCount} (${batch.docs.length} documents)`, status: 'done' }); }
			const docSections = batch.docs.map(d => d.body).join('\n\n');
			const user = `Working set (${batch.docs.length} documents):\n\n${docSections}\n\nShared sources (${sourceFiles.join(', ') || 'none'}):\n"""${sources}"""\n\n${transcript}User: ${text}`;
			const raw = b === 0
				? await this._chatModelCall(system, user, onDelta, token)
				: await this._callModel(system, user);
			const json = parseMultiChatResponse(raw);
			if (json.reply && !anyReply) { anyReply = json.reply; }
			// Match each returned doc entry to a document IN THIS BATCH by title, then queue its edits/inserts
			// against that document's own state (so proposals carry the right docId for the rail grouping). The
			// match is restricted to the batch's own documents so a reply that names an out-of-batch doc cannot
			// route an edit to a document that batch was never shown - keeping "each doc in exactly one batch"
			// airtight (a document is only ever edited by the one batch that actually contained its body).
			const batchByTitle = new Map(batch.docs.map(d => [d.title.trim().toLowerCase(), stateByTitle.get(d.title.trim().toLowerCase())]));
			for (const entry of json.docs) {
				const target = batchByTitle.get(entry.doc.trim().toLowerCase());
				if (!target) { continue; }
				for (const edit of entry.edits) {
					const queued = this._queueChatEdit(target, edit, sources);
					if (queued) { addStep({ label: `${target.doc.title}: ${queued.label}`, status: 'queued' }); proposedIds.push(queued.id); }
				}
				for (const insert of entry.inserts) {
					const queued = this._queueChatInsert(target, insert, sources);
					if (queued) { addStep({ label: `${target.doc.title}: new content after ${queued.label}`, status: 'queued' }); proposedIds.push(queued.id); }
				}
			}
		}
		// Mark the fan-out as no longer on a live batch (batchIndex 0) while keeping the batchCount + oversize
		// set, so the settled run screen still reads "N documents too large" without a spurious live "batch K".
		this._fanoutProgress.set(anchorId, { batchIndex: 0, batchCount: plan.batchCount, oversizeDocIds });

		const content = anyReply || (proposedIds.length ? '' : 'I did not find anything to change across those documents.');
		return {
			role: 'assistant', via: 'model', content,
			steps: steps.length ? steps : undefined,
			proposedIds: proposedIds.length ? proposedIds : undefined,
		};
	}

	// The configured fan-out context budget in tokens (plan 30, track 3, D30-B). Reads the user-overridable
	// `livingDocs.fanoutContextBudget` (default 24k), floored at a small minimum so a mis-set value can never
	// produce a budget that packs nothing.
	private _fanoutContextBudget(): number {
		const raw = this._config.getValue<number>('livingDocs.fanoutContextBudget');
		return typeof raw === 'number' && Number.isFinite(raw) && raw >= 2000 ? raw : 24000;
	}

	// Render the last few turns for the model so a follow-up ("change a couple of them") resolves against
	// what was already said. The caller has already pushed the current user turn, so drop the last entry.
	private _chatTranscript(resource: URI): string {
		const prior = (this._chats.get(resource.toString()) ?? []).slice(0, -1).slice(-6);
		if (!prior.length) { return ''; }
		const lines = prior.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
		return `Conversation so far:\n${lines.join('\n')}\n\n`;
	}

	// Locate the prose block an edit targets (best token-overlap match under the named heading) and queue
	// a meaning-class change for it. Bound (figure) blocks and no-op rewrites are skipped. Returns the
	// block label when queued, else undefined.
	private _queueChatEdit(state: IDocState, edit: { heading?: string; oldText?: string; newText?: string; rationale?: string; sourceQuote?: string; sourceLine?: number }, sourceText?: string): { id: string; label: string } | undefined {
		const newText = String(edit.newText ?? '').trim();
		const oldText = String(edit.oldText ?? '').trim();
		if (!newText || !oldText) { return undefined; }
		let best: ILivingDocBlock | undefined;
		let bestScore = 0.5;
		for (const block of state.doc.blocks) {
			if (block.type === 'heading') { continue; }
			// A wholly-bound block (a figure paragraph) is never chat-editable. A LIST block may carry a bind
			// in one item while other items are plain prose the agent can revise, so lists stay candidates and
			// the per-item bind guard below protects the bound item (decision-68 fix, plan 31 iter 1).
			if (block.binds.length && listItems(block.text).length < 2) { continue; }
			// Score against the item the edit targets, not the whole block, so a single-item edit to a long
			// list can still select that list block (the whole-list token set otherwise dilutes the match).
			const score = similarity(scopeBlockEdit(block.text, oldText).oldText, oldText);
			if (score > bestScore) { bestScore = score; best = block; }
		}
		if (!best) { return undefined; }
		// Anchor the edit at the targeted list item's boundary (or the whole block for prose). Storing the
		// scoped `oldText` is what makes approve splice just this item and keep its siblings byte-identical.
		const scoped = scopeBlockEdit(best.text, oldText);
		// Never touch a bound figure: if the targeted range still carries a bind link, skip this edit.
		if (extractBindLinks(scoped.oldText).length) { return undefined; }
		if (scoped.oldText.trim() === newText) { return undefined; }
		const label = this._blockLabel(state.doc, best.id);
		const id = generateUuid();
		const grounding = this._resolveSourceGrounding(edit.sourceQuote, edit.sourceLine, sourceText);
		this._pending.push({
			id,
			docId: state.uri.toString(),
			docTitle: state.doc.title,
			blockId: best.id,
			blockLabel: label,
			oldText: scoped.oldText,
			newText,
			kind: 'meaning',
			confidence: 0.85,
			rationale: String(edit.rationale ?? 'Proposed by the Chat agent.'),
			sourceCells: [],
			via: 'model',
			...grounding,
		});
		return { id, label };
	}

	// Resolve the source grounding for a fan-out change (plan 23.4, decision #77): keep the model's
	// verbatim quote, and take its line number from the model when given, else look the quote up in the
	// real source text to fill a TRUE line. If the quote is not found we leave the line undefined - the
	// card then shows the quote with no line chip. A line number is NEVER fabricated.
	private _resolveSourceGrounding(sourceQuote?: string, sourceLine?: number, sourceText?: string): { sourceQuote?: string; sourceLine?: number } {
		const quote = typeof sourceQuote === 'string' ? sourceQuote.trim() : '';
		if (!quote) { return {}; }
		if (typeof sourceLine === 'number' && Number.isFinite(sourceLine)) {
			return { sourceQuote: quote, sourceLine };
		}
		const found = sourceText ? findQuoteLine(sourceText, quote) : undefined;
		return found ? { sourceQuote: quote, sourceLine: found } : { sourceQuote: quote };
	}

	// Queue a generative insertion: brand-new Markdown content (a list, a section) to be added after the
	// named heading (best fuzzy match; empty/unknown -> end of document). No oldText - the inline diff
	// renders it all-additions, and approve splices a new block into the document.
	private _queueChatInsert(state: IDocState, insert: { afterHeading?: string; newText?: string; rationale?: string; sourceQuote?: string; sourceLine?: number }, sourceText?: string): { id: string; label: string } | undefined {
		const newText = String(insert.newText ?? '').trim();
		if (!newText) { return undefined; }
		const afterHeading = String(insert.afterHeading ?? '').trim();
		let afterBlockId = '';
		let label = 'the end';
		if (afterHeading) {
			let best: ILivingDocBlock | undefined;
			let bestScore = 0.5;
			for (const block of state.doc.blocks) {
				if (block.type !== 'heading') { continue; }
				const score = similarity(block.text, afterHeading);
				if (score > bestScore) { bestScore = score; best = block; }
			}
			if (best) { afterBlockId = best.id; label = best.text; }
		}
		const id = generateUuid();
		this._pending.push({
			id,
			docId: state.uri.toString(),
			docTitle: state.doc.title,
			blockId: afterBlockId,
			blockLabel: label,
			oldText: '',
			newText,
			kind: 'meaning',
			confidence: 0.8,
			rationale: String(insert.rationale ?? 'New content proposed by the Chat agent.'),
			sourceCells: [],
			via: 'model',
			insert: true,
			afterBlockId,
			...this._resolveSourceGrounding(insert.sourceQuote, insert.sourceLine, sourceText),
		});
		return { id, label };
	}

	private _parseMentions(resource: URI, text: string): string[] {
		if (!text.includes('@')) { return []; }
		return this.getMentionableFiles(resource).filter(f => text.includes(`@${f}`));
	}

	// The document as clean prose for the model: title + headings + paragraphs with bind links resolved
	// to their live values (so the agent reasons over the figures the reader sees, not the raw markup).
	private _serializeDocForChat(state: IDocState): string {
		const resolved = this.getResolved(state.uri);
		const resolve = (s: string) => s.replace(/\[([^\]]*)\]\(bind:([^)]+)\)/g, (_m, label: string, key: string) => resolved.get(key) ?? label);
		const lines: string[] = [];
		for (const block of state.doc.blocks) {
			lines.push(block.type === 'heading' ? `${'#'.repeat(block.level ?? 1)} ${resolve(block.text)}` : resolve(block.text));
		}
		return lines.join('\n');
	}

	// --- approve / reject (the review rail) ---

	// Tweak (amend-before-approve, plan 31 iter 3, D31-B): replace a pending change's proposed `newText` with
	// the reviewer's hand-edit and flag it `tweaked`, then fire onDidChange so every surface re-renders the
	// amended proposal as still-pending. The subsequent approve() reads `tweaked` to record the audit
	// `via: 'tweaked'`. Guarded: figures come from sources (not hand-editable), and an empty/no-op amendment
	// is ignored. No new persist path - the amended text lands through the existing approve() serialisation.
	amendChange(changeId: string, newText: string): void {
		const idx = this._pending.findIndex(c => c.id === changeId);
		if (idx < 0) { return; }
		const change = this._pending[idx];
		if (change.kind === 'figure') { return; }
		const next = String(newText ?? '').trim();
		if (!next || next === change.newText) { return; }
		this._pending[idx] = { ...change, newText: next, tweaked: true };
		this._onDidChange.fire();
	}

	async approve(changeId: string): Promise<void> {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		const state = this._docs.get(change.docId);
		if (!state) { return; }
		const block = state.doc.blocks.find(b => b.id === change.blockId);
		if (change.insert) {
			// A generative insertion: splice the new Markdown content in as a fresh block after its anchor
			// (or at the end when the anchor is gone/unset), then persist. The block keeps the full Markdown
			// (heading + list) verbatim; the renderer shows rich content as rendered Markdown. No claim/lock.
			const newBlock: ILivingDocBlock = { id: generateUuid(), type: 'paragraph', text: change.newText, binds: extractBindLinks(change.newText) };
			const anchorIndex = change.afterBlockId ? state.doc.blocks.findIndex(b => b.id === change.afterBlockId) : state.doc.blocks.length - 1;
			state.doc.blocks.splice(anchorIndex + 1, 0, newBlock);
			state.recent.add(newBlock.id);
		} else if (block && !change.relink) {
			// A re-link prompt re-anchors the claim to the current best-match prose without rewriting it;
			// a normal impact change applies its rewrite to the block. `applyBlockEdit` splices at the change's
			// anchor: a whole-block `oldText` replaces the block (prose), a scoped `oldText` (one list item) is
			// spliced in place so sibling list items survive (decision-68 data-loss fix, plan 31 iter 1).
			const nextText = applyBlockEdit(block.text, change.oldText, change.newText);
			block.text = nextText; block.binds = extractBindLinks(nextText); state.recent.add(block.id);
		}
		if (change.claimId) {
			const prior = state.lock.claims[change.claimId];
			state.lock.claims[change.claimId] = {
				anchor: change.relink ? (block?.text ?? prior?.anchor ?? '') : change.newText,
				boundTo: prior?.boundTo ?? change.contextReviewed ?? [],
				kind: 'meaning',
				state: 'applied',
			};
		}
		this._pending = this._pending.filter(c => c.id !== changeId);
		// A tweaked change records `via: 'tweaked'` so the trail shows the human amended the agent's words
		// (plan 31 iter 3, D31-B); otherwise the change's own provenance (model/heuristic) stands.
		state.lock.audit.push(this._entry(change.blockId, 'approved', change.oldText, change.newText, change.tweaked ? 'tweaked' : (change.via ?? 'model')));
		await this._markContextReviewed(state, change.contextReviewed);
		state.status = `Change approved - applied to ${change.docTitle}`;
		await this._persist(state);
		await this._recomputeFreshness(state);
		this._onDidChange.fire();
	}

	// Accept every pending change for a document in one action (the comp's "accept all"). Applied in
	// order; each approve re-resolves its anchor by stable block id, so insertions stay correctly placed.
	async approveAll(docId: string): Promise<void> {
		const ids = this._pending.filter(c => c.docId === docId).map(c => c.id);
		if (!ids.length) { return; }
		// Snapshot the pre-approve body ONCE per bulk approve (D26-B) so the run is restorable to the
		// state before the batch landed. Individual approve() calls do not snapshot.
		const state = this._docs.get(docId);
		if (state) {
			await this.saveSnapshot(state.uri, 'Before bulk approve', 'bulk-approve');
		}
		for (const id of ids) {
			await this.approve(id);
		}
	}

	reject(changeId: string): void {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		const state = this._docs.get(change.docId);
		if (state) {
			state.lock.audit.push(this._entry(change.blockId, 'rejected', change.oldText, change.newText, change.via ?? 'model'));
			state.status = `Change rejected - ${change.docTitle} left unchanged`;
			// Rejecting still counts as reviewing the changed context, so the flag clears.
			void this._markContextReviewed(state, change.contextReviewed)
				.then(() => this._recomputeFreshness(state))
				.then(() => this._onDidChange.fire())
				.catch(e => this._log.warn('[livingDocs] reject follow-up failed', e));
		}
		this._onDidChange.fire();
	}

	// Accept every pending change across every document at once (the chat-level "Accept all" spanning the
	// whole working set). Applied per document so each doc's insertions stay correctly anchored.
	async approveAllPending(): Promise<void> {
		const docIds = [...new Set(this._pending.map(c => c.docId))];
		for (const docId of docIds) {
			await this.approveAll(docId);
		}
	}

	// Discard every pending change for one document in a single action (the per-document "Reject all",
	// mirroring approveAll). Each reject audits the discard and clears it from the rail; other documents'
	// pending changes are untouched.
	async rejectAll(docId: string): Promise<void> {
		const ids = this._pending.filter(c => c.docId === docId).map(c => c.id);
		for (const id of ids) {
			this.reject(id);
		}
	}

	// Discard every pending change across every document at once (the chat-level "Reject all" spanning
	// the whole working set). Clears the rail in one action.
	async rejectAllPending(): Promise<void> {
		const ids = this._pending.map(c => c.id);
		for (const id of ids) {
			this.reject(id);
		}
	}

	// Mark each reviewed context source as reviewed-at-current in the lock so its stale flag clears.
	private async _markContextReviewed(state: IDocState, files: readonly string[] | undefined): Promise<void> {
		if (!files?.length) { return; }
		for (const file of files) {
			state.lock.context[file] = { reviewedHash: await this._hashContext(state, file), reviewedAt: new Date().toISOString(), scope: 'document' };
		}
	}

	// Source-peek: the styled source data rendered as an IN-SURFACE pane inside the one document
	// surface (the comp's "Sync across" source panel) - never a second editor group. The cells behind
	// the clicked provenance dot are marked `selected`; the "Sync across" loop then re-derives figures.
	getSourcePeek(resource: URI, cells: readonly string[]): ISourcePeek | undefined {
		const state = this._docs.get(resource.toString());
		if (!state || !state.doc.isLiving) { return undefined; }
		const selected = new Set(cells);
		const rows: ISourcePeekRow[] = Object.keys(state.lock.bindings).map(key => ({
			key,
			value: state.lock.bindings[key].resolved,
			selected: selected.has(key),
		}));
		const source = state.doc.sources.find(s => sourceKind(s) === 'file') ?? state.doc.sources[0] ?? 'source';
		const referencedBy = [...this._docs.values()]
			.filter(s => s.doc.isLiving && s.doc.sources.some(src => state.doc.sources.includes(src)))
			.map(s => s.doc.title);
		const raw = this._rawSourceCache.get(`${resource.toString()}::${source}`);
		const grid = raw && source.endsWith('.csv') ? buildSourceGrid(raw) : undefined;
		// When the clicked value is an api/mcp binding, surface its real response payload (field highlighted)
		// instead of the CSV grid - closing the "provenance falls back to the CSV" gap for non-file kinds.
		const payload = this._sourcePayloadFor(cells[0], state);
		// A published document pins its sources to a version (plan 32 iter 4): when the peeked source is pinned,
		// surface "pinned at v <short-hash> of <date>" so a reader of a published doc sees the frozen version.
		const pinnedLabel = this._pinnedLabelFor(state, source);
		return { source, rows, referencedBy, grid, payload, ...(pinnedLabel ? { pinnedLabel } : {}) };
	}

	// The pin label for a source when the document is published (plan 32 iter 4). The lock's `pins` freeze each
	// source to a version hash on publish; the newest `publish` snapshot dates the pin. Undefined when the doc
	// is not published or this source is not pinned - real data only, never a fabricated "pinned" line.
	private _pinnedLabelFor(state: IDocState, source: string): string | undefined {
		const tail = (s: string) => s.split('/').pop() ?? s;
		const pin = state.lock.pins.find(p => p.source === source || tail(p.source) === tail(source));
		if (!pin) { return undefined; }
		const shortHash = pin.version.slice(0, 7);
		const published = [...state.lock.snapshots].reverse().find(s => s.via === 'publish');
		const date = published ? new Date(Date.parse(published.at)).toISOString().slice(0, 10) : undefined;
		return date ? `pinned at v ${shortHash} of ${date}` : `pinned at v ${shortHash}`;
	}

	// Build the raw-payload view for a clicked api/mcp bind key (plan 29, iter 4), or undefined for a file
	// binding (which uses the CSV grid) / an unresolved key. Reads the payload cached during resolution.
	private _sourcePayloadFor(key: string | undefined, state: IDocState): ISourcePayload | undefined {
		if (!key) { return undefined; }
		const rawPayload = this._payloadRawCache.get(key);
		if (!rawPayload) { return undefined; }
		const mcp = parseMcpKey(key);
		if (mcp) { return { source: `${mcp.server}.${mcp.tool}`, raw: rawPayload, field: mcp.field, kind: 'mcp' }; }
		const entry = state.lock.bindings[key];
		if (entry && /^https?:\/\//.test(entry.source)) {
			const hashIdx = entry.source.indexOf('#');
			const field = hashIdx >= 0 ? entry.source.slice(hashIdx + 1) : '';
			let host = entry.source;
			try { host = new URL(hashIdx >= 0 ? entry.source.slice(0, hashIdx) : entry.source).host; } catch { /* keep raw */ }
			return { source: host, raw: rawPayload, field, kind: 'api' };
		}
		return undefined;
	}

	// "Sync across": re-derive this one document's bound figures from its current sources and return the
	// old -> new diff (the visible result of a source edit). Figures auto-apply (low risk); the diff is
	// recorded for the editor's synced banner. Meaning-changes still go through Review-impact, not here.
	async syncFromSources(resource: URI): Promise<readonly IFigureChange[]> {
		const id = resource.toString();
		const state = this._docs.get(id);
		if (!state || !state.doc.isLiving) { return []; }
		const changes = await this._syncLockWithDiff(state);
		await this._persist(state);
		await this._recomputeFreshness(state);
		state.status = changes.length
			? `Synced - ${changes.length} figure${changes.length === 1 ? '' : 's'} updated`
			: 'Synced - figures already up to date';
		this._onDidChange.fire();
		return changes;
	}

	// Re-derive a document's figures (the existing _syncLock) while capturing the old -> new diff of the
	// resolved values, recorded per document for the editor's "Sync across" banner. Shared by the focused
	// per-document sync and the workspace-wide refresh.
	private async _syncLockWithDiff(state: IDocState, pass?: IRefreshPass): Promise<IFigureChange[]> {
		const before = new Map(this.getResolved(state.uri));
		state.recent = new Set<string>();
		await this._syncLock(state, pass);
		await this._resolveSubtitle(state, pass);
		const after = this.getResolved(state.uri);
		const changes: IFigureChange[] = [];
		for (const [key, next] of after) {
			const old = before.get(key);
			if (old !== undefined && old !== next) { changes.push({ key, old, next }); }
		}
		this._lastSyncDiff.set(state.uri.toString(), changes);
		return changes;
	}

	getLastSyncDiff(resource: URI): readonly IFigureChange[] {
		return this._lastSyncDiff.get(resource.toString()) ?? [];
	}

	// --- typed context (Pasted text / Images / Company knowledge + Add context) ---

	getAddedContext(resource: URI): readonly IAddedContext[] {
		return this._docs.get(resource.toString())?.lock.contextItems ?? [];
	}

	// Add a typed context item from the Context panel. Pasted notes and knowledge keep their full text in
	// `detail` with a truncated `label`; an image keeps its path/URL as the label. Persisted in the lock.
	async addContext(resource: URI, kind: AddedContextKind, text: string): Promise<void> {
		const state = this._docs.get(resource.toString());
		const trimmed = text.trim();
		if (!state || !trimmed) { return; }
		if (!state.lock.contextItems) { state.lock.contextItems = []; }
		const oneLine = trimmed.replace(/\s+/g, ' ');
		const label = kind === 'image' ? oneLine : (oneLine.length > 48 ? `${oneLine.slice(0, 47)}\u2026` : oneLine);
		const detail = kind === 'image' ? 'image' : (kind === 'knowledge' ? 'company knowledge' : 'pasted note');
		state.lock.contextItems.push({ kind, label, detail });
		state.status = 'Context added';
		await this._persist(state);
		this._onDidChange.fire();
	}

	// --- discovery + persistence ---

	private async _discoverLivingDocUris(): Promise<URI[]> {
		const found = new Map<string, URI>();
		// Always include documents already loaded (e.g. the open editor).
		for (const state of this._docs.values()) { found.set(state.uri.toString(), state.uri); }
		// Scan the directory of each loaded document for sibling Living Documents.
		const dirs = new Map<string, URI>();
		for (const state of this._docs.values()) {
			const dir = dirname(state.uri);
			dirs.set(dir.toString(), dir);
		}
		for (const dir of dirs.values()) {
			try {
				const stat = await this._files.resolve(dir);
				for (const child of stat.children ?? []) {
					if (!child.isDirectory && await this._isLivingDocFile(child.resource)) {
						found.set(child.resource.toString(), child.resource);
					}
				}
			} catch (e) {
				// Directory listing is unavailable (e.g. in unit tests); the loaded set still applies.
				this._log.trace('[livingDocs] directory scan skipped', e instanceof Error ? e.message : String(e));
			}
		}
		return [...found.values()];
	}

	private _entry(blockId: string, action: IAuditEntry['action'], oldText: string, newText: string, via: IAuditEntry['via']): IAuditEntry {
		const docTitle = [...this._docs.values()].find(s => s.doc.blocks.some(b => b.id === blockId))?.doc.title ?? '';
		return { time: new Date().toISOString(), docTitle, blockId, action, oldText, newText, via };
	}

	// Persist the document (.md) and its lock together - the pair is one logical unit.
	private async _persist(state: IDocState): Promise<void> {
		try {
			const serialized = serializeLivingDoc(state.doc);
			state.rawText = serialized;
			await this._files.writeFile(state.uri, VSBuffer.fromString(serialized));
			await this._lockStore.write(state.uri, state.lock);
		} catch (e) {
			this._log.warn('[livingDocs] persist failed', e);
		}
	}
}
