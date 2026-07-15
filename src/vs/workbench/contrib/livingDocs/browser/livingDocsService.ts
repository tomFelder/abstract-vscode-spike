/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, streamToBuffer, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { Limiter } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { basename, dirname, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { toAction } from '../../../../base/common/actions.js';
import { asJson, asText, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IChatGptSignInStatus, IChatMessage, IChatStep, IExtractedSheet, IFanoutProgress, IFigureChange, IFileOpDependent, IImportOutcome, ILivingDocsService, ILivingDocSummary, IModelProviderStatus, IOnboardingSurvey, IPdfContextResult, IProjectAnswer, ISkillCheck, ISourceInfo, ISourcePayload, ISourcePeek, ISourcePeekRow, ISourceUsage, ITemplateInfo, ITidyPlanItem, IWorkbookProvenance, IWorkbookUseResult, IWorkingSetDoc, LivingDocsPanelTab, ModelProvider, REVIEW_RAIL_VIEW_ID } from '../common/livingDocs.js';
import { convertDocxHtml, formatImportSummary, IDocxDetections } from '../common/docxImport.js';
import { dedupeAssetName, imageMimeForName, sanitizeImageAssetName } from '../common/livingDocAssets.js';
import { IAnalyticsService } from '../common/analytics.js';
import { applyBlockEdit, buildExamplesTemplateSkeleton, buildSourcesSkeleton, buildTemplateSkeleton, composeExamplesInstruction, composeSourcesInstruction, composeTemplateInstruction, documentDisplayTitle, extractBindLinks, extractStreamingReply, findQuoteLine, listItems, parseChatResponse, parseLivingDoc, parseMultiChatResponse, reconcileBindLinks, scopeBlockEdit, serializeLivingDoc, validateExampleSet, withFrontmatterList } from '../common/livingDocMarkdown.js';
import { AnalyticsService } from './analyticsService.js';
import { buildDemoReportMarkdown, DEMO_CSV, DEMO_CSV_NAME, DEMO_DOC_NAME, founderFeedbackLogLine, IFeedbackReport, onboardingStepLabel, OnboardingStep } from '../common/onboarding.js';
import { estimateTokens, IFanoutDoc, planFanoutBatches } from '../common/fanoutBudget.js';
import { IFanoutFailedDoc, summarizeFanoutRun } from '../common/fanoutOutcome.js';
import { parseSseChunk } from '../common/livingDocSse.js';
import { renderExportHtml, renderExportMarkdown } from './livingDocRender.js';
import { ILockStore, lockUriFor, SidecarLockStore } from './livingDocLockStore.js';
import { IFileRef, rewriteLockSources, scanDependents } from '../common/fileOps.js';
import { buildTidyPlan, ITidyInventoryItem } from '../common/tidyPlan.js';
import { AgentOrchestrator, IAgentRunContext, IAgentRunResult } from './agentOrchestrator.js';
import { IClock, RealClock } from './clock.js';
import { WorkspaceAgentStore } from './agentStore.js';
import { AddedContextKind, AgentPolicy, emptyLock, IAddedContext, IAgentDef, IAgentRun, IAgentTrigger, IAuditEntry, IBindingEntry, IFreshness, ILivingDoc, ILivingDocBlock, ILivingDocLock, IProposedChange, ISkillRunDocResult, ISkillRunSummary, ISnapshotEntry, SNAPSHOT_CAP, SkillRunDocStatus, SnapshotVia, SourceKind, summariseSkillRun } from '../common/livingDocsModel.js';
import { buildSourceGrid } from '../common/sourceGrid.js';
import { classifyWorkspaceExtra } from '../common/treeRail.js';
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
	// The live re-resolved source value per bind key from the last freshness recompute (the "now"); the
	// lock holds the applied value at last sync (the "then"). Powers the source drawer's then-vs-now line
	// (plan 37 F13) with no extra source read. Undefined until the first recompute; absent keys = unresolved.
	current?: Map<string, string>;
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
const INCLUDED_USAGE_SPENT_MESSAGE = 'You\'ve used today\'s included usage - picks up tomorrow, or sign in with ChatGPT for unlimited.';

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

// Persisted flag (application scope): has this install ever emitted project_opened? Drives the is_first
// property of the project_opened analytics event so the activation funnel can tell a first project apart.
const FIRST_PROJECT_KEY = 'abstract.analytics.firstProjectOpened';

// Persisted flag (application scope) armed at the D26 hand-off ("bring a real folder"): the next approved
// change on the user's OWN file is the T4 aha (doc 15 section 2.1). Persisted because the hand-off opens a
// new folder (a fresh workbench + service), so the intent must survive that reload to fire once, then clear.
const ONBOARDING_AWAIT_OWN_APPROVE_KEY = 'abstract.onboarding.awaitOwnApprove';

// D26 onboarding session (application scope). The calm shell cannot keep the onboarding SCREEN webview mounted
// beside the demo document, so once "See it work" opens the demo the remaining funnel steps are recorded by
// service hooks on the natural in-document actions (peek a figure -> provenance-peek; approve the sample ->
// first-approve-sample) rather than by the screen. These persisted flags scope + de-duplicate those hooks.
const ONBOARDING_ACTIVE_KEY = 'abstract.onboarding.active';        // a walkthrough is in progress (demo made).
const ONBOARDING_DEMO_URI_KEY = 'abstract.onboarding.demoUri';     // the demo document the wows happen on.
const ONBOARDING_PEEKED_KEY = 'abstract.onboarding.peeked';        // provenance-peek recorded once.
const ONBOARDING_SAMPLE_KEY = 'abstract.onboarding.sampleApproved'; // first-approve-sample recorded once.

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

/**
 * Match a Markdown inline image `![alt](dest "title")` starting at `i` in `text`. Unlike a `[^)\s]+` regex,
 * this handles angle-bracket destinations (`<a b.png>` with spaces) and bare destinations that contain
 * balanced parentheses (`foo(bar).png`), plus an optional title - so a valid local image is never dropped or
 * truncated. Returns the DECODED destination (brackets stripped), which matches what the Markdown renderer
 * emits as an `<img src>` and what the docx writer looks up in the image map. Mirrors `matchImageAt` in
 * `scripts/lwd-docx.js`, so both export paths key images identically.
 */
function matchMarkdownImageAt(text: string, i: number): { readonly src: string; readonly end: number } | undefined {
	if (text[i] !== '!' || text[i + 1] !== '[') { return undefined; }
	let j = i + 2;
	while (j < text.length && text[j] !== ']') { j++; }
	if (text[j] !== ']' || text[j + 1] !== '(') { return undefined; }
	j += 2;
	let src = '';
	if (text[j] === '<') {
		j++;
		while (j < text.length && text[j] !== '>') { src += text[j]; j++; }
		if (text[j] !== '>') { return undefined; }
		j++;
	} else {
		let depth = 0;
		while (j < text.length) {
			const c = text[j];
			if (c === ')' && depth === 0) { break; }
			if (/\s/.test(c)) { break; } // whitespace begins an optional title (or is malformed) - the dest ends here
			if (c === '(') { depth++; }
			if (c === ')') { depth--; }
			src += c;
			j++;
		}
	}
	// Skip an optional title and any trailing whitespace up to the closing paren.
	while (j < text.length && text[j] !== ')') { j++; }
	if (text[j] !== ')') { return undefined; }
	return { src, end: j + 1 };
}


export class LivingDocsService extends Disposable implements ILivingDocsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidRequestPanel = this._register(new Emitter<LivingDocsPanelTab>());
	readonly onDidRequestPanel: Event<LivingDocsPanelTab> = this._onDidRequestPanel.event;

	// "Add to chat" (docs 20 section 1d, the 1m entry): the review rail seeds the fired file name as an
	// `@mention` in its chat composer draft. Kept in the service so the Files-tab view stays thin.
	private readonly _onDidRequestChatAttach = this._register(new Emitter<string>());
	readonly onDidRequestChatAttach: Event<string> = this._onDidRequestChatAttach.event;

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
	// True while approveAll fans out, so each approve's proposal_resolved analytics event carries bulk:true.
	private _inBulkApprove = false;
	// True while rejectAll fans out, so each reject's proposal_resolved analytics event carries bulk:true.
	private _inBulkReject = false;
	private readonly _lockStore: ILockStore;
	// The orchestration engine: agent registry + dependency-graph event-bus (+ triggers/policy/verify).
	private readonly _orchestrator: AgentOrchestrator;
	// Correlated source watchers, one store per loaded document. Disposed/recreated on reload, and
	// all torn down when the service is disposed.
	private readonly _watchers = new Map<string, IDisposable>();
	// Correlated watchers for spreadsheet WORKBOOKS used as sources (issue #131, doc 22 §4), keyed by the
	// workbook URI. Distinct from `_watchers` (per-document source watchers): a workbook is the origin of
	// extracted CSVs, not a document source itself, so it needs its own watcher that re-extracts on change.
	// A DisposableMap so re-registering a workbook disposes the old watcher and disposal tears them all down.
	private readonly _workbookWatchers = this._register(new DisposableMap<string>());
	// Extraction provenance for CSVs Abstract wrote from a workbook (issue #131), keyed by the CSV's
	// workspace-relative source path (e.g. "data/Budget/FY26.csv"). Populated on extraction and rebuilt from
	// the on-disk manifests on folder load, so the provenance drawer can show the figure → CSV → workbook hop
	// synchronously during a render.
	private readonly _workbookProvenance = new Map<string, IWorkbookProvenance>();

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
		@IAnalyticsService private readonly _analytics: IAnalyticsService,
		@IStorageService private readonly _storage: IStorageService,
		@ICommandService private readonly _commands: ICommandService,
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
		// (issue #131) Rebuild the workbook → sheet extraction provenance from the on-disk manifests so the
		// source-peek drawer shows the workbook hop for an extracted CSV after a reload, without re-parsing
		// the workbook. Re-run when the open folder changes.
		void this._loadWorkbookManifests();
		this._register(this._workspace.onDidChangeWorkspaceFolders(() => { void this._readProjectNameMarker(); void this._loadWorkbookManifests(); }));
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
		// (plan 36 iter 2) Emit project_opened once per session when a folder is open and its documents have been
		// listed. Consent-gated in the service, so this is a no-op before consent; carries counts only, no paths.
		void this._captureProjectOpenedOnce();
	}

	// True once this session's project_opened has fired, so a re-scan (marker retry, folder change) does not
	// re-emit. Reset naturally per window/session because the service is a fresh singleton each launch.
	private _projectOpenedCaptured = false;

	private async _captureProjectOpenedOnce(): Promise<void> {
		if (this._projectOpenedCaptured) { return; }
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) { return; }
		this._projectOpenedCaptured = true;
		try {
			const docs = await this.listDocuments();
			// is_first: whether this install has ever recorded a project_opened before (a persisted boolean flag,
			// never a document path). Set true here so the next launch reports is_first:false.
			const isFirst = !this._storage.getBoolean(FIRST_PROJECT_KEY, StorageScope.APPLICATION, false);
			if (isFirst) {
				this._storage.store(FIRST_PROJECT_KEY, true, StorageScope.APPLICATION, StorageTarget.USER);
			}
			this._analytics.capture('project_opened', {
				doc_count: docs.length,
				has_bindings: docs.some(d => d.sourceKinds.length > 0),
				is_first: isFirst,
			});
		} catch (e) {
			this._log.trace('[livingDocs] project_opened capture skipped', e instanceof Error ? e.message : String(e));
		}
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
		const started = Date.now();
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
		// UI funnel: the user invoked a skill grader. `skill` is the controlled skill id (never document text);
		// the Skills here are deterministic/strategy graders, not the ITE thinking skills, so `thinking` is false.
		this._analytics.capture('skill_invoked', { skill: id, thinking: false, duration_ms: Date.now() - started });
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
			// The oldest sync time among the bindings that are currently STALE (plan 37 F12): a stale source
			// must never read as freshly-synced, so its label reports how old its stale data actually is rather
			// than the newest sync across its (still-fresh) dependents. Undefined while the source is all-fresh.
			staleSyncedAt: string | undefined;
			fresh: boolean;
			usedBy: Map<string, { doc: URI; title: string; keys: Set<string>; context: boolean }>;
		}
		const acc = new Map<string, IRegistryRow>();
		const ensure = (id: string, kind: SourceKind): IRegistryRow => {
			let row = acc.get(id);
			if (!row) { row = { kind, label: sourceLabel(id, kind), syncedAt: undefined, staleSyncedAt: undefined, fresh: true, usedBy: new Map() }; acc.set(id, row); }
			return row;
		};
		// Fold one binding's sync time into a row: track the newest overall, and the oldest among stale ones.
		const foldSync = (row: IRegistryRow, at: string, stale: boolean) => {
			if (stale) { row.fresh = false; if (!row.staleSyncedAt || at < row.staleSyncedAt) { row.staleSyncedAt = at; } }
			if (!row.syncedAt || at > row.syncedAt) { row.syncedAt = at; }
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
					foldSync(row, entry.syncedAt, !bindingIsFresh(resolution.get(key), entry));
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
					foldSync(row, entry.reviewedAt, contextHashes.get(file) !== entry.reviewedHash);
				}
			}
		}
		const sources: ISourceInfo[] = [];
		for (const [id, row] of acc) {
			const usedBy: ISourceUsage[] = [...row.usedBy.values()]
				.map(u => ({ doc: u.doc, title: u.title, keys: [...u.keys].sort((a, b) => a.localeCompare(b)), context: u.context }))
				.sort((a, b) => a.title.localeCompare(b.title));
			// A stale source reports its oldest stale sync time so it never reads as freshly-synced (F12);
			// an all-fresh source reports the newest sync across its dependents.
			const syncedAt = row.fresh ? row.syncedAt : (row.staleSyncedAt ?? row.syncedAt);
			sources.push({ id, kind: row.kind, label: row.label, syncedAt, fresh: row.fresh, usedBy });
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

	// The project folder's document files (md/txt at the root), for the "From sources..." knowledge picker
	// (F17) and the from-examples wizard's example picker (F18). Excludes templates, generated export/source
	// views and lock sidecars - only user-authored documents. Empty when no folder is open.
	async getFolderDocFiles(): Promise<readonly string[]> {
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
			.filter(name => /\.(md|txt)$/i.test(name) && !/\.template\.md$/i.test(name) && !/\.(export|source)\.md$/i.test(name))
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
	async openFolder(): Promise<boolean> {
		const picked = await this._fileDialog.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: 'Open Folder' });
		if (!picked || !picked.length) { return false; }
		await this._host.openWindow([{ folderUri: picked[0] }], { forceReuseWindow: true });
		return true;
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
		try {
			await this._files.writeFile(target, VSBuffer.fromString(NEW_DOCUMENT_TEMPLATE));
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

	// --- provenance-safe file operations (docs 20 section 1d / map-D6): rename, delete, Add to chat ---

	// The frontmatter references (sources/context) of every discovered document, for the dependent scan.
	// Discovers the same set `listDocuments` does (loaded + on-disk) so the answer reflects the real folder
	// even before anything is opened; a loaded document uses its parsed state, an on-disk one is read + parsed.
	private async _collectFileRefs(): Promise<IFileRef[]> {
		const found = new Map<string, URI>();
		for (const state of this._docs.values()) { found.set(state.uri.toString(), state.uri); }
		for (const folder of this._workspace.getWorkspace().folders) { await this._collectDocs(folder.uri, found, 0); }
		const refs: IFileRef[] = [];
		for (const uri of found.values()) {
			const id = uri.toString();
			let doc = this._docs.get(id)?.doc;
			if (!doc) {
				try { doc = parseLivingDoc((await this._files.readFile(uri)).value.toString()); }
				catch (e) { this._log.trace('[livingDocs] file-ref scan skipped', e instanceof Error ? e.message : String(e)); continue; }
			}
			refs.push({ id, title: doc.title, sources: doc.sources, context: doc.context });
		}
		return refs;
	}

	async getFileDependents(resource: URI): Promise<readonly IFileOpDependent[]> {
		const name = basename(resource);
		const deps = scanDependents(await this._collectFileRefs(), name, resource.toString());
		return deps.map(d => ({ resource: URI.parse(d.id), title: d.title }));
	}

	async renameFile(resource: URI, newBaseName: string): Promise<void> {
		const dir = dirname(resource);
		const oldName = basename(resource);
		const dot = oldName.lastIndexOf('.');
		const ext = dot >= 0 ? oldName.slice(dot) : '';
		const stem = LivingDocsService._safeStem(newBaseName);
		if (!stem) { return; }
		const nextName = stem.endsWith(ext) ? stem : stem + ext;
		if (nextName === oldName) { return; }
		const target = joinPath(dir, nextName);
		// A clashing target must never half-apply: refuse before touching anything.
		if (await this._files.exists(target)) {
			this._notify.error(`Cannot rename to "${nextName}" - a file with that name already exists.`);
			return;
		}
		try {
			await this._moveFileWithSidecar(resource, target);
		} catch (e) {
			this._log.warn('[livingDocs] rename failed', e);
			this._notify.error(`Rename failed: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
			return;
		}
		// A renamed SOURCE keeps its dependents bound: rewrite their frontmatter + lock provenance references.
		await this._rewriteDependentReferences(oldName, nextName);
		this._onDidChange.fire();
		this._notify.notify({
			severity: Severity.Info,
			message: `Renamed "${oldName}" to "${nextName}".`,
			sticky: true,
			actions: { primary: [toAction({ id: 'livingDocs.file.rename.undo', label: 'Undo', run: () => this._undoRename(target, resource, nextName, oldName) })] },
		});
	}

	// Move a file and its `.lock.json` sidecar together, atomically on the pair: move the file, then the
	// sidecar; if the sidecar move fails, roll the file back so neither half-applies. Carries the in-memory
	// document state + source watcher to the new key and reopens an open editor at the new resource.
	private async _moveFileWithSidecar(from: URI, to: URI): Promise<void> {
		await this._files.move(from, to, false);
		const fromLock = lockUriFor(from);
		if (await this._files.exists(fromLock)) {
			try {
				await this._files.move(fromLock, lockUriFor(to), false);
			} catch (e) {
				try { await this._files.move(to, from, false); } catch { /* best-effort rollback */ }
				throw e;
			}
		}
		const state = this._docs.get(from.toString());
		if (state) {
			this._docs.delete(from.toString());
			const moved: IDocState = { ...state, uri: to };
			this._docs.set(to.toString(), moved);
			const chat = this._chats.get(from.toString());
			if (chat) { this._chats.delete(from.toString()); this._chats.set(to.toString(), chat); }
			this._watchers.get(from.toString())?.dispose();
			this._watchers.delete(from.toString());
			this._watchSources(moved);
		}
		await this._reopenEditorAt(from, to);
	}

	// The editor follows a rename: open the new resource (if the old one was open) and close the stale input.
	private async _reopenEditorAt(from: URI, to: URI): Promise<void> {
		const editors = this._editors.findEditors(from);
		if (!editors.length) { return; }
		await this._editors.openEditor({ resource: to, options: { pinned: true } });
		await this._editors.closeEditors(editors);
	}

	// Rewrite every dependent document's provenance references to a renamed file: its frontmatter
	// `sources:`/`context:` entry (old -> new) and its lock's binding source paths + context key. Returns
	// the documents it touched so the caller can invert them on undo. Best-effort per document (a failure
	// on one is logged, never aborting the rename that already succeeded).
	private async _rewriteDependentReferences(oldName: string, newName: string): Promise<URI[]> {
		const deps = scanDependents(await this._collectFileRefs(), oldName);
		const touched: URI[] = [];
		for (const dep of deps) {
			const uri = URI.parse(dep.id);
			try {
				let raw = (await this._files.readFile(uri)).value.toString();
				if (dep.viaSources) { raw = withFrontmatterList(withFrontmatterList(raw, 'sources', oldName, false), 'sources', newName, true); }
				if (dep.viaContext) { raw = withFrontmatterList(withFrontmatterList(raw, 'context', oldName, false), 'context', newName, true); }
				await this._files.writeFile(uri, VSBuffer.fromString(raw));
				const lock = await this._lockStore.read(uri);
				if (lock) {
					const { lock: nextLock, changed } = rewriteLockSources(lock, oldName, newName);
					if (changed) { await this._lockStore.write(uri, nextLock); }
				}
				if (this._docs.has(dep.id)) { await this._loadState(uri); }
				touched.push(uri);
			} catch (e) {
				this._log.warn('[livingDocs] dependent reference rewrite failed', e);
			}
		}
		return touched;
	}

	private async _undoRename(current: URI, original: URI, currentName: string, originalName: string): Promise<void> {
		if (await this._files.exists(original)) {
			this._notify.error(`Cannot undo: "${originalName}" already exists again.`);
			return;
		}
		try {
			await this._moveFileWithSidecar(current, original);
		} catch (e) {
			this._notify.error(`Undo failed: ${e instanceof Error ? e.message : String(e)}.`);
			return;
		}
		await this._rewriteDependentReferences(currentName, originalName);
		this._onDidChange.fire();
	}

	async deleteFile(resource: URI): Promise<void> {
		const name = basename(resource);
		// Snapshot the file + its lock sidecar so Undo can restore the pair verbatim.
		let fileBuf: VSBuffer;
		try {
			fileBuf = (await this._files.readFile(resource)).value;
		} catch (e) {
			this._notify.error(`Delete failed: "${name}" could not be read. Nothing was changed.`);
			return;
		}
		const lockUri = lockUriFor(resource);
		let lockBuf: VSBuffer | undefined;
		try { if (await this._files.exists(lockUri)) { lockBuf = (await this._files.readFile(lockUri)).value; } }
		catch { lockBuf = undefined; }
		try {
			await this._files.del(resource, { useTrash: false });
		} catch (e) {
			this._log.warn('[livingDocs] delete failed', e);
			this._notify.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
			return;
		}
		// The pair is atomic: if the sidecar cannot be removed after the file was, roll the file back so
		// neither half-applies (symmetric to the rename's sidecar-move rollback). Only if the rollback
		// itself also fails is the state genuinely half-applied - then say so honestly and keep a sticky
		// Restore action so the snapshot is never lost.
		if (lockBuf) {
			try {
				await this._files.del(lockUri, { useTrash: false });
			} catch (e) {
				this._log.warn('[livingDocs] lock delete failed - rolling the file back', e);
				try {
					await this._files.writeFile(resource, fileBuf);
					this._notify.error(`Delete failed: the "${basename(lockUri)}" sidecar could not be removed. Nothing was changed.`);
				} catch (rollbackError) {
					this._log.error('[livingDocs] delete rollback failed', rollbackError);
					this._notify.notify({
						severity: Severity.Error,
						message: `Delete of "${name}" failed part-way: the file was removed but its lock sidecar was not. Restore brings the file back.`,
						sticky: true,
						actions: { primary: [toAction({ id: 'livingDocs.file.delete.restore', label: 'Restore', run: () => this._undoDelete(resource, fileBuf, lockUri, undefined) })] },
					});
				}
				return;
			}
		}
		this._forgetDoc(resource);
		await this._closeEditorFor(resource);
		// Orphan gracefully (map-D6): dependents are NOT rewritten - they keep their cached lock values and
		// re-flag stale on the freshness recompute below, never crashing or blocking the delete.
		await this._reflagDependents(name);
		this._onDidChange.fire();
		this._notify.notify({
			severity: Severity.Info,
			message: `Deleted "${name}".`,
			sticky: true,
			actions: { primary: [toAction({ id: 'livingDocs.file.delete.undo', label: 'Undo', run: () => this._undoDelete(resource, fileBuf, lockUri, lockBuf) })] },
		});
	}

	private async _undoDelete(resource: URI, fileBuf: VSBuffer, lockUri: URI, lockBuf?: VSBuffer): Promise<void> {
		try {
			await this._files.writeFile(resource, fileBuf);
			if (lockBuf) { await this._files.writeFile(lockUri, lockBuf); }
		} catch (e) {
			this._notify.error(`Undo failed: ${e instanceof Error ? e.message : String(e)}.`);
			return;
		}
		if (this._isDocFile(resource)) { await this.loadDocument(resource); }
		await this._reflagDependents(basename(resource));
		this._onDidChange.fire();
	}

	// Recompute freshness for every loaded document that references `name`, so a deleted source's dependents
	// (and a restored source's) re-derive their stale/fresh flag from the file's new presence/absence.
	private async _reflagDependents(name: string): Promise<void> {
		for (const state of this._docs.values()) {
			if (state.doc.sources.includes(name) || state.doc.context.includes(name)) {
				await this._recomputeFreshness(state);
			}
		}
	}

	// Drop all in-memory state for a deleted document: its watcher, loaded state, and chat history.
	private _forgetDoc(resource: URI): void {
		const id = resource.toString();
		this._watchers.get(id)?.dispose();
		this._watchers.delete(id);
		this._docs.delete(id);
		this._chats.delete(id);
	}

	// The editor closes gracefully when its document is deleted.
	private async _closeEditorFor(resource: URI): Promise<void> {
		const editors = this._editors.findEditors(resource);
		if (editors.length) { await this._editors.closeEditors(editors); }
	}

	attachToChat(resource: URI): void {
		this.focusPanel('chat');
		this._onDidRequestChatAttach.fire(basename(resource));
	}

	// --- the Tidy verb (doc 22 section 5): fold the folder inventory into a proposed move plan ---------

	// Build the deterministic, model-free Tidy plan (doc 22 section 5). Gathers the real root-file inventory
	// (names + mtimes from disk, inbound-reference counts from the dependency graph, imported-original marks
	// from the locks), hands it to the pure `buildTidyPlan`, then re-hydrates each proposed move into a
	// reviewable item with its file URIs and its dependents. Conservative: an already-tidy project yields an
	// honest empty plan. Nothing is moved here - this only proposes.
	async buildTidyPlan(): Promise<readonly ITidyPlanItem[]> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) { return []; }
		const refs = await this._collectFileRefs();
		const importedOriginals = await this._collectImportedOriginals();
		// Only the project root is tidied, so a single (metadata-resolved) listing of the root is enough for the
		// name + mtime signals; the reference/import signals come from the whole-project scans above.
		let children;
		try {
			children = (await this._files.resolve(folder.uri, { resolveMetadata: true })).children ?? [];
		} catch (e) {
			this._log.trace('[livingDocs] tidy root scan skipped', e instanceof Error ? e.message : String(e));
			return [];
		}
		const inventory: ITidyInventoryItem[] = [];
		for (const child of children) {
			if (child.isDirectory) { continue; }
			const name = basename(child.resource);
			// Hidden files and the lock sidecars never appear in a Tidy plan (locks follow their document, never
			// move on their own - doc 22 section 5), so they are not part of the inventory the heuristics read.
			if (name.startsWith('.') || name.endsWith('.lock.json') || name === 'agents.json') { continue; }
			inventory.push({
				name,
				folder: '',
				mtimeMs: (child as { mtime?: number }).mtime,
				referencedBy: scanDependents(refs, name, child.resource.toString()).length,
				isImportedOriginal: importedOriginals.has(name),
			});
		}
		const { moves } = buildTidyPlan(inventory, { nowMs: this._clock.now() });
		const items: ITidyPlanItem[] = [];
		for (const move of moves) {
			const fromResource = joinPath(folder.uri, move.from);
			const toResource = joinPath(folder.uri, move.to);
			items.push({
				fromResource,
				toResource,
				fromLabel: move.from,
				toLabel: move.to,
				reason: move.reason,
				dependents: (await this.getFileDependents(fromResource)),
			});
		}
		return items;
	}

	// The set of imported originals in the project: the untouched foreign file (docx) named by any document's
	// lock `imported.from` provenance. A Tidy plan proposes moving these to `archive/originals/` (doc 22 section 2).
	private async _collectImportedOriginals(): Promise<Set<string>> {
		const originals = new Set<string>();
		const found = new Map<string, URI>();
		for (const state of this._docs.values()) { found.set(state.uri.toString(), state.uri); }
		for (const folder of this._workspace.getWorkspace().folders) { await this._collectDocs(folder.uri, found, 0); }
		for (const uri of found.values()) {
			try {
				const lock = await this._lockStore.read(uri);
				if (lock?.imported?.from) { originals.add(lock.imported.from); }
			} catch (e) {
				this._log.trace('[livingDocs] tidy import-provenance read skipped', e instanceof Error ? e.message : String(e));
			}
		}
		return originals;
	}

	// Apply the approved Tidy moves (doc 22 section 5, the F16 semantics). Each move is atomic on the lock
	// (the shared `_moveFileWithSidecar` moves document + sidecar together or rolls back), creates its
	// destination folder on demand, and re-points every dependent lock's `source` path in the same operation
	// (`_rewriteDependentReferences`, exactly as rename does) so bindings survive the move. A clashing
	// destination is refused with a named error and skipped - it never half-applies, and it never blocks the
	// rest of the batch. One sticky Undo toast inverts every move that actually applied.
	async applyTidyMoves(items: readonly ITidyPlanItem[]): Promise<void> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder || !items.length) { return; }
		const applied: { from: URI; to: URI; oldName: string; newRef: string }[] = [];
		for (const item of items) {
			const from = item.fromResource;
			const to = item.toResource;
			// A clashing destination must never half-apply: refuse this move before touching anything, keep going.
			if (await this._files.exists(to)) {
				this._notify.error(`Could not tidy "${item.fromLabel}" - "${item.toLabel}" already exists.`);
				continue;
			}
			try {
				await this._ensureFolder(dirname(to));
				await this._moveFileWithSidecar(from, to);
			} catch (e) {
				this._log.warn('[livingDocs] tidy move failed', e);
				this._notify.error(`Could not tidy "${item.fromLabel}": ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
				continue;
			}
			const oldName = basename(from);
			// The new reference is the destination relative to the project root, which is where a root document
			// that binds this file resolves its sibling source from - so re-pointing keeps the binding resolving.
			const newRef = relativePath(folder.uri, to) ?? item.toLabel;
			await this._rewriteDependentReferences(oldName, newRef);
			applied.push({ from, to, oldName, newRef });
		}
		if (!applied.length) { return; }
		this._onDidChange.fire();
		this._notify.notify({
			severity: Severity.Info,
			message: `Tidied ${applied.length} file${applied.length === 1 ? '' : 's'} into folders.`,
			sticky: true,
			actions: { primary: [toAction({ id: 'livingDocs.tidy.undo', label: 'Undo', run: () => this._undoTidy(applied) })] },
		});
	}

	// Invert an applied Tidy batch (the F16 Undo semantics): move each file (and its sidecar) back and restore
	// every dependent lock's `source` path. Reverse order and best-effort per move so one restored file that
	// now clashes cannot strand the rest of the undo.
	private async _undoTidy(applied: readonly { from: URI; to: URI; oldName: string; newRef: string }[]): Promise<void> {
		for (const move of [...applied].reverse()) {
			if (await this._files.exists(move.from)) {
				this._notify.error(`Cannot undo: "${basename(move.from)}" already exists again.`);
				continue;
			}
			try {
				await this._moveFileWithSidecar(move.to, move.from);
				await this._rewriteDependentReferences(move.newRef, move.oldName);
			} catch (e) {
				this._log.warn('[livingDocs] tidy undo failed', e);
			}
		}
		this._onDidChange.fire();
	}

	// Create a convention folder on demand (doc 22 section 5: the folders are born only when Tidy needs them).
	// A no-op when it already exists, so a second move into the same folder never errors.
	private async _ensureFolder(dir: URI): Promise<void> {
		if (!(await this._files.exists(dir))) { await this._files.createFolder(dir); }
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
		// insertion proposals in the review rail, exactly like any chat generation. The rail shows plain-words
		// progress (F4), never the internal template brief - the full instruction drives the model only.
		const instruction = composeTemplateInstruction(templateName, template.body, requested, note ?? '');
		const trimmedNote = (note ?? '').trim();
		const display = trimmedNote
			? `Draft "${requested}" from the ${templateName} template. ${trimmedNote}`
			: `Draft "${requested}" from the ${templateName} template.`;
		await this.sendChatMessage(target, instruction, display);
		return target;
	}

	// Draft a new document FROM SELECTED SOURCES (F17, journey 1b's third birth). Mirrors generateFromTemplate:
	// write a bare skeleton that DECLARES the picked sources (so provenance is honest and figures bind), open
	// it, then drive the SAME chat path every generation uses so the prose lands as reviewable insertion
	// proposals - never silently written. csv/json become `sources:` (value bindings); md/txt become `context:`
	// (prose knowledge). With no model reachable the skeleton is still created and a status line explains the
	// draft needs the model (honest empty state, never fake content). Returns the new document's URI.
	async generateFromSources(sources: readonly string[], docName: string, note: string): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) {
			this._notify.info('Open a folder to create a document.');
			return undefined;
		}
		const picks = sources.map(s => s.trim()).filter(Boolean);
		if (picks.length === 0) {
			this._notify.info('Pick at least one source to draft from.');
			return undefined;
		}
		// Value data (csv/json) binds; documents/notes (md/txt/everything else) are read as prose knowledge.
		const valueSources = picks.filter(s => /\.(csv|json)$/i.test(s));
		const contextSources = picks.filter(s => !/\.(csv|json)$/i.test(s));
		const firstStem = (picks[0].split('/').pop() ?? picks[0]).replace(/\.[a-z0-9]+$/i, '');
		const requested = LivingDocsService._safeStem(docName) || LivingDocsService._safeStem(firstStem) || 'Untitled';
		const skeleton = buildSourcesSkeleton(requested, valueSources, contextSources);
		const target = await this._uniqueDocUri(folder.uri, requested);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(skeleton));
			await this._editors.openEditor({ resource: target, options: { pinned: true } });
		} catch (e) {
			this._log.warn('[livingDocs] from-sources skeleton write failed', e);
			return undefined;
		}
		// Load so the declared sources are read alongside the doc (the chat path reads state.doc.sources/context).
		await this.loadDocument(target);
		if (!await this._hasModel()) {
			const state = this._docs.get(target.toString());
			if (state) { state.status = 'Draft skeleton created - connect a model to draft it from the sources'; }
			this._notify.info(`Created "${requested}" from ${picks.length} source${picks.length === 1 ? '' : 's'}. Start the local model proxy to draft its content.`);
			this._onDidChange.fire();
			return target;
		}
		const instruction = composeSourcesInstruction(requested, valueSources, contextSources, note ?? '');
		await this.sendChatMessage(target, instruction);
		return target;
	}

	// Grow a new template FROM EXAMPLE DOCUMENTS (F18, journey 1x). Validate the set (3-10; else a plain-words
	// refusal), write a real `<name>.template.md` skeleton (skill.md shape) that records the examples under
	// `context:` so the analysis reads them, open it (it joins the + New picker at once), then drive the SAME
	// chat path so the agent NAMES the commonalities as reviewable insertion proposals - the review grammar,
	// never a silent write. With no model reachable the skeleton is still created and a status line NAMES the
	// error - never rendered as "no commonalities" (the F14 rule). Returns the new template's URI.
	async generateTemplateFromExamples(examples: readonly string[], templateName: string): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		if (!folder) {
			this._notify.info('Open a folder to create a template.');
			return undefined;
		}
		const picks = examples.map(e => e.trim()).filter(Boolean);
		const check = validateExampleSet(picks);
		if (!check.ok) {
			this._notify.info(check.reason ?? 'Pick between 3 and 10 example documents.');
			return undefined;
		}
		const name = LivingDocsService._safeStem(templateName) || 'Untitled Template';
		const skeleton = buildExamplesTemplateSkeleton(name, picks);
		const target = await this._uniqueTemplateUriNamed(folder.uri, name);
		try {
			await this._files.writeFile(target, VSBuffer.fromString(skeleton));
			await this._editors.openEditor({ resource: target, options: { pinned: true } });
			this._onDidChange.fire();
		} catch (e) {
			this._log.warn('[livingDocs] from-examples template write failed', e);
			return undefined;
		}
		// Load so the declared example documents are read alongside the template (the analysis reads context).
		await this.loadDocument(target);
		if (!await this._hasModel()) {
			const state = this._docs.get(target.toString());
			if (state) { state.status = 'Template created - connect a model to analyse the examples and describe the pattern'; }
			this._notify.info(`Created the "${name}" template from ${picks.length} examples. Start the local model proxy to analyse them.`);
			this._onDidChange.fire();
			return target;
		}
		const instruction = composeExamplesInstruction(name, picks);
		await this.sendChatMessage(target, instruction);
		return target;
	}

	// Pick a non-colliding `<stem>.template.md` name in the folder (mirrors `_uniqueDocUri` for templates).
	private async _uniqueTemplateUriNamed(folder: URI, stem: string): Promise<URI> {
		const existing = new Set<string>();
		try {
			for (const child of (await this._files.resolve(folder)).children ?? []) {
				existing.add(basename(child.resource));
			}
		} catch {
			// An unreadable folder just means no collisions to avoid.
		}
		let name = `${stem}.template.md`;
		for (let n = 2; existing.has(name); n++) {
			name = `${stem} ${n}.template.md`;
		}
		return joinPath(folder, name);
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

	// The document's directory relative to the workspace root ('' = root), '/'-joined, so the tree-rail can
	// preserve on-disk hierarchy instead of flattening every document into one list (plan 37 F7). Resolved
	// against whichever workspace folder contains the document; a document outside every folder reports ''.
	private _relativeFolder(uri: URI): string {
		for (const folder of this._workspace.getWorkspace().folders) {
			const rel = relativePath(folder.uri, uri);
			if (rel === undefined || rel.startsWith('../') || rel === '..') { continue; }
			const slash = rel.lastIndexOf('/');
			return slash >= 0 ? rel.slice(0, slash) : '';
		}
		return '';
	}

	// The workspace's non-Markdown files, as basenames (plan 37 F9/F10): CSV/txt/image/data files for the
	// tree-rail SOURCES section and files we cannot yet import (.doc/.docx) for its "Not yet imported"
	// section. Mirrors `_collectDocs`' bounded, hidden-dir-skipping walk; classification is pure (treeRail).
	async listWorkspaceExtras(): Promise<readonly string[]> {
		const found = new Set<string>();
		for (const folder of this._workspace.getWorkspace().folders) {
			await this._collectExtras(folder.uri, found, 0);
		}
		return [...found].sort((a, b) => a.localeCompare(b));
	}

	private async _collectExtras(dir: URI, found: Set<string>, depth: number): Promise<void> {
		if (depth > 4) { return; }
		let children;
		try {
			children = (await this._files.resolve(dir)).children ?? [];
		} catch (e) {
			this._log.trace('[livingDocs] extras scan skipped', e instanceof Error ? e.message : String(e));
			return;
		}
		for (const child of children) {
			const name = basename(child.resource);
			if (child.isDirectory) {
				if (name.startsWith('.') || name === 'node_modules' || name === 'out') { continue; }
				await this._collectExtras(child.resource, found, depth + 1);
			} else if (classifyWorkspaceExtra(name)) {
				found.add(name);
			}
		}
	}

	// --- spreadsheets as CSV sources + PDF as read-only context (issue #131, doc 22 §4) -----------
	// A workbook's sheets extract to plain CSVs under `data/<workbook>/`; the workbook is watched and
	// re-extracts on change. A PDF's text is extracted to a portable cache and the PDF becomes a read-only
	// `context` edge. All heavy parsing runs in the node/proxy layer (P6); the renderer only writes the
	// resulting plain text into the project folder and threads the provenance.

	// The manifest that records a workbook's extraction provenance beside its CSVs. Dot-prefixed so the
	// tree-rail's extra scanner (which skips dotfiles) never lists it as a source.
	private static readonly WORKBOOK_MANIFEST = '.abstract-source.json';

	async resolveWorkspaceExtra(name: string): Promise<URI | undefined> {
		for (const folder of this._workspace.getWorkspace().folders) {
			const hit = await this._findExtra(folder.uri, name, 0);
			if (hit) { return hit; }
		}
		return undefined;
	}

	// --- docx -> Markdown import (issue #129, doc 22 section 2) ---

	// Find the first workspace file with the given basename (the tree row carries a basename, not a URI, so
	// import resolves it here). Bounded, hidden-dir-skipping walk like `_collectExtras`. Undefined when gone.
	private async _findExtraUri(name: string): Promise<URI | undefined> {
		const walk = async (dir: URI, depth: number): Promise<URI | undefined> => {
			if (depth > 4) { return undefined; }
			let children;
			try {
				children = (await this._files.resolve(dir)).children ?? [];
			} catch {
				return undefined;
			}
			for (const child of children) {
				const childName = basename(child.resource);
				if (child.isDirectory) {
					if (childName.startsWith('.') || childName === 'node_modules' || childName === 'out') { continue; }
					const hit = await walk(child.resource, depth + 1);
					if (hit) { return hit; }
				} else if (childName === name) {
					return child.resource;
				}
			}
			return undefined;
		};
		for (const folder of this._workspace.getWorkspace().folders) {
			const hit = await walk(folder.uri, 0);
			if (hit) { return hit; }
		}
		return undefined;
	}

	private async _findExtra(dir: URI, name: string, depth: number): Promise<URI | undefined> {
		if (depth > 4) { return undefined; }
		let children;
		try { children = (await this._files.resolve(dir)).children ?? []; } catch { return undefined; }
		for (const child of children) {
			const base = basename(child.resource);
			if (child.isDirectory) {
				if (base.startsWith('.') || base === 'node_modules' || base === 'out') { continue; }
				const hit = await this._findExtra(child.resource, name, depth + 1);
				if (hit) { return hit; }
			} else if (base === name) {
				return child.resource;
			}
		}
		return undefined;
	}

	async useXlsxAsSource(workbook: URI): Promise<IWorkbookUseResult> {
		let sheets: IExtractedSheet[];
		try {
			sheets = await this._extractWorkbookInto(workbook);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			this._log.warn('[livingDocs] workbook extraction failed', reason);
			return { ok: false, sheets: [], reason };
		}
		if (!sheets.length) {
			this._notify.error(`Could not read any sheets from ${basename(workbook)}. The workbook was left unchanged.`);
			return { ok: false, sheets: [], reason: 'No sheets could be read from this workbook.' };
		}
		this._watchWorkbook(workbook);
		this._onDidChange.fire();
		// Plain-words confirmation + any NAMED limitations surfaced verbatim (never a silent misread).
		const stem = basename(workbook).replace(/\.[^.]+$/, '') || basename(workbook);
		const warnings = sheets.flatMap(s => s.warnings);
		const suffix = warnings.length ? ` Note: ${warnings[0]}` : '';
		this._notify.info(`Using ${basename(workbook)} as a source - ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} extracted to data/${stem}.${suffix}`);
		return { ok: true, sheets };
	}

	// Extract every sheet to a clean CSV under `data/<workbook>/`, write the extraction manifest, and record
	// each CSV's workbook provenance. Shared by the initial "Use as source" and the watched re-extract, so a
	// workbook change writes byte-identical clean CSVs and re-flags dependents the same way.
	private async _extractWorkbookInto(workbook: URI): Promise<IExtractedSheet[]> {
		const bytes = (await this._files.readFile(workbook)).value;
		const dataBase64 = encodeBase64(bytes);
		const context = await this._request.request({
			type: 'POST',
			url: `${this._proxyUrl()}/sources/xlsx`,
			headers: { 'content-type': 'application/json' },
			data: JSON.stringify({ dataBase64 }),
			callSite: 'livingDocs.extractXlsx',
		}, CancellationToken.None);
		const json = await asJson<{ sheets?: { name: string; fileName: string; csv: string; rows: number; cols: number; warnings?: string[] }[]; error?: { message?: string } }>(context);
		if (!json || json.error || !Array.isArray(json.sheets)) {
			throw new Error(json?.error?.message ?? 'The spreadsheet could not be read.');
		}
		const wbName = basename(workbook);
		const stem = wbName.replace(/\.[^.]+$/, '') || wbName;
		const dir = joinPath(dirname(workbook), 'data', stem);
		const syncedAt = new Date().toISOString();
		const out: IExtractedSheet[] = [];
		const manifestSheets: { name: string; csv: string; warnings: string[] }[] = [];
		for (const sheet of json.sheets) {
			const warnings = sheet.warnings ?? [];
			await this._files.writeFile(joinPath(dir, sheet.fileName), VSBuffer.fromString(sheet.csv));
			const relativePath = `data/${stem}/${sheet.fileName}`;
			this._workbookProvenance.set(relativePath, { workbook: wbName, sheet: sheet.name, syncedAt, warnings });
			out.push({ name: sheet.name, fileName: sheet.fileName, relativePath, rows: sheet.rows, cols: sheet.cols, warnings });
			manifestSheets.push({ name: sheet.name, csv: sheet.fileName, warnings });
		}
		const manifest = { workbook: wbName, workbookHash: hashString(dataBase64), syncedAt, sheets: manifestSheets };
		await this._files.writeFile(joinPath(dir, LivingDocsService.WORKBOOK_MANIFEST), VSBuffer.fromString(JSON.stringify(manifest, null, 2) + '\n'));
		// Nudge the dependency graph for each rewritten CSV so dependent documents flag stale even if their
		// own per-document watcher is not currently live (the orchestrator rebuilds reverse edges from disk).
		for (const s of out) { void this._orchestrator.onSourceChanged(joinPath(dir, s.fileName).path); }
		return out;
	}

	// Watch a workbook used as a source; a change re-extracts its sheets (the workbook behaves like any live
	// source). Correlated watcher, keyed in a DisposableMap so re-use disposes the previous one and service
	// disposal tears them all down. Best-effort (no-op where the platform has no watcher, e.g. unit tests).
	private _watchWorkbook(workbook: URI): void {
		if (typeof this._files.createWatcher !== 'function') { return; }
		const store = new DisposableStore();
		try {
			const watcher = store.add(this._files.createWatcher(workbook, { recursive: false, excludes: [] }));
			store.add(watcher.onDidChange(() => void this._reextractWorkbook(workbook)));
		} catch (e) {
			this._log.trace('[livingDocs] workbook watch failed', e instanceof Error ? e.message : String(e));
		}
		this._workbookWatchers.set(workbook.toString(), store);
	}

	private async _reextractWorkbook(workbook: URI): Promise<void> {
		try {
			await this._extractWorkbookInto(workbook);
			// Recompute freshness for any loaded document (its bindings to the rewritten CSVs may now be stale).
			for (const state of this._docs.values()) { await this._recomputeFreshness(state); }
			this._onDidChange.fire();
		} catch (e) {
			this._log.warn('[livingDocs] workbook re-extract failed', e instanceof Error ? e.message : String(e));
		}
	}

	async usePdfAsSource(pdf: URI, doc: URI): Promise<IPdfContextResult> {
		let result: { readable?: boolean; text?: string; pages?: number; reason?: string; error?: { message?: string } } | null;
		try {
			const bytes = (await this._files.readFile(pdf)).value;
			const context = await this._request.request({
				type: 'POST',
				url: `${this._proxyUrl()}/sources/pdf`,
				headers: { 'content-type': 'application/json' },
				data: JSON.stringify({ dataBase64: encodeBase64(bytes) }),
				callSite: 'livingDocs.extractPdf',
			}, CancellationToken.None);
			result = await asJson(context);
		} catch (e) {
			return { ok: false, pages: 0, reason: e instanceof Error ? e.message : String(e) };
		}
		if (!result || result.error) {
			const reason = result?.error?.message ?? 'The PDF could not be read.';
			this._notify.error(`Could not read ${basename(pdf)}: ${reason}`);
			return { ok: false, pages: 0, reason };
		}
		// An image-only/scanned or password-protected PDF names itself unreadable - no dead context edge.
		if (!result.readable) {
			const reason = result.reason ?? 'This PDF has no readable text.';
			this._notify.info(`${basename(pdf)}: ${reason}`);
			return { ok: false, pages: result.pages ?? 0, reason };
		}
		// Persist the extracted text to the portable cache, then register the PDF as a read-only context edge
		// on the document (frontmatter `context:` - watched, hashed, stale-flagged, and shown in SOURCES).
		const rel = relativePath(dirname(doc), pdf) ?? basename(pdf);
		await this._files.writeFile(this._pdfTextCacheUri(doc, rel), VSBuffer.fromString(result.text ?? ''));
		await this.addContextFile(doc, rel);
		this._notify.info(`Using ${basename(pdf)} as read-only context for ${basename(doc)}.`);
		return { ok: true, pages: result.pages ?? 0 };
	}

	// The portable, rebuildable cache of a PDF's extracted text (doc 22 section 5 - `.abstract/knowledge/` holds
	// source caches). `_readContext` reads this instead of the PDF's raw bytes so the model sees real text,
	// not binary. Keyed by the context path so a reload finds it without re-parsing the PDF.
	private _pdfTextCacheUri(doc: URI, contextFile: string): URI {
		const root = this._workspace.getWorkspace().folders[0]?.uri ?? dirname(doc);
		return joinPath(root, '.abstract', 'knowledge', encodeURIComponent(contextFile) + '.txt');
	}

	// Rebuild the workbook → sheet provenance map from each `data/<workbook>/.abstract-source.json` manifest,
	// so an extracted CSV's provenance survives a reload without re-parsing the workbook. Best-effort: a
	// missing/invalid manifest is skipped (the CSV still works as a plain source, just without the hop label).
	private async _loadWorkbookManifests(): Promise<void> {
		for (const folder of this._workspace.getWorkspace().folders) {
			let stemDirs;
			try { stemDirs = (await this._files.resolve(joinPath(folder.uri, 'data'))).children ?? []; } catch { continue; }
			for (const stemDir of stemDirs) {
				if (!stemDir.isDirectory) { continue; }
				const stem = basename(stemDir.resource);
				try {
					const raw = (await this._files.readFile(joinPath(stemDir.resource, LivingDocsService.WORKBOOK_MANIFEST))).value.toString();
					const m = JSON.parse(raw) as { workbook?: string; syncedAt?: string; sheets?: { name?: string; csv?: string; warnings?: string[] }[] };
					if (!m || !Array.isArray(m.sheets)) { continue; }
					for (const s of m.sheets) {
						if (!s.csv || !s.name) { continue; }
						this._workbookProvenance.set(`data/${stem}/${s.csv}`, { workbook: m.workbook ?? `${stem}.xlsx`, sheet: s.name, syncedAt: m.syncedAt ?? '', warnings: s.warnings ?? [] });
					}
				} catch { /* no or invalid manifest - skip this folder */ }
			}
		}
	}

	async importDocx(name: string): Promise<IImportOutcome | undefined> {
		const source = await this._findExtraUri(name);
		if (!source) {
			this._notify.info('That file could not be found - it may have been moved or renamed.');
			return undefined;
		}
		// Read the original bytes and hash them for provenance (the same FNV-1a the binding freshness uses),
		// then convert THROUGH the node/proxy layer (mammoth) - never in the renderer (doc 22 section 2).
		let base64: string;
		let sourceHash: string;
		try {
			const bytes = (await this._files.readFile(source)).value;
			base64 = encodeBase64(bytes);
			sourceHash = hashString(base64);
		} catch (e) {
			this._log.warn('[livingDocs] docx import: unreadable source', e);
			this._notify.info(`"${name}" could not be read.`);
			return { ok: false, reason: 'The file could not be read' };
		}

		let response: { ok?: boolean; html?: string; detections?: IDocxDetections; reason?: string; error?: { message?: string } } | null;
		try {
			const context = await this._request.request({
				type: 'POST',
				url: `${this._proxyUrl()}/import/docx`,
				headers: { 'content-type': 'application/json' },
				data: JSON.stringify({ base64 }),
				callSite: 'livingDocs.importDocx',
			}, CancellationToken.None);
			response = await asJson(context);
		} catch (e) {
			this._log.warn('[livingDocs] docx import: proxy unreachable', e);
			this._notify.info('The importer is not running. Start the local model proxy and try again.');
			return { ok: false, reason: 'The importer is not running' };
		}
		if (!response || response.error || response.ok === false || typeof response.html !== 'string') {
			// A refused file (encrypted / legacy / unparseable) stays in the "not yet imported" state - the
			// row is untouched, the original is not mangled, and the reason is named plainly (F10 / doc 22).
			const reason = response?.reason ?? response?.error?.message ?? 'The file could not be imported';
			this._notify.info(`"${name}" was not imported - ${reason}.`);
			return { ok: false, reason };
		}

		// Convert to Markdown + lift images. Compute the target NAME first (beside the original, never
		// overwriting) so the image asset paths the Markdown references match the document's real stem.
		const dir = dirname(source);
		const originalStem = name.replace(/\.docx$/i, '');
		const target = await this._uniqueDocUri(dir, LivingDocsService._safeStem(originalStem) || 'Imported Document');
		const stem = basename(target).replace(/\.md$/, '');
		const detections = response.detections ?? { comments: false, trackedChanges: false, footnotes: false, textboxes: false, headersFooters: false };
		const conversion = convertDocxHtml(response.html, stem, detections);

		try {
			// Write the extracted images first so the freshly-opened document resolves its references.
			for (const image of conversion.images) {
				const assetUri = joinPath(dir, 'assets', stem, image.name);
				await this._files.writeFile(assetUri, decodeBase64(image.base64));
			}
			await this._files.writeFile(target, VSBuffer.fromString(conversion.markdown));
			// Provenance from birth (doc 22 section 2): the lock records where the .md came from, a hash of the
			// untouched original, and the plain-words kept/dropped summary so the provenance stays honest.
			const lock = emptyLock();
			lock.imported = {
				from: name,
				sourceHash,
				importedAt: new Date().toISOString(),
				kept: conversion.kept,
				dropped: conversion.dropped,
			};
			await this._lockStore.write(target, lock);
		} catch (e) {
			this._log.warn('[livingDocs] docx import: write failed', e);
			this._notify.info(`"${name}" could not be written after conversion.`);
			return { ok: false, reason: 'The converted document could not be written' };
		}

		await this._editors.openEditor({ resource: target, options: { pinned: true } });
		// The plain-words kept/dropped summary card (doc 22 section 2): sticky so the honesty about what the
		// conversion kept and dropped is not a flash. Real data only - built from the actual conversion.
		this._notify.notify({
			severity: Severity.Info,
			message: `Imported "${name}" - ${formatImportSummary(conversion.kept, conversion.dropped)}. The original is kept beside it.`,
			sticky: true,
		});
		this._onDidChange.fire();
		return { ok: true, resource: target, kept: conversion.kept, dropped: conversion.dropped };
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
				// Never a bare "Untitled" for an odd/blank-heading file: fall back to the filename (F8).
				title: documentDisplayTitle(doc, basename(uri)),
				isLiving: doc.isLiving,
				sourceKinds: [...kinds],
				sources: doc.sources,
				lastSynced: doc.context.length ? `${doc.context.length} context` : (bound ? `${bound} bound` : ''),
				pendingCount: this._pending.filter(c => c.docId === id).length,
				folder: this._relativeFolder(uri),
			};
		} catch (e) {
			this._log.trace('[livingDocs] summarize skipped', e instanceof Error ? e.message : String(e));
			return undefined;
		}
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

	private async _uniqueSiblingUri(folder: URI, name: string): Promise<URI> {
		const existing = new Set<string>();
		try {
			for (const child of (await this._files.resolve(folder)).children ?? []) {
				existing.add(basename(child.resource));
			}
		} catch {
			// Let the subsequent write surface an unreadable folder error.
		}
		const dot = name.lastIndexOf('.');
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : '';
		let candidate = name;
		for (let n = 2; existing.has(candidate); n++) {
			candidate = `${stem}-${n}${extension}`;
		}
		return joinPath(folder, candidate);
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
		// The current re-resolved values (the "now" for the drawer's then-vs-now, F13). We already read every
		// source here for the dirty-bit compare, so retaining the values costs nothing extra.
		const current = new Map<string, string>();
		if (state.doc.isLiving) {
			const resolution = await this._resolveCurrent(state, pass);
			for (const key of Object.keys(state.lock.bindings)) {
				const cur = resolution.get(key);
				if (cur) { current.set(key, cur.value); }
				if (cur && !bindingIsFresh(cur, state.lock.bindings[key])) { staleBindings.add(key); }
			}
			// A DELETED (or renamed-away) local file source resolves nothing at all, so the compare above -
			// which only sees values that DID resolve - can never flag it. Explicitly re-flag the lock's
			// bindings under a declared file source that is now missing on disk, so a dependent of a deleted
			// source honestly reads stale (map-D6 orphan: cached values kept, flagged, never broken). Scoped
			// to local file sources with recorded lock entries: api/mcp resolution misses (proxy down, host
			// cooldown) and never-synced keys keep their previous not-stale behaviour, matching how a deleted
			// CONTEXT file already flags below via its reviewedHash mismatch. The exists probe only runs when
			// nothing under the source's alias resolved (a readable source skips it), and is guarded for
			// harnesses whose file service has no `exists` (mirrors the `createWatcher` guard).
			if (typeof this._files.exists === 'function') {
				const resolvedAliases = new Set<string>();
				for (const key of resolution.keys()) { resolvedAliases.add(key.split('.')[0]); }
				for (const source of state.doc.sources) {
					if (sourceKind(source) !== 'file') { continue; }
					const alias = sourceAlias(source);
					if (resolvedAliases.has(alias)) { continue; }
					const keys = Object.keys(state.lock.bindings).filter(k => k.split('.')[0] === alias);
					if (!keys.length) { continue; }
					let missing = false;
					try { missing = !(await this._files.exists(joinPath(dirname(state.uri), source))); } catch { missing = false; }
					if (missing) { for (const key of keys) { staleBindings.add(key); } }
				}
			}
			for (const file of state.doc.context) {
				const entry = state.lock.context[file];
				const hash = await this._hashContext(state, file, pass);
				if (!entry || entry.reviewedHash !== hash) { staleContext.add(file); }
			}
		}
		state.staleBindings = staleBindings;
		state.staleContext = staleContext;
		state.current = current;
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
			const figureChange: IProposedChange = {
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
			};
			this._pending.push(figureChange);
			// A policy-driven agent run prepared this figure update, so its source is 'agent'.
			this._captureProposalCreated(figureChange, 'agent');
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
		// UI funnel + guardrail: a publish pins the sources; `stale_sources_present` records whether the gate flagged.
		this._analytics.capture('export_or_publish', { format: 'publish', provenance_mode: 'footnoted', stale_sources_present: !gate.pass });
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
		// Guardrail: restoring an earlier version is the "way back" after approvals. `depth` = how many audit
		// entries the restore steps back over (a coarse count, never any content), so a spike is visible.
		const depth = Math.max(0, state.lock.audit.length - snapshot.auditIndex);
		this._analytics.capture('undo_after_approve', { depth });
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
			// UI funnel + guardrail: an export happened. `stale_sources_present` is the guardrail signal (a doc
			// shipped while a bound source was stale) - it comes from the before-export gate, not document text.
			this._analytics.capture('export_or_publish', { format: 'html', provenance_mode: 'footnoted', stale_sources_present: !gate.pass });
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
			// The clean-Markdown export inlines resolved values (no bindings), so its provenance mode is 'clean'.
			this._analytics.capture('export_or_publish', { format: 'markdown', provenance_mode: 'clean', stale_sources_present: !gate.pass });
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] markdown export failed', e);
			return undefined;
		}
	}

	// The before-export gate, applied uniformly across every export format (plan 32 iter 4): a clean gate
	// passes; a failed gate blocks WITHOUT `force` and, WITH `force` ("Export anyway"), proceeds and audits the
	// override so the trail shows a human chose to ship past a flag. Returns `blocked` (caller aborts) and the
	// `stale` guardrail signal for analytics. Shared by the docx/PDF exports so the gate is written once.
	private async _gateExport(state: IDocState, force: boolean): Promise<{ blocked: boolean; stale: boolean; flag?: string }> {
		const gate = this._beforeExportGate(state);
		if (gate.pass) { return { blocked: false, stale: false }; }
		if (!force) { return { blocked: true, stale: true, flag: gate.flag }; }
		this._auditGateOverride(state, 'export', gate.flag ?? 'grader flagged');
		await this._lockStore.write(state.uri, state.lock).catch(e => this._log.warn('[livingDocs] override audit write failed', e));
		return { blocked: false, stale: true, flag: gate.flag };
	}

	// The proxy's `/export/docx` route caps the request body at 24 MiB. The images travel as base64 `data:` URIs
	// inside that JSON body, so we hold the aggregate ENCODED image payload under this budget (leaving headroom
	// for the Markdown and JSON structure) and drop any image that would push a docx export over a limit it must
	// otherwise fail on. PDF prints locally with no such body, so it passes no budget.
	private static readonly EXPORT_IMAGE_BUDGET_BYTES = 22 * 1024 * 1024;

	// Resolve every `![alt](src)` in the export Markdown to a `data:` URI (via the same contained, size-capped
	// reader the webview uses), so a downstream converter that has no access to the project folder still embeds
	// the real images. Unreadable/oversized images are dropped from the map (the converter names them in text).
	// Destinations with spaces (`<a b.png>`) or balanced parens (`foo(bar).png`) are parsed correctly, so a valid
	// local image is never silently skipped. When `budgetBytes` is set, images are added only while the aggregate
	// encoded payload stays within it; anything over-budget is reported via `droppedForBudget`.
	private async _collectExportImages(resource: URI, markdown: string, budgetBytes?: number): Promise<{ images: Record<string, string>; droppedForBudget: number }> {
		const images: Record<string, string> = {};
		const seen = new Set<string>();
		let encodedTotal = 0;
		let droppedForBudget = 0;
		for (let i = 0; i < markdown.length; i++) {
			if (markdown[i] !== '!' || markdown[i + 1] !== '[') { continue; }
			const match = matchMarkdownImageAt(markdown, i);
			if (!match) { continue; }
			i = match.end - 1; // skip past this image; the loop's i++ resumes after it
			const src = match.src;
			if (seen.has(src) || /^(https?:|data:)/.test(src)) { continue; }
			seen.add(src);
			const read = await this.readImageAsset(resource, src);
			if (!read.dataUri) { continue; }
			if (budgetBytes !== undefined && encodedTotal + read.dataUri.length > budgetBytes) {
				this._log.warn('[livingDocs] image omitted from export - over the aggregate size budget', src);
				droppedForBudget++;
				continue;
			}
			encodedTotal += read.dataUri.length;
			images[src] = read.dataUri;
		}
		return { images, droppedForBudget };
	}

	async exportDocx(resource: URI, force = false): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const gate = await this._gateExport(state, force);
		if (gate.blocked) { this._notify.info(`Export blocked - ${gate.flag}`); return undefined; }
		// The resolved export Markdown (bind values inlined as plain text) is the single source both docx and
		// the HTML/Markdown exports build from, so the docx carries the same clean, chrome-free content. It
		// already leads with `# title` + `_subtitle_` (like the HTML export body), so we do NOT also pass the
		// title/subtitle separately - that would render them twice.
		const markdown = renderExportMarkdown(state.doc, this.getResolved(resource));
		const { images, droppedForBudget } = await this._collectExportImages(resource, markdown, LivingDocsService.EXPORT_IMAGE_BUDGET_BYTES);
		if (droppedForBudget > 0) {
			// Honest, before-the-fact: say what was left out rather than posting an over-cap body that must 413.
			this._notify.info(`${droppedForBudget} large image(s) were left out of the Word export to keep it under the size limit.`);
		}
		const stem = basename(resource).replace(/\.md$/, '');
		const target = joinPath(dirname(resource), `${stem}.export.docx`);
		try {
			// Conversion runs in the node/proxy layer where file access + Node libs live, never the renderer
			// (doc 22 §3): the proxy's /export/docx route returns the .docx bytes we write beside the document.
			const context = await this._request.request({
				type: 'POST',
				url: `${this._proxyUrl()}/export/docx`,
				headers: { 'content-type': 'application/json' },
				data: JSON.stringify({ markdown, images }),
				callSite: 'livingDocs.exportDocx',
			}, CancellationToken.None);
			if ((context.res.statusCode ?? 0) !== 200) {
				this._log.warn('[livingDocs] docx export route failed', context.res.statusCode);
				this._notify.info('Word export needs the local model proxy running. Start it, then export again.');
				return undefined;
			}
			const bytes = await streamToBuffer(context.stream);
			await this._files.writeFile(target, bytes);
			this._notify.info(`Exported "${state.doc.title}" to ${basename(target)}.`);
			// docx inlines resolved values (no bindings), so - like the clean Markdown export - its provenance
			// mode is 'clean'; `stale_sources_present` is the before-export gate guardrail signal.
			this._analytics.capture('export_or_publish', { format: 'docx', provenance_mode: 'clean', stale_sources_present: gate.stale });
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] docx export failed', e);
			this._notify.info('Word export needs the local model proxy running. Start it, then export again.');
			return undefined;
		}
	}

	// The command the desktop build registers (electron-browser/livingDocsPdf.contribution) to print an HTML
	// page to PDF bytes via Electron's own print engine. It is ABSENT on the web dev harness, where PDF is
	// honestly unavailable rather than a broken button (doc 22 §3; desktop is the beta vehicle).
	static readonly PRINT_TO_PDF_COMMAND = '_livingDocs.printToPDF';

	async exportPdf(resource: URI, force = false): Promise<URI | undefined> {
		const state = this._docs.get(resource.toString());
		if (!state) { return undefined; }
		const gate = await this._gateExport(state, force);
		if (gate.blocked) { this._notify.info(`Export blocked - ${gate.flag}`); return undefined; }
		// The existing self-contained HTML export IS the PDF's page; images are inlined as data URIs so the
		// offscreen print has no project-folder dependency (doc 22 §3: reuse the HTML export, no new renderer).
		let html = renderExportHtml(state.doc, this.getResolved(resource));
		const markdown = renderExportMarkdown(state.doc, this.getResolved(resource));
		const { images } = await this._collectExportImages(resource, markdown);
		for (const [src, dataUri] of Object.entries(images)) {
			html = html.split(`src="${src}"`).join(`src="${dataUri}"`);
		}
		const stem = basename(resource).replace(/\.md$/, '');
		const target = joinPath(dirname(resource), `${stem}.export.pdf`);
		try {
			// Print-to-PDF runs through Electron's main process (doc 22 §3); the browser service reaches it
			// through the desktop-only command so it stays free of a desktop dependency. A missing command
			// (web harness) or a failed print returns undefined -> honest message, never a broken write.
			const bytes = await this._commands.executeCommand<VSBuffer | undefined>(LivingDocsService.PRINT_TO_PDF_COMMAND, html);
			if (!bytes) {
				this._notify.info('PDF export is available in the desktop app. Use Web page or Word here.');
				return undefined;
			}
			await this._files.writeFile(target, bytes);
			this._notify.info(`Exported "${state.doc.title}" to ${basename(target)}.`);
			this._analytics.capture('export_or_publish', { format: 'pdf', provenance_mode: 'clean', stale_sources_present: gate.stale });
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] pdf export failed', e);
			this._notify.info('PDF export is available in the desktop app. Use Web page or Word here.');
			return undefined;
		}
	}

	shareDocument(resource: URI): void {
		// Live shareable links aren't built yet; point the user at the portable export for now.
		this._notify.info('A live shareable link is coming soon. Use Download to send a Markdown copy in the meantime.');
	}

	// Pasted/dropped images resolve back through this same doc-relative read, capped so a runaway file cannot
	// balloon the webview message channel (the reply is a base64 data URI, ~4/3 the byte size).
	private static readonly IMAGE_ASSET_CAP = 10 * 1024 * 1024;

	// Path-traversal guard (defense-in-depth for the desktop file: scheme, where the file service reads the
	// real disk): an image target computed from doc-relative input must stay inside the document's folder or
	// the workspace - a doc body carrying `![x](../../secret)` must never read outside the project. joinPath
	// collapses `..` segments, so containment of the NORMALISED target is checked with the platform's
	// isEqualOrParent, never a hand-rolled string compare.
	private _isContainedImageTarget(resource: URI, target: URI): boolean {
		if (isEqualOrParent(target, dirname(resource))) { return true; }
		return this._workspace.getWorkspace().folders.some(f => isEqualOrParent(target, f.uri));
	}

	async saveImageAsset(resource: URI, name: string, bytes: VSBuffer, mime?: string): Promise<string> {
		// The #129 import layout: assets live beside the document under `assets/<doc-basename>/`.
		const stem = basename(resource).replace(/\.md$/, '');
		const folder = joinPath(dirname(resource), 'assets', stem);
		const safe = sanitizeImageAssetName(name, mime);
		let existing: string[] = [];
		try {
			existing = ((await this._files.resolve(folder)).children ?? []).map(c => basename(c.resource));
		} catch {
			// The assets folder does not exist yet; writeFile creates the parent chain.
		}
		const finalName = dedupeAssetName(safe, existing);
		const target = joinPath(folder, finalName);
		// The sanitised name cannot carry separators, so this cannot trip in practice - kept for symmetry with
		// readImageAsset so every image path computed from webview input passes the same containment gate.
		if (!this._isContainedImageTarget(resource, target)) {
			this._log.warn('[livingDocs] image asset write escapes the document folder', name);
			throw new Error('image asset target escapes the document folder');
		}
		try {
			await this._files.writeFile(target, bytes);
		} catch (e) {
			this._log.warn('[livingDocs] image asset write failed', e);
			throw e;
		}
		return `assets/${stem}/${finalName}`;
	}

	async readImageAsset(resource: URI, src: string): Promise<{ readonly dataUri?: string; readonly error?: boolean }> {
		try {
			// The webview asks only for document-relative srcs (`assets/Doc/x.png`, `./logo.png`); resolve
			// against the document's folder. joinPath normalises any `./`/`..` segments.
			const target = joinPath(dirname(resource), src);
			if (!this._isContainedImageTarget(resource, target)) {
				// Same visible broken-image reply as a missing file - the traversal is refused, never silent.
				this._log.warn('[livingDocs] image asset read escapes the workspace', src);
				return { error: true };
			}
			const content = await this._files.readFile(target);
			if (content.value.byteLength > LivingDocsService.IMAGE_ASSET_CAP) {
				this._log.warn('[livingDocs] image asset too large to inline', src, content.value.byteLength);
				return { error: true };
			}
			return { dataUri: `data:${imageMimeForName(src)};base64,${encodeBase64(content.value)}` };
		} catch (e) {
			// Missing file (or unreadable): the editor shows a visible broken state - never a silent skip.
			this._log.warn('[livingDocs] image asset read failed', src, e);
			return { error: true };
		}
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
		// Audit-mirror: a run over `scope_size` documents began. run_finished (below) closes it with the outcome.
		const runStart = Date.now();
		this._analytics.capture('run_started', { scope_size: context.docs.length });
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
		// Audit-mirror: the run finished. `failures` counts the blocked-at-gate outcome (0 or 1 per run here);
		// `cancelled` is true when a Stop left documents unprocessed. No document text - counts and durations only.
		this._analytics.capture('run_finished', {
			scope_size: context.docs.length,
			cancelled: skipped > 0,
			failures: blocked ? 1 : 0,
			duration_ms: Date.now() - runStart,
		});
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
				// The impact pass is driven by a source change (agent/hook), so this proposal's source is 'agent'.
				this._captureProposalCreated(change, 'agent');
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
	isModelReachable(): Promise<boolean> {
		return this._hasModel();
	}

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
		// The provider door the survey was answered against is a bounded label, so it is safe to also mirror the
		// survey completion through the consent-gated analytics seam as the typed `model_configured` event (the
		// free-text answers stay in the local /event sink above; only the door label leaves the machine).
		this._analytics.capture('model_configured', { provider: (await this.getModelProviderStatus()).provider });
	}

	// --- D26 onboarding funnel + feedback verb (doc 20 section D26; doc 15 section 2.1; doc 18 sections 2.4/2.5) ---

	// Record one T5 onboarding funnel step. Routes through the analytics service, so a declined/unset consent
	// silently no-ops (the consent moment gates the whole path); the label is the verbatim section-2.1 funnel
	// name, a bounded analytics `label`.
	recordOnboardingStep(step: OnboardingStep): void {
		this._analytics.capture('onboarding_step', { step: onboardingStepLabel(step) });
		// At the hand-off ("bring a real folder"), arm the T4 aha: the next approved change on the user's own
		// file fires `first-approve-own`. Persisted so it survives the folder-open reload (see approve()).
		if (step === 'first-folder') {
			this._storage.store(ONBOARDING_AWAIT_OWN_APPROVE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	}

	endOnboardingWalkthrough(): void {
		for (const key of [ONBOARDING_ACTIVE_KEY, ONBOARDING_DEMO_URI_KEY, ONBOARDING_PEEKED_KEY, ONBOARDING_SAMPLE_KEY, ONBOARDING_AWAIT_OWN_APPROVE_KEY]) {
			this._storage.remove(key, StorageScope.APPLICATION);
		}
	}

	private _onboardingActive(): boolean {
		return this._storage.getBoolean(ONBOARDING_ACTIVE_KEY, StorageScope.APPLICATION, false);
	}

	// Record a funnel step that a service hook drives during an active walkthrough, once. `flagKey` de-duplicates
	// so a step fires a single time even if the user peeks/approves repeatedly.
	private _recordOnboardingStepOnce(step: OnboardingStep, flagKey: string): void {
		if (!this._onboardingActive() || this._storage.getBoolean(flagKey, StorageScope.APPLICATION, false)) { return; }
		this._storage.store(flagKey, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.recordOnboardingStep(step);
	}

	// The demo-doc approve hook (doc 20 section D26 step 5): the first approve of the sample proposal during a
	// walkthrough is `first-approve-sample`, and it hands off to the user's own folder (step 6) via a gentle,
	// shell-independent notification (the onboarding screen cannot coexist with the editor here). Fires once.
	private _maybeRecordSampleApprove(docId: string): void {
		if (!this._onboardingActive()) { return; }
		if (this._storage.get(ONBOARDING_DEMO_URI_KEY, StorageScope.APPLICATION) !== docId) { return; }
		if (this._storage.getBoolean(ONBOARDING_SAMPLE_KEY, StorageScope.APPLICATION, false)) { return; }
		this._storage.store(ONBOARDING_SAMPLE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.recordOnboardingStep('first-approve-sample');
		// Hand-off: only arm the own-file aha after the user actually picks a folder.
		this._notify.notify({
			severity: Severity.Info,
			message: 'Nice - that is the sample. Now bring a real folder: the first change you approve on your own file is the moment Abstract is built for.',
			actions: { primary: [toAction({ id: 'livingDocs.onboarding.bringFolder', label: 'Bring a real folder', run: async () => { if (await this.openFolder()) { this.recordOnboardingStep('first-folder'); } } })] },
		});
	}

	// The T4 aha (doc 15 section 2.1): the first approved change on the user's OWN file after the hand-off.
	// Armed at the hand-off (persisted), fired once here by the approve path, then cleared so it never repeats;
	// reaching the aha also ends the walkthrough session.
	private _maybeRecordOwnFileApprove(): void {
		if (!this._storage.getBoolean(ONBOARDING_AWAIT_OWN_APPROVE_KEY, StorageScope.APPLICATION, false)) { return; }
		this._analytics.capture('onboarding_step', { step: onboardingStepLabel('first-approve-own') });
		this.endOnboardingWalkthrough();
	}

	// The feedback verb (doc 18 section 2.5): flag an applied change as "this was wrong". Two sinks, matching
	// the doc: a consent-gated `this_was_wrong_reported` analytics event that carries ONLY a hashed reference id
	// (never the document's prose or the comment), and a founder-visible LOCAL log line that keeps the plain-words
	// comment so every report can be read. Best-effort - a report never blocks or throws.
	reportChangeWrong(report: IFeedbackReport): void {
		// The analytics ref is an opaque hash of the doc title + change reference: it lets the funnel count
		// reports per change without the title or prose ever leaving the machine (the `hashed` prop contract).
		const refId = AnalyticsService.hashPath(`${report.docTitle}::${report.changeRef}`);
		this._analytics.capture('this_was_wrong_reported', { ref_id: refId });
		// Founder log (doc 18 section 2.5 + doc 15 section 2.4: every report is read). Local only, so it may keep
		// the comment. `info` so it surfaces in the product log without the noise gate a trace would carry.
		this._log.info(founderFeedbackLogLine(report, new Date().toISOString()));
	}

	// The "See it work" path (doc 20 section D26 step 2): with no folder to open and no setup, write the bundled
	// demo CSV + demo Living Document into the open folder and sync its figures straight from the CSV. The result
	// is a REAL Living Document - its bound figures resolve from the bundled data (so the provenance peek, wow
	// one, shows source / value / synced) and its "Note to the board" paragraph is a single reviewable block the
	// prompted iteration tightens (wow two). Reuses the same write / load / sync machinery every generation uses;
	// no new persistence path. Does NOT open an editor - the onboarding surface opens the returned URI beside its
	// guide (a side group), so generating never displaces the onboarding screen. Undefined when no folder is open.
	async generateDemoReport(): Promise<URI | undefined> {
		const folder = this._workspace.getWorkspace().folders[0];
		const demoFolder = folder?.uri ?? URI.from({ scheme: Schemas.vscodeUserData, path: '/abstract/onboarding' });
		try {
			if (!folder) { await this._files.createFolder(demoFolder); }
			const csvUri = await this._uniqueSiblingUri(demoFolder, DEMO_CSV_NAME);
			const target = await this._uniqueDocUri(demoFolder, DEMO_DOC_NAME);
			// Write the bundled demo data first so the document's binds resolve on load, then the document itself.
			await this._files.writeFile(csvUri, VSBuffer.fromString(DEMO_CSV));
			await this._files.writeFile(target, VSBuffer.fromString(buildDemoReportMarkdown(basename(csvUri))));
			// Load + sync so the lock is populated from the bundled CSV (correct hashes -> the peek reads fresh). The
			// authored figures already match the CSV's deterministic formatting, so the sync reconciles to no change.
			await this.loadDocument(target);
			await this.refreshFromSources(target);
			// Begin the walkthrough session: the remaining funnel steps (provenance-peek, first-approve-sample) are
			// recorded by the in-document hooks below, scoped to this demo document. Reset the once-flags for reruns.
			this._storage.store(ONBOARDING_ACTIVE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._storage.store(ONBOARDING_DEMO_URI_KEY, target.toString(), StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._storage.store(ONBOARDING_PEEKED_KEY, false, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._storage.store(ONBOARDING_SAMPLE_KEY, false, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this._onDidChange.fire();
			return target;
		} catch (e) {
			this._log.warn('[livingDocs] demo report write failed', e instanceof Error ? e.message : String(e));
			return undefined;
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
			// A PDF context source (issue #131) contributes its EXTRACTED text, not its raw bytes: read the
			// portable extraction cache written by usePdfAsSource. A cache miss (never extracted / cache
			// deleted) contributes nothing rather than binary garbage - honest empty, never a misread.
			if (file.toLowerCase().endsWith('.pdf')) {
				try { parts.push((await this._files.readFile(this._pdfTextCacheUri(state.uri, file))).value.toString()); }
				catch { /* no extracted text cached yet */ }
				continue;
			}
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

	// `displayText`, when given, is the plain-words progress shown to the user in the rail while the model
	// is driven with the full `text` instruction (plan 37 F4): a template generation shows "Draft ... from
	// the ... template." rather than dumping the internal template brief/prompt into the chat. The full
	// instruction is kept on the turn's `prompt` so a retry re-runs the brief, not the shown words.
	async sendChatMessage(resource: URI, text: string, displayText?: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) { return; }
		const id = resource.toString();
		const history = this._chats.get(id) ?? [];
		this._chats.set(id, history);

		const mentions = this._parseMentions(resource, trimmed);
		const shown = (displayText ?? '').trim();
		history.push({ role: 'user', content: shown || trimmed, prompt: shown ? trimmed : undefined, mentions: mentions.length ? mentions : undefined });
		await this._deliverChatReply(resource, trimmed, mentions);
	}

	// Answer a read-only whole-project question for the Project Home composer (F15 / journey 1w, map-D24). This
	// reuses the existing model plumbing (`_hasModel`, `_readContext`, `_callModel`, `parseChatResponse`) but is
	// deliberately SEPARATE from the chat delivery path: it queues no proposal and mutates no document - it only
	// reads the project and returns prose + citations. The citations are the REAL files consulted (doc titles +
	// their sources), intersected with any the model named, so the answer is never grounded in a fabricated ref.
	async askProjectQuestion(question: string): Promise<IProjectAnswer> {
		const trimmed = question.trim();
		if (!trimmed) { return { answer: '', citations: [], via: 'fallback' }; }
		const docs = await this.listDocuments();
		if (docs.length === 0) {
			return { answer: 'This project has no documents yet - create one, then ask me about it.', citations: [], via: 'fallback' };
		}
		if (!await this._hasModel()) {
			return {
				answer: 'The agent model is not reachable. Start the local proxy (scripts/lwd-anthropic-proxy.sh) and I can answer using this project and its sources.',
				citations: [],
				via: 'fallback',
			};
		}
		// Load every project document so it can be serialized (figures resolved) for the prompt, and collect the
		// distinct source files consulted. These names ARE the citation set - the honest record of what the answer
		// was read from, whether or not the model echoes them back.
		const sections: string[] = [];
		const consulted = new Set<string>();
		for (const summary of docs) {
			const id = summary.resource.toString();
			if (!this._docs.get(id)) { await this.loadDocument(summary.resource); }
			const state = this._docs.get(id);
			if (!state) { continue; }
			consulted.add(state.doc.title);
			const sourceFiles = [...state.doc.sources, ...state.doc.context];
			const sources = await this._readContext(state, sourceFiles);
			for (const f of sourceFiles) { consulted.add(f); }
			sections.push(`### Document: "${state.doc.title}"\n${this._serializeDocForChat(state)}\nSources (${sourceFiles.join(', ') || 'none'}):\n"""${sources}"""`);
		}
		const system = 'You are the project assistant on the Project Home screen, answering a READ-ONLY question about the whole project. '
			+ 'Answer ONLY from the documents and sources shown below - do NOT propose or make any edit. '
			+ 'Reply with ONLY a JSON object: {"answer": string, "citations": [string]} where "citations" is the list of the document or source names (exactly as shown) that your answer relied on. Keep the answer concise and plain-words.';
		const user = `Project documents:\n\n${sections.join('\n\n')}\n\nQuestion: ${trimmed}`;
		let raw: string;
		try {
			raw = await this._callModel(system, user);
		} catch (e) {
			if (isModelPausedError(e)) { return { answer: e.message, citations: [], via: 'fallback' }; }
			this._log.info('[livingDocs] project question failed, honest fallback', e instanceof Error ? e.message : String(e));
			return { answer: 'The model call failed - please try again.', citations: [], via: 'fallback' };
		}
		// Tolerant parse: the shape is {answer, citations} but a model (or the canned proxy) may reply with the
		// chat {reply,...} envelope or plain prose. `parseChatResponse` routes a non-JSON / prose reply into
		// `reply`, so `answer || reply || raw` is always real prose; the raw JSON envelope is never surfaced.
		let answer = '';
		let namedCitations: string[] = [];
		try {
			const start = raw.indexOf('{');
			const end = raw.lastIndexOf('}');
			if (start >= 0 && end > start) {
				const obj = JSON.parse(raw.slice(start, end + 1));
				if (typeof obj.answer === 'string') { answer = obj.answer.trim(); }
				if (Array.isArray(obj.citations)) { namedCitations = obj.citations.filter((c: unknown): c is string => typeof c === 'string'); }
			}
		} catch {
			// Not the {answer, citations} shape; fall through to the tolerant chat-envelope parse below.
		}
		if (!answer) { answer = parseChatResponse(raw).reply.trim() || raw.trim(); }
		// Citations are the REAL consulted files: keep only names the model returned that we actually read (so a
		// hallucinated citation is dropped), and fall back to everything consulted when the model named none.
		const cited = namedCitations.filter(c => consulted.has(c));
		const citations = cited.length ? cited : [...consulted];
		return { answer: answer || 'I do not have enough in the project to answer that.', citations, via: 'model' };
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
		// Re-run the underlying instruction (the template brief for a generation turn), not the plain-words
		// progress shown in the rail (plan 37 F4): `prompt` holds it when the shown content was substituted.
		const instruction = last.prompt ?? last.content;
		const mentions = last.mentions ? [...last.mentions] : this._parseMentions(resource, instruction);
		void this._deliverChatReply(resource, instruction, mentions);
	}

	retryFailedDocs(resource: URI): void {
		const id = resource.toString();
		const history = this._chats.get(id);
		// Never retry while a reply is in flight, or when there is nothing to retry.
		if (!history || !history.length || this._chatBusy.has(id)) { return; }
		// The retry re-runs ONLY the documents the last fan-out failed for (F14, issue #123). The failed set is
		// recorded on the last assistant turn; without it (a clean run, or a whole-turn failure) there is nothing
		// surgical to retry - retryChat handles the plain single-turn Retry.
		const lastTurn = history[history.length - 1];
		if (lastTurn.role !== 'assistant' || !lastTurn.failedDocs || !lastTurn.failedDocs.length) { return; }
		const failedIds = lastTurn.failedDocs.map(d => d.id);
		// Drop the failed assistant turn(s) so the retry REPLACES them (the user turn is kept and re-run - no
		// duplicate user message), then re-deliver restricted to just the failed documents.
		while (history.length && history[history.length - 1].role === 'assistant') { history.pop(); }
		const last = history[history.length - 1];
		if (!last || last.role !== 'user') { return; }
		const mentions = last.mentions ? [...last.mentions] : this._parseMentions(resource, last.content);
		void this._deliverChatReply(resource, last.content, mentions, failedIds);
	}

	// The shared chat-turn delivery (plan 27 iters 2-3): sets busy, opens a per-document cancellation source,
	// streams the reply into a live turn (onDelta appends prose, onStep appends tool steps as they settle),
	// then pushes the final assistant turn. A cancel keeps the salvaged prose as a muted "stopped" turn
	// (D27-B); a genuine failure pushes a "failed" turn the rail offers Retry on. The user turn is already the
	// last history entry (pushed by sendChatMessage, or kept by retryChat), so the transcript reads correctly.
	private async _deliverChatReply(resource: URI, trimmed: string, mentions: string[], restrictToDocIds?: readonly string[]): Promise<void> {
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
			// A working set fans the instruction across every doc in one model call (plan 18, decision 62);
			// with no set the chat stays single-doc against the active document (decision 61). A surgical retry
			// (F14, issue #123) restricts the working set to the documents that failed last time, so only they
			// re-run - a re-tried doc is looked up in the current working set by its resource id.
			let workingSet = this.getWorkingSet(resource);
			if (restrictToDocIds && restrictToDocIds.length) {
				const keep = new Set(restrictToDocIds);
				workingSet = workingSet.filter(w => keep.has(w.resource.toString()));
			}
			if (!await this._hasModel()) {
				// A fan-out with the model down must name EVERY target document as failed and offer "Retry failed"
				// (F14, issue #123) - never the single-doc guidance line, which would hide the fan-out's failures
				// and (on the run screen) let the swarm read as a silent all-clear. The single-doc path keeps the
				// existing plain-words guidance turn (there are no fan-out documents to list).
				if (workingSet.length) {
					const failedDocs: IFanoutFailedDoc[] = workingSet.map(w => ({ id: w.resource.toString(), title: w.title }));
					const outcome = summarizeFanoutRun({ proposedCount: 0, failedDocs });
					this._fanoutProgress.set(id, { batchIndex: 0, batchCount: 0, oversizeDocIds: [], failedDocIds: failedDocs.map(d => d.id) });
					this._onDidChange.fire();
					history.push({ role: 'assistant', via: 'fallback', content: outcome.content, failedDocs: outcome.failedDocs });
					return;
				}
				history.push({ role: 'assistant', via: 'fallback', content: 'The agent model is not reachable. Start the local proxy (scripts/lwd-anthropic-proxy.sh) and I can answer using this document and its sources.' });
				return;
			}
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
				// resumes on its own at day rollover, or immediately once the user signs in with ChatGPT. The
				// `paused` marker lets the run screen render a paused fan-out honestly (F14 item 3) - never a
				// failure and never an all-clear.
				history.push({ role: 'assistant', via: 'fallback', content: e.message, paused: true });
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
		// Documents whose batch's model call failed (F14, issue #123): collected as the run proceeds so a model
		// outage over some (or all) batches surfaces as a NAMED failure listing these documents, never a silent
		// "no changes". Each doc is in exactly one batch, so a failed batch attributes failure to exactly its docs.
		const failedDocs: IFanoutFailedDoc[] = [];
		const publishProgress = (batchIndex: number) => {
			this._fanoutProgress.set(anchorId, { batchIndex, batchCount: plan.batchCount, oversizeDocIds, failedDocIds: failedDocs.map(d => d.id) });
			this._onDidChange.fire();
		};
		publishProgress(0);
		// Announce every oversize document up front (plan-23 honesty rule): a document larger than the whole
		// budget is NEVER sent - its tile/step says so rather than the run silently dropping it.
		for (const doc of plan.oversize) {
			addStep({ label: `${doc.title}: too large for this run`, status: 'queued' });
		}

		let anyReply = '';
		// The plain-words budget-cap message if the run pauses mid-fan-out (spent daily budget). When set, the
		// loop stops running further batches but keeps every proposal already queued - the run pauses, it does
		// NOT fail and is NOT an all-clear (F14 item 3; plan 35 iter 3).
		let pausedMessage: string | undefined;
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
			let raw: string;
			try {
				raw = b === 0
					? await this._chatModelCall(system, user, onDelta, token)
					: await this._callModel(system, user);
			} catch (e) {
				// A cancel is the user stopping the whole run - salvage the streamed prose (D27-B), never a failure.
				if (isCancellationError(e)) { throw e; }
				// The day's included usage is spent (plan 35 iter 3): keep every proposal queued so far, stop the
				// fan-out, and surface the plain-words cap message as a calm pause - NOT a failure, NOT an all-clear.
				if (isModelPausedError(e)) { pausedMessage = e.message; publishProgress(0); break; }
				// A genuine model outage/error for THIS batch (F14, issue #123): attribute the failure to exactly
				// this batch's documents, record it for the honest named error + surgical retry, and KEEP GOING so
				// later batches can still land their proposals (a partial success), instead of aborting the whole run.
				this._log.info('[livingDocs] fan-out batch failed, recording failed docs', e instanceof Error ? e.message : String(e));
				for (const d of batch.docs) { failedDocs.push({ id: d.id, title: d.title }); }
				addStep({ label: `${batch.docs.map(d => d.title).join(', ')}: model unreachable`, status: 'queued' });
				publishProgress(b + 1);
				continue;
			}
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
					const queued = this._queueChatEdit(target, edit, sources, 'fan-out');
					if (queued) { addStep({ label: `${target.doc.title}: ${queued.label}`, status: 'queued' }); proposedIds.push(queued.id); }
				}
				for (const insert of entry.inserts) {
					const queued = this._queueChatInsert(target, insert, sources, 'fan-out');
					if (queued) { addStep({ label: `${target.doc.title}: new content after ${queued.label}`, status: 'queued' }); proposedIds.push(queued.id); }
				}
			}
		}
		// Mark the fan-out as no longer on a live batch (batchIndex 0) while keeping the batchCount + oversize +
		// failed sets, so the settled run screen still reads "N too large" / "N failed" without a spurious "batch K".
		this._fanoutProgress.set(anchorId, { batchIndex: 0, batchCount: plan.batchCount, oversizeDocIds, failedDocIds: failedDocs.map(d => d.id) });

		// Aggregate the run honestly (F14, issue #123): a pause shows the cap message; any failed documents show a
		// named error listing them (with the proposals that DID land, on a partial success) + "Retry failed"; a
		// clean run keeps the existing reply / neutral no-change line. The all-clear is reachable ONLY when there
		// were no failures and no pause, so a model outage can never render as "no changes proposed".
		const outcome = summarizeFanoutRun({ proposedCount: proposedIds.length, failedDocs, reply: anyReply, pausedMessage });
		return {
			role: 'assistant',
			via: outcome.isError || outcome.isPaused ? 'fallback' : 'model',
			content: outcome.content,
			steps: steps.length ? steps : undefined,
			proposedIds: proposedIds.length ? proposedIds : undefined,
			failedDocs: outcome.failedDocs.length ? outcome.failedDocs : undefined,
			paused: outcome.isPaused || undefined,
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
	private _queueChatEdit(state: IDocState, edit: { heading?: string; oldText?: string; newText?: string; rationale?: string; sourceQuote?: string; sourceLine?: number }, sourceText?: string, source: 'chat' | 'fan-out' = 'chat'): { id: string; label: string } | undefined {
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
		const change: IProposedChange = {
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
		};
		this._pending.push(change);
		this._captureProposalCreated(change, source);
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
	private _queueChatInsert(state: IDocState, insert: { afterHeading?: string; newText?: string; rationale?: string; sourceQuote?: string; sourceLine?: number }, sourceText?: string, source: 'chat' | 'fan-out' = 'chat'): { id: string; label: string } | undefined {
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
		const change: IProposedChange = {
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
		};
		this._pending.push(change);
		this._captureProposalCreated(change, source);
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
		// Audit-mirror: one approve resolved this proposal (tweaked = the human amended it first). `bulk` is
		// false here; the bulk paths (approveAll) pass true to their own resolved emit is not needed because
		// each underlying approve fires - so bulk resolution is captured as the individual approves it fans to.
		this._captureProposalResolved(change.tweaked ? 'tweak' : 'approve', this._inBulkApprove);
		// D26 funnel hooks (no-ops outside a walkthrough): approving the demo's sample proposal is step 5 and
		// hands off to a real folder; the first approve on the user's own file after that hand-off is the T4 aha.
		this._maybeRecordSampleApprove(change.docId);
		this._maybeRecordOwnFileApprove();
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
		// Mark the fanned approves as bulk so each proposal_resolved carries bulk:true (doc 15 section 3.1).
		this._inBulkApprove = true;
		try {
			for (const id of ids) {
				await this.approve(id);
			}
		} finally {
			this._inBulkApprove = false;
		}
	}

	reject(changeId: string): void {
		const change = this._pending.find(c => c.id === changeId);
		if (!change) { return; }
		this._pending = this._pending.filter(c => c.id !== changeId);
		const state = this._docs.get(change.docId);
		if (state) {
			state.lock.audit.push(this._entry(change.blockId, 'rejected', change.oldText, change.newText, change.via ?? 'model'));
			this._captureProposalResolved('reject', this._inBulkReject);
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
		this._inBulkReject = true;
		try {
			for (const id of ids) {
				this.reject(id);
			}
		} finally {
			this._inBulkReject = false;
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
		const rows: ISourcePeekRow[] = Object.keys(state.lock.bindings).map(key => {
			const value = state.lock.bindings[key].resolved;
			// then-vs-now (F13): if the source has drifted since last sync, surface the live value alongside.
			const now = state.staleBindings.has(key) ? state.current?.get(key) : undefined;
			const current = now !== undefined && now !== value ? now : undefined;
			return { key, value, selected: selected.has(key), ...(current !== undefined ? { current } : {}) };
		});
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
		// When the peeked CSV was extracted from a spreadsheet (issue #131), surface the workbook → sheet hop so
		// the drawer reads figure → CSV row → extracted from `Budget.xlsx · Sheet "FY26"` → synced-at. Keyed by
		// the clicked binding's source file first (a doc may bind several CSVs), then the primary file source.
		const clickedFile = (cells[0] ? state.lock.bindings[cells[0]]?.source : undefined)?.split('#')[0];
		const workbook = this._workbookProvenance.get(clickedFile ?? '') ?? this._workbookProvenance.get(source);
		return { source, rows, referencedBy, grid, payload, ...(pinnedLabel ? { pinnedLabel } : {}), ...(workbook ? { workbook } : {}) };
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
	notePeek(mode: 'click-through' | 'toolbar'): void {
		this._analytics.capture('provenance_peeked', { mode });
		// D26 wow one: during a walkthrough, opening a bound figure's source is the provenance-peek funnel step.
		const activeUri = this._editors.activeEditor?.resource?.toString();
		if (activeUri && activeUri === this._storage.get(ONBOARDING_DEMO_URI_KEY, StorageScope.APPLICATION)) {
			this._recordOnboardingStepOnce('provenance-peek', ONBOARDING_PEEKED_KEY);
		}
	}

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
		// Audit-mirror: a source_synced per distinct source KIND (file/api/mcp) - a count of what synced, no
		// source name or value ever. `ok:true` because a sync that reaches here completed without throwing.
		for (const kind of this._distinctSourceKinds(state)) {
			this._analytics.capture('source_synced', { kind, ok: true });
		}
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

	// --- analytics (plan 36 iter 2): the audit-mirror emitters, funnelled through these few points rather
	// than sprinkled through the UI. Each captures a typed event whose properties are counts/kinds/durations
	// only - never document prose or bound figures (the property-linter in the service enforces this before
	// anything is sent; document ids are hashed opaque). Every call is a no-op unless the user has consented. ---

	/** Map a proposal's 0..1 confidence to a coarse label (never the raw figure, which could be revealing). */
	private _confidenceLabel(confidence: number): string {
		return confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
	}

	/** The distinct source kinds (file / api / mcp) a document binds to, for the source_synced analytics event. */
	private _distinctSourceKinds(state: IDocState): SourceKind[] {
		const kinds = new Set<SourceKind>();
		for (const key of Object.keys(state.lock.bindings)) {
			kinds.add(parseMcpKey(key) ? 'mcp' : sourceKind(state.lock.bindings[key].source));
		}
		for (const source of state.doc.sources) {
			kinds.add(sourceKind(source));
		}
		return [...kinds];
	}

	/** Emit `proposal_created` for one queued change (source: chat / fan-out / agent / hook). */
	private _captureProposalCreated(change: IProposedChange, source: 'chat' | 'fan-out' | 'agent' | 'hook'): void {
		this._analytics.capture('proposal_created', {
			source_kind: source,
			change_kind: change.kind,
			confidence: this._confidenceLabel(change.confidence),
		});
	}

	/** Emit `proposal_resolved` when a change is approved / tweaked-and-approved / rejected. */
	private _captureProposalResolved(resolution: 'approve' | 'tweak' | 'reject', bulk: boolean): void {
		this._analytics.capture('proposal_resolved', { resolution, bulk });
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
