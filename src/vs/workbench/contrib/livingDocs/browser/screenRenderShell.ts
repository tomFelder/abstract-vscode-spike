/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The shared surface for the "main-area" Abstract screens (Home, Templates, Knowledge, Agents and the
// misc surfaces): the webview page/head/script scaffolding, the escape/format helpers, the shared
// card/pill/sheet builders, and `renderScreenHtml` -- the dispatcher that routes a ScreenId to its
// per-screen module. Each screen lives in its own `screenRender<Name>.ts` module (Home, Templates,
// Knowledge, Agents, Misc) so parallel work lanes never collide in one file; the pieces used by more than
// one screen live here. The brand/crumb top bar the screens used to draw is gone (plan 44-b): the one
// global Abstract header (the repurposed title bar) carries it. These are our own surfaces (no core
// patch): the HTML is ported from the locked design comp, with the comp's non-ASCII glyphs written as
// HTML entities to satisfy the source-hygiene rule.

import { IAgentDef, IAgentRun, IDecisionGroup, IProjectRunSummary, IProposedChange, IReviewedDoc, ISkillRunSummary } from '../common/livingDocsModel.js';
import { ChatGptSignInStage, ILivingDocSummary, IModelProviderStatus, IProjectAnswer, ISourceInfo, ITemplateInfo } from '../common/livingDocs.js';
import { IAwayFeed } from '../common/projectHomeFeed.js';
import { OnboardingStep } from '../common/onboarding.js';
import { renderHome } from './screenRenderHome.js';
import { renderTemplates } from './screenRenderTemplates.js';
import { renderKnowledge } from './screenRenderKnowledge.js';
import { renderAgents } from './screenRenderAgents.js';
import { renderSettings, renderOnboarding, renderProjectRun, renderReviewProject } from './screenRenderMisc.js';

export type ScreenId = 'home' | 'templates' | 'knowledge' | 'agents' | 'project-run' | 'review-project' | 'settings' | 'onboarding';

export type AgentFilter = 'all' | 'scheduled' | 'event' | 'needs-approval';

/** One entry in the ALL PROJECTS grid for recently-opened folders (no counts - not yet loaded). */
export interface IRecentProject {
	/** Basename of the folder, used as the project name. */
	readonly name: string;
	/** Stringified URI used as the `openFolder` arg so the host can re-open it. */
	readonly folderUri: string;
}

/**
 * One reviewable row in the Tidy surface (doc 22 section 5): a proposed move rendered from the plan, with
 * its plain-words reason, the documents that depend on the moved file (re-pointed on apply, warned like a
 * map-D6 delete), and the human's decision so far. The host holds the full plan (with URIs); this is the
 * serialisable projection the webview renders.
 */
export interface ITidyReviewItem {
	readonly fromLabel: string;
	readonly toLabel: string;
	readonly reason: string;
	/** Titles of documents that reference the moved file (empty for a move with no dependents). */
	readonly dependents: readonly string[];
	/** The per-move decision: approved rows are applied on Apply; skipped rows are left in place. */
	readonly decision: 'approved' | 'skipped';
}

/** The Tidy review surface state (doc 22 section 5): the proposed moves, or the applied summary once done. */
export interface ITidyReviewState {
	readonly items: readonly ITidyReviewItem[];
	/** Once Apply has run, how many moves were applied - drives the calm "done, Undo is in the toast" state. */
	readonly applied?: number;
}

/** The Home attention line for a failed scheduled run (plan 32 iter 2). Real data only - built from a run. */
export interface IHomeFailure {
	/** The agent's human name, e.g. "Weekly refresh". */
	readonly agentName: string;
	/** The weekday the run failed on, e.g. "Monday" (from the run's finished/started timestamp). */
	readonly day: string;
	/** The failure string the runner reported (shown on hover / in the details link title). */
	readonly error: string;
}

export interface IScreenState {
	/** Knowledge: which scope tab is selected (`project` = the real source registry; `org` = the honest "Soon"). */
	readonly knScope: 'org' | 'project';
	/** Knowledge: the project's real source registry (plan 29, D29-A), driving the SOURCES table + drawer. */
	readonly sources?: readonly ISourceInfo[];
	/** Knowledge: the source id whose detail drawer is open (the dependency fan-in), or none. */
	readonly knSelectedSource?: string;
	/** Knowledge: the project's data files (csv/json) offered by the Add-source picker, and the docs to bind to. */
	readonly dataFiles?: readonly string[];
	/**
	 * Home + Templates: the project's document files (md/txt at the root) - the knowledge half of the
	 * "From sources..." birth picker (F17) and the example set for the from-examples template wizard (F18).
	 */
	readonly docFiles?: readonly string[];
	/** Agents: the live registry (drives the table + canvas). */
	readonly agents: readonly IAgentDef[];
	/** Agents: the agent whose workflow canvas is open (vs the list). */
	readonly openAgentId?: string;
	/** Agents: the active table filter chip. */
	readonly filter: AgentFilter;
	/** Agents: the result of the most recent Run now, for the canvas banner. */
	readonly lastRun?: IAgentRun;
	/**
	 * Agents: the open agent's run log (plan 32 iter 3), newest-first, for the detail drawer's run-log panel
	 * (relative time, via, outcome counts, the "N queued" review link, failure/skip lines). Real data only -
	 * from `getAgentRunsForAgent`; empty until the agent has run.
	 */
	readonly openAgentRuns?: readonly IAgentRun[];
	/**
	 * Agents: the result of the most recent "Run skill across project" (plan 32 iter 3, the P3 gap): every
	 * folder document's grade for one skill, rendered as a run strip. Absent until a cross-project skill run
	 * has happened. Real data only - the per-document flag/pass/skip is the grader's true verdict.
	 */
	readonly skillRun?: ISkillRunSummary;
	/**
	 * Home: the latest agent run that failed, for the quiet attention line above the project grid (plan 32
	 * iter 2). Absent when nothing failed - truthful automation, no fake activity. Carries the agent's human
	 * name and the failure day so the copy reads "Weekly refresh failed on Monday - view details".
	 */
	readonly homeFailure?: IHomeFailure;
	/**
	 * Home: the WHILE YOU WERE AWAY feed (F15 / journey 1w) - agent runs since the last visit + the live
	 * needs-you count + the all-clear state. Absent renders no feed section (the pre-fetch idle). Real data
	 * only: the rows come from the persisted run log, and the all-clear tracks the true pending set.
	 */
	readonly awayFeed?: IAwayFeed;
	/**
	 * Home: the answer to the last read-only whole-project question asked in the composer (map-D24). Absent
	 * until a question has been answered; carries the plain-words answer + the real citations to render.
	 */
	readonly projectAnswer?: IProjectAnswer;
	/** Home: true while a whole-project question is being answered (the composer's honest working state). */
	readonly askBusy?: boolean;
	/**
	 * Home: the Tidy verb's review surface (doc 22 section 5). Absent until "Tidy this project" is invoked;
	 * carries the proposed moves as individually approve/reject-able rows. Nothing moves until Apply. Real
	 * data only: the moves are the deterministic plan, and an empty `items` list renders the honest
	 * "nothing to tidy" state rather than a fabricated row.
	 */
	readonly tidyReview?: ITidyReviewState;
	/** Home: whether a workspace folder (the "project") is open. */
	readonly hasFolder?: boolean;
	/** Home: the open folder's name, shown as the project. */
	readonly folderName?: string;
	/** Home: the documents discovered in the open folder (all Markdown, living flagged for the badge). */
	readonly docs?: readonly ILivingDocSummary[];
	/** Templates: the `*.template.md` files discovered in the open folder (plan 28), driving the card grid. */
	readonly templates?: readonly ITemplateInfo[];
	/**
	 * Home: recently-opened folders from the workbench history (D22-A). Each is shown as an
	 * additional tile in ALL PROJECTS with name + avatar only - counts are deferred until a
	 * folder is opened (real-data guardrail: never fabricate counts for unloaded projects).
	 */
	readonly recentFolders?: readonly IRecentProject[];
	/**
	 * Project-run (C4): the state of the live/last whole-project fan-out, or undefined when no
	 * run has started (the truthful idle state). Iter 2 populates only `instruction`/`source` from
	 * the real run when one is kicked; the swarm grid + decisions column (23.3/23.4) layer on later.
	 */
	readonly projectRun?: IProjectRunScreenState;
	/**
	 * Cross-document review (C5, plan 24): the project-scale second presentation of the SAME review model
	 * the C6 rail consumes. Absent on non-review screens. Carries the live pending set + the local
	 * navigation state (current doc + which docs were reviewed this session). Iter 1/2 is read-only.
	 */
	readonly reviewProject?: IReviewProjectScreenState;
	/** Settings (plan 35 iter 4): the live model door + usage snapshot driving the provider step. */
	readonly providerStatus?: IModelProviderStatus;
	/** Settings: the "Sign in with ChatGPT" flow stage (drives the primary button + waiting/error copy). */
	readonly signInStage?: ChatGptSignInStage;
	/** Settings: a plain-words sign-in error to show under the button, if the last attempt failed. */
	readonly signInError?: string;
	/**
	 * Settings: the OpenAI authorize URL for the in-flight sign-in, surfaced in the pending state as a real
	 * clickable link (a genuine user gesture that the browser will not popup-block) plus a copyable fallback.
	 */
	readonly signInAuthorizeUrl?: string;
	/** Settings: true once the onboarding survey has been recorded this session (shows the thank-you state). */
	readonly surveySaved?: boolean;
	/** Settings: the current analytics consent (the `abstract.analytics.enabled` setting), for the data-flow card row. */
	readonly analyticsEnabled?: boolean;
	/** Onboarding (D26): the guided two-wow flow's current step + the reused-machinery status it reflects. */
	readonly onboarding?: IOnboardingScreenState;
	/** Home (D26): the persisted in-progress onboarding step, drives the "Continue your walkthrough" banner. */
	readonly onboardingResumeStep?: OnboardingStep;
	/**
	 * Home (plan 42 L1): true once the user has dismissed the "See a 90-second demo" card. The card is the
	 * demoted walkthrough entry point -- reachable but never a gate -- so once dismissed it stays hidden.
	 */
	readonly demoCardDismissed?: boolean;
}

/**
 * The D26 onboarding surface state (doc 20 section D26). The screen walks the T5 funnel; `step` is where the
 * user is now. The rest is status read from the machinery this surface REUSES rather than rebuilds: the
 * analytics consent (already gated by the consent moment), whether a model door is reachable (so the flow
 * never dead-ends on model access), and whether the demo report has been generated yet.
 */
export interface IOnboardingScreenState {
	readonly step: OnboardingStep;
	/** Analytics consent (true = the user allowed capture at the consent moment). Drives the consent card copy. */
	readonly consentEnabled: boolean;
	/** True once the user has answered the consent moment either way (they always have by the time this shows). */
	readonly consentChosen: boolean;
	/** True when a model door (ChatGPT / included / canned proxy) is reachable, so the prompted edit will land. */
	readonly hasModel: boolean;
	/** True once "See it work" has generated the demo report (so later steps can re-open it, not re-generate). */
	readonly demoGenerated: boolean;
}

/**
 * The cross-document review screen's state (plan 24, C5). `pending` is the live `getAllPending()` set,
 * grouped by document in the renderer for the doc-nav rail and the centre change cards. `currentDocId`
 * is the doc shown in the centre column (local screen navigation, not an engine action - defaults to the
 * first changed doc). `reviewedDocs` are the documents that had changes THIS session and now have zero
 * pending (the check "reviewed" glyph); tracked by the editor across re-renders. `source` labels the run's
 * attached transcript for the topbar chip. Nothing is fabricated - all counts derive from `pending`.
 */
export interface IReviewProjectScreenState {
	readonly pending: readonly IProposedChange[];
	readonly currentDocId?: string;
	/**
	 * Documents reviewed THIS session (seen with pending changes, now zero). Each carries the HUMAN title
	 * (not the raw docId URI) so the reviewed rail row is legible; derived by the editor via
	 * `reviewedDocsFromSeen`.
	 */
	readonly reviewedDocs?: readonly IReviewedDoc[];
	readonly source?: string;
	/** The project's folder name, for the topbar crumb + avatar. */
	readonly folderName?: string;
}

/**
 * The project-run screen's live state (plan 23, C4). Absent = no run in progress => the truthful
 * idle body. When present it carries the REAL instruction + attached source of the run so the
 * command strip reflects the actual fan-out (never the illustrative ISMS numbers from the comp).
 */
export interface IProjectRunScreenState {
	/** The user's whole-project instruction, rendered in reading type in the command strip. */
	readonly instruction: string;
	/** The attached source chip label (e.g. `Security Review - 3 Mar.txt`), if a source was named. */
	readonly source?: string;
	/** True while the fan-out is still in flight (isChatBusy) - drives the "Live" pill + tile spinners. */
	readonly inFlight?: boolean;
	/**
	 * True when the run was stopped mid-flight (plan 27 iter 4): the swarm's not-yet-changed tiles render
	 * as honest `skipped` (never `no change`), and the topbar shows a calm "Stopped" state instead of "Live".
	 */
	readonly stopped?: boolean;
	/**
	 * True when the run paused mid-flight on the spent daily budget (map-D15; F14 item 3): the swarm's
	 * not-yet-run tiles render as honest `skipped` (they never ran) and the heading reads the calm plain-words
	 * pause - finished proposals stay reviewable, and the run renders as neither a failure nor an all-clear.
	 */
	readonly paused?: boolean;
	/**
	 * The whole-project fan-out summary derived from `summariseProjectRun(listDocuments, getAllPending())`
	 * (plan 23, C4): one tile per project document + the real bottom-bar totals. Absent until the run's
	 * document set has been fetched. The `working` (spinner) tile state is a live overlay the renderer
	 * applies while `inFlight` is true - the selector itself only distinguishes changed / no-change.
	 */
	readonly summary?: IProjectRunSummary;
	/**
	 * Documents still being processed by the in-flight fan-out (their tiles render the spinner +
	 * `reviewing…`). While the run is live and nothing has settled yet, every no-change tile is treated
	 * as `working` so the grid reads as a busy swarm; once a doc settles (a change lands or the run
	 * finishes) it drops out of this set. Empty once the run settles.
	 */
	readonly working?: readonly string[];
	/**
	 * The decisions the agent understood (C4 left column, plan 23.4): the pending changes grouped by
	 * their source grounding via `groupDecisions(getAllPending())`. Each group carries the verbatim
	 * decision quote, its source line where known, and the count of distinct documents it affects.
	 * The attached source name (`source`) labels the transcript chip on each card. Absent/empty until a
	 * run has produced grounded changes; when the model omitted grounding the groups degrade to a
	 * rationale grouping (`grounded:false`) and the card omits the line chip.
	 */
	readonly decisions?: readonly IDecisionGroup[];
	/**
	 * The fan-out's batch progress (plan 30, track 3, D30-B): the whole-project run packs the working set
	 * into `count` context-bounded batches; `index` is the 1-based batch currently running (0 when no batch
	 * is live). The command strip shows a `batch K of M` chip while a run spans more than one batch. Absent
	 * when the run fit in a single batch (the common small-scale case), so nothing extra is shown then.
	 */
	readonly batch?: { readonly index: number; readonly count: number };
}

export function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const ACCENT = 'oklch(0.55 0.13 255)';
export const ACCENT_DK = 'oklch(0.5 0.13 255)';

// Project-avatar palette (Part B): blue / navy / teal / purple / amber, all with #fff text. A
// document's colour is picked deterministically from its title so the same doc always looks the same.
const AVATAR_COLORS = ['oklch(0.55 0.13 255)', '#3b4d8f', '#0e7c66', '#5a3ea8', '#b5642a'];

// A stable 2-letter avatar (initials of the first two words, else the first two letters) and its
// palette colour, derived only from the title - no stored/fabricated identity.
export function avatar(title: string): { readonly text: string; readonly color: string } {
	const words = title.trim().split(/\s+/).filter(Boolean);
	const letters = words.length >= 2
		? (words[0][0] + words[1][0])
		: (title.replace(/\s+/g, '').slice(0, 2) || '?');
	let hash = 0;
	for (let i = 0; i < title.length; i++) { hash = (hash * 31 + title.charCodeAt(i)) | 0; }
	const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
	return { text: esc(letters.toUpperCase()), color };
}

// A modal sheet (plan 28): a name field + optional note + a body of action rows, hidden until a
// `data-sheet-open` button reveals it client-side. `id` matches the opener's `data-sheet-open` value; the
// SCRIPT plumbing gathers the fields and posts one message. Kept minimal + calm (decision D28-B).
export function sheet(id: string, opts: { title: string; sub?: string; nameLabel: string; namePlaceholder: string; note?: boolean; body: string }): string {
	const note = opts.note
		? `<label class="sheet-label" style="margin-top:14px">Anything specific for this one?</label>
			<input class="sheet-input" data-field="note" placeholder="Optional - a focus, a tone, a detail to include">`
		: '';
	return `<div class="sheet-back" id="sheet-${id}" data-sheet="${id}">
		<div class="sheet-card" role="dialog" aria-modal="true">
			<h2 class="sheet-title">${opts.title}</h2>
			${opts.sub ? `<p class="sheet-sub">${opts.sub}</p>` : ''}
			<label class="sheet-label">${esc(opts.nameLabel)}</label>
			<input class="sheet-input" data-field="name" data-autofocus placeholder="${esc(opts.namePlaceholder)}">
			${note}
			${opts.body}
		</div>
	</div>`;
}

// One checkbox row in a multi-select picker sheet (F17/F18): a labelled checkbox carrying its pick value.
// The whole row is the click target; `sub` is an optional mono meta line (e.g. the file kind).
export function pickRow(value: string, label: string, sub?: string): string {
	return `<label class="sheet-row" style="cursor:pointer;margin-top:6px">
		<input type="checkbox" data-pick="${esc(value)}" style="width:16px;height:16px;flex:none;accent-color:${ACCENT}">
		<span style="flex:1;min-width:0"><span style="display:block;font:600 12.5px/1.3 system-ui;color:#1a1c20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span>${sub ? `<span style="display:block;font:400 11px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">${esc(sub)}</span>` : ''}</span>
	</label>`;
}

// A multi-select picker sheet (F17 "From sources...", F18 "New template from examples"): a name field, an
// optional note, a scrollable checkbox list with a live "N selected" count, and a submit that posts the
// checked values as `picks`. Real data only: with no options it shows a calm empty line and no submit. The
// out-of-bounds refusal (too few/too many) is the service's, in plain words - not a silently dead button.
export function pickerSheet(id: string, opts: { title: string; sub?: string; nameLabel: string; namePlaceholder: string; note?: boolean; pickLabel: string; submitMsg: string; submitLabel: string; rows: string; empty: string }): string {
	const note = opts.note
		? `<label class="sheet-label" style="margin-top:14px">Anything specific for this one?</label>
			<input class="sheet-input" data-field="note" placeholder="Optional - a focus, a tone, a detail to include">`
		: '';
	const hasRows = opts.rows.length > 0;
	const list = hasRows
		? `<div style="max-height:230px;overflow-y:auto;margin:2px -2px 0;padding:0 2px">${opts.rows}</div>`
		: `<p style="margin:8px 0 0;font:400 12.5px/1.5 system-ui;color:#868b95">${esc(opts.empty)}</p>`;
	const actions = `<div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
			<button class="btn-ghost" data-sheet-close="${id}">Cancel</button>
			${hasRows ? `<button class="btn-primary" data-sheet-submit data-pick-submit data-msg="${esc(opts.submitMsg)}">${esc(opts.submitLabel)}</button>` : ''}
		</div>`;
	return `<div class="sheet-back" id="sheet-${id}" data-sheet="${id}">
		<div class="sheet-card" role="dialog" aria-modal="true">
			<h2 class="sheet-title">${esc(opts.title)}</h2>
			${opts.sub ? `<p class="sheet-sub">${esc(opts.sub)}</p>` : ''}
			<label class="sheet-label">${esc(opts.nameLabel)}</label>
			<input class="sheet-input" data-field="name" data-autofocus placeholder="${esc(opts.namePlaceholder)}">
			${note}
			<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 0">
				<label class="sheet-label" style="margin:0">${esc(opts.pickLabel)}</label>
				<span data-pick-count style="font:500 11px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2">0 selected</span>
			</div>
			${list}
			${actions}
		</div>
	</div>`;
}

// Shared webview head: same font stack, selection colour and scrollbar treatment as the comp shell.
const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}
/* Reset the webview harness's body padding (0 20px, injected by src/vs/workbench/contrib/webview/browser/pre/index.html)
 * along with its margin, for the same edge-to-edge reason as the doc editor (issue #175). The screen surface runs
 * full width; the cards inside .scr-body float on the #f8f9fb canvas with their own internal padding, so zeroing the
 * harness inset does not crowd them. The 48px brand/crumb top bar the screens used to draw is gone (plan 44-b): the
 * one global Abstract header (the repurposed title bar) now carries it. */
html,body{margin:0;padding:0;height:100%}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1c20;background:#fff}
::selection{background:rgba(80,110,235,.18)}
::-webkit-scrollbar{width:11px;height:11px}
::-webkit-scrollbar-thumb{background:#d7d9df;border:3px solid transparent;background-clip:content-box;border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:#c2c5cd;background-clip:content-box}
@keyframes lwdPulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes lwdSpin{to{transform:rotate(360deg)}}
.screen{height:100vh;display:flex;flex-direction:column;min-height:0;background:#fff}
.scr-head{flex:none;display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid #eef0f3}
.scr-title{margin:0 0 4px;font:600 18px/1.2 system-ui;color:#15171c}
.scr-sub{font:400 12px/1 'JetBrains Mono',ui-monospace,monospace;color:#a3a8b2}
.scr-body{flex:1;overflow-y:auto;background:#f8f9fb}
.btn-primary{border:none;border-radius:8px;padding:10px 16px;background:${ACCENT};color:#fff;font:600 13px/1 system-ui;cursor:pointer}
.btn-ghost{border:1px solid #e0e2e8;background:#fff;border-radius:8px;padding:8px 13px;font:500 12px/1 system-ui;color:#52575f;cursor:pointer}
.sheet-back{display:none;position:fixed;inset:0;z-index:40;background:rgba(20,23,28,.32);align-items:flex-start;justify-content:center}
.sheet-card{margin-top:12vh;width:460px;max-width:calc(100vw - 40px);background:#fff;border:1px solid #e6e8ed;border-radius:16px;box-shadow:0 24px 60px -24px rgba(20,23,28,.5);padding:22px 24px 20px}
.sheet-title{font:600 16px/1.25 system-ui;color:#15171c;margin:0 0 3px}
.sheet-sub{font:400 12.5px/1.5 system-ui;color:#696e78;margin:0 0 16px}
.sheet-label{display:block;font:600 11px/1 system-ui;color:#52575f;margin:0 0 6px}
.sheet-input{width:100%;border:1px solid #dfe1e7;border-radius:9px;padding:11px 12px;font:400 14px/1.3 system-ui;color:#1a1c20;background:#fff;outline:none}
.sheet-input:focus{border-color:${ACCENT};box-shadow:0 0 0 3px rgba(80,110,235,.14)}
.sheet-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;border:1px solid #ececf0;border-radius:10px;padding:11px 13px;cursor:pointer;margin-top:8px}
.sheet-row:hover{background:#f7f8fb;border-color:#dfe1e7}
</style>`;

// Generic message bridge: any element with data-msg posts {type:<msg>, arg:<data-arg>} to the host.
// Sheet plumbing (plan 28): a modal sheet gathers a name + optional note before posting one message, so a
// generate/new-doc action carries the typed values. A sheet is opened client-side (no host round-trip, no
// flash), and its submit buttons collect the sheet's fields; template-row submits carry their own data-arg.
const SCRIPT = `const vscode = acquireVsCodeApi();
for (const el of document.querySelectorAll('[data-msg]')) {
	if (el.hasAttribute('data-sheet-open') || el.hasAttribute('data-sheet-submit')) { continue; }
	el.addEventListener('click', () => vscode.postMessage({ type: el.getAttribute('data-msg'), arg: el.getAttribute('data-arg') || undefined }));
}
function lwdSheet(id) { return document.getElementById('sheet-' + id); }
function lwdClose(id) { const s = lwdSheet(id); if (s) { s.style.display = 'none'; } }
function lwdOpen(id, arg, name) {
	const s = lwdSheet(id); if (!s) { return; }
	// Only one sheet at a time: opening a second birth (e.g. From sources from the New-document sheet) hides
	// the first, so the overlays never stack.
	for (const other of document.querySelectorAll('[data-sheet]')) { other.style.display = 'none'; }
	s.dataset.arg = arg || '';
	const nameEl = s.querySelector('[data-field=name]');
	if (nameEl) { nameEl.value = name || ''; }
	const noteEl = s.querySelector('[data-field=note]');
	if (noteEl) { noteEl.value = ''; }
	// Reset any multi-select picker (checkboxes) and refresh its count/limit affordance.
	for (const pick of s.querySelectorAll('[data-pick]')) { pick.checked = false; }
	lwdPickCount(s);
	s.style.display = 'flex';
	const focus = s.querySelector('[data-autofocus]');
	if (focus) { focus.focus(); if (focus.select) { focus.select(); } }
}
// Update a picker sheet's live "N selected" count label. The count is advisory only - the actual bound check
// (at least one source for F17; 3-10 examples for F18) is enforced by the service, which refuses out-of-bounds
// selections with a plain-words reason rather than a silently dead button.
function lwdPickCount(s) {
	const picks = s.querySelectorAll('[data-pick]');
	if (!picks.length) { return; }
	let n = 0;
	for (const p of picks) { if (p.checked) { n++; } }
	const label = s.querySelector('[data-pick-count]');
	if (label) { label.textContent = n + ' selected'; }
}
function lwdSubmit(el) {
	const s = el.closest('[data-sheet]'); if (!s) { return; }
	const nameEl = s.querySelector('[data-field=name]');
	const noteEl = s.querySelector('[data-field=note]');
	const targetEl = s.querySelector('[data-field=target]');
	const apiEl = s.querySelector('[data-field=apiurl]');
	const picks = [];
	for (const p of s.querySelectorAll('[data-pick]')) { if (p.checked) { picks.push(p.getAttribute('data-pick')); } }
	vscode.postMessage({
		type: el.getAttribute('data-msg'),
		arg: el.getAttribute('data-arg') || s.dataset.arg || undefined,
		name: nameEl ? nameEl.value.trim() : undefined,
		note: noteEl ? noteEl.value.trim() : undefined,
		target: targetEl ? targetEl.value : undefined,
		apiurl: apiEl ? apiEl.value.trim() : undefined,
		picks: picks.length ? JSON.stringify(picks) : undefined,
	});
	lwdClose(s.getAttribute('data-sheet'));
}
// Keep every picker's count/limit affordance live as the user toggles checkboxes.
for (const el of document.querySelectorAll('[data-pick]')) {
	el.addEventListener('change', () => { const s = el.closest('[data-sheet]'); if (s) { lwdPickCount(s); } });
}
for (const el of document.querySelectorAll('[data-sheet-open]')) {
	el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lwdOpen(el.getAttribute('data-sheet-open'), el.getAttribute('data-arg'), el.getAttribute('data-name')); });
}
// (plan 44-b) The global Abstract header (native DOM, outside this webview) drives the surface action
// button - "+ Add Source" on Knowledge opens the same sheet the in-body button opens. The host posts
// { type:'openSheet', sheet:<id> } and we open it here, so the header and the body share one sheet path.
window.addEventListener('message', (e) => {
	const m = e.data;
	if (m && m.type === 'openSheet' && m.sheet) { lwdOpen(m.sheet); }
});
for (const el of document.querySelectorAll('[data-sheet-close]')) {
	el.addEventListener('click', () => lwdClose(el.getAttribute('data-sheet-close')));
}
for (const el of document.querySelectorAll('[data-sheet-submit]')) {
	el.addEventListener('click', () => lwdSubmit(el));
}
for (const el of document.querySelectorAll('[data-field=name]')) {
	el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const s = el.closest('[data-sheet]'); const def = s && s.querySelector('[data-sheet-default]'); if (def) { def.click(); } } });
}
// Tweak (amend-before-approve, plan 31 iter 3): Edit opens the in-card contenteditable over the proposed
// text; Save & Approve posts reviewTweakSave (the host amends then approves through the one engine path);
// Cancel restores. The editor lives inside the card DOM only (never persisted until approval).
for (const el of document.querySelectorAll('[data-tweak-open]')) {
	el.addEventListener('click', () => { const card = el.closest('.rv-card'); if (!card) { return; } card.querySelector('.rv-tweakwrap').style.display = 'block'; card.querySelector('.rv-normacts').style.display = 'none'; card.querySelector('.rv-tweakacts').style.display = 'flex'; const ed = card.querySelector('.rv-tweakedit'); if (ed) { ed.focus(); } });
}
for (const el of document.querySelectorAll('[data-tweak-cancel]')) {
	el.addEventListener('click', () => { const card = el.closest('.rv-card'); if (!card) { return; } const ed = card.querySelector('.rv-tweakedit'); if (ed) { ed.textContent = ed.getAttribute('data-orig') || ''; } card.querySelector('.rv-tweakwrap').style.display = 'none'; card.querySelector('.rv-normacts').style.display = 'flex'; card.querySelector('.rv-tweakacts').style.display = 'none'; });
}
for (const el of document.querySelectorAll('[data-tweak-save]')) {
	el.addEventListener('click', () => { const card = el.closest('.rv-card'); const ed = card && card.querySelector('.rv-tweakedit'); const text = ed ? ed.innerText.replace(/\\s+/g, ' ').trim() : ''; vscode.postMessage({ type: 'reviewTweakSave', arg: el.getAttribute('data-arg') || undefined, text: text }); });
}
// Inline registry editors (Agents detail drawer, plan 32 iter 3): a policy <select> and the trigger fields
// post their message on change with the element's live value; the host writes it and re-renders.
for (const el of document.querySelectorAll('[data-change-msg]')) {
	el.addEventListener('change', () => vscode.postMessage({ type: el.getAttribute('data-change-msg'), arg: el.getAttribute('data-arg') || undefined, value: el.value }));
}
// The trigger editor's Save button gathers its sibling picker fields (kind + cron day/time or heartbeat hours)
// and posts one setAgentTrigger message with a composed value string the host parses.
for (const el of document.querySelectorAll('[data-trigger-save]')) {
	el.addEventListener('click', () => {
		const box = el.closest('[data-trigger-box]'); if (!box) { return; }
		const kind = box.querySelector('[data-tfield=kind]');
		const day = box.querySelector('[data-tfield=day]');
		const time = box.querySelector('[data-tfield=time]');
		const hours = box.querySelector('[data-tfield=hours]');
		const source = box.querySelector('[data-tfield=source]');
		vscode.postMessage({ type: 'setAgentTrigger', arg: el.getAttribute('data-arg') || undefined,
			value: JSON.stringify({ kind: kind ? kind.value : 'manual', day: day ? day.value : undefined, time: time ? time.value : undefined, hours: hours ? hours.value : undefined, source: source ? source.value : undefined }) });
	});
}
// Settings onboarding survey (plan 35 iter 4): Save gathers the three plain-words answers and posts one
// submitSurvey message; the host records the model_configured event and re-renders to the thank-you state.
for (const el of document.querySelectorAll('[data-survey-save]')) {
	el.addEventListener('click', () => {
		const box = document.querySelector('[data-survey]'); if (!box) { return; }
		const val = (n) => { const f = box.querySelector('[data-sfield=' + n + ']'); return f ? f.value.trim() : ''; };
		vscode.postMessage({ type: 'submitSurvey', daily: val('daily'), subs: val('subs'), weekly: val('weekly') });
	});
}
// The trigger kind <select> toggles which picker fields show (cron day/time vs heartbeat hours vs event source).
for (const el of document.querySelectorAll('[data-tfield=kind]')) {
	el.addEventListener('change', () => {
		const box = el.closest('[data-trigger-box]'); if (!box) { return; }
		for (const g of box.querySelectorAll('[data-tgroup]')) { g.style.display = (g.getAttribute('data-tgroup') === el.value) ? 'flex' : 'none'; }
	});
}
// Model-access sign-in (plan 38): the "Open the sign-in page" anchor is a genuine anchor click (a real user
// gesture), so we hand the URL to the host to open OUTSIDE the sandboxed webview via the opener service - a
// raw target=_blank inside the iframe is sandbox-blocked, and a post-await window.open would be popup-blocked.
for (const el of document.querySelectorAll('[data-open-external]')) {
	el.addEventListener('click', (e) => { e.preventDefault(); vscode.postMessage({ type: 'openExternalUrl', arg: el.getAttribute('href') || undefined }); });
}
// Whole-project chat composer (F15 / journey 1w, map-D21/D24): the "Ask" button (and Cmd/Ctrl+Enter in the
// textarea) gathers the text and posts one askProject message; the host classifies it (question -> read-only
// answer with citations, rendered back into this box; change request -> the run/task surface).
for (const el of document.querySelectorAll('[data-ask-send]')) {
	el.addEventListener('click', () => {
		const box = el.closest('[data-ask-box]'); if (!box) { return; }
		const input = box.querySelector('[data-ask-input]');
		const text = input ? input.value.trim() : '';
		if (text) { vscode.postMessage({ type: 'askProject', text: text }); }
	});
}
for (const el of document.querySelectorAll('[data-ask-input]')) {
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			const box = el.closest('[data-ask-box]'); const send = box && box.querySelector('[data-ask-send]');
			if (send) { send.click(); }
		}
	});
}
// "Copy link" fallback for corporate/blocked environments: copy the authorize URL to the clipboard so the
// user can paste it into their own browser. A brief "Copied" acknowledgement, then the label restores.
for (const el of document.querySelectorAll('[data-copy-link]')) {
	el.addEventListener('click', () => {
		const link = el.getAttribute('data-link') || '';
		const done = () => { const prev = el.textContent; el.textContent = 'Copied'; setTimeout(() => { el.textContent = prev; }, 1400); };
		if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, done); } else { done(); }
	});
}`;

function page(body: string): string {
	return `<!DOCTYPE html><html><head>${HEAD}</head><body>${body}<script>${SCRIPT}</script></body></html>`;
}

// The screens no longer draw their own brand/crumb top bar (plan 44-b): the one global Abstract header
// (the repurposed title bar) carries the breadcrumb, the sync pill and the surface action for every
// surface. The ScreenEditor publishes each screen's header content (breadcrumb + pill + "+ Open Folder" /
// "+ New Template" / "+ Add Source") to IAbstractHeaderService; here we render only the screen body.
export function renderScreenHtml(screen: ScreenId, state: IScreenState): string {
	switch (screen) {
		case 'home': return page(renderHome(state));
		case 'templates': return page(renderTemplates(state));
		case 'knowledge': return page(renderKnowledge(state));
		case 'agents': return page(renderAgents(state));
		case 'settings': return page(renderSettings(state));
		case 'onboarding': return page(renderOnboarding(state));
		case 'project-run': return page(renderProjectRun(state));
		case 'review-project': return page(renderReviewProject(state));
	}
}
