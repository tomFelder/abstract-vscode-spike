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
import { ChatGptSignInStage, ILivingDocSummary, IModelProviderStatus, IProjectAnswer, ISourceInfo, ITemplateCard, ITemplateInfo } from '../common/livingDocs.js';
import { IAwayFeed } from '../common/projectHomeFeed.js';
import { IActivityLedger } from '../common/livingDocLedger.js';
import { OnboardingStep } from '../common/onboarding.js';
import { abstractTokenCss, AVATAR_NAVY, FONT, HAIRLINE, INDIGO, INK, PAPER, RADIUS, TYPE } from '../common/abstractTokens.js';
import { renderHome } from './screenRenderHome.js';
import { renderTemplates } from './screenRenderTemplates.js';
import { renderKnowledge } from './screenRenderKnowledge.js';
import { renderAgents } from './screenRenderAgents.js';
import { renderSettings, renderOnboarding, renderProjectRun, renderReviewProject } from './screenRenderMisc.js';
import { POLICY_EDITOR_STYLE } from './policyEditorRender.js';

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

/**
 * One NEEDS-YOU card's real pending detail (H2, plan 48). Built from `getPendingForDoc` + the doc's most
 * recent snapshot: the plain-language reason and the freshness stamp are both real (never fabricated). The
 * reason cites the gutter address ("at line N") only when the pending change carries a real `sourceLine`;
 * otherwise it names the real block ("in <block>") - no invented line number. `refreshedLabel` is the
 * relative time of the doc's most recent recorded change, absent when the doc has no history yet.
 */
export interface IHomeNeedsYou {
	/** Stringified doc URI, the `reviewNeedsYou`/`openDoc` arg. */
	readonly resource: string;
	/** The document's human title. */
	readonly title: string;
	/** The real pending-change count for this document (mirrors the Review rail). */
	readonly pendingCount: number;
	/** The plain-language, one-line reason for the top pending change, citing its real address when known. */
	readonly reason: string;
	/** The real "refreshed Nm ago" relative-time stamp of the doc's most recent change; absent when none. */
	readonly refreshedLabel?: string;
	/**
	 * The durable block id of the top pending change (H2.3u): the Review button deep-links to the doc, opens
	 * the Review tab, and scrolls to this block via the address model. Absent when the change carries no block
	 * anchor (the deep link then opens the doc + Review tab without a scroll - graceful degrade, spec section 3.1).
	 */
	readonly blockId?: string;
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
	/**
	 * Knowledge: the render-time clock (ms), computed once by the ScreenEditor so the SYNC column's relative
	 * times ("2m ago", "stale · 9d") are deterministic and `Date.now()` never runs inside the render module
	 * (#122 F12; the pure `freshnessLabel` formatter takes this `now`). Absent falls back to a fixed epoch so
	 * the render never throws - real callers always supply it.
	 */
	readonly knNow?: number;
	/** Knowledge: the project's data files (csv/json) offered by the Add-source picker, and the docs to bind to. */
	readonly dataFiles?: readonly string[];
	/**
	 * Home + Templates: the project's document files (md/txt at the root) - the knowledge half of the
	 * "From sources..." birth picker (F17) and the example set for the from-examples template wizard (F18).
	 */
	readonly docFiles?: readonly string[];
	/** Agents: the live registry (drives the cards + canvas). */
	readonly agents: readonly IAgentDef[];
	/**
	 * Agents (plan 49-b A2.3): the workspace model id the agents run on, from the broker catalogue (pin 14).
	 * The "runs on" footer of every card shows it - one workspace model drives every agent (the registry has
	 * no per-agent model), so this is a single resolved id. Absent when the broker is unreachable (an empty
	 * catalogue): the footer then omits the model id rather than fabricating one.
	 */
	readonly agentModelId?: string;
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
	 * Agents (plan 49-c A3): the activity ledger - the flat, newest-first chronological read model folded from
	 * the SAME real event streams the History tab reads (orchestrator runs + per-document lock audits) plus the
	 * live pending set (the WAITING rows). Built by the pure `buildActivityLedger`; bounded to LEDGER_CAP with a
	 * truncation flag. Absent renders the truthful empty state (never a fabricated row). The read model never
	 * mutates orchestrator or lock state (do-not-break, plan 49 section 5).
	 */
	readonly ledger?: IActivityLedger;
	/**
	 * Agents (plan 49-c A3.1): the render-time clock (ms), captured once by the ScreenEditor so the ledger's
	 * mono timestamp column ("09:41" today / "Fri" this week / "3 Jul" older) is deterministic and `Date.now()`
	 * never runs inside the render module (the same discipline as `knNow`). Absent falls back to a fixed epoch so
	 * the render never throws - real callers always supply it.
	 */
	readonly ledgerNow?: number;
	/**
	 * Home: the latest agent run that failed, for the quiet attention line above the project grid (plan 32
	 * iter 2). Absent when nothing failed - truthful automation, no fake activity. Carries the agent's human
	 * name and the failure day so the copy reads "Weekly refresh failed on Monday - view details".
	 */
	readonly homeFailure?: IHomeFailure;
	/**
	 * Home: the real pending detail for the NEEDS-YOU cards (plan 48 H2), at most the two most-pending
	 * documents. Absent/empty renders no NEEDS-YOU section (H2.5: no empty shell). Each row carries a real
	 * reason + freshness stamp built from `getPendingForDoc` + the doc's history - never fabricated.
	 */
	readonly homeNeedsYou?: readonly IHomeNeedsYou[];
	/**
	 * Home: the total number of documents with pending work (H2.1 overflow). When it exceeds the two cards
	 * shown, the "+N more" affordance links to the Review surface. Zero when nothing pends.
	 */
	readonly homeNeedsYouTotal?: number;
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
	/**
	 * Home: the person to greet, from the existing user/profile source (the OS username basename of the
	 * environment's userHome when no explicit profile name exists). Absent falls back to a name-less greeting
	 * ("Good morning.") - never a fabricated placeholder name.
	 */
	readonly userName?: string;
	/** Home: the documents discovered in the open folder (all Markdown, living flagged for the badge). */
	readonly docs?: readonly ILivingDocSummary[];
	/** Templates: the `*.template.md` files discovered in the open folder (plan 28), driving the card grid. */
	readonly templates?: readonly ITemplateInfo[];
	/**
	 * Templates (plan 48 T2): the v2 gallery model - each discovered template plus its real usage count and
	 * its parsed skeleton-thumbnail rows. Additive over `templates` (which still seeds the birth sheets): the
	 * v2 card grid renders from this so the "N bind slots · used N×" meta and the skeleton are real, never
	 * fabricated. Absent/empty renders the calm empty state.
	 */
	readonly templateCards?: readonly ITemplateCard[];
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
	 * Settings (plan 51 device auth): the device code the user copies in one click during the pending state.
	 * Present only while a sign-in is pending.
	 */
	readonly signInUserCode?: string;
	/**
	 * Settings (plan 51): the verification link the user opens in their browser during the pending state (the
	 * pre-filled `verificationUriComplete` when the broker provides it). A real clickable link (a genuine user
	 * gesture the browser will not popup-block) plus a copyable fallback. Present only while pending.
	 */
	readonly signInVerificationUri?: string;
	/** Settings (plan 51): the broker-forwarded upstream HTTP status for the honest upstream-rejected error state. */
	readonly signInUpstreamStatus?: number;
	/** Settings (plan 51): a short snippet of the upstream response body for the upstream-rejected error state. */
	readonly signInUpstreamBody?: string;
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
	 * pause - finished changes stay reviewable, and the run renders as neither a failure nor an all-clear.
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

// The one indigo. Round 2 collapses the old oklch accent pair onto the design system's indigo, so the
// screens, the document editor and the rails cannot drift apart (docs/28-design-system-round2.md).
export const ACCENT = INDIGO.base;
export const ACCENT_DK = INDIGO.hover;

// Project-avatar palette. Round 2 retires the rainbow (comp 4b: "no rainbow avatars"): identity is not
// state, so an avatar may not borrow a hue that means something. Every avatar is the project indigo,
// except the person chip, which is navy - two identities, two colours, no more.
const AVATAR_COLORS = [INDIGO.base, AVATAR_NAVY];

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
		<span style="flex:1;min-width:0"><span style="display:block;font:600 12.5px/1.3 ${FONT.sans};color:${INK.heading};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span>${sub ? `<span style="display:block;font:400 11px/1.4 ${FONT.mono};color:${INK.meta}">${esc(sub)}</span>` : ''}</span>
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
		: `<p style="margin:8px 0 0;font:${TYPE.secondary};color:${INK.secondary}">${esc(opts.empty)}</p>`;
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
				<span data-pick-count style="font:400 11px/1 ${FONT.mono};color:${INK.meta}">0 selected</span>
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
 * full width; the cards inside .scr-body float on the page paper with their own internal padding, so zeroing the
 * harness inset does not crowd them. The 48px brand/crumb top bar the screens used to draw is gone (plan 44-b): the
 * one global Abstract header (the repurposed title bar) now carries it. */
${abstractTokenCss()}
html,body{margin:0;padding:0;height:100%}
body{font-family:${FONT.sans};color:${INK.heading};background:${PAPER.page}}
::selection{background:${INDIGO.tint}}
::-webkit-scrollbar{width:11px;height:11px}
::-webkit-scrollbar-thumb{background:${PAPER.control};border:3px solid transparent;background-clip:content-box;border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:${PAPER.frameBorder};background-clip:content-box}
@keyframes lwdPulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes lwdSpin{to{transform:rotate(360deg)}}
.screen{height:100vh;display:flex;flex-direction:column;min-height:0;background:${PAPER.page}}
.scr-head{flex:none;display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid ${HAIRLINE.strong}}
.scr-title{margin:0 0 4px;font:${TYPE.docHeading};color:${INK.heading}}
.scr-sub{font:${TYPE.provenance};color:${INK.meta}}
.scr-body{flex:1;overflow-y:auto;background:${PAPER.page}}
/* Buttons: one indigo primary, a hairline secondary. Sentence case is enforced by the copy, not by CSS -
 * text-transform would lie about the string the renderer actually passed. */
.btn-primary{border:none;border-radius:${RADIUS.control};padding:10px 16px;background:${INDIGO.base};color:#fff;font:${TYPE.uiBodyStrong};cursor:pointer}
.btn-primary:hover{background:${INDIGO.hover}}
.btn-ghost{border:1px solid ${PAPER.control};background:${PAPER.card};border-radius:${RADIUS.control};padding:8px 13px;font:${TYPE.uiBody};color:${INK.body};cursor:pointer}
.btn-ghost:hover{background:${PAPER.sunken}}
.sheet-back{display:none;position:fixed;inset:0;z-index:40;background:rgba(27,27,32,.32);align-items:flex-start;justify-content:center}
.sheet-card{margin-top:12vh;width:480px;max-width:calc(100vw - 40px);background:${PAPER.page};border-radius:16px;box-shadow:var(--ab-shadow-dialog);padding:28px 30px}
.sheet-title{font:600 19px/1.25 ${FONT.sans};color:${INK.heading};margin:0 0 5px}
.sheet-sub{font:400 13px/1.5 ${FONT.sans};color:${INK.secondary};margin:0 0 18px}
.sheet-label{display:block;font:600 12.5px/1 ${FONT.sans};color:${INK.bodySoft};margin:0 0 6px}
.sheet-input{width:100%;border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.input};padding:11px 14px;font:400 14.5px/1.3 ${FONT.sans};color:${INK.heading};background:${PAPER.card};outline:none}
.sheet-input:focus{border-color:${INDIGO.base};box-shadow:0 0 0 3px ${INDIGO.tint}}
.sheet-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:${PAPER.card};border:1px solid ${HAIRLINE.strong};border-radius:${RADIUS.card};padding:13px 16px;cursor:pointer;margin-top:8px}
.sheet-row:hover{background:${INDIGO.tint};border-color:${INDIGO.tintBorder}}
/* Home DOCUMENTS grid (plan 48 H3.2, repainted round 2): a document tile lifts to indigo tint on hover;
 * the dashed New-document tile shifts to the indigo ink + border. */
.doc-tile:hover{background:${INDIGO.tint};border-color:${INDIGO.tintBorder}}
.doc-newtile:hover{color:${INDIGO.base};border-color:${INDIGO.tintBorder}}
/* Templates gallery (plan 48 T2): a template card lifts on hover; the dashed Save-as-template tile
 * shifts to the indigo ink; a starter card lifts to indigo tint. */
.tpl-card:hover{border-color:${INDIGO.tintBorder};box-shadow:var(--ab-shadow-frame)}
.tpl-newtile:hover{color:${INDIGO.base};border-color:${INDIGO.tintBorder}}
.tpl-starter:hover{border-color:${INDIGO.tintBorder};background:${INDIGO.tint}}
/* The 240px live filter field in the Templates title row (T1.1). */
.tpl-filter{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:${RADIUS.input};border:1px solid ${HAIRLINE.strong};background:${PAPER.card};width:240px}
.tpl-filter input{flex:1;min-width:0;border:none;background:none;outline:none;font:${TYPE.secondary};color:${INK.heading}}
.tpl-filter input::placeholder{color:${INK.meta}}
/* The shared plain-language policy editor (spec 3.4): the Agents card's Edit policy opens the SAME component
 * the doc Properties panel uses, so its one stylesheet is inlined here too (plan 49-b A2.3, principle P2). */
${POLICY_EDITOR_STYLE}
</style>`;

// Generic message bridge: any element with data-msg posts {type:<msg>, arg:<data-arg>, block:<data-block>} to
// the host. `block` is the durable block id a deep-link element (the Home NEEDS-YOU Review button, H2.3u)
// carries; it is omitted when the element has no data-block, so every other action is unaffected.
// Sheet plumbing (plan 28): a modal sheet gathers a name + optional note before posting one message, so a
// generate/new-doc action carries the typed values. A sheet is opened client-side (no host round-trip, no
// flash), and its submit buttons collect the sheet's fields; template-row submits carry their own data-arg.
const SCRIPT = `const vscode = acquireVsCodeApi();
for (const el of document.querySelectorAll('[data-msg]')) {
	if (el.hasAttribute('data-sheet-open') || el.hasAttribute('data-sheet-submit')) { continue; }
	el.addEventListener('click', (e) => {
		// A nested action (e.g. a Knowledge FEEDS chip inside a row-click button) marks data-stop so its click
		// does not also trigger the containing row's message (K2.4 chip opens the doc, not the source tab).
		if (el.hasAttribute('data-stop')) { e.stopPropagation(); }
		vscode.postMessage({ type: el.getAttribute('data-msg'), arg: el.getAttribute('data-arg') || undefined, block: el.getAttribute('data-block') || undefined });
	});
}
// Keyboard activation for non-native clickable surfaces (e.g. the Agents roster card, which is a div-with-role
// so its inner action buttons keep their own hit targets): Enter or Space on a focused [data-keyactivate]
// element fires the same click the mouse would, so every data-msg door is reachable without a pointer.
for (const el of document.querySelectorAll('[data-keyactivate]')) {
	el.addEventListener('keydown', (e) => {
		// Only activate the card itself (#265 CR-2): Enter/Space on a nested Run Now / Open button must fire that
		// control's own click, not bubble up and click the card. Ignore key events that did not originate on el.
		if (e.target !== el) { return; }
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); el.click(); }
	});
}
// Knowledge table (plan 49-a): a row lifts on hover to its data-rowhover colour (cream for a stale row, grey
// otherwise) and restores to data-rowbg on leave - a hover the inline style cannot express.
for (const el of document.querySelectorAll('.kn-row[data-rowhover]')) {
	el.addEventListener('mouseenter', () => { el.style.background = el.getAttribute('data-rowhover'); });
	el.addEventListener('mouseleave', () => { el.style.background = el.getAttribute('data-rowbg'); });
}
// Knowledge live filter (plan 49-a K1.1): typing narrows the SOURCES table to the rows whose source name or
// dependent-doc titles (held in data-kn-name) contain the query. Purely client-side; empty query shows all. A
// "no matches" line toggles when the query hides every row, so the table never reads as an empty surface.
for (const el of document.querySelectorAll('[data-kn-filter]')) {
	el.addEventListener('input', () => {
		const q = el.value.trim().toLowerCase();
		let shown = 0;
		for (const r of document.querySelectorAll('[data-kn-row]')) {
			const match = !q || (r.getAttribute('data-kn-name') || '').indexOf(q) >= 0;
			r.style.display = match ? '' : 'none';
			if (match) { shown++; }
		}
		const none = document.querySelector('[data-kn-nomatch]');
		if (none) { none.style.display = shown === 0 ? 'block' : 'none'; }
	});
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
// Agent card policy (plan 49-b A2.3): the "Edit policy" link toggles the SHARED policy editor open beneath
// the footer (the same component the doc Properties panel hosts). No host round-trip to open - purely client
// side so the card does not flash. The card id sits on the wrapper via data-agent-policy.
for (const el of document.querySelectorAll('[data-agent-policy-edit]')) {
	el.addEventListener('click', (e) => {
		e.preventDefault(); e.stopPropagation();
		const card = el.closest('[data-agent-card]'); if (!card) { return; }
		const box = card.querySelector('[data-agent-policy-box]'); if (!box) { return; }
		box.style.display = box.style.display === 'none' ? 'block' : 'none';
	});
}
// Agent card policy (plan 49-b A2.3): a click on a [data-policy] row inside the SHARED editor reads the chosen
// three-tier level AND its container's data-policy-editor (the agent id), then posts one setAgentPolicyLevel
// message. The host maps the level back onto the legacy dial through the store (semantics unchanged). This is
// the SAME delegation contract the doc editor uses for the Properties panel, so the DOM component is identical.
for (const el of document.querySelectorAll('[data-agent-card] [data-policy]')) {
	el.addEventListener('click', (e) => {
		e.stopPropagation();
		const group = el.closest('[data-policy-editor]');
		vscode.postMessage({ type: 'setAgentPolicyLevel', arg: group ? group.getAttribute('data-policy-editor') : undefined, value: el.getAttribute('data-policy') });
	});
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
}
// Templates live filter (plan 48 T1.1): typing in the title-row field narrows the gallery to the cards
// whose searchable text (name + description, held in data-filter) contains the query. Purely client-side (no
// host round-trip, no flash); an empty query shows every card. A "no matches" line is toggled when the query
// hides them all, so the grid never reads as an empty (broken) surface.
for (const el of document.querySelectorAll('[data-tpl-filter]')) {
	el.addEventListener('input', () => {
		const q = el.value.trim().toLowerCase();
		let shown = 0;
		for (const card of document.querySelectorAll('[data-filter]')) {
			const match = !q || (card.getAttribute('data-filter') || '').indexOf(q) >= 0;
			card.style.display = match ? '' : 'none';
			if (match) { shown++; }
		}
		const none = document.querySelector('[data-tpl-nomatch]');
		if (none) { none.style.display = shown === 0 ? 'block' : 'none'; }
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
