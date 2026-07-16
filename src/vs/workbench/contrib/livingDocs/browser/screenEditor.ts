/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { matchesSomeScheme, Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { AgentPolicy, bulkApproveConfirm, groupDecisions, groupPendingByDoc, IAgentRun, IAgentTrigger, ISkillRunSummary, nextPendingDocId, reviewedDocsFromSeen, summariseProjectRun } from '../common/livingDocsModel.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ChatGptSignInStage, ILivingDocSummary, ILivingDocsService, IModelProviderStatus, IProjectAnswer, ISkillCheck, ISourceInfo, ITemplateInfo, ITidyPlanItem } from '../common/livingDocs.js';
import { IAnalyticsService } from '../common/analytics.js';
import { buildAwayFeed, classifyProjectChat, IAwayFeed } from '../common/projectHomeFeed.js';
import { DEMO_ITERATION_PROMPT, nextOnboardingStep, ONBOARDING_STEPS, OnboardingStep } from '../common/onboarding.js';
import { ScreenEditorInput } from './screenEditorInput.js';
import { AgentFilter, IHomeFailure, IProjectRunScreenState, IRecentProject, IReviewProjectScreenState, ITidyReviewState, renderScreenHtml, ScreenId } from './screenRender.js';

// Persisted onboarding step + demo-document URI (profile scope) so the two-wow flow "remembers where you were"
// across reopens and the folder-open reload at hand-off (doc 20 section D26). The step + demo URI are persisted
// (not just held in memory) because the walkthrough opens the demo document in the same editor group - which
// displaces the onboarding screen - so the guide is re-entered from Home and must restore its place.
const ONBOARDING_STEP_KEY = 'livingDocs.onboardingStep';
const ONBOARDING_DEMO_KEY = 'livingDocs.onboardingDemoUri';

// The editor's interactive state; the live agent registry is injected at render time.
interface IScreenEditorState {
	knScope: 'org' | 'project';
	openAgentId?: string;
	filter: AgentFilter;
	lastRun?: IAgentRun;
	// Agents detail drawer (plan 32 iter 3): the result of the most recent "Run skill across project", held so
	// the run strip persists across re-renders until the drawer is closed/re-opened. The run log itself is read
	// live from the service each render (like the agent registry), so it is not carried here.
	skillRun?: ISkillRunSummary;
	// Home: the documents discovered in the open folder (fetched async; the folder name is read live at render).
	docs?: readonly ILivingDocSummary[];
	// Templates: the `*.template.md` files discovered in the open folder (plan 28); fetched async on open and
	// re-fetched on onDidChange so a New Template (or one edited on disk) shows without reopening the screen.
	templates?: readonly ITemplateInfo[];
	// Knowledge (plan 29): the project's real source registry, fetched async on open + re-fetched on change
	// (so an add/detach/source-edit re-projects); the selected source drives the detail drawer; the folder's
	// data files feed the Add-source picker.
	sources?: readonly ISourceInfo[];
	knSelectedSource?: string;
	dataFiles?: readonly string[];
	// Home + Templates: the project's document files (md/txt), for the "From sources..." knowledge picker (F17)
	// and the from-examples template wizard's example picker (F18); fetched with dataFiles on open + on change.
	docFiles?: readonly string[];
	// Home: recently-opened folders from the workbench history (D22-A); fetched async alongside docs.
	recentFolders?: readonly IRecentProject[];
	// Project-run (C4): the live/last whole-project fan-out state, or undefined for the truthful idle
	// state. The run-kick sets this (23.3); the swarm summary + live working overlay are recomputed at
	// render time from the service (`summariseProjectRun` + `isChatBusy`) so tiles update as the run runs.
	projectRun?: IProjectRunScreenState;
	// The document the whole-project chat is anchored on (the working set + chat key). Held so each
	// re-render can read the live `isChatBusy(anchor)` and the pending set to refresh the swarm.
	projectRunAnchor?: URI;
	// The project's documents at run-kick time (id + title), used to build every swarm tile so a doc the
	// run did not touch still renders as a `no change` tile. Fetched once when the run is kicked.
	projectRunDocs?: readonly { readonly docId: string; readonly docTitle: string }[];
	// Cross-document review (C5, plan 24): the doc selected in the centre column (local navigation). The
	// pending set + counts are read live from the service each render, so this is the only navigation state.
	reviewCurrentDocId?: string;
	// The docs SEEN with pending changes while the review screen has been open, keyed by docId -> human
	// title. A seen doc that now has zero pending is "reviewed this session" (its human title, not the raw
	// docId URI, then shows in the rail). Recomputed each render from the live pending set; carried across
	// renders so a doc that emptied does not vanish once its changes leave the pending set.
	reviewSeenDocs?: ReadonlyMap<string, string>;
	// The attached source name for the review topbar chip, carried over from the run that produced the
	// changes (undefined when the screen is opened directly, e.g. from the palette, with no run context).
	reviewSource?: string;
	// Home: the latest failed scheduled run, for the quiet attention line (plan 32 iter 2). Undefined when
	// nothing failed; rebuilt on open + on every change so a fresh failure surfaces without reopening Home.
	homeFailure?: IHomeFailure;
	// Settings (plan 35 iter 4): the live model door + usage snapshot, the sign-in flow stage + any error, and
	// whether the onboarding survey has been recorded this session. Fetched on open + refreshed while a sign-in
	// is pending; real data only (the status comes straight from the proxy's /healthz).
	providerStatus?: IModelProviderStatus;
	signInStage?: ChatGptSignInStage;
	signInError?: string;
	// The OpenAI authorize URL for the in-flight sign-in (plan 38): surfaced in the pending state as a real
	// clickable link + copyable fallback so a fresh user reaches the sign-in page without a swallowed popup.
	signInAuthorizeUrl?: string;
	surveySaved?: boolean;
	analyticsEnabled?: boolean;
	// Home front door (F15 / journey 1w): the WHILE YOU WERE AWAY feed (built on open + refresh from the run
	// log, the live pending set and the since-last-visit cutoff), the last read-only whole-project answer + its
	// citations, and whether a question is in flight. The cutoff is captured ONCE per Home open (so a re-render
	// mid-session does not keep pushing the window forward and hide everything the user just saw).
	awayFeed?: IAwayFeed;
	awaySinceMs?: number;
	projectAnswer?: IProjectAnswer;
	askBusy?: boolean;
	// Onboarding (D26): the guided flow's current funnel step, the generated demo document's URI (so later
	// steps re-open it rather than re-generate), and whether a model door is reachable (read on open).
	onboardingStep?: OnboardingStep;
	onboardingDemoUri?: URI;
	onboardingHasModel?: boolean;
	// Home only: the persisted in-progress onboarding step, to show the "Continue your walkthrough" banner.
	onboardingResumeStep?: OnboardingStep;
	// Home: the Tidy verb's review surface (doc 22 section 5) - the proposed moves as approve/skip rows, or
	// the applied summary. Absent until "Tidy this project" is invoked; the full plan (with file URIs) is held
	// separately in `_tidyPlan` so apply can address the real resources while this projection drives the HTML.
	tidyReview?: ITidyReviewState;
}

// Weekday names for the Home failure line ("failed on Monday"). Local time - matches when the user saw it.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Webview editor that hosts one Abstract screen (Templates / Knowledge / Agents) in the
// editor area. The screen's small interactive state (Knowledge scope, agent canvas, run state)
// lives here and re-renders the webview, mirroring the comp; cross-surface actions are routed to
// the living-docs service / editor service.
export class ScreenEditor extends EditorPane {

	static readonly ID = 'workbench.editor.livingDocs.screen';

	private _container: HTMLElement | undefined;
	private _webview: IWebviewElement | undefined;
	private _screen: ScreenId = 'templates';
	private _state: IScreenEditorState = { knScope: 'org', filter: 'all' };
	// The full Tidy plan (with file URIs + dependents) behind the current review surface (doc 22 section 5).
	// Kept parallel to `_state.tidyReview.items` so a per-row decision toggle and the apply address the same
	// moves by index. Cleared when the surface is dismissed or applied.
	private _tidyPlan?: readonly ITidyPlanItem[];
	private readonly _inputDisposables = this._register(new DisposableStore());
	// The single in-flight "Sign in with ChatGPT" poll (plan 35 iter 4), replaced each poll so a re-open or a
	// completed sign-in never leaves a timer running on the class store.
	private readonly _signInPoll = this._register(new MutableDisposable());
	// Holds the current webview. The iframe reloads (blank) whenever this pane is hidden by another
	// editor in the group and later re-shown (DOM re-parent), and the low-level webview does not
	// re-apply its HTML, so we recreate it fresh each time the pane becomes visible.
	private readonly _webviewStore = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IEditorService private readonly _editors: IEditorService,
		@IInstantiationService private readonly _instantiation: IInstantiationService,
		@ILivingDocsService private readonly _livingDocs: ILivingDocsService,
		@IWorkspacesService private readonly _workspaces: IWorkspacesService,
		@IHostService private readonly _host: IHostService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IConfigurationService private readonly _configuration: IConfigurationService,
		@IAnalyticsService private readonly _analytics: IAnalyticsService,
	) {
		super(ScreenEditor.ID, group, telemetryService, themeService, _storageService);
		this._storage = _storageService;
	}

	/** The user's current analytics consent, read from the single source of truth (the Settings toggle). */
	private _analyticsEnabled(): boolean {
		return this._configuration.getValue<boolean>('abstract.analytics.enabled') === true;
	}

	// The storage service (also handed to super) captured for the Home last-visit cursor. Assigned in the
	// constructor body because parameter properties are set after the super() call the base pane requires.
	private readonly _storage: IStorageService;

	// Home all-clear tracking (map-D14): the last needs-you total observed while Home is open, and when it last
	// became non-zero, so `all_clear_reached` fires exactly on the >0 -> 0 transition with an honest duration.
	private static readonly LAST_VISIT_KEY = 'livingDocs.home.lastVisitMs';
	private _homeNeedsYou: number | undefined;
	private _homeNeedsYouSinceMs: number | undefined;

	protected createEditor(parent: HTMLElement): void {
		this._container = $('.living-docs-screen');
		this._container.style.height = '100%';
		this._container.style.width = '100%';
		parent.appendChild(this._container);
	}

	override async setInput(input: ScreenEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._screen = input.screen;
		// Reset per-screen state on (re)open so each visit starts from the default view.
		this._state = { knScope: 'project', filter: 'all' };
		// Home reflects the open folder: fetch its documents + recent folders + templates before the first
		// render so there is no flash (templates seed the New-document sheet's template rows, iter 4).
		if (this._screen === 'home') {
			// Capture the since-last-visit cutoff ONCE per open (and advance the stored cursor to now), so the
			// WHILE YOU WERE AWAY feed shows what happened since the previous visit and stays stable on refresh.
			const sinceMs = this._captureLastVisit();
			const [docs, recentFolders, templates, dataFiles, docFiles] = await Promise.all([
				this._livingDocs.listDocuments(),
				this._fetchRecentFolders(),
				this._livingDocs.listTemplates(),
				this._livingDocs.getFolderDataFiles(),
				this._livingDocs.getFolderDocFiles(),
			]);
			const awayFeed = this._buildAwayFeed(sinceMs);
			this._state = { ...this._state, docs, recentFolders, templates, dataFiles, docFiles, homeFailure: this._homeFailure(), awaySinceMs: sinceMs, awayFeed };
			// Reset the all-clear tracking baseline for this Home open, then seed it from the current count.
			this._homeNeedsYou = undefined;
			this._homeNeedsYouSinceMs = undefined;
			this._trackAllClear(awayFeed.needsYouTotal);
		}
		// Templates reflects the open folder's `*.template.md` files (plan 28) plus its documents (the
		// from-examples wizard's example picker, F18): fetch before first render.
		if (this._screen === 'templates') {
			const [templates, docFiles] = await Promise.all([
				this._livingDocs.listTemplates(),
				this._livingDocs.getFolderDocFiles(),
			]);
			this._state = { ...this._state, templates, docFiles };
		}
		// Knowledge reflects the project's real source registry (plan 29): fetch the sources, the documents
		// (Add-source target list) and the folder's data files (the picker) before the first render.
		if (this._screen === 'knowledge') {
			const [sources, docs, dataFiles] = await Promise.all([
				this._livingDocs.listSources(),
				this._livingDocs.listDocuments(),
				this._livingDocs.getFolderDataFiles(),
			]);
			this._state = { ...this._state, sources, docs, dataFiles };
		}
		// Settings (plan 35 iter 4): fetch the live model door + usage before the first render so the provider
		// card shows the real state (which door serves you, today's included usage), no flash.
		if (this._screen === 'settings') {
			const status = await this._livingDocs.getModelProviderStatus();
			this._state = { ...this._state, providerStatus: status, signInStage: status.signedIn ? 'signed-in' : 'signed-out', analyticsEnabled: this._analyticsEnabled() };
		}
		// Onboarding (D26): resume the funnel where the user left it (persisted) and read whether a model door is
		// reachable so the flow never dead-ends. The `onboarding_step: open` event is recorded on the first engaged
		// action (see _onbSeeItWork), not here: the consent moment resolves asynchronously, so a capture on open
		// would race ahead of consent and be dropped by the gate.
		if (this._screen === 'onboarding') {
			const status = await this._livingDocs.getModelProviderStatus();
			const saved = this._storageService.get(ONBOARDING_STEP_KEY, StorageScope.PROFILE) as OnboardingStep | undefined;
			const step: OnboardingStep = saved && (ONBOARDING_STEPS as readonly string[]).includes(saved) ? saved : 'open';
			const demoStr = this._storageService.get(ONBOARDING_DEMO_KEY, StorageScope.PROFILE);
			this._state = { ...this._state, onboardingStep: step, onboardingHasModel: status.provider !== 'none', onboardingDemoUri: demoStr ? URI.parse(demoStr) : undefined };
		}
		// Home surfaces a "Continue your walkthrough" banner when an onboarding is in progress (persisted, not the
		// final aha), so the guide is re-enterable after it was displaced by the demo document (D26).
		if (this._screen === 'home') {
			const saved = this._storageService.get(ONBOARDING_STEP_KEY, StorageScope.PROFILE) as OnboardingStep | undefined;
			this._state = { ...this._state, onboardingResumeStep: saved && saved !== 'first-approve-own' && (ONBOARDING_STEPS as readonly string[]).includes(saved) ? saved : undefined };
		}
		this._inputDisposables.clear();
		this._signInPoll.clear();
		// Re-render when agent status / the document set changes (e.g. a run completes, a doc is created).
		this._inputDisposables.add(this._livingDocs.onDidChange(() => this._onDidChange()));
		// Keep the Model access data-flow card's analytics-consent row live: if consent flips anywhere else (the
		// first-run moment, VS Code Settings), re-read it so the row never shows a stale On/Off (issue #134).
		if (this._screen === 'settings') {
			this._inputDisposables.add(this._configuration.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('abstract.analytics.enabled')) { void this._refreshSettings(); }
			}));
		}
		this._mountWebview();
	}

	// A document or agent changed: re-fetch the Home document list (so a new/removed doc shows), re-fetch the
	// Templates list (so a New Template appears), else re-render.
	private _onDidChange(): void {
		if (this._screen === 'home') {
			void this._refreshHome();
		} else if (this._screen === 'templates') {
			void this._refreshTemplates();
		} else if (this._screen === 'knowledge') {
			void this._refreshKnowledge();
		} else if (this._screen === 'settings') {
			void this._refreshSettings();
		} else {
			this._render();
		}
	}

	// Re-read the model door + usage (e.g. after a sign-in/sign-out or a metered call) and re-render Settings.
	private async _refreshSettings(): Promise<void> {
		const status = await this._livingDocs.getModelProviderStatus();
		this._state = { ...this._state, providerStatus: status, analyticsEnabled: this._analyticsEnabled() };
		this._render();
	}

	private async _refreshTemplates(): Promise<void> {
		const [templates, docFiles] = await Promise.all([
			this._livingDocs.listTemplates(),
			this._livingDocs.getFolderDocFiles(),
		]);
		this._state = { ...this._state, templates, docFiles };
		this._render();
	}

	// Re-project the source registry after an add/detach or an on-disk source edit, so the SOURCES table, the
	// freshness dots and the detail drawer all resync from the live locks.
	private async _refreshKnowledge(): Promise<void> {
		const [sources, docs, dataFiles] = await Promise.all([
			this._livingDocs.listSources(),
			this._livingDocs.listDocuments(),
			this._livingDocs.getFolderDataFiles(),
		]);
		this._state = { ...this._state, sources, docs, dataFiles };
		this._render();
	}

	private async _refreshHome(): Promise<void> {
		const [docs, recentFolders, templates, dataFiles, docFiles] = await Promise.all([
			this._livingDocs.listDocuments(),
			this._fetchRecentFolders(),
			this._livingDocs.listTemplates(),
			this._livingDocs.getFolderDataFiles(),
			this._livingDocs.getFolderDocFiles(),
		]);
		// Rebuild the away feed against the cutoff captured at open (not a fresh now-cursor) so the section stays
		// stable across in-session refreshes; track the needs-you transition so the all-clear promotion + event
		// react as proposals land and are cleared (map-D14).
		const awayFeed = this._buildAwayFeed(this._state.awaySinceMs);
		this._state = { ...this._state, docs, recentFolders, templates, dataFiles, docFiles, homeFailure: this._homeFailure(), awayFeed };
		this._trackAllClear(awayFeed.needsYouTotal);
		this._render();
	}

	// Read the stored last-visit cursor (the WHILE YOU WERE AWAY cutoff) and advance it to now. Undefined on the
	// first visit, so the feed shows every recorded run rather than an empty window (journey 1w).
	private _captureLastVisit(): number | undefined {
		const stored = this._storage.getNumber(ScreenEditor.LAST_VISIT_KEY, StorageScope.WORKSPACE);
		this._storage.store(ScreenEditor.LAST_VISIT_KEY, Date.now(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		return stored;
	}

	// Assemble the WHILE YOU WERE AWAY feed from the persisted run log, the live pending set (the real needs-you
	// count) and the since-last-visit cutoff. Pure assembly lives in `buildAwayFeed`; this only gathers the live
	// inputs. Real data only - an empty window yields an empty feed and the honest all-clear.
	private _buildAwayFeed(sinceMs: number | undefined): IAwayFeed {
		const agentNames: Record<string, string> = {};
		for (const a of this._livingDocs.getAgents()) { agentNames[a.id] = a.name; }
		return buildAwayFeed({
			runs: this._livingDocs.getAgentRuns(),
			agentNames,
			needsYouTotal: this._livingDocs.getAllPending().length,
			sinceMs,
			nowMs: Date.now(),
		});
	}

	// Track the needs-you total across Home renders so `all_clear_reached` fires exactly on the >0 -> 0
	// transition (map-D14): the feed was driven to zero. Seeds the baseline silently on the first observation.
	private _trackAllClear(needsYouTotal: number): void {
		const now = Date.now();
		const prev = this._homeNeedsYou;
		if (prev === undefined) {
			this._homeNeedsYou = needsYouTotal;
			this._homeNeedsYouSinceMs = needsYouTotal > 0 ? now : undefined;
			return;
		}
		if (prev === 0 && needsYouTotal > 0) {
			this._homeNeedsYouSinceMs = now;
		} else if (prev > 0 && needsYouTotal === 0) {
			const since = this._homeNeedsYouSinceMs;
			this._analytics.capture('all_clear_reached', {
				items_cleared: prev,
				time_to_clear_ms: since !== undefined ? Math.max(0, now - since) : 0,
			});
			this._homeNeedsYouSinceMs = undefined;
		}
		this._homeNeedsYou = needsYouTotal;
	}

	// The whole-project chat composer (F15 / journey 1w, map-D21/D24): classify the input, then either answer a
	// question read-only with citations (rendered back into the composer) or open the run/task surface for a
	// change request. Reuses the existing fan-out chat machinery via `_openProjectRun` - no new chat engine.
	private async _askProject(text: string): Promise<void> {
		if (classifyProjectChat(text) === 'change') {
			await this._openProjectRun(text);
			return;
		}
		this._state = { ...this._state, askBusy: true, projectAnswer: undefined };
		this._render();
		const answer = await this._livingDocs.askProjectQuestion(text);
		this._state = { ...this._state, askBusy: false, projectAnswer: answer };
		this._render();
	}

	// --- the Tidy verb (doc 22 section 5): propose -> review -> apply, model-free -----------------------

	// "Tidy this project": build the deterministic move plan and show it as an approve/skip review surface.
	// Every proposed move defaults to approved (the plan is a vetted proposal) but is individually skippable,
	// and NOTHING moves until the explicit Apply below - the review-grammar contract (propose, human disposes).
	private async _startTidy(): Promise<void> {
		const plan = await this._livingDocs.buildTidyPlan();
		this._tidyPlan = plan;
		const items = plan.map(p => ({
			fromLabel: p.fromLabel,
			toLabel: p.toLabel,
			reason: p.reason,
			dependents: p.dependents.map(d => d.title),
			decision: 'approved' as const,
		}));
		this._state = { ...this._state, tidyReview: { items } };
		this._render();
	}

	// Toggle one proposed move's decision (approve/skip). The plan and the review rows stay index-aligned, so
	// this only flips the row's decision and re-renders; the move itself is untouched until Apply.
	private _setTidyDecision(indexArg: string | undefined, decision: 'approved' | 'skipped'): void {
		const review = this._state.tidyReview;
		const index = Number(indexArg);
		if (!review || !Number.isInteger(index) || index < 0 || index >= review.items.length) { return; }
		const items = review.items.map((it, i) => (i === index ? { ...it, decision } : it));
		this._state = { ...this._state, tidyReview: { ...review, items } };
		this._render();
	}

	// Apply the approved moves through the F16 atomic machinery (doc 22 section 5). A move that would touch a
	// document's bindings warns and LISTS the dependents first (the map-D6 warn-list-proceed shape) - it never
	// blocks; proceeding re-points them so bindings survive. The service raises the sticky Undo toast; on
	// return the surface flips to the calm applied summary and Home refreshes so the moved files show in place.
	private async _applyTidy(): Promise<void> {
		const review = this._state.tidyReview;
		const plan = this._tidyPlan;
		if (!review || !plan) { return; }
		const approved = plan.filter((_, i) => review.items[i]?.decision === 'approved');
		if (!approved.length) { return; }
		const dependentTitles = [...new Set(approved.flatMap(p => p.dependents.map(d => d.title)))].sort((a, b) => a.localeCompare(b));
		if (dependentTitles.length) {
			const { confirmed } = await this._dialogService.confirm({
				type: 'warning',
				message: `${dependentTitles.length} document${dependentTitles.length === 1 ? ' references' : 's reference'} files you are moving.`,
				detail: `Their links will be re-pointed to the new location in the same move, so nothing breaks:\n${dependentTitles.map(t => `\u2022 ${t}`).join('\n')}\n\nYou can undo this.`,
				primaryButton: 'Move anyway',
			});
			if (!confirmed) { return; }
		}
		await this._livingDocs.applyTidyMoves(approved);
		const applied = approved.length;
		this._tidyPlan = undefined;
		this._state = { ...this._state, tidyReview: { items: [], applied } };
		await this._refreshHome();
	}

	// Build the Home attention line from the latest failed run (plan 32 iter 2). Real data only: undefined
	// when nothing failed, so the surface renders nothing rather than fabricating activity.
	private _homeFailure(): IHomeFailure | undefined {
		const run = this._livingDocs.getLatestAgentFailure();
		if (!run || !run.error) { return undefined; }
		const agent = this._livingDocs.getAgents().find(a => a.id === run.agentId);
		const when = run.finishedAt ?? run.startedAt;
		const day = WEEKDAY_NAMES[new Date(Date.parse(when)).getDay()] ?? 'recently';
		return { agentName: agent?.name ?? run.agentId, day, error: run.error };
	}

	// Fetch the workbench recently-opened folder list for the ALL PROJECTS grid (D22-A). Maps each
	// IRecentFolder to a plain { name, folderUri } object that the renderer can serialize safely into
	// HTML without holding a live URI reference inside a pure render function.
	// Name resolution order: (1) the stored human label (set when VSCode knows a display name),
	// (2) the last non-empty path segment of the folderUri (e.g. "/Users/tom/brief" -> "brief"),
	// (3) basename() from the resource module. Entries that produce only a single letter or an
	// empty name after this are skipped - they are FSA mount stubs with no useful display name.
	private async _fetchRecentFolders(): Promise<readonly IRecentProject[]> {
		try {
			const { workspaces } = await this._workspaces.getRecentlyOpened();
			return workspaces
				.filter(isRecentFolder)
				.map(r => {
					const segments = r.folderUri.path.split('/').filter(Boolean);
					const lastName = segments[segments.length - 1] ?? '';
					const name = r.label ?? (lastName.length > 1 ? lastName : basename(r.folderUri));
					return { name, folderUri: r.folderUri.toString() };
				})
				.filter(r => r.name.length > 1);
		} catch {
			return [];
		}
	}

	// Recreate the webview fresh and render the current screen into it. Called on setInput and whenever
	// the pane becomes visible, so a screen reopened after a document editor was active is never blank.
	private _mountWebview(): void {
		if (!this._container) {
			return;
		}
		const store = new DisposableStore();
		const webview = store.add(this._webviewService.createWebviewElement({
			options: {},
			contentOptions: { allowScripts: true },
			title: 'Abstract',
			extension: undefined,
		}));
		this._container.replaceChildren();
		webview.mountTo(this._container, this.window);
		store.add(webview.onMessage(e => this._onMessage(e.message)));
		this._webview = webview;
		this._webviewStore.value = store;
		this._render();
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (visible) {
			this._mountWebview();
		}
	}

	private _onMessage(message: { type?: string; arg?: string; name?: string; note?: string; target?: string; apiurl?: string; text?: string; value?: string; daily?: string; subs?: string; weekly?: string; picks?: string }): void {
		switch (message?.type) {
			case 'setKnOrg':
				this._state = { ...this._state, knScope: 'org' };
				this._render();
				break;
			case 'setKnProject':
				this._state = { ...this._state, knScope: 'project' };
				this._render();
				break;
			// Knowledge (plan 29): select a source to open its detail drawer (local screen navigation - the
			// counts stay live). Clicking the selected source again is harmless (re-selects the same id).
			case 'selectSource':
				this._state = { ...this._state, knSelectedSource: message.arg };
				this._render();
				break;
			// Add a source to a target document: a folder data file (arg) or an API URL (apiurl), bound to the
			// document chosen in the sheet (target). Loads the doc first so the frontmatter write path has its
			// text, then writes through the existing addSource; onDidChange re-projects the registry.
			case 'addSource':
				if (message.target && message.arg) { void this._addSource(message.target, message.arg); }
				break;
			case 'addSourceApi':
				if (message.target && message.apiurl) { void this._addSource(message.target, message.apiurl); }
				break;
			// Detach a source from one document (edits that document's frontmatter). The button carries a JSON
			// arg { doc, source, context } so the right list (sources vs context) is rewritten.
			case 'detachSource':
				if (message.arg) { void this._detachSource(message.arg); }
				break;
			case 'setFilter':
				this._state = { ...this._state, filter: (message.arg as AgentFilter) ?? 'all' };
				this._render();
				break;
			case 'openAgent':
				this._state = { ...this._state, openAgentId: message.arg, lastRun: undefined, skillRun: undefined };
				this._render();
				break;
			case 'closeAgent':
				this._state = { ...this._state, openAgentId: undefined, lastRun: undefined, skillRun: undefined };
				this._render();
				break;
			case 'runWf':
				if (message.arg) { void this._runAgent(message.arg); }
				break;
			// Agents detail-drawer registry edits (plan 32 iter 3): each writes through the service, which
			// persists to agents.json and fires onDidChange -> re-render. Create/duplicate open the new agent.
			case 'createAgent':
				void this._createAgent();
				break;
			case 'duplicateAgent':
				if (message.arg) { void this._duplicateAgent(message.arg); }
				break;
			case 'pauseAgent':
				if (message.arg) { void this._livingDocs.setAgentDisabled(message.arg, true); }
				break;
			case 'resumeAgent':
				if (message.arg) { void this._livingDocs.setAgentDisabled(message.arg, false); }
				break;
			case 'setAgentPolicy':
				if (message.arg && message.value) { void this._livingDocs.setAgentPolicy(message.arg, message.value as AgentPolicy); }
				break;
			case 'setAgentTrigger':
				if (message.arg && message.value) { void this._setAgentTrigger(message.arg, message.value); }
				break;
			// "Run skill across project" (the P3 gap): fan the skill grade over the folder and show the strip.
			case 'runSkillProject':
				if (message.arg) { void this._runSkillAcrossProject(message.arg); }
				break;
			case 'goReview':
				this._livingDocs.focusPanel('review');
				break;
			case 'goEditor':
			case 'present':
				void this._openFirstDocument();
				break;
			case 'goTemplates':
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'templates'), { pinned: true });
				break;
			// Agents entry point (D23-B): "Run across the project" opens the project-run screen live.
			// The whole-project chat fan-out that populates the swarm is kicked in 23.3 (TODO below);
			// opening the screen from Agents works live now, landing on the truthful idle state.
			case 'runProject':
				void this._openProjectRun();
				break;
			// Stop the in-flight whole-project fan-out (plan 27 iter 4): cancel the single model call anchored
			// on the run's anchor document. The finally of the underlying chat delivery flips isChatBusy off and
			// fires onDidChange -> re-render, so the swarm settles into truthful changed/skipped tiles.
			case 'stopProjectRun': {
				const anchor = this._state.projectRunAnchor;
				if (anchor) { this._livingDocs.cancelChat(anchor); }
				break;
			}
			// Project-run screen idle-state affordance: jump to the Agents screen (the run entry point).
			case 'goAgents':
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'agents'), { pinned: true });
				break;
			// Project-run bottom bar: "Review across the project" opens the cross-document review screen (C5,
			// plan 24) landing on the FIRST document that still has pending changes - this is where a
			// project-wide run (plan 23) lands. Closes the plan-23 interim Review-rail route (24.5).
			case 'reviewProject':
				void this._openReviewProject();
				break;
			// Cross-document review (C5): clicking a doc row in the 292px doc-nav rail makes it the current
			// document in the centre column. Local screen navigation (not an engine action), so it only
			// updates the selected id and re-renders; the pending set is still read live from the service.
			case 'reviewDoc':
				if (message.arg) {
					this._state = { ...this._state, reviewCurrentDocId: message.arg };
					this._render();
				}
				break;
			// Cross-document review per-change actions (24.2): every one drives the EXISTING engine. The
			// service fires onDidChange after each, which the setInput subscription re-renders - so the
			// centre cards, the doc-nav rail counts/glyphs AND the C6 Review rail all resync (shared model).
			case 'reviewAccept':
				if (message.arg) { void this._livingDocs.approve(message.arg); }
				break;
			case 'reviewReject':
				if (message.arg) { this._livingDocs.reject(message.arg); }
				break;
			// Tweak: open the change's document and focus its inline diff for hand-editing (reuse the plan-19
			// navigate-to-inline path). The card carries only the change id, so resolve its docId from the
			// live pending set, then open the doc + focusChange (never approves - navigate-only).
			case 'reviewTweak':
				if (message.arg) { void this._tweakChange(message.arg); }
				break;
			// Tweak in-card (plan 31 iter 3, D31-A): the reviewer hand-edited the proposed text, then Save &
			// Approve. Amend the pending change then approve through the one engine path (no parallel apply).
			case 'reviewTweakSave':
				if (message.arg && typeof message.text === 'string') {
					const id = message.arg;
					this._livingDocs.amendChange(id, message.text);
					void this._livingDocs.approve(id);
				}
				break;
			// Sticky doc action bar: `Accept All N Here` -> approveAll(docId) for the current document.
			case 'reviewAcceptAllHere':
				if (message.arg) {
					const docId = message.arg;
					void this._confirmBulkApprove(this._livingDocs.getAllPending().filter(c => c.docId === docId), () => this._livingDocs.approveAll(docId));
				}
				break;
			// `Next` -> advance the current document to the next one that still has pending changes.
			case 'reviewNext':
				if (message.arg) {
					const next = nextPendingDocId(this._livingDocs.getAllPending(), message.arg);
					if (next) {
						this._state = { ...this._state, reviewCurrentDocId: next };
						this._render();
					}
				}
				break;
			// Topbar `Accept All Remaining` -> approveAllPending() across every document.
			case 'reviewAcceptAllRemaining':
				void this._confirmBulkApprove(this._livingDocs.getAllPending(), () => this._livingDocs.approveAllPending());
				break;
			case 'openFolder':
				void this._livingDocs.openFolder();
				break;
			// New document on-ramp (plan 28, iter 4): the name-or-template sheet posts a name; a blank name
			// keeps decision 56's Untitled name-on-first-save escape hatch. The service handles both.
			case 'newDocument':
				void this._livingDocs.createDocument(message.name);
				break;
			// "From sources..." (F17, journey 1b's third birth): the picker sheet posts the checked source
			// files + the document name + an optional instruction. The document is drafted from them through
			// the review engine.
			case 'newFromSources':
				void this._generateFromSources(message.picks, message.name, message.note);
				break;
			// "New template from examples" (F18, journey 1x): the picker sheet posts the checked example
			// documents + the template name. The wizard validates the set and analyses them through review.
			case 'newTemplateFromExamples':
				void this._generateTemplateFromExamples(message.picks, message.name);
				break;
			case 'openDoc':
				if (message.arg) { void this._editors.openEditor({ resource: URI.parse(message.arg), options: { pinned: true } }); }
				break;
			// Templates screen (plan 28, iter 2): Edit opens the `.template.md` in the normal editor - it is
			// just Markdown, so it round-trips on disk with no new format.
			case 'editTemplate':
				if (message.arg) { void this._editors.openEditor({ resource: URI.parse(message.arg), options: { pinned: true } }); }
				break;
			// New Template: create an untitled.template.md seeded with a commented example and open it; the
			// service fires onDidChange so the card grid refreshes.
			case 'newTemplate':
				void this._livingDocs.createTemplate();
				break;
			// Use Template (primary, plan 28 iter 3): the D28-B generate sheet posts the template URI + the
			// document name + an optional note. Generation writes the skeleton and drives the review engine.
			case 'generateFromTemplate':
				if (message.arg) { void this._generateFromTemplate(message.arg, message.name, message.note); }
				break;
			// Home whole-project chat composer (F15 / journey 1w, map-D21/D24): a question is answered read-only
			// with citations in the composer; a change request opens the run/task surface.
			case 'askProject':
				if (message.text) { void this._askProject(message.text); }
				break;
			// The Tidy verb (doc 22 section 5): propose folder-convention moves through the review grammar. Build
			// the plan (model-free), toggle each move's approval, and apply the approved set through F16 (atomic
			// document+sidecar move, dependent re-point, Undo). Nothing moves before the explicit Apply.
			case 'tidyProject':
				void this._startTidy();
				break;
			case 'tidyApproveOne':
				this._setTidyDecision(message.arg, 'approved');
				break;
			case 'tidySkipOne':
				this._setTidyDecision(message.arg, 'skipped');
				break;
			case 'tidyApply':
				void this._applyTidy();
				break;
			case 'tidyCancel':
				this._tidyPlan = undefined;
				this._state = { ...this._state, tidyReview: undefined };
				this._render();
				break;
			// Home ALL PROJECTS: the current folder tile focuses its first document (it is already open).
			case 'openFirstDoc':
				void this._openFirstDocument();
				break;
			// Home ALL PROJECTS: re-open a recently-used folder as the workspace (D22-A).
			case 'openRecentFolder':
				if (message.arg) {
					void this._host.openWindow([{ folderUri: URI.parse(message.arg) }], { forceReuseWindow: true });
				}
				break;
			// Settings model access (plan 35 iter 4): begin "Sign in with ChatGPT" - open the authorize URL in
			// the browser and start polling for the loopback round-trip to complete.
			case 'signInChatGpt':
				void this._startChatGptSignIn();
				break;
			case 'signOutChatGpt':
				void this._signOutChatGpt();
				break;
			// Model access (plan 38): open the sign-in authorize URL OUTSIDE the sandboxed webview, in the
			// system browser, from a genuine anchor click - the reliable route that is never popup-blocked.
			case 'openExternalUrl':
				if (message.arg) { this._openInBrowser(message.arg); }
				break;
			// "Use the included model" (issue #170): genuinely select the included tier. The broker serves the
			// included/OpenRouter backend whenever the user is NOT signed in to ChatGPT, so choosing the included
			// model means signing out of ChatGPT (which forgets the token and drops calls to the included tier),
			// then re-reading the live door so the card reflects the real state. When already on the included tier
			// this simply re-reads status - the button is honest either way, never a no-op that pretends.
			case 'useIncludedModel':
				void this._useIncludedModel();
				break;
			// The onboarding survey Save: record the model_configured event locally and show the thank-you state.
			case 'submitSurvey':
				void this._submitSurvey(message.daily ?? '', message.subs ?? '', message.weekly ?? '');
				break;
			// The analytics consent row on the data-flow card (plan 36 / issue #134): flip the single source of
			// truth (the `abstract.analytics.enabled` setting). The consent contribution observes that change and
			// drives IAnalyticsService, so turning it off here stops capture entirely - no event is written.
			case 'setAnalyticsConsent':
				void this._setAnalyticsConsent(message.arg === 'on');
				break;
			// --- D26 onboarding surface: each action drives the EXISTING engine + records the funnel step ---
			// "See it work": generate the demo report from the bundled CSV (no folder, no setup), open it beside
			// the guide, and advance to wow one. Records `onboarding_step: demo report generated`.
			case 'onbSeeItWork':
				void this._onbSeeItWork();
				break;
			// "Open the Demo Report": re-focus the generated demo document beside the guide (later steps).
			case 'onbOpenDemo':
				void this._onbOpenDemo();
				break;
			// "Prompt one edit": send the one iteration through the real chat path -> a single inline diff in
			// Review (wow two). Records `first diff seen`, then advances to the approve step.
			case 'onbPromptEdit':
				void this._onbPromptEdit();
				break;
			// A "next" affordance on a step the user completes in the editor (peek / approve): record the current
			// step's funnel event and advance the card.
			case 'onbAdvance':
				this._onbAdvance();
				break;
			// Hand-off: record `first folder opened` (arms the T4 own-file aha) and open a real folder (1a).
			case 'onbOpenFolder':
				void this._onbOpenFolder();
				break;
			// Never dead-end on model access: jump to the Model Access screen (sign in / included / survey).
			case 'onbModelAccess':
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'settings'), { pinned: true });
				break;
			// Finish: clear the persisted walkthrough state and land on Home.
			case 'onbDone':
				this._storageService.remove(ONBOARDING_STEP_KEY, StorageScope.PROFILE);
				this._storageService.remove(ONBOARDING_DEMO_KEY, StorageScope.PROFILE);
				this._livingDocs.endOnboardingWalkthrough();
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'home'), { pinned: true });
				break;
			// Home "Continue your walkthrough": re-enter the onboarding surface at its persisted step.
			case 'openOnboarding':
				void this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'onboarding'), { pinned: true });
				break;
		}
	}

	// --- D26 onboarding drivers: each composes the golden paths (1e/1f/1h/1p), never new review machinery ---

	// Persist + set the current funnel step, then re-render the card.
	private _setOnboardingStep(step: OnboardingStep): void {
		this._storageService.store(ONBOARDING_STEP_KEY, step, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._state = { ...this._state, onboardingStep: step };
		this._render();
	}

	// "See it work": generate the demo report (bundled CSV -> real Living Document), open it in a side group so
	// the guide stays visible next to the document + Review rail, and advance to the provenance peek (wow one).
	// "See it work" runs the whole two-wow demo (doc 20 section D26). The calm shell cannot keep the onboarding
	// SCREEN webview mounted beside an editor, so this launches the demo document as the stage for BOTH wows:
	// it generates the demo, prompts the one iteration (so a single red/green proposal is already waiting in
	// Review - wow two), reveals Review, and opens the demo document. The user then peeks a bound figure (wow
	// one) and approves the proposal - the service records provenance-peek + first-approve-sample on those
	// natural actions and hands off to "bring a real folder" via a notification (see LivingDocsService).
	private async _onbSeeItWork(): Promise<void> {
		// The funnel entry: recorded here (consent is resolved by the time the user clicks) rather than on open,
		// so a first-run accept is not raced by the consent gate.
		this._livingDocs.recordOnboardingStep('open');
		this._setOnboardingStep('open');
		const uri = await this._livingDocs.generateDemoReport();
		if (!uri) { return; }
		this._storageService.store(ONBOARDING_DEMO_KEY, uri.toString(), StorageScope.PROFILE, StorageTarget.MACHINE);
		this._state = { ...this._state, onboardingDemoUri: uri };
		this._livingDocs.recordOnboardingStep('demo-report');
		this._setOnboardingStep('demo-report');
		// Prompt the one iteration through the real chat path so the model's reply lands as a single reviewable
		// inline diff (wow two); reveal Review and open the demo document where both wows live.
		this._livingDocs.recordOnboardingStep('first-diff');
		this._setOnboardingStep('first-diff');
		this._livingDocs.focusPanel('review');
		await this._editors.openEditor({ resource: uri, options: { pinned: true } });
		await this._livingDocs.sendChatMessage(uri, DEMO_ITERATION_PROMPT);
	}

	private async _onbOpenDemo(): Promise<void> {
		if (this._state.onboardingDemoUri) { await this._editors.openEditor({ resource: this._state.onboardingDemoUri, options: { pinned: true } }); }
	}

	// Prompt the one iteration on demand (revisited flow): reuse the same real chat path.
	private async _onbPromptEdit(): Promise<void> {
		const uri = this._state.onboardingDemoUri;
		if (!uri) { return; }
		this._livingDocs.recordOnboardingStep('first-diff');
		this._setOnboardingStep('first-approve-sample');
		await this._editors.openEditor({ resource: uri, options: { pinned: true } });
		this._livingDocs.focusPanel('review');
		await this._livingDocs.sendChatMessage(uri, DEMO_ITERATION_PROMPT);
	}

	// A step completed in the editor (peek seen / proposal approved): record it and step the card forward.
	private _onbAdvance(): void {
		const step = this._state.onboardingStep ?? 'open';
		this._livingDocs.recordOnboardingStep(step);
		const next = nextOnboardingStep(step);
		if (next) { this._setOnboardingStep(next); }
	}

	// Hand-off (doc 20 section D26 step 6): record `first folder opened` (which arms the T4 own-file aha in the
	// service) and open a real folder via the existing open-folder path (1a). The folder-open reloads the
	// workbench; the persisted step + the armed aha survive it.
	private async _onbOpenFolder(): Promise<void> {
		await this._livingDocs.openFolder(() => {
			this._livingDocs.recordOnboardingStep('first-folder');
			this._setOnboardingStep('first-approve-own');
		});
	}

	// Begin "Sign in with ChatGPT": ask the proxy for the authorize URL, open it in the browser, move to the
	// pending state, and poll the flow until it lands signed-in or errors. Each poll replaces the timer so a
	// re-open or completion never leaks one.
	private async _startChatGptSignIn(): Promise<void> {
		const authorizeUrl = await this._livingDocs.startChatGptSignIn();
		if (!authorizeUrl) {
			this._state = { ...this._state, signInStage: 'error', signInError: 'Could not start sign-in - is the model connected?' };
			this._render();
			return;
		}
		// Still attempt the automatic open, but never depend on it (a post-await window.open is popup-blocked,
		// especially in Incognito). The pending state renders a real clickable link + copyable URL so the user
		// can always reach the sign-in page with a genuine gesture; the poll settles the flow either way.
		this._openInBrowser(authorizeUrl);
		this._state = { ...this._state, signInStage: 'pending', signInError: undefined, signInAuthorizeUrl: authorizeUrl };
		this._render();
		this._pollSignIn();
	}

	// Poll the sign-in status once, then either settle (signed-in / error) or schedule the next poll. The
	// pending state shows the "waiting for your browser" spinner; a completed sign-in refreshes the door.
	private _pollSignIn(): void {
		this._signInPoll.value = disposableTimeout(async () => {
			const { stage, error } = await this._livingDocs.pollChatGptSignIn();
			if (stage === 'signed-in') {
				const status = await this._livingDocs.getModelProviderStatus();
				this._state = { ...this._state, signInStage: 'signed-in', signInError: undefined, signInAuthorizeUrl: undefined, providerStatus: status };
				this._render();
				return;
			}
			if (stage === 'error') {
				this._state = { ...this._state, signInStage: 'error', signInError: error ?? 'Sign-in did not complete - please try again.' };
				this._render();
				return;
			}
			// still pending (or the listener has not seen the callback yet): keep waiting.
			this._pollSignIn();
		}, 1200);
	}

	private async _signOutChatGpt(): Promise<void> {
		this._signInPoll.clear();
		await this._livingDocs.signOutChatGpt();
		const status = await this._livingDocs.getModelProviderStatus();
		this._state = { ...this._state, signInStage: 'signed-out', signInError: undefined, signInAuthorizeUrl: undefined, providerStatus: status };
		this._render();
	}

	// "Use the included model" (issue #170): genuinely select the included tier rather than only re-reading
	// status. The broker serves the included/OpenRouter backend whenever the user is not signed in to ChatGPT,
	// so selecting the included model means signing out of ChatGPT (if signed in), then re-reading the live door.
	// When already on the included tier this is just a status refresh, so the card always reflects real state.
	private async _useIncludedModel(): Promise<void> {
		const status = await this._livingDocs.getModelProviderStatus();
		if (status.signedIn) {
			await this._signOutChatGpt();
			return;
		}
		await this._refreshSettings();
	}

	private async _submitSurvey(daily: string, subs: string, weekly: string): Promise<void> {
		await this._livingDocs.submitOnboardingSurvey({ dailyDriverModel: daily, ownedSubscriptions: subs, weeklyOutput: weekly });
		this._state = { ...this._state, surveySaved: true };
		this._render();
	}

	// Persist the analytics consent choice to the `abstract.analytics.enabled` setting (the one source of truth
	// the consent contribution mirrors into IAnalyticsService). Optimistically reflect it, then re-read so the
	// row always shows the real stored value.
	private async _setAnalyticsConsent(enabled: boolean): Promise<void> {
		this._state = { ...this._state, analyticsEnabled: enabled };
		this._render();
		await this._configuration.updateValue('abstract.analytics.enabled', enabled);
		this._state = { ...this._state, analyticsEnabled: this._analyticsEnabled() };
		this._render();
	}

	// Open the authorize URL in the user's default browser. It must open OUTSIDE the webview (the OpenAI sign-in
	// page + the localhost:1455 loopback callback both need the real browser), so route through the opener
	// service (which opens an external http(s) URL in the system browser). `openExternal: true` skips the opener's
	// own scheme filtering, and one call site forwards a URL that originated in a webview message, so gate the
	// scheme here: only ever hand http(s) URLs to the OS opener, and ignore anything malformed or otherwise-schemed.
	private _openInBrowser(url: string): void {
		let uri: URI;
		try {
			uri = URI.parse(url, true);
		} catch {
			return;
		}
		if (!matchesSomeScheme(uri, Schemas.http, Schemas.https)) {
			return;
		}
		void this._openerService.open(uri, { openExternal: true });
	}

	// Bind a source to a target document (plan 29 iter 2). The document may not be loaded (the Knowledge
	// screen is project-level), so load it first - `addSource` rewrites the frontmatter through `getRawText`,
	// which needs the loaded state - then write. The service fires onDidChange, which re-projects the registry.
	private async _addSource(docUri: string, source: string): Promise<void> {
		const uri = URI.parse(docUri);
		await this._livingDocs.loadDocument(uri);
		await this._livingDocs.addSource(uri, source);
	}

	// Detach a source from one document (plan 29 iter 2): the button's JSON arg says which document, which
	// source, and whether it is a context reference (so the right frontmatter list is rewritten). Any bind
	// links that referenced a removed value source flag as unresolved in the editor (the stale-binding path).
	private async _detachSource(arg: string): Promise<void> {
		let parsed: { doc?: string; source?: string; context?: boolean };
		try {
			parsed = JSON.parse(arg);
		} catch {
			return;
		}
		if (!parsed.doc || !parsed.source) { return; }
		const uri = URI.parse(parsed.doc);
		await this._livingDocs.loadDocument(uri);
		if (parsed.context) {
			await this._livingDocs.removeContextFile(uri, parsed.source);
		} else {
			await this._livingDocs.removeSource(uri, parsed.source);
		}
	}

	// "Run now": execute the agent end-to-end, show its run on the canvas, and reveal the review rail
	// when it queued anything for approval.
	private async _runAgent(agentId: string): Promise<void> {
		const run = await this._livingDocs.runAgent(agentId);
		this._state = { ...this._state, lastRun: run };
		this._render();
		if (run && run.queued > 0) { this._livingDocs.focusPanel('review'); }
	}

	// Create a new agent (plan 32 iter 3) and land on its detail drawer so the user can edit it inline.
	private async _createAgent(): Promise<void> {
		const before = new Set(this._livingDocs.getAgents().map(a => a.id));
		await this._livingDocs.createAgent();
		const created = this._livingDocs.getAgents().find(a => !before.has(a.id));
		this._state = { ...this._state, openAgentId: created?.id ?? this._state.openAgentId, lastRun: undefined, skillRun: undefined };
		this._render();
	}

	// Duplicate an agent and open the copy's drawer.
	private async _duplicateAgent(agentId: string): Promise<void> {
		const before = new Set(this._livingDocs.getAgents().map(a => a.id));
		await this._livingDocs.duplicateAgent(agentId);
		const copy = this._livingDocs.getAgents().find(a => !before.has(a.id));
		this._state = { ...this._state, openAgentId: copy?.id ?? this._state.openAgentId, lastRun: undefined, skillRun: undefined };
		this._render();
	}

	// Compose an IAgentTrigger from the drawer's picker fields (the client posts a JSON value) and persist it.
	// The cron day + time compose to "Mon 09:00"; heartbeat to everyHours; event to a source path ('*' = any).
	private async _setAgentTrigger(agentId: string, value: string): Promise<void> {
		let f: { kind?: string; day?: string; time?: string; hours?: string; source?: string };
		try { f = JSON.parse(value); } catch { return; }
		let trigger: IAgentTrigger;
		if (f.kind === 'cron') {
			const time = /^\d{2}:\d{2}$/.test(f.time ?? '') ? f.time! : '09:00';
			trigger = { kind: 'cron', cron: `${f.day || 'Mon'} ${time}` };
		} else if (f.kind === 'heartbeat') {
			const hours = Math.max(1, Math.round(Number(f.hours) || 6));
			trigger = { kind: 'heartbeat', everyHours: hours };
		} else if (f.kind === 'event') {
			trigger = { kind: 'event', source: (f.source || '*').trim() || '*' };
		} else {
			trigger = { kind: 'manual' };
		}
		await this._livingDocs.setAgentTrigger(agentId, trigger);
	}

	// Fan a Skill grade across every project document (plan 32 iter 3, the P3 gap) and render the run strip.
	private async _runSkillAcrossProject(id: string): Promise<void> {
		const names: Record<string, string> = { financial: 'Financial agent', strategy: 'Strategy agent', formatting: 'Formatting agent' };
		const skillId = id as ISkillCheck['id'];
		const summary = await this._livingDocs.runSkillAcrossProject(skillId, names[id] ?? id);
		this._state = { ...this._state, skillRun: summary };
		this._render();
	}

	// D23-B entry point: open the project-run screen (C4) via the SAME open-screen path every other
	// Abstract screen uses (a singleton ScreenEditorInput opened through the editor service). Iter 2
	// lands on the truthful idle state; the whole-project chat fan-out that fills the swarm is 23.3.
	private async _openProjectRun(instruction?: string, source?: string): Promise<void> {
		// Open the screen first (idle) so the user lands immediately, then kick the run and let the
		// onDidChange listener re-render the live swarm as the fan-out proceeds and settles.
		await this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'project-run'), { pinned: true });
		await this._kickProjectRun(instruction, source);
	}

	// Kick the whole-project chat fan-out (D23-A/#77): the whole-project run IS the chat working-set path.
	// Pick an anchor document, load it (sendChatMessage requires a loaded anchor state), add every folder
	// document to that anchor's working set, then send ONE instruction so `_chatRespondMulti` fans it out
	// across the project in a single model call. The run is in flight while `isChatBusy(anchor)` is true;
	// the finally block of `sendChatMessage` fires onDidChange, which re-renders and settles the swarm.
	private async _kickProjectRun(instruction?: string, source?: string): Promise<void> {
		const docs = await this._livingDocs.listDocuments();
		if (docs.length === 0) { return; }
		const runInstruction = instruction ?? 'Extract the decisions from the 3 March security review and apply the required changes across every affected policy.';
		// The anchor is any project document (the chat key + working-set owner); the first one is fine. Load
		// it first so its folder files are scanned - `getMentionableFiles` needs the loaded state (so the
		// transcript source is resolvable) and `sendChatMessage` requires a loaded anchor to fan out.
		const anchor = docs[0].resource;
		await this._livingDocs.loadDocument(anchor);
		await this._livingDocs.addFolderToWorkingSet(anchor);
		// Default to the real security-review transcript source when the caller named none (the Agents
		// "Run across the project" action passes none today). Resolved against the loaded anchor's
		// mentionable folder files - never fabricated: undefined when the project ships no such source.
		const mentionable = new Set(this._livingDocs.getMentionableFiles(anchor));
		const runSource = source ?? [...mentionable].find(f => /review/i.test(f) && /\.txt$/i.test(f));
		// Reference the transcript by @mention so the fan-out reads it as a shared source (only when the
		// source is a real mentionable folder file - never invent a mention the model cannot resolve).
		const sent = runSource && mentionable.has(runSource) ? `${runInstruction} @${runSource}` : runInstruction;
		this._state = {
			...this._state,
			projectRunAnchor: anchor,
			projectRunDocs: docs.map(d => ({ docId: d.resource.toString(), docTitle: d.title })),
			projectRun: { instruction: runInstruction, source: runSource, inFlight: true },
		};
		this._render();
		// Fire-and-await the fan-out; the finally block flips isChatBusy off and fires onDidChange -> re-render.
		await this._livingDocs.sendChatMessage(anchor, sent);
	}

	// Plan-24 entry (24.5): open the cross-document review screen (C5) landing on the FIRST document that
	// still has pending changes. The first changed doc is `groupPendingByDoc(getAllPending())[0]` - the same
	// live model + grouping the screen renders. We seed `reviewCurrentDocId` so the centre column opens on
	// that doc, and carry the run's source label into `reviewSource` so the review topbar context is
	// populated. Set the selection state BEFORE opening so the very first render lands on the right doc.
	private async _openReviewProject(): Promise<void> {
		const groups = groupPendingByDoc(this._livingDocs.getAllPending());
		const firstChangedDocId = groups.length > 0 ? groups[0].docId : undefined;
		const runSource = this._state.projectRun?.source;
		this._state = {
			...this._state,
			reviewCurrentDocId: firstChangedDocId ?? this._state.reviewCurrentDocId,
			reviewSource: runSource ?? this._state.reviewSource,
		};
		await this._editors.openEditor(this._instantiation.createInstance(ScreenEditorInput, 'review-project'), { pinned: true });
	}

	// Tweak a change (24.2): open its document and focus its inline diff for hand-editing, reusing the
	// plan-19 navigate-to-inline path (openEditor + focusChange). Resolves the docId from the live pending
	// set by change id. Navigate-only - it never approves; the user then edits/approves in the document.
	// Bulk-approve safety net (plan 31 iter 4): confirm before a bulk approve whose set includes any meaning
	// change; the confirm mentions the pre-approve snapshot (plan 26). Figures-only bulk approves stay
	// one-click. Applies only after the user confirms (or when no confirm was needed).
	private async _confirmBulkApprove(changes: readonly { readonly kind: 'figure' | 'meaning' }[], apply: () => Promise<void>): Promise<void> {
		const confirm = bulkApproveConfirm(changes, true);
		if (confirm.needed) {
			const { confirmed } = await this._dialogService.confirm({ message: confirm.message, primaryButton: 'Approve all' });
			if (!confirmed) { return; }
		}
		await apply();
	}

	private async _tweakChange(changeId: string): Promise<void> {
		const change = this._livingDocs.getAllPending().find(c => c.id === changeId);
		if (!change) { return; }
		await this._editors.openEditor({ resource: URI.parse(change.docId), options: { pinned: true } });
		this._livingDocs.focusChange(change.id);
	}

	// Generate a draft from a template (plan 28, iter 3): the service writes the skeleton, opens the new
	// document, and drives the chat path so the prose lands as insertion proposals. Reveal the review rail
	// so the pending draft is where the user expects it (the same rail every generation lands in).
	private async _generateFromTemplate(templateUri: string, name?: string, note?: string): Promise<void> {
		const target = await this._livingDocs.generateFromTemplate(URI.parse(templateUri), name ?? '', note ?? '');
		if (target) { this._livingDocs.focusPanel('review'); }
	}

	// Draft a document from selected sources (F17): the sheet posts the checked source files as a JSON array.
	// The service writes the skeleton, opens the new document and drives the chat path so the draft lands as
	// reviewable proposals. Reveal the review rail so the pending draft is where the user expects it.
	private async _generateFromSources(picks?: string, name?: string, note?: string): Promise<void> {
		const sources = this._parsePicks(picks);
		if (!sources.length) { return; }
		const target = await this._livingDocs.generateFromSources(sources, name ?? '', note ?? '');
		if (target) { this._livingDocs.focusPanel('review'); }
	}

	// Grow a template from examples (F18): the sheet posts the checked example documents as a JSON array. The
	// service validates the set (refusing <3 or >10 with a plain-words notice), writes the template skeleton
	// (which joins the + New picker at once) and drives the chat path so the analysis lands as reviewable
	// proposals. Reveal the review rail so the named commonalities are where the user expects them.
	private async _generateTemplateFromExamples(picks?: string, name?: string): Promise<void> {
		const examples = this._parsePicks(picks);
		const target = await this._livingDocs.generateTemplateFromExamples(examples, name ?? '');
		if (target) { this._livingDocs.focusPanel('review'); }
	}

	// Parse a sheet's checked-picks JSON array (the client posts a JSON string of the checked values), never
	// throwing on a malformed payload - an unparseable or non-array value yields an empty selection.
	private _parsePicks(picks?: string): string[] {
		if (!picks) { return []; }
		try {
			const parsed = JSON.parse(picks);
			return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
		} catch {
			return [];
		}
	}

	// Templates "Export" lands the user on a real document, where the Present/export modal lives.
	private async _openFirstDocument(): Promise<void> {
		const docs = await this._livingDocs.listDocuments();
		const living = docs.find(d => d.isLiving) ?? docs[0];
		if (living) {
			await this._editors.openEditor({ resource: living.resource, options: { pinned: true } });
		}
	}

	private _render(): void {
		// Inject the live agent registry + the open-folder state at render time so Home/Agents reflect current state.
		// (plan 33 iter 2, L5) Use the truthful DISPLAY name (resolves the web/memfs "mount" stub via the
		// sample's `.abstract-name` marker) for every user-facing project label - Home, the crumb and tiles.
		const folderName = this._livingDocs.getProjectDisplayName();
		this._webview?.setHtml(renderScreenHtml(this._screen, {
			...this._state,
			projectRun: this._projectRunState(),
			reviewProject: this._updateAndGetReviewProjectState(folderName),
			agents: this._livingDocs.getAgents(),
			// The open agent's run log, read live so a run that just completed shows without reopening the drawer.
			openAgentRuns: this._state.openAgentId ? this._livingDocs.getAgentRunsForAgent(this._state.openAgentId) : undefined,
			hasFolder: !!folderName,
			folderName,
			onboarding: this._screen === 'onboarding' ? {
				step: this._state.onboardingStep ?? 'open',
				// Consent is already gated by the consent moment; reflect it (not a second consent surface).
				consentEnabled: this._analytics.isEnabled,
				consentChosen: this._analytics.hasChosen,
				hasModel: this._state.onboardingHasModel ?? false,
				demoGenerated: !!this._state.onboardingDemoUri,
			} : undefined,
			onboardingResumeStep: this._state.onboardingResumeStep,
		}));
	}

	// Recompute the cross-document review screen state (C5, plan 24) from the LIVE service each render: the
	// pending set is `getAllPending()` (the SAME model the C6 rail consumes - this is a second presentation,
	// not a re-derivation), grouped by document in the renderer for the rail + cards. Only the current-doc
	// selection + the reviewed-this-session set are local state; the counts + confidence are all live/real.
	// Named "updateAndGet": besides returning the state it also folds the currently-pending docs into the
	// carried `reviewSeenDocs` map (so an emptied doc keeps its reviewed row) - a deliberate per-render update.
	private _updateAndGetReviewProjectState(folderName: string | undefined): IReviewProjectScreenState | undefined {
		if (this._screen !== 'review-project') { return undefined; }
		const pending = this._livingDocs.getAllPending();
		// Accumulate the docs seen with pending changes this session (docId -> human title). A doc that was
		// seen and now has zero pending is "reviewed" - `reviewedDocsFromSeen` derives that with the human
		// title carried here, so the reviewed rail row is legible (not the raw docId URI). The seen map is
		// carried across renders so a doc that emptied keeps its reviewed row.
		const seen = new Map(this._state.reviewSeenDocs ?? []);
		for (const c of pending) { seen.set(c.docId, c.docTitle); }
		this._state = { ...this._state, reviewSeenDocs: seen };
		const pendingDocIds = new Set(pending.map(c => c.docId));
		return {
			pending,
			currentDocId: this._state.reviewCurrentDocId,
			reviewedDocs: reviewedDocsFromSeen(seen, pendingDocIds),
			source: this._state.reviewSource,
			folderName,
		};
	}

	// Recompute the project-run screen state from the LIVE service each render, so the swarm grid, the
	// progress bar and the bottom-bar totals track the fan-out as it runs and settles. The tiles + totals
	// come from the pure `summariseProjectRun(projectDocs, getAllPending())` selector; the `working`
	// overlay is every project document while `isChatBusy(anchor)` is true (the whole-project fan-out is a
	// single model call, so the whole swarm is in flight together), and empty once the run settles.
	private _projectRunState(): IProjectRunScreenState | undefined {
		const run = this._state.projectRun;
		if (!run) { return undefined; }
		const anchor = this._state.projectRunAnchor;
		const inFlight = !!anchor && this._livingDocs.isChatBusy(anchor);
		const docs = this._state.projectRunDocs ?? [];
		const pending = this._livingDocs.getAllPending();
		// A settled run was STOPPED (plan 27 iter 4) when the anchor's last chat turn is a "stopped" salvage
		// (the whole-project fan-out is that anchor's chat call). When stopped, docs with no change are honestly
		// skipped, not no-change. Never treat an in-flight run as stopped.
		const chat = anchor ? this._livingDocs.getChatMessages(anchor) : [];
		const stopped = !inFlight && chat.length > 0 && !!chat[chat.length - 1].stopped;
		// A settled run PAUSED on the spent daily budget (map-D15; F14 item 3) when the anchor's last turn is a
		// "paused" cap turn. A paused run's not-yet-run documents are honestly skipped (they never ran) - like a
		// stop, but the heading reads the calm plain-words pause, never a failure and never an all-clear.
		const paused = !inFlight && chat.length > 0 && !!chat[chat.length - 1].paused;
		// Fan-out batch progress (plan 30, track 3, D30-B): which batch of how many is running and which docs
		// were too large for the budget. Oversize docs are flagged on their tiles (never sent, never dropped),
		// and are excluded from the live "working" overlay so an oversize tile reads "too large", not spinning.
		const fanout = anchor ? this._livingDocs.getFanoutProgress(anchor) : undefined;
		const oversizeIds = fanout?.oversizeDocIds ?? [];
		// Documents the model could not be reached for (F14, issue #123): their tile reads a named "model
		// unreachable" state, never a silent "no change", and they are excluded from the live working overlay
		// (they failed, they are not still spinning).
		const failedIds = fanout?.failedDocIds ?? [];
		const failedOrOversize = new Set([...oversizeIds, ...failedIds]);
		const summary = summariseProjectRun(docs, pending, stopped || paused, oversizeIds, failedIds);
		const working = inFlight ? docs.map(d => d.docId).filter(id => !failedOrOversize.has(id)) : [];
		// Decisions column (23.4): group the LIVE pending changes by their source grounding. Restrict to
		// changes for documents in this run's tile set so a stale change from another surface never leaks
		// into the run's decisions (mirrors summariseProjectRun's tile-set restriction).
		const runDocIds = new Set(docs.map(d => d.docId));
		const decisions = groupDecisions(pending.filter(c => runDocIds.has(c.docId)));
		const batch = fanout ? { index: fanout.batchIndex, count: fanout.batchCount } : undefined;
		return { ...run, inFlight, stopped, paused, summary, working, decisions, batch };
	}

	layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
